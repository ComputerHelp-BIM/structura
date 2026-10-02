/**
 * loads.js — Applied-load intensity from the model file.
 * =================================================================
 * An .e2k carries the loads an engineer assigned: area loads on slabs
 * (force per area), line loads on beams (force per length), the load
 * patterns they belong to and the combinations built from them. This module
 * turns those records into one number per element, plus floor-by-floor and
 * whole-building summaries, so the viewer can colour by intensity.
 *
 * Everything is reported in kN/m² (slabs) and kN/m (beams) regardless of the
 * file's own unit system, because that is how loading is quoted in practice.
 *
 * What this is NOT: an analysis. No load is distributed, no member force is
 * derived, nothing is designed. It reports what the model says it carries,
 * with self-weight optionally added from the geometry and material density.
 */
(function (global) {
  'use strict';

  /* Pattern types that act downward and belong in a gravity total. */
  var GRAVITY_TYPES = /dead|live|snow|rain|roof|super/i;
  /* Directions that mean "down" in an ETABS object-load record. */
  var GRAVITY_DIRS = { GRAV: 1, GRAVITY: 1, 'GLOBAL Z': 1, Z: 1, LOCAL3: 1, PROJ: 1, GRAVPROJ: 1 };
  /* Uniform force record types this module understands. */
  var UNIFORM_TYPES = { UNIFF: 1, UNIF: 1, UNIFORM: 1, UNIFLOADSET: 1, TRAPF: 1, TRAP: 1 };

  var AREA_TYPES = { Slab: 1, Ramp: 1, Deck: 1, Roof: 1 };

  /* ------------------------------------------------------------------ */
  /* Bases: what the user can colour by                                  */
  /* ------------------------------------------------------------------ */

  /** The selectable load bases for this model, service total first. */
  function bases(model) {
    var out = [{ id: 'service', label: 'Service total (all gravity patterns)', kind: 'service' }];
    Object.keys(model.loadPatterns || {}).forEach(function (p) {
      out.push({ id: 'pattern:' + p, label: p + '  ·  ' + (model.loadPatterns[p].type || 'pattern'), kind: 'pattern' });
    });
    Object.keys(model.combos || {}).forEach(function (c) {
      out.push({ id: 'combo:' + c, label: c + '  ·  combination', kind: 'combo' });
    });
    return out;
  }

  function basisLabel(model, id) {
    var found = bases(model).filter(function (b) { return b.id === id; })[0];
    return found ? found.label : id;
  }

  /**
   * Pattern → factor for a basis. Combinations are expanded through their
   * load cases (an ETABS case usually carries one pattern of the same name)
   * and through nested combinations, with a depth guard.
   */
  function factorsFor(model, basis) {
    var f = {};
    var patterns = model.loadPatterns || {};

    if (!basis || basis === 'service') {
      Object.keys(patterns).forEach(function (p) {
        if (GRAVITY_TYPES.test(patterns[p].type || '')) f[p] = 1;
      });
      // A file with no pattern table: take every pattern that loads anything.
      if (!Object.keys(f).length) {
        (model.loads || []).forEach(function (l) { if (l.pattern) f[l.pattern] = 1; });
      }
      return f;
    }

    if (basis.indexOf('pattern:') === 0) {
      f[basis.slice(8)] = 1;
      return f;
    }

    if (basis.indexOf('combo:') === 0) {
      addCombo(model, basis.slice(6), 1, f, 0);
      return f;
    }
    return f;
  }

  function addCombo(model, name, scale, out, depth) {
    var combo = (model.combos || {})[name];
    if (!combo || depth > 6) return;
    combo.parts.forEach(function (part) {
      var sf = scale * (part.sf === undefined ? 1 : part.sf);
      if ((model.combos || {})[part.name] && part.name !== name) addCombo(model, part.name, sf, out, depth + 1);
      else out[part.name] = (out[part.name] || 0) + sf;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Intensity                                                           */
  /* ------------------------------------------------------------------ */

  function keyOf(kind, target, story) {
    return kind + '\u0001' + String(target).toUpperCase() + '\u0001' + String(story).toUpperCase();
  }

  /** Group the file's object loads by the element they sit on. */
  function indexLoads(model) {
    var map = {};
    (model.loads || []).forEach(function (l) {
      var k = keyOf(l.kind, l.target, l.story);
      (map[k] = map[k] || []).push(l);
    });
    return map;
  }

  function addPattern(floor, name, kN) {
    floor.byPattern[name] = (floor.byPattern[name] || 0) + kN;
  }

  /** dead | live | other — decides the seismic-weight treatment. */
  function patternKind(model, name) {
    var p = (model.loadPatterns || {})[name];
    var t = p ? String(p.type || '') : '';
    if (/live/i.test(t)) return 'live';
    if (/dead|super/i.test(t)) return 'dead';
    if (!p) return /live|ll/i.test(name) ? 'live' : 'dead';   // no pattern table
    return 'other';
  }

  function isGravity(load) {
    return !!GRAVITY_DIRS[String(load.dir || 'GRAV').toUpperCase()];
  }

  function magnitude(load) {
    // A trapezoidal load varies along the member; its average is the fair
    // single number for an intensity map.
    if (load.value2 !== null && load.value2 !== undefined) return (load.value + load.value2) / 2;
    return load.value;
  }

  /**
   * Compute one intensity per element.
   *
   * @param {object} model
   * @param {object} opts  { basis, selfWeight }
   * @returns {object} result — see the fields assembled at the end.
   */
  function compute(model, opts) {
    opts = opts || {};
    var basis = opts.basis || 'service';
    var withSelf = opts.selfWeight !== false;
    var els = model.elements;
    var u = model.meta.units;
    var forceK = u.forceToKN || 1;
    var lenM = u.lengthToM || 1;
    var perArea = forceK / (lenM * lenM);      // file force/length² → kN/m²
    var perLength = forceK / lenM;             // file force/length  → kN/m

    var factors = factorsFor(model, basis);
    var index = indexLoads(model);
    var densities = {};

    var values = new Float64Array(els.length);
    // The same numbers without self weight: "unloaded" means nothing was
    // assigned, not that the member is weightless.
    var appliedValues = new Float64Array(els.length);
    var breakdown = {};                        // element id → [{ label, value }]
    var floors = {};                           // storey name → summary
    var slabMax = 0, beamMax = 0, applied = 0;

    function density(mat) {
      if (densities[mat] === undefined) {
        var m = model.materials[mat];
        densities[mat] = (m && m.weightPerVolume !== undefined)
          ? m.weightPerVolume * forceK / (lenM * lenM * lenM)
          : null;
      }
      return densities[mat];
    }

    function floorOf(el) {
      var name = el.story || '—';
      return floors[name] ||
        (floors[name] = blankFloor(name, el.storyIndex === undefined ? 0 : el.storyIndex));
    }

    els.forEach(function (el, i) {
      var isArea = el.kind === 'area' && AREA_TYPES[el.type];
      var isLine = el.kind === 'frame' && (el.type === 'Beam' || el.type === 'Brace');
      if (!isArea && !isLine) return;

      var rows = [];
      var total = 0;
      var scale = isArea ? perArea : perLength;
      var list = index[keyOf(isArea ? 'area' : 'line', el.name, el.story)] || [];

      var extent = isArea ? (el.planArea || 0) : (el.length || 0);
      var fl0 = floorOf(el);

      list.forEach(function (ld) {
        var f = factors[ld.pattern];
        if (!f || !isGravity(ld) || !UNIFORM_TYPES[String(ld.type || 'UNIFF').toUpperCase()]) return;
        var v = magnitude(ld) * scale * f;
        if (!isFinite(v) || v === 0) return;
        total += v;
        applied++;
        rows.push({ label: ld.pattern + (f === 1 ? '' : ' × ' + round(f, 2)), value: v, pattern: ld.pattern });
        appliedValues[i] += v;
        addPattern(fl0, ld.pattern, v * extent);
        // Dead / live split, needed for the seismic weight table.
        var kind = patternKind(model, ld.pattern);
        if (kind === 'live') {
          fl0.liveKN += v * extent;
          // IS 1893:2016 Table 8 — a quarter of a light imposed load, half of
          // a heavy one, is carried in the seismic weight.
          var bare = magnitude(ld) * scale;             // unfactored intensity
          fl0.reducedLiveKN += v * extent * (bare > 3 ? 0.5 : 0.25);
        } else if (kind === 'dead') {
          fl0.deadKN += v * extent;
        }
      });

      if (withSelf) {
        var d = density(el.material);
        if (d !== null) {
          var self = isArea
            ? d * (el.thickness || 0)                 // kN/m² = kN/m³ × m
            : d * (el.sectionArea || 0);              // kN/m   = kN/m³ × m²
          if (self > 0 && selfWeightCounts(model, factors)) {
            total += self;
            rows.push({ label: 'Self weight', value: self, pattern: '(self)' });
            addPattern(fl0, 'Self weight', self * extent);
            fl0.deadKN += self * extent;
          }
        }
      }

      values[i] = total;
      if (rows.length) breakdown[el.id] = rows;

      var fl = fl0;
      // Only floor panels count as "unloaded": a beam with no line load is
      // normal — the slab hands its load over during analysis.
      if (isArea && appliedValues[i] <= 1e-9) fl.unloaded++;
      if (isArea) {
        var area = el.planArea || 0;
        fl.slabArea += area;
        fl.slabLoadSum += total * area;
        fl.slabCount++;
        fl.totalKN += total * area;
        if (total > fl.slabMax) { fl.slabMax = total; fl.worstSlab = el.id; }
        if (total > slabMax) slabMax = total;
      } else {
        var len = el.length || 0;
        fl.beamLength += len;
        fl.beamLoadSum += total * len;
        fl.beamCount++;
        fl.totalKN += total * len;
        if (total > fl.beamMax) { fl.beamMax = total; fl.worstBeam = el.id; }
        if (total > beamMax) beamMax = total;
      }
    });

    /* ---- Point loads on joints ------------------------------------- */
    var pointTotal = 0;
    (model.loads || []).forEach(function (ld) {
      if (ld.kind !== 'point') return;
      var f = factors[ld.pattern];
      if (!f) return;
      var kN = Math.abs(magnitude(ld)) * forceK * f;
      if (!isFinite(kN) || kN === 0) return;
      var name = ld.story || '—';
      var fl = floors[name] || (floors[name] = blankFloor(name, model.storyIndex[name] || 0));
      fl.pointKN += kN;
      fl.pointCount++;
      fl.totalKN += kN;
      addPattern(fl, ld.pattern, kN);
      var kind = patternKind(model, ld.pattern);
      if (kind === 'live') { fl.liveKN += kN; fl.reducedLiveKN += kN * 0.25; }
      else if (kind === 'dead') fl.deadKN += kN;
      pointTotal += kN;
    });

    /* ---- Structure self weight (columns, walls, braces) -------------- */
    // Vertical members carry load rather than receive an intensity, so they
    // stay out of the floor totals — but their weight is real, and the
    // seismic weight needs it. ETABS shares a storey's columns and walls
    // half to the level above and half to the level below.
    var structure = { columnKN: 0, wallKN: 0, byFloor: {}, total: 0 };
    els.forEach(function (el) {
      var vertical = (el.kind === 'frame' && (el.type === 'Column' || el.type === 'Brace')) ||
                     (el.kind === 'area' && el.type === 'Wall');
      if (!vertical) return;
      var d = density(el.material);
      if (d === null) return;
      var w = (el.volume || 0) * d;
      if (el.kind === 'area') structure.wallKN += w; else structure.columnKN += w;
      structure.total += w;
      var here = el.story || '—';
      var below = model.stories[(model.storyIndex[here] || 0) - 1];
      structure.byFloor[here] = (structure.byFloor[here] || 0) + w / 2;
      if (below) structure.byFloor[below.name] = (structure.byFloor[below.name] || 0) + w / 2;
      else structure.byFloor[here] += w / 2;          // lowest level keeps it all
    });
    Object.keys(structure.byFloor).forEach(function (name) {
      var fl = floors[name];
      if (fl) fl.structureKN = structure.byFloor[name];
    });

    var floorList = Object.keys(floors).map(function (k) {
      var f = floors[k];
      f.slabAvg = f.slabArea > 0 ? f.slabLoadSum / f.slabArea : 0;   // area-weighted
      f.beamAvg = f.beamLength > 0 ? f.beamLoadSum / f.beamLength : 0; // length-weighted
      return f;
    }).sort(function (a, b) { return b.index - a.index; });          // top storey first

    /* ---- Seismic weight, IS 1893:2016 ------------------------------- */
    // Cl 7.3.1 / Table 8: full dead load plus a fraction of the imposed load
    // (¼ up to 3 kN/m², ½ above). Cl 7.3.2: the imposed load on the roof is
    // not counted, and columns and walls are shared half to the level above
    // and half below — done when `structure` was built.
    var topIndex = model.stories.length - 1;
    floorList.forEach(function (f) {
      var live = f.index === topIndex ? 0 : f.reducedLiveKN;
      f.seismicW = f.deadKN + f.structureKN + live;
      f.seismicLive = live;
    });
    var seismic = {
      total: floorList.reduce(function (s, f) { return s + f.seismicW; }, 0),
      roofExcluded: true,
      complete: !!withSelf
    };

    /* ---- Pattern take-off ------------------------------------------- */
    var patternTotals = {};
    floorList.forEach(function (f) {
      Object.keys(f.byPattern).forEach(function (p) {
        patternTotals[p] = (patternTotals[p] || 0) + f.byPattern[p];
      });
    });
    var patterns = Object.keys(patternTotals).map(function (p) {
      return {
        name: p,
        factor: p === 'Self weight' ? 1 : (factors[p] || 0),
        kind: p === 'Self weight' ? 'dead' : patternKind(model, p),
        totalKN: patternTotals[p]
      };
    }).sort(function (a, b) { return b.totalKN - a.totalKN; });

    var building = {
      slabMax: slabMax, beamMax: beamMax,
      totalKN: floorList.reduce(function (s, f) { return s + f.totalKN; }, 0),
      slabArea: floorList.reduce(function (s, f) { return s + f.slabArea; }, 0),
      worstSlabFloor: pickFloor(floorList, 'slabMax'),
      worstBeamFloor: pickFloor(floorList, 'beamMax'),
      heaviestFloor: pickFloor(floorList, 'totalKN'),
      unloaded: floorList.reduce(function (s, f) { return s + f.unloaded; }, 0)
    };
    building.slabAvg = building.slabArea > 0
      ? floorList.reduce(function (s, f) { return s + f.slabLoadSum; }, 0) / building.slabArea : 0;

    return {
      basis: basis,
      basisLabel: basisLabel(model, basis),
      selfWeight: withSelf,
      factors: factors,
      values: values,
      appliedValues: appliedValues,
      breakdown: breakdown,
      floors: floorList,
      byFloor: floors,
      building: building,
      slabMax: slabMax,
      beamMax: beamMax,
      hasLoads: applied > 0 || slabMax > 0 || beamMax > 0 || pointTotal > 0,
      patterns: patterns,
      structure: structure,
      seismic: seismic,
      pointKN: pointTotal,
      units: { area: 'kN/m²', line: 'kN/m', force: 'kN' }
    };
  }

  /**
   * Self-weight belongs in the total only when the basis includes a pattern
   * that carries it (ETABS applies self weight through a pattern's
   * SELFWEIGHT multiplier). Showing LIVE alone must not include it.
   */
  function selfWeightCounts(model, factors) {
    var pats = model.loadPatterns || {};
    var any = false;
    Object.keys(factors).forEach(function (p) {
      var pat = pats[p];
      if (!pat) return;
      if (pat.selfWeight > 0 || /dead/i.test(pat.type || '')) any = true;
    });
    // A file with no pattern table at all: assume the total should carry it.
    if (!Object.keys(pats).length) any = true;
    return any;
  }

  function blankFloor(name, index) {
    return {
      name: name, index: index,
      slabMax: 0, slabArea: 0, slabLoadSum: 0, slabCount: 0, worstSlab: null,
      beamMax: 0, beamLength: 0, beamLoadSum: 0, beamCount: 0, worstBeam: null,
      pointKN: 0, pointCount: 0, byPattern: {},
      deadKN: 0, liveKN: 0, reducedLiveKN: 0, structureKN: 0, seismicW: 0,
      unloaded: 0, totalKN: 0
    };
  }

  function pickFloor(list, field) {
    var best = null;
    list.forEach(function (f) { if (!best || f[field] > best[field]) best = f; });
    return best;
  }

  function round(v, n) {
    var p = Math.pow(10, n || 0);
    return Math.round(v * p) / p;
  }

  /* ------------------------------------------------------------------ */
  /* Presentation helpers                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Heat-map ramp: light blue (light) → green → amber → red (heaviest).
   * Chosen to stay readable for the common forms of colour blindness:
   * lightness rises monotonically with load, so the ranking survives even
   * when the hues do not.
   */
  var RAMP = [
    [222, 240, 248],   // almost white — nothing there
    [ 86, 170, 214],   // blue
    [ 92, 178, 124],   // green
    [232, 178,  56],   // amber
    [214, 108,  44],   // orange
    [176,  42,  46]    // red
  ];

  function ramp(t) {
    t = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
    var f = t * (RAMP.length - 1);
    var i = Math.min(RAMP.length - 2, Math.floor(f));
    var k = f - i;
    return [
      RAMP[i][0] + (RAMP[i + 1][0] - RAMP[i][0]) * k,
      RAMP[i][1] + (RAMP[i + 1][1] - RAMP[i][1]) * k,
      RAMP[i][2] + (RAMP[i + 1][2] - RAMP[i][2]) * k
    ];
  }

  function rampCss(t) {
    var c = ramp(t);
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  /** "8.25 kN/m²" — two decimals below 10, one above, for tidy columns. */
  function fmt(value, unit) {
    if (!isFinite(value)) return '—';
    var v = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
    return v + (unit ? ' ' + unit : '');
  }

  function unitFor(el) {
    return el && el.kind === 'area' ? 'kN/m²' : 'kN/m';
  }

  /** Does this element take part in the load map at all? */
  function carries(el) {
    if (!el) return false;
    if (el.kind === 'area') return !!AREA_TYPES[el.type];
    return el.kind === 'frame' && (el.type === 'Beam' || el.type === 'Brace');
  }

  global.ETABSLoads = {
    bases: bases,
    basisLabel: basisLabel,
    factorsFor: factorsFor,
    compute: compute,
    ramp: ramp,
    rampCss: rampCss,
    fmt: fmt,
    unitFor: unitFor,
    carries: carries,
    AREA_TYPES: AREA_TYPES
  };
})(window);
