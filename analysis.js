/**
 * analysis.js — Quantities, statistics, model health and revision diff.
 * =================================================================
 * Everything here is derived from the parsed model only. No figure is
 * invented: when a material density or a section dimension is missing from
 * the file, the affected quantity is reported as "not stated" rather than
 * silently defaulted, because a takeoff that quietly guesses is worse than
 * one that admits a gap.
 *
 * Namespace: window.ETABSAnalysis, window.ETABSUnits
 */
(function (global) {
  /** Analytical end nodes of a frame (drawn ends may carry insertion offsets). */
  function nA(el) { return el.na || el.a; }
  function nB(el) { return el.nb || el.b; }

  'use strict';

  /* ================================================================== */
  /* Units                                                               */
  /* ================================================================== */

  var LENGTH_UNITS = {
    m:  { label: 'm',  factor: 1,       digits: 3 },
    mm: { label: 'mm', factor: 1000,    digits: 0 },
    cm: { label: 'cm', factor: 100,     digits: 1 },
    ft: { label: 'ft', factor: 3.280839895, digits: 3 },
    in: { label: 'in', factor: 39.37007874,  digits: 2 }
  };

  var SYSTEMS = {
    'kN-m':   { length: 'm',  force: 'kN',  forceFactor: 1 },
    'N-mm':   { length: 'mm', force: 'N',   forceFactor: 1000 },
    'kgf-m':  { length: 'm',  force: 'kgf', forceFactor: 101.9716 },
    'kip-ft': { length: 'ft', force: 'kip', forceFactor: 0.2248089 },
    'kip-in': { length: 'in', force: 'kip', forceFactor: 0.2248089 }
  };

  var Units = {
    systems: Object.keys(SYSTEMS),
    current: 'kN-m',
    set: function (name) { if (SYSTEMS[name]) this.current = name; return this; },
    def: function () { return SYSTEMS[this.current]; },

    /** Metres → the active display unit, formatted with a unit suffix. */
    length: function (metres, opts) {
      var u = LENGTH_UNITS[this.def().length];
      var v = metres * u.factor;
      var digits = (opts && opts.digits !== undefined) ? opts.digits : u.digits;
      var s = v.toFixed(digits);
      return (opts && opts.bare) ? s : s + ' ' + u.label;
    },
    lengthValue: function (metres) { return metres * LENGTH_UNITS[this.def().length].factor; },
    lengthLabel: function () { return LENGTH_UNITS[this.def().length].label; },

    /** Volumes and areas always read in metric for takeoffs; ft³/ft² when imperial. */
    volume: function (m3) {
      var u = this.def().length;
      if (u === 'ft' || u === 'in') return (m3 * 35.3146667).toFixed(1) + ' ft³';
      return m3.toFixed(2) + ' m³';
    },
    area: function (m2) {
      var u = this.def().length;
      if (u === 'ft' || u === 'in') return (m2 * 10.7639104).toFixed(1) + ' ft²';
      return m2.toFixed(2) + ' m²';
    },
    mass: function (tonnes) {
      var u = this.def().length;
      if (u === 'ft' || u === 'in') return (tonnes * 1.10231131).toFixed(2) + ' ton (US)';
      return tonnes.toFixed(2) + ' t';
    },
    number: function (v, digits) {
      return Number(v).toLocaleString(undefined, {
        minimumFractionDigits: digits || 0, maximumFractionDigits: digits === undefined ? 0 : digits
      });
    }
  };

  /* ================================================================== */
  /* Material helpers                                                    */
  /* ================================================================== */

  var STEEL_PER_KN = 1 / 9.80665;  // kN of weight → tonnes mass

  /**
   * Density in kN/m³ for a named material, or null when the file does not
   * state one. `weightPerVolume` arrives in the file's own force/length³.
   */
  function densityKNm3(model, matName) {
    var m = model.materials[matName];
    if (!m || m.weightPerVolume === undefined) return null;
    var f = model.meta.units.forceToKN;
    var l = model.meta.units.lengthToM;
    return m.weightPerVolume * f / (l * l * l);
  }

  function materialClass(model, matName, sectionFamily) {
    var m = model.materials[matName];
    var t = m && m.type ? String(m.type).toLowerCase() : '';
    if (t.indexOf('concrete') >= 0) return 'concrete';
    if (t.indexOf('steel') >= 0 || t.indexOf('rebar') >= 0 || t.indexOf('tendon') >= 0) return 'steel';
    if (t.indexOf('masonry') >= 0) return 'masonry';
    if (t.indexOf('timber') >= 0 || t.indexOf('wood') >= 0) return 'timber';
    // Fall back on the section family: rolled shapes are steel by nature.
    if (sectionFamily && ['i', 'channel', 'tee', 'angle', 'doubleangle', 'box', 'pipe'].indexOf(sectionFamily) >= 0) {
      return 'steel';
    }
    return 'unknown';
  }

  /* ================================================================== */
  /* Quantities / BOM                                                    */
  /* ================================================================== */

  /**
   * @param {Object} model
   * @param {Array<number>=} ids Restrict to these element ids (e.g. the
   *   current selection or what is visible). Omit for the whole model.
   */
  function quantities(model, ids) {
    var els = ids ? ids.map(function (i) { return model.elements[i]; }).filter(Boolean) : model.elements;

    var concrete = {};   // grade → { volume, byStorey }
    var steel = {};      // section → { tonnes, length, count, byStorey }
    var formwork = {};   // storey → m²
    var slabArea = {}, wallArea = {};
    var missingDensity = {};
    var totals = { concreteVol: 0, steelTonnes: 0, formwork: 0, slab: 0, wall: 0, unknownVol: 0 };

    els.forEach(function (el) {
      if (el.kind === 'joint') return;
      var cls = materialClass(model, el.material, el.sectionFamily);
      var storey = el.story || '—';

      if (el.kind === 'frame') {
        var vol = el.volume || 0;
        var perim = frameSurface(model, el);
        if (cls === 'steel') {
          var d = densityKNm3(model, el.material);
          if (d === null) { missingDensity[el.material || '(unnamed)'] = true; }
          var tonnes = d === null ? 0 : vol * d * STEEL_PER_KN;
          var s = steel[el.section] || (steel[el.section] = { section: el.section, tonnes: 0, length: 0, count: 0, byStorey: {}, material: el.material });
          s.tonnes += tonnes; s.length += el.length; s.count++;
          s.byStorey[storey] = (s.byStorey[storey] || 0) + tonnes;
          totals.steelTonnes += tonnes;
        } else if (cls === 'concrete' || cls === 'unknown') {
          var grade = el.material || '(unstated)';
          var c = concrete[grade] || (concrete[grade] = { grade: grade, volume: 0, byStorey: {}, byType: {} });
          c.volume += vol;
          c.byStorey[storey] = (c.byStorey[storey] || 0) + vol;
          c.byType[el.type] = (c.byType[el.type] || 0) + vol;
          totals.concreteVol += vol;
          if (cls === 'unknown') totals.unknownVol += vol;
          formwork[storey] = (formwork[storey] || 0) + perim;
          totals.formwork += perim;
        }
      } else if (el.kind === 'area') {
        if (el.type === 'Opening') return;
        var av = el.volume || 0;
        var grade2 = el.material || '(unstated)';
        var c2 = concrete[grade2] || (concrete[grade2] = { grade: grade2, volume: 0, byStorey: {}, byType: {} });
        c2.volume += av;
        c2.byStorey[storey] = (c2.byStorey[storey] || 0) + av;
        c2.byType[el.type] = (c2.byType[el.type] || 0) + av;
        totals.concreteVol += av;
        if (el.type === 'Wall') {
          wallArea[storey] = (wallArea[storey] || 0) + el.planArea * 2;
          totals.wall += el.planArea;
          formwork[storey] = (formwork[storey] || 0) + el.planArea * 2;
          totals.formwork += el.planArea * 2;
        } else {
          slabArea[storey] = (slabArea[storey] || 0) + el.planArea;
          totals.slab += el.planArea;
          formwork[storey] = (formwork[storey] || 0) + el.planArea;
          totals.formwork += el.planArea;
        }
      }
    });

    return {
      concrete: Object.keys(concrete).map(function (k) { return concrete[k]; })
        .sort(function (a, b) { return b.volume - a.volume; }),
      steel: Object.keys(steel).map(function (k) { return steel[k]; })
        .sort(function (a, b) { return b.tonnes - a.tonnes; }),
      formwork: formwork,
      slabArea: slabArea,
      wallArea: wallArea,
      totals: totals,
      missingDensity: Object.keys(missingDensity),
      elementCount: els.length
    };
  }

  /** Shuttering area for a frame: its section perimeter times its length. */
  function frameSurface(model, el) {
    var prof = model.sectionProfiles[el.section];
    if (!prof) return 0;
    var p = 0, o = prof.outline;
    for (var i = 0; i < o.length; i++) {
      var a = o[i], b = o[(i + 1) % o.length];
      p += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    // Beams are cast against the slab on their top face; deduct the width.
    if (el.type === 'Beam') p -= prof.width;
    return Math.max(0, p) * el.length;
  }

  /* ================================================================== */
  /* Statistics                                                          */
  /* ================================================================== */

  function statistics(model) {
    var counts = {};
    var sections = {}, materials = {};
    var storeyStats = {};
    var b = model.bbox;
    var scale = model.meta.units.lengthToM;

    model.elements.forEach(function (el) {
      counts[el.type] = (counts[el.type] || 0) + 1;
      var st = storeyStats[el.story] || (storeyStats[el.story] = { counts: {}, area: 0 });
      st.counts[el.type] = (st.counts[el.type] || 0) + 1;
      if (el.kind === 'area' && el.type !== 'Wall' && el.type !== 'Opening') st.area += el.planArea;

      if (el.section && el.section !== '(none)') {
        var s = sections[el.section] || (sections[el.section] = {
          name: el.section, count: 0, length: 0, kind: el.kind,
          material: el.material, family: el.sectionFamily, stories: {}
        });
        s.count++;
        s.length += el.length || 0;
        s.stories[el.story] = true;
      }
      if (el.material) {
        var m = materials[el.material] || (materials[el.material] = {
          name: el.material, count: 0,
          type: (model.materials[el.material] || {}).type || '—',
          density: densityKNm3(model, el.material)
        });
        m.count++;
      }
    });

    var stories = model.stories.map(function (s) {
      var st = storeyStats[s.name] || { counts: {}, area: 0 };
      return {
        name: s.name,
        height: s.height * scale,
        elev: s.elev * scale,
        master: s.master,
        floorArea: st.area,
        counts: st.counts,
        total: Object.keys(st.counts).reduce(function (a, k) { return a + st.counts[k]; }, 0)
      };
    }).slice().reverse();

    var totalHeight = b.size[2];
    var minPlan = Math.min(b.size[0], b.size[1]) || 1;

    return {
      counts: counts,
      stories: stories,
      sections: Object.keys(sections).map(function (k) { return sections[k]; })
        .sort(function (a, c) { return c.count - a.count; }),
      materials: Object.keys(materials).map(function (k) { return materials[k]; })
        .sort(function (a, c) { return c.count - a.count; }),
      footprint: { x: b.size[0], y: b.size[1], area: b.size[0] * b.size[1] },
      height: totalHeight,
      slenderness: totalHeight / minPlan,
      storeyCount: Math.max(0, model.stories.length - 1),
      elementTotal: model.elements.length
    };
  }

  /* ================================================================== */
  /* Model health                                                        */
  /* ================================================================== */

  var TOL = 0.005;  // 5 mm coincidence tolerance

  function key3(p) {
    return Math.round(p[0] / TOL) + ',' + Math.round(p[1] / TOL) + ',' + Math.round(p[2] / TOL);
  }

  /**
   * Run every check and return findings ordered by severity. Each finding
   * carries the element ids so the UI can zoom straight to the problem.
   */
  function healthChecks(model) {
    var findings = [];
    var els = model.elements;
    var connected = {};       // node key → true, from frames and areas
    var columnTops = {};      // node key → true
    var wallNodes = {};

    els.forEach(function (el) {
      if (el.kind === 'frame') {
        connected[key3(nA(el))] = true; connected[key3(nB(el))] = true;
        if (el.type === 'Column') columnTops[key3(nB(el))] = true;
      } else if (el.kind === 'area') {
        el.pts.forEach(function (p) {
          connected[key3(p)] = true;
          if (el.type === 'Wall') wallNodes[key3(p)] = true;
        });
      }
    });

    // 1 — orphan joints
    var orphans = [];
    els.forEach(function (el) {
      if (el.kind !== 'joint') return;
      if (!connected[key3(el.p)]) orphans.push(el.id);
    });
    if (orphans.length) {
      findings.push({
        id: 'orphan-joints', severity: 'warn',
        title: 'Orphan joints',
        detail: orphans.length + ' joint(s) are not attached to any frame or area. They add degrees of freedom with no stiffness and are a common cause of an unstable analysis.',
        ids: orphans
      });
    }

    // 2 — zero-length members
    var zero = els.filter(function (el) { return el.kind === 'frame' && el.length < TOL * 2; })
      .map(function (el) { return el.id; });
    if (zero.length) {
      findings.push({
        id: 'zero-length', severity: 'critical',
        title: 'Zero-length members',
        detail: zero.length + ' frame(s) have effectively no length. ETABS will usually refuse to solve, and the geometry cannot be meshed.',
        ids: zero
      });
    }

    // 3 — unassigned or undefined sections and materials
    var noSection = [], noMaterial = {};
    els.forEach(function (el) {
      if (el.kind === 'joint') return;
      var defined = el.kind === 'frame'
        ? !!model.frameSections[el.section]
        : !!model.shellSections[el.section];
      if (!el.section || el.section === '(none)' || !defined) noSection.push(el.id);
      if (el.material && !model.materials[el.material]) noMaterial[el.material] = true;
    });
    if (noSection.length) {
      findings.push({
        id: 'no-section', severity: 'critical',
        title: 'Unassigned or undefined sections',
        detail: noSection.length + ' element(s) reference a section property that is not defined in this file. Quantities for them are estimated from a default profile and should not be trusted.',
        ids: noSection
      });
    }
    var missingMats = Object.keys(noMaterial);
    if (missingMats.length) {
      findings.push({
        id: 'no-material', severity: 'warn',
        title: 'Undefined materials',
        detail: 'Referenced but not defined: ' + missingMats.join(', ') + '. Weights for these cannot be computed.',
        ids: []
      });
    }

    // 4 — duplicate / coincident members
    var seen = {}, dupes = [];
    els.forEach(function (el) {
      if (el.kind !== 'frame') return;
      var ka = key3(nA(el)), kb = key3(nB(el));
      var k = (ka < kb ? ka + '>' + kb : kb + '>' + ka) + '|' + el.type;
      if (seen[k] !== undefined) dupes.push(el.id);
      else seen[k] = el.id;
    });
    if (dupes.length) {
      findings.push({
        id: 'duplicates', severity: 'critical',
        title: 'Duplicate members',
        detail: dupes.length + ' frame(s) sit exactly on top of another member of the same type. This silently doubles stiffness and self-weight — one of the hardest errors to spot in a plan view.',
        ids: dupes
      });
    }

    // 4b — overlapping columns: two columns in the same storey whose
    // footprints clash but are not exact duplicates (a column drawn twice
    // at slightly different points — shows as two columns side by side).
    var colsByStorey = {};
    els.forEach(function (el) {
      if (el.kind !== 'frame' || el.type !== 'Column') return;
      (colsByStorey[el.storyIndex] = colsByStorey[el.storyIndex] || []).push(el);
    });
    var dupeSet = {};
    dupes.forEach(function (id) { dupeSet[id] = 1; });
    function halfSize(el) {
      var prof = (model.sectionProfiles && model.sectionProfiles[el.section]) ||
        (global.ETABSSections && model.frameSections[el.section] ?
          global.ETABSSections.build(model.frameSections[el.section]) : null);
      return prof ? Math.max(prof.depth || 0, prof.width || 0) / 2 : 0.15;
    }
    var clashes = [], pairs = 0;
    Object.keys(colsByStorey).forEach(function (k) {
      var list = colsByStorey[k];
      if (list.length > 4000) return;                 // keep O(n²) bounded
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var p = list[i], q = list[j];
          if (dupeSet[p.id] || dupeSet[q.id]) continue;
          var dx = p.b[0] - q.b[0], dy = p.b[1] - q.b[1];
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > 1e-3 && d < halfSize(p) + halfSize(q)) {
            clashes.push(p.id, q.id); pairs++;
          }
        }
      }
    });
    if (pairs) {
      findings.push({
        id: 'overlapping-columns', severity: 'critical',
        title: 'Overlapping columns',
        detail: pairs + ' pair(s) of columns in the same storey overlap each other without being exact duplicates — usually one column drawn twice on slightly different points. It doubles the stiffness there; delete one in ETABS.',
        ids: clashes
      });
    }

    // 4c — slab panels that carry no load in any pattern. An unloaded floor
    // is usually an assignment that was missed, and it is invisible in a
    // plan view. Only meaningful when the file carries loads at all.
    if (global.ETABSLoads && model.loads && model.loads.length) {
      var loaded = {};
      model.loads.forEach(function (l) {
        if (l.kind === 'area' && l.value) loaded[String(l.target).toUpperCase() + '\u0001' + String(l.story).toUpperCase()] = 1;
      });
      var bare = [];
      els.forEach(function (el) {
        if (el.kind !== 'area' || !global.ETABSLoads.AREA_TYPES[el.type]) return;
        if (!loaded[String(el.name).toUpperCase() + '\u0001' + String(el.story).toUpperCase()]) bare.push(el.id);
      });
      if (bare.length) {
        findings.push({
          id: 'unloaded-slabs', severity: 'warn',
          title: 'Floor panels with no load assigned',
          detail: bare.length + ' slab or ramp panel(s) carry no area load in any pattern — only their own ' +
            'self weight. That is right for a panel loaded through a line load or left deliberately bare, ' +
            'and wrong if the assignment was simply missed.',
          ids: bare
        });
      }
    }

    // 5 — discontinuous / floating columns
    var baseZ = model.bbox.min[2];
    var floating = [];
    els.forEach(function (el) {
      if (el.kind !== 'frame' || el.type !== 'Column') return;
      var bot = nA(el)[2] < nB(el)[2] ? nA(el) : nB(el);
      if (Math.abs(bot[2] - baseZ) < 0.05) return;          // founded
      var k = key3(bot);
      if (columnTops[k] || wallNodes[k]) return;            // continuous or on a wall
      floating.push(el.id);
    });
    if (floating.length) {
      findings.push({
        id: 'floating-columns', severity: 'critical',
        title: 'Discontinuous columns',
        detail: floating.length + ' column(s) start on a beam or on nothing rather than continuing to the foundation. In seismic design this is a soft-storey and vertical-irregularity flag under IS 1893 and most other codes.',
        ids: floating
      });
    }

    // 6 — storeys with no lateral system (informational, easy to miss)
    var byStorey = {};
    els.forEach(function (el) {
      if (el.kind === 'frame' && (el.type === 'Brace')) byStorey[el.story] = true;
      if (el.kind === 'area' && el.type === 'Wall') byStorey[el.story] = true;
    });
    var anyLateral = Object.keys(byStorey).length > 0;
    if (anyLateral) {
      var without = model.stories.slice(1).filter(function (s) { return !byStorey[s.name]; });
      if (without.length) {
        findings.push({
          id: 'lateral-gap', severity: 'info',
          title: 'Storeys without walls or bracing',
          detail: without.length + ' storey(s) have no shear wall or brace while the rest of the building does: ' +
            without.slice(0, 6).map(function (s) { return s.name; }).join(', ') +
            (without.length > 6 ? '…' : '') + '. Worth confirming the lateral system is intentional there.',
          ids: []
        });
      }
    }

    // 7 — very short or very long members (modelling slips)
    var odd = els.filter(function (el) {
      return el.kind === 'frame' && el.length > TOL * 2 && (el.length < 0.15 || el.length > 25);
    }).map(function (el) { return el.id; });
    if (odd.length) {
      findings.push({
        id: 'odd-length', severity: 'warn',
        title: 'Unusual member lengths',
        detail: odd.length + ' frame(s) are shorter than 150 mm or longer than 25 m. Usually a snapping error or a missing intermediate node.',
        ids: odd
      });
    }

    var order = { critical: 0, warn: 1, info: 2 };
    findings.sort(function (a, b) { return order[a.severity] - order[b.severity]; });
    return findings;
  }

  /* ================================================================== */
  /* Revision comparison                                                 */
  /* ================================================================== */

  /**
   * Match elements geometrically rather than by name: names are reassigned
   * freely between ETABS revisions, but a beam that did not move is the
   * same beam.
   */
  function compare(base, revision) {
    function indexOf(model) {
      var map = {};
      model.elements.forEach(function (el) {
        if (el.kind === 'joint') return;
        var k;
        if (el.kind === 'frame') {
          var ka = key3(nA(el)), kb = key3(nB(el));
          k = 'F|' + el.type + '|' + (ka < kb ? ka + '>' + kb : kb + '>' + ka);
        } else {
          var keys = el.pts.map(key3).sort();
          k = 'A|' + el.type + '|' + keys.join('>');
        }
        (map[k] = map[k] || []).push(el);
      });
      return map;
    }

    var A = indexOf(base), B = indexOf(revision);
    var added = [], removed = [], modified = [], unchanged = 0;

    Object.keys(B).forEach(function (k) {
      var bEls = B[k], aEls = A[k];
      if (!aEls) { bEls.forEach(function (e) { added.push(e); }); return; }
      var n = Math.min(aEls.length, bEls.length);
      for (var i = 0; i < n; i++) {
        var a = aEls[i], b = bEls[i];
        var changes = [];
        if (a.section !== b.section) changes.push({ field: 'Section', from: a.section, to: b.section });
        if (a.material !== b.material) changes.push({ field: 'Material', from: a.material || '—', to: b.material || '—' });
        if (a.kind === 'area' && Math.abs((a.thickness || 0) - (b.thickness || 0)) > 1e-4) {
          changes.push({ field: 'Thickness', from: a.thickness, to: b.thickness });
        }
        if (changes.length) modified.push({ element: b, before: a, changes: changes });
        else unchanged++;
      }
      for (var j = n; j < bEls.length; j++) added.push(bEls[j]);
    });

    Object.keys(A).forEach(function (k) {
      var aEls = A[k], bEls = B[k];
      if (!bEls) { aEls.forEach(function (e) { removed.push(e); }); return; }
      for (var j = bEls.length; j < aEls.length; j++) removed.push(aEls[j]);
    });

    return {
      added: added, removed: removed, modified: modified, unchanged: unchanged,
      summary: {
        added: added.length, removed: removed.length,
        modified: modified.length, unchanged: unchanged
      }
    };
  }

  global.ETABSUnits = Units;
  global.ETABSAnalysis = {
    quantities: quantities,
    statistics: statistics,
    healthChecks: healthChecks,
    compare: compare,
    densityKNm3: densityKNm3,
    materialClass: materialClass
  };
})(window);
