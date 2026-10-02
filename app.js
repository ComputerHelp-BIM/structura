/**
 * app.js — Boot, toolbar, menus, guide and keyboard.
 * =================================================================
 * Wires the modules together: panels, tooltips, action menus, the toolbar,
 * the storey ladder, the plan locator, the guide, and every keyboard route.
 */
(function (global) {
  'use strict';

  var A = global.APP, S = A.S, ACT = global.ACT, FILES = global.FILES;
  var RAIL = global.RAIL, DRAWER = global.DRAWER, UI = global.ETABSUI;
  var $ = A.$, el = A.el, toast = A.toast;
  var Units = global.ETABSUnits;
  var Guide = global.ETABSGuide;
  var STATE = A.STATE;

  /* ================================================================== */
  /* Brand                                                               */
  /* ================================================================== */

  function markSvg(size) {
    return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size +
      '" role="img" aria-label="' + A.BRAND.name + '">' +
      '<rect x="1.5" y="1.5" width="45" height="45" rx="10" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="2"/>' +
      '<g fill="currentColor">' +
        '<rect x="9" y="11" width="30" height="4.2" rx="1.2" opacity=".95"/>' +
        '<rect x="9" y="21.9" width="30" height="4.2" rx="1.2" opacity=".72"/>' +
        '<rect x="9" y="32.8" width="30" height="4.2" rx="1.2" opacity=".5"/>' +
        '<rect x="14.2" y="11" width="4.4" height="26" rx="1.2" opacity=".55"/>' +
        '<rect x="29.4" y="11" width="4.4" height="26" rx="1.2" opacity=".55"/>' +
      '</g></svg>';
  }

  function paintBrand() {
    var mark = A.BRAND.logo
      ? '<img src="' + A.BRAND.logo + '" alt="' + A.escapeHtml(A.BRAND.name) + '">'
      : markSvg(30);
    $('brandMark').innerHTML = mark;
    $('brandName').textContent = A.BRAND.name;
    $('brandSub').textContent = A.BRAND.sub;
    $('splashMark').innerHTML = A.BRAND.logo
      ? '<img src="' + A.BRAND.logo + '" alt="" style="width:100%;height:100%;object-fit:contain">'
      : markSvg(62);
    var dz = $('dzMark');
    if (dz) {
      dz.innerHTML = A.BRAND.logo
        ? '<img src="' + A.BRAND.logo + '" alt="" style="height:44px">'
        : markSvg(46);
      dz.style.cssText = 'display:inline-block;color:var(--accent)';
    }
  }

  function pickLogo() {
    var input = el('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      if (f.size > 900000) { toast('That image is large — under 900 KB works best', 'err'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        A.BRAND.logo = reader.result;
        A.prefSet('logo', A.BRAND.logo);
        paintBrand();
        toast('Logo applied — it appears on exports too', 'ok');
      };
      reader.readAsDataURL(f);
    });
    input.click();
  }

  /* ================================================================== */
  /* Theme and clock                                                     */
  /* ================================================================== */

  var THEME_ICONS = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:15px;height:15px"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:15px;height:15px"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:15px;height:15px"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/></svg>'
  };

  function applyTheme(mode) {
    S.theme = mode;
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    $('themeBtn').innerHTML = THEME_ICONS[mode];
    A.prefSet('theme', mode);
    if (!S.envPinned) {
      S.environment = A.isDarkUI() ? 'night' : 'studio';
      if (S.viewer) S.viewer.setEnvironment(S.environment);
    }
    if (S.viewer) A.refreshOverlays();
    RAIL.build();
  }

  function cycleTheme() {
    var order = ['system', 'light', 'dark'];
    applyTheme(order[(order.indexOf(S.theme) + 1) % 3]);
  }

  function startClock() {
    function tick() {
      var now = new Date();
      $('clockTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      $('clockDate').textContent = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
      var mins = Math.floor((Date.now() - S.sessionStart) / 60000);
      $('stSession').textContent = 'session ' + (mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm');
      if (S.viewer) {
        var st = S.viewer.stats();
        $('stPerf').textContent = st.fps + ' fps · ' + Units.number(st.triangles) + ' tris · ' + st.calls + ' calls';
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ================================================================== */
  /* Status                                                              */
  /* ================================================================== */

  function updateStatus() {
    if (!S.model) return;
    var vis = A.visibleIds().length;
    $('stElements').textContent = Units.number(S.model.elements.length) + ' elements · ' +
      Units.number(vis) + ' visible';
    $('stParse').textContent = 'parsed ' + Math.round(S.model.meta.parseMs) + ' ms' +
      (S.viewer.buildMs ? ' · built ' + Math.round(S.viewer.buildMs) + ' ms' : '');
    $('stUnits').textContent = 'file ' + S.model.meta.units.force + '-' + S.model.meta.units.length +
      ' · showing ' + Units.current;
    $('stSel').textContent = S.viewer.selection.length ? S.viewer.selection.length + ' selected' : '';
  }

  /* ================================================================== */
  /* Toolbar                                                             */
  /* ================================================================== */

  var ICON = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
    fit: '<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4"/>',
    zoomSel: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
    spin: '<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 3v5h-5"/>',
    cine: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>',
    walk: '<circle cx="12" cy="4" r="2"/><path d="M11 22l-2-6 3-4-1-4 4 3 3 1M9 12l-3 2"/>',
    solid: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    wire: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10M3 17l9-5 9 5"/>',
    xray: '<path d="M12 4.5S5 9 5 13a7 7 0 0014 0c0-4-7-8.5-7-8.5z"/>',
    grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    slice: '<path d="M3 12h18M7 7l10 10M17 7L7 17"/>',
    explode: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
    measure: '<path d="M3 15l12-12 6 6-12 12z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/>',
    isolate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    hide: '<path d="M3 3l18 18"/><path d="M10.6 5.2A9 9 0 0121 12a12 12 0 01-2.6 3.4M6.6 6.6A12 12 0 003 12a9 9 0 0011.4 6.8"/>',
    showAll: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    invert: '<path d="M12 3v18"/><path d="M12 3a9 9 0 010 18z" fill="currentColor"/><circle cx="12" cy="12" r="9"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
    data: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="1.6" fill="currentColor"/><circle cx="14" cy="12" r="1.6" fill="currentColor"/><circle cx="10" cy="19" r="1.6" fill="currentColor"/>',
    present: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4M10 9l4 2.5-4 2.5z"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'
  };

  var TOOLS = [
    { act: 'home', icon: 'home', tip: 'Back to the opening isometric view', run: function () { ACT.goHome(); } },
    { act: 'fit', icon: 'fit', tip: 'Fit the whole model in view', key: 'F', run: function () { ACT.frameAll(); } },
    { act: 'zoomSel', icon: 'zoomSel', tip: 'Zoom to what is selected', key: 'Z', run: function () { ACT.frameSelection(); } },
    { sep: true },
    { act: 'solid', icon: 'solid', tip: 'Draw true section profiles', key: 'S', run: function () { ACT.setStyle('solid'); } },
    { act: 'wire', icon: 'wire', tip: 'Centreline sticks only — fastest', key: 'L', run: function () { ACT.setStyle('wireframe'); } },
    { act: 'xray', icon: 'xray', tip: 'See through the facade', key: 'X', run: function () { ACT.setStyle('xray'); } },
    { sep: true },
    { act: 'isolate', icon: 'isolate', tip: 'Show only the selection', key: 'I', run: ACT.isolateSelection, needsSel: true },
    { act: 'hide', icon: 'hide', tip: 'Hide the selection', key: 'H', run: ACT.hideSelection, needsSel: true },
    { act: 'invert', icon: 'invert', tip: 'Swap shown for hidden', key: 'V', run: ACT.invertVisibility },
    { act: 'showAll', icon: 'showAll', tip: 'Bring everything back', key: 'U', run: function () { ACT.showAll(); } },
    { sep: true },
    { act: 'spin', icon: 'spin', tip: 'Rotate the model continuously', key: 'R', run: function () { ACT.toggleTurntable(false); } },
    { act: 'cine', icon: 'cine', tip: 'Slow rising orbit for recording', key: 'C', run: function () { ACT.toggleTurntable(true); } },
    { act: 'walk', icon: 'walk', tip: 'Walk inside the building', key: 'W', run: ACT.toggleWalk },
    { sep: true },
    { act: 'grid', icon: 'grid', tip: 'Grid lines and bubbles', key: 'G', run: function () {
      A.overlayFlags.grids = !A.overlayFlags.grids;
      A.refreshOverlays();
      syncToolbar();
    } },
    { act: 'slice', icon: 'slice', tip: 'Box clip — see inside the model', run: function () {
      ACT.toggleBox();
      syncToolbar();
    } },
    { act: 'explode', icon: 'explode', tip: 'Fan the storeys apart — press again to put them back', run: ACT.animateExplode },
    { act: 'measure', icon: 'measure', tip: 'Measure a distance', run: function () {
      ACT.setMeasureMode(S.measure.mode ? null : 'distance');
    } },
    { sep: true },
    { act: 'camera', icon: 'camera', tip: 'Save a high-resolution image', key: 'P', run: function () { FILES.exportPng(false); } },
    { act: 'data', icon: 'data', tip: 'Open the data panel', key: ']', run: function () { DRAWER.toggle(); } },
    { act: 'present', icon: 'present', tip: 'Hide the panels and present', run: ACT.togglePresentation },
    { act: 'full', icon: 'full', tip: 'Fullscreen', run: ACT.toggleFullscreen }
  ];

  function buildToolbar() {
    var bar = $('toolbar');
    bar.innerHTML = '';
    TOOLS.forEach(function (it) {
      if (it.sep) { bar.appendChild(el('span', 'sep')); return; }
      var b = el('button', 'tool');
      b.dataset.act = it.act;
      A.tip(b, it.tip, it.key);
      b.setAttribute('aria-label', it.tip);
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round">' + ICON[it.icon] + '</svg>';
      b.addEventListener('click', it.run);
      bar.appendChild(b);
    });
    syncToolbar();
  }

  function syncToolbar() {
    var selCount = S.viewer ? S.viewer.selection.length : 0;
    document.querySelectorAll('#toolbar .tool').forEach(function (n) {
      var a = n.dataset.act;
      var tool = TOOLS.filter(function (t) { return t.act === a; })[0];
      if (tool && tool.needsSel) n.disabled = selCount === 0;

      if (a === 'solid') n.classList.toggle('on', S.renderStyle === 'solid' || S.renderStyle === 'technical');
      if (a === 'wire') n.classList.toggle('on', S.renderStyle === 'wireframe');
      if (a === 'xray') n.classList.toggle('on', S.renderStyle === 'xray');
      if (a === 'grid') n.classList.toggle('on', A.overlayFlags.grids);
      if (a === 'slice') n.classList.toggle('on', S.clip.box);
      if (a === 'explode') n.classList.toggle('on', ACT.isExploded());
      if (a === 'spin') n.classList.toggle('on', S.viewer && S.viewer.turntable.on && !S.viewer.turntable.cinematic);
      if (a === 'cine') n.classList.toggle('on', S.viewer && S.viewer.turntable.on && S.viewer.turntable.cinematic);
      if (a === 'walk') n.classList.toggle('on', S.viewer && S.viewer.walk.on);
      if (a === 'measure') n.classList.toggle('on', !!S.measure.mode);
      if (a === 'present') n.classList.toggle('on', S.presenting);

      var badge = n.querySelector('.badge');
      if (a === 'isolate' || a === 'hide') {
        if (selCount > 0) {
          if (!badge) { badge = el('span', 'badge'); n.appendChild(badge); }
          badge.textContent = selCount > 99 ? '99+' : selCount;
        } else if (badge) badge.remove();
      }
    });

    var u = S.history ? S.history.describe() : { canUndo: false, canRedo: false };
    $('undoBtn').disabled = !u.canUndo;
    $('redoBtn').disabled = !u.canRedo;
    A.tip($('undoBtn'), u.canUndo ? 'Undo: ' + u.undoLabel : 'Nothing to undo', 'Ctrl Z');
    A.tip($('redoBtn'), u.canRedo ? 'Redo: ' + u.redoLabel : 'Nothing to redo', 'Ctrl Y');
  }

  /* ================================================================== */
  /* Storey ladder and plan locator                                      */
  /* ================================================================== */

  function buildLadder() {
    var host = $('ladder');
    if (!S.model) { host.innerHTML = ''; return; }
    host.innerHTML = '';

    var all = el('button', '', '<b>All storeys</b>');
    A.tip(all, 'Show every level again');
    all.addEventListener('click', function () {
      ACT.setStoreyRange(0, S.model.stories.length - 1, 'show all storeys');
    });
    host.appendChild(all);

    S.model.stories.slice().reverse().forEach(function (s) {
      var b = el('button');
      var active = S.storeyRange && S.storeyRange[0] === s.index && S.storeyRange[1] === s.index;
      if (active) b.classList.add('on');
      b.innerHTML = '<b></b><em></em>';
      b.querySelector('b').textContent = s.name;
      b.querySelector('em').textContent = Units.length(s.elev * S.model.meta.units.lengthToM, { bare: true });
      A.tip(b, active ? 'Click again to show every storey'
        : 'Show only ' + s.name + ' at ' + Units.length(s.elev * S.model.meta.units.lengthToM) +
          (s.master ? ' · master storey' : ''));
      b.addEventListener('click', function () {
        if (active) ACT.setStoreyRange(0, S.model.stories.length - 1, 'show all storeys');
        else ACT.setStoreyRange(s.index, s.index, 'show ' + s.name);
      });
      host.appendChild(b);
    });
  }

  function drawMinimap() {
    var canvas = $('minimapCanvas');
    if (!canvas || !S.model) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    var b = S.model.bbox;
    var sx = b.size[0] || 1, sy = b.size[1] || 1;
    var scale = Math.min(W * 0.82 / sx, H * 0.82 / sy);
    function px(x, y) {
      return [W / 2 + (x - b.center[0]) * scale, H / 2 - (y - b.center[1]) * scale];
    }

    var styles = getComputedStyle(document.documentElement);
    ctx.strokeStyle = styles.getPropertyValue('--ink-3').trim() || '#888';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    var drawn = 0;
    for (var i = 0; i < S.model.elements.length && drawn < 4000; i++) {
      var e = S.model.elements[i];
      if (e.kind !== 'frame' || e.type !== 'Beam') continue;
      if (S.viewer.states[i] === STATE.HIDDEN) continue;
      var p1 = px(e.a[0], e.a[1]), p2 = px(e.b[0], e.b[1]);
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      drawn++;
    }
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle = styles.getPropertyValue('--accent').trim() || '#0e7c86';
    var cam = S.viewer.activeCamera();
    var cp = px(cam.position.x, cam.position.y);
    var tp = px(S.viewer.target.x, S.viewer.target.y);
    var ang = Math.atan2(tp[1] - cp[1], tp[0] - cp[0]);
    ctx.save();
    ctx.translate(Math.max(6, Math.min(W - 6, cp[0])), Math.max(6, Math.min(H - 6, cp[1])));
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = ctx.fillStyle;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(tp[0], tp[1], 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ================================================================== */
  /* Action menus                                                        */
  /* ================================================================== */

  function openIntents(anchor) {
    var items = Guide.INTENTS.map(function (intent) {
      return {
        label: intent.label,
        note: intent.note,
        icon: intent.icon,
        kind: intent.id === 'review' ? 'primary' : '',
        run: function () { runIntent(intent.id); }
      };
    });
    items.push({ divider: true });
    items.push({
      label: 'Show me how it all works',
      note: 'Opens the illustrated guide',
      icon: '?',
      run: function () { openGuide(); }
    });
    UI.Menu.open({
      title: 'What would you like to do?',
      subtitle: S.model ? S.model.meta.fileName : 'Open a model first, or try a sample',
      items: items,
      anchor: anchor,
      wide: true,
      footer: 'You can always reach this again from the “What now?” button.'
    });
  }

  function runIntent(id) {
    if (!S.model && id !== 'explore') {
      FILES.loadSample('rcc');
      toast('Opening a sample so you can try it — then drop in your own file');
      setTimeout(function () { runIntent(id); }, 2600);
      return;
    }
    switch (id) {
      case 'review':
        ACT.showAll(true);
        ACT.setColorMode('type');
        DRAWER.open('health');
        toast('Health checks and code screening are in the data panel');
        break;
      case 'quantities':
        DRAWER.open('quantities');
        S.pinned = ['quantities'].concat(S.pinned.filter(function (p) { return p !== 'quantities'; }));
        A.prefSet('pinned', S.pinned);
        RAIL.build();
        toast('Rate card is pinned to the top of the rail');
        break;
      case 'explore':
        A.overlayFlags.grids = true;
        A.overlayFlags.levels = true;
        A.refreshOverlays();
        ACT.frameAll();
        syncToolbar();
        break;
      case 'present':
        DRAWER.close();
        ACT.setPresenting(true);
        if (!S.viewer.turntable.on) ACT.toggleTurntable(true);
        break;
      case 'compare':
        $('compareInput').click();
        break;
      case 'export':
        openExportMenu();
        break;
    }
  }

  function openExportMenu(anchor) {
    UI.Menu.open({
      title: 'Export',
      subtitle: 'Every save asks you to confirm first',
      anchor: anchor,
      wide: true,
      items: [
        { label: 'PNG snapshot', note: 'This view at ' + (S.captureScale === 4 ? '4K' : S.captureScale + '×'), icon: '▣', key: 'P', run: function () { FILES.exportPng(false); } },
        { label: 'PNG, transparent', note: 'No background — drops into slides', icon: '▢', run: function () { FILES.exportPng(true); } },
        { label: 'PDF report', note: 'Views, tables, quantities and findings', icon: '▤', run: FILES.exportPdf },
        { label: 'Excel BOQ', note: 'Live formulas wired to a rate card sheet', icon: '∑', run: FILES.exportWorkbook },
        { divider: true },
        { label: 'Bill of materials (CSV)', note: 'Concrete, steel, formwork', icon: '↧', run: FILES.exportBom },
        { label: 'Element list (CSV)', note: 'Every element with geometry', icon: '↧', run: FILES.exportElements },
        { label: 'Health findings (CSV)', note: 'Each check and what it found', icon: '↧', run: FILES.exportHealth },
        { label: 'Loads (CSV)', note: 'Per floor and per element, for the current case', icon: '↧', run: FILES.exportLoads },
        { label: 'Bar bending schedule (CSV)', note: 'Every bar mark, plus the steel summaries', icon: '↧', run: FILES.exportRebar },
        { label: '3D model (OBJ in a zip)', note: 'For Blender or Twinmotion', icon: '◈', run: FILES.exportObj }
      ]
    });
  }

  function openContextMenu(e, elementId) {
    var items = [];
    if (elementId >= 0 && S.model) {
      var elm = S.model.elements[elementId];
      items = [
        { label: 'Zoom to it', note: elm.type + (elm.name ? ' ' + elm.name : ''), icon: '⊕', run: function () {
          S.viewer.frameElements([elementId]);
        } },
        { label: 'Isolate it', note: 'Hide everything else', icon: '◎', key: 'I', run: function () {
          ACT.selectIds([elementId], false);
          ACT.isolateSelection();
        } },
        { label: 'Hide it', note: 'Take it out of view', icon: '⊘', key: 'H', run: function () {
          ACT.selectIds([elementId], false);
          ACT.hideSelection();
        } },
        { divider: true },
        { label: 'Select same section', note: elm.section || 'no section', icon: '≡', run: function () {
          ACT.selectSimilar(elementId, 'section');
        } },
        { label: 'Select same storey', note: elm.story || '—', icon: '≡', run: function () {
          ACT.selectSimilar(elementId, 'story');
        } },
        { label: 'Select same material', note: elm.material || '—', icon: '≡', run: function () {
          ACT.selectSimilar(elementId, 'material');
        } },
        { divider: true },
        { label: 'Measure from here', note: 'Starts a distance measurement', icon: '↔', run: function () {
          ACT.setMeasureMode('distance');
          ACT.addMeasurePoint(elementId);
        } },
        { label: 'Open its properties', note: 'Full detail in the data panel', icon: '▤', run: function () {
          ACT.selectIds([elementId], false);
          DRAWER.open('properties');
        } }
      ];
    } else {
      items = [
        { label: 'Zoom extents', note: 'Fit the whole model', icon: '⛶', key: 'F', run: ACT.frameAll },
        { label: 'Show everything', note: 'Undo all hiding and isolating', icon: '◉', key: 'U', run: function () { ACT.showAll(); } },
        { label: 'Reload the model', note: 'Start over — discards every change', icon: '⟳', run: function () { confirmReload(); } },
        { divider: true },
        { label: 'What would you like to do?', note: 'Pick a task and the app sets up for it', icon: '★', run: function () { openIntents(); } },
        { label: 'Export something', note: 'Image, report, workbook or 3D', icon: '↧', run: function () { openExportMenu(); } }
      ];
    }
    UI.Menu.open({ items: items, x: e.clientX, y: e.clientY });
  }

  /* ================================================================== */
  /* Guide                                                               */
  /* ================================================================== */

  var guideView = 'start';

  function openGuide(sectionId) {
    guideView = sectionId || guideView;
    $('guide').hidden = false;
    renderGuide();
    setTimeout(function () { $('guideSearch').focus(); }, 30);
  }

  function renderGuide(term) {
    var nav = $('guideNav');
    var main = $('guideMain');
    var found = Guide.search(term);

    nav.innerHTML = '';
    nav.appendChild(el('div', 'gn-label', 'Guide'));
    found.sections.forEach(function (s) {
      var b = el('button', s.id === guideView ? 'on' : '', s.title);
      b.addEventListener('click', function () { guideView = s.id; renderGuide(term); });
      nav.appendChild(b);
    });
    nav.appendChild(el('div', 'gn-label', 'Answers'));
    var faqBtn = el('button', guideView === 'faq' ? 'on' : '', 'Common questions');
    faqBtn.addEventListener('click', function () { guideView = 'faq'; renderGuide(term); });
    nav.appendChild(faqBtn);
    nav.appendChild(el('div', 'gn-label', 'About'));
    var relBtn = el('button', guideView === 'releases' ? 'on' : '', "What's new");
    relBtn.addEventListener('click', function () { guideView = 'releases'; renderGuide(term); });
    nav.appendChild(relBtn);
    var keyBtn = el('button', '', 'Keyboard shortcuts');
    keyBtn.addEventListener('click', function () { $('guide').hidden = true; showShortcuts(); });
    nav.appendChild(keyBtn);
    var dlBtn = el('button', '', 'Download samples');
    dlBtn.addEventListener('click', FILES.downloadSamples);
    nav.appendChild(dlBtn);

    main.innerHTML = '';
    if (guideView === 'faq') {
      main.appendChild(el('h3', '', 'Common questions'));
      found.faq.forEach(function (f) {
        var item = el('div', 'faq-item');
        var q = el('button', 'faq-q');
        q.textContent = f.q;
        var a = el('div', 'faq-a');
        a.textContent = f.a;
        q.addEventListener('click', function () { item.classList.toggle('open'); });
        item.appendChild(q);
        item.appendChild(a);
        main.appendChild(item);
      });
      if (!found.faq.length) main.appendChild(el('p', '', 'No questions match that search.'));
      return;
    }

    if (guideView === 'releases') {
      main.appendChild(el('h3', '', "What's new"));
      Guide.RELEASES.forEach(function (r) {
        var box = el('div', 'rel');
        box.appendChild(el('h4', '', 'Version ' + r.version));
        box.appendChild(el('div', 'when', r.date));
        if (r.added.length) {
          box.appendChild(el('span', 'tag new', 'Added'));
          var ul = el('ul');
          r.added.forEach(function (t) {
            var li = el('li');
            li.textContent = t;
            ul.appendChild(li);
          });
          box.appendChild(ul);
        }
        if (r.fixed.length) {
          box.appendChild(el('span', 'tag fix', 'Fixed'));
          var ul2 = el('ul');
          r.fixed.forEach(function (t) {
            var li = el('li');
            li.textContent = t;
            ul2.appendChild(li);
          });
          box.appendChild(ul2);
        }
        main.appendChild(box);
      });
      return;
    }

    var sec = found.sections.filter(function (s) { return s.id === guideView; })[0] || found.sections[0];
    if (!sec) { main.appendChild(el('p', '', 'Nothing matches that search.')); return; }
    guideView = sec.id;
    main.appendChild(el('h3', '', sec.title));
    var wrap = el('div');
    wrap.innerHTML = sec.html;
    main.appendChild(wrap);
    main.scrollTop = 0;
  }

  var SHORTCUTS = [
    ['F', 'Fit the whole model in view'], ['Z', 'Zoom to the selection'],
    ['1 – 6', 'Plan, front, right, iso, back, left'],
    ['R / C / W', 'Spin · cinematic orbit · walk through'],
    ['S / T / X / L', 'Solid · technical · x-ray · wireframe'],
    ['G / D / N / A', 'Grids · dimensions · levels · local axes'],
    ['I / H / V / U', 'Isolate · hide · invert · show all'],
    ['E', 'Reset the explode'], ['P', 'Save a high-resolution image'],
    ['M', 'Play or pause the music'],
    ['[ / ]', 'Show or hide the rail and the data panel'],
    ['Alt + drag', 'Rubber-band select'], ['Shift + click', 'Add to the selection'],
    ['Right click', 'Action menu for what you clicked'],
    ['Double click', 'Isolate the grid line through an element'],
    ['Ctrl + Z / Y', 'Undo · redo'],
    ['Ctrl + K', 'Search every feature'], ['Ctrl + /', 'What would you like to do?'],
    ['F1', 'Guide and FAQ'], ['Esc', 'Clear the selection, or close what is open']
  ];

  function showShortcuts() {
    var rows = SHORTCUTS.map(function (s) {
      return '<div class="step" style="padding:7px 0"><div style="min-width:126px"><code>' +
        s[0] + '</code></div><div><span>' + s[1] + '</span></div></div>';
    }).join('');
    openModal('Keyboard shortcuts', '<div class="steps">' + rows + '</div>');
  }

  /* ================================================================== */
  /* Modal helper                                                        */
  /* ================================================================== */

  function openModal(title, bodyHtml, footHtml) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    $('modalFoot').innerHTML = footHtml || '<button class="btn primary" data-close>Close</button>';
    $('modal').hidden = false;
    return $('modalBody');
  }
  function closeModal() { $('modal').hidden = true; }

  function askText(title, message, placeholder, onOk) {
    var body = openModal(title,
      '<p class="hint" style="font-size:12.5px;margin-bottom:10px">' + message + '</p>' +
      '<input id="askField" type="text" placeholder="' + A.escapeHtml(placeholder || '') + '">',
      '<button class="btn" data-close>Cancel</button><button class="btn primary" id="askOk">OK</button>');
    var field = body.querySelector('#askField');
    setTimeout(function () { field.focus(); }, 30);
    function go() {
      var v = field.value.trim();
      closeModal();
      if (v) onOk(v);
    }
    $('askOk').addEventListener('click', go);
    field.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  }

  function showExportWizard(file, probe) {
    var html =
      '<p style="margin:0 0 14px;color:var(--ink-2)"><b>' + A.escapeHtml(file.name) +
      '</b> is an ETABS database file. The .EDB format is proprietary and binary — no browser, and no ' +
      'tool outside ETABS itself, can reliably rebuild geometry from it. Exporting the text model takes ' +
      'about fifteen seconds and gives a complete, readable file.</p>' +
      '<div class="steps">' +
      '<div class="step"><span class="n"></span><div><b>Open the model in ETABS</b><span>Any version from ETABS 9 onwards.</span></div></div>' +
      '<div class="step"><span class="n"></span><div><b>File → Export → ETABS Text File (.e2k)</b>' +
      '<span>On newer builds this reads <code>File → Export → ETABS Model (.e2k) Text File</code>.</span></div></div>' +
      '<div class="step"><span class="n"></span><div><b>Tick “Export all”</b>' +
      '<span>Geometry needs Story Definitions, Grids, Point Coordinates, Line and Area Connectivities, ' +
      'Section Assignments, Frame Sections, Shell Properties and Material Properties.</span></div></div>' +
      '<div class="step"><span class="n"></span><div><b>Drop the .e2k here</b>' +
      '<span>Or try a sample building to explore every feature right now.</span></div></div>' +
      '</div>' +
      '<p class="hint" style="margin-top:14px">A <code>.$et</code> file — the autosave ETABS leaves ' +
      'beside your model — is already text and can be dropped in directly.</p>';

    if (probe && (probe.version || probe.strings.length)) {
      html += '<div class="probe"><b>What could be read from the binary</b><br>' +
        (probe.signature ? 'Container: ' + A.escapeHtml(probe.signature) + '<br>' : '') +
        (probe.version ? 'ETABS version: ' + A.escapeHtml(probe.version) + '<br>' : '') +
        'Size: ' + (file.size / 1048576).toFixed(2) + ' MB<br>' +
        (probe.strings.length ? 'Legible strings: ' + A.escapeHtml(probe.strings.slice(0, 14).join(' · ')) : '') +
        '</div>';
    }

    openModal('Export a text model from ETABS', html,
      '<button class="btn" data-close>Close</button>' +
      '<button class="btn primary" id="wizSample">Open a sample instead</button>');
    $('wizSample').addEventListener('click', function () {
      closeModal();
      FILES.loadSample('rcc');
    });
  }

  /* ================================================================== */
  /* File diagnostic                                                     */
  /* ================================================================== */

  var LEVEL_CLASS = { critical: 'critical', warn: 'warn', info: 'info', ok: 'info' };

  /**
   * Shown instead of an error banner when a file yields no geometry, and on
   * demand for one that loaded. The census and sample lines are the part that
   * matters: they turn "it does not work" into a fixable bug report.
   */
  function showDiagnostic(model, reason) {
    var d = global.ETABSParser.diagnose(model);
    var meta = model.meta;

    var head = reason === 'empty'
      ? '<p style="margin:0 0 14px;color:var(--ink-2)"><b>' + A.escapeHtml(meta.fileName) +
        '</b> was read, but no geometry could be built from it. Here is exactly what the parser saw.</p>'
      : '<p style="margin:0 0 14px;color:var(--ink-2)">What the parser found in <b>' +
        A.escapeHtml(meta.fileName) + '</b>.</p>';

    var facts = '<dl class="kv">' +
      ['Format|' + meta.source,
       'Program|' + ((meta.program || '—') + ' ' + (meta.version || '')).trim(),
       'File units|' + meta.units.force + '-' + meta.units.length,
       'Elements built|' + model.elements.length,
       'Storeys|' + (model.stories || []).length,
       'Grids|' + (model.grids || []).length,
       'Points|' + ((meta.counts && meta.counts.points) || 0),
       'Line connectivity|' + ((meta.counts && meta.counts.lineConn) || 0),
       'Line assignments|' + ((meta.counts && meta.counts.lineAssigns) || 0),
       'Area connectivity|' + ((meta.counts && meta.counts.areaConn) || 0),
       'Area assignments|' + ((meta.counts && meta.counts.areaAssigns) || 0),
       'Frame sections|' + Object.keys(model.frameSections || {}).length,
       'Shell properties|' + Object.keys(model.shellSections || {}).length
      ].map(function (row) {
        var p = row.split('|');
        return '<dt>' + p[0] + '</dt><dd>' + A.escapeHtml(p[1]) + '</dd>';
      }).join('') + '</dl>';

    var cards = d.findings.map(function (f) {
      return '<div class="finding ' + (LEVEL_CLASS[f.level] || 'info') + '">' +
        '<h4><span>' + A.escapeHtml(f.title) + '</span><span class="badge">' + f.level + '</span></h4>' +
        '<p>' + A.escapeHtml(f.detail) + '</p></div>';
    }).join('');

    var census = d.census;
    var censusRows = Object.keys(census).sort(function (a, b) { return census[b] - census[a]; })
      .slice(0, 40)
      .map(function (k) {
        return '<tr><td>' + A.escapeHtml(k) + '</td><td class="num">' + census[k] + '</td>' +
          '<td style="font-size:10px;color:var(--ink-3)">' +
          A.escapeHtml((d.samples[k] || '').slice(0, 70)) + '</td></tr>';
      }).join('');

    openModal('What is in this file', head + facts +
      '<div class="sec-title">Findings<span class="n">' + d.findings.length + '</span></div>' + cards +
      '<div class="sec-title">Blocks found<span class="n">' + d.blocks.length + '</span></div>' +
      '<p class="hint" style="font-family:var(--font-mono);font-size:10.5px;line-height:1.7">' +
      d.blocks.map(function (b) { return '$ ' + A.escapeHtml(b); }).join('<br>') + '</p>' +
      '<div class="sec-title">Record census<span class="n">' +
      Object.keys(census).length + ' types</span></div>' +
      '<div class="tbl-wrap"><table class="data"><thead><tr><th>Record</th><th>Count</th>' +
      '<th>First line seen</th></tr></thead><tbody>' + censusRows + '</tbody></table></div>',

      '<button class="btn" data-close>Close</button>' +
      '<button class="btn" id="diagSample">Open a sample instead</button>' +
      '<button class="btn primary" id="diagCopy">Copy this diagnostic</button>');

    $('diagSample').addEventListener('click', function () {
      closeModal();
      FILES.loadSample('rcc');
    });
    $('diagCopy').addEventListener('click', function () {
      var text = d.text;
      function fallback() {
        $('modalBody').innerHTML =
          '<p class="hint" style="margin-bottom:10px">Copying was blocked — select all of this and copy it.</p>' +
          '<textarea readonly style="width:100%;height:340px;font-family:var(--font-mono);font-size:10.5px;' +
          'border:1px solid var(--line);border-radius:7px;padding:8px;background:var(--surface-2)">' +
          A.escapeHtml(text) + '</textarea>';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          toast('Diagnostic copied — paste it to whoever maintains the parser', 'ok');
        }, fallback);
      } else fallback();
    });
  }

  /* ================================================================== */
  /* Reload                                                              */
  /* ================================================================== */

  /**
   * Ask first. A reload throws away work that took real effort to set up —
   * isolations, a colour scheme, a section box — so this is one of the few
   * places a confirmation earns its interruption.
   */
  function confirmReload(anchor) {
    if (!S.model) { toast('Open a model first'); return; }

    var lost = [];
    if (Object.keys(S.hidden).length) lost.push(Object.keys(S.hidden).length + ' hidden elements');
    if (S.isolation) lost.push('the current isolation');
    if (S.colorMode !== 'type' || Object.keys(S.customColors).length) lost.push('your colour choices');
    if (S.clip.x.on || S.clip.y.on || S.clip.z.on || S.clip.box || S.clip.grid || S.clip.storey) lost.push('clipping');
    if (S.explode.storey || S.explode.radial || S.explode.type) lost.push('the explode');
    if (S.measure.pinned || S.measure.points.length) lost.push('measurements');
    if (S.compare) lost.push('the revision comparison');
    if (S.history && S.history.describe().depth) lost.push('the undo history');

    UI.confirmAction({
      title: 'Reload this model?',
      detail: 'Re-reads ' + (FILES.sourceLabel() || 'the file') + ' from scratch and discards ' +
        (lost.length ? lost.join(', ') + '.' : 'any changes you have made.') +
        ' Your saved views, palette, rate card and panel layout are kept.',
      confirmLabel: 'Yes, reload it',
      confirmNote: 'Back to how the model first opened',
      cancelNote: 'Leave everything as it is',
      anchor: anchor || $('reloadBtn')
    }).then(function (ok) {
      if (ok) FILES.reloadModel();
    });
  }

  /* ================================================================== */
  /* Command palette                                                     */
  /* ================================================================== */

  var CMDS = null, cmdFiltered = [], cmdSel = 0;

  function commands() {
    var C = [];
    function add(label, group, run, keys) { C.push({ label: label, group: group, run: run, keys: keys }); }

    add('Open a model file…', 'File', function () { $('fileInput').click(); });
    global.ETABSDemo.samples.forEach(function (s) {
      add('Open sample: ' + s.name, 'File', function () { FILES.loadSample(s.id); });
    });
    add('Download the sample files', 'File', FILES.downloadSamples);
    add('What is in this file? (diagnostic)', 'File', FILES.diagnose);
    add('Reload the model (discard all changes)', 'File', function () { confirmReload(); });
    add('Close the model', 'File', FILES.closeModel);

    ['top', 'front', 'back', 'left', 'right', 'iso', 'isoSW', 'isoNE'].forEach(function (v) {
      add('View: ' + v, 'Camera', function () { ACT.setView(v); });
    });
    add('Zoom extents', 'Camera', ACT.frameAll, 'F');
    add('Zoom to selection', 'Camera', ACT.frameSelection, 'Z');
    add('Home view', 'Camera', ACT.goHome);
    add('Toggle 360° turntable', 'Camera', function () { ACT.toggleTurntable(false); }, 'R');
    add('Cinematic orbit', 'Camera', function () { ACT.toggleTurntable(true); }, 'C');
    add('Walk through the model', 'Camera', ACT.toggleWalk, 'W');
    add('Perspective projection', 'Camera', function () { S.viewer.setProjection('persp'); });
    add('Orthographic projection', 'Camera', function () { S.viewer.setProjection('ortho'); });
    add('Undo', 'Camera', ACT.undo, 'Ctrl Z');
    add('Redo', 'Camera', ACT.redo, 'Ctrl Y');

    [['solid', 'Solid sections', 'S'], ['technical', 'Technical shading', 'T'],
     ['xray', 'X-ray', 'X'], ['wireframe', 'Centreline wireframe', 'L']].forEach(function (s) {
      add('Style: ' + s[1], 'Display', function () { ACT.setStyle(s[0]); }, s[2]);
    });
    ['studio', 'night', 'blueprint', 'sunset', 'site'].forEach(function (e) {
      add('Environment: ' + e, 'Display', function () { ACT.setEnvironment(e); });
    });
    ['draft', 'balanced', 'presentation'].forEach(function (q) {
      add('Quality: ' + q, 'Display', function () { ACT.setQualityPreset(q); });
    });
    add('Toggle grid lines', 'Display', function () {
      A.overlayFlags.grids = !A.overlayFlags.grids;
      A.refreshOverlays();
      syncToolbar();
    }, 'G');
    add('Toggle bay dimensions', 'Display', function () {
      A.overlayFlags.dims = !A.overlayFlags.dims;
      A.refreshOverlays();
    }, 'D');
    add('Toggle storey markers', 'Display', function () {
      A.overlayFlags.levels = !A.overlayFlags.levels;
      A.refreshOverlays();
    }, 'N');
    add('Toggle local 1-2-3 axes', 'Display', function () {
      A.overlayFlags.axes = !A.overlayFlags.axes;
      A.refreshOverlays();
    }, 'A');
    add('Presentation mode', 'Display', ACT.togglePresentation);
    add('Fullscreen', 'Display', ACT.toggleFullscreen);

    A.COLOR_MODES.forEach(function (m) {
      add('Colour by ' + m.label.toLowerCase(), 'Colour', function () { ACT.setColorMode(m.id); });
    });
    Object.keys(A.PALETTES).forEach(function (p) {
      add('Palette: ' + p, 'Colour', function () { ACT.setPalette(p); });
    });

    add('Isolate selection', 'Visibility', ACT.isolateSelection, 'I');
    add('Hide selection', 'Visibility', ACT.hideSelection, 'H');
    add('Invert visibility', 'Visibility', ACT.invertVisibility, 'V');
    add('Show everything', 'Visibility', function () { ACT.showAll(); }, 'U');
    add('Isolate columns', 'Visibility', function () { ACT.isolateTypes(['Column']); });
    add('Isolate the lateral system', 'Visibility', function () { ACT.isolateTypes(['Wall', 'Brace']); });

    add('Explode / collapse the storeys', 'Explode', ACT.animateExplode);
    add('Reset explode', 'Explode', ACT.resetExplode, 'E');
    add('Clear all clipping', 'Slice', ACT.clearClipping);
    add('Box clip', 'Slice', function () { ACT.toggleBox(); });
    add('Box clip around selection', 'Slice', ACT.boxToSelection);

    ['distance', 'height', 'area', 'angle'].forEach(function (m) {
      add('Measure ' + m, 'Measure', function () { ACT.setMeasureMode(m); });
    });
    add('Keep this measurement', 'Measure', ACT.pinMeasure);
    add('Clear measurements', 'Measure', ACT.clearMeasures);

    DRAWER.TABS.forEach(function (t) {
      add('Open ' + t.label.toLowerCase(), 'Data', function () { DRAWER.open(t.id); });
    });
    global.ETABSCosting.SCOPES.forEach(function (sc) {
      add('Take-off scope: ' + sc.label, 'Data', function () {
        S.scope = sc.id;
        RAIL.build();
        DRAWER.render();
      });
    });

    add('Export PNG snapshot', 'Export', function () { FILES.exportPng(false); }, 'P');
    add('Export transparent PNG', 'Export', function () { FILES.exportPng(true); });
    add('Export PDF report', 'Export', FILES.exportPdf);
    add('Export Excel BOQ workbook', 'Export', FILES.exportWorkbook);
    add('Export bill of materials', 'Export', FILES.exportBom);
    add('Export BOQ as CSV', 'Export', FILES.exportBoqCsv);
    add('Export loads as CSV', 'Export', FILES.exportLoads);
    add('Export bar bending schedule', 'Export', FILES.exportRebar);
    add('Show the reinforcement', 'Reinforcement', function () { ACT.toggleRebar(); });
    add('Inspect bars in the selection', 'Reinforcement', function () { ACT.inspectBars(S.viewer.selection[0]); });
    add('Section cut through the member', 'Reinforcement', function () { ACT.sectionThroughMember(); });
    add('Steel and schedule panel', 'Reinforcement', function () { ACT.emit('open-drawer', 'rebar'); });
    add('Colour by load intensity', 'Loads', ACT.showLoadMap);
    add('Loads by floor', 'Loads', function () { ACT.emit('open-drawer', 'loads'); });
    add('Include self weight in loads', 'Loads', function () { ACT.setLoadSelfWeight(!S.load.selfWeight); });
    add('Export element list', 'Export', FILES.exportElements);
    add('Export statistics', 'Export', FILES.exportStats);
    add('Export health findings', 'Export', FILES.exportHealth);
    add('Export 3D model', 'Export', FILES.exportObj);
    add('Copy this view state', 'Export', FILES.copyViewState);
    add('Print this page', 'Export', function () { global.print(); });
    add('Compare with another revision…', 'Export', function () { $('compareInput').click(); });

    add('Play or pause the music', 'Audio', function () { S.audio.toggle(); }, 'M');
    add('Next track', 'Audio', function () { S.audio.next(); });
    add('Shuffle tracks', 'Audio', function () {
      S.audio.setShuffle(!S.audio.shuffleOn);
      $('shufBtn').classList.toggle('on', S.audio.shuffleOn);
    });
    global.ETABSAudio.TRACKS.forEach(function (t, i) {
      add('Play “' + t.name + '” (' + t.family + ')', 'Audio', function () {
        S.audio.play(i);
        RAIL.renderTrackList();
      });
    });

    add('What would you like to do?', 'Help', function () { openIntents(); }, 'Ctrl /');
    add('Guide and FAQ', 'Help', function () { openGuide(); }, 'F1');
    add('Keyboard shortcuts', 'Help', showShortcuts, '?');
    add('How quantities are calculated', 'Help', function () { openGuide('quantities'); });
    add('What the health checks mean', 'Help', function () { openGuide('health'); });
    add("What's new in this version", 'Help', function () { guideView = 'releases'; openGuide(); });
    add('Restart the guided tour', 'Help', function () { S.tourStep = -1; nextTour(); });
    add('Switch theme', 'Settings', cycleTheme);
    Units.systems.forEach(function (u) {
      add('Units: ' + u, 'Settings', function () {
        Units.set(u);
        ACT.emit('units');
      });
    });
    add('Replace the logo…', 'Settings', pickLogo);
    return C;
  }

  function openPalette() {
    CMDS = CMDS || commands();
    $('palette').hidden = false;
    $('cmdInput').value = '';
    renderCmds('');
    setTimeout(function () { $('cmdInput').focus(); }, 20);
  }
  function closePalette() { $('palette').hidden = true; }

  function renderCmds(q) {
    var term = q.toLowerCase().trim();
    cmdFiltered = CMDS.filter(function (c) {
      return !term || (c.label + ' ' + c.group).toLowerCase().indexOf(term) >= 0;
    }).slice(0, 60);
    cmdSel = 0;
    var list = $('cmdList');
    list.innerHTML = '';
    cmdFiltered.forEach(function (c, i) {
      var b = el('button', 'cmd' + (i === 0 ? ' sel' : ''));
      b.innerHTML = '<span class="lb"></span>' +
        (c.keys ? '<span class="kb">' + c.keys + '</span>' : '') +
        '<span class="grp">' + c.group + '</span>';
      b.querySelector('.lb').textContent = c.label;
      b.addEventListener('click', function () { closePalette(); c.run(); });
      list.appendChild(b);
    });
    if (!cmdFiltered.length) list.appendChild(el('p', 'hint', 'Nothing matches “' + A.escapeHtml(q) + '”.'));
  }

  function moveCmd(delta) {
    var nodes = $('cmdList').querySelectorAll('.cmd');
    if (!nodes.length) return;
    if (nodes[cmdSel]) nodes[cmdSel].classList.remove('sel');
    cmdSel = (cmdSel + delta + nodes.length) % nodes.length;
    nodes[cmdSel].classList.add('sel');
    nodes[cmdSel].scrollIntoView({ block: 'nearest' });
  }

  /* ================================================================== */
  /* Tour                                                                */
  /* ================================================================== */

  var TOUR = [
    { el: '#sidebar', title: 'Every control lives here', text: 'Twelve grouped panels. Hover anything to see what it does; pin the panels you use to the top.' },
    { el: '#toolbar', title: 'The tools you reach for most', text: 'Style, visibility, spin, explode, measure and snapshot. Every button explains itself on hover.' },
    { el: '#gripRail', title: 'Drag to resize', text: 'Both dividers can be dragged, and double-clicked to snap back. The 3-D view re-measures as you drag.' },
    { el: '#whatBtn', title: 'Not sure where to start?', text: 'Pick a task — review, quantities, present, compare — and the app sets itself up for it.' },
    { el: '#faqBtn', title: 'Everything is explained', text: 'The guide covers the whole app with diagrams, and answers the questions people actually ask.' }
  ];

  function nextTour() {
    S.tourStep++;
    var panel = $('tour');
    if (S.tourStep >= TOUR.length) {
      panel.hidden = true;
      A.prefSet('tourDone', true);
      return;
    }
    var step = TOUR[S.tourStep];
    var target = document.querySelector(step.el);
    if (!target || target.offsetParent === null) { nextTour(); return; }

    $('tourTitle').textContent = step.title;
    $('tourText').textContent = step.text;
    $('tourDots').innerHTML = TOUR.map(function (_, i) {
      return '<i class="' + (i === S.tourStep ? 'on' : '') + '"></i>';
    }).join('');
    $('tourNext').textContent = S.tourStep === TOUR.length - 1 ? 'Done' : 'Next';
    panel.hidden = false;

    var r = target.getBoundingClientRect();
    var pw = 290, ph = panel.offsetHeight || 150;
    var left = Math.min(global.innerWidth - pw - 14, Math.max(14, r.right + 14));
    if (r.right + pw + 20 > global.innerWidth) left = Math.max(14, r.left - pw - 14);
    var top = Math.min(global.innerHeight - ph - 14, Math.max(14, r.top));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  /* ================================================================== */
  /* Audio                                                               */
  /* ================================================================== */

  function initAudio() {
    S.audio = global.ETABSAudio.create();
    var bars = [];
    for (var i = 0; i < 18; i++) {
      var bar = el('i');
      $('viz').appendChild(bar);
      bars.push(bar);
    }

    S.audio.on('track', function (t) {
      $('trackName').textContent = t.name;
      $('trackFam').textContent = t.family + (t.note ? ' · ' + t.note : '');
      RAIL.renderTrackList();
    });
    S.audio.on('state', function (playing) {
      $('playBtn').innerHTML = playing
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
      $('playBtn').classList.toggle('on', playing);
      if (!playing) $('trackName').textContent = 'Ambient paused';
    });
    S.audio.on('error', function (m) { toast(m, 'err'); });

    $('playBtn').addEventListener('click', function () { S.audio.toggle(); });
    $('nextBtn').addEventListener('click', function () { S.audio.next(); });
    $('prevBtn').addEventListener('click', function () { S.audio.prev(); });
    $('shufBtn').addEventListener('click', function () {
      S.audio.setShuffle(!S.audio.shuffleOn);
      $('shufBtn').classList.toggle('on', S.audio.shuffleOn);
    });
    $('volSlider').addEventListener('input', function () {
      S.audio.setVolume(parseFloat(this.value) / 100);
    });
    $('audioInput').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var idx = S.audio.addUserFile(f);
      RAIL.renderTrackList();
      S.audio.play(idx);
      toast('Added “' + f.name + '” for this session');
    });

    (function vizLoop() {
      var levels = S.audio.getLevels();
      for (var i2 = 0; i2 < bars.length; i2++) {
        if (levels) {
          var v = levels[Math.floor(i2 * levels.length / bars.length)] / 255;
          bars[i2].style.height = Math.max(2, v * 20) + 'px';
          bars[i2].style.opacity = 0.35 + v * 0.6;
        } else bars[i2].style.height = '2px';
      }
      requestAnimationFrame(vizLoop);
    })();
  }

  /* ================================================================== */
  /* Viewer wiring                                                       */
  /* ================================================================== */

  function wireViewer() {
    var v = S.viewer;

    v.on('select', function (ids) {
      if (S.measure.mode && ids.length) {
        ACT.addMeasurePoint(ids[ids.length - 1]);
        return;
      }
      A.computeStates();
      if (S.drawerOpen && S.drawerTab === 'properties') DRAWER.render();
      updateStatus();
      syncToolbar();
      if (A.overlayFlags.axes || A.overlayFlags.labels) A.refreshOverlays();
    });

    v.on('hover', function (id) {
      var t = $('hovertip');
      if (id < 0 || !S.model) { t.classList.remove('show'); return; }
      var e = S.model.elements[id];
      if (!e) { t.classList.remove('show'); return; }
      // With the cage on, the bar under the cursor is the more useful fact.
      if (S.rebar.on) {
        var hb = v.pickRebar(v.hoverPos ? v.hoverPos.x : 0, v.hoverPos ? v.hoverPos.y : 0);
        if (hb) {
          S.rebar.hovered = hb;
          t.textContent = (hb.kind === 'tie' ? 'Link' : hb.kind === 'mesh' ? 'Mesh bar' :
            hb.kind === 'dist' ? 'Distribution bar' : 'Main bar') +
            '  ·  ' + hb.dia + ' mm  ·  ' + hb.length.toFixed(2) + ' m  ·  ' +
            (hb.kg || (hb.length * global.ETABSRebar.kgPerM(hb.dia))).toFixed(1) + ' kg  ·  ' +
            (hb.type || '') + ' ' + (hb.section || '');
          var pr = $('stage').getBoundingClientRect();
          if (v.hoverPos) {
            t.style.left = Math.min(pr.width - 280, v.hoverPos.x - pr.left + 14) + 'px';
            t.style.top = (v.hoverPos.y - pr.top + 16) + 'px';
          }
          t.classList.add('show');
          return;
        }
      }

      var txt = e.type + (e.name ? ' ' + e.name : '') +
        (e.section && e.section !== '(none)' ? '  ·  ' + e.section : '') +
        (e.story ? '  ·  ' + e.story : '') +
        (e.length ? '  ·  ' + Units.length(e.length) : '');
      // In load mode the number under the cursor is the point of the view.
      var L = global.ETABSLoads;
      if (S.colorMode === 'load' && S.load.result && L.carries(e)) {
        txt += '  ·  ' + L.fmt(S.load.result.values[id], L.unitFor(e));
      }
      t.textContent = txt;
      var p = v.hoverPos;
      if (p) {
        var rect = $('stage').getBoundingClientRect();
        t.style.left = Math.min(rect.width - 250, p.x - rect.left + 14) + 'px';
        t.style.top = (p.y - rect.top + 16) + 'px';
      }
      t.classList.add('show');
    });

    // The hover event fires when the element under the cursor changes, which
    // is too coarse for individual bars — track the pointer directly while
    // the cage is on.
    $('canvas').addEventListener('mousemove', function (ev) {
      if (!S.rebar.on || !S.model) return;
      var t = $('hovertip');
      var hb = S.viewer.pickRebar(ev.clientX, ev.clientY);
      if (!hb) { S.rebar.hovered = null; return; }
      S.rebar.hovered = hb;
      t.textContent = (hb.kind === 'tie' ? 'Link' : hb.kind === 'mesh' ? 'Mesh bar' :
        hb.kind === 'dist' ? 'Distribution bar' : 'Main bar') +
        '  ·  ' + hb.dia + ' mm  ·  ' + hb.length.toFixed(2) + ' m  ·  ' +
        (hb.kg || hb.length * global.ETABSRebar.kgPerM(hb.dia)).toFixed(1) + ' kg  ·  ' +
        (hb.type || '') + ' ' + (hb.section || '');
      var rect = $('stage').getBoundingClientRect();
      t.style.left = Math.min(rect.width - 300, ev.clientX - rect.left + 14) + 'px';
      t.style.top = (ev.clientY - rect.top + 16) + 'px';
      t.classList.add('show');
    });

    v.on('select', function () {
      // With the cage scoped to the selection, picking a new member should
      // draw its bars without being asked twice.
      if (S.rebar.on && A.rebarSettings().scope === 'selection') {
        clearTimeout(S.rebar._t);
        S.rebar._t = setTimeout(function () { ACT.rebuildRebar(true); }, 120);
      }
    });

    v.on('isolate-request', function (id) {
      if (id < 0) { ACT.showAll(); return; }
      var e = S.model.elements[id];
      var ex = e.kind === 'frame' ? e.a[0] : (e.kind === 'area' ? e.pts[0][0] : e.p[0]);
      var ey = e.kind === 'frame' ? e.a[1] : (e.kind === 'area' ? e.pts[0][1] : e.p[1]);
      var ids = [];
      S.model.elements.forEach(function (o) {
        var ox = o.kind === 'frame' ? o.a[0] : (o.kind === 'area' ? o.pts[0][0] : o.p[0]);
        var oy = o.kind === 'frame' ? o.a[1] : (o.kind === 'area' ? o.pts[0][1] : o.p[1]);
        if (Math.abs(ox - ex) < 0.02 || Math.abs(oy - ey) < 0.02) ids.push(o.id);
      });
      ACT.isolateIds(ids, 'the grid line through that element');
      toast('Isolated that grid line — press U to restore');
    });

    v.on('settled', function () {
      if (S.overlays) S.overlays.declutter();
      drawMinimap();
    });

    v.on('resize', function () {
      if (S.overlays) {
        S.overlays.updateLabelScales();
        S.overlays.declutter();
      }
      drawMinimap();
    });

    // Rubber-band select with Alt held.
    var rubber = $('rubber'), dragStart = null;
    $('canvas').addEventListener('pointerdown', function (e) {
      if (!e.altKey) return;
      dragStart = { x: e.clientX, y: e.clientY };
      rubber.style.display = 'block';
    });
    global.addEventListener('pointermove', function (e) {
      if (!dragStart) return;
      var rect = $('stage').getBoundingClientRect();
      var x1 = Math.min(dragStart.x, e.clientX), x2 = Math.max(dragStart.x, e.clientX);
      var y1 = Math.min(dragStart.y, e.clientY), y2 = Math.max(dragStart.y, e.clientY);
      rubber.style.left = (x1 - rect.left) + 'px';
      rubber.style.top = (y1 - rect.top) + 'px';
      rubber.style.width = (x2 - x1) + 'px';
      rubber.style.height = (y2 - y1) + 'px';
    });
    global.addEventListener('pointerup', function (e) {
      if (!dragStart) return;
      var x1 = Math.min(dragStart.x, e.clientX), x2 = Math.max(dragStart.x, e.clientX);
      var y1 = Math.min(dragStart.y, e.clientY), y2 = Math.max(dragStart.y, e.clientY);
      rubber.style.display = 'none';
      dragStart = null;
      if (x2 - x1 > 6 && y2 - y1 > 6) {
        A.pushHistory('box select');
        v.selectInRect({ left: x1, right: x2, top: y1, bottom: y2 }, e.shiftKey);
      }
    });

    // Right-click action menu.
    $('canvas').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var id = v.pickAt(e.clientX, e.clientY);
      if (id >= 0) v.select([id], false);
      openContextMenu(e, id);
    });
  }

  /* ================================================================== */
  /* Keyboard                                                            */
  /* ================================================================== */

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); openPalette(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault(); openIntents($('whatBtn')); return;
      }
      if (e.key === 'F1') { e.preventDefault(); openGuide(); return; }

      if (!$('palette').hidden) {
        if (e.key === 'Escape') { closePalette(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveCmd(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveCmd(-1); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          var c = cmdFiltered[cmdSel];
          closePalette();
          if (c) c.run();
          return;
        }
        return;
      }

      if (e.key === 'Escape') {
        if (!$('guide').hidden) { $('guide').hidden = true; return; }
        if (!$('modal').hidden) { closeModal(); return; }
        if (S.presenting) { ACT.setPresenting(false); return; }
        if (S.measure.mode) { ACT.setMeasureMode(null); return; }
        if (S.viewer) { S.viewer.select([], false); ACT.showAll(); }
        return;
      }
      if (typing) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); ACT.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); ACT.redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!S.model && e.key !== '?') return;

      var views = { '1': 'top', '2': 'front', '3': 'right', '4': 'iso', '5': 'back', '6': 'left' };
      if (views[e.key]) { ACT.setView(views[e.key]); return; }

      switch (e.key.toLowerCase()) {
        case 'f': ACT.frameAll(); break;
        case 'z': ACT.frameSelection(); break;
        case 'r': ACT.toggleTurntable(false); break;
        case 'c': ACT.toggleTurntable(true); break;
        case 'w': if (!S.viewer.walk.on) ACT.toggleWalk(); break;
        case 's': ACT.setStyle('solid'); break;
        case 't': ACT.setStyle('technical'); break;
        case 'x': ACT.setStyle('xray'); break;
        case 'l': ACT.setStyle('wireframe'); break;
        case 'g':
          A.overlayFlags.grids = !A.overlayFlags.grids;
          A.refreshOverlays(); syncToolbar(); break;
        case 'd':
          A.overlayFlags.dims = !A.overlayFlags.dims; A.refreshOverlays(); break;
        case 'n':
          A.overlayFlags.levels = !A.overlayFlags.levels; A.refreshOverlays(); break;
        case 'a':
          A.overlayFlags.axes = !A.overlayFlags.axes; A.refreshOverlays(); break;
        case 'i': ACT.isolateSelection(); break;
        case 'h': ACT.hideSelection(); break;
        case 'v': ACT.invertVisibility(); break;
        case 'u': ACT.showAll(); break;
        case 'e': ACT.resetExplode(); break;
        case 'p': FILES.exportPng(false); break;
        case 'm': S.audio.toggle(); break;
        case '[':
          $('sidebar').classList.toggle('collapsed');
          setTimeout(function () { S.viewer.resize(); }, 40);
          break;
        case ']': DRAWER.toggle(); break;
        case '?': showShortcuts(); break;
      }
    });
  }

  /* ================================================================== */
  /* Boot                                                                */
  /* ================================================================== */

  function boot() {
    S.theme = A.prefGet('theme', 'system');
    S.pinned = A.prefGet('pinned', []);
    S.savedViews = A.prefGet('savedViews', []);
    S.autoMusic = A.prefGet('autoMusic', true);
    S.quality = A.prefGet('quality', 'balanced');
    S.labelScale = A.prefGet('labelScale', 1);
    A.BRAND.logo = A.prefGet('logo', null);
    S.costing = global.ETABSCosting.load();
    var pal = A.prefGet('palette', null);
    if (pal) { S.palette = pal.name || S.palette; S.customColors = pal.custom || {}; }

    UI.Tips.init();
    UI.Menu.init();

    S.panels = UI.Panels({
      onResize: function () { if (S.viewer) S.viewer.resize(); }
    });
    S.panels
      .register('rail', $('sidebar'), { min: 240, max: 520, def: 320, side: 'left', varName: '--rail' })
      .register('drawer', $('drawer'), { min: 260, max: 620, def: 360, side: 'right', varName: '--drawer' });
    S.panels.restore();
    S.panels.attach($('gripRail'), 'rail');
    S.panels.attach($('gripDrawer'), 'drawer');
    $('gripDrawer').classList.add('hidden');

    S.history = UI.History({
      capture: A.captureSnapshot,
      apply: A.applySnapshot
    }).onChange(function () { syncToolbar(); });

    A.onSnapshotApplied(function (snap) {
      ACT.applyClip();          // clipping planes are derived state — rebuild them
      // The cage is derived too: undo should put it back the way it was.
      if (snap && snap.rebarOn !== undefined && snap.rebarOn !== S.rebar.on) {
        ACT.toggleRebar(snap.rebarOn);
      }
      RAIL.build();
      buildLadder();
      if (S.drawerOpen) DRAWER.render();
      updateStatus();
      syncToolbar();
      A.refreshOverlays();
    });
    A.onColorsChanged(function () { RAIL.renderLegend(); });
    A.onStatesChanged(function () {
      updateStatus();
      syncToolbar();
      drawMinimap();
    });

    applyTheme(S.theme);
    paintBrand();
    startClock();
    initAudio();
    RAIL.build();
    buildToolbar();
    DRAWER.buildSelector();
    bindKeys();

    /* ---- Samples on the drop screen ---- */
    var host = $('dzSamples');
    global.ETABSDemo.samples.forEach(function (s) {
      var b = el('button', 'dz-sample');
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = s.name;
      b.querySelector('span').textContent = s.note;
      A.tip(b, 'Open this sample right now — no file needed');
      b.addEventListener('click', function () { FILES.loadSample(s.id); });
      host.appendChild(b);
    });

    /* ---- Top bar ---- */
    $('pickBtn').addEventListener('click', function () { $('fileInput').click(); });
    $('dzGuide').addEventListener('click', function () { openGuide('start'); });
    $('dzSamplesDl').addEventListener('click', FILES.downloadSamples);
    $('fileInput').addEventListener('change', function () { FILES.handleFile(this.files[0], false); this.value = ''; });
    $('compareInput').addEventListener('change', function () {
      if (!S.model) { toast('Load a base model first', 'err'); return; }
      FILES.handleFile(this.files[0], true);
      this.value = '';
    });
    $('railBtn').addEventListener('click', function () {
      $('sidebar').classList.toggle('collapsed');
      setTimeout(function () { if (S.viewer) S.viewer.resize(); }, 40);
    });
    $('railFilter').addEventListener('input', function () { RAIL.filter(this.value); });
    $('themeBtn').addEventListener('click', cycleTheme);
    $('cmdBtn').addEventListener('click', openPalette);
    $('faqBtn').addEventListener('click', function () { openGuide(); });
    $('whatBtn').addEventListener('click', function () { openIntents($('whatBtn')); });
    $('reloadBtn').addEventListener('click', function () { confirmReload($('reloadBtn')); });
    $('undoBtn').addEventListener('click', ACT.undo);
    $('redoBtn').addEventListener('click', ACT.redo);
    $('drawerClose').addEventListener('click', DRAWER.close);
    $('cmdInput').addEventListener('input', function () { renderCmds(this.value); });
    $('guideSearch').addEventListener('input', function () { renderGuide(this.value); });
    $('tourNext').addEventListener('click', nextTour);
    $('tourSkip').addEventListener('click', function () {
      $('tour').hidden = true;
      A.prefSet('tourDone', true);
    });

    $('presentExit').addEventListener('click', function () { ACT.setPresenting(false); });
    $('presentSpin').addEventListener('click', function () { ACT.toggleTurntable(true); });
    $('presentMusic').addEventListener('click', function () { S.audio.toggle(); });
    $('presentShot').addEventListener('click', function () { FILES.exportPng(false); });

    document.querySelectorAll('#viewcube button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (S.viewer) ACT.setView(b.dataset.view);
      });
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) {
        closeModal();
        $('guide').hidden = true;
      }
      if (e.target === $('palette')) closePalette();
      if (e.target === $('modal')) closeModal();
      if (e.target === $('guide')) $('guide').hidden = true;
    });

    /* ---- Drag and drop ---- */
    ['dragenter', 'dragover'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        e.preventDefault();
        $('dropzone').classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === 'dragleave' && e.relatedTarget) return;
        $('dropzone').classList.remove('dragging');
      });
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) FILES.handleFile(f, false);
    });

    global.addEventListener('resize', function () {
      if ($('tour').hidden) return;
      S.tourStep--;
      nextTour();
    });

    /* ---- Cross-module events ---- */
    ACT.on('ui', function () { syncToolbar(); });
    ACT.on('rebuild-rail', function () { RAIL.build(); });
    ACT.on('storeys', function () { buildLadder(); });
    ACT.on('measure', function (d) { RAIL.setMeasureResult(d); });
    ACT.on('open-drawer', function (tab) { DRAWER.open(tab); });
    ACT.on('drawer-refresh', function () { if (S.drawerOpen) DRAWER.render(); });
    ACT.on('quantities-changed', function () {
      RAIL.refreshDynamic();
      if (S.drawerOpen) DRAWER.render();
    });
    ACT.on('units', function () {
      A.refreshOverlays();
      RAIL.build();
      buildLadder();
      if (S.drawerOpen) DRAWER.render();
      updateStatus();
    });
    ACT.on('theme', applyTheme);
    ACT.on('pick-logo', pickLogo);
    ACT.on('clear-logo', function () {
      A.BRAND.logo = null;
      A.prefSet('logo', null);
      paintBrand();
    });
    ACT.on('confirm-reload', function () { confirmReload(); });
    ACT.on('open-guide', function () { openGuide(); });
    ACT.on('open-shortcuts', showShortcuts);
    ACT.on('open-intents', function () { openIntents(); });
    ACT.on('restart-tour', function () { S.tourStep = -1; nextTour(); });
    ACT.on('ask-token', function () {
      askText('Restore a view state', 'Paste the token someone shared with you.',
        'STRUCTURA/1|…', function (v) { FILES.restoreViewState(v); });
    });
    ACT.on('ask-filter-name', function () {
      askText('Save this filter', 'Give the rule a name. Saved sets work on any model.',
        'e.g. Transfer columns', function (v) {
          global.ETABSFilters.addSet(v, S.filter.conditions);
          RAIL.build();
          toast('Saved “' + v + '”');
        });
    });
    ACT.on('reset-all', function () {
      UI.confirmAction({
        title: 'Reset everything in this browser?',
        detail: 'Panel widths, saved views, palettes, filter sets and your rate card will be cleared. ' +
                'Your model is not affected.',
        confirmLabel: 'Yes, reset it all',
        anchor: $('sidebar')
      }).then(function (ok) {
        if (!ok) return;
        try { Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf('structura.') === 0) localStorage.removeItem(k);
        }); } catch (e) { /* private mode */ }
        toast('Reset — reload to start fresh', 'ok');
      });
    });

    FILES.on('viewer-created', wireViewer);
    FILES.on('binary', function (d) { showExportWizard(d.file, d.probe); });
    FILES.on('diagnose', function (d) { showDiagnostic(d.model, d.reason); });
    FILES.on('model-loaded', function () {
      $('reloadBtn').hidden = false;
      A.computeColors();
      A.computeStates();
      A.refreshOverlays();
      RAIL.build();
      buildLadder();
      DRAWER.buildSelector();
      if (S.drawerOpen) DRAWER.render();
      drawMinimap();
      updateStatus();
      syncToolbar();
      CMDS = null;
      if (!A.prefGet('tourDone', false)) setTimeout(function () { S.tourStep = -1; nextTour(); }, 700);
      else setTimeout(function () { openIntents($('whatBtn')); }, 600);
    });
    FILES.on('model-closed', function () {
      $('reloadBtn').hidden = true;
      RAIL.build();
    });
    FILES.on('compare', function () {
      RAIL.build();
      if (S.drawerOpen) DRAWER.render();
    });
    FILES.on('show-token', function (token) {
      openModal('Copy this view state',
        '<p class="hint" style="margin-bottom:10px">Copying failed, so here it is — select it all and copy.</p>' +
        '<textarea readonly style="width:100%;height:120px;font-family:var(--font-mono);font-size:11px;' +
        'border:1px solid var(--line);border-radius:7px;padding:8px;background:var(--surface-2)">' +
        A.escapeHtml(token) + '</textarea>');
    });

    setTimeout(function () { $('splash').classList.add('gone'); }, 560);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
