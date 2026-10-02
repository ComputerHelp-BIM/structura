/**
 * app-drawer.js — The data panel.
 * =================================================================
 * Eight panels behind one dropdown, because six tabs never fitted a 360px
 * column and silently scrolled the first one off the edge.
 *
 * Namespace: window.DRAWER
 */
(function (global) {
  'use strict';

  var A = global.APP, S = A.S, ACT = global.ACT, FILES = global.FILES;
  var $ = A.$, el = A.el, toast = A.toast;
  var Units = global.ETABSUnits;
  var Analysis = global.ETABSAnalysis;
  var Costing = global.ETABSCosting;

  var TABS = [
    { id: 'properties', label: 'Properties', tip: 'What you have selected' },
    { id: 'statistics', label: 'Statistics', tip: 'Counts, storeys, materials' },
    { id: 'quantities', label: 'Quantities', tip: 'Concrete, steel and formwork' },
    { id: 'cost', label: 'Cost / BOQ', tip: 'Priced bill from your rate card' },
    { id: 'loads', label: 'Loads by floor', tip: 'Load intensity per floor and for the whole building' },
    { id: 'rebar', label: 'Steel & bars', tip: 'Reinforcement weights, schedule and section drawing' },
    { id: 'health', label: 'Model health', tip: 'Eight checks for modelling errors' },
    { id: 'code', label: 'IS 1893 screening', tip: 'Irregularities visible in geometry' },
    { id: 'sections', label: 'Sections', tip: 'Every section and where it is used' },
    { id: 'compare', label: 'Compare', tip: 'Differences against another revision' }
  ];

  /* ================================================================== */
  /* Shell                                                               */
  /* ================================================================== */

  function buildSelector() {
    var sel = $('drawerSelect');
    sel.innerHTML = '';
    TABS.forEach(function (t) {
      var o = new Option(t.label, t.id);
      if (t.id === S.drawerTab) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { open(sel.value); };
  }

  function open(tab) {
    S.drawerTab = tab || S.drawerTab;
    S.drawerOpen = true;
    $('drawer').classList.remove('collapsed');
    var grip = $('gripDrawer');
    if (grip) grip.classList.remove('hidden');
    buildSelector();
    render();
    setTimeout(function () { if (S.viewer) S.viewer.resize(); }, 40);
  }

  function close() {
    S.drawerOpen = false;
    $('drawer').classList.add('collapsed');
    var grip = $('gripDrawer');
    if (grip) grip.classList.add('hidden');
    setTimeout(function () { if (S.viewer) S.viewer.resize(); }, 40);
  }

  function toggle() { if (S.drawerOpen) close(); else open(); }

  /* ================================================================== */
  /* Shared bits                                                         */
  /* ================================================================== */

  function tiles(list) {
    var g = el('div', 'tiles');
    list.forEach(function (t, i) {
      var tile = el('div', 'tile' + (i === 0 ? ' accent' : '') + (t[3] ? ' est' : ''));
      tile.innerHTML = '<div class="t-l"></div><div class="t-v"></div>';
      tile.querySelector('.t-l').textContent = t[0];
      tile.querySelector('.t-v').textContent = t[1];
      if (t[2]) {
        var s = el('div', 't-s');
        s.textContent = t[2];
        tile.appendChild(s);
      }
      if (t[3]) A.tip(tile, 'Estimated from your rate card, not measured from the model');
      g.appendChild(tile);
    });
    return g;
  }

  function table(headers, rows, onRow) {
    var wrap = el('div', 'tbl-wrap');
    var t = el('table', 'data');
    var thead = el('thead');
    var tr = el('tr');
    headers.forEach(function (h) {
      var th = el('th');
      th.textContent = h;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);

    var tb = el('tbody');
    rows.forEach(function (r, i) {
      var row = el('tr', onRow ? 'clickable' : '');
      if (onRow) A.tip(row, 'Click to select and zoom to these elements');
      r.forEach(function (c) {
        var td = el('td', (c && c.num) ? 'num' : '');
        td.textContent = (c && c.v !== undefined) ? c.v : (c === null || c === undefined ? '' : c);
        row.appendChild(td);
      });
      if (onRow) row.addEventListener('click', function () { onRow(i); });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function sectionTitle(text, count) {
    return el('div', 'sec-title', text + (count !== undefined ? '<span class="n">' + count + '</span>' : ''));
  }

  function basisNote(text) {
    var n = el('div', 'basis');
    n.innerHTML = text;
    return n;
  }

  function bars(host, entries, format) {
    var max = entries.reduce(function (a, e) { return Math.max(a, e.value); }, 0) || 1;
    entries.forEach(function (e) {
      var row = el('div', 'bar-row');
      row.innerHTML = '<div class="bh"><span></span><span class="v"></span></div><div class="bar"><i></i></div>';
      row.querySelector('.bh span').textContent = e.label;
      row.querySelector('.v').textContent = format ? format(e.value) : e.value;
      var fill = row.querySelector('.bar i');
      fill.style.width = (e.value / max * 100) + '%';
      if (e.ochre) fill.classList.add('ochre');
      host.appendChild(row);
    });
  }

  function actionButton(host, text, tipText, run, primary) {
    var b = el('button', 'btn' + (primary ? ' primary' : ''), text);
    b.style.cssText = 'width:100%;margin-top:10px';
    A.tip(b, tipText);
    b.addEventListener('click', run);
    host.appendChild(b);
    return b;
  }

  /* ================================================================== */
  /* Panels                                                              */
  /* ================================================================== */

  function render() {
    if (!S.model) return;
    var body = $('drawerBody');
    body.innerHTML = '';
    try {
      ({
        properties: renderProperties,
        statistics: renderStatistics,
        quantities: renderQuantities,
        cost: renderCost,
        loads: renderLoads,
        rebar: renderRebar,
        health: renderHealth,
        code: renderCode,
        sections: renderSections,
        compare: renderCompare
      }[S.drawerTab] || renderProperties)(body);
    } catch (err) {
      body.appendChild(el('p', 'hint', 'This panel could not be built: ' + A.escapeHtml(err.message)));
    }
  }

  /* ---- Properties ---- */

  function renderProperties(body) {
    var sel = S.viewer.selection;

    if (!sel.length) {
      body.appendChild(el('p', 'hint',
        'Click any member, slab, wall or joint to inspect it. Shift-click adds to the selection, ' +
        'Alt+drag rubber-bands a box, and right-click opens an action menu.'));
      var scope = A.scopeIds();
      var q = Analysis.quantities(S.model, scope.ids);
      body.appendChild(sectionTitle(scope.label, scope.detail));
      body.appendChild(tiles([
        ['Elements', Units.number(scope.ids.length)],
        ['Concrete', Units.volume(q.totals.concreteVol)],
        ['Steel', Units.mass(q.totals.steelTonnes)],
        ['Formwork', Units.area(q.totals.formwork)]
      ]));
      body.appendChild(basisNote(A.scopeSentence()));
      return;
    }

    if (sel.length > 1) {
      var qs = Analysis.quantities(S.model, sel);
      body.appendChild(sectionTitle(sel.length + ' elements selected'));
      body.appendChild(tiles([
        ['Concrete', Units.volume(qs.totals.concreteVol)],
        ['Steel', Units.mass(qs.totals.steelTonnes)],
        ['Formwork', Units.area(qs.totals.formwork)],
        ['Slab area', Units.area(qs.totals.slab)]
      ]));
      var byType = {};
      sel.forEach(function (id) {
        var t = S.model.elements[id].type;
        byType[t] = (byType[t] || 0) + 1;
      });
      body.appendChild(table(['Type', 'Count'], Object.keys(byType).map(function (k) {
        return [k, { v: byType[k], num: true }];
      })));
      actionButton(body, 'Isolate this selection', 'Show only these elements', ACT.isolateSelection, true);
      actionButton(body, 'Hide this selection', 'Remove them from view', ACT.hideSelection);
      return;
    }

    var e = S.model.elements[sel[0]];
    body.appendChild(sectionTitle(e.type + (e.name ? ' · ' + e.name : '')));

    var rows = [
      ['Type', e.type], ['Name', e.name || '—'], ['Storey', e.story || '—'],
      ['Section', e.section || '—'], ['Material', e.material || '—']
    ];

    if (e.kind === 'frame') {
      var prof = S.model.sectionProfiles[e.section];
      rows.push(['Length', Units.length(e.length)]);
      rows.push(['Local angle', (e.ang || 0) + '°']);
      if (prof) {
        rows.push(['Profile', prof.family]);
        rows.push(['Depth × width', Units.length(prof.depth, { digits: 3 }) + ' × ' + Units.length(prof.width, { digits: 3 })]);
        rows.push(['Section area', prof.area.toFixed(5) + ' m²']);
      }
      rows.push(['Volume', Units.volume(e.volume || 0)]);
      rows.push(['Start', xyz(e.a)]);
      rows.push(['End', xyz(e.b)]);
      if (e.pier) rows.push(['Pier', e.pier]);
      if (e.spandrel) rows.push(['Spandrel', e.spandrel]);
      if (e.release) rows.push(['Releases', e.release]);
    } else if (e.kind === 'area') {
      rows.push(['Thickness', Units.length(e.thickness || 0, { digits: 3 })]);
      rows.push(['Surface area', Units.area(e.planArea || 0)]);
      rows.push(['Volume', Units.volume(e.volume || 0)]);
      rows.push(['Corners', String(e.pts.length)]);
      if (e.pier) rows.push(['Pier', e.pier]);
      if (e.diaph) rows.push(['Diaphragm', e.diaph]);
    } else {
      rows.push(['Position', xyz(e.p)]);
      if (e.restraint) rows.push(['Restraint', e.restraint]);
      if (e.diaph) rows.push(['Diaphragm', e.diaph]);
      if (e.spring) rows.push(['Spring', e.spring]);
    }

    var mat = S.model.materials[e.material];
    if (mat) {
      var d = Analysis.densityKNm3(S.model, e.material);
      rows.push(['Material type', mat.type || '—']);
      rows.push(['Density', d === null ? 'not stated in file' : d.toFixed(2) + ' kN/m³']);
      if (mat.fc) rows.push(["f'c", Units.number(mat.fc, 0)]);
      if (mat.fy) rows.push(['fy', Units.number(mat.fy, 0)]);
    }

    var dl = el('dl', 'kv');
    rows.forEach(function (r) {
      dl.appendChild(el('dt', '', r[0]));
      var dd = el('dd');
      dd.textContent = r[1];
      dl.appendChild(dd);
    });
    body.appendChild(dl);

    appendLoadBreakdown(body, e);

    var grid = el('div', 'grid2');
    [
      ['Zoom to it', 'Fly the camera to this element', function () { S.viewer.frameElements([e.id]); }],
      ['Isolate it', 'Show only this element', function () { ACT.selectIds([e.id], false); ACT.isolateSelection(); }],
      ['Hide it', 'Remove it from view', function () {
        A.pushHistory('hide one element');
        S.hidden[e.id] = true;
        A.computeStates();
      }],
      ['Same section', 'Select every element using ' + (e.section || 'this section'), function () {
        ACT.selectSimilar(e.id, 'section');
      }],
      ['Same storey', 'Select everything on ' + (e.story || 'this storey'), function () {
        ACT.selectSimilar(e.id, 'story');
      }],
      ['Same material', 'Select everything of the same grade', function () {
        ACT.selectSimilar(e.id, 'material');
      }],
      ['Same load', 'Select everything carrying the same intensity', function () {
        ACT.selectSameLoad(e.id);
      }]
    ].forEach(function (a) {
      var b = el('button', 'mini', a[0]);
      A.tip(b, a[1]);
      b.addEventListener('click', a[2]);
      grid.appendChild(b);
    });
    body.appendChild(grid);
  }

  function xyz(p) {
    return Units.length(p[0], { bare: true }) + ', ' +
           Units.length(p[1], { bare: true }) + ', ' +
           Units.length(p[2], { bare: true }) + ' ' + Units.lengthLabel();
  }

  /* ---- Statistics ---- */

  function renderStatistics(body) {
    var st = Analysis.statistics(S.model);
    S.stats = st;

    body.appendChild(tiles([
      ['Storeys', String(st.storeyCount)],
      ['Elements', Units.number(st.elementTotal)],
      ['Height', Units.length(st.height)],
      ['Footprint', Units.area(st.footprint.area)],
      ['Plan', Units.length(st.footprint.x, { digits: 1 }) + ' × ' + Units.length(st.footprint.y, { digits: 1 })],
      ['Slenderness', st.slenderness.toFixed(2), 'height ÷ least plan dimension']
    ]));

    body.appendChild(sectionTitle('Element counts', Units.number(st.elementTotal)));
    bars(body, Object.keys(st.counts).sort(function (a, b) {
      return st.counts[b] - st.counts[a];
    }).map(function (k) {
      return { label: k, value: st.counts[k] };
    }), function (v) { return Units.number(v); });

    body.appendChild(sectionTitle('Storey table', st.stories.length));
    body.appendChild(table(
      ['Storey', 'Height', 'Elevation', 'Floor area', 'Elements'],
      st.stories.map(function (s) {
        return [s.name + (s.master ? ' ★' : ''),
          { v: Units.length(s.height, { bare: true }), num: true },
          { v: Units.length(s.elev, { bare: true }), num: true },
          { v: s.floorArea.toFixed(1), num: true },
          { v: Units.number(s.total), num: true }];
      }),
      function (i) {
        var storey = S.model.stories.filter(function (x) { return x.name === st.stories[i].name; })[0];
        if (storey) ACT.setStoreyRange(storey.index, storey.index, 'show ' + storey.name);
      }
    ));

    body.appendChild(sectionTitle('Materials', st.materials.length));
    body.appendChild(table(['Material', 'Type', 'Density', 'Used by'],
      st.materials.map(function (m) {
        return [m.name, m.type,
          { v: m.density === null ? 'not stated' : m.density.toFixed(1), num: true },
          { v: Units.number(m.count), num: true }];
      })));

    actionButton(body, 'Export statistics (CSV)', 'Save this as a spreadsheet', FILES.exportStats);
  }

  /* ---- Quantities ---- */

  function renderQuantities(body) {
    var scope = A.scopeIds();
    var q = Analysis.quantities(S.model, scope.ids);

    body.appendChild(sectionTitle(scope.label, Units.number(scope.ids.length) + ' elements'));
    body.appendChild(basisNote('<b>Basis.</b> ' + A.scopeSentence() +
      ' Concrete, steel and formwork are measured from the model geometry.'));

    body.appendChild(tiles([
      ['Concrete', Units.volume(q.totals.concreteVol)],
      ['Steel', Units.mass(q.totals.steelTonnes)],
      ['Formwork', Units.area(q.totals.formwork)],
      ['Slab area', Units.area(q.totals.slab)]
    ]));

    if (q.missingDensity.length) {
      var warn = el('div', 'finding warn');
      warn.innerHTML = '<h4><span class="t"></span><span class="badge">warn</span></h4><p></p>';
      warn.querySelector('.t').textContent = 'Density not stated';
      warn.querySelector('p').textContent =
        'The file gives no unit weight for ' + q.missingDensity.join(', ') +
        '. Steel mass for those sections is reported as zero rather than assumed.';
      body.appendChild(warn);
    }

    body.appendChild(sectionTitle('Concrete by grade'));
    body.appendChild(table(['Grade', 'Volume', 'Columns', 'Beams', 'Slabs', 'Walls'],
      q.concrete.map(function (c) {
        return [c.grade,
          { v: c.volume.toFixed(2), num: true },
          { v: (c.byType.Column || 0).toFixed(1), num: true },
          { v: (c.byType.Beam || 0).toFixed(1), num: true },
          { v: (c.byType.Slab || 0).toFixed(1), num: true },
          { v: (c.byType.Wall || 0).toFixed(1), num: true }];
      })));

    if (q.steel.length) {
      body.appendChild(sectionTitle('Steel by section', q.steel.length));
      body.appendChild(table(['Section', 'Count', 'Length', 'Mass (t)'],
        q.steel.map(function (s) {
          return [s.section,
            { v: Units.number(s.count), num: true },
            { v: Units.length(s.length, { bare: true, digits: 1 }), num: true },
            { v: s.tonnes.toFixed(2), num: true }];
        }),
        function (i) {
          var name = q.steel[i].section;
          var ids = [];
          S.model.elements.forEach(function (e) { if (e.section === name) ids.push(e.id); });
          ACT.selectIds(ids, false, 'select ' + name);
          S.viewer.frameElements(ids);
        }));
    }

    body.appendChild(sectionTitle('Concrete by storey'));
    var storeyEntries = S.model.stories.slice().reverse().map(function (s) {
      return {
        label: s.name,
        value: q.concrete.reduce(function (a, c) { return a + (c.byStorey[s.name] || 0); }, 0)
      };
    }).filter(function (e) { return e.value > 0; });
    bars(body, storeyEntries, function (v) { return Units.volume(v); });

    actionButton(body, 'Export bill of materials (CSV)', 'Quantities as a flat table', FILES.exportBom, true);
    actionButton(body, 'Excel workbook with formulas', 'Full BOQ wired to an editable rate card', FILES.exportWorkbook);
  }

  /* ---- Cost / BOQ ---- */

  function renderCost(body) {
    var scope = A.scopeIds();
    var q = Analysis.quantities(S.model, scope.ids);
    var billData = Costing.bill(q, S.costing, { builtUpArea: q.totals.slab });
    var money = function (v, compact) { return Costing.money(v, S.costing, compact); };

    body.appendChild(sectionTitle('Bill of quantities', scope.label));
    body.appendChild(basisNote(
      '<b>Read this first.</b> Quantities are measured from the model. <b>Reinforcement and every ' +
      'money figure are estimates built on the rate card you control</b> — no price data ships with ' +
      'this tool. ' + A.scopeSentence()));

    body.appendChild(tiles([
      ['Total', money(billData.total, true)],
      ['Per m² built-up', billData.perM2 ? money(billData.perM2) : '—', 'built-up ' + Units.area(billData.builtUpArea)],
      ['Reinforcement', Units.mass(billData.rebar.totalTonnes), 'estimated', true],
      ['Contingency', money(billData.contingency, true), 'at ' + billData.contingencyPct + '%']
    ]));

    if (billData.warnings.length) {
      billData.warnings.forEach(function (w) {
        var n = el('div', 'finding warn');
        n.innerHTML = '<h4><span class="t">Check this</span><span class="badge">warn</span></h4><p></p>';
        n.querySelector('p').textContent = w;
        body.appendChild(n);
      });
    }

    body.appendChild(sectionTitle('Bill', billData.lines.length + ' lines'));
    body.appendChild(table(['Item', 'Qty', 'Unit', 'Rate', 'Amount'],
      billData.lines.map(function (l) {
        return [l.item + (l.estimated ? '  (est.)' : ''),
          { v: l.grossQty.toFixed(2), num: true },
          l.unit,
          { v: money(l.rate), num: true },
          { v: money(l.amount), num: true }];
      })));

    var totals = el('dl', 'kv');
    [['Subtotal', money(billData.subtotal)],
     ['Contingency ' + billData.contingencyPct + '%', money(billData.contingency)],
     ['TOTAL', money(billData.total)]].forEach(function (p) {
      totals.appendChild(el('dt', '', p[0]));
      var dd = el('dd');
      dd.textContent = p[1];
      totals.appendChild(dd);
    });
    body.appendChild(totals);

    body.appendChild(sectionTitle('Reinforcement allowance'));
    body.appendChild(table(['Element', 'Concrete m³', 'kg/m³', 'Tonnes'],
      billData.rebar.byType.map(function (r) {
        return [r.type,
          { v: r.volume.toFixed(1), num: true },
          { v: r.rate, num: true },
          { v: r.tonnes.toFixed(2), num: true }];
      })));
    body.appendChild(el('p', 'hint',
      'Change these rates in the rail under <b>Quantities &amp; rates</b>. The defaults are placeholders.'));

    body.appendChild(sectionTitle('Cost by storey'));
    bars(body, billData.perStorey.map(function (p) {
      return { label: p.storey, value: p.cost, ochre: true };
    }), function (v) { return money(v, true); });
    body.appendChild(el('p', 'hint',
      'Allocated on each storey’s share of concrete volume — the only split the geometry supports.'));

    actionButton(body, 'Excel BOQ with live formulas', 'Edit a rate in Excel and the totals move', FILES.exportWorkbook, true);
    actionButton(body, 'BOQ as CSV', 'Flat table for another estimating sheet', FILES.exportBoqCsv);
  }

  /* ---- Health ---- */

  /**
   * What this one element carries, broken down by load case, and where it
   * sits against its floor's and the building's worst.
   */
  function appendLoadBreakdown(body, e) {
    var L = global.ETABSLoads;
    if (!L.carries(e)) return;
    var r = S.load.result || A.computeLoads();
    if (!r) return;

    var unit = L.unitFor(e);
    var value = r.values[e.id];
    var rows = r.breakdown[e.id] || [];

    body.appendChild(sectionTitle('Load it carries'));
    body.appendChild(basisNote('<b>' + A.escapeHtml(r.basisLabel) + '</b>' +
      (r.selfWeight ? ' · self weight included' : ' · applied loads only')));

    if (!rows.length) {
      body.appendChild(el('p', 'hint', 'No load from this case is assigned to this element.'));
    } else {
      body.appendChild(table(['Load case', 'Intensity'], rows.map(function (row) {
        return [row.label, { v: L.fmt(row.value, unit), num: true }];
      }).concat([['Total', { v: L.fmt(value, unit), num: true }]])));
    }

    // Against the floor and the building — the comparison the user asked for.
    var floor = r.byFloor[e.story || '—'];
    var isArea = e.kind === 'area';
    var floorMax = floor ? (isArea ? floor.slabMax : floor.beamMax) : 0;
    var buildingMax = isArea ? r.building.slabMax : r.building.beamMax;
    var chart = el('div');
    bars(chart, [
      { label: 'This ' + (isArea ? 'panel' : 'beam'), value: value },
      { label: (e.story || 'floor') + ' max', value: floorMax, ochre: true },
      { label: 'Building max', value: buildingMax, ochre: true }
    ], function (v) { return L.fmt(v, unit); });
    body.appendChild(chart);
  }

  /* ---- Loads by floor ---- */
  function renderLoads(body) {
    var L = global.ETABSLoads;
    var r = S.load.result || A.computeLoads();
    if (!r) { body.appendChild(el('p', 'hint', 'Open a model to see its loads.')); return; }
    var b = r.building;

    body.appendChild(basisNote(
      '<b>' + A.escapeHtml(r.basisLabel) + '</b>' +
      (r.selfWeight ? ' · self weight included' : ' · applied loads only') +
      '. Slabs in kN/m², beams in kN/m. These are the loads assigned in the model; nothing is analysed.'));

    body.appendChild(tiles([
      ['Slab max', L.fmt(b.slabMax, 'kN/m²'), b.worstSlabFloor ? 'on ' + b.worstSlabFloor.name : ''],
      ['Beam max', L.fmt(b.beamMax, 'kN/m'), b.worstBeamFloor ? 'on ' + b.worstBeamFloor.name : ''],
      ['Heaviest floor', b.heaviestFloor ? b.heaviestFloor.name : '—',
        b.heaviestFloor ? Math.round(b.heaviestFloor.totalKN).toLocaleString() + ' kN' : ''],
      ['Building total', Math.round(b.totalKN).toLocaleString() + ' kN',
        'average slab ' + L.fmt(b.slabAvg, 'kN/m²')]
    ]));

    if (!r.hasLoads) {
      body.appendChild(el('p', 'hint',
        'This case has no assigned loads. Pick another case in the rail, or check What is in this file?'));
    }

    // Bar chart — total gravity load carried by each floor.
    body.appendChild(sectionTitle('Load carried, floor by floor', r.floors.length));
    var chart = el('div');
    bars(chart, r.floors.map(function (f) {
      return { label: f.name, value: Math.round(f.totalKN), ochre: b.heaviestFloor && f.name === b.heaviestFloor.name };
    }), function (v) { return v.toLocaleString() + ' kN'; });
    body.appendChild(chart);

    // Table — maxima and averages, click a row to fly to the worst element.
    body.appendChild(sectionTitle('Intensity by floor'));
    var hasPoints = r.pointKN > 0;
    body.appendChild(table(
      ['Storey', 'Slab max', 'Slab avg', 'Beam max', 'Beam avg'].concat(hasPoints ? ['Points kN'] : []).concat(['Total']),
      r.floors.map(function (f) {
        var row = [
          f.name,
          { v: L.fmt(f.slabMax), num: true },
          { v: L.fmt(f.slabAvg), num: true },
          { v: L.fmt(f.beamMax), num: true },
          { v: L.fmt(f.beamAvg), num: true }
        ];
        if (hasPoints) row.push({ v: Math.round(f.pointKN).toLocaleString(), num: true });
        row.push({ v: Math.round(f.totalKN).toLocaleString(), num: true });
        return row;
      }),
      function (i) { ACT.focusWorst(r.floors[i].name, r.floors[i].slabMax >= r.floors[i].beamMax ? 'slab' : 'beam'); }
    ));

    // Where the load comes from — one row per pattern in this basis.
    if (r.patterns.length) {
      body.appendChild(sectionTitle('What makes up the load', r.patterns.length));
      body.appendChild(table(['Load pattern', 'Kind', 'Factor', 'Total kN', 'Share'],
        r.patterns.map(function (p) {
          return [
            p.name, p.kind,
            { v: p.factor === 1 ? '1.0' : p.factor.toFixed(2), num: true },
            { v: Math.round(p.totalKN).toLocaleString(), num: true },
            { v: r.building.totalKN ? Math.round(p.totalKN / r.building.totalKN * 100) + '%' : '—', num: true }
          ];
        })));
    }

    // Structure self weight — carried by, not applied to, the frame.
    var st = r.structure;
    if (st && st.total > 0) {
      body.appendChild(sectionTitle('Structure self weight'));
      body.appendChild(table(['Item', 'Weight kN'], [
        ['Columns and braces', { v: Math.round(st.columnKN).toLocaleString(), num: true }],
        ['Walls', { v: Math.round(st.wallKN).toLocaleString(), num: true }],
        ['Total vertical structure', { v: Math.round(st.total).toLocaleString(), num: true }],
        ['Floors (the table above)', { v: Math.round(r.building.totalKN).toLocaleString(), num: true }],
        ['Whole structure', { v: Math.round(st.total + r.building.totalKN).toLocaleString(), num: true }]
      ]));
      body.appendChild(basisNote(
        'Columns and walls are not part of the floor totals — they carry load rather than receive an ' +
        'intensity — so their weight is listed separately here.'));
    }

    // Seismic weight — a real IS 1893 calculation from loads + geometry.
    body.appendChild(sectionTitle('Seismic weight, IS 1893:2016'));
    body.appendChild(table(['Storey', 'Dead', 'Struct.', 'Imposed', 'Counted', 'W kN'],
      r.floors.map(function (f) {
        return [
          f.name,
          { v: Math.round(f.deadKN).toLocaleString(), num: true },
          { v: Math.round(f.structureKN).toLocaleString(), num: true },
          { v: Math.round(f.liveKN).toLocaleString(), num: true },
          { v: Math.round(f.seismicLive || 0).toLocaleString(), num: true },
          { v: Math.round(f.seismicW).toLocaleString(), num: true }
        ];
      }).concat([[
        'Total W', '', '', '',
        '', { v: Math.round(r.seismic.total).toLocaleString(), num: true }
      ]])));
    body.appendChild(basisNote(
      '<b>Cl 7.3.1 and Table 8</b> — full dead load plus ¼ of an imposed load up to 3 kN/m² and ½ above it. ' +
      '<b>Cl 7.3.2</b> — imposed load on the roof is not counted, and each storey&rsquo;s columns and walls are ' +
      'shared half to the level above and half below. This is arithmetic on what the model carries, not an ' +
      'analysis: it will only match ETABS if every load in the building is modelled here.'));

    body.appendChild(basisNote(
      'Slab averages are weighted by area and beam averages by length, so one small heavily-loaded panel ' +
      'cannot skew a floor. Totals are slab intensity × plan area plus beam load × length.'));

    actionButton(body,
      S.colorMode === 'load' ? 'Turn the load colours off' : 'Colour the model by load',
      S.colorMode === 'load'
        ? 'Go back to colouring by ' + (S.load.previousMode || 'type')
        : 'Paint every slab and beam by intensity',
      ACT.showLoadMap, S.colorMode !== 'load');
    actionButton(body, 'Export the load tables',
      'Write the per-floor and per-element loads to a spreadsheet', function () { FILES.exportLoads(); });
  }

  /* ---- Steel & bars ---- */
  /**
   * One sentence on what was left out of the cage, so the tonnage is never
   * read as covering the whole building when it does not.
   *
   * @param {{steel:number, noSection:number, type:number}} sk
   * @returns {string} HTML fragment, empty when nothing was skipped
   */
  function skippedNote(sk) {
    if (!sk) return '';
    var parts = [];
    if (sk.steel) parts.push('<b>' + sk.steel + '</b> steel ' +
      (sk.steel === 1 ? 'member carries' : 'members carry') + ' no cage');
    if (sk.noSection) parts.push('<b>' + sk.noSection + '</b> with no section the file defines');
    if (!parts.length) return '';
    return ' Left out: ' + parts.join(', ') + '.';
  }

  function renderRebar(body) {
    var RB = global.ETABSRebar;
    var R = A.rebarSettings();

    if (!S.rebar.on || !S.rebar.result) {
      body.appendChild(basisNote(
        'Reinforcement is not drawn yet. It is built from the bar pattern in the file for columns, and from ' +
        'the percentages and spacings you set for beams, slabs and walls.'));
      actionButton(body, 'Draw the reinforcement', 'Build the cage and the steel quantities',
        function () { ACT.toggleRebar(true); }, true);
      return;
    }

    var r = S.rebar.result, t = r.totals, st = S.rebar.stats || {};

    body.appendChild(tiles([
      ['Total steel', t.tonnes.toFixed(2) + ' t', t.grade],
      ['Ratio', Math.round(t.kgPerM3) + ' kg/m³', Math.round(t.concreteVol) + ' m³ concrete'],
      ['Bars', t.barCount.toLocaleString(), r.bbs.length + ' schedule rows'],
      ['Net / gross', Math.round(t.netKg / 1000) + ' t / ' + Math.round(t.grossKg / 1000) + ' t', 'laps, wastage, chairs added']
    ]));

    body.appendChild(basisNote(
      'Columns use the bar pattern, diameter, cover and tie spacing written in the file. Beams use ' +
      '<b>' + R.beamTopPercent + '% top / ' + R.beamBotPercent + '% bottom</b>, slabs a <b>' + R.slabBarDia +
      ' mm mesh at ' + R.slabSpacing + '</b>, walls <b>' + R.wallBarDia + ' mm at ' + R.wallSpacing + '</b> — ' +
      'indicative detailing, not a design.' +
      (st.every > 1 ? ' The picture shows every ' + st.every + 'th link; every bar is still counted.' : '') +
      skippedNote(r.skipped)));

    /* Make-up of the total */
    body.appendChild(sectionTitle('What makes up the tonnage'));
    body.appendChild(table(['Item', 'kg'], [
      ['Bars, net length', { v: Math.round(t.netKg).toLocaleString(), num: true }],
      ['Laps — ' + RB.lapDescription(R) + ', over ' + R.stockLength + ' m stock',
        { v: Math.round(t.lapKg).toLocaleString(), num: true }],
      ['Wastage ' + R.wastagePercent + '%', { v: Math.round(t.wastageKg).toLocaleString(), num: true }],
      ['Chairs, spacers, binding ' + R.accessoriesPercent + '%', { v: Math.round(t.accessoriesKg).toLocaleString(), num: true }],
      ['Total to order', { v: Math.round(t.grossKg).toLocaleString(), num: true }]
    ]));

    /* By diameter */
    body.appendChild(sectionTitle('By diameter', r.byDia.length));
    var chart = el('div');
    bars(chart, r.byDia.map(function (d) {
      return { label: d.dia + ' mm', value: Math.round(d.kg) };
    }), function (v) { return v.toLocaleString() + ' kg'; });
    body.appendChild(chart);
    body.appendChild(table(['Dia', 'Bars', 'Length m', 'Weight kg', 'Share'],
      r.byDia.map(function (d) {
        return [d.dia + ' mm',
          { v: d.count.toLocaleString(), num: true },
          { v: Math.round(d.lengthM).toLocaleString(), num: true },
          { v: Math.round(d.kg).toLocaleString(), num: true },
          { v: Math.round(d.kg / (t.netKg + t.lapKg) * 100) + '%', num: true }];
      })));

    /* By member type and by floor */
    body.appendChild(sectionTitle('By member type'));
    body.appendChild(table(['Type', 'Weight kg', 'Concrete m³', 'kg/m³'],
      r.byType.map(function (x) {
        return [x.type,
          { v: Math.round(x.kg).toLocaleString(), num: true },
          { v: x.volume.toFixed(1), num: true },
          { v: x.volume > 0 ? Math.round(x.kg / x.volume) : '—', num: true }];
      })));

    body.appendChild(sectionTitle('By floor', r.byFloor.length));
    body.appendChild(table(['Storey', 'Bars', 'Weight kg'],
      r.byFloor.map(function (f) {
        return [f.name, { v: f.bars.toLocaleString(), num: true }, { v: Math.round(f.kg).toLocaleString(), num: true }];
      })));

    /* Ratio check */
    if (r.flagged.length) {
      body.appendChild(sectionTitle('Members outside the usual ratio', r.flagged.length));
      body.appendChild(table(['Member', 'Storey', 'kg/m³', ''],
        r.flagged.slice(0, 12).map(function (e) {
          var el2 = S.model.elements[e.id];
          return [(el2 && el2.name) || ('#' + e.id), e.story || '—',
            { v: Math.round(e.ratio), num: true }, e.flag === 'high' ? 'heavy' : 'light'];
        }),
        function (i) { ACT.inspectBars(r.flagged[i].id); }));
      body.appendChild(basisNote(
        'Typical bands: columns 120–260, beams 90–200, slabs 55–120 kg/m³. Being outside a band is not an ' +
        'error — it usually means the percentages above do not suit that member.'));
    }

    /* Section drawing */
    var secId = S.rebar.sectionId !== null && S.rebar.sectionId !== undefined
      ? S.rebar.sectionId : S.viewer.selection[0];
    var secEl = secId === undefined ? null : S.model.elements[secId];
    if (secEl && secEl.kind === 'frame') {
      var cs = RB.crossSection(S.model, secEl, R);
      if (cs) {
        body.appendChild(sectionTitle('Section — ' + (secEl.name || secEl.type) + ' · ' + secEl.section));
        body.appendChild(sectionSvg(cs, secEl));
        var detail = [
          ['Section', Math.round(cs.width * 1000) + ' × ' + Math.round(cs.depth * 1000) + ' mm'],
          ['Bars', cs.bars.length + ' no. ' + (cs.bars[0] ? cs.bars[0].dia : '—') + ' mm'],
          ['Links', cs.tie ? cs.tie.dia + ' mm @ ' + Math.round(cs.tie.spacing) + ' c/c' : '—'],
          ['Cover', Math.round(cs.cover) + ' mm'],
          ['Source', cs.source === 'file' ? 'pattern ' + cs.pattern + ' from the model file' : 'your percentage rule']
        ];
        if (cs.steelPercent) detail.push(['Steel', cs.steelPercent.toFixed(2) + '% of the section']);
        if (cs.sideCover) detail.push(['Side cover', Math.round(cs.sideCover) + ' mm']);
        if (cs.confining) {
          detail.push(['Confining zone', Math.round(cs.confining) + ' mm c/c near each end']);
        }
        detail.push(['Hooks', cs.hooks === '90' ? '90°' : '135° × 10d (IS 13920)']);
        var dl = el('dl', 'kv');
        detail.forEach(function (d) {
          dl.appendChild(el('dt', '', d[0]));
          var dd = el('dd'); dd.textContent = d[1]; dl.appendChild(dd);
        });
        body.appendChild(dl);
        actionButton(body, 'Cut a section in 3-D', 'Slice the model across this member',
          function () { ACT.sectionThroughMember(secEl.id); });
      }
    } else {
      body.appendChild(basisNote('Select a column or beam to see its cross-section drawn with its bars.'));
    }

    /* Code screening of the detailing */
    var codeFindings = RB.checks(S.model, r);
    body.appendChild(sectionTitle('Detailing checks — IS 456 / IS 13920', codeFindings.length));
    if (!codeFindings.length) {
      body.appendChild(el('p', 'hint',
        'Steel percentages, link spacing and bar spacing all sit inside the code limits for every section drawn.'));
    } else {
      codeFindings.slice(0, 12).forEach(function (f) {
        var card = el('div', 'finding ' + (f.severity === 'critical' ? 'critical' : 'warn'));
        card.innerHTML = '<h4>' + A.escapeHtml(f.title) +
          '<span class="badge">' + f.severity + '</span></h4><p>' + A.escapeHtml(f.detail) + '</p>';
        var link = el('button', 'link', 'Show a member');
        link.addEventListener('click', function () { ACT.inspectBars(f.elementId); });
        card.appendChild(link);
        body.appendChild(card);
      });
      body.appendChild(basisNote(
        'These check the <b>detailing</b> — percentages, spacing and congestion — against IS 456 and IS 13920. ' +
        'They say nothing about whether the steel is enough for the forces; that is the designer\u2019s job.'));
    }

    /* Schedule */
    body.appendChild(sectionTitle('Bar bending schedule', r.bbs.length));
    body.appendChild(bbsTable(r.bbs.slice(0, 40)));
    if (r.bbs.length > 40) {
      body.appendChild(el('p', 'hint', 'Showing the first 40 of ' + r.bbs.length + ' rows — the export has them all.'));
    }

    actionButton(body, 'Export the schedule and steel tables',
      'Bar bending schedule and summaries as CSV', function () { FILES.exportRebar(); }, true);
  }

  /**
   * A bar bending schedule with a drawn shape per row — the shape sketch is
   * what a bar bender reads first, so it is worth the space.
   */
  function bbsTable(rows) {
    var wrap = el('div', 'tbl-wrap');
    var t = el('table', 'data');
    t.innerHTML = '<thead><tr>' +
      ['Mark', 'Member', 'Shape', 'Code', 'Dia', 'Cutting m', 'No.', 'Weight kg']
        .map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (row) {
      var tr = el('tr');
      tr.innerHTML =
        '<td>' + A.escapeHtml(row.mark) + '</td>' +
        '<td>' + A.escapeHtml(row.member) + '</td>' +
        '<td>' + shapeSketch(row) + '</td>' +
        '<td class="num">' + row.shape + '</td>' +
        '<td class="num">' + row.dia + '</td>' +
        '<td class="num">' + row.cutting.toFixed(2) + '</td>' +
        '<td class="num">' + row.count.toLocaleString() + '</td>' +
        '<td class="num">' + Math.round(row.kg).toLocaleString() + '</td>';
      A.tip(tr, (row.shapeName || '') + ' · ' + row.section + ' · cutting length includes hooks and bend deductions');
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  /** Tiny shape diagram for one schedule row. */
  function shapeSketch(row) {
    var stroke = 'stroke="#0e7c86" stroke-width="2" fill="none"';
    var body;
    switch (row.sketch) {
      case 'link':
        body = '<rect x="6" y="5" width="36" height="20" rx="3" ' + stroke + '/>' +
               '<path d="M36 11 L44 4" ' + stroke + '/><path d="M30 11 L38 4" ' + stroke + '/>';
        break;
      case 'crosstie':
        body = '<path d="M6 15 H42" ' + stroke + '/><path d="M8 15 L14 7" ' + stroke + '/>' +
               '<path d="M40 15 L34 23" ' + stroke + '/>';
        break;
      case 'lbar':
        body = '<path d="M6 22 H40 V8" ' + stroke + '/>';
        break;
      case 'crank':
        body = '<path d="M4 20 H16 L26 10 H44" ' + stroke + '/>';
        break;
      default:
        body = '<path d="M4 15 H44" ' + stroke + '/>';
    }
    return '<svg viewBox="0 0 48 30" width="48" height="30" aria-label="' +
      A.escapeHtml(row.shapeName || 'shape') + '">' + body + '</svg>';
  }

  /**
   * The cross-section as a drawing: concrete outline, links, bars to scale.
   * Drawn in SVG so it stays crisp at any size and prints cleanly.
   */
  function sectionSvg(cs, element) {
    var pad = 36;
    var w = cs.width * 1000, d = cs.depth * 1000;              // mm
    var scale = Math.min(300 / Math.max(w, 1), 300 / Math.max(d, 1));
    var W = w * scale + pad * 2, H = d * scale + pad * 2;
    var cx = W / 2, cy = H / 2;
    var shiftU = (cs.shift ? cs.shift[0] : 0) * 1000 * scale;
    var shiftV = (cs.shift ? cs.shift[1] : 0) * 1000 * scale;

    function X(u) { return cx + u * 1000 * scale; }
    function Y(v) { return cy - v * 1000 * scale; }

    var parts = [];
    // Concrete outline, from the real section profile.
    var outline = cs.outline.map(function (p) {
      return (X(p[0] + (cs.shift ? cs.shift[0] : 0)) ) + ',' + (Y(p[1] + (cs.shift ? cs.shift[1] : 0)));
    }).join(' ');
    parts.push('<polygon points="' + outline + '" fill="var(--surface-3)" stroke="var(--ink-3)" stroke-width="1.5"/>');

    // Link / stirrup.
    if (cs.tie) {
      var u0 = (cs.tie.u || 0), mid = (cs.tie.mid || 0);
      var x1 = X(-cs.tie.hw + u0), x2 = X(cs.tie.hw + u0);
      var y1 = Y(mid + cs.tie.hd), y2 = Y(mid - cs.tie.hd);
      parts.push('<rect x="' + Math.min(x1, x2) + '" y="' + Math.min(y1, y2) +
        '" width="' + Math.abs(x2 - x1) + '" height="' + Math.abs(y2 - y1) +
        '" rx="4" fill="none" stroke="#b26b00" stroke-width="2"/>');
    }

    // Cross-ties holding the inner bars.
    (cs.crossTies || []).forEach(function (ct) {
      parts.push('<line x1="' + X(ct.x1) + '" y1="' + Y(ct.y1) + '" x2="' + X(ct.x2) + '" y2="' + Y(ct.y2) +
        '" stroke="#b26b00" stroke-width="1.6" stroke-dasharray="5 3"/>');
    });

    // Bars, at true diameter.
    cs.bars.forEach(function (bar) {
      var rr = Math.max(2.2, bar.dia / 2 * scale);
      parts.push('<circle cx="' + X(bar.u) + '" cy="' + Y(bar.v) + '" r="' + rr +
        '" fill="#0e7c86" stroke="#083f45" stroke-width="0.8"/>');
    });

    // Dimensions.
    parts.push('<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle" ' +
      'font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--ink-3)">' + Math.round(w) + ' mm</text>');
    parts.push('<text x="12" y="' + cy + '" text-anchor="middle" transform="rotate(-90 12 ' + cy + ')" ' +
      'font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--ink-3)">' + Math.round(d) + ' mm</text>');

    var host = el('div');
    host.innerHTML = '<svg class="gfx" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cross-section of ' +
      A.escapeHtml((element.name || element.type) + ' ' + element.section) + '">' + parts.join('') + '</svg>';
    return host;
  }

  function renderHealth(body) {
    var findings = Analysis.healthChecks(S.model);
    S.findings = findings;

    if (!findings.length) {
      body.innerHTML = '<div class="all-clear"><div class="big">All checks passed</div>' +
        '<p>No orphan joints, zero-length members, undefined sections, duplicate members or ' +
        'discontinuous columns were found.</p></div>';
      body.appendChild(basisNote('A clean result means these eight checks passed — not that the model is correct.'));
      return;
    }

    var counts = { critical: 0, warn: 0, info: 0 };
    findings.forEach(function (f) { counts[f.severity]++; });
    body.appendChild(tiles([
      ['Critical', String(counts.critical)],
      ['Warnings', String(counts.warn)],
      ['Notes', String(counts.info)],
      ['Checks run', '7']
    ]));

    findings.forEach(function (f) { body.appendChild(findingCard(f)); });
    actionButton(body, 'Export findings (CSV)', 'Save every finding with its detail', FILES.exportHealth);
  }

  function findingCard(f) {
    var card = el('div', 'finding ' + f.severity);
    card.innerHTML =
      '<h4><span class="ttl"></span><span class="badge">' + f.severity + '</span>' +
      (f.clause ? '<span class="clause">' + A.escapeHtml(f.clause) + '</span>' : '') + '</h4>' +
      '<p class="detail"></p>';
    card.querySelector('.ttl').textContent = f.title;
    card.querySelector('.detail').textContent = f.detail;

    if (f.basis || f.limits) {
      var meta = el('p', 'meta');
      meta.innerHTML =
        (f.basis ? '<b>Measured:</b> ' + A.escapeHtml(f.basis) + '<br>' : '') +
        (f.limits ? '<b>What it does not prove:</b> ' + A.escapeHtml(f.limits) : '');
      card.appendChild(meta);
    }

    if (f.ids && f.ids.length) {
      var b1 = el('button', 'link', 'Select all ' + f.ids.length);
      A.tip(b1, 'Select and zoom to every affected element');
      b1.addEventListener('click', function () {
        ACT.selectIds(f.ids, false, 'select ' + f.title.toLowerCase());
        S.viewer.frameElements(f.ids);
      });
      var b2 = el('button', 'link', ' · Isolate');
      A.tip(b2, 'Show only the affected elements');
      b2.addEventListener('click', function () {
        ACT.isolateIds(f.ids, f.title.toLowerCase());
        S.viewer.frameElements(f.ids);
      });
      card.appendChild(b1);
      card.appendChild(b2);
    }
    return card;
  }

  /* ---- Code screening ---- */

  function renderCode(body) {
    var result = global.ETABSCode.screen(S.model);

    body.appendChild(basisNote(
      '<b>Screening, not compliance.</b> These four IS 1893:2016 irregularities can be judged from ' +
      'geometry. Each result states what was measured and what it does not prove. It does not replace ' +
      'an engineer, and it is not a code check.'));

    body.appendChild(tiles([
      ['Flagged', String(result.findings.length)],
      ['Checks run', String(result.checksRun)],
      ['Storeys read', String(result.storeys.length - 1)],
      ['Not checkable', String(result.notCheckable.length)]
    ]));

    if (!result.findings.length) {
      body.appendChild(el('div', 'all-clear',
        '<div class="big">No irregularities flagged</div>' +
        '<p>Setback, re-entrant corner, soft-storey proxy and in-plane discontinuity all passed on ' +
        'this geometry.</p>'));
    } else {
      result.findings.forEach(function (f) { body.appendChild(findingCard(f)); });
    }

    body.appendChild(sectionTitle('Vertical element area by storey'));
    var rows = result.storeys.filter(function (r) { return r.index > 0 && r.verticalArea > 0; }).reverse();
    body.appendChild(table(['Storey', 'Columns m²', 'Walls m²', 'Total m²', 'Height'],
      rows.map(function (r) {
        return [r.name,
          { v: r.columnArea.toFixed(3), num: true },
          { v: r.wallArea.toFixed(3), num: true },
          { v: r.verticalArea.toFixed(3), num: true },
          { v: Units.length(r.height, { bare: true }), num: true }];
      })));
    body.appendChild(el('p', 'hint',
      'Cross-sectional area is a <b>proxy</b> for lateral stiffness. Real storey stiffness depends on ' +
      'height cubed, end fixity and cracked-section properties.'));

    body.appendChild(sectionTitle('Cannot be screened from geometry', result.notCheckable.length));
    result.notCheckable.forEach(function (n) {
      var card = el('div', 'finding info');
      card.innerHTML = '<h4><span class="ttl"></span><span class="clause">' +
        A.escapeHtml(n.clause) + '</span></h4><p></p>';
      card.querySelector('.ttl').textContent = n.name;
      card.querySelector('p').textContent = n.why;
      body.appendChild(card);
    });
  }

  /* ---- Sections ---- */

  function renderSections(body) {
    var st = S.stats || Analysis.statistics(S.model);
    body.appendChild(sectionTitle('Section inventory', st.sections.length));
    body.appendChild(table(['Section', 'Material', 'Count', 'Length'],
      st.sections.map(function (s) {
        return [s.name, s.material || '—',
          { v: Units.number(s.count), num: true },
          { v: Units.length(s.length, { bare: true, digits: 1 }), num: true }];
      }),
      function (i) {
        var name = st.sections[i].name;
        var ids = [];
        S.model.elements.forEach(function (e) { if (e.section === name) ids.push(e.id); });
        ACT.selectIds(ids, false, 'select ' + name);
        S.viewer.frameElements(ids);
        toast(ids.length + ' element(s) use ' + name);
      }));
    body.appendChild(el('p', 'hint', 'Click any row to select and zoom to every element using that section.'));
  }

  /* ---- Compare ---- */

  function renderCompare(body) {
    if (!S.compare) {
      body.appendChild(el('p', 'hint',
        'No revision loaded. Open <b>Compare revisions</b> in the rail and pick a second file — ' +
        'modified sections turn amber, removed elements red.'));
      actionButton(body, 'Load a revision…', 'Pick the second model file', function () {
        $('compareInput').click();
      }, true);
      return;
    }

    var d = S.compare.diff;
    body.appendChild(sectionTitle('Against ' + S.compare.model.meta.fileName));
    body.appendChild(tiles([
      ['Added', String(d.summary.added)],
      ['Removed', String(d.summary.removed)],
      ['Modified', String(d.summary.modified)],
      ['Unchanged', Units.number(d.summary.unchanged)]
    ]));
    body.appendChild(basisNote(
      'Elements are matched on <b>geometry</b>, not name — ETABS reassigns names freely between runs. ' +
      'Added elements exist only in the revision, so they are listed rather than drawn on this model.'));

    if (d.modified.length) {
      body.appendChild(sectionTitle('Changed', d.modified.length));
      body.appendChild(table(['Element', 'Storey', 'Field', 'Was', 'Now'],
        d.modified.slice(0, 250).map(function (m) {
          var c = m.changes[0];
          return [m.element.type + ' ' + m.element.name, m.element.story, c.field, c.from, c.to];
        }),
        function (i) {
          var id = A.findByGeometry(d.modified[i].element);
          if (id >= 0) {
            ACT.selectIds([id], false, 'select changed element');
            S.viewer.frameElements([id]);
          }
        }));
    }
    if (d.added.length) {
      body.appendChild(sectionTitle('Added', d.added.length));
      body.appendChild(table(['Element', 'Storey', 'Section'],
        d.added.slice(0, 200).map(function (e) { return [e.type + ' ' + e.name, e.story, e.section]; })));
    }
    if (d.removed.length) {
      body.appendChild(sectionTitle('Removed', d.removed.length));
      body.appendChild(table(['Element', 'Storey', 'Section'],
        d.removed.slice(0, 200).map(function (e) { return [e.type + ' ' + e.name, e.story, e.section]; })));
    }

    actionButton(body, 'Export the change list (CSV)', 'Every difference as a spreadsheet', FILES.exportCompare);
  }

  global.DRAWER = {
    TABS: TABS,
    open: open, close: close, toggle: toggle, render: render,
    buildSelector: buildSelector
  };
})(window);
