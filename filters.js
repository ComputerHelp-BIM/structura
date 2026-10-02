/**
 * filters.js — Element search, multi-criteria filtering, saved sets.
 * =================================================================
 * A filter is a list of conditions ANDed together. Each condition names a
 * field, an operator and a value; the engine compiles them once into a
 * predicate rather than interpreting the rule list per element, which keeps
 * a filter over 200 000 members interactive.
 *
 * Namespace: window.ETABSFilters
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Field definitions                                                   */
  /* ------------------------------------------------------------------ */

  var FIELDS = [
    { id: 'type',     label: 'Element type', kind: 'enum',   get: function (e) { return e.type; } },
    { id: 'section',  label: 'Section',      kind: 'text',   get: function (e) { return e.section || ''; } },
    { id: 'material', label: 'Material',     kind: 'enum',   get: function (e) { return e.material || ''; } },
    { id: 'story',    label: 'Storey',       kind: 'enum',   get: function (e) { return e.story || ''; } },
    { id: 'storeyNo', label: 'Storey number', kind: 'number', get: function (e) { return e.storyIndex; } },
    { id: 'name',     label: 'Element name', kind: 'text',   get: function (e) { return e.name || ''; } },
    { id: 'length',   label: 'Length (m)',   kind: 'number', get: function (e) { return e.length || 0; } },
    { id: 'volume',   label: 'Volume (m³)',  kind: 'number', get: function (e) { return e.volume || 0; } },
    { id: 'area',     label: 'Area (m²)',    kind: 'number', get: function (e) { return e.planArea || 0; } },
    { id: 'thickness', label: 'Thickness (m)', kind: 'number', get: function (e) { return e.thickness || 0; } },
    { id: 'elevation', label: 'Elevation (m)', kind: 'number', get: function (e) {
        return e.kind === 'frame' ? Math.max(e.a[2], e.b[2])
          : (e.kind === 'area' ? e.pts[0][2] : e.p[2]);
      } },
    { id: 'family',   label: 'Section shape', kind: 'enum',  get: function (e) { return e.sectionFamily || ''; } },
    { id: 'load',     label: 'Load intensity', kind: 'number', get: function (e) {
        // kN/m² for slabs, kN/m for beams — whatever the load map is showing.
        var S = global.APP && global.APP.S;
        var r = S && S.load && S.load.result;
        return r ? (r.values[e.id] || 0) : 0;
      } },
    { id: 'pier',     label: 'Pier label',   kind: 'text',   get: function (e) { return e.pier || ''; } },
    { id: 'spandrel', label: 'Spandrel label', kind: 'text', get: function (e) { return e.spandrel || ''; } }
  ];

  var OPERATORS = {
    text:   [
      { id: 'contains', label: 'contains' },
      { id: 'is', label: 'is exactly' },
      { id: 'starts', label: 'starts with' },
      { id: 'not', label: 'does not contain' },
      { id: 'empty', label: 'is empty', noValue: true }
    ],
    enum:   [
      { id: 'is', label: 'is' },
      { id: 'isnot', label: 'is not' },
      { id: 'contains', label: 'contains' }
    ],
    number: [
      { id: 'gt', label: 'greater than' },
      { id: 'lt', label: 'less than' },
      { id: 'eq', label: 'equals' },
      { id: 'between', label: 'between', twoValues: true }
    ]
  };

  function fieldById(id) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].id === id) return FIELDS[i];
    return FIELDS[0];
  }

  /* ------------------------------------------------------------------ */
  /* Compilation                                                         */
  /* ------------------------------------------------------------------ */

  function compileCondition(cond) {
    var field = fieldById(cond.field);
    var get = field.get;
    var op = cond.op;
    var raw = cond.value;

    if (field.kind === 'number') {
      var a = parseFloat(raw);
      var b = parseFloat(cond.value2);
      if (!isFinite(a)) a = 0;
      if (!isFinite(b)) b = Infinity;
      switch (op) {
        case 'lt': return function (e) { return get(e) < a; };
        case 'eq': return function (e) { return Math.abs(get(e) - a) < 1e-6; };
        case 'between': return function (e) { var v = get(e); return v >= Math.min(a, b) && v <= Math.max(a, b); };
        default: return function (e) { return get(e) > a; };
      }
    }

    var needle = String(raw === undefined ? '' : raw).toLowerCase();
    switch (op) {
      case 'is': return function (e) { return String(get(e)).toLowerCase() === needle; };
      case 'isnot': return function (e) { return String(get(e)).toLowerCase() !== needle; };
      case 'starts': return function (e) { return String(get(e)).toLowerCase().indexOf(needle) === 0; };
      case 'not': return function (e) { return String(get(e)).toLowerCase().indexOf(needle) < 0; };
      case 'empty': return function (e) { return !String(get(e) || '').trim(); };
      default: return function (e) { return String(get(e)).toLowerCase().indexOf(needle) >= 0; };
    }
  }

  /**
   * @param {Array<{field,op,value,value2}>} conditions
   * @returns {function(Object): boolean}
   */
  function compile(conditions) {
    var tests = (conditions || []).filter(function (c) { return c && c.field; }).map(compileCondition);
    if (!tests.length) return function () { return true; };
    return function (e) {
      for (var i = 0; i < tests.length; i++) if (!tests[i](e)) return false;
      return true;
    };
  }

  function run(model, conditions) {
    var test = compile(conditions);
    var out = [];
    var els = model.elements;
    for (var i = 0; i < els.length; i++) if (test(els[i])) out.push(i);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Quick search                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * One box, no syntax. Matches an element's name, section, material, storey
   * or type, and understands a couple of natural shorthands engineers type
   * without thinking: "story 5", "> 6m", "M40".
   */
  function quickSearch(model, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return { ids: [], summary: '' };

    var lengthMatch = q.match(/^([<>])\s*([\d.]+)\s*m?$/);
    if (lengthMatch) {
      var limit = parseFloat(lengthMatch[2]);
      var gt = lengthMatch[1] === '>';
      var ids = [];
      model.elements.forEach(function (e) {
        if (e.kind !== 'frame') return;
        if (gt ? e.length > limit : e.length < limit) ids.push(e.id);
      });
      return { ids: ids, summary: 'members ' + (gt ? 'longer' : 'shorter') + ' than ' + limit + ' m' };
    }

    var storeyMatch = q.match(/^(?:storey|story|level|floor)\s*(\w+)$/);
    if (storeyMatch) {
      var want = storeyMatch[1];
      var sIds = [];
      model.elements.forEach(function (e) {
        var s = String(e.story || '').toLowerCase();
        if (s === want || s === 'story' + want || s === 'storey' + want || s.indexOf(want) >= 0) sIds.push(e.id);
      });
      return { ids: sIds, summary: 'elements on storey matching “' + want + '”' };
    }

    var hits = [];
    model.elements.forEach(function (e) {
      var hay = (e.name + ' ' + e.section + ' ' + e.material + ' ' + e.story + ' ' + e.type).toLowerCase();
      if (hay.indexOf(q) >= 0) hits.push(e.id);
    });
    return { ids: hits, summary: 'matching “' + query + '”' };
  }

  /* ------------------------------------------------------------------ */
  /* Select similar                                                      */
  /* ------------------------------------------------------------------ */

  var SIMILAR = {
    section:  function (a, b) { return a.section === b.section; },
    material: function (a, b) { return a.material === b.material; },
    story:    function (a, b) { return a.story === b.story; },
    type:     function (a, b) { return a.type === b.type; },
    length:   function (a, b) { return a.kind === 'frame' && b.kind === 'frame' && Math.abs(a.length - b.length) < 0.02; }
  };

  function selectSimilar(model, elementId, by) {
    var src = model.elements[elementId];
    if (!src) return [];
    var test = SIMILAR[by] || SIMILAR.section;
    var out = [];
    model.elements.forEach(function (e) { if (test(src, e)) out.push(e.id); });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Distinct values, for building the pickers                           */
  /* ------------------------------------------------------------------ */

  function distinct(model, fieldId) {
    var field = fieldById(fieldId);
    var seen = {};
    model.elements.forEach(function (e) {
      var v = field.get(e);
      if (v === '' || v === undefined || v === null) return;
      seen[v] = (seen[v] || 0) + 1;
    });
    return Object.keys(seen).sort().map(function (k) { return { value: k, count: seen[k] }; });
  }

  /* ------------------------------------------------------------------ */
  /* Saved sets                                                          */
  /* ------------------------------------------------------------------ */

  var STORE_KEY = 'structura.filterSets';

  function loadSets() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveSets(sets) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(sets)); } catch (e) { /* private mode */ }
  }

  /** Saved sets store the *rule*, not the element ids, so they carry to any model. */
  function addSet(name, conditions) {
    var sets = loadSets();
    var existing = sets.filter(function (s) { return s.name === name; })[0];
    if (existing) existing.conditions = conditions;
    else sets.push({ name: name, conditions: conditions, created: Date.now() });
    saveSets(sets);
    return sets;
  }

  function removeSet(name) {
    var sets = loadSets().filter(function (s) { return s.name !== name; });
    saveSets(sets);
    return sets;
  }

  function describe(conditions) {
    if (!conditions || !conditions.length) return 'everything';
    return conditions.map(function (c) {
      var f = fieldById(c.field);
      var ops = OPERATORS[f.kind];
      var opLabel = (ops.filter(function (o) { return o.id === c.op; })[0] || ops[0]).label;
      if (c.op === 'empty') return f.label + ' ' + opLabel;
      if (c.op === 'between') return f.label + ' ' + opLabel + ' ' + c.value + ' and ' + c.value2;
      return f.label + ' ' + opLabel + ' ' + c.value;
    }).join(' · and · ');
  }

  global.ETABSFilters = {
    FIELDS: FIELDS,
    OPERATORS: OPERATORS,
    fieldById: fieldById,
    compile: compile,
    run: run,
    quickSearch: quickSearch,
    selectSimilar: selectSimilar,
    SIMILAR_KEYS: Object.keys(SIMILAR),
    distinct: distinct,
    loadSets: loadSets,
    addSet: addSet,
    removeSet: removeSet,
    describe: describe
  };
})(window);
