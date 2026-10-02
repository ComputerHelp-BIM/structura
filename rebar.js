/**
 * rebar.js — Reinforcement: bar layout, geometry, weights and schedules.
 * =================================================================
 * An ETABS model is not a detailing model. What it does carry is the
 * *definition* of each concrete section's reinforcement — the bar pattern,
 * one bar's area, the cover and the tie spacing — written in the
 * CONCRETESECTION records. This module uses that where it exists and
 * well-signposted rules where it does not:
 *
 *   Columns   bar pattern, diameter, cover and ties read from the file.
 *   Beams     a percentage of the section area that you set, turned into a
 *             practical bar count, with stirrups at your spacing.
 *   Slabs     a mesh at your diameter and spacing, one-way or two-way from
 *             the section name (…WAYONE / …WAYBOTH).
 *   Walls     vertical and horizontal mesh at your diameter and spacing.
 *
 * Every bar produced carries its own geometry, so the same numbers drive the
 * 3-D cage, the cross-section drawing, the weights and the bar schedule —
 * there is no second, separate estimate to drift out of step.
 *
 * NOT a design. Nothing here checks capacity, and nothing replaces a
 * detailer. It answers "what would this look like, and roughly how much
 * steel is it" from the geometry the model already has.
 *
 * Namespace: window.ETABSRebar
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'structura.rebar';

  /* Unit weight of a round bar: d² / 162 kg per metre, d in mm. */
  function kgPerM(dia) { return (dia * dia) / 162.0; }
  function barArea(dia) { return Math.PI * dia * dia / 4; }        // mm²

  var BAR_SIZES = [8, 10, 12, 16, 20, 25, 28, 32];

  var DEFAULTS = {
    /* --- what to draw ------------------------------------------------ */
    columns: true, beams: true, slabs: true, walls: true,
    scope: 'visible',            // visible | selection | storey
    maxSegments: 60000,          // display cap; quantities ignore this

    /* --- columns (used only where the file says nothing) ------------- */
    colBarDia: 20, colTieDia: 8, colTieSpacing: 150, colCover: 40,
    colPercent: 1.0,             // % of gross area when no pattern is given

    /* --- beams -------------------------------------------------------- */
    beamTopPercent: 0.8,         // % of b·D
    beamBotPercent: 0.6,
    beamBarDia: 16, beamStirrupDia: 8, beamStirrupSpacing: 150,
    beamCover: 35,               // clear cover to the stirrup, top and bottom
    beamSideCover: 30,           // clear cover to the stirrup at the sides
    beamSupportSteel: true,      // extra top bars over each support
    beamSupportPercent: 50,      // % more top steel there, over 0.25 × span
    beamSideFace: true,          // side-face bars when deeper than 750 mm (IS 456 Cl 26.5.1.3)

    /* --- slabs -------------------------------------------------------- */
    slabBarDia: 8, slabSpacing: 150, slabDistSpacing: 200, slabCover: 20,
    slabBothFaces: true,
    meshAuto: true,              // mesh bar steps up with thickness (slabs and walls)
    slabTopOverSupports: true,   // two-way slabs: top steel over supports, not a full mat

    /* --- walls -------------------------------------------------------- */
    wallBarDia: 10, wallSpacing: 200, wallCover: 25, wallBothFaces: true,

    /* --- detailing rules ---------------------------------------------- */
    hooks: '135',                // 135 (IS 13920) | 90
    crossTies: true,             // inner legs where the pattern needs them
    confining: true,             // closer links near member ends (IS 13920)
    bendDeductions: true,        // BBS cutting length, not centreline length

    /* --- quantity rules ---------------------------------------------- */
    grade: 'Fe500',
    concreteGrade: 'M25',        // used for the development length
    stockLength: 12,             // m — bars longer than this need a lap
    lapMode: 'code',             // code | fixed
    lapMultiplier: 1,            // × Ld, for offices that lap at 1.3 Ld
    lapFactor: 50,               // × diameter, when lapMode is 'fixed'
    anchorage: true,             // anchor beam/slab bars into supports
    wastagePercent: 3,
    accessoriesPercent: 2,       // chairs, spacers, binding wire

    /* --- display ------------------------------------------------------ */
    style: 'cutaway',            // cutaway | barsOnly | lines
    explode: 0,                  // 0…1, pulls the cage apart
    thinning: 'auto'             // auto | none — display-only tie/mesh thinning
  };

  function load() {
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      Object.keys(raw).forEach(function (k) { if (k in DEFAULTS) s[k] = raw[k]; });
    } catch (e) { /* private mode */ }
    return s;
  }
  function save(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    return s;
  }
  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    return load();
  }

  /* ================================================================== */
  /* Code quantities — IS 456 and IS 13920                               */
  /* ================================================================== */

  /** Design bond stress τbd for plain bars in tension, IS 456 Cl 26.2.1.1. */
  var TAU_BD = { M20: 1.2, M25: 1.4, M30: 1.5, M35: 1.7, M40: 1.9, M45: 2.0, M50: 2.1 };
  var FY = { Fe415: 415, Fe500: 500, Fe500D: 500, Fe550: 550, Fe250: 250 };

  /**
   * Development length in bar diameters.
   *   Ld = φ·σs / (4·τbd),  σs = 0.87 fy,  τbd × 1.6 for deformed bars.
   * Fe500 in M25 gives 48 φ, which is the familiar "lap at 50 d".
   */
  function developmentLengthFactor(steelGrade, concreteGrade) {
    var fy = FY[steelGrade] || 500;
    var tau = (TAU_BD[concreteGrade] || 1.4) * 1.6;      // deformed bars
    return (0.87 * fy) / (4 * tau);
  }

  /** Lap length in metres for one bar. */
  function lapLength(dia, S) {
    if (S.lapMode === 'fixed') return S.lapFactor * dia / 1000;
    return developmentLengthFactor(S.grade, S.concreteGrade) * (S.lapMultiplier || 1) * dia / 1000;
  }

  /** How the lap length was arrived at, in words, for panels and exports. */
  function lapDescription(S) {
    if (S.lapMode === 'fixed') return S.lapFactor + ' × dia';
    var f = developmentLengthFactor(S.grade, S.concreteGrade) * (S.lapMultiplier || 1);
    return Math.round(f) + ' × dia (IS 456 Ld for ' + S.grade + ' in ' + S.concreteGrade + ')';
  }

  /** Anchorage into a support — the same development length. */
  function anchorageLength(dia, S) {
    return developmentLengthFactor(S.grade, S.concreteGrade) * dia / 1000;
  }

  /**
   * Hook allowance for one end of a link, IS 2502 / IS 13920:
   * a 135° hook with a 10 d extension, never less than 75 mm.
   */
  function hookLength(dia, S) {
    if (S.hooks === '90') return Math.max(0.075, 10 * dia / 1000);
    return Math.max(0.075, 10 * dia / 1000);
  }

  /**
   * Bend deductions for a bar bending schedule: 2 d at a 90° bend and 3 d at
   * a 135° bend. A closed rectangular link has three 90° corners and two
   * 135° hooks, so the cutting length is the centreline perimeter plus the
   * two hooks less those deductions.
   */
  function linkCuttingLength(perimeter, dia, S) {
    var hooks = 2 * hookLength(dia, S);
    if (!S.bendDeductions) return perimeter + hooks;
    var d = dia / 1000;
    var deduction = S.hooks === '90' ? (4 * 2 * d) : (3 * 2 * d + 2 * 3 * d);
    return Math.max(perimeter * 0.5, perimeter + hooks - deduction);
  }

  /** Straight bar with a 90° bend at each end (anchorage into supports). */
  function barCuttingLength(straight, dia, S, bends) {
    if (!bends) return straight;
    var extra = bends * anchorageLength(dia, S);
    if (!S.bendDeductions) return straight + extra;
    return straight + extra - bends * 2 * dia / 1000;
  }

  /* ================================================================== */
  /* Geometry helpers                                                    */
  /* ================================================================== */

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function len3(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function norm(a) { var l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  /**
   * CSI local axes for a member — the same rule the viewer draws with, so
   * bars land inside the concrete rather than beside it.
   */
  function localAxes(a, b, angDeg) {
    var e1 = norm(sub(b, a));
    var e2, e3;
    if (Math.sqrt(e1[0] * e1[0] + e1[1] * e1[1]) < 1e-6) {
      e2 = [1, 0, 0];
      e3 = e1[2] < 0 ? [0, -1, 0] : [0, 1, 0];
    } else {
      var d = e1[2];
      e2 = norm([-d * e1[0], -d * e1[1], 1 - d * e1[2]]);
      e3 = cross(e1, e2);
    }
    if (angDeg) {
      var r = angDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      var n2 = [e2[0] * c + e3[0] * s, e2[1] * c + e3[1] * s, e2[2] * c + e3[2] * s];
      var n3 = [-e2[0] * s + e3[0] * c, -e2[1] * s + e3[1] * c, -e2[2] * s + e3[2] * c];
      e2 = n2; e3 = n3;
    }
    return { e1: e1, e2: e2, e3: e3, len: len3(sub(b, a)) };
  }

  /** The same insertion-point shift the viewer applies when drawing. */
  function cardinalShift(depth, width, cardinal) {
    var cp = cardinal || 10;
    if (cp < 1 || cp > 9) return [0, 0];
    var col = (cp - 1) % 3, row = Math.floor((cp - 1) / 3);
    var uRef = col === 0 ? -width / 2 : col === 1 ? 0 : width / 2;
    var vRef = row === 0 ? -depth / 2 : row === 1 ? 0 : depth / 2;
    return [-uRef, -vRef];
  }

  /* ================================================================== */
  /* Bar layout per element                                              */
  /* ================================================================== */

  /**
   * One bar record.
   *   kind   main | tie | mesh | dist
   *   pts    world polyline, metres
   *   length cutting length in metres (geometry + hooks/anchorage)
   */
  function bar(el, kind, dia, pts, length, label) {
    return {
      element: el.id, type: el.type, story: el.story, section: el.section,
      kind: kind, dia: dia, pts: pts,
      length: length === undefined ? polyLength(pts) : length,
      label: label || ''
    };
  }

  function polyLength(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += len3(sub(pts[i], pts[i - 1]));
    return L;
  }

  /** Rectangular link as a closed loop on its centreline. */
  function loopAt(origin, e2, e3, hw, hd) {
    var p = [
      add(add(origin, mul(e3, -hw)), mul(e2, -hd)),
      add(add(origin, mul(e3, hw)), mul(e2, -hd)),
      add(add(origin, mul(e3, hw)), mul(e2, hd)),
      add(add(origin, mul(e3, -hw)), mul(e2, hd))
    ];
    p.push(p[0]);
    return { pts: p, length: polyLength(p) };
  }

  /**
   * Column cage. Cover is clear cover to the *link*, so the link centreline
   * sits half a link diameter inside the cover line and the main bars sit a
   * further half link plus half bar inside that — the links wrap around the
   * bars, which is what a cage looks like on site.
   */
  function columnBars(model, el, prof, def, S, out) {
    var ax = localAxes(el.a, el.b, el.ang);
    var depth = prof.depth || 0.3, width = prof.width || 0.3;     // local 2, local 3
    var cover = ((def && def.cover) || S.colCover) / 1000;
    var dia = (def && def.barDia) || S.colBarDia;
    var tieDia = (def && def.tieDia) || S.colTieDia;
    var spacing = ((def && def.tieSpacing) || S.colTieSpacing) / 1000;
    var circular = !!(def && def.circular) || /circ/i.test(prof.family || '');

    // Link centreline, then the bar circle inside it.
    var tw = width / 2 - cover - tieDia / 2000;
    var td = depth / 2 - cover - tieDia / 2000;
    var hw = tw - tieDia / 2000 - dia / 2000;
    var hd = td - tieDia / 2000 - dia / 2000;
    if (hw <= 0 || hd <= 0) return;

    var pos = [], i;
    if (circular) {
      var n = (def && def.barsCirc) || Math.max(6, Math.round(Math.PI * 2 * hw / 0.15));
      var rr = Math.min(hw, hd);
      for (i = 0; i < n; i++) {
        var a = i / n * Math.PI * 2;
        pos.push([rr * Math.cos(a), rr * Math.sin(a)]);
      }
    } else {
      var n3 = (def && def.bars3) || 0, n2 = (def && def.bars2) || 0;
      if (!n3 || !n2) {
        var need = S.colPercent / 100 * (depth * width) * 1e6;      // mm²
        var count = Math.max(4, Math.ceil(need / barArea(dia)));
        n3 = Math.max(2, Math.round(Math.sqrt(count * width / depth)));
        n2 = Math.max(2, Math.ceil((count - 2 * n3) / 2) + 2);
      }
      for (i = 0; i < n3; i++) {
        var u = n3 === 1 ? 0 : -hw + (2 * hw) * i / (n3 - 1);
        pos.push([u, -hd]); pos.push([u, hd]);
      }
      for (i = 1; i < n2 - 1; i++) {
        var v = -hd + (2 * hd) * i / (n2 - 1);
        pos.push([-hw, v]); pos.push([hw, v]);
      }
      el._bars3 = n3; el._bars2 = n2;
    }

    var lap = lapLength(dia, S);                 // one lap per storey lift
    pos.forEach(function (p, idx) {
      var o1 = add(add(el.a, mul(ax.e3, p[0])), mul(ax.e2, p[1]));
      var o2 = add(add(el.b, mul(ax.e3, p[0])), mul(ax.e2, p[1]));
      out.push(bar(el, 'main', dia, [o1, o2], ax.len + lap, 'C' + (idx + 1)));
    });

    /* ---- Links, closer near each end where confinement is wanted ---- */
    var confineLen = S.confining ? Math.max(depth, width, 0.45) : 0;
    /* IS 13920 Cl 8.1: in the confining length the link spacing is the least
     * of a quarter of the smaller column dimension, 6 × the smallest
     * longitudinal bar and 100 mm — but need not be taken below 75 mm. */
    var closeSpacing = Math.min(spacing, Math.max(0.075,
      Math.min(Math.min(depth, width) / 4, 6 * dia / 1000, 0.1)));
    var stations = linkStations(ax.len, spacing, confineLen, closeSpacing, S.confining);

    stations.forEach(function (st) {
      var o = add(el.a, mul(sub(el.b, el.a), st.t));
      var loop = circular
        ? circleLoop(o, ax.e2, ax.e3, Math.min(tw, td), 16)
        : loopAt(o, ax.e2, ax.e3, tw, td);
      out.push(bar(el, 'tie', tieDia, loop.pts,
        linkCuttingLength(loop.length, tieDia, S), st.close ? 'T-c' : 'T'));

      // Cross-ties holding the inner bars, where the pattern has more than
      // two bars on a face.
      if (S.crossTies && !circular && el._bars3 > 2) {
        for (var k = 1; k < el._bars3 - 1; k++) {
          var uu = -hw + (2 * hw) * k / (el._bars3 - 1);
          var p1 = add(add(o, mul(ax.e3, uu)), mul(ax.e2, -td));
          var p2 = add(add(o, mul(ax.e3, uu)), mul(ax.e2, td));
          out.push(bar(el, 'tie', tieDia, [p1, p2],
            linkCuttingLength(2 * td, tieDia, S), 'X'));
        }
      }
      if (S.crossTies && !circular && el._bars2 > 2) {
        for (var m = 1; m < el._bars2 - 1; m++) {
          var vv = -hd + (2 * hd) * m / (el._bars2 - 1);
          var q1 = add(add(o, mul(ax.e3, -tw)), mul(ax.e2, vv));
          var q2 = add(add(o, mul(ax.e3, tw)), mul(ax.e2, vv));
          out.push(bar(el, 'tie', tieDia, [q1, q2],
            linkCuttingLength(2 * tw, tieDia, S), 'X'));
        }
      }
    });
  }

  /**
   * Where the links go: the stated spacing through the middle, half that
   * (capped at 100 mm) over the confining zone at each end — IS 13920
   * Cl 7.4 for columns and Cl 6.3.5 for beams.
   */
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /* ------------------------------------------------------------------ */
  /* Beam continuity                                                     */
  /* ------------------------------------------------------------------ */

  /* A bar in a continuous beam runs through the joint into the next span.
   * The next span counts its own length, so anchorage is added only where
   * the beam actually stops. Without this the take-off adds a development
   * length at every interior joint twice — on a 3.6 m span with 16 mm bars
   * that is +43% on the beam steel. Built once per take-off: a coarse
   * spatial hash of beam ends, keyed to a 100 mm cell. */
  var ENDS = null;
  var CELL = 0.1;          // hash cell, m — on plan, so a beam dropped by its
                           // insertion offset still lands in the same cell
  var JOIN_TOL = 0.075;    // two ends this close are the same joint, m
  var DROP_TOL = 1.2;      // a beam hangs at most this far below its storey, m

  function cellKey(p, dx, dy) {
    return (Math.floor(p[0] / CELL) + dx) + ',' + (Math.floor(p[1] / CELL) + dy);
  }

  /** Distance on plan, ignoring the drop from an insertion offset. */
  function planDist(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** @returns {Object} joint-cell → array of {el, p, dir} for every beam end */
  function buildEndIndex(model) {
    var idx = {};
    (model.elements || []).forEach(function (el) {
      if (!el || el.kind !== 'frame' || el.type !== 'Beam' || !el.a || !el.b) return;
      var d = norm(sub(el.b, el.a));
      [el.a, el.b].forEach(function (p) {
        var k = cellKey(p, 0, 0);
        (idx[k] || (idx[k] = [])).push({ el: el, p: p, dir: d });
      });
    });
    return idx;
  }

  /**
   * True when another beam carries on, roughly in line, past this end.
   *
   * @param {object} el    the beam being detailed
   * @param {number[]} point  the end in question
   * @param {number[]} dir    the beam's own unit direction
   * @returns {boolean}
   */
  function continuesAt(el, point, dir) {
    if (!ENDS) return false;
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        var list = ENDS[cellKey(point, dx, dy)];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (o.el === el) continue;
          if (len3(sub(o.p, point)) > JOIN_TOL) continue;
          if (Math.abs(dot(o.dir, dir)) > 0.94) return true;     // within ~20°
        }
      }
    }
    return false;
  }

  function linkStations(length, spacing, confineLen, closeSpacing, confining) {
    var out = [];
    if (!confining || confineLen <= 0 || length < confineLen * 2.5) {
      var n = Math.max(2, Math.floor(length / spacing) + 1);
      for (var i = 0; i < n; i++) out.push({ t: n === 1 ? 0.5 : i / (n - 1), close: false });
      return out;
    }
    var x = 0;
    while (x <= length + 1e-6) {
      var inEnd = x < confineLen || x > length - confineLen;
      out.push({ t: Math.min(1, x / length), close: inEnd });
      x += inEnd ? closeSpacing : spacing;
    }
    if (out[out.length - 1].t < 0.999) out.push({ t: 1, close: true });
    return out;
  }

  /** A circular link, for round columns. */
  function circleLoop(origin, e2, e3, r, sides) {
    var pts = [];
    for (var i = 0; i <= sides; i++) {
      var a = i / sides * Math.PI * 2;
      pts.push(add(add(origin, mul(e3, r * Math.cos(a))), mul(e2, r * Math.sin(a))));
    }
    return { pts: pts, length: 2 * Math.PI * r };
  }

  /**
   * Beam cage. Top and bottom bars from the percentages you set, stirrups
   * wrapping around them, closer over the confining zone at each end.
   */
  function beamBars(model, el, prof, def, S, out) {
    var ax = localAxes(el.a, el.b, el.ang);
    var depth = prof.depth || 0.45, width = prof.width || 0.23;
    var shift = cardinalShift(depth, width, el.cardinal || (el.type === 'Beam' ? 8 : 10));
    var coverTop = ((def && def.coverTop) || S.beamCover) / 1000;
    var coverBot = ((def && def.coverBottom) || S.beamCover) / 1000;
    var coverSide = S.beamSideCover / 1000;
    var dia = S.beamBarDia, stirDia = S.beamStirrupDia;
    var spacing = S.beamStirrupSpacing / 1000;

    var gross = depth * width * 1e6;                                  // mm²
    var nTop = Math.max(2, Math.ceil(S.beamTopPercent / 100 * gross / barArea(dia)));
    var nBot = Math.max(2, Math.ceil(S.beamBotPercent / 100 * gross / barArea(dia)));

    // Stirrup centreline, then the bars inside it.
    var sw = width / 2 - coverSide - stirDia / 2000;
    var sTop = depth / 2 - coverTop - stirDia / 2000 + shift[1];
    var sBot = -depth / 2 + coverBot + stirDia / 2000 + shift[1];
    var hw = sw - stirDia / 2000 - dia / 2000;
    var topV = sTop - stirDia / 2000 - dia / 2000;
    var botV = sBot + stirDia / 2000 + dia / 2000;
    if (hw <= 0 || topV <= botV) return;

    /**
     * How many bars fit across the width with a clear gap of at least one
     * diameter or 25 mm (IS 456 Cl 26.3.2), and where each one sits. Bars
     * that do not fit go into a second layer, as a detailer would do.
     */
    function layout(n, baseV, upward) {
      var gap = Math.max(dia, 25) / 1000;
      var perRow = Math.max(2, Math.floor((2 * hw + gap) / (dia / 1000 + gap)));
      var placed = [];
      var left = n, layer = 0;
      while (left > 0 && layer < 4) {
        var take = Math.min(left, perRow);
        var v = baseV + (upward ? 1 : -1) * layer * (dia / 1000 + gap);
        var spanU = take === 1 ? 0 : 2 * hw;
        for (var i = 0; i < take; i++) {
          placed.push({ u: (take === 1 ? 0 : -hw + spanU * i / (take - 1)) + shift[0], v: v, layer: layer });
        }
        left -= take; layer++;
      }
      return placed;
    }

    function straightRow(places, tag) {
      places.forEach(function (p, i) {
        var p1 = add(add(el.a, mul(ax.e3, p.u)), mul(ax.e2, p.v));
        var p2 = add(add(el.b, mul(ax.e3, p.u)), mul(ax.e2, p.v));
        out.push(bar(el, 'main', dia, [p1, p2],
          barCuttingLength(ax.len, dia, S, S.anchorage ? freeEnds : 0), tag + (i + 1)));
      });
    }

    /* Anchorage belongs at the ends where the beam stops, not at every
     * joint: a bar in a continuous run carries on into the next span. */
    var freeEnds = (continuesAt(el, el.a, ax.e1) ? 0 : 1) +
                   (continuesAt(el, el.b, ax.e1) ? 0 : 1);

    /* Top steel is detailed the way it is built: a pair (or half the
     * calculated area) runs the full length, and the rest sits over the
     * supports where the hogging moment is, curtailed into the span. */
    var through = S.beamSupportSteel ? Math.max(2, Math.ceil(nTop * 0.5)) : nTop;
    var extra = S.beamSupportSteel ? Math.max(0, nTop - through) : 0;

    straightRow(layout(through, topV, false), 'T');
    straightRow(layout(nBot, botV, true), 'B');

    if (extra > 0) {
      var reach = 0.25 * ax.len;                       // 0.25 L each end
      var anchor = anchorageLength(dia, S);
      var places = layout(extra, topV - (dia / 1000 + Math.max(dia, 25) / 1000), false);
      for (var e = 0; e < 2; e++) {
        var from = e === 0 ? el.a : el.b;
        var dir = e === 0 ? 1 : -1;
        // Over a continuous support the bar is shared with the next span,
        // so only a free end earns the anchorage.
        var tail = continuesAt(el, from, ax.e1) ? 0 : anchor;
        places.forEach(function (p, x) {
          var p1 = add(add(from, mul(ax.e3, p.u)), mul(ax.e2, p.v));
          var p2 = add(p1, mul(ax.e1, dir * reach));
          out.push(bar(el, 'main', dia, [p1, p2], reach + tail, 'Te' + (x + 1)));
        });
      }
    }

    /* ---- Side-face steel on deep beams ------------------------------ */
    // IS 456 Cl 26.5.1.3: a beam deeper than 750 mm carries 0.1% side-face
    // steel on each face, spaced no more than 300 mm or the web width.
    if (S.beamSideFace && depth * 1000 > 750) {
      var sideDia = Math.max(10, Math.min(12, dia - 4));
      var webHeight = topV - botV;
      var nSide = Math.max(1, Math.floor(webHeight * 1000 / 300));
      for (var f = 0; f < 2; f++) {
        var uSide = (f === 0 ? -hw : hw) + shift[0];
        for (var g = 1; g <= nSide; g++) {
          var vv = botV + webHeight * g / (nSide + 1);
          var s1 = add(add(el.a, mul(ax.e3, uSide)), mul(ax.e2, vv));
          var s2 = add(add(el.b, mul(ax.e3, uSide)), mul(ax.e2, vv));
          out.push(bar(el, 'main', sideDia, [s1, s2], ax.len, 'SF' + (g + f * nSide)));
        }
      }
    }

    /* IS 13920 Cl 6.3.5: over 2d at each end the spacing is the lesser of
     * d/4 and 8 × the smallest longitudinal bar, but need not go below
     * 100 mm — and never wider than the spacing asked for in the span. */
    var confineLen = S.confining ? 2 * depth : 0;
    var closeBeam = Math.min(spacing, Math.max(0.1, Math.min(depth / 4, 8 * dia / 1000)));
    var stations = linkStations(ax.len, spacing, confineLen, closeBeam, S.confining);
    var hd = (sTop - sBot) / 2;
    var mid = (sTop + sBot) / 2;

    stations.forEach(function (st) {
      var o = add(el.a, mul(sub(el.b, el.a), st.t));
      o = add(add(o, mul(ax.e3, shift[0])), mul(ax.e2, mid));
      var loop = loopAt(o, ax.e2, ax.e3, sw, hd);
      out.push(bar(el, 'tie', stirDia, loop.pts,
        linkCuttingLength(loop.length, stirDia, S), st.close ? 'S-c' : 'S'));
    });
  }

  /* ---- Slab and wall mesh -------------------------------------------- */

  /** Clip a line (point + direction, in plane coords) to a polygon. */
  function clipToPolygon(poly, p0, dir) {
    var hits = [];
    var n = poly.length;
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      var e = [b[0] - a[0], b[1] - a[1]];
      var den = dir[0] * e[1] - dir[1] * e[0];
      if (Math.abs(den) < 1e-9) continue;
      var dx = a[0] - p0[0], dy = a[1] - p0[1];
      var t = (dx * e[1] - dy * e[0]) / den;       // along dir
      var s = (dx * dir[1] - dy * dir[0]) / den;   // along the edge
      if (s >= -1e-9 && s <= 1 + 1e-9) hits.push(t);
    }
    hits.sort(function (x, y) { return x - y; });
    var segs = [];
    for (var k = 0; k + 1 < hits.length; k += 2) {
      if (hits[k + 1] - hits[k] > 0.05) segs.push([hits[k], hits[k + 1]]);
    }
    return segs;
  }

  /** A plane frame for an area element: origin plus two in-plane axes. */
  function areaFrame(pts) {
    var o = pts[0];
    var nrm = [0, 0, 0];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      nrm[0] += (a[1] - b[1]) * (a[2] + b[2]);
      nrm[1] += (a[2] - b[2]) * (a[0] + b[0]);
      nrm[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    nrm = norm(nrm);
    var up = Math.abs(nrm[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    var ex = norm(cross(up, nrm));
    var ey = cross(nrm, ex);
    var flat = pts.map(function (p) {
      var d = sub(p, o);
      return [d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2],
              d[0] * ey[0] + d[1] * ey[1] + d[2] * ey[2]];
    });
    return { o: o, ex: ex, ey: ey, n: nrm, flat: flat };
  }

  /**
   * Is this panel carried on beams along its edges? A panel framed by beams
   * is a two-way slab: its top steel sits over the supports, not across the
   * whole bay. A panel with no beams round it is a flat slab, which does
   * carry a full top mat. Judged from the beam-end index: a bounding beam
   * runs corner to corner along an edge.
   *
   * @param {number[][]} pts  panel corners in world coordinates
   * @returns {boolean}
   */
  function framedByBeams(pts) {
    if (!ENDS || !pts || pts.length < 3) return false;
    var supported = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      if (beamBetween(p, q)) supported++;
    }
    return supported >= Math.ceil(pts.length * 0.75);
  }

  /**
   * True when one beam spans from p to q (either way round). Compared on
   * plan with a vertical window, because a beam written with a cardinal
   * point or a Z offset sits below the slab corner it supports.
   */
  function beamBetween(p, q) {
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        var list = ENDS[cellKey(p, dx, dy)];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var el = list[i].el;
          if (Math.abs(el.a[2] - p[2]) > DROP_TOL) continue;
          if (planDist(el.a, p) <= JOIN_TOL && planDist(el.b, q) <= JOIN_TOL) return true;
          if (planDist(el.b, p) <= JOIN_TOL && planDist(el.a, q) <= JOIN_TOL) return true;
        }
      }
    }
    return false;
  }

  /**
   * Mesh bar for a thickness, the way it is normally detailed in India: an
   * 8 mm mat suits a 125 mm slab but would be absurd in a 600 mm transfer
   * slab, where it works out at under 20 kg/m³. The diameter you set is the
   * floor, so turning this off (or raising the slider) still wins.
   *
   * @param {number} t  section thickness, m
   * @returns {number} bar diameter, mm
   */
  function meshDiaFor(t) {
    if (t <= 0.130) return 8;
    if (t <= 0.210) return 10;
    if (t <= 0.280) return 12;
    if (t <= 0.400) return 16;
    return 20;
  }

  function meshBars(model, el, S, out, opt) {
    var f = areaFrame(el.pts);
    var spacing = opt.spacing / 1000, distSpacing = opt.distSpacing / 1000;
    var cover = opt.cover / 1000;
    var t = el.thickness || 0.15;
    var dia = S.meshAuto ? Math.max(opt.dia, meshDiaFor(t)) : opt.dia;
    var offset = t / 2 - cover - dia / 2000;
    if (offset <= 0) offset = Math.max(0.005, t / 2 - 0.01);

    // A floor panel's points lie on the storey plane, which is the slab TOP
    // — the concrete hangs below it. Walls are centred on their plane. Shift
    // the mesh so the bars end up inside the concrete either way.
    var planeShift = opt.floorLike ? -t / 2 : 0;

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    f.flat.forEach(function (p) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });

    var faces = (opt.bothFaces ? [offset, -offset] : [offset]).map(function (o) {
      return o + planeShift * (f.n[2] >= 0 ? 1 : -1);
    });
    /* End allowance per bar. A slab bar is not lapped at its supports: it
     * extends past the support centre and turns down, which IS 456
     * Cl 26.2.3.3 covers with Ld/3 (never less than a 10d hook). A wall bar
     * is vertical and does lap at every floor, so it keeps the full lap. */
    var endAllow = opt.floorLike
      ? Math.max(anchorageLength(dia, S) / 3, 10 * dia / 1000)
      : lapLength(dia, S);
    var anchor = S.anchorage ? 2 * endAllow : 0;

    /* A two-way slab on beams carries its top steel over the supports, not
     * across the bay. Counting a full top mat everywhere overstates the slab
     * steel by roughly 40%. Flat slabs — no beams round the panel — keep the
     * full mat, which is how they are built. */
    var partialTop = opt.floorLike && S.slabTopOverSupports && framedByBeams(el.pts);
    var topFace = faces.length > 1
      ? (f.n[2] >= 0 ? Math.max(faces[0], faces[1]) : Math.min(faces[0], faces[1]))
      : null;
    var TOP_REACH = 0.3;              // of the span, each side of a support

    function run(along, spacingUse, tag) {
      // along 0 → bars run in +ex, stepping in ey; along 1 → the other way.
      var lo = along ? minX : minY, hi = along ? maxX : maxY;
      var steps = Math.max(1, Math.floor((hi - lo) / spacingUse));
      for (var i = 0; i <= steps; i++) {
        var at = lo + (hi - lo) * (steps ? i / steps : 0.5);
        var p0 = along ? [at, minY - 1] : [minX - 1, at];
        var dir = along ? [0, 1] : [1, 0];
        var segs = clipToPolygon(f.flat, p0, dir);
        for (var s = 0; s < segs.length; s++) {
          for (var fi = 0; fi < faces.length; fi++) {
            var z = faces[fi];
            var t0 = segs[s][0], t1 = segs[s][1];
            // Top steel of a beam-supported panel: a length at each end
            // rather than one bar across the bay.
            var cuts = (partialTop && z === topFace)
              ? [[t0, t0 + (t1 - t0) * TOP_REACH], [t1 - (t1 - t0) * TOP_REACH, t1]]
              : [[t0, t1]];
            for (var c = 0; c < cuts.length; c++) {
              var a2 = [p0[0] + dir[0] * cuts[c][0], p0[1] + dir[1] * cuts[c][0]];
              var b2 = [p0[0] + dir[0] * cuts[c][1], p0[1] + dir[1] * cuts[c][1]];
              var A = worldOf(f, a2, z), B = worldOf(f, b2, z);
              out.push(bar(el, tag, dia, [A, B], len3(sub(B, A)) + anchor, tag));
            }
          }
        }
      }
    }
    run(0, spacing, 'mesh');
    run(1, opt.oneWay ? distSpacing : spacing, opt.oneWay ? 'dist' : 'mesh');
  }

  function worldOf(f, p2, off) {
    return [
      f.o[0] + f.ex[0] * p2[0] + f.ey[0] * p2[1] + f.n[0] * off,
      f.o[1] + f.ex[1] * p2[0] + f.ey[1] * p2[1] + f.n[1] * off,
      f.o[2] + f.ex[2] * p2[0] + f.ey[2] * p2[1] + f.n[2] * off
    ];
  }

  /** "M15G25WAYONE" → 150 mm, M25, one-way. Returns {} when it doesn't match. */
  function readSlabName(name) {
    var out = {};
    var s = String(name || '').toUpperCase();
    var m = /M(\d+(?:\.\d+)?)G(\d+)/.exec(s);
    if (m) {
      out.thicknessMm = parseFloat(m[1]) * 10;      // M15 → 150 mm
      out.grade = 'M' + m[2];
    }
    if (/WAYONE/.test(s)) out.oneWay = true;
    else if (/WAYBOTH/.test(s)) out.oneWay = false;
    return out;
  }

  /* ================================================================== */
  /* Build                                                               */
  /* ================================================================== */

  /* Rolled-steel families: a cage never goes inside one of these. Used only
   * when the file does not say what the material is. */
  var STEEL_FAMILIES = { i: 1, channel: 1, angle: 1, doubleangle: 1, pipe: 1 };
  var STEEL_NAMES = /^(ismb|ismc|isa|isjb|islb|ismc|ub|uc|ue|hea|heb|ipe|shs|rhs|chs|w\d)/i;

  /** Material TYPE as ETABS writes it ("Concrete", "Steel", "Rebar"). */
  function materialType(model, name) {
    var m = name && model.materials && model.materials[name];
    return m && m.type ? String(m.type).toLowerCase() : '';
  }

  /**
   * True when a member is steel (or aluminium / cold-formed) and so carries
   * no reinforcement. The material record is the authority; when the file
   * omits it, the section family and then the section name are the fallback,
   * because an I, channel, angle or pipe is never a concrete member.
   *
   * @param {object} model
   * @param {object} el    frame element
   * @param {object} prof  built section profile (may be null)
   * @returns {boolean}
   */
  function isSteelFrame(model, el, prof) {
    var sec = model.frameSections && model.frameSections[el.section];
    var t = materialType(model, sec && sec.material);
    if (t) {
      return t.indexOf('steel') >= 0 || t.indexOf('alum') >= 0 ||
             t.indexOf('cold') >= 0 || t.indexOf('timber') >= 0 || t.indexOf('wood') >= 0;
    }
    if (prof && STEEL_FAMILIES[prof.family]) return true;
    return STEEL_NAMES.test(String(el.section || '').replace(/[\s_-]/g, ''));
  }

  /** True when a shell is steel plate or decking rather than concrete. */
  function isSteelArea(model, el) {
    var sh = model.shellSections && model.shellSections[el.section];
    var t = materialType(model, sh && sh.material);
    return t.indexOf('steel') >= 0 || t.indexOf('alum') >= 0 || t.indexOf('cold') >= 0;
  }

  function detailable(el) {
    if (el.kind === 'frame') return el.type === 'Column' || el.type === 'Beam' || el.type === 'Brace';
    if (el.kind === 'area') return el.type !== 'Opening';
    return false;
  }

  /**
   * @param {object} model
   * @param {Array<number>|null} ids  elements to detail (null = all detailable)
   * @param {object} settings
   * @returns {object} result
   */
  function build(model, ids, settings) {
    var S = settings || load();
    var els = model.elements;
    var list = ids ? ids.map(function (i) { return els[i]; }).filter(Boolean) : els;
    var bars = [];
    var skipped = { noSection: 0, type: 0, steel: 0 };
    ENDS = buildEndIndex(model);

    list.forEach(function (el) {
      if (!el || !detailable(el)) return;
      if (el.kind === 'frame') {
        var isCol = el.type === 'Column' || el.type === 'Brace';
        if (isCol && !S.columns) return;
        if (!isCol && !S.beams) return;
        var prof = model.sectionProfiles && model.sectionProfiles[el.section];
        if (!prof && global.ETABSSections) {
          prof = (model.sectionProfiles = model.sectionProfiles || {})[el.section] =
            global.ETABSSections.build(model.frameSections[el.section] || { name: el.section });
        }
        if (!prof) { skipped.noSection++; return; }
        if (isSteelFrame(model, el, prof)) { skipped.steel++; return; }
        var def = (model.rebarDefs || {})[el.section];
        if (isCol) columnBars(model, el, prof, def, S, bars);
        else beamBars(model, el, prof, def, S, bars);
      } else {
        var wall = el.type === 'Wall';
        if (wall && !S.walls) return;
        if (!wall && !S.slabs) return;
        if (isSteelArea(model, el)) { skipped.steel++; return; }
        var nameInfo = readSlabName(el.section);
        meshBars(model, el, S, bars, wall ? {
          dia: S.wallBarDia, spacing: S.wallSpacing, distSpacing: S.wallSpacing,
          cover: S.wallCover, bothFaces: S.wallBothFaces, oneWay: false, floorLike: false
        } : {
          dia: S.slabBarDia, spacing: S.slabSpacing, distSpacing: S.slabDistSpacing,
          cover: S.slabCover, bothFaces: S.slabBothFaces, oneWay: !!nameInfo.oneWay,
          floorLike: Math.abs(areaFrame(el.pts).n[2]) > 0.7
        });
      }
    });

    ENDS = null;
    return summarise(model, bars, S, skipped);
  }

  /* ================================================================== */
  /* Weights, ratios and the schedule                                    */
  /* ================================================================== */

  var RATIO_BANDS = {
    Column: [120, 260], Beam: [90, 200], Slab: [55, 120], Wall: [70, 160], Ramp: [55, 120], Brace: [90, 220]
  };

  function summarise(model, bars, S, skipped) {
    var byElement = {}, byDia = {}, byFloor = {}, byType = {};
    var netKg = 0, lapKg = 0;

    bars.forEach(function (b) {
      var w = kgPerM(b.dia);
      var kg = b.length * w;
      netKg += kg;

      // Laps: a bar longer than a stock length needs one lap per extra length.
      var laps = Math.max(0, Math.ceil(b.length / S.stockLength) - 1);
      var lapExtra = laps * lapLength(b.dia, S) * w;
      lapKg += lapExtra;
      b.kg = kg + lapExtra;
      b.laps = laps;

      var e = byElement[b.element] || (byElement[b.element] = { id: b.element, kg: 0, bars: 0, type: b.type, story: b.story, section: b.section });
      e.kg += b.kg; e.bars++;

      var d = byDia[b.dia] || (byDia[b.dia] = { dia: b.dia, lengthM: 0, kg: 0, count: 0 });
      d.lengthM += b.length; d.kg += b.kg; d.count++;

      var f = byFloor[b.story || '—'] || (byFloor[b.story || '—'] = { name: b.story || '—', kg: 0, bars: 0 });
      f.kg += b.kg; f.bars++;

      var t = byType[b.type] || (byType[b.type] = { type: b.type, kg: 0, volume: 0 });
      t.kg += b.kg;
    });

    // Concrete volume per element, for the kg/m³ ratio check.
    var flagged = [];
    Object.keys(byElement).forEach(function (id) {
      var el = model.elements[id];
      var e = byElement[id];
      e.volume = el ? (el.volume || 0) : 0;
      e.ratio = e.volume > 0 ? e.kg / e.volume : 0;
      if (byType[e.type]) byType[e.type].volume += e.volume;
      var band = RATIO_BANDS[e.type];
      if (band && e.volume > 0.02) {
        if (e.ratio < band[0]) { e.flag = 'low'; flagged.push(e); }
        else if (e.ratio > band[1]) { e.flag = 'high'; flagged.push(e); }
      }
    });

    var wastageKg = netKg * (S.wastagePercent / 100);
    var accessoriesKg = netKg * (S.accessoriesPercent / 100);
    var grossKg = netKg + lapKg + wastageKg + accessoriesKg;
    var concreteVol = Object.keys(byType).reduce(function (s, k) { return s + byType[k].volume; }, 0);

    return {
      settings: S,
      bars: bars,
      byElement: byElement,
      byDia: Object.keys(byDia).map(function (k) { return byDia[k]; })
        .sort(function (a, b) { return a.dia - b.dia; }),
      byFloor: Object.keys(byFloor).map(function (k) { return byFloor[k]; })
        .sort(function (a, b) { return b.kg - a.kg; }),
      byType: Object.keys(byType).map(function (k) { return byType[k]; })
        .sort(function (a, b) { return b.kg - a.kg; }),
      flagged: flagged.sort(function (a, b) { return b.ratio - a.ratio; }),
      bbs: schedule(bars, S),
      skipped: skipped,
      totals: {
        netKg: netKg, lapKg: lapKg, wastageKg: wastageKg, accessoriesKg: accessoriesKg,
        grossKg: grossKg, tonnes: grossKg / 1000,
        concreteVol: concreteVol,
        kgPerM3: concreteVol > 0 ? (netKg + lapKg) / concreteVol : 0,
        barCount: bars.length,
        grade: S.grade
      }
    };
  }

  /* Shape codes follow the usual Indian BBS convention closely enough to
   * read: 00 straight, 21 a closed rectangular link. */
  /**
   * Shape of a bar for the schedule. The codes follow the numbering used on
   * Indian bar bending schedules (IS 2502 / SP 34 practice): a straight bar
   * is 00, a bar with one bend 41, a cranked bar 51, and a closed
   * rectangular link 21. `sketch` names the drawing the panel renders.
   */
  var SHAPES = {
    straight: { code: '00', name: 'Straight', sketch: 'straight' },
    lbar:     { code: '41', name: 'One bend (L)', sketch: 'lbar' },
    crank:    { code: '51', name: 'Cranked', sketch: 'crank' },
    link:     { code: '21', name: 'Closed link', sketch: 'link' },
    tie:      { code: '26', name: 'Cross-tie', sketch: 'crosstie' }
  };

  function shapeOf(b) {
    if (b.kind !== 'tie') return SHAPES.straight;
    return b.label === 'X' ? SHAPES.tie : SHAPES.link;
  }

  /** Group identical bars into schedule rows with a mark each. */
  function schedule(bars, S) {
    var rows = {};
    bars.forEach(function (b) {
      var cut = Math.round(b.length * 1000) / 1000;
      var key = b.type + '|' + b.section + '|' + b.kind + '|' + (b.label || '') +
        '|' + b.dia + '|' + cut.toFixed(2);
      var shp = shapeOf(b);
      var r = rows[key] || (rows[key] = {
        member: b.type, section: b.section, kind: b.kind, dia: b.dia,
        shape: shp.code, shapeName: shp.name, sketch: shp.sketch,
        cutting: cut, count: 0, kg: 0, storeys: {}
      });
      r.count++;
      r.kg += b.kg;
      r.storeys[b.story || '—'] = 1;
    });
    return Object.keys(rows).map(function (k, i) {
      var r = rows[k];
      r.mark = (r.member || 'X').charAt(0).toUpperCase() + (r.kind === 'tie' ? 'L' : 'M') + (i + 1);
      r.storeyCount = Object.keys(r.storeys).length;
      delete r.storeys;
      return r;
    }).sort(function (a, b) {
      return a.member === b.member ? a.dia - b.dia : (a.member < b.member ? -1 : 1);
    });
  }

  /* ================================================================== */
  /* Cross-section, for the 2-D detail drawing                           */
  /* ================================================================== */

  /**
   * Bar positions in the section plane of one member, in metres, with the
   * section outline — everything the drawer needs to draw a real section.
   */
  function crossSection(model, el, settings) {
    var S = settings || load();
    if (!el || el.kind !== 'frame') return null;
    var prof = model.sectionProfiles && model.sectionProfiles[el.section];
    if (!prof && global.ETABSSections) {
      prof = global.ETABSSections.build(model.frameSections[el.section] || { name: el.section });
    }
    if (!prof) return null;

    var def = (model.rebarDefs || {})[el.section];
    var isCol = el.type === 'Column' || el.type === 'Brace';
    var depth = prof.depth, width = prof.width;
    var out = { outline: prof.outline, depth: depth, width: width, bars: [], crossTies: [], shift: [0, 0] };

    if (isCol) {
      var cover = ((def && def.cover) || S.colCover) / 1000;
      var dia = (def && def.barDia) || S.colBarDia;
      var tieDia = (def && def.tieDia) || S.colTieDia;
      var n3 = (def && def.bars3) || 3, n2 = (def && def.bars2) || 2;
      var tw = width / 2 - cover - tieDia / 2000;
      var td = depth / 2 - cover - tieDia / 2000;
      var hw = tw - tieDia / 2000 - dia / 2000;
      var hd = td - tieDia / 2000 - dia / 2000;
      for (var i = 0; i < n3; i++) {
        var u = n3 === 1 ? 0 : -hw + 2 * hw * i / (n3 - 1);
        out.bars.push({ u: u, v: -hd, dia: dia }, { u: u, v: hd, dia: dia });
      }
      for (var j = 1; j < n2 - 1; j++) {
        var v = -hd + 2 * hd * j / (n2 - 1);
        out.bars.push({ u: -hw, v: v, dia: dia }, { u: hw, v: v, dia: dia });
      }
      if (S.crossTies && n3 > 2) {
        for (var k = 1; k < n3 - 1; k++) {
          var uu = -hw + 2 * hw * k / (n3 - 1);
          out.crossTies.push({ x1: uu, y1: -td, x2: uu, y2: td });
        }
      }
      if (S.crossTies && n2 > 2) {
        for (var m = 1; m < n2 - 1; m++) {
          var vv = -hd + 2 * hd * m / (n2 - 1);
          out.crossTies.push({ x1: -tw, y1: vv, x2: tw, y2: vv });
        }
      }
      out.tie = { hw: tw, hd: td, dia: tieDia, spacing: (def && def.tieSpacing) || S.colTieSpacing };
      out.cover = cover * 1000;
      out.source = def && def.bars3 ? 'file' : 'rule';
      out.pattern = def && def.pattern;
      out.barCount = out.bars.length;
      out.steelPercent = out.bars.length * barArea(dia) / (depth * width * 1e6) * 100;
      out.confining = S.confining ? Math.min(((def && def.tieSpacing) || S.colTieSpacing) / 2, 100) : null;
    } else {
      var cT = ((def && def.coverTop) || S.beamCover) / 1000;
      var cB = ((def && def.coverBottom) || S.beamCover) / 1000;
      var cS = S.beamSideCover / 1000;
      var bd = S.beamBarDia, sd = S.beamStirrupDia;
      var gross = depth * width * 1e6;
      var nTop = Math.max(2, Math.ceil(S.beamTopPercent / 100 * gross / barArea(bd)));
      var nBot = Math.max(2, Math.ceil(S.beamBotPercent / 100 * gross / barArea(bd)));
      var sw = width / 2 - cS - sd / 2000;
      var sTop = depth / 2 - cT - sd / 2000;
      var sBot = -depth / 2 + cB + sd / 2000;
      var bhw = sw - sd / 2000 - bd / 2000;
      var topV = sTop - sd / 2000 - bd / 2000;
      var botV = sBot + sd / 2000 + bd / 2000;
      [[nTop, topV], [nBot, botV]].forEach(function (row) {
        for (var q = 0; q < row[0]; q++) {
          var uq = row[0] === 1 ? 0 : -bhw + 2 * bhw * q / (row[0] - 1);
          out.bars.push({ u: uq, v: row[1], dia: bd });
        }
      });
      out.tie = { hw: sw, hd: (sTop - sBot) / 2, mid: (sTop + sBot) / 2, u: 0, dia: sd, spacing: S.beamStirrupSpacing };
      out.cover = cT * 1000;
      out.sideCover = cS * 1000;
      out.source = 'rule';
      out.barCount = nTop + nBot;
      out.steelPercent = (nTop + nBot) * barArea(bd) / gross * 100;
      out.confining = S.confining ? Math.min(S.beamStirrupSpacing / 2, 100) : null;
    }
    out.hooks = S.hooks;
    return out;
  }

  /* ================================================================== */
  /* Code screening — IS 456 and IS 13920                                */
  /* ================================================================== */

  /**
   * Checks the drawn reinforcement against the limits every Indian RCC
   * member has to meet. This is screening of the *detailing assumptions*,
   * not a design check: it says whether the bars drawn would be allowed,
   * not whether they are enough for the forces.
   */
  function checks(model, result) {
    var S = result.settings;
    var out = [];
    var seenSection = {};
    var barSize = S.beamBarDia;

    model.elements.forEach(function (el) {
      if (!el || el.kind !== 'frame') return;
      var isCol = el.type === 'Column' || el.type === 'Brace';
      if (!result.byElement[el.id]) return;
      var key = el.type + '|' + el.section;
      if (seenSection[key]) return;                // one finding per section
      seenSection[key] = 1;

      var cs = crossSection(model, el, S);
      if (!cs) return;
      var gross = cs.depth * cs.width * 1e6;
      var steelPct = cs.steelPercent || 0;
      var dEff = (cs.depth - (cs.cover || 40) / 1000) * 1000;       // mm

      if (isCol) {
        // IS 456 Cl 26.5.3.1 — longitudinal steel 0.8 % to 6 % of the gross area.
        if (steelPct < 0.8) {
          out.push(finding('low-steel', 'warn', el, cs,
            'Column steel is ' + steelPct.toFixed(2) + '% of the section. IS 456 Cl 26.5.3.1 asks for at least 0.8%.'));
        } else if (steelPct > 6) {
          out.push(finding('high-steel', 'critical', el, cs,
            'Column steel is ' + steelPct.toFixed(2) + '%. IS 456 Cl 26.5.3.1 caps it at 6%, and 4% is the practical limit where bars lap.'));
        }
        // IS 456 Cl 26.5.3.2 — tie spacing ≤ least dimension, 16× main bar, 300 mm.
        var limit = Math.min(Math.min(cs.depth, cs.width) * 1000, 16 * (cs.bars[0] ? cs.bars[0].dia : 20), 300);
        if (cs.tie && cs.tie.spacing > limit + 1) {
          out.push(finding('tie-spacing', 'critical', el, cs,
            'Ties at ' + Math.round(cs.tie.spacing) + ' mm exceed the IS 456 Cl 26.5.3.2 limit of ' +
            Math.round(limit) + ' mm (least dimension, 16 × bar, or 300 mm — whichever is least).'));
        }
      } else {
        // IS 456 Cl 26.5.1.1 — minimum tension steel 0.85 bd / fy.
        var fy = FY[S.grade] || 500;
        var minPct = 0.85 / fy * 100 * (dEff / (cs.depth * 1000));
        if (S.beamBotPercent < minPct) {
          out.push(finding('low-steel', 'warn', el, cs,
            'Bottom steel of ' + S.beamBotPercent + '% is below the IS 456 Cl 26.5.1.1 minimum of about ' +
            minPct.toFixed(2) + '% for ' + S.grade + '.'));
        }
        if (steelPct > 4) {
          out.push(finding('high-steel', 'warn', el, cs,
            'Beam steel totals ' + steelPct.toFixed(2) + '%; IS 456 Cl 26.5.1.1(b) caps tension steel at 4%.'));
        }
        // IS 456 Cl 26.5.1.5 — stirrup spacing ≤ 0.75 d and 300 mm.
        var sLimit = Math.min(0.75 * dEff, 300);
        if (cs.tie && cs.tie.spacing > sLimit + 1) {
          out.push(finding('tie-spacing', 'critical', el, cs,
            'Stirrups at ' + Math.round(cs.tie.spacing) + ' mm exceed the IS 456 Cl 26.5.1.5 limit of ' +
            Math.round(sLimit) + ' mm (0.75 d, or 300 mm).'));
        }
      }

      // Congestion: clear gap between bars in a row, IS 456 Cl 26.3.2 —
      // at least the bar diameter and (aggregate + 5 mm), taken as 25 mm.
      var row = cs.bars.filter(function (b) { return Math.abs(b.v - cs.bars[0].v) < 1e-6; });
      if (row.length > 1) {
        var dia = row[0].dia;
        var gap = Math.abs(row[1].u - row[0].u) * 1000 - dia;
        var need = Math.max(dia, 25);
        if (gap < need) {
          out.push(finding('congested', 'warn', el, cs,
            row.length + ' bars of ' + dia + ' mm leave a ' + Math.round(gap) +
            ' mm gap; IS 456 Cl 26.3.2 wants at least ' + Math.round(need) +
            ' mm so the concrete can pass between them.'));
        }
      }
    });

    return out;
  }

  function finding(id, severity, el, cs, detail) {
    return {
      id: id, severity: severity, section: el.section, type: el.type,
      title: el.type + ' ' + el.section,
      detail: detail, elementId: el.id
    };
  }

  global.ETABSRebar = {
    DEFAULTS: DEFAULTS,
    BAR_SIZES: BAR_SIZES,
    SHAPES: SHAPES,
    load: load, save: save, reset: reset,
    lapDescription: lapDescription,
    build: build,
    crossSection: crossSection,
    checks: checks,
    developmentLengthFactor: developmentLengthFactor,
    lapLength: lapLength,
    readSlabName: readSlabName,
    kgPerM: kgPerM,
    localAxes: localAxes,
    detailable: detailable
  };
})(window);
