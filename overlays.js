/**
 * overlays.js — Non-geometric scene layers.
 * =================================================================
 * Grid cage and bubbles, storey level markers and planes, centre-to-centre
 * dimension strings, local 1-2-3 axis triads, load vectors, persistent
 * measurements and markup pins.
 *
 * Label sizing (v1.1): every sprite is drawn with `sizeAttenuation: false`
 * and sized from a pixel height rather than a world height, so a label reads
 * the same whether the camera is across the site or inside a stair core. The
 * conversion depends on the projection, so scales are recomputed whenever the
 * viewport or camera changes rather than baked in at build time.
 *
 * Namespace: window.ETABSOverlays
 */
(function (global) {
  'use strict';

  var THREE = global.THREE;

  /* ------------------------------------------------------------------ */
  /* Text sprites                                                        */
  /* ------------------------------------------------------------------ */

  var TEXTURE_FONT = 52;   // canvas render size; screen size is set separately

  function makeLabel(text, opts) {
    opts = opts || {};
    var pad = 10;
    var font = (opts.weight || '600') + ' ' + TEXTURE_FONT +
      'px "Barlow Semi Condensed", "Barlow", system-ui, sans-serif';
    var measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    var w = Math.ceil(measure.measureText(text).width) + pad * 2;
    var h = TEXTURE_FONT + pad * 2;

    var canvas = document.createElement('canvas');
    canvas.width = nextPow2(w);
    canvas.height = nextPow2(h);
    var ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var cx = canvas.width / 2, cy = canvas.height / 2;
    if (opts.bubble) {
      var r = Math.max(w, h) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
      ctx.fillStyle = opts.fill || 'rgba(255,255,255,0.94)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = opts.stroke || '#0e7c86';
      ctx.stroke();
    } else if (opts.plate) {
      roundRect(ctx, cx - w / 2, cy - h / 2 + 4, w, h - 8, 10);
      ctx.fillStyle = opts.fill || 'rgba(16,22,29,0.82)';
      ctx.fill();
    }
    ctx.fillStyle = opts.color || (opts.bubble ? '#0e7c86' : '#ffffff');
    ctx.fillText(text, cx, cy);

    var tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    var mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: opts.depthTest !== false,
      depthWrite: false,
      sizeAttenuation: false     // constant on screen at any zoom
    });
    var sprite = new THREE.Sprite(mat);
    sprite.userData.aspect = canvas.width / canvas.height;
    return sprite;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function nextPow2(v) { return Math.pow(2, Math.ceil(Math.log(Math.max(2, v)) / Math.LN2)); }

  /* ------------------------------------------------------------------ */
  /* Line helper                                                         */
  /* ------------------------------------------------------------------ */

  function lines(segments, color, opacity, dashed) {
    var geo = new THREE.BufferGeometry();
    var pos = [];
    segments.forEach(function (s) { pos.push(s[0][0], s[0][1], s[0][2], s[1][0], s[1][1], s[1][2]); });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var mat = dashed
      ? new THREE.LineDashedMaterial({
          color: color, transparent: opacity < 1, opacity: opacity,
          dashSize: dashed, gapSize: dashed * 0.6, depthWrite: false })
      : new THREE.LineBasicMaterial({
          color: color, transparent: opacity < 1, opacity: opacity, depthWrite: false });
    var obj = new THREE.LineSegments(geo, mat);
    if (dashed) obj.computeLineDistances();
    return obj;
  }

  /* ------------------------------------------------------------------ */
  /* Builder                                                             */
  /* ------------------------------------------------------------------ */

  function Overlays(viewer) {
    this.viewer = viewer;
    this.groups = {};
    this.sprites = [];        // every label, for rescaling and decluttering
    this.labelScale = 1;      // user multiplier
    this.declutterOn = true;
    this.levelEdge = 'auto';
  }

  Overlays.prototype.group = function (name) {
    if (!this.groups[name]) {
      var g = new THREE.Group();
      g.name = name;
      this.groups[name] = g;
      this.viewer.overlayRoot.add(g);
    }
    return this.groups[name];
  };

  Overlays.prototype.clear = function (name) {
    var g = this.groups[name];
    if (!g) return;
    var self = this;
    while (g.children.length) {
      var o = g.children.pop();
      if (o.isSprite) {
        var i = self.sprites.indexOf(o);
        if (i >= 0) self.sprites.splice(i, 1);
      }
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    }
  };

  /**
   * Drop every cached group. The viewer empties `overlayRoot` when a model is
   * cleared, which orphans the Group objects this module holds — without this
   * reset the next model builds its grids into detached groups that are never
   * drawn. Called on every model load.
   */
  Overlays.prototype.reset = function () {
    var self = this;
    Object.keys(this.groups).forEach(function (k) { self.clear(k); });
    this.groups = {};
    this.sprites = [];
    this.gridInfo = null;
  };

  Overlays.prototype.setVisible = function (name, on) {
    var g = this.groups[name];
    if (g) { g.visible = !!on; this.viewer.needsRender = true; }
  };

  /* ---- Label scaling ------------------------------------------------ */

  /**
   * World-space sprite scale that yields one screen pixel of height.
   * Perspective and orthographic cameras reach this differently, so both
   * are handled rather than assuming one projection.
   */
  Overlays.prototype.pixelScale = function () {
    var h = this.viewer.container.clientHeight || 800;
    if (this.viewer.useOrtho) {
      var cam = this.viewer.orthoCamera;
      return (cam.top - cam.bottom) / h;
    }
    var fov = this.viewer.camera.fov * Math.PI / 180;
    return 2 * Math.tan(fov / 2) / h;
  };

  Overlays.prototype.place = function (sprite, x, y, z, pixels) {
    sprite.position.set(x, y, z);
    sprite.userData.px = pixels;
    this.sprites.push(sprite);
    this.scaleSprite(sprite, this.pixelScale());
    return sprite;
  };

  Overlays.prototype.scaleSprite = function (sprite, unit) {
    var px = (sprite.userData.px || 12) * this.labelScale;
    var h = px * unit;
    sprite.scale.set(h * sprite.userData.aspect, h, 1);
  };

  Overlays.prototype.updateLabelScales = function () {
    var unit = this.pixelScale();
    for (var i = 0; i < this.sprites.length; i++) this.scaleSprite(this.sprites[i], unit);
    this.viewer.needsRender = true;
  };

  Overlays.prototype.setLabelScale = function (v) {
    this.labelScale = v;
    this.updateLabelScales();
  };

  /**
   * Hide labels that would collide on screen, nearest camera wins. Runs on a
   * throttle from the viewer rather than every frame — it costs a projection
   * per sprite and the answer only changes when the camera does.
   */
  Overlays.prototype.declutter = function () {
    if (!this.declutterOn || !this.sprites.length) return;
    var cam = this.viewer.activeCamera();
    cam.updateMatrixWorld();
    var w = this.viewer.container.clientWidth || 800;
    var h = this.viewer.container.clientHeight || 600;
    var v = new THREE.Vector3();
    var placed = [];

    var items = [];
    for (var i = 0; i < this.sprites.length; i++) {
      var s = this.sprites[i];
      if (!s.parent || !s.parent.visible) continue;
      v.copy(s.position).project(cam);
      if (v.z > 1 || v.x < -1.15 || v.x > 1.15 || v.y < -1.15 || v.y > 1.15) {
        s.visible = false;
        continue;
      }
      items.push({
        sprite: s, depth: v.z,
        x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h,
        rx: (s.userData.px || 12) * this.labelScale * s.userData.aspect * 0.5,
        ry: (s.userData.px || 12) * this.labelScale * 0.5
      });
    }
    items.sort(function (a, b) { return a.depth - b.depth; });

    for (var k = 0; k < items.length; k++) {
      var it = items[k], clash = false;
      for (var j = 0; j < placed.length; j++) {
        var p = placed[j];
        if (Math.abs(it.x - p.x) < (it.rx + p.rx) && Math.abs(it.y - p.y) < (it.ry + p.ry) * 1.1) {
          clash = true; break;
        }
      }
      it.sprite.visible = !clash;
      if (!clash) placed.push(it);
    }
    this.viewer.needsRender = true;
  };

  /* ---- Grid cage + bubbles ------------------------------------------ */

  Overlays.prototype.buildGrids = function (model, theme) {
    this.clear('grids');
    var g = this.group('grids');
    if (!model.grids.length) { this.gridInfo = { x: [], y: [] }; return; }

    var scale = model.meta.units.lengthToM;
    var b = model.bbox;
    var pad = Math.max(b.size[0], b.size[1]) * 0.06 + 1;
    var z0 = b.min[2], z1 = b.max[2];
    var self = this;

    var xs = [], ys = [];
    model.grids.forEach(function (gr) {
      if (gr.visible === false) return;
      (gr.dir === 'Y' ? ys : xs).push({ coord: gr.coord * scale, label: gr.label });
    });
    xs.sort(function (a, c) { return a.coord - c.coord; });
    ys.sort(function (a, c) { return a.coord - c.coord; });
    this.gridInfo = { x: xs, y: ys };

    var segs = [];
    function bubble(x, y, z, text) {
      var s = makeLabel(text, {
        bubble: true, stroke: theme.gridBubble, color: theme.gridBubble, fill: theme.bubbleFill
      });
      g.add(self.place(s, x, y, z, 26));
    }

    xs.forEach(function (gr) {
      segs.push([[gr.coord, b.min[1] - pad, z0], [gr.coord, b.max[1] + pad, z0]]);
      segs.push([[gr.coord, b.min[1] - pad, z0], [gr.coord, b.min[1] - pad, z1]]);
      bubble(gr.coord, b.min[1] - pad * 1.5, z0, gr.label);
      bubble(gr.coord, b.max[1] + pad * 1.5, z0, gr.label);
    });
    ys.forEach(function (gr) {
      segs.push([[b.min[0] - pad, gr.coord, z0], [b.max[0] + pad, gr.coord, z0]]);
      segs.push([[b.min[0] - pad, gr.coord, z0], [b.min[0] - pad, gr.coord, z1]]);
      bubble(b.min[0] - pad * 1.5, gr.coord, z0, gr.label);
      bubble(b.max[0] + pad * 1.5, gr.coord, z0, gr.label);
    });

    if (segs.length) g.add(lines(segs, theme.grid, 0.55));
    this.viewer.needsRender = true;
  };

  /* ---- Storey levels ------------------------------------------------ */

  /**
   * Storey markers run down one edge of the building, chosen so they sit on
   * the side the camera is looking from — a stack of labels floating through
   * the model is what made this unreadable before.
   */
  Overlays.prototype.buildLevels = function (model, theme, unitFmt) {
    this.clear('levels');
    var g = this.group('levels');
    var scale = model.meta.units.lengthToM;
    var b = model.bbox;
    var pad = Math.max(b.size[0], b.size[1]) * 0.13 + 2.0;
    var segs = [];
    var self = this;

    var edge = this.pickLevelEdge(b, pad);
    model.stories.forEach(function (s) {
      var z = s.elev * scale;
      segs.push([[edge.ax, edge.ay, z], [edge.bx, edge.by, z]]);
      var sp = makeLabel(s.name + '   ' + unitFmt(z), { plate: true, fill: theme.plateFill, color: theme.plateText });
      g.add(self.place(sp, edge.lx, edge.ly, z, 13));
    });

    if (segs.length) g.add(lines(segs, theme.level, 0.5, Math.max(b.size[0], 4) * 0.02));
    this.viewer.needsRender = true;
  };

  /**
   * Per-storey load figures printed beside the model: the maximum slab
   * intensity and the maximum beam intensity on that floor, so the heaviest
   * level is readable without opening a table.
   */
  Overlays.prototype.buildLoadLabels = function (model, result, theme) {
    this.clear('loadLabels');
    if (!result) return;
    var g = this.group('loadLabels');
    var self = this;
    var scale = model.meta.units.lengthToM;
    var b = model.bbox;
    var pad = Math.max(b.size[0], b.size[1]) * 0.13 + 2;
    var edge = this.pickLevelEdge(b, pad);
    var L = global.ETABSLoads;

    result.floors.forEach(function (f) {
      if (!f.slabMax && !f.beamMax) return;
      var story = model.stories[f.index];
      if (!story) return;
      var z = story.elev * scale;
      var text = f.name + '   ' +
        (f.slabMax ? L.fmt(f.slabMax, 'kN/m²') : '—') +
        (f.beamMax ? '   ·   ' + L.fmt(f.beamMax, 'kN/m') : '');
      var sp = makeLabel(text, { plate: true, fill: theme.plateFill, color: theme.plateText });
      g.add(self.place(sp, edge.lx, edge.ly, z + 0.35, 13));
    });
    this.viewer.needsRender = true;
  };

  Overlays.prototype.pickLevelEdge = function (b, pad) {
    var cam = this.viewer.activeCamera();
    var dx = cam.position.x - b.center[0];
    var dy = cam.position.y - b.center[1];
    var useY = Math.abs(dy) >= Math.abs(dx);

    if (useY) {
      var y = dy >= 0 ? b.max[1] + pad : b.min[1] - pad;
      return {
        ax: b.min[0] - pad * 0.3, ay: y, bx: b.max[0] + pad * 0.3, by: y,
        lx: b.max[0] + pad * 1.05, ly: y
      };
    }
    var x = dx >= 0 ? b.max[0] + pad : b.min[0] - pad;
    return {
      ax: x, ay: b.min[1] - pad * 0.3, bx: x, by: b.max[1] + pad * 0.3,
      lx: x, ly: b.max[1] + pad * 1.05
    };
  };

  Overlays.prototype.buildLevelPlanes = function (model, theme) {
    this.clear('levelPlanes');
    var g = this.group('levelPlanes');
    var scale = model.meta.units.lengthToM;
    var b = model.bbox;
    var w = b.size[0] * 1.12 + 2, h = b.size[1] * 1.12 + 2;
    model.stories.forEach(function (s) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color: theme.level, transparent: true, opacity: 0.045,
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      m.position.set(b.center[0], b.center[1], s.elev * scale);
      g.add(m);
    });
    this.viewer.needsRender = true;
  };

  /* ---- Dimension strings -------------------------------------------- */

  Overlays.prototype.buildDimensions = function (model, theme, unitFmt) {
    this.clear('dims');
    var g = this.group('dims');
    var info = this.gridInfo;
    if (!info || (!info.x.length && !info.y.length)) return;
    var b = model.bbox;
    var pad = Math.max(b.size[0], b.size[1]) * 0.12 + 2;
    var z = b.min[2];
    var segs = [], tick = Math.max(b.size[0], b.size[1]) * 0.006 + 0.1;
    var self = this;

    function run(list, axis) {
      for (var i = 0; i < list.length - 1; i++) {
        var a = list[i].coord, c = list[i + 1].coord, d = c - a;
        if (d < 1e-6) continue;
        var off = axis === 'x' ? (b.min[1] - pad) : (b.min[0] - pad);
        var p0 = axis === 'x' ? [a, off, z] : [off, a, z];
        var p1 = axis === 'x' ? [c, off, z] : [off, c, z];
        segs.push([p0, p1]);
        [p0, p1].forEach(function (p) {
          var t0 = p.slice(), t1 = p.slice();
          if (axis === 'x') { t0[1] -= tick; t1[1] += tick; } else { t0[0] -= tick; t1[0] += tick; }
          segs.push([t0, t1]);
        });
        var mid = axis === 'x'
          ? [(a + c) / 2, off - tick * 3, z]
          : [off - tick * 3, (a + c) / 2, z];
        var sp = makeLabel(unitFmt(d), { plate: true, fill: theme.plateFill, color: theme.plateText });
        g.add(self.place(sp, mid[0], mid[1], mid[2], 12));
      }
    }
    run(info.x, 'x');
    run(info.y, 'y');
    if (segs.length) g.add(lines(segs, theme.dim, 0.8));
    this.viewer.needsRender = true;
  };

  /* ---- Local 1-2-3 axis triads --------------------------------------- */

  Overlays.prototype.buildLocalAxes = function (model, ids, sizeHint) {
    this.clear('axes');
    var g = this.group('axes');
    var s1 = [], s2 = [], s3 = [];

    ids.slice(0, 3000).forEach(function (id) {
      var el = model.elements[id];
      if (!el) return;
      var origin, ax;
      if (el.kind === 'frame') {
        origin = [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2, (el.a[2] + el.b[2]) / 2];
        ax = global.ETABSViewer.localAxes(el.a, el.b, el.ang);
      } else if (el.kind === 'area') {
        origin = centroid(el.pts);
        var n = global.ETABSViewer.planeNormal(el.pts);
        var e1 = [el.pts[1][0] - el.pts[0][0], el.pts[1][1] - el.pts[0][1], el.pts[1][2] - el.pts[0][2]];
        var m = Math.sqrt(e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]) || 1;
        e1 = [e1[0] / m, e1[1] / m, e1[2] / m];
        ax = { e1: e1, e2: [n[0], n[1], n[2]], e3: cross(n, e1) };
      } else return;
      s1.push([origin, add(origin, ax.e1, sizeHint)]);
      s2.push([origin, add(origin, ax.e2, sizeHint)]);
      s3.push([origin, add(origin, ax.e3, sizeHint)]);
    });

    if (s1.length) {
      g.add(lines(s1, 0xe4453a, 1));
      g.add(lines(s2, 0x3fbf5f, 1));
      g.add(lines(s3, 0x3f7fe0, 1));
    }
    this.viewer.needsRender = true;
  };

  function add(o, v, k) { return [o[0] + v[0] * k, o[1] + v[1] * k, o[2] + v[2] * k]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function centroid(pts) {
    var c = [0, 0, 0];
    pts.forEach(function (p) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
    return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
  }

  /* ---- Element labels ------------------------------------------------ */

  Overlays.prototype.buildElementLabels = function (model, ids, mode, theme) {
    this.clear('labels');
    var g = this.group('labels');
    var self = this;
    ids.slice(0, 600).forEach(function (id) {
      var el = model.elements[id];
      if (!el) return;
      var p = el.kind === 'frame'
        ? [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2, (el.a[2] + el.b[2]) / 2]
        : (el.kind === 'area' ? centroid(el.pts) : el.p);
      var text = mode === 'section' ? (el.section || el.type) : (el.name || el.type);
      var sp = makeLabel(text, { plate: true, fill: theme.plateFill, color: theme.plateText });
      g.add(self.place(sp, p[0], p[1], p[2], 12));
    });
    this.viewer.needsRender = true;
  };

  /* ---- Load vectors -------------------------------------------------- */

  Overlays.prototype.buildLoads = function (model, theme, sizeHint) {
    this.clear('loads');
    var g = this.group('loads');
    if (!model.loads || !model.loads.length) return;

    var byName = {};
    model.elements.forEach(function (el) { byName[el.name + '|' + el.story] = el; });
    var segs = [], arrow = sizeHint;

    model.loads.forEach(function (ld) {
      var el = byName[ld.target + '|' + ld.story];
      if (!el) return;
      var pts = [];
      if (ld.kind === 'point' && el.p) pts = [el.p];
      else if (ld.kind === 'line' && el.a) {
        for (var t = 0.15; t <= 0.86; t += 0.23) {
          pts.push([
            el.a[0] + (el.b[0] - el.a[0]) * t,
            el.a[1] + (el.b[1] - el.a[1]) * t,
            el.a[2] + (el.b[2] - el.a[2]) * t
          ]);
        }
      } else if (ld.kind === 'area' && el.pts) pts = [centroid(el.pts)];

      pts.forEach(function (p) {
        segs.push([[p[0], p[1], p[2] + arrow], p]);
        segs.push([p, [p[0] + arrow * 0.22, p[1], p[2] + arrow * 0.3]]);
        segs.push([p, [p[0] - arrow * 0.22, p[1], p[2] + arrow * 0.3]]);
      });
    });
    if (segs.length) g.add(lines(segs, theme.load, 0.9));
    this.viewer.needsRender = true;
  };

  /* ---- Measurements (persistent) ------------------------------------- */

  /**
   * Measurements accumulate: each completed pick set stays on screen with its
   * label until explicitly cleared, so a review can build up a set of them.
   */
  Overlays.prototype.drawMeasure = function (points, text, theme, sizeHint, groupName) {
    var name = groupName || 'measure';
    this.clear(name);
    var g = this.group(name);
    if (!points.length) return;

    var segs = [];
    for (var i = 0; i < points.length - 1; i++) segs.push([points[i], points[i + 1]]);
    if (points.length > 2) segs.push([points[points.length - 1], points[0]]);
    if (segs.length) g.add(lines(segs, theme.measure, 1));

    var self = this;
    points.forEach(function (p) {
      var m = new THREE.Mesh(
        new THREE.SphereGeometry(sizeHint * 0.18, 10, 8),
        new THREE.MeshBasicMaterial({ color: theme.measure, depthTest: false })
      );
      m.position.set(p[0], p[1], p[2]);
      m.renderOrder = 10;
      g.add(m);
    });

    if (text) {
      var c = centroid(points);
      var sp = makeLabel(text, { plate: true, fill: theme.measureFill, color: '#ffffff', depthTest: false });
      sp.renderOrder = 11;
      g.add(self.place(sp, c[0], c[1], c[2] + sizeHint * 0.6, 14));
    }
    this.viewer.needsRender = true;
  };

  /** Freeze the working measurement into a numbered permanent layer. */
  Overlays.prototype.pinMeasure = function (index) {
    var live = this.groups.measure;
    if (!live || !live.children.length) return false;
    var target = this.group('measure-' + index);
    while (live.children.length) target.add(live.children.pop());
    this.viewer.needsRender = true;
    return true;
  };

  Overlays.prototype.clearPinnedMeasures = function () {
    var self = this;
    Object.keys(this.groups).forEach(function (k) {
      if (k.indexOf('measure-') === 0) self.clear(k);
    });
  };

  /* ---- Clip box preview ---------------------------------------------- */

  Overlays.prototype.drawClipBox = function (min, max, theme) {
    this.clear('clipbox');
    var g = this.group('clipbox');
    var p = [
      [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
      [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]
    ];
    var e = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    g.add(lines(e.map(function (pair) { return [p[pair[0]], p[pair[1]]]; }), theme.measure, 0.8));
    this.viewer.needsRender = true;
  };

  global.ETABSOverlays = {
    create: function (viewer) { return new Overlays(viewer); },
    makeLabel: makeLabel
  };
})(window);
