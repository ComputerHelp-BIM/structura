/**
 * sections.js — Structural section profile library.
 * =================================================================
 * Turns an ETABS / SAP2000 frame-section definition into:
 *   • a closed 2-D outline in the section's own local plane, and
 *   • analytic cross-sectional properties used for quantity take-off.
 *
 * Coordinate convention (CSI):
 *   u  →  local axis 3   (section WIDTH,  dimension t2 / "B")
 *   v  →  local axis 2   (section DEPTH,  dimension t3 / "D")
 * So for a horizontal beam, +v is vertical and the depth reads correctly.
 *
 * Design note: outlines are single closed loops, even for hollow shapes
 * (pipe, box). Wall thickness is never dropped — it is carried in the
 * analytic `area`, which is what every quantity, weight and BOM figure is
 * computed from. Rendering a hollow tube as a closed solid is a deliberate
 * trade: it costs nothing in accuracy and saves a hole-triangulation pass
 * on every one of potentially 200 000 members.
 *
 * Namespace: window.ETABSSections
 */
(function (global) {
  'use strict';

  /** Points on a full circle for round profiles. Tuned for silhouette
   *  quality at typical screen sizes without inflating vertex counts. */
  var CIRCLE_SEGMENTS = 16;

  /* ------------------------------------------------------------------ */
  /* Outline builders                                                    */
  /* ------------------------------------------------------------------ */

  function rect(width, depth) {
    var u = width / 2, v = depth / 2;
    return [[-u, -v], [u, -v], [u, v], [-u, v]];
  }

  function circle(diameter, segments) {
    var r = diameter / 2, pts = [], n = segments || CIRCLE_SEGMENTS, i, a;
    for (i = 0; i < n; i++) {
      a = (i / n) * Math.PI * 2;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  }

  /**
   * Doubly-symmetric or singly-symmetric I / wide-flange outline.
   * Traced anticlockwise starting at the bottom-left of the bottom flange.
   */
  function iShape(d, bTop, tfTop, tw, bBot, tfBot) {
    var ht = d / 2;
    var bt = bTop / 2, bb = bBot / 2, w = tw / 2;
    return [
      [-bb, -ht], [bb, -ht], [bb, -ht + tfBot], [w, -ht + tfBot],
      [w, ht - tfTop], [bt, ht - tfTop], [bt, ht], [-bt, ht],
      [-bt, ht - tfTop], [-w, ht - tfTop], [-w, -ht + tfBot], [-bb, -ht + tfBot]
    ];
  }

  /** Channel, web on the left (local -u face), flanges opening to +u. */
  function channel(d, b, tf, tw) {
    var ht = d / 2, u0 = -b / 2, u1 = b / 2;
    return [
      [u0, -ht], [u1, -ht], [u1, -ht + tf], [u0 + tw, -ht + tf],
      [u0 + tw, ht - tf], [u1, ht - tf], [u1, ht], [u0, ht]
    ];
  }

  /** Tee: flange at the top (+v), stem hanging down. */
  function tee(d, b, tf, tw) {
    var ht = d / 2, hb = b / 2, w = tw / 2;
    return [
      [-w, -ht], [w, -ht], [w, ht - tf], [hb, ht - tf],
      [hb, ht], [-hb, ht], [-hb, ht - tf], [-w, ht - tf]
    ];
  }

  /** Equal or unequal leg angle, corner at bottom-left. */
  function angle(d, b, tf, tw) {
    var ht = d / 2, hb = b / 2;
    return [
      [-hb, -ht], [hb, -ht], [hb, -ht + tf], [-hb + tw, -ht + tf],
      [-hb + tw, ht], [-hb, ht]
    ];
  }

  /** Two angles back to back with a gap, drawn as one silhouette. */
  function doubleAngle(d, b, tf, tw, gap) {
    var ht = d / 2, g = (gap || 0) / 2, total = b + g;
    return [
      [-total, -ht], [total, -ht], [total, -ht + tf], [g + tw, -ht + tf],
      [g + tw, ht], [g, ht], [g, -ht + tf], [-g, -ht + tf],
      [-g, ht], [-g - tw, ht], [-g - tw, -ht + tf], [-total, -ht + tf]
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Analytic area — never derived from the drawn outline                */
  /* ------------------------------------------------------------------ */

  function analyticArea(family, d, b, tf, tw, tfb, bb) {
    switch (family) {
      case 'rectangular': return d * b;
      case 'circular':    return Math.PI * d * d / 4;
      case 'pipe':        return Math.PI * (d * d - Math.pow(d - 2 * tw, 2)) / 4;
      case 'box':         return d * b - (d - 2 * tf) * (b - 2 * tw);
      case 'i':           return b * tf + bb * tfb + (d - tf - tfb) * tw;
      case 'channel':     return 2 * b * tf + (d - 2 * tf) * tw;
      case 'tee':         return b * tf + (d - tf) * tw;
      case 'angle':       return b * tf + (d - tf) * tw;
      case 'doubleangle': return 2 * (b * tf + (d - tf) * tw);
      default:            return d * b;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Shape-string classification                                         */
  /* ------------------------------------------------------------------ */

  /**
   * ETABS writes shape names many ways across versions and languages of
   * export ("I/Wide Flange", "Steel I/Wide Flange", "Wide Flange"…), so
   * classify on substrings rather than exact matches.
   */
  function classify(shapeText) {
    var s = String(shapeText || '').toLowerCase();
    if (!s) return 'rectangular';
    if (s.indexOf('pipe') >= 0) return 'pipe';
    if (s.indexOf('circle') >= 0 || s.indexOf('circular') >= 0 || s.indexOf('round') >= 0) return 'circular';
    if (s.indexOf('double angle') >= 0 || s.indexOf('doubleangle') >= 0) return 'doubleangle';
    if (s.indexOf('angle') >= 0) return 'angle';
    if (s.indexOf('channel') >= 0) return 'channel';
    if (s.indexOf('tee') >= 0 || /\bt\b/.test(s)) return 'tee';
    if (s.indexOf('tube') >= 0 || s.indexOf('box') >= 0 || s.indexOf('hss') >= 0) return 'box';
    if (s.indexOf('wide flange') >= 0 || s.indexOf('i/w') >= 0 || s.indexOf('i-section') >= 0 ||
        s.indexOf('ismb') >= 0 || s.indexOf('beam') >= 0) return 'i';
    if (s.indexOf('rectangular') >= 0 || s.indexOf('rect') >= 0) return 'rectangular';
    return 'rectangular';
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Build the renderable outline and analytic properties for a section.
   *
   * @param {Object} sec Parsed section record. Dimensions are in model
   *   length units and may be missing — sensible structural defaults are
   *   substituted so an incomplete file still renders something honest.
   * @returns {{outline: Array<Array<number>>, area: number, family: string,
   *            depth: number, width: number}}
   */
  function build(sec) {
    var family = sec.family || classify(sec.shape || sec.name);
    var d  = num(sec.D,  defaultDepth(family));
    var b  = num(sec.B,  d * 0.5);
    var tf = num(sec.TF, Math.max(d * 0.04, 0.008));
    var tw = num(sec.TW, Math.max(d * 0.025, 0.006));
    var bb = num(sec.B2, b);
    var tb = num(sec.TF2, tf);
    var outline;

    switch (family) {
      case 'circular':    outline = circle(d); b = d; break;
      case 'pipe':        outline = circle(d); b = d; break;
      case 'i':           outline = iShape(d, b, tf, tw, bb, tb); break;
      case 'channel':     outline = channel(d, b, tf, tw); break;
      case 'tee':         outline = tee(d, b, tf, tw); break;
      case 'angle':       outline = angle(d, b, tf, tw); break;
      case 'doubleangle': outline = doubleAngle(d, b, tf, tw, num(sec.GAP, 0.01)); break;
      case 'box':         outline = rect(b, d); break;
      default:            outline = rect(b, d); family = 'rectangular';
    }

    return {
      outline: outline,
      area: Math.max(analyticArea(family, d, b, tf, tw, tb, bb), 1e-6),
      family: family,
      depth: d,
      width: b
    };
  }

  function defaultDepth(family) {
    // A visible, plausible member rather than a zero-size sliver when the
    // export omitted dimensions (common with Auto Select lists).
    if (family === 'circular' || family === 'pipe') return 0.45;
    if (family === 'angle' || family === 'doubleangle') return 0.10;
    return 0.45;
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return (isFinite(n) && n > 0) ? n : fallback;
  }

  /* ------------------------------------------------------------------ */
  /* Ear-clipping triangulation for the extrusion end caps               */
  /* ------------------------------------------------------------------ */

  /**
   * Triangulate a simple closed polygon (no holes). Handles the concave
   * outlines every steel profile produces. Returns a flat index array into
   * the supplied point list.
   */
  function triangulate(points) {
    var n = points.length;
    if (n < 3) return [];
    var indices = [], i;
    var remaining = [];
    for (i = 0; i < n; i++) remaining.push(i);

    if (signedArea(points) < 0) remaining.reverse();

    var guard = 0;
    while (remaining.length > 3 && guard++ < n * n) {
      var earFound = false;
      for (i = 0; i < remaining.length; i++) {
        var i0 = remaining[(i - 1 + remaining.length) % remaining.length];
        var i1 = remaining[i];
        var i2 = remaining[(i + 1) % remaining.length];
        if (isEar(points, remaining, i0, i1, i2)) {
          indices.push(i0, i1, i2);
          remaining.splice(i, 1);
          earFound = true;
          break;
        }
      }
      // Degenerate or self-intersecting outline: fall back to a fan so the
      // member still renders rather than vanishing.
      if (!earFound) break;
    }
    if (remaining.length === 3) {
      indices.push(remaining[0], remaining[1], remaining[2]);
    } else if (remaining.length > 3) {
      for (i = 1; i < remaining.length - 1; i++) {
        indices.push(remaining[0], remaining[i], remaining[i + 1]);
      }
    }
    return indices;
  }

  function signedArea(pts) {
    var a = 0, n = pts.length, i, j;
    for (i = 0, j = n - 1; i < n; j = i++) {
      a += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
    }
    return a / 2;
  }

  function isEar(pts, ring, i0, i1, i2) {
    var ax = pts[i0][0], ay = pts[i0][1];
    var bx = pts[i1][0], by = pts[i1][1];
    var cx = pts[i2][0], cy = pts[i2][1];
    var cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross <= 1e-12) return false; // reflex or collinear
    for (var k = 0; k < ring.length; k++) {
      var idx = ring[k];
      if (idx === i0 || idx === i1 || idx === i2) continue;
      if (pointInTriangle(pts[idx][0], pts[idx][1], ax, ay, bx, by, cx, cy)) return false;
    }
    return true;
  }

  function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
    var d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    var d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    var d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    var hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    var hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  global.ETABSSections = {
    build: build,
    classify: classify,
    triangulate: triangulate,
    CIRCLE_SEGMENTS: CIRCLE_SEGMENTS
  };
})(window);
