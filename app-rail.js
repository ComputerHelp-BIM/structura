/**
 * app-rail.js — The control rail.
 * =================================================================
 * Twelve grouped panels. Every control carries a `data-tip` saying what it
 * does in one line, because a dense tool that does not explain itself is
 * only usable by the person who built it.
 *
 * Namespace: window.RAIL
 */
(function (global) {
  'use strict';

  var A = global.APP, S = A.S, ACT = global.ACT, FILES = global.FILES;
  var $ = A.$, el = A.el, toast = A.toast;
  var Units = global.ETABSUnits;
  var Filters = global.ETABSFilters;
  var Costing = global.ETABSCosting;

  /* ================================================================== */
  /* Control factories                                                   */
  /* ================================================================== */

  function label(parent, text) { parent.appendChild(el('span', 'lbl', text)); }
  function hint(parent, html) { parent.appendChild(el('p', 'hint', html)); }

  function segmented(parent, options, current, onPick) {
    var seg = el('div', 'seg');
    options.forEach(function (o) {
      var b = el('button', o.value === current ? 'on' : '', o.label);
      if (o.tip) A.tip(b, o.tip, o.key);
      if (o.data) Object.keys(o.data).forEach(function (k) { b.dataset[k] = o.data[k]; });
      b.addEventListener('click', function () {
        seg.querySelectorAll('button').forEach(function (n) { n.classList.remove('on'); });
        b.classList.add('on');
        onPick(o.value);
      });
      seg.appendChild(b);
    });
    parent.appendChild(seg);
    return seg;
  }

  function slider(parent, text, min, max, step, value, onInput, format, tipText) {
    var row = el('div', 'row');
    row.appendChild(el('label', '', text));
    var input = el('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    if (tipText) A.tip(input, tipText);
    var out = el('span', 'val', format ? format(value) : value);
    // Set input.historyLabel to make a drag undoable: the state before the
    // gesture is recorded once, on the first movement, not on every tick.
    var armed = false;
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      out.textContent = format ? format(v) : v;
      if (input.historyLabel && !armed) { A.pushHistory(input.historyLabel); armed = true; }
      onInput(v);
    });
    input.addEventListener('change', function () { armed = false; });
    row.appendChild(input);
    row.appendChild(out);
    parent.appendChild(row);
    return input;
  }

  /** Make a slider's drags undoable under the given history label. */
  function rec(label, input) { input.historyLabel = label; return input; }

  function buttons(parent, cols, items) {
    var g = el('div', 'grid' + cols);
    items.forEach(function (it) {
      var b = el('button', 'mini' + (it.on ? ' on' : ''), it.label);
      if (it.tip) A.tip(b, it.tip, it.key);
      if (it.id) b.id = it.id;
      b.addEventListener('click', function () { it.run(b); });
      g.appendChild(b);
    });
    parent.appendChild(g);
    return g;
  }

  function checkbox(parent, text, checked, onChange, tipText) {
    var l = el('label', 'check');
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    if (tipText) A.tip(l, tipText);
    cb.addEventListener('change', function () { onChange(cb.checked); });
    l.appendChild(cb);
    var span = el('span');
    span.innerHTML = text;
    l.appendChild(span);
    parent.appendChild(l);
    return cb;
  }

  function numberField(parent, text, unit, value, onChange, flagged) {
    var row = el('div', 'rate-row' + (flagged ? ' flagged' : ''));
    var nm = el('span');
    nm.textContent = text;
    var input = el('input');
    input.type = 'number';
    input.value = value;
    input.step = 'any';
    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (isFinite(v)) onChange(v);
    });
    var u = el('span', 'unit');
    u.textContent = unit;
    row.appendChild(nm); row.appendChild(input); row.appendChild(u);
    parent.appendChild(row);
    return input;
  }

  /* ================================================================== */
  /* Sections                                                            */
  /* ================================================================== */

  var sections = [];
  function section(id, title, builder) { sections.push({ id: id, title: title, builder: builder }); }

  /* ---- File ---- */
  section('file', 'File &amp; model', function (b) {
    buttons(b, 2, [
      { label: 'Open model…', tip: 'Browse for a .e2k, .s2k, .csv or .xlsx file', run: function () { $('fileInput').click(); } },
      { label: 'Reload model', tip: 'Re-read the file and discard every change — asks first', run: function () { ACT.emit('confirm-reload'); } },
      { label: 'Close model', tip: 'Clear the model and return to the start screen', run: function () { FILES.closeModel(); } },
      { label: 'Show everything', tip: 'Undo hiding and isolating without reloading', run: function () { ACT.showAll(); } }
    ]);
    label(b, 'Sample buildings');
    var g = el('div', 'grid3');
    global.ETABSDemo.samples.forEach(function (s) {
      var btn = el('button', 'mini', s.short || s.name.split(' ')[0]);
      A.tip(btn, s.name + ' — ' + s.note);
      btn.addEventListener('click', function () { FILES.loadSample(s.id); });
      g.appendChild(btn);
    });
    b.appendChild(g);
    buttons(b, 2, [
      { label: 'Download the samples', tip: 'Get every sample .e2k file as a zip', run: FILES.downloadSamples },
      { label: 'What is in this file?', tip: 'Every record type found, and why anything was skipped', run: FILES.diagnose }
    ]);

    label(b, 'Units');
    var sel = el('select');
    A.tip(sel, 'Every dimension and quantity recomputes when you change this');
    Units.systems.forEach(function (u) {
      var o = el('option', '', u);
      o.value = u;
      if (u === Units.current) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      Units.set(sel.value);
      ACT.emit('units');
    });
    b.appendChild(sel);
    hint(b, 'Units are read from the file header and can be switched at any time.');
  });

  /* ---- View ---- */
  section('view', 'View &amp; camera', function (b) {
    label(b, 'Standard views');
    buttons(b, 4, [
      { label: 'Plan', key: '1', tip: 'Look straight down', run: function () { ACT.setView('top'); } },
      { label: 'Front', key: '2', tip: 'Elevation along +Y', run: function () { ACT.setView('front'); } },
      { label: 'Right', key: '3', tip: 'Elevation along +X', run: function () { ACT.setView('right'); } },
      { label: 'Iso', key: '4', tip: 'Three-quarter isometric', run: function () { ACT.setView('iso'); } },
      { label: 'Back', key: '5', tip: 'Elevation from behind', run: function () { ACT.setView('back'); } },
      { label: 'Left', key: '6', tip: 'Elevation from the left', run: function () { ACT.setView('left'); } },
      { label: 'SW', tip: 'South-west isometric', run: function () { ACT.setView('isoSW'); } },
      { label: 'NE', tip: 'North-east isometric', run: function () { ACT.setView('isoNE'); } }
    ]);

    label(b, 'Projection');
    segmented(b, [
      { value: 'persp', label: 'Perspective', tip: 'Natural depth — how the eye sees it' },
      { value: 'ortho', label: 'Orthographic', tip: 'No perspective — the right choice for elevations' }
    ], S.viewer && S.viewer.useOrtho ? 'ortho' : 'persp', function (v) { S.viewer.setProjection(v); });

    label(b, 'Grid elevation');
    var sel = el('select');
    sel.id = 'gridSelect';
    A.tip(sel, 'Cut the model on one grid line and turn to face it');
    sel.appendChild(new Option('— pick a grid line —', ''));
    sel.addEventListener('change', function () { ACT.clipToGrid(sel.value); });
    b.appendChild(sel);

    label(b, 'Motion');
    buttons(b, 3, [
      { label: '360° spin', key: 'R', tip: 'Rotate the model continuously', run: function () { ACT.toggleTurntable(false); } },
      { label: 'Cinematic', key: 'C', tip: 'Slow rising orbit, for recording', run: function () { ACT.toggleTurntable(true); } },
      { label: 'Walk', key: 'W', tip: 'Walk inside the building with W A S D', run: function () { ACT.toggleWalk(); } }
    ]);
    slider(b, 'Spin speed', 0.05, 1.6, 0.05, S.viewer ? S.viewer.turntable.speed : 0.35,
      function (v) { S.viewer.setTurntableSpeed(v); },
      function (v) { return v.toFixed(2) + '×'; }, 'How fast the 360° spin turns');

    label(b, 'Saved views');
    var list = el('div', 'legend');
    list.id = 'savedViews';
    b.appendChild(list);
    buttons(b, 2, [
      { label: 'Save this view', tip: 'Remembers the camera and what is visible', run: function () { ACT.saveCurrentView(); } },
      { label: 'Copy view state', tip: 'Copy a token you can paste to someone else', run: FILES.copyViewState }
    ]);
    buttons(b, 1, [{
      label: 'Restore a view state…', tip: 'Paste a token someone sent you',
      run: function () { ACT.emit('ask-token'); }
    }]);
  });

  /* ---- Display ---- */
  section('display', 'Display style', function (b) {
    label(b, 'Render style');
    segmented(b, [
      { value: 'solid', label: 'Solid', key: 'S', tip: 'True extruded section profiles' },
      { value: 'technical', label: 'Technical', key: 'T', tip: 'Flat shading with edges — reads well on a projector' },
      { value: 'xray', label: 'X-ray', key: 'X', tip: 'See interior columns through the facade' },
      { value: 'wireframe', label: 'Wire', key: 'L', tip: 'Centreline sticks only — fastest' }
    ], S.renderStyle, function (v) { ACT.setStyle(v); });

    label(b, 'Quality');
    segmented(b, [
      { value: 'draft', label: 'Draft', tip: 'No shadows, lowest resolution — fastest' },
      { value: 'balanced', label: 'Balanced', tip: 'Shadows on, sensible resolution' },
      { value: 'presentation', label: 'Presentation', tip: 'Best shadows and pixel density — for meetings' }
    ], S.quality, function (v) { ACT.setQualityPreset(v); });

    label(b, 'Environment');
    var envSeg = segmented(b, [
      { value: 'studio', label: 'Studio', tip: 'Clean white backdrop', data: { env: 'studio' } },
      { value: 'night', label: 'Night', tip: 'Dark ground with rim light', data: { env: 'night' } },
      { value: 'blueprint', label: 'Blueprint', tip: 'Cyan on drafting blue', data: { env: 'blueprint' } },
      { value: 'sunset', label: 'Sunset', tip: 'Warm low sun and long shadows', data: { env: 'sunset' } }
    ], S.environment, function (v) { ACT.setEnvironment(v); });
    void envSeg;
    buttons(b, 2, [
      { label: 'Construction site', tip: 'Dusty site context', run: function () { ACT.setEnvironment('site'); } },
      { label: 'Follow theme', tip: 'Scene switches with light/dark automatically', run: function () {
        S.envPinned = false;
        ACT.setEnvironment(A.isDarkUI() ? 'night' : 'studio', false);
        toast('Scene now follows the interface theme');
      } }
    ]);

    label(b, 'Lighting');
    slider(b, 'Sun azimuth', 0, 360, 1, 135, function (v) {
      S.viewer.setSun(v, S.viewer.sunAngle ? S.viewer.sunAngle.altitude : 55);
    }, function (v) { return v + '°'; }, 'Swing the sun around the building');
    slider(b, 'Sun height', 5, 88, 1, 55, function (v) {
      S.viewer.setSun(S.viewer.sunAngle ? S.viewer.sunAngle.azimuth : 135, v);
    }, function (v) { return v + '°'; }, 'Raise or lower the sun — changes shadow length');

    checkbox(b, 'Soft shadows', S.viewer ? S.viewer.quality.shadows : true,
      function (v) { S.viewer.setQuality({ shadows: v }); }, 'Contact shadows make the model read as solid');
    checkbox(b, 'Ground plane', S.viewer ? S.viewer.quality.ground : true,
      function (v) { S.viewer.setQuality({ ground: v }); }, 'A floor under the building, rather than empty space');
    slider(b, 'Ghost opacity', 0.02, 0.5, 0.01, 0.12, function (v) { S.viewer.setGhostOpacity(v); },
      function (v) { return Math.round(v * 100) + '%'; }, 'How faint the ghosted elements are when isolating');

    label(b, 'Context layers');
    [
      ['grids', 'Grid lines &amp; bubbles', 'G', 'The grid cage with labelled bubbles'],
      ['levels', 'Storey level markers', 'N', 'Level lines and elevation labels down one edge'],
      ['levelPlanes', 'Level planes', '', 'Translucent plane at every storey'],
      ['dims', 'Bay dimensions', 'D', 'Centre-to-centre dimensions between grids'],
      ['axes', 'Local 1-2-3 axes', 'A', 'Red / green / blue triads showing member orientation'],
      ['loads', 'Load vectors', '', 'Arrows for point, line and area loads in the file']
    ].forEach(function (p) {
      checkbox(b, p[1], !!A.overlayFlags[p[0]], function (v) {
        A.overlayFlags[p[0]] = v;
        A.refreshOverlays();
        ACT.emit('ui');
      }, p[3] + (p[2] ? '  (' + p[2] + ')' : ''));
    });

    label(b, 'Element labels');
    segmented(b, [
      { value: '', label: 'Off', tip: 'No labels on the model' },
      { value: 'name', label: 'Names', tip: 'Element names from the file' },
      { value: 'section', label: 'Sections', tip: 'Section name on each member' }
    ], A.overlayFlags.labels, function (v) {
      A.overlayFlags.labels = v;
      A.refreshOverlays();
    });
    slider(b, 'Label size', 0.7, 1.8, 0.05, S.labelScale, function (v) {
      S.labelScale = v;
      A.prefSet('labelScale', v);
      S.overlays.setLabelScale(v);
    }, function (v) { return Math.round(v * 100) + '%'; }, 'Labels hold a constant size on screen — this sets it');
    checkbox(b, 'Thin out crowded labels', true, function (v) {
      S.overlays.declutterOn = v;
      if (!v) S.overlays.sprites.forEach(function (s) { s.visible = true; });
      else S.overlays.declutter();
      S.viewer.needsRender = true;
    }, 'Hides labels that would overlap, nearest first');
  });

  /* ---- Colour ---- */
  section('colour', 'Colour', function (b) {
    label(b, 'Colour elements by');
    var modes = A.COLOR_MODES;
    segmented(b, modes.slice(0, 4).map(function (m) {
      return { value: m.id, label: m.label, tip: m.tip };
    }), S.colorMode, function (v) { ACT.setColorMode(v); });
    segmented(b, modes.slice(4).map(function (m) {
      return { value: m.id, label: m.label, tip: m.tip };
    }), S.colorMode, function (v) { ACT.setColorMode(v); });

    label(b, 'Palette');
    var pals = Object.keys(A.PALETTES).map(function (p) {
      return { label: p.charAt(0).toUpperCase() + p.slice(1), value: p, tip: 'Recolour every group using the ' + p + ' palette' };
    });
    segmented(b, pals.slice(0, 3), S.palette, function (v) { ACT.setPalette(v); });
    segmented(b, pals.slice(3), S.palette, function (v) { ACT.setPalette(v); });

    label(b, 'Legend');
    hint(b, S.colorMode === 'load'
      ? 'The load map has its own scale — change the case and the scale in <b>Loads &amp; intensity</b>.'
      : (S.colorMode === 'height' || S.colorMode === 'length'
        ? 'A gradient mode: the bar below shows the range it covers.'
        : 'Click a swatch to recolour that group. Click the row to hide it.'));
    var lg = el('div', 'legend');
    lg.id = 'legend';
    b.appendChild(lg);

    buttons(b, 2, [
      { label: 'Reset colours', tip: 'Drop custom swatches and go back to the palette', run: function () {
        S.customColors = {};
        A.computeColors();
        toast('Colours reset');
      } },
      { label: 'Save palette', tip: 'Keep this palette for future models', run: function () {
        A.prefSet('palette', { name: S.palette, custom: S.customColors });
        toast('Palette saved to this browser');
      } }
    ]);
  });

  /* ---- Find ---- */
  section('find', 'Find &amp; filter', function (b) {
    label(b, 'Quick search');
    var box = el('input');
    box.type = 'text';
    box.placeholder = 'section, material, storey, > 6m…';
    A.tip(box, 'Matches names, sections, materials, storeys and types');
    var out = el('p', 'hint', 'Type to search.');
    box.addEventListener('input', function () {
      if (!S.model) return;
      var r = Filters.quickSearch(S.model, box.value);
      if (!box.value.trim()) { out.textContent = 'Type to search.'; return; }
      out.innerHTML = '<b>' + r.ids.length + '</b> element(s) ' + A.escapeHtml(r.summary);
      S.filter.lastIds = r.ids;
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && S.filter.lastIds) {
        ACT.selectIds(S.filter.lastIds, false, 'search selection');
        S.viewer.frameElements(S.filter.lastIds);
      }
    });
    b.appendChild(box);
    b.appendChild(out);
    buttons(b, 2, [
      { label: 'Select matches', tip: 'Select everything the search found', run: function () {
        if (S.filter.lastIds) ACT.selectIds(S.filter.lastIds, false, 'search selection');
      } },
      { label: 'Isolate matches', tip: 'Show only what the search found', run: function () {
        if (S.filter.lastIds) ACT.isolateIds(S.filter.lastIds, 'search result');
      } }
    ]);

    label(b, 'Filter builder');
    var host = el('div');
    host.id = 'filterConds';
    b.appendChild(host);
    renderConditions(host);

    buttons(b, 2, [
      { label: '+ Condition', tip: 'Add another rule — all rules must match', run: function () {
        S.filter.conditions.push({ field: 'type', op: 'is', value: '' });
        renderConditions(host);
      } },
      { label: 'Clear', tip: 'Remove every rule', run: function () {
        S.filter.conditions = [];
        renderConditions(host);
      } }
    ]);
    var res = el('p', 'hint', '');
    res.id = 'filterResult';
    b.appendChild(res);
    buttons(b, 3, [
      { label: 'Run', tip: 'Find the elements matching every rule', run: function () { runFilter(); } },
      { label: 'Isolate', tip: 'Run and show only the matches', run: function () {
        var ids = runFilter();
        if (ids && ids.length) ACT.isolateIds(ids, 'filter result');
      } },
      { label: 'Save set', tip: 'Keep this rule for any model', run: function () { ACT.emit('ask-filter-name'); } }
    ]);

    label(b, 'Saved sets');
    var sets = el('div', 'legend');
    sets.id = 'filterSets';
    b.appendChild(sets);
    renderSets(sets, host);
  });

  function renderConditions(host) {
    host.innerHTML = '';
    if (!S.filter.conditions.length) {
      host.appendChild(el('p', 'hint', 'No rules yet — add one to build a filter.'));
      return;
    }
    S.filter.conditions.forEach(function (cond, i) {
      var card = el('div', 'fcond');

      var fieldSel = el('select');
      A.tip(fieldSel, 'Which property to test');
      Filters.FIELDS.forEach(function (f) {
        var o = new Option(f.label, f.id);
        if (f.id === cond.field) o.selected = true;
        fieldSel.appendChild(o);
      });

      var opSel = el('select');
      A.tip(opSel, 'How to compare it');

      function fillOps() {
        var f = Filters.fieldById(cond.field);
        opSel.innerHTML = '';
        Filters.OPERATORS[f.kind].forEach(function (o) {
          var opt = new Option(o.label, o.id);
          if (o.id === cond.op) opt.selected = true;
          opSel.appendChild(opt);
        });
        if (!Filters.OPERATORS[f.kind].some(function (o) { return o.id === cond.op; })) {
          cond.op = Filters.OPERATORS[f.kind][0].id;
          opSel.value = cond.op;
        }
      }
      fillOps();

      fieldSel.addEventListener('change', function () {
        cond.field = fieldSel.value;
        cond.value = '';
        fillOps();
        renderConditions(host);
      });
      opSel.addEventListener('change', function () {
        cond.op = opSel.value;
        renderConditions(host);
      });

      card.appendChild(fieldSel);
      card.appendChild(opSel);

      var valWrap = el('div', 'fval');
      var f2 = Filters.fieldById(cond.field);
      if (cond.op !== 'empty') {
        if (f2.kind === 'enum' && S.model) {
          var vs = el('select');
          A.tip(vs, 'Pick a value present in this model');
          vs.appendChild(new Option('— pick —', ''));
          Filters.distinct(S.model, cond.field).forEach(function (d) {
            var o = new Option(d.value + '  (' + d.count + ')', d.value);
            if (d.value === cond.value) o.selected = true;
            vs.appendChild(o);
          });
          vs.addEventListener('change', function () { cond.value = vs.value; });
          valWrap.appendChild(vs);
        } else {
          var inp = el('input');
          inp.type = f2.kind === 'number' ? 'number' : 'text';
          inp.value = cond.value || '';
          inp.placeholder = f2.kind === 'number' ? 'value' : 'text to match';
          A.tip(inp, 'The value to compare against');
          inp.addEventListener('input', function () { cond.value = inp.value; });
          valWrap.appendChild(inp);
          if (cond.op === 'between') {
            var inp2 = el('input');
            inp2.type = 'number';
            inp2.value = cond.value2 || '';
            inp2.placeholder = 'and';
            inp2.addEventListener('input', function () { cond.value2 = inp2.value; });
            valWrap.appendChild(inp2);
          }
        }
      }
      card.appendChild(valWrap);

      var del = el('button', 'fdel', '✕');
      A.tip(del, 'Remove this rule');
      del.addEventListener('click', function () {
        S.filter.conditions.splice(i, 1);
        renderConditions(host);
      });
      card.appendChild(del);
      host.appendChild(card);
    });
  }

  function runFilter() {
    if (!S.model) return null;
    var ids = Filters.run(S.model, S.filter.conditions);
    var out = $('filterResult');
    if (out) {
      out.innerHTML = '<b>' + ids.length + '</b> match: ' + A.escapeHtml(Filters.describe(S.filter.conditions));
    }
    if (ids.length) ACT.selectIds(ids, false, 'filter selection');
    else toast('Nothing matches those rules');
    return ids;
  }

  function renderSets(host, condHost) {
    host.innerHTML = '';
    var sets = Filters.loadSets();
    if (!sets.length) {
      host.appendChild(el('p', 'hint', 'No saved sets yet.'));
      return;
    }
    sets.forEach(function (set) {
      var row = el('div', 'legend-item');
      A.tip(row, Filters.describe(set.conditions));
      var nm = el('span', 'nm');
      nm.textContent = set.name;
      var del = el('span', 'ct', '✕');
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        Filters.removeSet(set.name);
        renderSets(host, condHost);
      });
      row.appendChild(nm);
      row.appendChild(del);
      row.addEventListener('click', function () {
        S.filter.conditions = JSON.parse(JSON.stringify(set.conditions));
        renderConditions(condHost);
        runFilter();
      });
      host.appendChild(row);
    });
  }

  /* ---- Visibility ---- */
  section('visibility', 'Visibility', function (b) {
    label(b, 'Element types');
    var box = el('div');
    box.id = 'typeToggles';
    b.appendChild(box);

    label(b, 'Storey range');
    var row = el('div');
    row.id = 'storeyRange';
    b.appendChild(row);

    label(b, 'Selection actions');
    buttons(b, 2, [
      { label: 'Isolate', key: 'I', tip: 'Show only what is selected', run: ACT.isolateSelection },
      { label: 'Hide', key: 'H', tip: 'Remove the selection from view', run: ACT.hideSelection },
      { label: 'Invert', key: 'V', tip: 'Swap what is shown for what is hidden', run: ACT.invertVisibility },
      { label: 'Show all', key: 'U', tip: 'Bring everything back', run: function () { ACT.showAll(); } }
    ]);
    checkbox(b, 'Ghost the rest instead of hiding', S.ghostMode, function (v) { ACT.setGhostMode(v); },
      'Isolated views keep faint context instead of empty space');
    hint(b, 'Double-click a member to isolate its whole grid line. <b>Esc</b> restores everything.');
  });

  /* ---- Slice ---- */
  section('slice', 'Slice &amp; section', function (b) {
    var boxMode = S.clip.box;
    var pct = function (v) { return Math.round(v * 100) + '%'; };
    var axisWord = { x: 'X (along the building length)', y: 'Y (across the building)', z: 'Z (height)' };

    if (S.clip.grid || S.clip.storey) {
      hint(b, 'Showing <b>' + (S.clip.grid ? 'grid section ' + S.clip.grid : 'plan slice ' + S.clip.storey) +
        '</b>. Touching any control below switches back to free cuts.');
    }

    ['x', 'y', 'z'].forEach(function (axis) {
      var A2 = axis.toUpperCase();
      if (!boxMode) {
        var l = el('label', 'check');
        A.tip(l, 'Cut the model with a plane across ' + axisWord[axis]);
        var cb = el('input');
        cb.type = 'checkbox';
        cb.checked = S.clip[axis].on && !S.clip.grid && !S.clip.storey;
        cb.addEventListener('change', function () { ACT.setClipAxis(axis, cb.checked); });
        l.appendChild(cb);
        l.appendChild(el('span', '', 'Clip on ' + A2));
        var flip = el('button', 'mini', 'Flip');
        flip.style.cssText = 'margin-left:auto;padding:2px 7px';
        A.tip(flip, 'Keep the other side of the ' + A2 + ' cut instead');
        flip.addEventListener('click', function (e) { e.preventDefault(); ACT.flipClip(axis); });
        l.appendChild(flip);
        b.appendChild(l);
      }
      var input = slider(b, A2 + (boxMode ? ' centre' : ' position'), 0, 1, 0.005,
        boxMode ? S.clip.boxC[axis] : S.clip[axis].v,
        function (v) { ACT.setClipPosition(axis, v); }, pct,
        boxMode ? 'Slide the box along ' + A2 : 'Where the ' + A2 + ' cut sits, 0% to 100% of the model');
      input.historyLabel = boxMode ? 'move box ' + A2 : 'move ' + A2 + ' cut';
    });

    checkbox(b, 'Six-sided box clip', boxMode, function (v) { ACT.toggleBox(v); },
      'Keep only what is inside a box — best for inspecting a core, a bay or a joint');

    if (boxMode) {
      var size = slider(b, 'Box size', 0.05, 1, 0.005, S.clip.boxSize,
        function (v) { ACT.setBoxSize(v); }, pct, 'How big the box is, as a share of the model');
      size.historyLabel = 'resize box';
      buttons(b, 2, [
        { label: 'Box around selection', tip: 'Fit the box snugly around what you have selected', run: ACT.boxToSelection },
        { label: 'Recentre box', tip: 'Move the box back to the middle of the model', run: ACT.centreBox }
      ]);
    }

    label(b, 'Plan slice');
    var sel = el('select');
    sel.id = 'storeySlice';
    A.tip(sel, 'Cut one storey out and look at it from above');
    sel.appendChild(new Option('— pick a storey —', ''));
    sel.addEventListener('change', function () {
      ACT.clipToStorey(sel.value === '' ? NaN : parseInt(sel.value, 10));
    });
    b.appendChild(sel);

    buttons(b, 1, [{ label: 'Clear all clipping', tip: 'Remove every cut and go back to perspective', run: ACT.clearClipping }]);
  });

  /* ---- Explode ---- */
  section('explode', 'Explode', function (b) {
    rec('storey spread', slider(b, 'Storey spread', 0, 1, 0.005,
      S.viewer ? S.explode.storey / ((S.viewer.modelRadius || 20) * 0.22) : 0,
      function (v) { ACT.setExplode('storey', v * (S.viewer.modelRadius || 20) * 0.22); },
      function (v) { return Math.round(v * 100) + '%'; }, 'Fan the floors apart vertically'));
    rec('radial spread', slider(b, 'Radial spread', 0, 1.2, 0.01, S.explode.radial,
      function (v) { ACT.setExplode('radial', v); },
      function (v) { return Math.round(v * 100) + '%'; }, 'Push elements outward from the centre'));
    rec('explode by type', slider(b, 'By type', 0, 0.5, 0.005, S.explode.type,
      function (v) { ACT.setExplode('type', v); },
      function (v) { return Math.round(v * 200) + '%'; }, 'Separate columns, beams and slabs into layers'));

    buttons(b, 2, [
      { label: ACT.isExploded() ? 'Collapse' : 'Animate', on: ACT.isExploded(),
        tip: ACT.isExploded() ? 'Fold the storeys back together' : 'Play the storey explode as an animation',
        run: ACT.animateExplode },
      { label: 'Reset', key: 'E', tip: 'Put everything back together', run: ACT.resetExplode }
    ]);

    label(b, 'Isolate a system');
    buttons(b, 2, [
      { label: 'Columns', tip: 'Show only columns', run: function () { ACT.isolateTypes(['Column']); } },
      { label: 'Beams', tip: 'Show only beams', run: function () { ACT.isolateTypes(['Beam']); } },
      { label: 'Walls', tip: 'Show only shear walls', run: function () { ACT.isolateTypes(['Wall']); } },
      { label: 'Lateral system', tip: 'Walls and braces together', run: function () { ACT.isolateTypes(['Wall', 'Brace']); } },
      { label: 'Slabs', tip: 'Slabs and ramps', run: function () { ACT.isolateTypes(['Slab', 'Ramp']); } },
      { label: 'Show all', key: 'U', tip: 'Bring everything back', run: function () { ACT.showAll(); } }
    ]);
    hint(b, 'Explode runs on the graphics card, so it stays smooth on very large models.');
  });

  /* ---- Measure ---- */
  section('measure', 'Measure', function (b) {
    label(b, 'Pick points on the model');
    segmented(b, [
      { value: 'distance', label: 'Distance', tip: 'Straight-line distance between two picks' },
      { value: 'height', label: 'Height', tip: 'Vertical difference between two picks' }
    ], S.measure.mode, function (v) { ACT.setMeasureMode(v); });
    segmented(b, [
      { value: 'area', label: 'Area', tip: 'Area enclosed by three or more picks' },
      { value: 'angle', label: 'Angle', tip: 'Angle at the middle of three picks' }
    ], S.measure.mode, function (v) { ACT.setMeasureMode(v); });

    var out = el('div', 'tile');
    out.id = 'measureOut';
    out.style.marginTop = '10px';
    out.innerHTML = '<div class="t-l">Result</div><div class="t-v">—</div><div class="t-s">no measurement yet</div>';
    b.appendChild(out);

    buttons(b, 3, [
      { label: 'Keep', tip: 'Leave this measurement on screen and start another', run: ACT.pinMeasure },
      { label: 'Clear', tip: 'Remove every measurement', run: ACT.clearMeasures },
      { label: 'Stop', tip: 'Leave measuring mode', run: function () { ACT.setMeasureMode(null); } }
    ]);
    hint(b, 'Picks snap to the nearest joint or member end.');
  });

  /* ---- Quantities and rates ---- */
  /* ---- Reinforcement ---- */
  section('rebar', 'Reinforcement &amp; bars', function (b) {
    var RB = global.ETABSRebar;
    if (!S.model) return;
    var R = A.rebarSettings();
    var st = S.rebar.stats;

    buttons(b, 1, [{
      label: S.rebar.on ? 'Bars are on — turn them off' : 'Show the reinforcement',
      on: S.rebar.on,
      tip: S.rebar.on ? 'Hide the bars and put the concrete back' :
        'Draw the bar cage in 3-D and work out the steel quantities',
      run: function () { ACT.toggleRebar(); }
    }]);

    if (S.rebar.on && st) {
      var t = S.rebar.result.totals;
      var tiles = el('div', 'tiles');
      tiles.innerHTML =
        tile('Steel', t.tonnes.toFixed(2) + ' t', 'with laps and wastage') +
        tile('Ratio', Math.round(t.kgPerM3) + ' kg/m³', 'over ' + Math.round(t.concreteVol) + ' m³') +
        tile('Bars drawn', st.segments.toLocaleString(), st.every > 1 ? 'every ' + st.every + 'th link shown' : 'all shown') +
        tile('Members', st.elements.toLocaleString(), R.scope === 'selection' ? 'selection' : R.scope);
      b.appendChild(tiles);
    }

    label(b, 'Draw bars for');
    segmented(b, [
      { value: 'visible', label: 'Visible', tip: 'Everything currently on screen, up to the display cap' },
      { value: 'selection', label: 'Selection', tip: 'Only what you have selected — fastest and clearest' },
      { value: 'storey', label: 'Storeys shown', tip: 'Follows the storey range slider' }
    ], R.scope, function (v) { ACT.setRebarSetting('scope', v); });

    var row = el('div', 'grid4');
    [['columns', 'Columns'], ['beams', 'Beams'], ['slabs', 'Slabs'], ['walls', 'Walls']].forEach(function (p) {
      var btn = el('button', 'mini' + (R[p[0]] ? ' on' : ''), p[1]);
      A.tip(btn, (R[p[0]] ? 'Hide' : 'Show') + ' ' + p[1].toLowerCase() + ' reinforcement');
      btn.addEventListener('click', function () { ACT.setRebarSetting(p[0], !R[p[0]]); });
      row.appendChild(btn);
    });
    b.appendChild(row);

    label(b, 'How it looks');
    segmented(b, [
      { value: 'cutaway', label: 'Cutaway', tip: 'Solid bars inside translucent concrete' },
      { value: 'barsOnly', label: 'Bars only', tip: 'The cage alone, concrete as a wireframe' },
      { value: 'lines', label: 'Thin', tip: 'Slimmer bars — lighter on very large models' }
    ], R.style, function (v) { ACT.setRebarSetting('style', v); });

    var thick = slider(b, 'Bar thickness', 0.6, 4, 0.1, S.rebar.thickness,
      function (v) { ACT.setRebarThickness(v); },
      function (v) { return '×' + v.toFixed(1); },
      'Display only — makes bars visible from a distance. Quantities use the real diameter.');
    thick.historyLabel = 'bar thickness';

    var expl = slider(b, 'Explode the cage', 0, 1, 0.01, R.explode,
      function (v) { ACT.setRebarSetting('explode', v); },
      function (v) { return Math.round(v * 100) + '%'; },
      'Pull main bars and links apart to see how the cage is assembled');
    expl.historyLabel = 'explode the cage';

    buttons(b, 2, [
      { label: 'Inspect selected', tip: 'Fly to the selected member and draw its cage and section',
        run: function () { ACT.inspectBars(S.viewer.selection[0]); } },
      { label: 'Section cut', tip: 'Slice across the member so you see the bars in section',
        run: function () { ACT.sectionThroughMember(); } }
    ]);

    /* ---- Beams ---- */
    label(b, 'Beams — steel as a percentage');
    hint(b, 'An ETABS file carries no designed beam bars, so these percentages decide the picture. ' +
      'Columns use the pattern written in the file.');
    numberRow(b, 'Top steel %', R.beamTopPercent, 0.1, function (v) { ACT.setRebarSetting('beamTopPercent', v); });
    numberRow(b, 'Bottom steel %', R.beamBotPercent, 0.1, function (v) { ACT.setRebarSetting('beamBotPercent', v); });
    diaRow(b, 'Beam bar', R.beamBarDia, function (v) { ACT.setRebarSetting('beamBarDia', v); });
    diaRow(b, 'Stirrup', R.beamStirrupDia, function (v) { ACT.setRebarSetting('beamStirrupDia', v); });
    numberRow(b, 'Stirrup spacing mm', R.beamStirrupSpacing, 25, function (v) { ACT.setRebarSetting('beamStirrupSpacing', v); });
    numberRow(b, 'Cover top/bottom mm', R.beamCover, 5, function (v) { ACT.setRebarSetting('beamCover', v); });
    numberRow(b, 'Cover sides mm', R.beamSideCover, 5, function (v) { ACT.setRebarSetting('beamSideCover', v); });
    hint(b, 'Cover is <b>clear cover to the stirrup</b>, as IS 456 states it and as the file\u2019s own COVER value means.');

    /* ---- Slabs and walls ---- */
    label(b, 'Slabs');
    diaRow(b, 'Mesh bar', R.slabBarDia, function (v) { ACT.setRebarSetting('slabBarDia', v); });
    numberRow(b, 'Main spacing mm', R.slabSpacing, 25, function (v) { ACT.setRebarSetting('slabSpacing', v); });
    numberRow(b, 'Distribution mm', R.slabDistSpacing, 25, function (v) { ACT.setRebarSetting('slabDistSpacing', v); });
    checkbox(b, 'Mesh on both faces', R.slabBothFaces, function (v) { ACT.setRebarSetting('slabBothFaces', v); },
      'Top and bottom layers rather than a single mat');
    checkbox(b, 'Top steel over supports only', R.slabTopOverSupports,
      function (v) { ACT.setRebarSetting('slabTopOverSupports', v); },
      'A slab framed by beams is two-way: the top mat is counted over the supports (0.3 of the span each side), ' +
      'not across the whole bay. A panel with no beams round it is a flat slab and keeps the full top mat.');
    checkbox(b, 'Step the mesh up with thickness', R.meshAuto,
      function (v) { ACT.setRebarSetting('meshAuto', v); },
      'A 125 mm slab takes 8 mm, 250 mm takes 12, over 360 mm takes 20 — the same ladder for walls. ' +
      'The diameter you set above is the floor, so raising it still wins.');
    hint(b, 'One-way or two-way is read from the section name — <code>…WAYONE</code> gets distribution steel at the wider spacing.');

    label(b, 'Walls');
    diaRow(b, 'Wall bar', R.wallBarDia, function (v) { ACT.setRebarSetting('wallBarDia', v); });
    numberRow(b, 'Wall spacing mm', R.wallSpacing, 25, function (v) { ACT.setRebarSetting('wallSpacing', v); });
    checkbox(b, 'Mesh on both faces', R.wallBothFaces, function (v) { ACT.setRebarSetting('wallBothFaces', v); });

    /* ---- Detailing rules ---- */
    label(b, 'Detailing');
    segmented(b, [
      { value: '135', label: '135° hooks', tip: 'IS 13920 ductile detailing — 10 × diameter legs, minimum 75 mm' },
      { value: '90', label: '90° hooks', tip: 'IS 456 only, not acceptable for ductile detailing' }
    ], R.hooks, function (v) { ACT.setRebarSetting('hooks', v); });
    checkbox(b, 'Cross-ties for inner bars', R.crossTies, function (v) { ACT.setRebarSetting('crossTies', v); },
      'Draws the inner legs that hold the middle bars where the pattern needs them');
    checkbox(b, 'Closer links near member ends', R.confining, function (v) { ACT.setRebarSetting('confining', v); },
      'IS 13920 confining zone. Beams: the lesser of d/4 and 8 bar diameters, not below 100 mm, over 2d from each face. Columns: the least of a quarter of the smaller side, 6 bar diameters and 100 mm, not below 75 mm, over the larger of the depth or 450 mm');
    checkbox(b, 'Bar bending deductions', R.bendDeductions, function (v) { ACT.setRebarSetting('bendDeductions', v); },
      'Cutting lengths allow 2d per 90° bend and 3d per 135° hook, as a schedule should');

    /* ---- Quantity rules ---- */
    label(b, 'Quantity rules');
    segmented(b, [
      { value: 'code', label: 'Lap from IS 456', tip: 'Development length from the steel and concrete grades' },
      { value: 'fixed', label: 'Fixed × dia', tip: 'One lap factor for everything' }
    ], R.lapMode, function (v) { ACT.setRebarSetting('lapMode', v); });
    if (R.lapMode === 'fixed') {
      numberRow(b, 'Lap length × dia', R.lapFactor, 5, function (v) { ACT.setRebarSetting('lapFactor', v); });
    } else {
      numberRow(b, 'Lap × Ld', R.lapMultiplier, 0.1, function (v) { ACT.setRebarSetting('lapMultiplier', v); });
      hint(b, 'Ld = 0.87 fy · φ / (4 × 1.6 τ<sub>bd</sub>) — <b>' +
        Math.round(global.ETABSRebar.developmentLengthFactor(R.grade, R.concreteGrade)) +
        ' × diameter</b> for ' + R.grade + ' in ' + R.concreteGrade + '.');
    }
    numberRow(b, 'Stock length m', R.stockLength, 1, function (v) { ACT.setRebarSetting('stockLength', v); });
    numberRow(b, 'Wastage %', R.wastagePercent, 0.5, function (v) { ACT.setRebarSetting('wastagePercent', v); });
    numberRow(b, 'Chairs & spacers %', R.accessoriesPercent, 0.5, function (v) { ACT.setRebarSetting('accessoriesPercent', v); });
    checkbox(b, 'Anchor bars into supports', R.anchorage, function (v) { ACT.setRebarSetting('anchorage', v); },
      'Adds 12 × diameter at each end of beam and slab bars');

    label(b, 'Concrete grade for the bond length');
    var cgrade = el('select');
    A.tip(cgrade, 'Sets τbd, and so the development and lap lengths');
    ['M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50'].forEach(function (gc) {
      var o = new Option(gc, gc);
      if (gc === R.concreteGrade) o.selected = true;
      cgrade.appendChild(o);
    });
    cgrade.addEventListener('change', function () { ACT.setRebarSetting('concreteGrade', cgrade.value); });
    b.appendChild(cgrade);

    var grade = el('select');
    A.tip(grade, 'Printed on the schedule and used to price the steel');
    ['Fe415', 'Fe500', 'Fe500D', 'Fe550'].forEach(function (g) {
      var o = new Option(g, g);
      if (g === R.grade) o.selected = true;
      grade.appendChild(o);
    });
    grade.addEventListener('change', function () { ACT.setRebarSetting('grade', grade.value); });
    label(b, 'Steel grade');
    b.appendChild(grade);

    buttons(b, 2, [
      { label: 'Steel panel', tip: 'Quantities, schedule and the section drawing',
        run: function () { ACT.emit('open-drawer', 'rebar'); } },
      { label: 'Reset to defaults', tip: 'Put every reinforcement assumption back', run: ACT.resetRebarSettings }
    ]);

    hint(b, 'Columns are drawn from the file’s own bar pattern where it exists. Beams, slabs and walls ' +
      'follow the assumptions above — they are <b>indicative detailing, not a design</b>.');
  });

  /** A small labelled number input with step buttons. */
  function numberRow(parent, text, value, step, onChange) {
    var row = el('div', 'row');
    row.appendChild(el('label', '', text));
    var input = el('input');
    input.type = 'number';
    input.value = value;
    input.step = step;
    input.style.cssText = 'height:26px;flex:1';
    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (isFinite(v) && v >= 0) onChange(v);
    });
    row.appendChild(input);
    parent.appendChild(row);
    return input;
  }

  /** Bar diameter picker, limited to the sizes actually rolled. */
  function diaRow(parent, text, value, onChange) {
    var row = el('div', 'row');
    row.appendChild(el('label', '', text));
    var sel = el('select');
    sel.style.cssText = 'height:26px;flex:1';
    global.ETABSRebar.BAR_SIZES.forEach(function (d) {
      var o = new Option(d + ' mm', d);
      if (d === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { onChange(parseInt(sel.value, 10)); });
    row.appendChild(sel);
    parent.appendChild(row);
    return sel;
  }

  /* ---- Loads ---- */
  section('loads', 'Loads &amp; intensity', function (b) {
    var L = global.ETABSLoads;
    if (!S.model) return;
    var r = S.load.result || A.computeLoads();

    buttons(b, 1, [{
      label: S.colorMode === 'load' ? 'Load map is on — turn it off' : 'Colour by load',
      on: S.colorMode === 'load',
      tip: S.colorMode === 'load'
        ? 'Go back to colouring by ' + (S.load.previousMode || 'type')
        : 'Colour every slab and beam by the load it carries, and open the floor table',
      run: ACT.showLoadMap
    }]);

    label(b, 'Load case or combination');
    var sel = el('select');
    A.tip(sel, 'Which pattern or combination the colours and numbers use');
    L.bases(S.model).forEach(function (bs) {
      var o = new Option(bs.label, bs.id);
      if (bs.id === S.load.basis) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { ACT.setLoadBasis(sel.value); });
    b.appendChild(sel);

    checkbox(b, 'Include self weight', S.load.selfWeight, function (v) { ACT.setLoadSelfWeight(v); },
      'Adds slab thickness × density and beam section × density to the applied load');

    label(b, 'Colour scale');
    segmented(b, [
      { value: 'building', label: 'Building', tip: 'Zero to the heaviest in the model, so floors compare directly' },
      { value: 'floor', label: 'Floors in view', tip: 'Rescale to the storeys currently shown' },
      { value: 'spread', label: 'Spread', tip: 'Stretch the colours between the lightest and heaviest — shows differences in an evenly loaded model' }
    ], S.load.scope, function (v) { ACT.setLoadScope(v); });

    checkbox(b, 'Show the max beside each storey', S.load.labels, function (v) { ACT.setLoadLabels(v); },
      'Prints each floor\u2019s heaviest slab and beam next to the model');

    if (r && r.hasLoads) {
      var bl = r.building;
      var tiles = el('div', 'tiles');
      tiles.innerHTML =
        tile('Slab max', L.fmt(bl.slabMax, 'kN/m²'), bl.worstSlabFloor ? bl.worstSlabFloor.name : '') +
        tile('Beam max', L.fmt(bl.beamMax, 'kN/m'), bl.worstBeamFloor ? bl.worstBeamFloor.name : '') +
        tile('Heaviest floor', bl.heaviestFloor ? bl.heaviestFloor.name : '—',
          bl.heaviestFloor ? Math.round(bl.heaviestFloor.totalKN).toLocaleString() + ' kN' : '') +
        tile('Building total', Math.round(bl.totalKN).toLocaleString() + ' kN', 'gravity, as applied');
      b.appendChild(tiles);
      if (r.pointKN > 0) {
        hint(b, 'Also carrying <b>' + Math.round(r.pointKN).toLocaleString() + ' kN</b> of point loads on joints.');
      }
      if (bl.unloaded > 0) {
        hint(b, '<b>' + bl.unloaded + '</b> floor panel(s) carry no assigned load in this case — check whether that is intended.');
      }
      buttons(b, 2, [
        { label: 'Floor table', tip: 'Floor-by-floor maxima, averages and totals',
          run: function () { ACT.emit('open-drawer', 'loads'); } },
        { label: 'Select unloaded', tip: 'Select every floor panel with no assigned load in this case',
          run: ACT.selectUnloaded }
      ]);
    } else {
      hint(b, 'No assigned loads found for this case. Slab and beam <b>self weight</b> is still shown; pick another case above, or check <b>What is in this file?</b>');
    }

    hint(b, 'Slabs read in <b>kN/m²</b>, beams in <b>kN/m</b>. These are the loads assigned in the model — no analysis is run.');
  });

  function tile(label, value, sub) {
    return '<div class="tile accent"><div class="t-l">' + label + '</div><div class="t-v">' + value +
      '</div><div class="t-s">' + (sub || '') + '</div></div>';
  }

  section('quantities', 'Quantities &amp; rates', function (b) {
    label(b, 'Take-off scope');
    var sel = el('select');
    A.tip(sel, 'What the quantities should count — stated on every total');
    Costing.SCOPES.forEach(function (s) {
      var o = new Option(s.label, s.id);
      if (s.id === S.scope) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      S.scope = sel.value;
      ACT.emit('quantities-changed');
    });
    b.appendChild(sel);
    var basis = el('p', 'hint');
    basis.id = 'scopeBasis';
    b.appendChild(basis);

    buttons(b, 2, [
      { label: 'Open quantities', tip: 'Show the full take-off in the data panel', run: function () { ACT.emit('open-drawer', 'quantities'); } },
      { label: 'Open cost', tip: 'Show the bill of quantities', run: function () { ACT.emit('open-drawer', 'cost'); } }
    ]);

    label(b, 'Currency');
    var cur = el('select');
    A.tip(cur, 'Which currency every cost is shown in');
    Object.keys(Costing.CURRENCIES).forEach(function (c) {
      var o = new Option(c + '  ' + Costing.CURRENCIES[c].symbol, c);
      if (c === S.costing.currency) o.selected = true;
      cur.appendChild(o);
    });
    cur.addEventListener('change', function () {
      S.costing.currency = cur.value;
      Costing.save(S.costing);
      ACT.emit('quantities-changed');
    });
    b.appendChild(cur);
    checkbox(b, 'Show lakh and crore', S.costing.indianFormat, function (v) {
      S.costing.indianFormat = v;
      Costing.save(S.costing);
      ACT.emit('quantities-changed');
    }, 'Summary figures read as ₹1.25 Cr rather than ₹12,500,000');

    label(b, 'Reinforcement (kg per m³)');
    hint(b, 'An ETABS model has no reinforcement. These rates are <b>your assumption</b> — the defaults are placeholders.');
    Object.keys(S.costing.rebarRates).forEach(function (type) {
      var band = S.costing.rebarBands[type];
      var rate = S.costing.rebarRates[type];
      var flagged = band && (rate < band[0] || rate > band[1]);
      numberField(b, type, 'kg/m³', rate, function (v) {
        S.costing.rebarRates[type] = v;
        Costing.save(S.costing);
        ACT.emit('rebuild-rail');
        ACT.emit('quantities-changed');
      }, flagged);
    });
    checkbox(b, 'Include reinforcement in the bill', S.costing.rebarEnabled, function (v) {
      S.costing.rebarEnabled = v;
      Costing.save(S.costing);
      ACT.emit('quantities-changed');
    }, 'Turn the rebar allowance on or off');

    label(b, 'Rates');
    if (S.model) {
      var q = global.ETABSAnalysis.quantities(S.model);
      q.concrete.forEach(function (c) {
        numberField(b, 'Concrete ' + c.grade, Costing.symbolOf(S.costing) + '/m³',
          Costing.concreteRate(c.grade, S.costing), function (v) {
            S.costing.concreteRates[c.grade] = v;
            Costing.save(S.costing);
            ACT.emit('quantities-changed');
          });
      });
    }
    numberField(b, 'Reinforcement', Costing.symbolOf(S.costing) + '/t', S.costing.rebarRatePerTonne, function (v) {
      S.costing.rebarRatePerTonne = v; Costing.save(S.costing); ACT.emit('quantities-changed');
    });
    numberField(b, 'Structural steel', Costing.symbolOf(S.costing) + '/t', S.costing.steelRatePerTonne, function (v) {
      S.costing.steelRatePerTonne = v; Costing.save(S.costing); ACT.emit('quantities-changed');
    });
    numberField(b, 'Formwork', Costing.symbolOf(S.costing) + '/m²', S.costing.formworkRatePerM2, function (v) {
      S.costing.formworkRatePerM2 = v; Costing.save(S.costing); ACT.emit('quantities-changed');
    });

    label(b, 'Wastage &amp; contingency');
    [['concrete', 'Concrete'], ['rebar', 'Reinforcement'],
     ['steel', 'Structural steel'], ['formwork', 'Formwork']].forEach(function (p) {
      numberField(b, p[1], '%', S.costing.wastage[p[0]], function (v) {
        S.costing.wastage[p[0]] = v; Costing.save(S.costing); ACT.emit('quantities-changed');
      });
    });
    numberField(b, 'Contingency', '%', S.costing.contingency, function (v) {
      S.costing.contingency = v; Costing.save(S.costing); ACT.emit('quantities-changed');
    });

    buttons(b, 2, [
      { label: 'Reset rates', tip: 'Go back to the placeholder defaults', run: function () {
        S.costing = Costing.reset();
        ACT.emit('rebuild-rail');
        ACT.emit('quantities-changed');
        toast('Rate card reset to defaults');
      } },
      { label: 'Excel BOQ', tip: 'Workbook with live formulas wired to a rate card sheet', run: FILES.exportWorkbook }
    ]);
  });

  /* ---- Data & reports ---- */
  section('data', 'Data &amp; reports', function (b) {
    buttons(b, 2, [
      { label: 'Statistics', tip: 'Counts, storey table, materials', run: function () { ACT.emit('open-drawer', 'statistics'); } },
      { label: 'Quantities', tip: 'Concrete, steel and formwork take-off', run: function () { ACT.emit('open-drawer', 'quantities'); } },
      { label: 'Health check', tip: 'Eight checks for modelling errors', run: function () { ACT.emit('open-drawer', 'health'); } },
      { label: 'Code screening', tip: 'IS 1893 irregularities visible in the geometry', run: function () { ACT.emit('open-drawer', 'code'); } },
      { label: 'Sections', tip: 'Every section used, and where', run: function () { ACT.emit('open-drawer', 'sections'); } },
      { label: 'Cost', tip: 'Bill of quantities from your rate card', run: function () { ACT.emit('open-drawer', 'cost'); } }
    ]);

    label(b, 'Export');
    buttons(b, 2, [
      { label: 'PNG snapshot', key: 'P', tip: 'High-resolution render of this view', run: function () { FILES.exportPng(false); } },
      { label: 'PNG transparent', tip: 'Same, with no background — for slides', run: function () { FILES.exportPng(true); } },
      { label: 'PDF report', tip: 'Branded report with views, tables and findings', run: FILES.exportPdf },
      { label: 'Excel BOQ', tip: 'Workbook with live formulas', run: FILES.exportWorkbook },
      { label: 'BOM (CSV)', tip: 'Concrete, steel and formwork table', run: FILES.exportBom },
      { label: 'BOQ (CSV)', tip: 'Priced bill as a flat table', run: FILES.exportBoqCsv },
      { label: 'Elements (CSV)', tip: 'Every element with geometry and properties', run: FILES.exportElements },
      { label: 'Statistics (CSV)', tip: 'Counts, storeys, sections and materials', run: FILES.exportStats },
      { label: 'Health (CSV)', tip: 'Every finding with its detail', run: FILES.exportHealth },
      { label: '3D model (OBJ)', tip: 'OBJ and MTL zipped, for Blender or Twinmotion', run: FILES.exportObj }
    ]);

    label(b, 'Snapshot resolution');
    segmented(b, [
      { value: 1, label: '1×', tip: 'Screen resolution' },
      { value: 2, label: '2×', tip: 'Twice screen resolution' },
      { value: 4, label: '4K', tip: 'Four times — for print and large screens' }
    ], S.captureScale, function (v) { S.captureScale = v; });
    buttons(b, 1, [{ label: 'Print this page', tip: 'Clean printed layout, not a screenshot', run: function () { global.print(); } }]);
    hint(b, 'Every save asks you to confirm before a file is written.');
  });

  /* ---- Compare ---- */
  section('compare', 'Compare revisions', function (b) {
    hint(b, 'Load a second model to see what changed. Modified sections turn <b>amber</b>, removed elements <b>red</b>.');
    buttons(b, 1, [{
      label: 'Load revision to compare…',
      tip: 'Pick the second .e2k — elements are matched on geometry, not name',
      run: function () { $('compareInput').click(); }
    }]);
    var out = el('div');
    out.id = 'compareOut';
    b.appendChild(out);
    buttons(b, 2, [
      { label: 'Change list', tip: 'See every difference in the data panel', run: function () { ACT.emit('open-drawer', 'compare'); } },
      { label: 'Clear compare', tip: 'Return to normal colours', run: FILES.clearCompare }
    ]);
  });

  /* ---- Audio ---- */
  section('audio', 'Ambient audio', function (b) {
    label(b, 'Library');
    var list = el('div', 'legend');
    list.id = 'trackList';
    list.style.cssText = 'max-height:190px;overflow-y:auto';
    b.appendChild(list);

    slider(b, 'Mood', 0, 1, 0.01, S.audio ? S.audio.mood : 0.5,
      function (v) { S.audio.setMood(v); },
      function (v) { return v < 0.34 ? 'dark' : (v < 0.67 ? 'even' : 'bright'); },
      'Steers the generator brighter or darker, live');
    slider(b, 'Tempo', 0.6, 1.5, 0.01, S.audio ? S.audio.tempo : 1,
      function (v) { S.audio.setTempo(v); },
      function (v) { return v.toFixed(2) + '×'; }, 'Speeds the generated phrases up or down');

    checkbox(b, 'Start music with the 360° spin', S.autoMusic, function (v) {
      S.autoMusic = v;
      A.prefSet('autoMusic', v);
    }, 'Music fades in when the spin starts and stops when it stops');

    buttons(b, 2, [
      { label: 'Add your own audio…', tip: 'Play a file from this device instead', run: function () { $('audioInput').click(); } },
      { label: 'Remove your files', tip: 'Go back to the generated tracks only', run: function () {
        S.audio.removeUserTracks();
        ACT.emit('rebuild-rail');
      } }
    ]);
    hint(b, 'All fifteen tracks are synthesised live — nothing is streamed, and they never loop identically.');
  });

  /* ---- Settings ---- */
  section('settings', 'Settings &amp; brand', function (b) {
    label(b, 'Theme');
    segmented(b, [
      { value: 'system', label: 'System', tip: 'Follow the device setting' },
      { value: 'light', label: 'Light', tip: 'Always light' },
      { value: 'dark', label: 'Dark', tip: 'Always dark' }
    ], S.theme, function (v) { ACT.emit('theme', v); });

    label(b, 'Panels');
    buttons(b, 2, [
      { label: 'Reset widths', tip: 'Put both panels back to their default size', run: function () {
        S.panels.reset('rail');
        S.panels.reset('drawer');
        toast('Panel widths reset');
      } },
      { label: 'Reset everything', tip: 'Clear saved layout, palette, views and rates in this browser', run: function () {
        ACT.emit('reset-all');
      } }
    ]);

    label(b, 'Brand');
    buttons(b, 2, [
      { label: 'Replace logo…', tip: 'Use your own logo in the header and on exports', run: function () { ACT.emit('pick-logo'); } },
      { label: 'Default mark', tip: 'Go back to the built-in mark', run: function () { ACT.emit('clear-logo'); } }
    ]);
    hint(b, 'A logo you load is stored in this browser only, and is stamped onto PNG and PDF exports.');

    label(b, 'Help');
    buttons(b, 2, [
      { label: 'Guide &amp; FAQ', key: 'F1', tip: 'The illustrated guide to the whole app', run: function () { ACT.emit('open-guide'); } },
      { label: 'Keyboard shortcuts', key: '?', tip: 'Every shortcut on one page', run: function () { ACT.emit('open-shortcuts'); } },
      { label: 'What can I do?', tip: 'Pick a task and the app sets itself up', run: function () { ACT.emit('open-intents'); } },
      { label: 'Restart the tour', tip: 'Replay the five-step walkthrough', run: function () { ACT.emit('restart-tour'); } }
    ]);
    hint(b, 'Structura v' + A.VERSION + ' · built by ' + A.BRAND.name);
  });

  /* ================================================================== */
  /* Rendering                                                           */
  /* ================================================================== */

  function build() {
    var body = $('railBody');
    if (!body) return;
    var scrollTop = body.scrollTop;
    body.innerHTML = '';

    var order = sections.slice().sort(function (a, b2) {
      var ap = S.pinned.indexOf(a.id) >= 0 ? 0 : 1;
      var bp = S.pinned.indexOf(b2.id) >= 0 ? 0 : 1;
      return ap - bp;
    });
    var open = A.prefGet('openSections', ['file', 'display', 'colour']);

    order.forEach(function (sec) {
      var wrap = el('div', 'acc' + (open.indexOf(sec.id) >= 0 ? ' open' : '') +
        (S.pinned.indexOf(sec.id) >= 0 ? ' pinned' : ''));
      wrap.dataset.id = sec.id;

      var head = el('button', 'acc-head');
      head.innerHTML = '<span>' + sec.title + '</span>' +
        '<span class="pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px"><path d="M12 17v5M8 3h8l-1 7 3 3H6l3-3z"/></svg></span>' +
        '<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M9 5l7 7-7 7"/></svg></span>';
      A.tip(head.querySelector('.pin'), 'Pin this panel to the top of the rail');

      head.addEventListener('click', function (e) {
        if (e.target.closest('.pin')) {
          e.stopPropagation();
          var i = S.pinned.indexOf(sec.id);
          if (i >= 0) S.pinned.splice(i, 1); else S.pinned.push(sec.id);
          A.prefSet('pinned', S.pinned);
          build();
          return;
        }
        wrap.classList.toggle('open');
        var ids = [];
        body.querySelectorAll('.acc.open').forEach(function (n) { ids.push(n.dataset.id); });
        A.prefSet('openSections', ids);
      });

      var inner = el('div', 'acc-body');
      wrap.appendChild(head);
      wrap.appendChild(inner);
      body.appendChild(wrap);
      try {
        sec.builder(inner);
      } catch (err) {
        inner.appendChild(el('p', 'hint', 'This panel could not be built.'));
      }
    });

    body.scrollTop = scrollTop;
    refreshDynamic();
  }

  function filter(q) {
    var term = String(q || '').trim().toLowerCase();
    document.querySelectorAll('#railBody .acc').forEach(function (accEl) {
      if (!term) { accEl.hidden = false; return; }
      var match = accEl.textContent.toLowerCase().indexOf(term) >= 0;
      accEl.hidden = !match;
      if (match) accEl.classList.add('open');
    });
  }

  /* ---- Dynamic panel contents ---- */

  function refreshDynamic() {
    renderLegend();
    renderTypeToggles();
    renderStoreyRange();
    renderSavedViews();
    renderTrackList();
    populateSelects();
    renderScopeBasis();
  }

  function renderLegend() {
    var lg = $('legend');
    if (!lg) return;
    lg.innerHTML = '';
    var legend = A.legend();

    if (legend.range && legend.range.kind === 'load') {
      var L = global.ETABSLoads;
      var lr = legend.range;
      var grad = 'linear-gradient(90deg,' + [0, 0.2, 0.4, 0.6, 0.8, 1]
        .map(function (t) { return L.rampCss(t); }).join(',') + ')';
      var wrap = el('div');
      wrap.innerHTML =
        '<div style="font-size:10.5px;color:var(--ink-3);margin-bottom:5px">' +
          A.escapeHtml(lr.basis) + (lr.selfWeight ? ' + self weight' : '') +
          (lr.scope === 'floor' ? ' · scaled to the floors in view' : '') + '</div>' +
        '<div style="height:10px;border-radius:5px;background:' + grad + '"></div>' +
        '<div style="display:flex;justify-content:space-between;font-family:var(--font-mono);' +
          'font-size:10px;color:var(--ink-3);margin-top:3px">' +
          '<span>' + L.fmt(lr.slabMin || 0) + '</span><span>slabs up to ' + L.fmt(lr.slabMax, 'kN/m²') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-family:var(--font-mono);' +
          'font-size:10px;color:var(--ink-3)">' +
          '<span>' + L.fmt(lr.beamMin || 0) + '</span><span>beams up to ' + L.fmt(lr.beamMax, 'kN/m') + '</span></div>' +
        '<div style="font-size:10.5px;color:var(--ink-3);margin-top:6px">Columns and walls stay grey — ' +
          'they carry load through the members above, not an assigned intensity.</div>';
      lg.appendChild(wrap);
      return;
    }

    if (legend.range) {
      var bar = el('div');
      bar.innerHTML = '<div style="height:10px;border-radius:5px;background:linear-gradient(90deg,' +
        [0, 0.25, 0.5, 0.75, 1].map(function (t) {
          var c = A.ramp(t);
          return 'rgb(' + c.map(Math.round).join(',') + ')';
        }).join(',') + ')"></div>';
      var scale = el('div');
      scale.style.cssText = 'display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;color:var(--ink-3);margin-top:3px';
      scale.innerHTML = '<span>' + Units.length(legend.range.min) + '</span><span>' +
        Units.length(legend.range.max) + '</span>';
      lg.appendChild(bar);
      lg.appendChild(scale);
      return;
    }
    if (!legend.keys.length) {
      lg.appendChild(el('p', 'hint', 'No legend in this colour mode.'));
      return;
    }

    legend.keys.forEach(function (lk) {
      var offKey = S.colorMode + '|' + lk.key;
      var row = el('div', 'legend-item' + (S.keyOff[offKey] ? ' off' : ''));
      A.tip(row, lk.locked ? lk.key : 'Click to hide ' + lk.key + ' · click the swatch to recolour');

      var sw = el('label', 'swatch');
      sw.style.background = lk.color;
      if (!lk.locked) {
        var picker = el('input');
        picker.type = 'color';
        picker.value = lk.color;
        picker.addEventListener('input', function () {
          S.customColors[S.colorMode + '|' + lk.key] = picker.value;
          sw.style.background = picker.value;
          A.computeColors();
        });
        picker.addEventListener('click', function (e) { e.stopPropagation(); });
        sw.appendChild(picker);
      }

      var nm = el('span', 'nm');
      nm.textContent = lk.key;
      var ct = el('span', 'ct', String(lk.count));
      row.appendChild(sw); row.appendChild(nm); row.appendChild(ct);

      if (!lk.locked) {
        row.addEventListener('click', function () {
          A.pushHistory((S.keyOff[offKey] ? 'show ' : 'hide ') + lk.key);
          S.keyOff[offKey] = !S.keyOff[offKey];
          row.classList.toggle('off');
          A.computeStates();
        });
      }
      lg.appendChild(row);
    });
  }

  function renderTypeToggles() {
    var box = $('typeToggles');
    if (!box || !S.model) return;
    box.innerHTML = '';
    var counts = {};
    S.model.elements.forEach(function (e) { counts[e.type] = (counts[e.type] || 0) + 1; });
    Object.keys(counts).sort().forEach(function (type) {
      var l = el('label', 'check');
      A.tip(l, 'Show or hide every ' + type.toLowerCase());
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = S.typeOn[type] !== false;
      cb.addEventListener('change', function () {
        A.pushHistory((cb.checked ? 'show ' : 'hide ') + type + 's');
        S.typeOn[type] = cb.checked;
        A.computeStates();
      });
      l.appendChild(cb);
      var span = el('span');
      span.textContent = type;
      l.appendChild(span);
      l.appendChild(el('span', 'count', String(counts[type])));
      box.appendChild(l);
    });
  }

  function renderStoreyRange() {
    var host = $('storeyRange');
    if (!host || !S.model) return;
    host.innerHTML = '';
    var n = S.model.stories.length - 1;

    var lo = el('input');
    lo.type = 'range'; lo.min = 0; lo.max = n; lo.step = 1;
    lo.value = S.storeyRange ? S.storeyRange[0] : 0;
    A.tip(lo, 'Lowest storey to show');

    var hi = el('input');
    hi.type = 'range'; hi.min = 0; hi.max = n; hi.step = 1;
    hi.value = S.storeyRange ? S.storeyRange[1] : n;
    A.tip(hi, 'Highest storey to show');

    var out = el('div', 'hint');

    function paint() {
      var a = Math.min(+lo.value, +hi.value), b = Math.max(+lo.value, +hi.value);
      out.innerHTML = '<b>' + A.escapeHtml(S.model.stories[a].name) + '</b> to <b>' +
        A.escapeHtml(S.model.stories[b].name) + '</b>';
    }
    function commit() {
      var a = Math.min(+lo.value, +hi.value), b = Math.max(+lo.value, +hi.value);
      S.storeyRange = [a, b];
      A.computeStates();
      ACT.emit('storeys');
      paint();
    }
    lo.addEventListener('input', paint);
    hi.addEventListener('input', paint);
    lo.addEventListener('change', commit);
    hi.addEventListener('change', commit);

    host.appendChild(lo);
    host.appendChild(hi);
    host.appendChild(out);
    paint();
  }

  function renderSavedViews() {
    var host = $('savedViews');
    if (!host) return;
    host.innerHTML = '';
    if (!S.savedViews.length) {
      host.appendChild(el('p', 'hint', 'No saved views yet.'));
      return;
    }
    S.savedViews.forEach(function (v, i) {
      var row = el('div', 'legend-item');
      A.tip(row, 'Restore this camera and visibility state');
      var nm = el('span', 'nm');
      nm.textContent = v.name;
      var del = el('span', 'ct', '✕');
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        ACT.deleteSavedView(i);
      });
      row.appendChild(nm);
      row.appendChild(del);
      row.addEventListener('click', function () { ACT.restoreSavedView(v); });
      host.appendChild(row);
    });
  }

  function renderTrackList() {
    var host = $('trackList');
    if (!host || !S.audio) return;
    host.innerHTML = '';
    S.audio.allTracks().forEach(function (t, i) {
      var row = el('div', 'legend-item');
      if (i === S.audio.index) row.style.background = 'var(--accent-soft)';
      A.tip(row, t.note || t.family);
      var nm = el('span', 'nm');
      nm.textContent = t.name;
      var ct = el('span', 'ct', t.family);
      row.appendChild(nm);
      row.appendChild(ct);
      row.addEventListener('click', function () {
        S.audio.play(i);
        renderTrackList();
      });
      host.appendChild(row);
    });
  }

  function populateSelects() {
    if (!S.model) return;
    var sel = $('gridSelect');
    if (sel) {
      sel.innerHTML = '';
      sel.appendChild(new Option('— pick a grid line —', ''));
      var seen = {};
      S.model.grids.forEach(function (g) {
        if (seen[g.label]) return;
        seen[g.label] = true;
        sel.appendChild(new Option('Grid ' + g.label + '  (' + g.dir + ')', g.label));
      });
      sel.value = S.clip.grid || '';
    }
    var ss = $('storeySlice');
    if (ss) {
      ss.innerHTML = '';
      ss.appendChild(new Option('— pick a storey —', ''));
      S.model.stories.slice().reverse().forEach(function (s) {
        ss.appendChild(new Option(s.name, String(s.index)));
      });
      if (S.clip.storey && S.model.storyIndex[S.clip.storey] !== undefined) {
        ss.value = String(S.model.storyIndex[S.clip.storey]);
      }
    }
  }

  function renderScopeBasis() {
    var n = $('scopeBasis');
    if (n && S.model) n.textContent = A.scopeSentence();
  }

  function setMeasureResult(data) {
    var out = $('measureOut');
    if (!out) return;
    out.querySelector('.t-v').textContent = data.text;
    out.querySelector('.t-s').textContent = data.detail;
  }

  global.RAIL = {
    build: build,
    filter: filter,
    refreshDynamic: refreshDynamic,
    renderLegend: renderLegend,
    renderTrackList: renderTrackList,
    setMeasureResult: setMeasureResult,
    runFilter: runFilter,
    sections: sections
  };
})(window);
