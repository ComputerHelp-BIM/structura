/**
 * costing.js — Reinforcement estimation, rate card and BOQ build-up.
 * =================================================================
 * An .e2k describes geometry, not reinforcement and not money. Everything in
 * this module is therefore an *estimate built on rates the user controls*,
 * and it is labelled that way everywhere it surfaces. The default rates
 * below are placeholders so the feature works out of the box — they are not
 * a price list, and the UI says so next to every total.
 *
 * Namespace: window.ETABSCosting
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'structura.costing';

  /* ------------------------------------------------------------------ */
  /* Defaults — placeholders, meant to be replaced                       */
  /* ------------------------------------------------------------------ */

  var DEFAULTS = {
    currency: 'INR',
    indianFormat: true,

    /** kg of reinforcement per m³ of concrete, by element type. */
    rebarRates: {
      Column: 180,
      Beam: 130,
      Slab: 85,
      Wall: 100,
      Ramp: 90,
      Other: 120
    },

    /** Typical ranges used only to flag a rate that looks unusual. */
    rebarBands: {
      Column: [120, 250],
      Beam: [90, 200],
      Slab: [60, 120],
      Wall: [70, 160],
      Ramp: [60, 140],
      Other: [60, 250]
    },

    /** Cost per unit. Concrete is per m³ by grade, with a fallback. */
    concreteRates: { _default: 7000 },
    rebarRatePerTonne: 85000,
    steelRatePerTonne: 95000,
    formworkRatePerM2: 650,

    /** Percentage added to each material for wastage. */
    wastage: { concrete: 3, rebar: 3, steel: 5, formwork: 10 },
    contingency: 5,

    rebarEnabled: true,
    costEnabled: true
  };

  var CURRENCIES = {
    INR: { symbol: '₹', code: 'INR', locale: 'en-IN' },
    USD: { symbol: '$', code: 'USD', locale: 'en-US' },
    GBP: { symbol: '£', code: 'GBP', locale: 'en-GB' },
    EUR: { symbol: '€', code: 'EUR', locale: 'de-DE' },
    AED: { symbol: 'AED ', code: 'AED', locale: 'en-AE' }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { s = null; }
    var out = clone(DEFAULTS);
    if (s) {
      Object.keys(s).forEach(function (k) {
        if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) {
          out[k] = Object.assign(out[k] || {}, s[k]);
        } else out[k] = s[k];
      });
    }
    return out;
  }

  function save(settings) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
    return clone(DEFAULTS);
  }

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Indian numbering puts a break after the first three digits and every two
   * thereafter, which `en-IN` already does — but lakh/crore wording is what
   * people actually read on a summary line, so it is offered separately.
   */
  function money(value, settings, compact) {
    var cur = CURRENCIES[settings.currency] || CURRENCIES.INR;
    if (!isFinite(value)) value = 0;

    if (compact && settings.currency === 'INR' && settings.indianFormat) {
      if (Math.abs(value) >= 1e7) return cur.symbol + (value / 1e7).toFixed(2) + ' Cr';
      if (Math.abs(value) >= 1e5) return cur.symbol + (value / 1e5).toFixed(2) + ' L';
    }
    if (compact && Math.abs(value) >= 1e6) return cur.symbol + (value / 1e6).toFixed(2) + 'M';

    try {
      return cur.symbol + value.toLocaleString(cur.locale, {
        minimumFractionDigits: 0, maximumFractionDigits: 0
      });
    } catch (e) {
      return cur.symbol + Math.round(value).toString();
    }
  }

  function symbolOf(settings) {
    return (CURRENCIES[settings.currency] || CURRENCIES.INR).symbol;
  }

  /* ------------------------------------------------------------------ */
  /* Reinforcement estimate                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Distribute rebar over the concrete volume that actually exists, by
   * element type, so changing the column rate only moves the column line.
   * @returns {{byType, totalTonnes, warnings}}
   */
  /**
   * Reinforcement tonnage. With no measured steel this is the old estimate:
   * concrete volume × an assumed kg/m³. When the viewer has actually drawn
   * the bars, `measured` carries real kilograms per element type and those
   * replace the assumption — each row says which it is, because a measured
   * figure and an assumed one should never be mistaken for each other.
   */
  function rebar(quantities, settings, measured) {
    var byType = {};
    var total = 0;
    var warnings = [];

    /* Measured steel from the detailed cage replaces the assumed kg/m³ for
     * the types that were detailed. Volume that was NOT detailed — steel
     * members carry no cage, and the panel can have slabs or walls switched
     * off — still has to be priced, so the shortfall falls back to the
     * assumed rate rather than silently dropping out of the bill. */
    var measuredVol = {};
    if (measured && measured.byType && measured.byType.length) {
      measured.byType.forEach(function (m) {
        if (!m.kg) return;
        measuredVol[m.type] = (measuredVol[m.type] || 0) + (m.volume || 0);
        byType[m.type] = {
          type: m.type, volume: m.volume || 0,
          rate: m.volume > 0 ? Math.round(m.kg / m.volume) : 0,
          tonnes: m.kg / 1000, measured: true
        };
        total += m.kg / 1000;
      });
    }

    /* Volume still to price at the assumed rate, type by type. */
    var remaining = {};
    quantities.concrete.forEach(function (grade) {
      Object.keys(grade.byType).forEach(function (type) {
        remaining[type] = (remaining[type] || 0) + (grade.byType[type] || 0);
      });
    });
    Object.keys(measuredVol).forEach(function (type) {
      remaining[type] = Math.max(0, (remaining[type] || 0) - measuredVol[type]);
    });

    quantities.concrete.forEach(function (grade) {
      Object.keys(grade.byType).forEach(function (type) {
        var share = grade.byType[type];
        if (!share) return;
        // Spread the undetailed remainder across the grades in proportion.
        var gross = 0;
        quantities.concrete.forEach(function (g) { gross += (g.byType[type] || 0); });
        var volume = gross > 0 ? remaining[type] * (share / gross) : 0;
        // Measured and gross volumes come from different passes over the same
        // geometry, so ignore a rounding crumb rather than printing a 0 t row.
        if (volume <= 0.01 * (measuredVol[type] || 0) || volume <= 0.05) return;
        var rate = settings.rebarRates[type];
        if (rate === undefined) rate = settings.rebarRates.Other;
        var tonnes = volume * rate / 1000;
        var key = byType[type] && byType[type].measured ? type + ' (not detailed)' : type;
        var row = byType[key] ||
          (byType[key] = { type: key, volume: 0, rate: rate, tonnes: 0, assumedFor: type });
        row.volume += volume;
        row.tonnes += tonnes;
        total += tonnes;
      });
    });

    Object.keys(byType).forEach(function (type) {
      var band = settings.rebarBands[byType[type].assumedFor || type];
      var rate = byType[type].rate;
      if (band && (rate < band[0] || rate > band[1])) {
        warnings.push(type + ' rate of ' + rate + ' kg/m³ is outside the usual ' +
          band[0] + '–' + band[1] + ' kg/m³ range.');
      }
    });

    var rows = Object.keys(byType).map(function (k) { return byType[k]; })
      .sort(function (a, b) { return b.tonnes - a.tonnes; });
    return {
      byType: rows,
      totalTonnes: total,
      warnings: warnings,
      measured: rows.some(function (r) { return r.measured; })
    };
  }

  /* ------------------------------------------------------------------ */
  /* Bill build-up                                                       */
  /* ------------------------------------------------------------------ */

  function concreteRate(grade, settings) {
    var r = settings.concreteRates[grade];
    return (r === undefined || r === null || r === '') ? settings.concreteRates._default : r;
  }

  /**
   * @param {Object} quantities Output of ETABSAnalysis.quantities
   * @param {Object} settings
   * @param {{builtUpArea:number, storeys:Array}} context
   * @returns {Object} bill with lines, totals, per-storey and per-m² figures
   */
  function bill(quantities, settings, context) {
    var lines = [];
    var reo = rebar(quantities, settings, context && context.measuredSteel);

    quantities.concrete.forEach(function (c) {
      var rate = concreteRate(c.grade, settings);
      lines.push({
        group: 'Concrete',
        item: 'Concrete ' + c.grade,
        qty: c.volume,
        unit: 'm³',
        rate: rate,
        wastagePct: settings.wastage.concrete,
        key: 'concrete:' + c.grade
      });
    });

    if (settings.rebarEnabled) {
      reo.byType.forEach(function (r) {
        lines.push({
          group: 'Reinforcement',
          item: 'Reinforcement — ' + r.type + ' (' + r.rate + ' kg/m³' +
            (r.measured ? ', measured from bars' : ', assumed') + ')',
          qty: r.tonnes,
          unit: 't',
          rate: settings.rebarRatePerTonne,
          wastagePct: settings.wastage.rebar,
          estimated: !r.measured,
          measured: !!r.measured,
          key: 'rebar:' + r.type
        });
      });
    }

    if (quantities.totals.steelTonnes > 0) {
      var bySection = {};
      quantities.steel.forEach(function (s) {
        var family = s.section;
        bySection[family] = (bySection[family] || 0) + s.tonnes;
      });
      Object.keys(bySection).forEach(function (sec) {
        lines.push({
          group: 'Structural steel',
          item: 'Structural steel — ' + sec,
          qty: bySection[sec],
          unit: 't',
          rate: settings.steelRatePerTonne,
          wastagePct: settings.wastage.steel,
          key: 'steel:' + sec
        });
      });
    }

    lines.push({
      group: 'Formwork',
      item: 'Formwork / shuttering',
      qty: quantities.totals.formwork,
      unit: 'm²',
      rate: settings.formworkRatePerM2,
      wastagePct: settings.wastage.formwork,
      key: 'formwork'
    });

    lines.forEach(function (l) {
      l.grossQty = l.qty * (1 + (l.wastagePct || 0) / 100);
      l.amount = l.grossQty * l.rate;
    });

    var subtotal = lines.reduce(function (a, l) { return a + l.amount; }, 0);
    var contingency = subtotal * (settings.contingency || 0) / 100;
    var total = subtotal + contingency;

    var builtUp = context && context.builtUpArea ? context.builtUpArea : 0;
    var perStorey = buildPerStorey(quantities, settings, reo, total, subtotal);

    return {
      lines: lines,
      rebar: reo,
      subtotal: subtotal,
      contingency: contingency,
      contingencyPct: settings.contingency || 0,
      total: total,
      builtUpArea: builtUp,
      perM2: builtUp > 0 ? total / builtUp : null,
      perStorey: perStorey,
      settings: settings,
      warnings: reo.warnings.concat(quantities.missingDensity.length
        ? ['No density stated for ' + quantities.missingDensity.join(', ') +
           ' — structural steel mass for those sections counts as zero.']
        : [])
    };
  }

  /**
   * Allocate cost down the building using each storey's share of concrete
   * volume — the only split the geometry actually supports. Stated as such.
   */
  function buildPerStorey(quantities, settings, reo, total, subtotal) {
    var byStorey = {};
    quantities.concrete.forEach(function (c) {
      Object.keys(c.byStorey).forEach(function (s) {
        byStorey[s] = (byStorey[s] || 0) + c.byStorey[s];
      });
    });
    var sum = Object.keys(byStorey).reduce(function (a, k) { return a + byStorey[k]; }, 0) || 1;
    return Object.keys(byStorey).map(function (name) {
      var share = byStorey[name] / sum;
      return {
        storey: name,
        concrete: byStorey[name],
        share: share,
        cost: total * share
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Scope description — every total states what it counted               */
  /* ------------------------------------------------------------------ */

  var SCOPES = [
    { id: 'all', label: 'Whole model' },
    { id: 'visible', label: 'Visible only' },
    { id: 'selection', label: 'Current selection' },
    { id: 'storey', label: 'Chosen storey range' }
  ];

  function describeScope(scopeId, detail) {
    switch (scopeId) {
      case 'visible': return 'Counted every element currently visible (' + detail + ').';
      case 'selection': return 'Counted only the current selection (' + detail + ').';
      case 'storey': return 'Counted storeys ' + detail + ' only.';
      default: return 'Counted every element in the model (' + detail + ').';
    }
  }

  /* ------------------------------------------------------------------ */
  /* CSV                                                                 */
  /* ------------------------------------------------------------------ */

  function billCsv(billData, model, basis) {
    var s = billData.settings;
    var sym = symbolOf(s);
    var rows = [];
    rows.push(['BILL OF QUANTITIES — ' + (model.meta.title || model.meta.fileName)]);
    rows.push(['Generated', new Date().toISOString()]);
    rows.push(['Basis', basis || '']);
    rows.push(['Currency', s.currency]);
    rows.push(['NOTE', 'Reinforcement and all rates are estimates from the user-set rate card, not from the model file.']);
    rows.push([]);
    rows.push(['Group', 'Item', 'Net qty', 'Unit', 'Wastage %', 'Gross qty', 'Rate (' + sym + ')', 'Amount (' + sym + ')']);
    billData.lines.forEach(function (l) {
      rows.push([l.group, l.item, l.qty.toFixed(3), l.unit, l.wastagePct,
        l.grossQty.toFixed(3), l.rate, Math.round(l.amount)]);
    });
    rows.push([]);
    rows.push(['', 'Subtotal', '', '', '', '', '', Math.round(billData.subtotal)]);
    rows.push(['', 'Contingency @ ' + billData.contingencyPct + '%', '', '', '', '', '', Math.round(billData.contingency)]);
    rows.push(['', 'TOTAL', '', '', '', '', '', Math.round(billData.total)]);
    if (billData.perM2) {
      rows.push(['', 'Cost per m² built-up', '', '', '', '', '', Math.round(billData.perM2)]);
    }
    rows.push([]);
    rows.push(['COST BY STOREY (allocated on concrete volume share)']);
    rows.push(['Storey', 'Concrete (m³)', 'Share %', 'Cost (' + sym + ')']);
    billData.perStorey.forEach(function (p) {
      rows.push([p.storey, p.concrete.toFixed(2), (p.share * 100).toFixed(1), Math.round(p.cost)]);
    });
    if (billData.warnings.length) {
      rows.push([]);
      rows.push(['WARNINGS']);
      billData.warnings.forEach(function (w) { rows.push(['', w]); });
    }
    return rows;
  }

  global.ETABSCosting = {
    DEFAULTS: DEFAULTS,
    CURRENCIES: CURRENCIES,
    SCOPES: SCOPES,
    load: load,
    save: save,
    reset: reset,
    money: money,
    symbolOf: symbolOf,
    rebar: rebar,
    bill: bill,
    billCsv: billCsv,
    concreteRate: concreteRate,
    describeScope: describeScope
  };
})(window);
