/**
 * app-core.js — Shared application state, helpers and history.
 * =================================================================
 * Split from app.js so the UI wiring stays readable. This file owns the
 * single state object, the snapshot/restore contract that undo depends on,
 * colour computation, visibility computation and the small DOM helpers the
 * rest of the app builds with.
 *
 * Namespace: window.APP
 */
(function (global) {
  'use strict';

  var STATE = global.ETABSViewer.STATE;

  var BRAND = {
    name: 'Computer Help',
    sub: 'Building Software',
    site: 'buildingsoftware.in',
    logo: null
  };

  var VERSION = '1.8.1';

  /* ================================================================== */
  /* State                                                               */
  /* ================================================================== */

  var S = {
    version: VERSION,
    model: null,
    source: null,          // how the current model was opened, for reload
    viewer: null,
    overlays: null,
    audio: null,
    history: null,
    panels: null,

    colorMode: 'type',
    palette: 'engineering',
    customColors: {},
    keyOff: {},
    typeOn: {},
    storeyRange: null,
    hidden: {},
    isolation: null,
    ghostMode: true,
    renderStyle: 'solid',
    environment: 'studio',
    envPinned: false,
    quality: 'balanced',

    clip: defaultClip(),
    explode: { storey: 0, radial: 0, type: 0 },
    // Load-intensity map. `result` is derived (recomputed from basis +
    // selfWeight whenever the model or the settings change), so it is never
    // part of an undo snapshot.
    load: {
      basis: 'service', selfWeight: true, scope: 'building', labels: true,
      previousMode: 'type', result: null
    },
    // Reinforcement. `settings` persists across sessions; `result` and
    // `stats` are derived and rebuilt whenever anything changes.
    rebar: {
      on: false, settings: null, result: null, stats: null,
      thickness: 1.6, previousStyle: 'solid', sectionId: null, hovered: null
    },
    measure: { mode: null, points: [], pinned: 0 },

    filter: { conditions: [], lastIds: null },
    costing: null,
    scope: 'visible',

    savedViews: [],
    compare: null,
    drawerTab: 'properties',
    drawerOpen: false,
    pinned: [],
    autoMusic: true,
    presenting: false,
    theme: 'system',
    labelScale: 1,
    sessionStart: Date.now(),
    tourStep: -1,
    captureScale: 2
  };

  /* ================================================================== */
  /* DOM helpers                                                         */
  /* ================================================================== */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function tip(node, text, key) {
    if (text) node.setAttribute('data-tip', text);
    if (key) node.setAttribute('data-key', key);
    return node;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ================================================================== */
  /* Preferences                                                         */
  /* ================================================================== */

  function prefGet(key, fallback) {
    try {
      var v = localStorage.getItem('structura.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }

  function prefSet(key, value) {
    try { localStorage.setItem('structura.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  /* ================================================================== */
  /* Toasts                                                              */
  /* ================================================================== */

  function toast(message, kind) {
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''));
    t.textContent = message;
    $('toasts').appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 320);
    }, kind === 'err' ? 5200 : 3000);
  }

  /* ================================================================== */
  /* Colour                                                              */
  /* ================================================================== */

  var PALETTES = {
    engineering: ['#1f6f78', '#3f8f7d', '#c6852a', '#7d5ba6', '#2f6ea8', '#a8562f', '#4d7a4f', '#8a4f6d',
                  '#5b6b7a', '#b0603c', '#3c8f9c', '#8f7a2a'],
    blueprint:   ['#2a6fb0', '#3f8fd0', '#5fa8e0', '#1f4f80', '#7fc0ea', '#2f8fae', '#4a6fa0', '#6fb5c8',
                  '#3a5f90', '#8fd0e8', '#265f95', '#5a9fc0'],
    mono:        ['#3a444c', '#586670', '#76838c', '#94a0a8', '#2a3238', '#68757e', '#48545c', '#8a969e',
                  '#343c44', '#7e8a92', '#525e66', '#9aa6ae'],
    contrast:    ['#0b6e4f', '#b3312c', '#1f5fa8', '#c47b00', '#6a3fa0', '#0f7d8a', '#8a2f5f', '#4a7a1f',
                  '#a0441f', '#2f4f9f', '#7a6a10', '#9f2f7a'],
    neon:        ['#00b8a9', '#f6416c', '#3fa7ff', '#ffb830', '#8a5cff', '#00c96b', '#ff6b3d', '#2ee6d6',
                  '#ff3fa4', '#6be03f', '#3f6bff', '#ffd93f'],
    pastel:      ['#7eb8b3', '#e0a3a3', '#9db4d4', '#e5c68a', '#b9a3d4', '#8fc7a8', '#e0b295', '#a3ccd4',
                  '#d4a3c0', '#b6cf9a', '#9fa9d4', '#d8cb95']
  };

  var TYPE_FALLBACK = {
    Column: '#1f6f78', Beam: '#3f8f7d', Brace: '#c6852a', Slab: '#8a949c', Wall: '#5b6b7a',
    Ramp: '#a8562f', Opening: '#b3312c', Joint: '#6c7a85', Fixed: '#2a3238',
    Pinned: '#3a444c', Roller: '#4a545c', Deck: '#7d8a92'
  };

  var COLOR_MODES = [
    { id: 'type', label: 'Type', tip: 'Columns, beams, braces, slabs and walls each get a colour' },
    { id: 'material', label: 'Grade', tip: 'Shows where the concrete or steel grade changes' },
    { id: 'section', label: 'Section', tip: 'Every distinct section profile gets its own colour' },
    { id: 'storey', label: 'Storey', tip: 'A colour per level' },
    { id: 'height', label: 'Height', tip: 'A gradient by elevation' },
    { id: 'length', label: 'Length', tip: 'A gradient by member length — good for spotting odd members' },
    { id: 'load', label: 'Load', tip: 'Heat map of the applied load each slab and beam carries' },
    { id: 'none', label: 'No colour', tip: 'Plain neutral grey, for presentation renders' }
  ];

  function colorKey(elm) {
    switch (S.colorMode) {
      case 'type': return elm.type;
      case 'material': return elm.material || '(unstated)';
      case 'section': return elm.section || '(none)';
      case 'storey': return elm.story || '—';
      default: return elm.type;
    }
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /** Perceptual ramp for continuous colour modes: teal → ochre → crimson. */
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    var stops = [[26, 92, 110], [52, 150, 140], [198, 163, 62], [190, 104, 48], [165, 52, 60]];
    var f = t * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(f));
    var k = f - i;
    return [
      stops[i][0] + (stops[i + 1][0] - stops[i][0]) * k,
      stops[i][1] + (stops[i + 1][1] - stops[i][1]) * k,
      stops[i][2] + (stops[i + 1][2] - stops[i][2]) * k
    ];
  }

  function colorFor(key, index) {
    var custom = S.customColors[S.colorMode + '|' + key];
    if (custom) return custom;
    if (S.colorMode === 'type' && S.palette === 'engineering' && TYPE_FALLBACK[key]) return TYPE_FALLBACK[key];
    var pal = PALETTES[S.palette] || PALETTES.engineering;
    return pal[index % pal.length];
  }

  var legendKeys = [];
  var legendRange = null;
  var colorListeners = [];

  function onColorsChanged(fn) { colorListeners.push(fn); }

  /** Reinforcement settings, loaded from storage on first use. */
  function rebarSettings() {
    if (!S.rebar.settings) S.rebar.settings = global.ETABSRebar.load();
    return S.rebar.settings;
  }

  /** Recompute the load map from the current basis; safe to call often. */
  function computeLoads() {
    if (!S.model || !global.ETABSLoads) { S.load.result = null; return null; }
    S.load.result = global.ETABSLoads.compute(S.model, {
      basis: S.load.basis, selfWeight: S.load.selfWeight
    });
    return S.load.result;
  }

  /**
   * Colour by applied load. Slabs (kN/m²) and beams (kN/m) are different
   * quantities, so each is scaled against its own maximum — the legend shows
   * both ranges. The scale is the whole building's by default; "this floor"
   * rescales to the floors currently in view so variation inside one floor
   * becomes visible.
   */
  function applyLoadColours(els, v) {
    var L = global.ETABSLoads;
    var r = S.load.result || computeLoads();
    if (!r) { legendKeys = []; v.syncLut(); return; }

    var slabMax = r.slabMax, beamMax = r.beamMax;
    var slabMin = 0, beamMin = 0;

    if (S.load.scope === 'spread') {
      // Stretch the ramp between the lightest and the heaviest, so a model
      // loaded almost uniformly still shows where it differs.
      slabMin = Infinity; beamMin = Infinity; slabMax = 0; beamMax = 0;
      for (var s = 0; s < els.length; s++) {
        if (!L.carries(els[s])) continue;
        var val = r.values[s];
        if (els[s].kind === 'area') {
          if (val < slabMin) slabMin = val;
          if (val > slabMax) slabMax = val;
        } else {
          if (val < beamMin) beamMin = val;
          if (val > beamMax) beamMax = val;
        }
      }
      if (!isFinite(slabMin)) slabMin = 0;
      if (!isFinite(beamMin)) beamMin = 0;
      if (slabMax - slabMin < 1e-6) slabMin = 0;
      if (beamMax - beamMin < 1e-6) beamMin = 0;
    } else if (S.load.scope === 'floor') {
      slabMax = 0; beamMax = 0;
      var range = S.storeyRange;
      r.floors.forEach(function (f) {
        if (range && (f.index < range[0] || f.index > range[1])) return;
        if (f.slabMax > slabMax) slabMax = f.slabMax;
        if (f.beamMax > beamMax) beamMax = f.beamMax;
      });
    }
    slabMax = slabMax || 1; beamMax = beamMax || 1;

    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      var c;
      if (L.carries(e)) {
        var max = e.kind === 'area' ? slabMax : beamMax;
        var min = e.kind === 'area' ? slabMin : beamMin;
        c = L.ramp((r.values[i] - min) / ((max - min) || 1));
      } else {
        // Columns, walls and joints are context here, not part of the map.
        var g = e.kind === 'joint' ? 150 : 196;
        c = [g, g + 3, g + 7];
      }
      v.setElementColor(i, c[0], c[1], c[2]);
    }

    legendKeys = [];
    legendRange = {
      kind: 'load', slabMax: slabMax, beamMax: beamMax,
      slabMin: slabMin, beamMin: beamMin,
      basis: r.basisLabel, selfWeight: r.selfWeight,
      scope: S.load.scope, empty: !r.hasLoads
    };
    v.syncLut();
    colorListeners.forEach(function (f) { f(); });
  }

  function computeColors() {
    if (!S.model || !S.viewer) return;
    var els = S.model.elements;
    var v = S.viewer;
    legendRange = null;

    if (S.compare) { applyCompareColours(); return; }

    if (S.colorMode === 'none') {
      legendKeys = [];
      for (var i = 0; i < els.length; i++) {
        var n = els[i].kind === 'joint' ? 120 : 176;
        v.setElementColor(i, n, n + 4, n + 10);
      }
      v.syncLut();
      colorListeners.forEach(function (f) { f(); });
      return;
    }

    if (S.colorMode === 'load') { applyLoadColours(els, v); return; }

    if (S.colorMode === 'height' || S.colorMode === 'length') {
      var min = Infinity, max = -Infinity;
      var vals = new Float64Array(els.length);
      for (var j = 0; j < els.length; j++) {
        var e = els[j];
        var val = S.colorMode === 'length'
          ? (e.length || 0)
          : (e.kind === 'frame' ? (e.a[2] + e.b[2]) / 2 : (e.kind === 'area' ? e.pts[0][2] : e.p[2]));
        vals[j] = val;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      var span = (max - min) || 1;
      for (var k = 0; k < els.length; k++) {
        var c = ramp((vals[k] - min) / span);
        v.setElementColor(k, c[0], c[1], c[2]);
      }
      legendKeys = [];
      legendRange = { min: min, max: max };
      v.syncLut();
      colorListeners.forEach(function (f) { f(); });
      return;
    }

    var counts = {};
    els.forEach(function (e2) {
      var key = colorKey(e2);
      counts[key] = (counts[key] || 0) + 1;
    });
    var keys = Object.keys(counts).sort();
    legendKeys = keys.map(function (key, idx) {
      return { key: key, count: counts[key], color: colorFor(key, idx) };
    });
    var map = {};
    legendKeys.forEach(function (lk) { map[lk.key] = hexToRgb(lk.color); });

    for (var m = 0; m < els.length; m++) {
      var rgb = map[colorKey(els[m])] || [140, 148, 154];
      v.setElementColor(m, rgb[0], rgb[1], rgb[2]);
    }
    v.syncLut();
    colorListeners.forEach(function (f) { f(); });
  }

  /** Revision comparison paints over the colour mode until it is cleared. */
  function applyCompareColours() {
    var diff = S.compare.diff;
    var tagged = {};
    diff.modified.forEach(function (m) {
      var id = findByGeometry(m.before);
      if (id >= 0) tagged[id] = 'mod';
    });
    diff.removed.forEach(function (e) {
      var id = findByGeometry(e);
      if (id >= 0) tagged[id] = 'rem';
    });
    for (var i = 0; i < S.model.elements.length; i++) {
      var t = tagged[i];
      if (t === 'mod') S.viewer.setElementColor(i, 214, 158, 46);
      else if (t === 'rem') S.viewer.setElementColor(i, 196, 60, 52);
      else S.viewer.setElementColor(i, 148, 156, 162);
    }
    legendKeys = [
      { key: 'Modified', count: diff.summary.modified, color: '#d69e2e', locked: true },
      { key: 'Removed', count: diff.summary.removed, color: '#c43c34', locked: true },
      { key: 'Unchanged', count: diff.summary.unchanged, color: '#949ca2', locked: true }
    ];
    S.viewer.syncLut();
    colorListeners.forEach(function (f) { f(); });
  }

  function findByGeometry(target) {
    var best = -1;
    S.model.elements.forEach(function (e) {
      if (best >= 0 || e.kind !== target.kind || e.type !== target.type) return;
      if (e.kind === 'frame' &&
          Math.abs(e.a[0] - target.a[0]) < 0.01 && Math.abs(e.a[1] - target.a[1]) < 0.01 &&
          Math.abs(e.a[2] - target.a[2]) < 0.01) best = e.id;
      if (e.kind === 'area' && e.pts.length === target.pts.length &&
          Math.abs(e.pts[0][0] - target.pts[0][0]) < 0.01 &&
          Math.abs(e.pts[0][2] - target.pts[0][2]) < 0.01) best = e.id;
    });
    return best;
  }

  /* ================================================================== */
  /* Visibility                                                          */
  /* ================================================================== */

  var stateListeners = [];
  function onStatesChanged(fn) { stateListeners.push(fn); }

  function computeStates() {
    if (!S.model || !S.viewer) return;
    var els = S.model.elements, v = S.viewer;
    var lo = S.storeyRange ? S.storeyRange[0] : -1;
    var hi = S.storeyRange ? S.storeyRange[1] : 1e9;
    var iso = S.isolation;
    var selSet = {};
    v.selection.forEach(function (id) { selSet[id] = true; });

    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      var show = true;

      if (S.typeOn[e.type] === false) show = false;
      if (show && e.storyIndex >= 0 && (e.storyIndex < lo || e.storyIndex > hi)) show = false;
      if (show && S.keyOff[S.colorMode + '|' + colorKey(e)]) show = false;
      if (show && S.hidden[i]) show = false;

      var inIso = !iso || iso[i];
      if (!show) v.states[i] = STATE.HIDDEN;
      else if (!inIso) v.states[i] = S.ghostMode ? STATE.GHOST : STATE.HIDDEN;
      else v.states[i] = selSet[i] ? STATE.SELECTED : STATE.VISIBLE;
    }
    v.syncLut();
    stateListeners.forEach(function (f) { f(); });
  }

  function visibleIds() {
    var out = [];
    if (!S.viewer) return out;
    for (var i = 0; i < S.viewer.states.length; i++) {
      if (S.viewer.states[i] !== STATE.HIDDEN) out.push(i);
    }
    return out;
  }

  /** Element ids for the active takeoff scope, plus a sentence describing it. */
  function scopeIds() {
    if (!S.model) return { ids: [], label: '', detail: '' };
    switch (S.scope) {
      case 'all':
        return {
          ids: S.model.elements.map(function (e) { return e.id; }),
          label: 'Whole model',
          detail: S.model.elements.length + ' elements'
        };
      case 'selection':
        return {
          ids: S.viewer.selection.slice(),
          label: 'Current selection',
          detail: S.viewer.selection.length + ' elements'
        };
      case 'storey': {
        var lo = S.storeyRange ? S.storeyRange[0] : 0;
        var hi = S.storeyRange ? S.storeyRange[1] : 0;
        var ids = [];
        S.model.elements.forEach(function (e) {
          if (e.storyIndex >= lo && e.storyIndex <= hi) ids.push(e.id);
        });
        return {
          ids: ids,
          label: 'Storey range',
          detail: (S.model.stories[lo] ? S.model.stories[lo].name : '?') + ' to ' +
                  (S.model.stories[hi] ? S.model.stories[hi].name : '?')
        };
      }
      default: {
        var vis = visibleIds();
        return { ids: vis, label: 'Visible only', detail: vis.length + ' of ' + S.model.elements.length + ' elements' };
      }
    }
  }

  function scopeSentence() {
    var s = scopeIds();
    return global.ETABSCosting.describeScope(S.scope, s.detail);
  }

  /* ================================================================== */
  /* History                                                             */
  /* ================================================================== */

  function keysOf(map) { return Object.keys(map || {}); }
  function mapOf(list) {
    var m = {};
    (list || []).forEach(function (k) { m[k] = true; });
    return m;
  }

  function captureSnapshot() {
    return {
      cam: S.viewer ? S.viewer.captureView() : null,
      hidden: keysOf(S.hidden),
      isolation: S.isolation ? keysOf(S.isolation) : null,
      typeOn: JSON.parse(JSON.stringify(S.typeOn)),
      keyOff: JSON.parse(JSON.stringify(S.keyOff)),
      storeyRange: S.storeyRange ? S.storeyRange.slice() : null,
      colorMode: S.colorMode,
      palette: S.palette,
      customColors: JSON.parse(JSON.stringify(S.customColors)),
      renderStyle: S.renderStyle,
      environment: S.environment,
      envPinned: S.envPinned,
      clip: JSON.parse(JSON.stringify(S.clip)),
      explode: JSON.parse(JSON.stringify(S.explode)),
      load: {
        basis: S.load.basis, selfWeight: S.load.selfWeight, scope: S.load.scope,
        labels: S.load.labels, previousMode: S.load.previousMode
      },
      rebarOn: S.rebar.on,
      ghostMode: S.ghostMode,
      selection: S.viewer ? S.viewer.selection.slice() : []
    };
  }

  var applyListeners = [];
  function onSnapshotApplied(fn) { applyListeners.push(fn); }

  function applySnapshot(snap) {
    if (!snap || !S.viewer) return;
    S.hidden = mapOf(snap.hidden);
    S.isolation = snap.isolation ? mapOf(snap.isolation) : null;
    S.typeOn = JSON.parse(JSON.stringify(snap.typeOn));
    S.keyOff = JSON.parse(JSON.stringify(snap.keyOff));
    S.storeyRange = snap.storeyRange ? snap.storeyRange.slice() : null;
    S.colorMode = snap.colorMode;
    S.palette = snap.palette;
    S.customColors = JSON.parse(JSON.stringify(snap.customColors));
    S.renderStyle = snap.renderStyle;
    S.environment = snap.environment;
    S.envPinned = snap.envPinned;
    S.clip = JSON.parse(JSON.stringify(snap.clip));
    S.explode = JSON.parse(JSON.stringify(snap.explode));
    if (snap.load) {
      var reload = snap.load.basis !== S.load.basis || snap.load.selfWeight !== S.load.selfWeight;
      S.load.basis = snap.load.basis;
      S.load.selfWeight = snap.load.selfWeight;
      S.load.scope = snap.load.scope;
      S.load.labels = snap.load.labels;
      S.load.previousMode = snap.load.previousMode || S.load.previousMode;
      if (reload) computeLoads();
    }
    S.ghostMode = snap.ghostMode;

    S.viewer.setRenderStyle(S.renderStyle);
    S.viewer.setEnvironment(S.environment);
    S.viewer.setExplode(S.explode.storey, S.explode.radial, S.explode.type);
    S.viewer.selection = snap.selection.slice();

    computeColors();
    computeStates();
    if (snap.cam) S.viewer.restoreView(snap.cam);
    applyListeners.forEach(function (f) { f(snap); });
  }

  /**
   * Fresh clipping state. Exactly one mode drives the planes at a time,
   * in this priority: grid section → plan slice → box → single planes.
   *   x/y/z.v     plane position as a fraction of the model extent (0..1)
   *   x/y/z.sign  +1 keeps the part below the plane, −1 keeps the part above
   *   boxC        box centre per axis (fraction), boxSize box edge (fraction)
   */
  function defaultClip() {
    return {
      x: { on: false, v: 0.5, sign: 1 },
      y: { on: false, v: 0.5, sign: 1 },
      z: { on: false, v: 0.5, sign: 1 },
      box: false,
      boxC: { x: 0.5, y: 0.5, z: 0.5 },
      boxSize: 0.5,
      grid: '', storey: ''
    };
  }

  function pushHistory(label) {
    if (S.history) S.history.push(label);
  }

  /* ================================================================== */
  /* Overlay theme                                                       */
  /* ================================================================== */

  function isDarkUI() {
    var stamped = document.documentElement.getAttribute('data-theme');
    if (stamped) return stamped === 'dark';
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function overlayTheme() {
    var envDark = S.environment === 'night' || S.environment === 'blueprint';
    var light = !(isDarkUI() || envDark);
    return {
      grid: light ? 0x7c8a94 : 0x8fa6b4,
      gridBubble: light ? '#0e7c86' : '#5fd8e4',
      bubbleFill: light ? 'rgba(255,255,255,.95)' : 'rgba(18,26,32,.92)',
      level: light ? 0x9aa6ae : 0x6f8290,
      dim: light ? 0x6c7a85 : 0x9fb0bc,
      load: light ? 0xb26b00 : 0xe0a03c,
      measure: light ? 0xb3312c : 0xff9a8f,
      plateFill: light ? 'rgba(16,25,35,.86)' : 'rgba(232,238,242,.92)',
      plateText: light ? '#ffffff' : '#0c1115',
      measureFill: light ? 'rgba(179,49,44,.94)' : 'rgba(229,107,99,.94)'
    };
  }

  var overlayFlags = {
    grids: true, levels: true, levelPlanes: false, dims: false,
    axes: false, labels: '', loads: false
  };

  function refreshOverlays() {
    if (!S.model || !S.overlays) return;
    var th = overlayTheme();
    var Units = global.ETABSUnits;
    var fmt = function (m) { return Units.length(m); };
    var O = S.overlays;
    var size = S.viewer.modelRadius;

    if (overlayFlags.grids) O.buildGrids(S.model, th); else O.clear('grids');
    if (overlayFlags.levels) O.buildLevels(S.model, th, fmt); else O.clear('levels');
    if (overlayFlags.levelPlanes) O.buildLevelPlanes(S.model, th); else O.clear('levelPlanes');
    if (overlayFlags.dims) O.buildDimensions(S.model, th, fmt); else O.clear('dims');
    if (overlayFlags.loads) O.buildLoads(S.model, th, size * 0.05); else O.clear('loads');
    if (S.colorMode === 'load' && S.load.labels) O.buildLoadLabels(S.model, S.load.result, th);
    else O.clear('loadLabels');
    if (overlayFlags.axes) {
      var ids = S.viewer.selection.length ? S.viewer.selection : visibleIds().slice(0, 2000);
      O.buildLocalAxes(S.model, ids, size * 0.03);
    } else O.clear('axes');
    if (overlayFlags.labels) {
      var lids = S.viewer.selection.length ? S.viewer.selection : visibleIds().slice(0, 500);
      O.buildElementLabels(S.model, lids, overlayFlags.labels, th);
    } else O.clear('labels');
    O.declutter();
  }

  global.APP = {
    VERSION: VERSION,
    BRAND: BRAND,
    S: S,
    STATE: STATE,
    PALETTES: PALETTES,
    COLOR_MODES: COLOR_MODES,
    TYPE_FALLBACK: TYPE_FALLBACK,
    overlayFlags: overlayFlags,

    $: $, el: el, tip: tip, escapeHtml: escapeHtml,
    prefGet: prefGet, prefSet: prefSet, toast: toast,

    colorKey: colorKey, hexToRgb: hexToRgb, ramp: ramp, colorFor: colorFor,
    computeLoads: computeLoads, rebarSettings: rebarSettings,
    computeColors: computeColors, onColorsChanged: onColorsChanged,
    legend: function () { return { keys: legendKeys, range: legendRange }; },

    computeStates: computeStates, onStatesChanged: onStatesChanged,
    visibleIds: visibleIds, scopeIds: scopeIds, scopeSentence: scopeSentence,
    findByGeometry: findByGeometry,

    captureSnapshot: captureSnapshot, applySnapshot: applySnapshot,
    onSnapshotApplied: onSnapshotApplied, pushHistory: pushHistory, defaultClip: defaultClip,

    isDarkUI: isDarkUI, overlayTheme: overlayTheme, refreshOverlays: refreshOverlays
  };
})(window);
