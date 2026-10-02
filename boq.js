/**
 * boq.js — Bill of quantities workbook.
 * =================================================================
 * Builds a multi-sheet .xlsx in which the BOQ is *driven by formulas* that
 * point at a Rate Card sheet. Change a rate, a wastage percentage or a
 * reinforcement rate in the workbook and every dependent figure recalculates
 * in Excel — the difference between a report and a working estimate.
 *
 * Sheet graph:
 *   Rate Card  →  Rebar  →  BOQ  →  Summary
 *                Concrete ↗   ↑
 *                Steel ───────┘
 *
 * Namespace: window.ETABSBOQ
 */
(function (global) {
  'use strict';

  var X = null;   // resolved lazily so load order does not matter
  function xlsx() { return X || (X = global.ETABSXlsx); }

  function sheetRef(sheetName, cell) {
    return "'" + String(sheetName).replace(/'/g, "''") + "'!" + cell;
  }

  /* ------------------------------------------------------------------ */
  /* Rate Card                                                           */
  /* ------------------------------------------------------------------ */

  function buildRateCard(quantities, settings) {
    var S = xlsx().S;
    var rows = [];
    var refs = { concrete: {}, rebarRate: {}, wastage: {} };
    var NAME = 'Rate Card';

    rows.push([{ v: 'RATE CARD', s: S.TITLE }]);
    rows.push([{ v: 'Every shaded cell on this sheet is an input. Change it and the BOQ recalculates.', s: S.NOTE }]);
    rows.push([{ v: 'Reinforcement quantities and all money figures are estimates built on these rates, not values read from the ETABS model.', s: S.NOTE }]);
    rows.push([]);
    rows.push([{ v: 'MATERIAL RATES', s: S.SUBHEAD }]);
    rows.push([{ v: 'Item', s: S.HEADER }, { v: 'Unit', s: S.HEADER }, { v: 'Rate', s: S.HEADER }]);

    quantities.concrete.forEach(function (c) {
      var rate = global.ETABSCosting.concreteRate(c.grade, settings);
      rows.push([
        { v: 'Concrete ' + c.grade },
        { v: 'm³' },
        { v: rate, s: S.INPUT }
      ]);
      refs.concrete[c.grade] = sheetRef(NAME, 'C' + rows.length);
    });

    rows.push([{ v: 'Reinforcement steel' }, { v: 't' }, { v: settings.rebarRatePerTonne, s: S.INPUT }]);
    refs.rebarPerTonne = sheetRef(NAME, 'C' + rows.length);

    rows.push([{ v: 'Structural steel (fabricated & erected)' }, { v: 't' }, { v: settings.steelRatePerTonne, s: S.INPUT }]);
    refs.steelPerTonne = sheetRef(NAME, 'C' + rows.length);

    rows.push([{ v: 'Formwork / shuttering' }, { v: 'm²' }, { v: settings.formworkRatePerM2, s: S.INPUT }]);
    refs.formwork = sheetRef(NAME, 'C' + rows.length);

    rows.push([]);
    rows.push([{ v: 'WASTAGE', s: S.SUBHEAD }]);
    rows.push([{ v: 'Material', s: S.HEADER }, { v: 'Unit', s: S.HEADER }, { v: '%', s: S.HEADER }]);
    [['Concrete', 'concrete'], ['Reinforcement', 'rebar'],
     ['Structural steel', 'steel'], ['Formwork', 'formwork']].forEach(function (pair) {
      rows.push([{ v: pair[0] }, { v: '%' }, { v: settings.wastage[pair[1]], s: S.INPUT }]);
      refs.wastage[pair[1]] = sheetRef(NAME, 'C' + rows.length);
    });

    rows.push([]);
    rows.push([{ v: 'Contingency' }, { v: '%' }, { v: settings.contingency, s: S.INPUT }]);
    refs.contingency = sheetRef(NAME, 'C' + rows.length);

    rows.push([]);
    rows.push([{ v: 'REINFORCEMENT RATES', s: S.SUBHEAD }]);
    rows.push([{ v: 'These drive the Rebar sheet. Typical ranges are shown for reference only.', s: S.NOTE }]);
    rows.push([
      { v: 'Element type', s: S.HEADER }, { v: 'Unit', s: S.HEADER },
      { v: 'Rate', s: S.HEADER }, { v: 'Usual range', s: S.HEADER }
    ]);
    Object.keys(settings.rebarRates).forEach(function (type) {
      var band = settings.rebarBands[type];
      rows.push([
        { v: type }, { v: 'kg/m³' },
        { v: settings.rebarRates[type], s: S.INPUT },
        { v: band ? band[0] + ' – ' + band[1] : '', s: S.NOTE }
      ]);
      refs.rebarRate[type] = sheetRef(NAME, 'C' + rows.length);
    });

    return {
      sheet: { name: NAME, rows: rows, widths: [38, 10, 14, 16], freeze: 6 },
      refs: refs
    };
  }

  /* ------------------------------------------------------------------ */
  /* Concrete                                                            */
  /* ------------------------------------------------------------------ */

  function buildConcrete(quantities, model) {
    var S = xlsx().S;
    var NAME = 'Concrete';
    var rows = [];
    var refs = { byGrade: {}, total: null };

    rows.push([{ v: 'CONCRETE VOLUMES', s: S.TITLE }]);
    rows.push([{ v: 'Volumes are computed from section geometry in the model — these are not estimates.', s: S.NOTE }]);
    rows.push([]);

    var storeys = model.stories.slice().reverse().map(function (s) { return s.name; });
    var header = [{ v: 'Grade', s: S.HEADER }, { v: 'Total (m³)', s: S.HEADER },
                  { v: 'Columns', s: S.HEADER }, { v: 'Beams', s: S.HEADER },
                  { v: 'Slabs', s: S.HEADER }, { v: 'Walls', s: S.HEADER },
                  { v: 'Ramps', s: S.HEADER }];
    storeys.forEach(function (s) { header.push({ v: s, s: S.HEADER }); });
    rows.push(header);
    var headerRow = rows.length;

    quantities.concrete.forEach(function (c) {
      var r = [
        { v: c.grade },
        { v: c.volume, s: S.DEC3 },
        { v: c.byType.Column || 0, s: S.DEC3 },
        { v: c.byType.Beam || 0, s: S.DEC3 },
        { v: c.byType.Slab || 0, s: S.DEC3 },
        { v: c.byType.Wall || 0, s: S.DEC3 },
        { v: c.byType.Ramp || 0, s: S.DEC3 }
      ];
      storeys.forEach(function (s) { r.push({ v: c.byStorey[s] || 0, s: S.DEC3 }); });
      rows.push(r);
      refs.byGrade[c.grade] = sheetRef(NAME, 'B' + rows.length);
    });

    var first = headerRow + 1, last = rows.length;
    var totalRow = [{ v: 'TOTAL', s: S.BOLD }];
    for (var c2 = 1; c2 < header.length; c2++) {
      var col = xlsx().colLetter(c2);
      totalRow.push({ f: 'SUM(' + col + first + ':' + col + last + ')', s: S.DEC3 });
    }
    rows.push(totalRow);
    refs.total = sheetRef(NAME, 'B' + rows.length);

    var widths = [16, 14, 12, 12, 12, 12, 12];
    storeys.forEach(function () { widths.push(12); });
    return { sheet: { name: NAME, rows: rows, widths: widths, freeze: headerRow }, refs: refs };
  }

  /* ------------------------------------------------------------------ */
  /* Rebar — quantities driven live by the rate card                     */
  /* ------------------------------------------------------------------ */

  function buildRebar(quantities, settings, rateRefs) {
    var S = xlsx().S;
    var NAME = 'Rebar';
    var rows = [];
    var refs = { byType: {}, total: null };

    rows.push([{ v: 'REINFORCEMENT ESTIMATE', s: S.TITLE }]);
    rows.push([{ v: 'An ETABS model carries no reinforcement. Tonnage below = concrete volume × the ' +
      'rate you set on the Rate Card sheet. Treat it as an allowance, not a schedule.', s: S.NOTE }]);
    rows.push([]);
    rows.push([
      { v: 'Element type', s: S.HEADER }, { v: 'Concrete (m³)', s: S.HEADER },
      { v: 'Rate (kg/m³)', s: S.HEADER }, { v: 'Steel (t)', s: S.HEADER }
    ]);
    var headerRow = rows.length;

    var byType = {};
    quantities.concrete.forEach(function (c) {
      Object.keys(c.byType).forEach(function (t) {
        byType[t] = (byType[t] || 0) + c.byType[t];
      });
    });

    Object.keys(byType).sort().forEach(function (type) {
      var rateRef = rateRefs.rebarRate[type] || rateRefs.rebarRate.Other;
      rows.push([
        { v: type },
        { v: byType[type], s: S.DEC3 },
        { f: rateRef, s: S.DEC2 },
        { f: 'B' + (rows.length + 1) + '*C' + (rows.length + 1) + '/1000', s: S.DEC3 }
      ]);
      refs.byType[type] = sheetRef(NAME, 'D' + rows.length);
    });

    var first = headerRow + 1, last = rows.length;
    rows.push([
      { v: 'TOTAL', s: S.BOLD },
      { f: 'SUM(B' + first + ':B' + last + ')', s: S.DEC3 },
      { v: '' },
      { f: 'SUM(D' + first + ':D' + last + ')', s: S.DEC3 }
    ]);
    refs.total = sheetRef(NAME, 'D' + rows.length);

    return { sheet: { name: NAME, rows: rows, widths: [20, 16, 16, 14], freeze: headerRow }, refs: refs };
  }

  /* ------------------------------------------------------------------ */
  /* Structural steel                                                    */
  /* ------------------------------------------------------------------ */

  function buildSteel(quantities) {
    var S = xlsx().S;
    var NAME = 'Structural Steel';
    var rows = [];
    var refs = { total: null, rows: {} };

    rows.push([{ v: 'STRUCTURAL STEEL', s: S.TITLE }]);
    rows.push([{ v: 'Mass = section area × length × the density stated in the model file. ' +
      'Sections whose material has no stated density are reported as zero.', s: S.NOTE }]);
    rows.push([]);
    rows.push([
      { v: 'Section', s: S.HEADER }, { v: 'Material', s: S.HEADER },
      { v: 'Count', s: S.HEADER }, { v: 'Length (m)', s: S.HEADER }, { v: 'Mass (t)', s: S.HEADER }
    ]);
    var headerRow = rows.length;

    quantities.steel.forEach(function (s) {
      rows.push([
        { v: s.section }, { v: s.material || '—' },
        { v: s.count, s: S.INT }, { v: s.length, s: S.DEC2 }, { v: s.tonnes, s: S.DEC3 }
      ]);
      refs.rows[s.section] = sheetRef(NAME, 'E' + rows.length);
    });

    if (!quantities.steel.length) {
      rows.push([{ v: 'No steel sections in this model.', s: S.NOTE }]);
      refs.total = null;
    } else {
      var first = headerRow + 1, last = rows.length;
      rows.push([
        { v: 'TOTAL', s: S.BOLD }, { v: '' },
        { f: 'SUM(C' + first + ':C' + last + ')', s: S.INT },
        { f: 'SUM(D' + first + ':D' + last + ')', s: S.DEC2 },
        { f: 'SUM(E' + first + ':E' + last + ')', s: S.DEC3 }
      ]);
      refs.total = sheetRef(NAME, 'E' + rows.length);
    }

    return { sheet: { name: NAME, rows: rows, widths: [26, 16, 10, 14, 14], freeze: headerRow }, refs: refs };
  }

  /* ------------------------------------------------------------------ */
  /* BOQ — the live sheet                                                */
  /* ------------------------------------------------------------------ */

  function buildBoq(quantities, settings, refs, basis, sym) {
    var S = xlsx().S;
    var NAME = 'BOQ';
    var rows = [];

    rows.push([{ v: 'BILL OF QUANTITIES', s: S.TITLE }]);
    rows.push([{ v: basis, s: S.NOTE }]);
    rows.push([{ v: 'Net quantities come from the model. Rates, wastage and reinforcement rates come ' +
      'from the Rate Card sheet — edit them there and this sheet recalculates.', s: S.NOTE }]);
    rows.push([]);
    rows.push([
      { v: 'Group', s: S.HEADER }, { v: 'Item', s: S.HEADER },
      { v: 'Net qty', s: S.HEADER }, { v: 'Unit', s: S.HEADER },
      { v: 'Wastage %', s: S.HEADER }, { v: 'Gross qty', s: S.HEADER },
      { v: 'Rate (' + sym + ')', s: S.HEADER }, { v: 'Amount (' + sym + ')', s: S.HEADER }
    ]);
    var headerRow = rows.length;

    function line(group, item, qtyCell, unit, wastageRef, rateRef) {
      var r = rows.length + 1;
      rows.push([
        { v: group }, { v: item },
        qtyCell,
        { v: unit },
        { f: wastageRef, s: S.DEC2 },
        { f: 'C' + r + '*(1+E' + r + '/100)', s: S.DEC3 },
        { f: rateRef, s: S.MONEY },
        { f: 'F' + r + '*G' + r, s: S.MONEY }
      ]);
    }

    quantities.concrete.forEach(function (c) {
      line('Concrete', 'Concrete ' + c.grade,
        { f: refs.concrete.byGrade[c.grade], s: S.DEC3 }, 'm³',
        refs.rate.wastage.concrete, refs.rate.concrete[c.grade]);
    });

    if (settings.rebarEnabled) {
      Object.keys(refs.rebar.byType).forEach(function (type) {
        line('Reinforcement', 'Reinforcement — ' + type + ' (estimated)',
          { f: refs.rebar.byType[type], s: S.DEC3 }, 't',
          refs.rate.wastage.rebar, refs.rate.rebarPerTonne);
      });
    }

    quantities.steel.forEach(function (s) {
      line('Structural steel', 'Steel — ' + s.section,
        { f: refs.steel.rows[s.section], s: S.DEC3 }, 't',
        refs.rate.wastage.steel, refs.rate.steelPerTonne);
    });

    line('Formwork', 'Formwork / shuttering',
      { v: quantities.totals.formwork, s: S.DEC2 }, 'm²',
      refs.rate.wastage.formwork, refs.rate.formwork);

    var first = headerRow + 1, last = rows.length;
    rows.push([]);
    rows.push([{ v: '' }, { v: 'Subtotal', s: S.BOLD }, null, null, null, null, null,
      { f: 'SUM(H' + first + ':H' + last + ')', s: S.MONEY_BOLD }]);
    var subtotalRow = rows.length;
    rows.push([{ v: '' }, { v: 'Contingency', s: S.BOLD }, null, null,
      { f: refs.rate.contingency, s: S.DEC2 }, null, null,
      { f: 'H' + subtotalRow + '*E' + (rows.length + 1) + '/100', s: S.MONEY_BOLD }]);
    var contRow = rows.length;
    rows.push([{ v: '' }, { v: 'TOTAL', s: S.BOLD }, null, null, null, null, null,
      { f: 'H' + subtotalRow + '+H' + contRow, s: S.MONEY_BOLD }]);
    var totalRow = rows.length;

    return {
      sheet: { name: NAME, rows: rows, widths: [18, 42, 14, 8, 12, 14, 14, 18], freeze: headerRow },
      refs: {
        subtotal: sheetRef(NAME, 'H' + subtotalRow),
        contingency: sheetRef(NAME, 'H' + contRow),
        total: sheetRef(NAME, 'H' + totalRow)
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* By storey                                                           */
  /* ------------------------------------------------------------------ */

  function buildByStorey(quantities, model, boqRefs, stats) {
    var S = xlsx().S;
    var NAME = 'By Storey';
    var rows = [];

    rows.push([{ v: 'QUANTITIES AND COST BY STOREY', s: S.TITLE }]);
    rows.push([{ v: 'Cost is allocated on each storey’s share of concrete volume — the only split the ' +
      'geometry supports. It is an allocation, not a measured storey cost.', s: S.NOTE }]);
    rows.push([]);
    rows.push([
      { v: 'Storey', s: S.HEADER }, { v: 'Elevation (m)', s: S.HEADER },
      { v: 'Floor area (m²)', s: S.HEADER }, { v: 'Concrete (m³)', s: S.HEADER },
      { v: 'Formwork (m²)', s: S.HEADER }, { v: 'Share %', s: S.HEADER },
      { v: 'Allocated cost', s: S.HEADER }, { v: 'Cost / m²', s: S.HEADER }
    ]);
    var headerRow = rows.length;

    var byStorey = {};
    quantities.concrete.forEach(function (c) {
      Object.keys(c.byStorey).forEach(function (s) {
        byStorey[s] = (byStorey[s] || 0) + c.byStorey[s];
      });
    });
    var totalConcrete = Object.keys(byStorey).reduce(function (a, k) { return a + byStorey[k]; }, 0) || 1;

    var areaByStorey = {};
    (stats.stories || []).forEach(function (s) { areaByStorey[s.name] = s.floorArea; });

    model.stories.slice().reverse().forEach(function (s) {
      var vol = byStorey[s.name] || 0;
      if (!vol && !areaByStorey[s.name]) return;
      var r = rows.length + 1;
      rows.push([
        { v: s.name },
        { v: s.elev * model.meta.units.lengthToM, s: S.DEC2 },
        { v: areaByStorey[s.name] || 0, s: S.DEC2 },
        { v: vol, s: S.DEC3 },
        { v: quantities.formwork[s.name] || 0, s: S.DEC2 },
        { v: (vol / totalConcrete) * 100, s: S.DEC2 },
        { f: boqRefs.total + '*F' + r + '/100', s: S.MONEY },
        { f: 'IF(C' + r + '>0,G' + r + '/C' + r + ',"")', s: S.MONEY }
      ]);
    });

    var first = headerRow + 1, last = rows.length;
    rows.push([
      { v: 'TOTAL', s: S.BOLD }, { v: '' },
      { f: 'SUM(C' + first + ':C' + last + ')', s: S.DEC2 },
      { f: 'SUM(D' + first + ':D' + last + ')', s: S.DEC3 },
      { f: 'SUM(E' + first + ':E' + last + ')', s: S.DEC2 },
      { f: 'SUM(F' + first + ':F' + last + ')', s: S.DEC2 },
      { f: 'SUM(G' + first + ':G' + last + ')', s: S.MONEY_BOLD },
      { f: 'IF(C' + (rows.length + 1) + '>0,G' + (rows.length + 1) + '/C' + (rows.length + 1) + ',"")', s: S.MONEY_BOLD }
    ]);

    return { sheet: { name: NAME, rows: rows, widths: [18, 14, 16, 14, 14, 12, 18, 14], freeze: headerRow } };
  }

  /* ------------------------------------------------------------------ */
  /* Summary                                                             */
  /* ------------------------------------------------------------------ */

  function buildSummary(model, stats, quantities, refs, settings, basis, brand) {
    var S = xlsx().S;
    var rows = [];

    rows.push([{ v: (brand && brand.name ? brand.name + ' — ' : '') + 'Structural quantity summary', s: S.TITLE }]);
    rows.push([{ v: model.meta.title || model.meta.fileName, s: S.BOLD }]);
    rows.push([{ v: 'Generated ' + new Date().toLocaleString() +
      (brand && brand.site ? '  ·  ' + brand.site : ''), s: S.NOTE }]);
    rows.push([{ v: basis, s: S.NOTE }]);
    rows.push([]);

    rows.push([{ v: 'MODEL', s: S.SUBHEAD }]);
    [
      ['Source file', model.meta.fileName],
      ['Format', model.meta.source],
      ['Program', (model.meta.program || '—') + ' ' + (model.meta.version || '')],
      ['File units', model.meta.units.force + '-' + model.meta.units.length],
      ['Storeys', stats.storeyCount],
      ['Total height (m)', stats.height],
      ['Footprint (m²)', stats.footprint.area],
      ['Elements', stats.elementTotal]
    ].forEach(function (p) {
      rows.push([{ v: p[0] }, { v: p[1], s: typeof p[1] === 'number' ? S.DEC2 : S.NORMAL }]);
    });

    rows.push([]);
    rows.push([{ v: 'QUANTITIES', s: S.SUBHEAD }]);
    rows.push([{ v: 'Concrete (m³)' }, { f: refs.concrete.total, s: S.DEC3 }]);
    if (settings.rebarEnabled) {
      rows.push([{ v: 'Reinforcement (t) — estimated' }, { f: refs.rebar.total, s: S.DEC3 }]);
    }
    if (refs.steel.total) {
      rows.push([{ v: 'Structural steel (t)' }, { f: refs.steel.total, s: S.DEC3 }]);
    }
    rows.push([{ v: 'Formwork (m²)' }, { v: quantities.totals.formwork, s: S.DEC2 }]);

    rows.push([]);
    rows.push([{ v: 'COST', s: S.SUBHEAD }]);
    rows.push([{ v: 'Subtotal' }, { f: refs.boq.subtotal, s: S.MONEY }]);
    rows.push([{ v: 'Contingency' }, { f: refs.boq.contingency, s: S.MONEY }]);
    rows.push([{ v: 'TOTAL', s: S.BOLD }, { f: refs.boq.total, s: S.MONEY_BOLD }]);

    var builtUp = quantities.totals.slab;
    if (builtUp > 0) {
      rows.push([{ v: 'Built-up area (m²)' }, { v: builtUp, s: S.DEC2 }]);
      rows.push([{ v: 'Cost per m² built-up' },
        { f: refs.boq.total + '/' + builtUp.toFixed(4), s: S.MONEY }]);
    }

    rows.push([]);
    rows.push([{ v: 'HOW TO READ THIS WORKBOOK', s: S.SUBHEAD }]);
    [
      'Concrete, steel and formwork quantities are measured from the model geometry.',
      'Reinforcement is an allowance: concrete volume × a rate per element type that you set.',
      'All money is your rate card applied to those quantities. No price data ships with this tool.',
      'Edit any shaded cell on the Rate Card sheet and every total in this workbook recalculates.'
    ].forEach(function (t) { rows.push([{ v: '•  ' + t, s: S.NOTE }]); });

    return { sheet: { name: 'Summary', rows: rows, widths: [34, 26] } };
  }

  /* ------------------------------------------------------------------ */
  /* Elements listing                                                    */
  /* ------------------------------------------------------------------ */

  function buildElements(model, ids, Units) {
    var S = xlsx().S;
    var rows = [];
    var L = Units.lengthLabel();
    rows.push([
      { v: 'Id', s: S.HEADER }, { v: 'Type', s: S.HEADER }, { v: 'Name', s: S.HEADER },
      { v: 'Storey', s: S.HEADER }, { v: 'Section', s: S.HEADER }, { v: 'Material', s: S.HEADER },
      { v: 'Length (' + L + ')', s: S.HEADER }, { v: 'Volume (m³)', s: S.HEADER },
      { v: 'Area (m²)', s: S.HEADER }
    ]);
    var list = ids || model.elements.map(function (e) { return e.id; });
    var cap = Math.min(list.length, 60000);
    for (var i = 0; i < cap; i++) {
      var e = model.elements[list[i]];
      if (!e || e.kind === 'joint') continue;
      rows.push([
        { v: e.id, s: S.INT }, { v: e.type }, { v: e.name || '' }, { v: e.story || '' },
        { v: e.section || '' }, { v: e.material || '' },
        { v: e.length ? Units.lengthValue(e.length) : 0, s: S.DEC3 },
        { v: e.volume || 0, s: S.DEC3 },
        { v: e.planArea || 0, s: S.DEC2 }
      ]);
    }
    if (list.length > cap) {
      rows.push([{ v: 'Listing capped at ' + cap + ' rows.', s: S.NOTE }]);
    }
    return { sheet: { name: 'Elements', rows: rows, widths: [8, 12, 16, 14, 24, 14, 14, 14, 14], freeze: 1 } };
  }

  /* ------------------------------------------------------------------ */
  /* Entry point                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * @returns {Blob} the workbook
   */
  /* ------------------------------------------------------------------ */
  /* Loads — what the model says each floor carries                      */
  /* ------------------------------------------------------------------ */

  function buildLoadFloors(result) {
    var S = xlsx().S;
    var NAME = 'Loads by floor';
    var rows = [];

    rows.push([{ v: 'LOAD INTENSITY BY FLOOR', s: S.TITLE }]);
    rows.push([{ v: 'Basis: ' + result.basisLabel +
      (result.selfWeight ? ' · self weight included' : ' · applied loads only'), s: S.NOTE }]);
    rows.push([{ v: 'Read from the loads assigned in the model. Nothing is analysed and no load is redistributed.', s: S.NOTE }]);
    rows.push([]);
    rows.push([
      { v: 'Storey', s: S.HEADER }, { v: 'Slab max (kN/m²)', s: S.HEADER },
      { v: 'Slab avg (kN/m²)', s: S.HEADER }, { v: 'Beam max (kN/m)', s: S.HEADER },
      { v: 'Beam avg (kN/m)', s: S.HEADER }, { v: 'Slab area (m²)', s: S.HEADER },
      { v: 'Total load (kN)', s: S.HEADER }
    ]);
    var headerRow = rows.length;

    result.floors.forEach(function (f) {
      rows.push([
        { v: f.name },
        { v: f.slabMax, s: S.DEC2 }, { v: f.slabAvg, s: S.DEC2 },
        { v: f.beamMax, s: S.DEC2 }, { v: f.beamAvg, s: S.DEC2 },
        { v: f.slabArea, s: S.DEC2 }, { v: f.totalKN, s: S.DEC2 }
      ]);
    });

    var first = headerRow + 1, last = headerRow + result.floors.length;
    if (result.floors.length) {
      rows.push([
        { v: 'Building', s: S.SUBHEAD },
        { f: 'MAX(B' + first + ':B' + last + ')', s: S.DEC2 },
        { f: 'IFERROR(SUMPRODUCT(C' + first + ':C' + last + ',F' + first + ':F' + last +
             ')/SUM(F' + first + ':F' + last + '),0)', s: S.DEC2 },
        { f: 'MAX(D' + first + ':D' + last + ')', s: S.DEC2 },
        { v: '', s: S.DEC2 },
        { f: 'SUM(F' + first + ':F' + last + ')', s: S.DEC2 },
        { f: 'SUM(G' + first + ':G' + last + ')', s: S.DEC2 }
      ]);
    }
    rows.push([]);
    rows.push([{ v: 'Slab averages are weighted by area; the building slab average is recomputed live above.', s: S.NOTE }]);

    rows.push([]);
    rows.push([{ v: 'WHAT MAKES UP THE LOAD', s: S.SUBHEAD }]);
    rows.push([{ v: 'Pattern', s: S.HEADER }, { v: 'Kind', s: S.HEADER },
               { v: 'Factor', s: S.HEADER }, { v: 'Total (kN)', s: S.HEADER }]);
    result.patterns.forEach(function (p) {
      rows.push([{ v: p.name }, { v: p.kind }, { v: p.factor, s: S.DEC2 }, { v: p.totalKN, s: S.DEC2 }]);
    });

    rows.push([]);
    rows.push([{ v: 'SEISMIC WEIGHT — IS 1893:2016 Cl 7.3', s: S.SUBHEAD }]);
    rows.push([{ v: 'Full dead load, plus ¼ of imposed load up to 3 kN/m² and ½ above; roof imposed load ' +
      'excluded; each storey\u2019s columns and walls shared half above and half below.', s: S.NOTE }]);
    rows.push([{ v: 'Storey', s: S.HEADER }, { v: 'Dead (kN)', s: S.HEADER },
               { v: 'Structure (kN)', s: S.HEADER }, { v: 'Imposed (kN)', s: S.HEADER },
               { v: 'Counted imposed (kN)', s: S.HEADER }, { v: 'W (kN)', s: S.HEADER }]);
    var seisFirst = rows.length + 1;
    result.floors.forEach(function (f) {
      var rr = rows.length + 1;
      rows.push([{ v: f.name }, { v: f.deadKN, s: S.DEC2 }, { v: f.structureKN, s: S.DEC2 },
        { v: f.liveKN, s: S.DEC2 }, { v: f.seismicLive || 0, s: S.DEC2 },
        { f: 'B' + rr + '+C' + rr + '+E' + rr, s: S.DEC2 }]);
    });
    var seisLast = rows.length;
    rows.push([{ v: 'Total W', s: S.SUBHEAD }, { v: '' }, { v: '' }, { v: '' }, { v: '' },
      { f: 'SUM(F' + seisFirst + ':F' + seisLast + ')', s: S.DEC2 }]);

    rows.push([]);
    rows.push([{ v: 'STRUCTURE SELF WEIGHT (carried, not applied)', s: S.SUBHEAD }]);
    rows.push([{ v: 'Columns and braces (kN)' }, { v: result.structure.columnKN, s: S.DEC2 }]);
    rows.push([{ v: 'Walls (kN)' }, { v: result.structure.wallKN, s: S.DEC2 }]);
    rows.push([{ v: 'Point loads on joints (kN)' }, { v: result.pointKN, s: S.DEC2 }]);

    return { sheet: { name: NAME, rows: rows, widths: [26, 16, 16, 16, 20, 16], freeze: headerRow } };
  }

  function buildLoadElements(model, result) {
    var S = xlsx().S;
    var NAME = 'Loads by element';
    var rows = [];

    rows.push([{ v: 'LOAD BY ELEMENT', s: S.TITLE }]);
    rows.push([{ v: 'Intensity is per m² for slabs and per m for beams. Total = intensity × area or length.', s: S.NOTE }]);
    rows.push([]);
    rows.push([
      { v: 'Element', s: S.HEADER }, { v: 'Type', s: S.HEADER }, { v: 'Storey', s: S.HEADER },
      { v: 'Section', s: S.HEADER }, { v: 'Intensity', s: S.HEADER }, { v: 'Unit', s: S.HEADER },
      { v: 'Area / length', s: S.HEADER }, { v: 'Total (kN)', s: S.HEADER },
      { v: 'Made up of', s: S.HEADER }
    ]);
    var headerRow = rows.length;

    model.elements.forEach(function (e, i) {
      if (!global.ETABSLoads.carries(e)) return;
      var isArea = e.kind === 'area';
      var extent = isArea ? (e.planArea || 0) : (e.length || 0);
      var r = rows.length + 1;
      rows.push([
        { v: e.name || ('#' + e.id) }, { v: e.type }, { v: e.story || '' },
        { v: e.section || '' },
        { v: result.values[i], s: S.DEC2 },
        { v: isArea ? 'kN/m²' : 'kN/m' },
        { v: extent, s: S.DEC2 },
        { f: 'E' + r + '*G' + r, s: S.DEC2 },
        { v: (result.breakdown[e.id] || []).map(function (p) {
          return p.label + ' ' + (Math.round(p.value * 100) / 100);
        }).join('; ') }
      ]);
    });

    return { sheet: { name: NAME, rows: rows, widths: [18, 12, 18, 18, 12, 9, 14, 13, 40], freeze: headerRow } };
  }

  /* ------------------------------------------------------------------ */
  /* Reinforcement — measured from the drawn bars                        */
  /* ------------------------------------------------------------------ */

  function buildBbs(result) {
    var S = xlsx().S;
    var NAME = 'Bar Schedule';
    var rows = [];
    var set = result.settings;

    rows.push([{ v: 'BAR BENDING SCHEDULE', s: S.TITLE }]);
    rows.push([{ v: 'Grade ' + set.grade + '. Columns follow the bar pattern written in the model file; ' +
      'beams, slabs and walls follow the percentages and spacings set in the viewer.', s: S.NOTE }]);
    rows.push([{ v: 'Indicative detailing for quantity purposes — not a design and not a substitute for a detailer.', s: S.NOTE }]);
    rows.push([]);
    rows.push([
      { v: 'Mark', s: S.HEADER }, { v: 'Member', s: S.HEADER }, { v: 'Section', s: S.HEADER },
      { v: 'Bar type', s: S.HEADER }, { v: 'Shape', s: S.HEADER }, { v: 'Dia (mm)', s: S.HEADER },
      { v: 'Cutting length (m)', s: S.HEADER }, { v: 'Number', s: S.HEADER },
      { v: 'kg/m', s: S.HEADER }, { v: 'Weight (kg)', s: S.HEADER }
    ]);
    var headerRow = rows.length;

    result.bbs.forEach(function (r) {
      var rr = rows.length + 1;
      rows.push([
        { v: r.mark }, { v: r.member }, { v: r.section }, { v: r.kind }, { v: r.shape },
        { v: r.dia }, { v: r.cutting, s: S.DEC3 }, { v: r.count },
        { v: (r.dia * r.dia) / 162, s: S.DEC3 },
        { f: 'G' + rr + '*H' + rr + '*I' + rr, s: S.DEC2 }
      ]);
    });
    var last = rows.length;
    rows.push([{ v: 'Total', s: S.SUBHEAD }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' },
      { v: '' }, { f: 'SUM(H' + (headerRow + 1) + ':H' + last + ')', s: S.DEC2 }, { v: '' },
      { f: 'SUM(J' + (headerRow + 1) + ':J' + last + ')', s: S.DEC2 }]);

    return { sheet: { name: NAME, rows: rows, widths: [10, 12, 18, 10, 9, 10, 17, 11, 10, 14], freeze: headerRow } };
  }

  function buildSteelSummary(result) {
    var S = xlsx().S;
    var NAME = 'Steel Summary';
    var rows = [];
    var t = result.totals, set = result.settings;

    rows.push([{ v: 'REINFORCEMENT SUMMARY', s: S.TITLE }]);
    rows.push([{ v: 'Every shaded figure below comes from the bars drawn in the model, not from a kg/m³ assumption.', s: S.NOTE }]);
    rows.push([]);
    rows.push([{ v: 'BY DIAMETER', s: S.SUBHEAD }]);
    rows.push([{ v: 'Dia (mm)', s: S.HEADER }, { v: 'Bars', s: S.HEADER },
               { v: 'Length (m)', s: S.HEADER }, { v: 'Weight (kg)', s: S.HEADER }]);
    var diaFirst = rows.length + 1;
    result.byDia.forEach(function (d) {
      rows.push([{ v: d.dia }, { v: d.count }, { v: d.lengthM, s: S.DEC2 }, { v: d.kg, s: S.DEC2 }]);
    });
    var diaLast = rows.length;
    rows.push([{ v: 'Total', s: S.SUBHEAD }, { f: 'SUM(B' + diaFirst + ':B' + diaLast + ')' },
      { f: 'SUM(C' + diaFirst + ':C' + diaLast + ')', s: S.DEC2 },
      { f: 'SUM(D' + diaFirst + ':D' + diaLast + ')', s: S.DEC2 }]);

    rows.push([]);
    rows.push([{ v: 'BY MEMBER TYPE', s: S.SUBHEAD }]);
    rows.push([{ v: 'Type', s: S.HEADER }, { v: 'Weight (kg)', s: S.HEADER },
               { v: 'Concrete (m³)', s: S.HEADER }, { v: 'kg per m³', s: S.HEADER }]);
    result.byType.forEach(function (x) {
      var rr = rows.length + 1;
      rows.push([{ v: x.type }, { v: x.kg, s: S.DEC2 }, { v: x.volume, s: S.DEC3 },
        { f: 'IFERROR(B' + rr + '/C' + rr + ',0)', s: S.DEC2 }]);
    });

    rows.push([]);
    rows.push([{ v: 'BY FLOOR', s: S.SUBHEAD }]);
    rows.push([{ v: 'Storey', s: S.HEADER }, { v: 'Bars', s: S.HEADER }, { v: 'Weight (kg)', s: S.HEADER }]);
    result.byFloor.forEach(function (f) {
      rows.push([{ v: f.name }, { v: f.bars }, { v: f.kg, s: S.DEC2 }]);
    });

    rows.push([]);
    rows.push([{ v: 'ORDER QUANTITY', s: S.SUBHEAD }]);
    rows.push([{ v: 'Net bar weight (kg)' }, { v: t.netKg, s: S.DEC2 }]);
    rows.push([{ v: 'Laps — ' + global.ETABSRebar.lapDescription(set) + ', over ' + set.stockLength + ' m (kg)' },
      { v: t.lapKg, s: S.DEC2 }]);
    rows.push([{ v: 'Wastage ' + set.wastagePercent + '% (kg)' }, { v: t.wastageKg, s: S.DEC2 }]);
    rows.push([{ v: 'Chairs, spacers, binding ' + set.accessoriesPercent + '% (kg)' }, { v: t.accessoriesKg, s: S.DEC2 }]);
    var gr = rows.length + 1;
    rows.push([{ v: 'Total to order (kg)', s: S.SUBHEAD }, { f: 'SUM(B' + (gr - 4) + ':B' + (gr - 1) + ')', s: S.DEC2 }]);
    rows.push([{ v: 'Tonnes' }, { f: 'B' + gr + '/1000', s: S.DEC3 }]);
    rows.push([{ v: 'Steel per m³ of concrete (kg)' }, { v: t.kgPerM3, s: S.DEC2 }]);
    rows.push([{ v: 'Grade' }, { v: set.grade }]);

    return { sheet: { name: NAME, rows: rows, widths: [34, 16, 16, 14], freeze: 5 } };
  }

  function workbook(opts) {
    var model = opts.model;
    var quantities = opts.quantities;
    var settings = opts.settings;
    var stats = opts.stats;
    var basis = opts.basis || '';
    var sym = global.ETABSCosting.symbolOf(settings);

    var rate = buildRateCard(quantities, settings);
    var concrete = buildConcrete(quantities, model);
    var rebar = buildRebar(quantities, settings, rate.refs);
    var steel = buildSteel(quantities);

    var refs = {
      rate: rate.refs,
      concrete: concrete.refs,
      rebar: rebar.refs,
      steel: steel.refs
    };

    var boq = buildBoq(quantities, settings, refs, basis, sym);
    refs.boq = boq.refs;

    var byStorey = buildByStorey(quantities, model, boq.refs, stats);
    var summary = buildSummary(model, stats, quantities, refs, settings, basis, opts.brand);
    var elements = buildElements(model, opts.ids, opts.Units);

    var sheets = [
      summary.sheet, boq.sheet, rate.sheet,
      concrete.sheet, rebar.sheet, steel.sheet,
      byStorey.sheet, elements.sheet
    ];
    if (opts.loads) {
      sheets.push(buildLoadFloors(opts.loads).sheet);
      sheets.push(buildLoadElements(model, opts.loads).sheet);
    }
    if (opts.rebar) {
      sheets.push(buildSteelSummary(opts.rebar).sheet);
      sheets.push(buildBbs(opts.rebar).sheet);
    }
    return xlsx().build(sheets, { currencySymbol: sym });
  }

  global.ETABSBOQ = { workbook: workbook };
})(window);
