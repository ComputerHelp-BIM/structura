/**
 * codecheck.js — IS 1893 (Part 1) : 2016 geometry screening.
 * =================================================================
 * These are *screening* checks run on geometry alone. Geometry can settle
 * some of the Table 6 irregularities outright (plan setback, re-entrant
 * corner, in-plane discontinuity); others — torsion, mass, strength — cannot
 * be concluded without an analysis, and this module says so rather than
 * producing a number that looks authoritative and is not.
 *
 * Every finding carries `basis`, stating exactly what was measured, and
 * `limits`, stating what the result does not prove. That pairing is the
 * point: a screening tool that hides its assumptions is worse than none.
 *
 * Namespace: window.ETABSCode
 */
(function (global) {
  'use strict';

  var SETBACK_RATIO = 1.25;        // Table 6(a) — vertical geometric irregularity
  var REENTRANT_RATIO = 0.15;      // Table 5(a) — re-entrant corner
  var SOFT_RATIO = 0.70;           // Table 6(a) — stiffness, storey vs storey above
  var SOFT_AVG_RATIO = 0.80;       // Table 6(a) — storey vs average of three above
  var HEIGHT_RATIO = 1.25;         // taller storey as a soft-storey driver
  var PLAN_TOL = 0.05;             // 50 mm alignment tolerance

  function key2(x, y) { return Math.round(x / PLAN_TOL) + ',' + Math.round(y / PLAN_TOL); }

  /* ------------------------------------------------------------------ */
  /* Per-storey measurements                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Gather, for every storey, the plan extent of the lateral system, the
   * vertical cross-sectional area, the storey height and the slab footprint.
   */
  function storeyMetrics(model) {
    var scale = model.meta.units.lengthToM;
    var rows = model.stories.map(function (s) {
      return {
        index: s.index,
        name: s.name,
        elev: s.elev * scale,
        height: s.height * scale,
        minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
        verticalArea: 0,
        columnArea: 0,
        wallArea: 0,
        braceCount: 0,
        slabBoxes: [],
        lateralNodes: {},
        ids: []
      };
    });

    model.elements.forEach(function (e) {
      var r = rows[e.storyIndex];
      if (!r) return;

      if (e.kind === 'frame' && (e.type === 'Column' || e.type === 'Brace')) {
        var pts = [e.a, e.b];
        pts.forEach(function (p) {
          if (p[0] < r.minX) r.minX = p[0];
          if (p[0] > r.maxX) r.maxX = p[0];
          if (p[1] < r.minY) r.minY = p[1];
          if (p[1] > r.maxY) r.maxY = p[1];
        });
        var area = e.sectionArea || 0;
        r.verticalArea += area;
        if (e.type === 'Column') r.columnArea += area;
        else {
          r.braceCount++;
          r.lateralNodes[key2(e.a[0], e.a[1])] = true;
          r.ids.push(e.id);
        }
      } else if (e.kind === 'area' && e.type === 'Wall') {
        var t = e.thickness || 0.2;
        var span = Math.max(
          Math.hypot(e.pts[1][0] - e.pts[0][0], e.pts[1][1] - e.pts[0][1]),
          Math.hypot(e.pts[2] ? e.pts[2][0] - e.pts[1][0] : 0, e.pts[2] ? e.pts[2][1] - e.pts[1][1] : 0)
        );
        var wa = t * span;
        r.verticalArea += wa;
        r.wallArea += wa;
        r.ids.push(e.id);
        e.pts.forEach(function (p) {
          r.lateralNodes[key2(p[0], p[1])] = true;
          if (p[0] < r.minX) r.minX = p[0];
          if (p[0] > r.maxX) r.maxX = p[0];
          if (p[1] < r.minY) r.minY = p[1];
          if (p[1] > r.maxY) r.maxY = p[1];
        });
      } else if (e.kind === 'area' && (e.type === 'Slab' || e.type === 'Ramp')) {
        var bx = [Infinity, Infinity, -Infinity, -Infinity];
        e.pts.forEach(function (p) {
          bx[0] = Math.min(bx[0], p[0]); bx[1] = Math.min(bx[1], p[1]);
          bx[2] = Math.max(bx[2], p[0]); bx[3] = Math.max(bx[3], p[1]);
        });
        r.slabBoxes.push(bx);
      }
    });

    rows.forEach(function (r) {
      r.width = isFinite(r.minX) ? r.maxX - r.minX : 0;
      r.depth = isFinite(r.minY) ? r.maxY - r.minY : 0;
    });
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /* 1 — Vertical geometric irregularity (setback)                       */
  /* ------------------------------------------------------------------ */

  function checkSetback(model, rows, findings) {
    var flagged = [];
    for (var i = 1; i < rows.length - 1; i++) {
      var below = rows[i], above = rows[i + 1];
      if (!below.width || !above.width) continue;
      var rx = below.width / above.width;
      var ry = below.depth / (above.depth || 1);
      var worst = Math.max(rx, ry, 1 / Math.max(rx, 1e-6), 1 / Math.max(ry, 1e-6));
      if (worst > SETBACK_RATIO) {
        flagged.push({
          from: above.name, to: below.name,
          ratio: worst,
          text: above.name + ' → ' + below.name + ': plan extent changes by ' +
                Math.round((worst - 1) * 100) + '%'
        });
      }
    }
    if (!flagged.length) return;
    findings.push({
      id: 'is1893-setback',
      severity: flagged.some(function (f) { return f.ratio > 1.5; }) ? 'critical' : 'warn',
      clause: 'IS 1893:2016 Cl. 7.1, Table 6(a)',
      title: 'Vertical geometric irregularity (setback)',
      detail: flagged.length + ' storey transition(s) change the plan extent of the vertical ' +
        'system by more than 25%. ' + flagged.slice(0, 4).map(function (f) { return f.text; }).join('; ') +
        (flagged.length > 4 ? '; …' : '') + '.',
      basis: 'Bounding plan extent of columns, braces and walls at each storey, compared storey to storey.',
      limits: 'A setback is not automatically a defect — it is a trigger for dynamic analysis under Cl. 7.7.2, ' +
        'not a failure. Confirm against the actual lateral system layout.',
      ids: []
    });
  }

  /* ------------------------------------------------------------------ */
  /* 2 — Re-entrant corners                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Rasterise the slab footprint of the most-populated storey and measure the
   * largest notch in each direction. A grid is used rather than a polygon
   * boolean because slabs arrive as independent panels, not as one outline.
   */
  function checkReentrant(model, rows, findings) {
    var best = null;
    rows.forEach(function (r) { if (!best || r.slabBoxes.length > best.slabBoxes.length) best = r; });
    if (!best || best.slabBoxes.length < 2) return;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    best.slabBoxes.forEach(function (b) {
      minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]);
      maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
    });
    var W = maxX - minX, D = maxY - minY;
    if (W <= 0 || D <= 0) return;

    var N = 48;
    var cell = new Uint8Array(N * N);
    best.slabBoxes.forEach(function (b) {
      var i0 = Math.max(0, Math.floor((b[0] - minX) / W * N));
      var i1 = Math.min(N - 1, Math.ceil((b[2] - minX) / W * N) - 1);
      var j0 = Math.max(0, Math.floor((b[1] - minY) / D * N));
      var j1 = Math.min(N - 1, Math.ceil((b[3] - minY) / D * N) - 1);
      for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) cell[j * N + i] = 1;
    });

    // The largest empty run touching an edge is the projection depth.
    var projX = 0, projY = 0, i2, j2, run;
    for (j2 = 0; j2 < N; j2++) {
      run = 0;
      for (i2 = 0; i2 < N; i2++) { if (!cell[j2 * N + i2]) run++; else break; }
      projX = Math.max(projX, run);
      run = 0;
      for (i2 = N - 1; i2 >= 0; i2--) { if (!cell[j2 * N + i2]) run++; else break; }
      projX = Math.max(projX, run);
    }
    for (i2 = 0; i2 < N; i2++) {
      run = 0;
      for (j2 = 0; j2 < N; j2++) { if (!cell[j2 * N + i2]) run++; else break; }
      projY = Math.max(projY, run);
      run = 0;
      for (j2 = N - 1; j2 >= 0; j2--) { if (!cell[j2 * N + i2]) run++; else break; }
      projY = Math.max(projY, run);
    }

    var fx = projX / N, fy = projY / N;
    if (fx <= REENTRANT_RATIO && fy <= REENTRANT_RATIO) return;

    findings.push({
      id: 'is1893-reentrant',
      severity: Math.max(fx, fy) > 0.30 ? 'critical' : 'warn',
      clause: 'IS 1893:2016 Cl. 7.1, Table 5(a)',
      title: 'Re-entrant corner in plan',
      detail: 'On ' + best.name + ' the floor plate projects ' +
        Math.round(Math.max(fx, fy) * 100) + '% of the overall plan dimension beyond the notch ' +
        '(limit 15%). Measured on the ' + (fx > fy ? 'X' : 'Y') + ' direction over a ' +
        W.toFixed(1) + ' × ' + D.toFixed(1) + ' m footprint.',
      basis: 'Slab panel extents rasterised on a 48 × 48 grid over the storey footprint; the deepest ' +
        'empty run reaching an edge is taken as the projection.',
      limits: 'L, T and U-shaped plates are legitimate and common. This flags the shape so the ' +
        'diaphragm and its collectors get checked, and it cannot see an architectural slab edge ' +
        'that the structural model omitted.',
      ids: []
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3 — Stiffness (soft storey) proxy                                  */
  /* ------------------------------------------------------------------ */

  function checkSoftStorey(model, rows, findings) {
    var live = rows.filter(function (r) { return r.index > 0 && r.verticalArea > 0; });
    if (live.length < 3) return;

    var flagged = [];
    for (var i = 0; i < live.length - 1; i++) {
      var cur = live[i], up = live[i + 1];
      var ratio = cur.verticalArea / (up.verticalArea || 1);
      var above3 = live.slice(i + 1, i + 4);
      var avg = above3.reduce(function (a, r) { return a + r.verticalArea; }, 0) / (above3.length || 1);
      var avgRatio = cur.verticalArea / (avg || 1);

      var tall = up.height > 0 && cur.height / up.height > HEIGHT_RATIO;
      if (ratio < SOFT_RATIO || (above3.length === 3 && avgRatio < SOFT_AVG_RATIO) || tall) {
        flagged.push({
          name: cur.name,
          ratio: ratio,
          avgRatio: avgRatio,
          tall: tall,
          height: cur.height,
          ids: cur.ids
        });
      }
    }
    if (!flagged.length) return;

    var worst = flagged.reduce(function (a, b) { return a.ratio < b.ratio ? a : b; });
    findings.push({
      id: 'is1893-soft',
      severity: worst.ratio < 0.6 ? 'critical' : 'warn',
      clause: 'IS 1893:2016 Cl. 7.1, Table 6(a) — stiffness irregularity',
      title: 'Possible soft storey',
      detail: flagged.length + ' storey(s) flagged. ' + flagged.slice(0, 4).map(function (f) {
        if (f.tall && f.ratio >= SOFT_RATIO) {
          return f.name + ' is ' + f.height.toFixed(2) + ' m tall, more than 125% of the storey above';
        }
        return f.name + ' has ' + Math.round(f.ratio * 100) + '% of the vertical-element area of the storey above';
      }).join('; ') + (flagged.length > 4 ? '; …' : '') + '.',
      basis: 'Sum of column cross-sectional area plus wall thickness × length at each storey, and storey ' +
        'height ratios. Area is used as a stand-in for lateral stiffness.',
      limits: 'This is a proxy, not a stiffness calculation. True storey stiffness depends on member ' +
        'height cubed, end fixity, infill and cracked-section properties — run the analysis and compare ' +
        'storey shear against drift before concluding anything.',
      ids: flagged.reduce(function (a, f) { return a.concat(f.ids); }, [])
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4 — In-plane discontinuity of the lateral system                   */
  /* ------------------------------------------------------------------ */

  function checkInPlane(model, rows, findings) {
    var offenders = [];
    for (var i = 2; i < rows.length; i++) {
      var cur = rows[i], below = rows[i - 1];
      var curKeys = Object.keys(cur.lateralNodes);
      if (!curKeys.length || !Object.keys(below.lateralNodes).length) continue;
      var missing = curKeys.filter(function (k) { return !below.lateralNodes[k]; });
      if (missing.length > curKeys.length * 0.5) {
        offenders.push({ name: cur.name, missing: missing.length, total: curKeys.length, ids: cur.ids });
      }
    }
    if (!offenders.length) return;

    findings.push({
      id: 'is1893-inplane',
      severity: 'critical',
      clause: 'IS 1893:2016 Cl. 7.1, Table 6(d) — in-plane discontinuity',
      title: 'Lateral system does not line up storey to storey',
      detail: offenders.length + ' storey(s) have shear walls or braces that do not continue down to the ' +
        'storey below: ' + offenders.slice(0, 4).map(function (o) {
          return o.name + ' (' + o.missing + ' of ' + o.total + ' positions)';
        }).join('; ') + (offenders.length > 4 ? '; …' : '') +
        '. Force has to transfer through the diaphragm and the supporting frame.',
      basis: 'Plan positions of wall corners and brace ends, matched storey to storey within 50 mm.',
      limits: 'A deliberate transfer level will trip this. What it means is that the transfer members ' +
        'need designing for it, not that the layout is wrong.',
      ids: offenders.reduce(function (a, o) { return a.concat(o.ids); }, [])
    });
  }

  /* ------------------------------------------------------------------ */
  /* Entry point                                                         */
  /* ------------------------------------------------------------------ */

  /** Irregularities that geometry cannot settle — stated, never guessed. */
  var NOT_CHECKABLE = [
    { name: 'Torsional irregularity', clause: 'Table 5(a)',
      why: 'Needs the ratio of maximum to average storey displacement under design lateral force — an analysis result.' },
    { name: 'Mass irregularity', clause: 'Table 6(b)',
      why: 'Needs seismic weight per storey. The .e2k carries load patterns but not the assembled mass.' },
    { name: 'Strength / weak storey', clause: 'Table 6(c)',
      why: 'Needs member capacities from design, not section geometry.' },
    { name: 'Diaphragm discontinuity', clause: 'Table 5(b)',
      why: 'Partly visible from openings, but the 50% area and stiffness-change tests need the diaphragm definition.' }
  ];

  function screen(model) {
    var rows = storeyMetrics(model);
    var findings = [];
    checkSetback(model, rows, findings);
    checkReentrant(model, rows, findings);
    checkSoftStorey(model, rows, findings);
    checkInPlane(model, rows, findings);

    var order = { critical: 0, warn: 1, info: 2 };
    findings.sort(function (a, b) { return order[a.severity] - order[b.severity]; });

    return {
      findings: findings,
      storeys: rows,
      notCheckable: NOT_CHECKABLE,
      checksRun: 4
    };
  }

  global.ETABSCode = {
    screen: screen,
    storeyMetrics: storeyMetrics,
    NOT_CHECKABLE: NOT_CHECKABLE
  };
})(window);
