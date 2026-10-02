/**
 * demo.js — Procedural sample buildings.
 * =================================================================
 * Each sample is emitted as genuine .e2k text and then read back through
 * the production parser. Nothing is injected into the model directly, so
 * the demo doubles as a continuous self-test of the parser: if a sample
 * renders, the .e2k path works.
 *
 * Namespace: window.ETABSDemo
 */
(function (global) {
  'use strict';

  function q(s) { return '"' + String(s) + '"'; }
  function f(n) { return (Math.round(n * 1e6) / 1e6).toString(); }

  /** Shared writer so every sample emits identical, valid grammar. */
  function Writer(title) {
    this.L = [];
    this.L.push('$ PROGRAM INFORMATION');
    this.L.push('  PROGRAM  "ETABS"  VERSION "21.0.0"');
    this.L.push('$ CONTROLS');
    this.L.push('  UNITS  "KN"  "M"');
    this.L.push('  TITLE1 ' + q(title));
  }

  Writer.prototype = {
    stories: function (list) {
      // ETABS writes stories top-first; the sample must match that order.
      this.L.push('$ STORIES - IN SEQUENCE FROM TOP');
      for (var i = list.length - 1; i >= 1; i--) {
        this.L.push('  STORY ' + q(list[i].name) + '  HEIGHT ' + f(list[i].height) +
                    '  MASTERSTORY ' + q(i === list.length - 1 ? 'Yes' : 'No'));
      }
      this.L.push('  STORY ' + q(list[0].name) + '  ELEV 0');
      return this;
    },
    grids: function (xs, ys) {
      this.L.push('$ GRIDS');
      var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      xs.forEach(function (x, i) {
        this.L.push('  GRID "G1"  LABEL ' + q(letters[i] || ('X' + i)) +
                    '  DIR "X"  COORD ' + f(x) + '  VISIBLE "Yes"');
      }, this);
      ys.forEach(function (y, i) {
        this.L.push('  GRID "G1"  LABEL ' + q(String(i + 1)) +
                    '  DIR "Y"  COORD ' + f(y) + '  VISIBLE "Yes"');
      }, this);
      return this;
    },
    materials: function (mats) {
      this.L.push('$ MATERIAL PROPERTIES');
      mats.forEach(function (m) {
        this.L.push('  MATERIAL ' + q(m.name) + '  TYPE ' + q(m.type) +
                    '  WEIGHTPERVOLUME ' + f(m.w) + '  E ' + f(m.E));
        if (m.fc) this.L.push('  MATERIAL ' + q(m.name) + '  FC ' + f(m.fc));
        if (m.fy) this.L.push('  MATERIAL ' + q(m.name) + '  FY ' + f(m.fy));
      }, this);
      return this;
    },
    frameSections: function (secs) {
      this.L.push('$ FRAME SECTIONS');
      secs.forEach(function (s) {
        var line = '  FRAMESECTION ' + q(s.name) + '  MATERIAL ' + q(s.mat) +
                   '  SHAPE ' + q(s.shape) + '  D ' + f(s.D) + '  B ' + f(s.B);
        if (s.TF) line += '  TF ' + f(s.TF);
        if (s.TW) line += '  TW ' + f(s.TW);
        this.L.push(line);
      }, this);
      return this;
    },
    shellSections: function (secs) {
      this.L.push('$ SHELL PROPERTIES');
      secs.forEach(function (s) {
        this.L.push('  SHELLPROP ' + q(s.name) + '  PROPTYPE ' + q(s.type) +
                    '  MATERIAL ' + q(s.mat) + '  MODELINGTYPE "ShellThin"  ' +
                    (s.type === 'Wall' ? 'WALLTHICKNESS ' : 'SLABTHICKNESS ') + f(s.t));
      }, this);
      return this;
    },
    points: function (pts) {
      this.L.push('$ POINT COORDINATES');
      Object.keys(pts).forEach(function (k) {
        var p = pts[k];
        // A third coordinate is written for points that sit off the storey
        // plane — stair landings, sunshades, plinth level.
        this.L.push('  POINT ' + q(k) + '  ' + f(p[0]) + '  ' + f(p[1]) +
          (p.length > 2 && p[2] !== null && p[2] !== undefined ? '  ' + f(p[2]) : ''));
      }, this);
      return this;
    },
    lineConn: function (lines) {
      this.L.push('$ LINE CONNECTIVITIES');
      lines.forEach(function (l) {
        this.L.push('  LINE ' + q(l.name) + '  ' + l.type + '  ' + q(l.i) + ' ' + q(l.j) +
                    '  ' + (l.span === undefined ? (l.type === 'BEAM' ? 0 : 1) : l.span));
      }, this);
      return this;
    },
    areaConn: function (areas) {
      this.L.push('$ AREA CONNECTIVITIES');
      areas.forEach(function (a) {
        var ids = a.ids.map(q).join(' ');
        var offs = a.offs.join(' ');
        this.L.push('  AREA ' + q(a.name) + '  ' + a.type + '  ' + a.ids.length +
                    '  ' + ids + '  ' + offs);
      }, this);
      return this;
    },
    pointAssigns: function (list) {
      this.L.push('$ POINT ASSIGNS');
      list.forEach(function (p) {
        this.L.push('  POINTASSIGN  ' + q(p.point) + ' ' + q(p.story) +
                    '  RESTRAINT ' + q(p.restraint));
      }, this);
      return this;
    },
    lineAssigns: function (list) {
      this.L.push('$ LINE ASSIGNS');
      list.forEach(function (l) {
        var line = '  LINEASSIGN  ' + q(l.line) + '  ' + q(l.story) +
                   '  SECTION ' + q(l.section) + '  ANG ' + f(l.ang || 0);
        // Vertical offsets are how ETABS writes a sloping member — a rafter
        // rising from the eaves to the ridge, for instance.
        if (l.offZI) line += '  OFFSETZI ' + f(l.offZI);
        if (l.offZJ) line += '  OFFSETZJ ' + f(l.offZJ);
        this.L.push(line);
      }, this);
      return this;
    },
    areaAssigns: function (list) {
      this.L.push('$ AREA ASSIGNS');
      list.forEach(function (a) {
        this.L.push('  AREAASSIGN  ' + q(a.area) + '  ' + q(a.story) +
                    '  SECTION ' + q(a.section) +
                    (a.opening ? '  OPENING "Yes" ' : '') +
                    '  CARDINALPOINT "MIDDLE" ');
      }, this);
      return this;
    },
    /**
     * Reinforcement definitions, exactly as ETABS writes them: a bar
     * pattern, one bar's area, the cover and the tie spacing. The samples
     * carry them so the bar cage can be drawn from the file, like a real
     * project model.
     */
    concreteSections: function (list) {
      this.L.push('$ CONCRETE SECTIONS');
      list.forEach(function (c) {
        if (c.kind === 'Column') {
          this.L.push('  CONCRETESECTION ' + q(c.name) + '  LONGBARMATERIAL "Fe500"  CONFINEBARMATERIAL "Fe415"' +
            '  TYPE "Column"  PATTERN ' + q(c.pattern) + '  TRANSREINF "TIES"  DESIGNCHECK "DESIGN"' +
            '  COVER ' + f(c.cover) + ' LONGBARAREA ' + f(c.barArea) +
            ' CONFINEBARAREA ' + f(c.tieArea) + ' CONFINEBARSPACING ' + f(c.tieSpacing));
        } else {
          this.L.push('  CONCRETESECTION ' + q(c.name) + '  LONGBARMATERIAL "Fe500"  CONFINEBARMATERIAL "Fe415"' +
            '  TYPE "Beam"  COVERTOP ' + f(c.cover) + ' COVERBOTTOM ' + f(c.cover) +
            ' ATI 0 ABI 0 ATJ 0 ABJ 0');
        }
      }, this);
      return this;
    },
    loadPatterns: function (list) {
      this.L.push('$ LOAD PATTERNS');
      list.forEach(function (p) {
        this.L.push('  LOADPATTERN ' + q(p.name) + '  TYPE ' + q(p.type) + '  SELFWEIGHT ' + f(p.self || 0));
      }, this);
      return this;
    },
    /**
     * Area and line loads, written the way ETABS does. Giving the samples
     * real loading means the load map has something to show before anyone
     * opens a file of their own.
     */
    areaLoads: function (list) {
      this.L.push('$ SHELL OBJECT LOADS');
      list.forEach(function (l) {
        this.L.push('  AREALOAD  ' + q(l.area) + '  ' + q(l.story) +
                    '  TYPE "UNIFF"  DIR "GRAV"  LC ' + q(l.pattern) + '  FVAL ' + f(l.value));
      }, this);
      return this;
    },
    lineLoads: function (list) {
      this.L.push('$ FRAME OBJECT LOADS');
      list.forEach(function (l) {
        this.L.push('  LINELOAD  ' + q(l.line) + '  ' + q(l.story) +
                    '  TYPE "UNIFF"  DIR "GRAV"  LC ' + q(l.pattern) + '  FVAL ' + f(l.value));
      }, this);
      return this;
    },
    combos: function (list) {
      this.L.push('$ LOAD COMBINATIONS');
      list.forEach(function (c) {
        this.L.push('  COMBO ' + q(c.name) + '  TYPE "Linear Add"');
        c.parts.forEach(function (p) {
          this.L.push('  COMBO ' + q(c.name) + '  LOADCASE ' + q(p.name) + '  SF ' + f(p.sf));
        }, this);
      }, this);
      return this;
    },
    text: function () { this.L.push('$ END OF MODEL FILE'); return this.L.join('\n'); }
  };

  /* ------------------------------------------------------------------ */
  /* Shared frame-grid generator                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Lay out a regular orthogonal frame and return every collection the
   * writer needs. Options control what the individual samples vary.
   */
  function frameGrid(opt) {
    var xs = opt.xs, ys = opt.ys, storyList = opt.stories;
    var pts = {}, lineConn = [], lineAssign = [], areaConn = [], areaAssign = [];
    var pointAssign = [], label = {}, n = 1;
    var tag = opt.prefix || '';            // keeps two grids in one model apart
    var first = opt.fromStorey || 1;
    var last = opt.toStorey || storyList.length - 1;

    xs.forEach(function (x, ix) {
      ys.forEach(function (y, iy) {
        var id = tag + String(n++);
        pts[id] = [x, y];
        label[ix + ',' + iy] = id;
      });
    });

    var P = function (ix, iy) { return label[ix + ',' + iy]; };
    var ci = 1, bi = 1, ai = 1, di = 1;

    // Base restraints under every column line.
    if (!opt.noBase) {
      xs.forEach(function (x, ix) {
        ys.forEach(function (y, iy) {
          pointAssign.push({ point: P(ix, iy), story: storyList[first - 1].name, restraint: 'UX UY UZ RX RY RZ' });
        });
      });
    }

    for (var s = first; s <= last; s++) {
      var story = storyList[s].name;

      // Columns
      xs.forEach(function (x, ix) {
        ys.forEach(function (y, iy) {
          if (opt.skipColumn && opt.skipColumn(ix, iy, s)) return;
          var name = tag + 'C' + (ci++);
          lineConn.push({ name: name, type: 'COLUMN', i: P(ix, iy), j: P(ix, iy), span: 1 });
          lineAssign.push({ line: name, story: story, section: opt.columnSection(ix, iy, s) });
        });
      });

      // Beams along X (a flat-slab frame has none)
      if (!opt.noBeams) for (var ix2 = 0; ix2 < xs.length - 1; ix2++) {
        for (var iy2 = 0; iy2 < ys.length; iy2++) {
          var nb = tag + 'B' + (bi++);
          lineConn.push({ name: nb, type: 'BEAM', i: P(ix2, iy2), j: P(ix2 + 1, iy2), span: 0 });
          lineAssign.push({ line: nb, story: story, section: opt.beamSection(s, 'X'),
            edge: iy2 === 0 || iy2 === ys.length - 1 });
        }
      }
      // Beams along Y
      if (!opt.noBeams) for (var ix3 = 0; ix3 < xs.length; ix3++) {
        for (var iy3 = 0; iy3 < ys.length - 1; iy3++) {
          var nb2 = tag + 'B' + (bi++);
          lineConn.push({ name: nb2, type: 'BEAM', i: P(ix3, iy3), j: P(ix3, iy3 + 1), span: 0 });
          lineAssign.push({ line: nb2, story: story, section: opt.beamSection(s, 'Y'),
            edge: ix3 === 0 || ix3 === xs.length - 1 });
        }
      }

      // Floor panels
      if (opt.slabSection) {
        for (var ix4 = 0; ix4 < xs.length - 1; ix4++) {
          for (var iy4 = 0; iy4 < ys.length - 1; iy4++) {
            if (opt.skipSlab && opt.skipSlab(ix4, iy4, s)) continue;
            var na = tag + 'F' + (ai++);
            areaConn.push({
              name: na, type: 'FLOOR',
              ids: [P(ix4, iy4), P(ix4 + 1, iy4), P(ix4 + 1, iy4 + 1), P(ix4, iy4 + 1)],
              offs: [0, 0, 0, 0]
            });
            areaAssign.push({ area: na, story: story, section: opt.slabSection(s) });
          }
        }
      }

      // Optional extra members supplied by the sample (braces, walls).
      if (opt.extras) {
        opt.extras({
          story: story, storyIndex: s, P: P,
          addLine: function (type, i, j, section, span, opts) {
            var nm = tag + type.charAt(0) + 'X' + (di++);
            lineConn.push({ name: nm, type: type, i: i, j: j, span: span === undefined ? 1 : span });
            lineAssign.push({
              line: nm, story: story, section: section,
              offZI: opts && opts.offZI, offZJ: opts && opts.offZJ, edge: opts && opts.edge
            });
          },
          addPanel: function (i, j, section) {
            var nm = tag + 'W' + (di++);
            areaConn.push({ name: nm, type: 'PANEL', ids: [i, j, i, j], offs: [1, 1, 0, 0] });
            areaAssign.push({ area: nm, story: story, section: section });
          }
        });
      }
    }

    return {
      pts: pts, lineConn: lineConn, lineAssign: lineAssign,
      areaConn: areaConn, areaAssign: areaAssign, pointAssign: pointAssign
    };
  }

  /**
   * Plausible Indian-practice loading for a generated frame: floor finishes
   * and partitions as super-dead, an occupancy live load, a lighter roof,
   * and a facade line load on the perimeter beams of every floor.
   */
  function loadingFor(g, stories, opt) {
    opt = opt || {};
    var top = stories[stories.length - 1].name;
    var areaLoads = [], lineLoads = [];

    g.areaAssign.forEach(function (a) {
      var roof = a.story === top;
      areaLoads.push({ area: a.area, story: a.story, pattern: 'SIDL', value: roof ? (opt.roofSidl || 2.5) : (opt.sidl || 1.5) });
      areaLoads.push({ area: a.area, story: a.story, pattern: 'LIVE', value: roof ? (opt.roofLive || 1.5) : (opt.live || 3) });
    });

    // Perimeter beams carry the facade; the grid marks them as it builds.
    g.lineAssign.forEach(function (l) {
      if (!l.edge) return;
      lineLoads.push({ line: l.line, story: l.story, pattern: 'SIDL',
        value: l.story === top ? (opt.parapet || 3.5) : (opt.facade || 9.2) });
    });

    return { areaLoads: areaLoads, lineLoads: lineLoads };
  }

  /** 20 mm and 25 mm main bars, 8 mm ties — the usual Indian sizes. */
  var A20 = 0.0003142, A25 = 0.0004909, A8 = 0.0000503;

  var LOAD_PATTERNS = [
    { name: 'DEAD', type: 'Dead', self: 1 },
    { name: 'SIDL', type: 'Super Dead', self: 0 },
    { name: 'LIVE', type: 'Reducible Live', self: 0 }
  ];

  var LOAD_COMBOS = [
    { name: '1.5 (DL + SIDL + LL)', parts: [{ name: 'DEAD', sf: 1.5 }, { name: 'SIDL', sf: 1.5 }, { name: 'LIVE', sf: 1.5 }] },
    { name: 'DL + SIDL + LL', parts: [{ name: 'DEAD', sf: 1 }, { name: 'SIDL', sf: 1 }, { name: 'LIVE', sf: 1 }] }
  ];

  function storyList(count, height, baseName) {
    var out = [{ name: baseName || 'Base', height: 0 }];
    for (var i = 1; i <= count; i++) out.push({ name: 'Story' + i, height: height });
    return out;
  }

  function series(count, spacing) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(i * spacing);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Sample 1 — G+10 RCC moment frame                                    */
  /* ------------------------------------------------------------------ */

  function rccFrame() {
    var LOADING = { sidl: 1.5, live: 3, roofSidl: 2.5, roofLive: 1.5, facade: 9.2, parapet: 3.5 };
    var st = storyList(10, 3.2);
    var xs = series(5, 6.0), ys = series(4, 5.5);
    var w = new Writer('Sample — G+10 RCC Moment Frame');

    w.stories(st).grids(xs, ys)
      .materials([
        { name: 'M30', type: 'Concrete', w: 25, E: 27386127, fc: 30000 },
        { name: 'M40', type: 'Concrete', w: 25, E: 31622777, fc: 40000 },
        { name: 'Fe500', type: 'Rebar', w: 76.97, E: 200000000, fy: 500000 }
      ])
      .frameSections([
        { name: 'C750X750', mat: 'M40', shape: 'Concrete Rectangular', D: 0.75, B: 0.75 },
        { name: 'C600X600', mat: 'M40', shape: 'Concrete Rectangular', D: 0.60, B: 0.60 },
        { name: 'C450X450', mat: 'M30', shape: 'Concrete Rectangular', D: 0.45, B: 0.45 },
        { name: 'B300X600', mat: 'M30', shape: 'Concrete Rectangular', D: 0.60, B: 0.30 },
        { name: 'B250X500', mat: 'M30', shape: 'Concrete Rectangular', D: 0.50, B: 0.25 }
      ])
      .shellSections([{ name: 'Slab150', type: 'Slab', mat: 'M30', t: 0.15 }])
      .concreteSections([
        { name: 'C750X750', kind: 'Column', pattern: 'R-4-4', cover: 0.04, barArea: A25, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C600X600', kind: 'Column', pattern: 'R-3-3', cover: 0.04, barArea: A25, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C450X450', kind: 'Column', pattern: 'R-3-3', cover: 0.04, barArea: A20, tieArea: A8, tieSpacing: 0.15 },
        { name: 'B300X600', kind: 'Beam', cover: 0.035 },
        { name: 'B250X500', kind: 'Beam', cover: 0.035 }
      ]);

    var g = frameGrid({
      xs: xs, ys: ys, stories: st,
      columnSection: function (ix, iy, s) {
        return s <= 3 ? 'C750X750' : (s <= 7 ? 'C600X600' : 'C450X450');
      },
      beamSection: function (s, dir) { return dir === 'X' ? 'B300X600' : 'B250X500'; },
      slabSection: function () { return 'Slab150'; }
    });

    w.points(g.pts).lineConn(g.lineConn).areaConn(g.areaConn)
      .pointAssigns(g.pointAssign).lineAssigns(g.lineAssign).areaAssigns(g.areaAssign);

    var loading = loadingFor(g, st, LOADING);
    w.loadPatterns(LOAD_PATTERNS).areaLoads(loading.areaLoads)
      .lineLoads(loading.lineLoads).combos(LOAD_COMBOS);
    return w.text();
  }

  /* ------------------------------------------------------------------ */
  /* Sample 2 — G+14 steel braced tower                                  */
  /* ------------------------------------------------------------------ */

  function steelBraced() {
    // An office tower: lighter finishes, glazed facade, heavier office live load.
    var LOADING = { sidl: 1.2, live: 4, roofSidl: 2.0, roofLive: 1.5, facade: 5.4, parapet: 2.5 };
    var st = storyList(14, 3.6);
    var xs = series(4, 7.5), ys = series(3, 7.5);
    var w = new Writer('Sample — G+14 Steel Braced Tower');

    w.stories(st).grids(xs, ys)
      .materials([
        { name: 'E250', type: 'Steel', w: 76.97, E: 200000000, fy: 250000 },
        { name: 'E350', type: 'Steel', w: 76.97, E: 200000000, fy: 350000 },
        { name: 'M30', type: 'Concrete', w: 25, E: 27386127, fc: 30000 }
      ])
      .frameSections([
        { name: 'UC356X406X340', mat: 'E350', shape: 'I/Wide Flange', D: 0.406, B: 0.400, TF: 0.0428, TW: 0.0268 },
        { name: 'UC305X305X198', mat: 'E350', shape: 'I/Wide Flange', D: 0.339, B: 0.314, TF: 0.0316, TW: 0.0195 },
        { name: 'ISMB600', mat: 'E250', shape: 'I/Wide Flange', D: 0.600, B: 0.210, TF: 0.0208, TW: 0.0120 },
        { name: 'ISMB450', mat: 'E250', shape: 'I/Wide Flange', D: 0.450, B: 0.150, TF: 0.0174, TW: 0.0094 },
        { name: 'SHS200X200X10', mat: 'E350', shape: 'Box/Tube', D: 0.200, B: 0.200, TF: 0.010, TW: 0.010 }
      ])
      .shellSections([{ name: 'Deck130', type: 'Slab', mat: 'M30', t: 0.13 }]);

    var g = frameGrid({
      xs: xs, ys: ys, stories: st,
      columnSection: function (ix, iy, s) { return s <= 7 ? 'UC356X406X340' : 'UC305X305X198'; },
      beamSection: function (s, dir) { return dir === 'X' ? 'ISMB600' : 'ISMB450'; },
      slabSection: function () { return 'Deck130'; },
      extras: function (ctx) {
        // Chevron bracing on the two end bays, alternating each storey so
        // the pattern reads as a real braced bay rather than a decoration.
        var flip = ctx.storyIndex % 2 === 0;
        var bays = [[0, 0, 1, 0], [xs.length - 2, ys.length - 1, xs.length - 1, ys.length - 1]];
        bays.forEach(function (b) {
          var i = ctx.P(b[0], b[1]), j = ctx.P(b[2], b[3]);
          ctx.addLine('BRACE', flip ? i : j, flip ? j : i, 'SHS200X200X10', 1);
        });
      }
    });

    w.points(g.pts).lineConn(g.lineConn).areaConn(g.areaConn)
      .pointAssigns(g.pointAssign).lineAssigns(g.lineAssign).areaAssigns(g.areaAssign);

    var loading = loadingFor(g, st, LOADING);
    w.loadPatterns(LOAD_PATTERNS).areaLoads(loading.areaLoads)
      .lineLoads(loading.lineLoads).combos(LOAD_COMBOS);
    return w.text();
  }

  /* ------------------------------------------------------------------ */
  /* Sample 3 — G+8 shear wall core with flat slabs                      */
  /* ------------------------------------------------------------------ */

  function shearWallCore() {
    // A residential block over a podium: heavier finishes, lower live load.
    var LOADING = { sidl: 2.0, live: 2, roofSidl: 3.0, roofLive: 1.5, facade: 7.5, parapet: 3.5 };
    var st = storyList(8, 3.0);
    var xs = series(5, 6.0), ys = series(5, 6.0);
    var w = new Writer('Sample — G+8 Shear Wall Core');

    w.stories(st).grids(xs, ys)
      .materials([
        { name: 'M45', type: 'Concrete', w: 25, E: 33541020, fc: 45000 },
        { name: 'M35', type: 'Concrete', w: 25, E: 29580399, fc: 35000 }
      ])
      .frameSections([
        { name: 'C600X600', mat: 'M45', shape: 'Concrete Rectangular', D: 0.60, B: 0.60 },
        { name: 'C500DIA', mat: 'M45', shape: 'Concrete Circle', D: 0.50, B: 0.50 },
        { name: 'B300X750', mat: 'M35', shape: 'Concrete Rectangular', D: 0.75, B: 0.30 }
      ])
      .shellSections([
        { name: 'Slab200', type: 'Slab', mat: 'M35', t: 0.20 },
        { name: 'Wall300', type: 'Wall', mat: 'M45', t: 0.30 }
      ])
      .concreteSections([
        { name: 'C600X600', kind: 'Column', pattern: 'R-3-3', cover: 0.04, barArea: A25, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C500DIA', kind: 'Column', pattern: 'C-8', cover: 0.04, barArea: A20, tieArea: A8, tieSpacing: 0.15 },
        { name: 'B300X750', kind: 'Beam', cover: 0.035 }
      ]);

    // The core occupies the central bay: no columns, no slab panel there.
    var coreX = 2, coreY = 2;

    var g = frameGrid({
      xs: xs, ys: ys, stories: st,
      skipColumn: function (ix, iy) { return ix === coreX && iy === coreY; },
      skipSlab: function (ix, iy) { return ix === coreX - 1 && iy === coreY - 1; },
      columnSection: function (ix, iy) {
        var perimeter = (ix === 0 || iy === 0 || ix === xs.length - 1 || iy === ys.length - 1);
        return perimeter ? 'C600X600' : 'C500DIA';
      },
      beamSection: function () { return 'B300X750'; },
      slabSection: function () { return 'Slab200'; },
      extras: function (ctx) {
        // Four core walls boxing the central bay.
        var a = ctx.P(coreX - 1, coreY - 1), b = ctx.P(coreX, coreY - 1);
        var c = ctx.P(coreX, coreY), d = ctx.P(coreX - 1, coreY);
        ctx.addPanel(a, b, 'Wall300');
        ctx.addPanel(b, c, 'Wall300');
        ctx.addPanel(c, d, 'Wall300');
        ctx.addPanel(d, a, 'Wall300');
      }
    });

    w.points(g.pts).lineConn(g.lineConn).areaConn(g.areaConn)
      .pointAssigns(g.pointAssign).lineAssigns(g.lineAssign).areaAssigns(g.areaAssign);

    var loading = loadingFor(g, st, LOADING);
    w.loadPatterns(LOAD_PATTERNS).areaLoads(loading.areaLoads)
      .lineLoads(loading.lineLoads).combos(LOAD_COMBOS);
    return w.text();
  }

  /* ------------------------------------------------------------------ */
  /* Sample 4 — G+20 flat-slab tower on a shear-wall core                */
  /* ------------------------------------------------------------------ */

  function flatSlabTower() {
    var LOADING = { sidl: 2.5, live: 2, roofSidl: 3.5, roofLive: 1.5, facade: 6.5, parapet: 3.0 };
    var st = storyList(20, 3.0);
    var xs = series(4, 7.2), ys = series(4, 7.2);
    var w = new Writer('Sample — G+20 Flat Slab Tower');

    w.stories(st).grids(xs, ys)
      .materials([
        { name: 'M50', type: 'Concrete', w: 25, E: 35355339, fc: 50000 },
        { name: 'M40', type: 'Concrete', w: 25, E: 31622777, fc: 40000 },
        { name: 'M30', type: 'Concrete', w: 25, E: 27386127, fc: 30000 }
      ])
      .frameSections([
        { name: 'C900DIA', mat: 'M50', shape: 'Concrete Circle', D: 0.90, B: 0.90 },
        { name: 'C750DIA', mat: 'M50', shape: 'Concrete Circle', D: 0.75, B: 0.75 },
        { name: 'C600DIA', mat: 'M40', shape: 'Concrete Circle', D: 0.60, B: 0.60 },
        { name: 'PB400X900', mat: 'M40', shape: 'Concrete Rectangular', D: 0.90, B: 0.40 }
      ])
      .shellSections([
        { name: 'FlatSlab250', type: 'Slab', mat: 'M30', t: 0.25 },
        { name: 'CoreWall350', type: 'Wall', mat: 'M50', t: 0.35 }
      ])
      .concreteSections([
        { name: 'C900DIA', kind: 'Column', pattern: 'C-16', cover: 0.04, barArea: A25, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C750DIA', kind: 'Column', pattern: 'C-12', cover: 0.04, barArea: A25, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C600DIA', kind: 'Column', pattern: 'C-10', cover: 0.04, barArea: A20, tieArea: A8, tieSpacing: 0.15 },
        { name: 'PB400X900', kind: 'Beam', cover: 0.04 }
      ]);

    var coreX = 1, coreY = 1;                        // central bay holds the core
    var g = frameGrid({
      xs: xs, ys: ys, stories: st,
      noBeams: true,                                 // flat slab: no downstand beams
      skipColumn: function (ix, iy) { return ix === coreX + 1 && iy === coreY + 1; },
      columnSection: function (ix, iy, s) {
        return s <= 7 ? 'C900DIA' : (s <= 14 ? 'C750DIA' : 'C600DIA');
      },
      beamSection: function () { return 'PB400X900'; },
      slabSection: function () { return 'FlatSlab250'; },
      extras: function (ctx) {
        // Lift and stair core: four walls boxing the central bay.
        var a = ctx.P(coreX, coreY), b = ctx.P(coreX + 1, coreY);
        var c = ctx.P(coreX + 1, coreY + 1), d = ctx.P(coreX, coreY + 1);
        ctx.addPanel(a, b, 'CoreWall350');
        ctx.addPanel(b, c, 'CoreWall350');
        ctx.addPanel(c, d, 'CoreWall350');
        ctx.addPanel(d, a, 'CoreWall350');
        // A perimeter band beam carries the facade and stiffens the slab edge.
        for (var i = 0; i < xs.length - 1; i++) {
          ctx.addLine('BEAM', ctx.P(i, 0), ctx.P(i + 1, 0), 'PB400X900', 0);
          ctx.addLine('BEAM', ctx.P(i, ys.length - 1), ctx.P(i + 1, ys.length - 1), 'PB400X900', 0);
        }
        for (var j = 0; j < ys.length - 1; j++) {
          ctx.addLine('BEAM', ctx.P(0, j), ctx.P(0, j + 1), 'PB400X900', 0);
          ctx.addLine('BEAM', ctx.P(xs.length - 1, j), ctx.P(xs.length - 1, j + 1), 'PB400X900', 0);
        }
      }
    });

    w.points(g.pts).lineConn(g.lineConn).areaConn(g.areaConn)
      .pointAssigns(g.pointAssign).lineAssigns(g.lineAssign).areaAssigns(g.areaAssign);
    var loading = loadingFor(g, st, LOADING);
    w.loadPatterns(LOAD_PATTERNS).areaLoads(loading.areaLoads)
      .lineLoads(loading.lineLoads).combos(LOAD_COMBOS);
    return w.text();
  }

  /* ------------------------------------------------------------------ */
  /* Sample 5 — stilt + 7 residential block                              */
  /* ------------------------------------------------------------------ */

  function residentialBlock() {
    var LOADING = { sidl: 1.5, live: 2, roofSidl: 2.5, roofLive: 1.5, facade: 8.4, parapet: 3.2 };
    var st = [{ name: 'Foundation', height: 0 }, { name: 'Stilt', height: 3.0 }];
    for (var i = 1; i <= 7; i++) st.push({ name: 'Floor ' + i, height: 2.9 });
    var xs = series(6, 3.6), ys = series(4, 4.2);
    var w = new Writer('Sample — Stilt + 7 Residential Block');

    w.stories(st).grids(xs, ys)
      .materials([
        { name: 'M25', type: 'Concrete', w: 25, E: 25000000, fc: 25000 },
        { name: 'M30', type: 'Concrete', w: 25, E: 27386127, fc: 30000 },
        { name: 'Fe500', type: 'Rebar', w: 76.97, E: 200000000, fy: 500000 }
      ])
      .frameSections([
        { name: 'C230X600', mat: 'M30', shape: 'Concrete Rectangular', D: 0.60, B: 0.23 },
        { name: 'C230X450', mat: 'M25', shape: 'Concrete Rectangular', D: 0.45, B: 0.23 },
        { name: 'B230X450', mat: 'M25', shape: 'Concrete Rectangular', D: 0.45, B: 0.23 },
        { name: 'B230X380', mat: 'M25', shape: 'Concrete Rectangular', D: 0.38, B: 0.23 }
      ])
      .shellSections([{ name: 'Slab125', type: 'Slab', mat: 'M25', t: 0.125 }])
      .concreteSections([
        { name: 'C230X600', kind: 'Column', pattern: 'R-2-4', cover: 0.04, barArea: A20, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C230X450', kind: 'Column', pattern: 'R-2-3', cover: 0.04, barArea: A20, tieArea: A8, tieSpacing: 0.15 },
        { name: 'B230X450', kind: 'Beam', cover: 0.03 },
        { name: 'B230X380', kind: 'Beam', cover: 0.03 }
      ]);

    var g = frameGrid({
      xs: xs, ys: ys, stories: st,
      columnSection: function (ix, iy, s) { return s <= 4 ? 'C230X600' : 'C230X450'; },
      beamSection: function (s, dir) { return dir === 'X' ? 'B230X450' : 'B230X380'; },
      slabSection: function () { return 'Slab125'; },
      // The stair and lift shaft leaves one bay open on every floor.
      skipSlab: function (ix, iy) { return ix === 2 && iy === 1; }
    });

    w.points(g.pts).lineConn(g.lineConn).areaConn(g.areaConn)
      .pointAssigns(g.pointAssign).lineAssigns(g.lineAssign).areaAssigns(g.areaAssign);
    var loading = loadingFor(g, st, LOADING);
    w.loadPatterns(LOAD_PATTERNS).areaLoads(loading.areaLoads)
      .lineLoads(loading.lineLoads).combos(LOAD_COMBOS);
    return w.text();
  }

  /* ------------------------------------------------------------------ */
  /* Sample 6 — industrial shed, long-span steel portals                 */
  /* ------------------------------------------------------------------ */

  function industrialShed() {
    // Two levels only: a mezzanine and the eaves. The roof is made of real
    // sloping rafters, lifted to the ridge with insertion offsets, which is
    // how ETABS writes a pitched portal frame.
    var st = [
      { name: 'Foundation', height: 0 },
      { name: 'Mezzanine', height: 4.0 },
      { name: 'Eaves', height: 4.0 }
    ];
    var xs = series(9, 6.0);                        // 48 m long, portals at 6 m
    var ys = [0, 12, 24];                           // 24 m span, ridge on the centre line
    var RISE = 2.4;                                 // ridge above eaves
    var w = new Writer('Sample — Industrial Shed, Steel Portals');

    w.stories(st).grids(xs, ys)
      .materials([
        { name: 'E350', type: 'Steel', w: 76.97, E: 200000000, fy: 350000 },
        { name: 'E250', type: 'Steel', w: 76.97, E: 200000000, fy: 250000 },
        { name: 'M25', type: 'Concrete', w: 25, E: 25000000, fc: 25000 }
      ])
      .frameSections([
        { name: 'ISMB600', mat: 'E350', shape: 'I/Wide Flange', D: 0.600, B: 0.210, TF: 0.0208, TW: 0.0120 },
        { name: 'ISMB450', mat: 'E250', shape: 'I/Wide Flange', D: 0.450, B: 0.150, TF: 0.0174, TW: 0.0094 },
        { name: 'ISMB300', mat: 'E250', shape: 'I/Wide Flange', D: 0.300, B: 0.140, TF: 0.0124, TW: 0.0075 },
        { name: 'ISA90X90X8', mat: 'E250', shape: 'Angle', D: 0.090, B: 0.090, TF: 0.008, TW: 0.008 },
        { name: 'SHS150X150X6', mat: 'E350', shape: 'Box/Tube', D: 0.150, B: 0.150, TF: 0.006, TW: 0.006 }
      ])
      .shellSections([{ name: 'Mezz150', type: 'Slab', mat: 'M25', t: 0.15 }]);

    var g = frameGrid({
      xs: xs, ys: ys, stories: st,
      noBeams: true,                                // the shed is framed by hand below
      skipColumn: function (ix, iy) { return iy === 1; },   // clear span, no mid columns
      columnSection: function (ix, iy, s) { return s === 1 ? 'ISMB600' : 'ISMB450'; },
      beamSection: function () { return 'ISMB300'; },
      slabSection: function (s) { return s === 1 ? 'Mezz150' : null; },
      skipSlab: function (ix, iy, s) { return s !== 1 || ix > 2; },   // mezzanine over three bays
      extras: function (ctx) {
        var i;
        if (ctx.storyIndex === 1) {
          // Mezzanine framing, over the first three bays only.
          for (i = 0; i < 3; i++) {
            ctx.addLine('BEAM', ctx.P(i, 0), ctx.P(i + 1, 0), 'ISMB450', 0, { edge: true });
            ctx.addLine('BEAM', ctx.P(i, 1), ctx.P(i + 1, 1), 'ISMB450', 0);
          }
          for (i = 0; i <= 3; i++) ctx.addLine('BEAM', ctx.P(i, 0), ctx.P(i, 1), 'ISMB450', 0);
          return;
        }
        // Eaves level: a pitched rafter pair at every portal line…
        for (i = 0; i < xs.length; i++) {
          ctx.addLine('BEAM', ctx.P(i, 0), ctx.P(i, 1), 'ISMB450', 0, { offZJ: RISE });
          ctx.addLine('BEAM', ctx.P(i, 1), ctx.P(i, 2), 'ISMB450', 0, { offZI: RISE });
        }
        // …eaves beams down both sides, a ridge member along the top…
        for (i = 0; i < xs.length - 1; i++) {
          ctx.addLine('BEAM', ctx.P(i, 0), ctx.P(i + 1, 0), 'ISMB300', 0, { edge: true });
          ctx.addLine('BEAM', ctx.P(i, 2), ctx.P(i + 1, 2), 'ISMB300', 0, { edge: true });
          ctx.addLine('BEAM', ctx.P(i, 1), ctx.P(i + 1, 1), 'SHS150X150X6', 0,
            { offZI: RISE, offZJ: RISE });
        }
        // …and cross bracing in the end bays to keep the shed square.
        [0, xs.length - 2].forEach(function (k) {
          ctx.addLine('BRACE', ctx.P(k, 0), ctx.P(k + 1, 0), 'ISA90X90X8', 1);
          ctx.addLine('BRACE', ctx.P(k, 2), ctx.P(k + 1, 2), 'ISA90X90X8', 1);
        });
      }
    });

    w.points(g.pts).lineConn(g.lineConn).areaConn(g.areaConn)
      .pointAssigns(g.pointAssign).lineAssigns(g.lineAssign).areaAssigns(g.areaAssign);
    var loading = loadingFor(g, st, { sidl: 0.6, live: 4, roofSidl: 0.4, roofLive: 0.75, facade: 1.8, parapet: 0.8 });
    w.loadPatterns(LOAD_PATTERNS).areaLoads(loading.areaLoads)
      .lineLoads(loading.lineLoads).combos(LOAD_COMBOS);
    return w.text();
  }

  /* ------------------------------------------------------------------ */
  /* Sample 7 — hospital: podium, transfer slab, offset tower above      */
  /* ------------------------------------------------------------------ */

  function hospitalTransfer() {
    var LOADING = { sidl: 2.0, live: 4, roofSidl: 3.0, roofLive: 1.5, facade: 7.0, parapet: 3.0 };
    var st = [{ name: 'Foundation', height: 0 },
              { name: 'Podium 1', height: 4.5 },
              { name: 'Podium 2', height: 4.5 },
              { name: 'Transfer', height: 4.8 }];
    for (var i = 1; i <= 5; i++) st.push({ name: 'Ward ' + i, height: 3.6 });

    var px = series(5, 9.0), py = series(4, 9.0);          // podium, wide bays
    var tx = series(7, 6.0), ty = series(5, 6.0);          // tower, tighter grid above
    var w = new Writer('Sample — Hospital with Transfer Slab');

    w.stories(st).grids(px, py)
      .materials([
        { name: 'M45', type: 'Concrete', w: 25, E: 33541020, fc: 45000 },
        { name: 'M35', type: 'Concrete', w: 25, E: 29580399, fc: 35000 },
        { name: 'M30', type: 'Concrete', w: 25, E: 27386127, fc: 30000 }
      ])
      .frameSections([
        { name: 'C1000X1000', mat: 'M45', shape: 'Concrete Rectangular', D: 1.00, B: 1.00 },
        { name: 'C600X600', mat: 'M45', shape: 'Concrete Rectangular', D: 0.60, B: 0.60 },
        { name: 'C400X400', mat: 'M35', shape: 'Concrete Rectangular', D: 0.40, B: 0.40 },
        { name: 'TB1000X1800', mat: 'M45', shape: 'Concrete Rectangular', D: 1.80, B: 1.00 },
        { name: 'B300X600', mat: 'M35', shape: 'Concrete Rectangular', D: 0.60, B: 0.30 },
        { name: 'B230X450', mat: 'M30', shape: 'Concrete Rectangular', D: 0.45, B: 0.23 }
      ])
      .shellSections([
        { name: 'Slab150', type: 'Slab', mat: 'M30', t: 0.15 },
        { name: 'Transfer600', type: 'Slab', mat: 'M45', t: 0.60 },
        { name: 'Slab125', type: 'Slab', mat: 'M30', t: 0.125 }
      ])
      .concreteSections([
        { name: 'C1000X1000', kind: 'Column', pattern: 'R-5-5', cover: 0.05, barArea: A25, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C600X600', kind: 'Column', pattern: 'R-3-3', cover: 0.04, barArea: A25, tieArea: A8, tieSpacing: 0.15 },
        { name: 'C400X400', kind: 'Column', pattern: 'R-2-2', cover: 0.04, barArea: A20, tieArea: A8, tieSpacing: 0.15 },
        { name: 'TB1000X1800', kind: 'Beam', cover: 0.05 },
        { name: 'B300X600', kind: 'Beam', cover: 0.035 },
        { name: 'B230X450', kind: 'Beam', cover: 0.03 }
      ]);

    // Podium: wide bays, heavy columns, transfer girders at the top level.
    var podium = frameGrid({
      xs: px, ys: py, stories: st, fromStorey: 1, toStorey: 3, prefix: 'P',
      columnSection: function () { return 'C1000X1000'; },
      beamSection: function (s) { return s === 3 ? 'TB1000X1800' : 'B300X600'; },
      slabSection: function (s) { return s === 3 ? 'Transfer600' : 'Slab150'; }
    });

    // Tower: a different grid starting on the transfer level, so its columns
    // land on the transfer slab rather than continuing to the foundation.
    var tower = frameGrid({
      xs: tx, ys: ty, stories: st, fromStorey: 4, toStorey: st.length - 1, prefix: 'T',
      noBase: true,
      columnSection: function () { return 'C400X400'; },
      beamSection: function () { return 'B230X450'; },
      slabSection: function () { return 'Slab125'; }
    });

    var merged = {
      pts: Object.assign({}, podium.pts, tower.pts),
      lineConn: podium.lineConn.concat(tower.lineConn),
      lineAssign: podium.lineAssign.concat(tower.lineAssign),
      areaConn: podium.areaConn.concat(tower.areaConn),
      areaAssign: podium.areaAssign.concat(tower.areaAssign),
      pointAssign: podium.pointAssign
    };

    w.points(merged.pts).lineConn(merged.lineConn).areaConn(merged.areaConn)
      .pointAssigns(merged.pointAssign).lineAssigns(merged.lineAssign).areaAssigns(merged.areaAssign);
    var loading = loadingFor(merged, st, LOADING);
    w.loadPatterns(LOAD_PATTERNS).areaLoads(loading.areaLoads)
      .lineLoads(loading.lineLoads).combos(LOAD_COMBOS);
    return w.text();
  }

  var SAMPLES = [
    {
      id: 'rcc', short: 'G+10', name: 'G+10 RCC Moment Frame',
      note: '5 × 4 bays · 6.0 m / 5.5 m · M30 & M40 · stepped column sizes',
      build: rccFrame, file: 'Sample-RCC-Moment-Frame.e2k'
    },
    {
      id: 'steel', short: 'G+14', name: 'G+14 Steel Braced Tower',
      note: 'UC columns, ISMB floor framing, SHS chevron bracing',
      build: steelBraced, file: 'Sample-Steel-Braced-Tower.e2k'
    },
    {
      id: 'core', short: 'G+8', name: 'G+8 Shear Wall Core',
      note: 'Flat slabs, circular internal columns, 300 mm core walls',
      build: shearWallCore, file: 'Sample-Shear-Wall-Core.e2k'
    },
    {
      id: 'tower', short: 'G+20', name: 'G+20 Flat Slab Tower',
      note: '60 m tall · 250 mm flat slabs on a 350 mm core · circular columns stepping 900 → 600',
      build: flatSlabTower, file: 'Sample-Flat-Slab-Tower.e2k'
    },
    {
      id: 'residential', short: 'Stilt+7', name: 'Stilt + 7 Residential',
      note: 'The everyday block · 3.6 × 4.2 m bays · 230 mm beams · 125 mm slabs',
      build: residentialBlock, file: 'Sample-Residential-Block.e2k'
    },
    {
      id: 'shed', short: 'Shed', name: 'Industrial Shed',
      note: '48 × 24 m steel portals · mezzanine over three bays · end bracing',
      build: industrialShed, file: 'Sample-Industrial-Shed.e2k'
    },
    {
      id: 'hospital', short: 'Hospital', name: 'Hospital, Transfer Slab',
      note: '9 m podium under a 6 m ward grid · 600 mm transfer slab · 1.8 m transfer girders',
      build: hospitalTransfer, file: 'Sample-Hospital-Transfer.e2k'
    }
  ];

  global.ETABSDemo = {
    samples: SAMPLES,
    /** @returns {string} .e2k text for the named sample. */
    text: function (id) {
      for (var i = 0; i < SAMPLES.length; i++) {
        if (SAMPLES[i].id === id) return SAMPLES[i].build();
      }
      return SAMPLES[0].build();
    }
  };
})(window);
