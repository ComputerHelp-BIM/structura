/**
 * app-actions.js — Everything the user can *do*.
 * =================================================================
 * Each action records a labelled history entry before it mutates state, so
 * undo can say "Undo: hide 42 elements" rather than stepping blindly.
 *
 * Namespace: window.ACT
 */
(function (global) {
  'use strict';

  var A = global.APP;
  var S = A.S;
  var $ = A.$;
  var toast = A.toast;
  var Units = global.ETABSUnits;

  var listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, data) { (listeners[evt] || []).forEach(function (f) { f(data); }); }

  /* ================================================================== */
  /* Camera and motion                                                   */
  /* ================================================================== */

  function toggleTurntable(cinematic) {
    var v = S.viewer;
    if (!v) return;
    var on2 = !(v.turntable.on && v.turntable.cinematic === !!cinematic);
    v.setTurntable(on2, cinematic);
    if (on2 && S.autoMusic && !S.audio.playing) {
      S.audio.play();
      S.audio.startedByRotate = true;
    }
    if (!on2 && S.audio.startedByRotate && S.audio.playing) {
      S.audio.pause();
      S.audio.startedByRotate = false;
    }
    emit('ui');
  }

  function toggleWalk() {
    var v = S.viewer;
    if (!v) return;
    var on2 = !v.walk.on;
    if (on2) A.pushHistory('enter walk mode');
    v.setWalk(on2);
    toast(on2 ? 'Walk mode — W A S D to move, Q and E for height, drag to look' : 'Walk mode off');
    emit('ui');
  }

  function setView(name) {
    if (!S.viewer) return;
    A.pushHistory('change view');
    S.viewer.setView(name);
  }

  function frameAll() {
    if (!S.viewer) return;
    A.pushHistory('zoom extents');
    S.viewer.frameAll(true);
  }

  function frameSelection() {
    if (!S.viewer || !S.viewer.selection.length) { toast('Select something first'); return; }
    A.pushHistory('zoom to selection');
    S.viewer.frameElements(S.viewer.selection);
  }

  function goHome() {
    if (!S.viewer) return;
    A.pushHistory('return home');
    S.viewer.setProjection('persp');
    S.viewer.setView('iso');
    setTimeout(function () { S.viewer.frameAll(true); }, 40);
  }

  /* ================================================================== */
  /* Display                                                             */
  /* ================================================================== */

  function setStyle(style) {
    if (!S.viewer || S.renderStyle === style) return;
    A.pushHistory('change render style');
    S.renderStyle = style;
    S.viewer.setRenderStyle(style);
    emit('ui');
  }

  function setEnvironment(name, pin) {
    if (S.environment === name && pin !== false) return;
    A.pushHistory('change environment');
    S.environment = name;
    if (pin !== false) S.envPinned = true;
    if (S.viewer) S.viewer.setEnvironment(name);
    A.refreshOverlays();
    emit('ui');
  }

  function setQualityPreset(name) {
    S.quality = name;
    A.prefSet('quality', name);
    if (S.viewer) S.viewer.setQualityPreset(name);
    if (S.overlays) {
      var cfg = { draft: 0.85, balanced: 1, presentation: 1.15 }[name] || 1;
      S.overlays.setLabelScale(S.labelScale * cfg);
    }
    emit('ui');
    toast('Quality: ' + name);
  }

  function setColorMode(mode) {
    if (S.colorMode === mode) return;
    A.pushHistory('colour by ' + mode);
    S.colorMode = mode;
    A.computeColors();
    A.computeStates();
    emit('ui');
  }

  function setPalette(name) {
    A.pushHistory('change palette');
    S.palette = name;
    A.computeColors();
    emit('ui');
  }

  /* ================================================================== */
  /* Visibility                                                          */
  /* ================================================================== */

  function isolateSelection() {
    if (!S.viewer.selection.length) { toast('Select something first'); return; }
    A.pushHistory('isolate ' + S.viewer.selection.length + ' element(s)');
    var iso = {};
    S.viewer.selection.forEach(function (id) { iso[id] = true; });
    S.isolation = iso;
    A.computeStates();
    toast('Isolated ' + S.viewer.selection.length + ' element(s) — press U to restore');
    emit('ui');
  }

  function isolateIds(ids, label) {
    if (!ids || !ids.length) { toast('Nothing to isolate'); return; }
    A.pushHistory('isolate ' + (label || ids.length + ' elements'));
    var iso = {};
    ids.forEach(function (id) { iso[id] = true; });
    S.isolation = iso;
    A.computeStates();
    emit('ui');
  }

  function isolateTypes(types) {
    if (!S.model) return;
    var ids = [];
    S.model.elements.forEach(function (e) { if (types.indexOf(e.type) >= 0) ids.push(e.id); });
    if (!ids.length) { toast('Nothing of that type in this model'); return; }
    isolateIds(ids, types.join(' + '));
    toast('Isolated ' + types.join(' + ') + ' — ' + ids.length + ' element(s)');
  }

  function hideSelection() {
    if (!S.viewer.selection.length) { toast('Select something first'); return; }
    A.pushHistory('hide ' + S.viewer.selection.length + ' element(s)');
    S.viewer.selection.forEach(function (id) { S.hidden[id] = true; });
    S.viewer.select([], false);
    A.computeStates();
    emit('ui');
  }

  function invertVisibility() {
    if (!S.model) return;
    A.pushHistory('invert visibility');
    var next = {};
    S.model.elements.forEach(function (e) { if (!S.hidden[e.id]) next[e.id] = true; });
    S.hidden = next;
    S.isolation = null;
    A.computeStates();
    emit('ui');
  }

  function showAll(silent) {
    if (!S.model) return;
    if (!silent) A.pushHistory('show everything');
    S.hidden = {};
    S.isolation = null;
    S.keyOff = {};
    Object.keys(S.typeOn).forEach(function (k) { S.typeOn[k] = true; });
    S.storeyRange = [0, S.model.stories.length - 1];
    A.computeStates();
    emit('ui');
  }

  function setStoreyRange(lo, hi, label) {
    A.pushHistory(label || 'change storey range');
    S.storeyRange = [Math.min(lo, hi), Math.max(lo, hi)];
    A.computeStates();
    emit('ui');
  }

  function setGhostMode(on2) {
    A.pushHistory(on2 ? 'ghost hidden elements' : 'fully hide elements');
    S.ghostMode = on2;
    A.computeStates();
  }

  /* ================================================================== */
  /* Clipping                                                            */
  /* ================================================================== */

  /** Fraction (0..1) of the model extent on axis i → world coordinate. */
  function at(i, f) {
    var b = S.model.bbox;
    return b.min[i] + (b.max[i] - b.min[i]) * f;
  }

  /** Box extents as [lo, hi] fractions per axis, clamped to the model. */
  function boxRange(axis) {
    var c = S.clip.boxC[axis], h = S.clip.boxSize / 2;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  /**
   * Single source of truth: turns S.clip into viewer planes. Everything
   * that changes clipping (rail, toolbar, palette, undo/redo) ends here, so
   * the picture always matches the state that history records.
   */
  function applyClip() {
    if (!S.model || !S.viewer) return;
    var defs = [];
    var clip = S.clip;
    S.overlays.clear('clipbox');

    if (clip.grid) {
      defs = gridPlanes(clip.grid);
    } else if (clip.storey) {
      defs = storeyPlanes(S.model.storyIndex[clip.storey]);
    } else if (clip.box) {
      var lo = [], hi = [];
      ['x', 'y', 'z'].forEach(function (axis, i) {
        var r = boxRange(axis);
        lo.push(at(i, r[0])); hi.push(at(i, r[1]));
        defs.push({ axis: i, value: hi[i], sign: 1 });
        defs.push({ axis: i, value: lo[i], sign: -1 });
      });
      S.overlays.drawClipBox(lo, hi, A.overlayTheme());
    } else {
      ['x', 'y', 'z'].forEach(function (axis, i) {
        var c = clip[axis];
        if (c.on) defs.push({ axis: i, value: at(i, c.v), sign: c.sign });
      });
    }
    S.viewer.setClipPlanes(defs);
  }

  function gridPlanes(label) {
    var g = null;
    S.model.grids.forEach(function (gr) { if (gr.label === label && !g) g = gr; });
    if (!g) return [];
    var axis = g.dir === 'Y' ? 1 : 0;
    var coord = g.coord * S.model.meta.units.lengthToM;
    var b = S.model.bbox;
    var band = Math.max(0.6, Math.max(b.size[0], b.size[1]) * 0.03);
    return [
      { axis: axis, value: coord + band, sign: 1 },
      { axis: axis, value: coord - band, sign: -1 }
    ];
  }

  function storeyPlanes(index) {
    var stories = S.model.stories;
    if (index === undefined || index < 0 || index >= stories.length) return [];
    var scale = S.model.meta.units.lengthToM;
    var top = stories[index].elev * scale;
    // The lowest level has nothing below it; keep a 1 m band so its
    // columns/footings still show instead of an empty slice.
    var below = index > 0 ? stories[index - 1].elev * scale : top - 1.0;
    return [
      { axis: 2, value: top + 0.05, sign: 1 },
      { axis: 2, value: below + 0.05, sign: -1 }
    ];
  }

  /** Leave grid/storey modes; used before any manual plane or box edit. */
  function leaveNamedCuts() {
    if (!S.clip.grid && !S.clip.storey) return false;
    S.clip.grid = ''; S.clip.storey = '';
    S.viewer.setProjection('persp');
    return true;
  }

  function setClipAxis(axis, on) {
    A.pushHistory((on ? 'clip on ' : 'remove clip on ') + axis.toUpperCase());
    leaveNamedCuts();
    S.clip[axis].on = on;
    if (on) S.clip.box = false;
    applyClip();
    emit('ui'); emit('rebuild-rail');
  }

  function flipClip(axis) {
    A.pushHistory('flip clip ' + axis.toUpperCase());
    S.clip[axis].sign *= -1;
    if (!S.clip[axis].on && !S.clip.box) S.clip[axis].on = true;
    applyClip();
    emit('ui'); emit('rebuild-rail');
  }

  /**
   * Slider drag on an axis. In box mode it moves the box centre, otherwise
   * the single plane. History is recorded once per drag by the rail.
   */
  function setClipPosition(axis, v) {
    var switched = leaveNamedCuts();
    if (S.clip.box) S.clip.boxC[axis] = v;
    else {
      S.clip[axis].v = v;
      if (!S.clip[axis].on) { S.clip[axis].on = true; switched = true; }
    }
    applyClip();
    if (switched) emit('ui');
  }

  function setBoxSize(v) {
    leaveNamedCuts();
    S.clip.boxSize = v;
    if (!S.clip.box) { S.clip.box = true; emit('rebuild-rail'); }
    applyClip();
  }

  function toggleBox(force) {
    var on = typeof force === 'boolean' ? force : !S.clip.box;
    A.pushHistory(on ? 'box clip' : 'remove box clip');
    leaveNamedCuts();
    S.clip.box = on;
    applyClip();
    if (on) toast('Box clip on — drag X / Y / Z to move it, Box size to grow it');
    emit('ui'); emit('rebuild-rail');
  }

  function centreBox() {
    A.pushHistory('recentre box');
    S.clip.boxC = { x: 0.5, y: 0.5, z: 0.5 };
    applyClip();
    emit('rebuild-rail');
  }

  /** Fit the box snugly around the current selection. */
  function boxToSelection() {
    var ids = S.viewer.selection;
    if (!ids || !ids.length) { toast('Select something first'); return; }
    var b = S.model.bbox, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    ids.forEach(function (id) {
      var e = S.model.elements[id];
      if (!e) return;
      (e.pts || [e.a, e.b]).forEach(function (p) {
        if (!p) return;
        for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
      });
    });
    if (!isFinite(lo[0])) return;
    A.pushHistory('box around selection');
    leaveNamedCuts();
    var size = 0;
    ['x', 'y', 'z'].forEach(function (axis, i) {
      var span = b.max[i] - b.min[i] || 1;
      S.clip.boxC[axis] = ((lo[i] + hi[i]) / 2 - b.min[i]) / span;
      size = Math.max(size, (hi[i] - lo[i]) / span);
    });
    S.clip.boxSize = Math.min(1, size + 0.08);   // a little breathing room
    S.clip.box = true;
    applyClip();
    emit('ui'); emit('rebuild-rail');
  }

  function clipToGrid(label) {
    if (!label) { clearNamedCut('grid'); return; }
    if (!gridPlanes(label).length) return;
    A.pushHistory('section on grid ' + label);
    var g = S.model.grids.filter(function (gr) { return gr.label === label; })[0];
    S.clip.storey = '';
    S.clip.grid = label;
    applyClip();
    S.viewer.setView(g.dir === 'Y' ? 'front' : 'right');
    S.viewer.setProjection('ortho');
    toast('Section on grid ' + label);
    emit('ui');
  }

  function clipToStorey(index) {
    var stories = S.model.stories;
    if (isNaN(index) || index < 0 || index >= stories.length) { clearNamedCut('storey'); return; }
    A.pushHistory('plan slice at ' + stories[index].name);
    S.clip.grid = '';
    S.clip.storey = stories[index].name;
    applyClip();
    S.viewer.setView('top');
    S.viewer.setProjection('ortho');
    toast('Plan slice: ' + stories[index].name);
    emit('ui');
  }

  /** Picking the blank "—" option in a grid/storey list undoes just that cut. */
  function clearNamedCut(kind) {
    if (!S.clip[kind]) return;
    A.pushHistory(kind === 'grid' ? 'leave grid section' : 'leave plan slice');
    S.clip[kind] = '';
    S.viewer.setProjection('persp');
    applyClip();
    emit('ui');
  }

  function clearClipping() {
    A.pushHistory('clear clipping');
    var keep = S.clip;
    S.clip = A.defaultClip();
    // Keep where the user left the sliders so re-enabling feels natural.
    ['x', 'y', 'z'].forEach(function (a) { S.clip[a].v = keep[a].v; S.clip[a].sign = keep[a].sign; });
    S.clip.boxC = keep.boxC; S.clip.boxSize = keep.boxSize;
    applyClip();
    S.viewer.setProjection('persp');
    emit('ui');
    emit('rebuild-rail');
  }

  /* ================================================================== */
  /* Explode                                                             */
  /* ================================================================== */

  function setExplode(part, value) {
    explodeAnim++;                       // a manual drag stops any running animation
    S.explode[part] = value;
    S.viewer.setExplode(S.explode.storey, S.explode.radial, S.explode.type);
    emit('ui');
  }

  /* One explode animation at a time: a new one cancels the old. */
  var explodeAnim = 0;

  /** Animate S.explode from its current values to `to` over `dur` ms. */
  function tweenExplode(to, dur, done) {
    var token = ++explodeAnim;
    var from = { storey: S.explode.storey, radial: S.explode.radial, type: S.explode.type };
    var start = performance.now();
    (function step() {
      if (token !== explodeAnim) return;                 // superseded
      var k = Math.min(1, (performance.now() - start) / dur);
      var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease in-out
      ['storey', 'radial', 'type'].forEach(function (p) {
        S.explode[p] = from[p] + (to[p] - from[p]) * e;
      });
      S.viewer.setExplode(S.explode.storey, S.explode.radial, S.explode.type);
      if (k < 1) requestAnimationFrame(step);
      else { emit('rebuild-rail'); emit('ui'); if (done) done(); }
    })();
  }

  function isExploded() {
    return S.explode.storey > 1e-3 || S.explode.radial > 1e-3 || S.explode.type > 1e-3;
  }

  /** Bring everything back together — animated, and undoable. */
  function resetExplode() {
    if (!isExploded()) return;
    A.pushHistory('reset explode');
    tweenExplode({ storey: 0, radial: 0, type: 0 }, 900);
  }

  /**
   * Toggle: fans the storeys apart when assembled, and folds them back
   * together when already exploded (the toolbar button and Animate both
   * call this, so a second press reverses the first).
   */
  function animateExplode() {
    if (isExploded()) {
      A.pushHistory('collapse the explode');
      tweenExplode({ storey: 0, radial: 0, type: 0 }, 1100);
      return;
    }
    A.pushHistory('explode the storeys');
    var target = (S.viewer.modelRadius || 20) * 0.22;
    tweenExplode({ storey: target, radial: S.explode.radial, type: S.explode.type }, 1400);
  }

  /* ================================================================== */
  /* Load intensity                                                      */
  /* ================================================================== */

  /** Switch the load case / combination the heat map shows. */
  function setLoadBasis(basis) {
    A.pushHistory('load basis ' + basis);
    S.load.basis = basis;
    A.computeLoads();
    enterLoadMode();
  }

  function setLoadSelfWeight(on) {
    A.pushHistory(on ? 'include self weight' : 'exclude self weight');
    S.load.selfWeight = on;
    A.computeLoads();
    enterLoadMode();
  }

  function setLoadScope(scope) {
    A.pushHistory('load scale: ' + scope);
    S.load.scope = scope;
    enterLoadMode();
  }

  function setLoadLabels(on) {
    S.load.labels = on;
    A.refreshOverlays();
    emit('ui');
  }

  /** Make sure the view is actually showing the map after a change. */
  function enterLoadMode() {
    if (S.colorMode !== 'load') {
      S.load.previousMode = S.colorMode;
      S.colorMode = 'load';
    }
    A.computeColors();
    A.refreshOverlays();
    emit('ui');
    emit('rebuild-rail');
    emit('drawer-refresh');
  }

  /**
   * Turn the load map on, or off again. Pressing the button a second time
   * returns to the colour mode you were using before.
   */
  function showLoadMap() {
    if (S.colorMode === 'load') {
      A.pushHistory('turn the load map off');
      S.colorMode = S.load.previousMode || 'type';
      A.computeColors();
      A.refreshOverlays();
      emit('ui'); emit('rebuild-rail'); emit('drawer-refresh');
      toast('Load map off — colouring by ' + S.colorMode);
      return;
    }
    A.pushHistory('show the load map');
    S.load.previousMode = S.colorMode;
    A.computeLoads();
    enterLoadMode();
    emit('open-drawer', 'loads');
    var r = S.load.result;
    if (r && !r.hasLoads) toast('This model carries no assigned loads — only self weight is shown', 'err');
  }

  /** Jump the camera to one storey's worst slab or beam. */
  function focusWorst(floorName, kind) {
    var r = S.load.result;
    if (!r) return;
    var f = r.byFloor[floorName];
    if (!f) return;
    var id = kind === 'beam' ? f.worstBeam : f.worstSlab;
    if (id === null || id === undefined) { toast('Nothing loaded on ' + floorName); return; }
    S.viewer.select([id]);
    S.viewer.frameElements([id]);
    emit('ui');
  }

  /** Select every slab and beam the current case leaves at zero. */
  function selectUnloaded() {
    var r = S.load.result;
    if (!r) return;
    var ids = [];
    S.model.elements.forEach(function (e, i) {
      // Floor panels only, and "unloaded" means nothing assigned in this
      // case — self weight does not count, and a bare beam is normal.
      if (e.kind !== 'area' || !global.ETABSLoads.AREA_TYPES[e.type]) return;
      if ((r.appliedValues ? r.appliedValues[i] : r.values[i]) <= 1e-6) ids.push(i);
    });
    if (!ids.length) { toast('Every floor panel carries an assigned load in this case', 'ok'); return; }
    A.pushHistory('select unloaded panels');
    S.viewer.select(ids);
    toast(ids.length + ' floor panel(s) carry no assigned load in this case');
    emit('ui');
  }

  /** Select every element carrying (almost) the same intensity. */
  function selectSameLoad(id) {
    var r = S.load.result;
    if (!r || id === undefined || id === null) return;
    var target = r.values[id];
    var src = S.model.elements[id];
    if (!global.ETABSLoads.carries(src)) { toast('That element carries no assigned load'); return; }
    var tol = Math.max(0.05, Math.abs(target) * 0.02);            // 2 %, min 0.05
    var ids = [];
    S.model.elements.forEach(function (e, i) {
      if (e.kind !== src.kind) return;
      if (Math.abs(r.values[i] - target) <= tol) ids.push(i);
    });
    A.pushHistory('select the same load');
    S.viewer.select(ids);
    toast(ids.length + ' element(s) at ' + global.ETABSLoads.fmt(target, global.ETABSLoads.unitFor(src)));
    emit('ui');
  }

  /* ================================================================== */
  /* Reinforcement                                                       */
  /* ================================================================== */

  var DIA_COLOURS = {
    8:  [0.55, 0.60, 0.66],
    10: [0.20, 0.66, 0.72],
    12: [0.26, 0.70, 0.49],
    16: [0.90, 0.68, 0.22],
    20: [0.88, 0.45, 0.19],
    25: [0.80, 0.22, 0.24],
    28: [0.66, 0.26, 0.55],
    32: [0.45, 0.35, 0.72]
  };

  function diaColour(b) { return DIA_COLOURS[b.dia] || [0.62, 0.64, 0.68]; }

  /** Which elements the bars are drawn for, from the chosen scope. */
  function rebarScopeIds() {
    var R = A.rebarSettings();
    var ids = [];
    if (R.scope === 'selection' && S.viewer.selection.length) return S.viewer.selection.slice();
    var range = S.storeyRange;
    A.visibleIds().forEach(function (id) {
      var e = S.model.elements[id];
      if (!e || !global.ETABSRebar.detailable(e)) return;
      if (R.scope === 'storey' && range && (e.storyIndex < range[0] || e.storyIndex > range[1])) return;
      ids.push(id);
    });
    return ids;
  }

  /** Centre of an element — used to pull the cage apart. */
  function elementCentre(e) {
    if (e.kind === 'frame') return [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2];
    if (e.kind === 'area') {
      var c = [0, 0, 0];
      e.pts.forEach(function (p) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
      return [c[0] / e.pts.length, c[1] / e.pts.length, c[2] / e.pts.length];
    }
    return e.p;
  }

  /**
   * Thin ties and mesh for display only when a model would otherwise draw
   * hundreds of thousands of bars. Quantities always use every bar; the
   * panel says when the picture is thinned.
   */
  function displayBars(result, R) {
    var bars = result.bars;
    var segs = 0;
    bars.forEach(function (b) { segs += b.pts.length - 1; });
    var every = 1;
    if (R.thinning !== 'none' && segs > R.maxSegments) {
      every = Math.ceil(segs / R.maxSegments);
    }
    var out = [], seen = {};
    bars.forEach(function (b) {
      if (b.kind === 'main') { out.push(b); return; }
      var k = b.element + '|' + b.kind;
      seen[k] = (seen[k] || 0) + 1;
      if (every === 1 || seen[k] % every === 0) out.push(b);
    });
    return { bars: out, every: every };
  }

  /** Apply the explode offset, which pushes each bar away from its member. */
  function explodeBars(bars, amount) {
    if (!amount) return bars;
    var centres = {};
    return bars.map(function (b) {
      var c = centres[b.element] || (centres[b.element] = elementCentre(S.model.elements[b.element]));
      var mid = b.pts[Math.floor(b.pts.length / 2)];
      var d = [mid[0] - c[0], mid[1] - c[1], mid[2] - c[2]];
      var l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
      var k = amount * (b.kind === 'main' ? 0.35 : 0.8);
      var o = [d[0] / l * k, d[1] / l * k, d[2] / l * k];
      return {
        pts: b.pts.map(function (p) { return [p[0] + o[0], p[1] + o[1], p[2] + o[2]]; }),
        dia: b.dia, kind: b.kind, element: b.element, type: b.type,
        story: b.story, section: b.section, length: b.length, kg: b.kg, label: b.label
      };
    });
  }

  /** Build the bars, push them to the viewer, and record what was drawn. */
  function rebuildRebar(quiet) {
    if (!S.model || !S.viewer) return;
    var R = A.rebarSettings();
    if (!S.rebar.on) { S.viewer.clearRebar(); return; }

    var t0 = performance.now();
    var ids = rebarScopeIds();
    S.rebar.result = global.ETABSRebar.build(S.model, ids, R);

    var disp = displayBars(S.rebar.result, R);
    var bars = R.style === 'lines' ? disp.bars : disp.bars;
    var shown = explodeBars(bars, R.explode * (S.viewer.modelRadius || 20) * 0.02);
    var stats = S.viewer.setRebar(shown, {
      thickness: R.style === 'lines' ? 0.5 : S.rebar.thickness,
      colorOf: diaColour,
      maxSegments: R.maxSegments
    });
    stats.every = disp.every;
    stats.ms = Math.round(performance.now() - t0);
    stats.elements = ids.length;
    S.rebar.stats = stats;

    // Concrete gets out of the way so the cage is readable.
    if (R.style === 'barsOnly') S.viewer.setRenderStyle('wireframe');
    else if (R.style === 'cutaway') S.viewer.setRenderStyle('xray');
    else S.viewer.setRenderStyle(S.renderStyle === 'xray' ? 'solid' : S.renderStyle);

    if (!quiet) emit('ui');
    emit('rebuild-rail');
    emit('drawer-refresh');
  }

  /** Turn the reinforcement view on, or off again. */
  function toggleRebar(force) {
    var on = typeof force === 'boolean' ? force : !S.rebar.on;
    A.pushHistory(on ? 'show reinforcement' : 'hide reinforcement');
    if (on) S.rebar.previousStyle = S.renderStyle;
    S.rebar.on = on;
    if (!on) {
      S.viewer.clearRebar();
      S.viewer.setRenderStyle(S.rebar.previousStyle || 'solid');
      S.rebar.result = null;
      S.rebar.stats = null;
      emit('ui'); emit('rebuild-rail'); emit('drawer-refresh');
      return;
    }
    toast('Building the cage…');
    setTimeout(function () {
      rebuildRebar();
      emit('open-drawer', 'rebar');
      var st = S.rebar.stats;
      if (st && st.capped) {
        toast('Showing ' + st.segments.toLocaleString() + ' bar lengths — quantities still count every bar');
      }
    }, 30);
  }

  /** Change one reinforcement setting and redraw. */
  function setRebarSetting(key, value) {
    var R = A.rebarSettings();
    if (R[key] === value) return;
    R[key] = value;
    global.ETABSRebar.save(R);
    if (S.rebar.on) rebuildRebar(true);
    emit('ui'); emit('rebuild-rail'); emit('drawer-refresh');
  }

  function setRebarThickness(v) {
    S.rebar.thickness = v;
    if (S.rebar.on) rebuildRebar(true);
  }

  function resetRebarSettings() {
    A.pushHistory('reset reinforcement settings');
    S.rebar.settings = global.ETABSRebar.reset();
    if (S.rebar.on) rebuildRebar();
    emit('rebuild-rail');
  }

  /** Fly to one member with its cage showing, and draw its section. */
  function inspectBars(id) {
    if (id === undefined || id === null) return;
    var e = S.model.elements[id];
    if (!e || !global.ETABSRebar.detailable(e)) { toast('That element has no bars to show'); return; }
    A.pushHistory('inspect the bars');
    var R = A.rebarSettings();
    R.scope = 'selection';
    global.ETABSRebar.save(R);
    S.viewer.select([id]);
    S.rebar.sectionId = id;
    S.rebar.on = true;
    rebuildRebar(true);
    S.viewer.frameElements([id]);
    emit('open-drawer', 'rebar');
    emit('ui');
  }

  /** A thin slice across the member, so the section reads like a drawing. */
  function sectionThroughMember(id) {
    var e = S.model.elements[id === undefined ? S.rebar.sectionId : id];
    if (!e || e.kind !== 'frame') { toast('Pick a column, beam or brace first'); return; }
    A.pushHistory('section through the member');
    var mid = elementCentre(e);
    var vertical = Math.abs(e.b[2] - e.a[2]) > Math.abs(e.b[0] - e.a[0]) + Math.abs(e.b[1] - e.a[1]);
    var axis = vertical ? 2 : (Math.abs(e.b[0] - e.a[0]) > Math.abs(e.b[1] - e.a[1]) ? 0 : 1);
    var band = 0.12;
    S.clip.grid = ''; S.clip.storey = ''; S.clip.box = false;
    S.viewer.setClipPlanes([
      { axis: axis, value: mid[axis] + band, sign: 1 },
      { axis: axis, value: mid[axis] - band, sign: -1 }
    ]);
    S.viewer.setView(vertical ? 'top' : (axis === 0 ? 'right' : 'front'));
    S.viewer.setProjection('ortho');
    S.viewer.frameElements([e.id]);
    toast('Section cut through ' + (e.name || e.type) + ' — Clear all clipping to leave');
    emit('ui');
  }

  /* ================================================================== */
  /* Measurement                                                         */
  /* ================================================================== */

  var MEASURE_HELP = {
    distance: 'Click two points. Snaps to joints and member ends.',
    height: 'Click two points — the vertical difference is reported.',
    area: 'Click three or more points around a region.',
    angle: 'Click three points; the middle one is the vertex.'
  };

  function setMeasureMode(mode) {
    S.measure.mode = mode;
    S.measure.points = [];
    S.overlays.clear('measure');
    S.viewer.needsRender = true;
    emit('measure', { mode: mode, text: '—', detail: mode ? MEASURE_HELP[mode] : 'measurement off' });
    emit('ui');
  }

  function snapPoint(elementId, guess) {
    var e = S.model.elements[elementId];
    if (!e) return guess;
    var candidates = e.kind === 'frame' ? [e.a, e.b] : (e.kind === 'area' ? e.pts : [e.p]);
    var best = candidates[0], bestD = Infinity;
    candidates.forEach(function (p) {
      var d = Math.hypot(p[0] - guess[0], p[1] - guess[1], p[2] - guess[2]);
      if (d < bestD) { bestD = d; best = p; }
    });
    return best.slice();
  }

  function addMeasurePoint(id) {
    var e = S.model.elements[id];
    if (!e) return;
    var guess = e.kind === 'frame'
      ? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2]
      : (e.kind === 'area' ? e.pts[0] : e.p);
    S.measure.points.push(snapPoint(id, guess));

    var mode = S.measure.mode, pts = S.measure.points;
    var text = '', detail = '';

    if (mode === 'distance' && pts.length >= 2) {
      var a = pts[pts.length - 2], b = pts[pts.length - 1];
      var d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      text = Units.length(d);
      detail = 'ΔX ' + Units.length(b[0] - a[0]) + '  ΔY ' + Units.length(b[1] - a[1]) +
               '  ΔZ ' + Units.length(b[2] - a[2]);
    } else if (mode === 'height' && pts.length >= 2) {
      var dz = pts[pts.length - 1][2] - pts[pts.length - 2][2];
      text = Units.length(Math.abs(dz));
      detail = 'vertical difference between the two picks';
    } else if (mode === 'area' && pts.length >= 3) {
      text = Units.area(global.ETABSParser.polygonArea3(pts));
      detail = pts.length + ' points';
    } else if (mode === 'angle' && pts.length >= 3) {
      var v1 = sub(pts[pts.length - 3], pts[pts.length - 2]);
      var v2 = sub(pts[pts.length - 1], pts[pts.length - 2]);
      var cos = dot(v1, v2) / ((len3(v1) * len3(v2)) || 1);
      text = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI).toFixed(2) + '°';
      detail = 'angle at the middle pick';
    } else {
      text = pts.length + ' point' + (pts.length === 1 ? '' : 's');
      detail = MEASURE_HELP[mode] || '';
    }

    S.overlays.drawMeasure(pts, text, A.overlayTheme(), S.viewer.modelRadius * 0.02);
    emit('measure', { mode: mode, text: text, detail: detail });
  }

  function pinMeasure() {
    if (!S.measure.points.length) { toast('Take a measurement first'); return; }
    S.measure.pinned++;
    if (S.overlays.pinMeasure(S.measure.pinned)) {
      S.measure.points = [];
      toast('Measurement kept on screen');
      emit('measure', { mode: S.measure.mode, text: '—', detail: 'kept — start the next one' });
    }
  }

  function clearMeasures() {
    S.overlays.clearPinnedMeasures();
    S.overlays.clear('measure');
    S.measure.points = [];
    S.measure.pinned = 0;
    S.viewer.needsRender = true;
    emit('measure', { mode: S.measure.mode, text: '—', detail: 'cleared' });
  }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len3(a) { return Math.hypot(a[0], a[1], a[2]); }

  /* ================================================================== */
  /* Saved views                                                         */
  /* ================================================================== */

  function saveCurrentView(name) {
    var label = name || ('View ' + (S.savedViews.length + 1));
    S.savedViews.push({ name: label, snap: A.captureSnapshot() });
    A.prefSet('savedViews', S.savedViews);
    toast('Saved as “' + label + '”');
    emit('rebuild-rail');
  }

  function restoreSavedView(v) {
    A.pushHistory('restore “' + v.name + '”');
    A.applySnapshot(v.snap);
  }

  function deleteSavedView(index) {
    S.savedViews.splice(index, 1);
    A.prefSet('savedViews', S.savedViews);
    emit('rebuild-rail');
  }

  /* ================================================================== */
  /* Selection helpers                                                   */
  /* ================================================================== */

  function selectIds(ids, additive, label) {
    if (!S.viewer) return;
    A.pushHistory(label || 'change selection');
    S.viewer.select(ids, additive);
  }

  function selectSimilar(elementId, by) {
    var ids = global.ETABSFilters.selectSimilar(S.model, elementId, by);
    selectIds(ids, false, 'select similar (' + by + ')');
    toast(ids.length + ' element(s) share that ' + by);
  }

  /* ================================================================== */
  /* Presentation and fullscreen                                         */
  /* ================================================================== */

  function setPresenting(on2) {
    S.presenting = on2;
    document.body.classList.toggle('presenting', on2);
    setTimeout(function () { if (S.viewer) S.viewer.resize(); }, 60);
    emit('ui');
  }

  function togglePresentation() {
    var next = !S.presenting;
    setPresenting(next);
    if (next) {
      if (!S.viewer.turntable.on) toggleTurntable(true);
      toast('Presentation mode — press Esc to leave');
    }
  }

  /** Fullscreen can be refused inside an embedded frame; degrade quietly. */
  function toggleFullscreen() {
    var root = document.documentElement;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) { toast('Fullscreen is not available here — presentation mode does much the same'); return; }
    var p = req.call(root);
    if (p && p.catch) {
      p.catch(function () {
        toast('Fullscreen was blocked — using presentation mode instead');
        setPresenting(true);
      });
    }
  }

  /* ================================================================== */
  /* Undo / redo                                                         */
  /* ================================================================== */

  function undo() {
    if (!S.history) return;
    var label = S.history.undo();
    if (label) toast('Undid: ' + label);
    else toast('Nothing to undo');
    emit('rebuild-rail');
  }

  function redo() {
    if (!S.history) return;
    var label = S.history.redo();
    if (label) toast('Redid: ' + label);
    else toast('Nothing to redo');
    emit('rebuild-rail');
  }

  global.ACT = {
    on: on, emit: emit,
    toggleTurntable: toggleTurntable, toggleWalk: toggleWalk,
    setView: setView, frameAll: frameAll, frameSelection: frameSelection, goHome: goHome,
    setStyle: setStyle, setEnvironment: setEnvironment, setQualityPreset: setQualityPreset,
    setColorMode: setColorMode, setPalette: setPalette,
    isolateSelection: isolateSelection, isolateIds: isolateIds, isolateTypes: isolateTypes,
    hideSelection: hideSelection, invertVisibility: invertVisibility, showAll: showAll,
    setStoreyRange: setStoreyRange, setGhostMode: setGhostMode,
    applyClip: applyClip, clipToGrid: clipToGrid, clipToStorey: clipToStorey, clearClipping: clearClipping,
    setClipAxis: setClipAxis, flipClip: flipClip, setClipPosition: setClipPosition, setBoxSize: setBoxSize,
    toggleBox: toggleBox, centreBox: centreBox, boxToSelection: boxToSelection,
    setExplode: setExplode, resetExplode: resetExplode, animateExplode: animateExplode, isExploded: isExploded,
    setLoadBasis: setLoadBasis, setLoadSelfWeight: setLoadSelfWeight, setLoadScope: setLoadScope,
    setLoadLabels: setLoadLabels, showLoadMap: showLoadMap, focusWorst: focusWorst,
    selectSameLoad: selectSameLoad, selectUnloaded: selectUnloaded,
    toggleRebar: toggleRebar, rebuildRebar: rebuildRebar, setRebarSetting: setRebarSetting,
    setRebarThickness: setRebarThickness, resetRebarSettings: resetRebarSettings,
    inspectBars: inspectBars, sectionThroughMember: sectionThroughMember,
    diaColour: diaColour,
    setMeasureMode: setMeasureMode, addMeasurePoint: addMeasurePoint,
    pinMeasure: pinMeasure, clearMeasures: clearMeasures,
    saveCurrentView: saveCurrentView, restoreSavedView: restoreSavedView, deleteSavedView: deleteSavedView,
    selectIds: selectIds, selectSimilar: selectSimilar,
    setPresenting: setPresenting, togglePresentation: togglePresentation, toggleFullscreen: toggleFullscreen,
    undo: undo, redo: redo
  };
})(window);
