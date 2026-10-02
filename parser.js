/**
 * parser.js — ETABS / SAP2000 model readers.
 * =================================================================
 * Supported inputs
 *   .e2k / .$et      ETABS text model   — full keyword grammar
 *   .s2k / .$2k      SAP2000 text model — TABLE: grammar
 *   .csv / .txt      ETABS table export — auto-detected table blocks
 *   .xlsx            ETABS table export — via lazily loaded SheetJS
 *   .edb / .ebk      proprietary binary — detected, probed, never faked
 *
 * Everything is normalised to SI internally: lengths in metres, forces in
 * kilonewtons. The file's declared units are kept in `meta.units` so the
 * UI can present any unit system without a second parse.
 *
 * Namespace: window.ETABSParser
 */
(function (global) {
  'use strict';

  var LENGTH_TO_M = { MM: 0.001, CM: 0.01, M: 1, IN: 0.0254, FT: 0.3048 };
  var FORCE_TO_KN = {
    N: 0.001, KN: 1, KGF: 0.00980665, KG: 0.00980665,
    TONF: 9.80665, TON: 9.80665, LB: 0.00444822, KIP: 4.44822
  };

  /* ================================================================== */
  /* Tokenizer                                                           */
  /* ================================================================== */

  /**
   * Split one record line into tokens, remembering which were quoted.
   * Quoting matters: `COLUMN` unquoted is a keyword, `"COLUMN"` quoted is
   * somebody's section name.
   * @returns {Array<{v:string,q:boolean}>}
   */
  function tokenize(line) {
    var out = [], i = 0, n = line.length;
    while (i < n) {
      var c = line[i];
      if (c === ' ' || c === '\t' || c === ',') { i++; continue; }
      if (c === '"') {
        var j = i + 1, buf = '';
        while (j < n) {
          if (line[j] === '"') {
            if (line[j + 1] === '"') { buf += '"'; j += 2; continue; }
            break;
          }
          buf += line[j]; j++;
        }
        out.push({ v: buf, q: true });
        i = j + 1;
      } else {
        var k = i;
        while (k < n && line[k] !== ' ' && line[k] !== '\t' && line[k] !== ',') k++;
        out.push({ v: line.slice(i, k), q: false });
        i = k;
      }
    }
    return out;
  }

  /** Read key/value pairs from `start`, where keys are unquoted words. */
  function readPairs(tokens, start) {
    var map = {}, i = start;
    while (i < tokens.length - 1) {
      var key = tokens[i];
      if (key.q) { i++; continue; }
      var k = key.v.toUpperCase();
      map[k] = tokens[i + 1].v;
      i += 2;
    }
    return map;
  }

  function numOf(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ------------------------------------------------------------------ */
  /* Record classification                                               */
  /* ------------------------------------------------------------------ */

  /**
   * An .e2k carries far more than geometry: design preferences, load
   * combinations, rebar libraries, named sets, view state. Those are not
   * errors and must never be reported as such. Rather than blocklisting
   * every one — the list differs by ETABS version and grows every release —
   * only records inside a block that could carry geometry are considered
   * interesting, and even then they are reported as information.
   */
  var GEOMETRY_BLOCKS = /(POINT|LINE|AREA|JOINT|FRAME|SHELL|SLAB|WALL|DECK|STOR|GRID|SECTION|PROPERT|CONNECTIV|ASSIGN|MATERIAL|DIAPHRAGM)/;

  /** Known-harmless even inside a geometry block. */
  var ALWAYS_IGNORE = {
    END: 1, ENDFILE: 1, LOG: 1, FILE: 1, COMMENT: 1,
    PREFERENCE: 1, PREFERENCES: 1, RLLF: 1, MODIFIERS: 1, MODIFIER: 1,
    REBARDEFINITION: 1, REBAR: 1, REBARSET: 1,
    AUTOSECTION: 1, AUTOSELECT: 1, AUTOSELECTSECTION: 1,
    TENDONSECTION: 1, TENDONPROP: 1,
    GRIDSYSTEM: 1, BUBBLE: 1,
    GROUP: 1, GROUPS: 1, GROUPASSIGN: 1,
    PIERNAME: 1, SPANDRELNAME: 1, PIER: 1, SPANDREL: 1,
    LOADCASE: 1, FUNCTION: 1,
    MASSSOURCE: 1, MASSOPTIONS: 1, ANALYSISOPTION: 1, ANALYSISOPTIONS: 1,
    CONCRETEDESIGN: 1, STEELDESIGN: 1, COMPOSITEDESIGN: 1,
    SHEARWALLDESIGN: 1, SLABDESIGN: 1, DESIGNPREF: 1,
    SECTIONCUT: 1, NAMEDSET: 1, DATABASETABLE: 1,
    WINDOW: 1, VIEW: 1, DISPLAY: 1, PROJECTINFORMATION: 1, PROJECTINFO: 1,
    SPRINGPROP: 1, LINKPROP: 1, PANELZONE: 1, STORYFORCE: 1
  };

  /* ================================================================== */
  /* Format detection                                                    */
  /* ================================================================== */

  var BINARY_SIGNATURES = [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0], note: 'OLE compound document (ETABS 9 / legacy .EDB)' },
    { bytes: [0x53, 0x51, 0x4C, 0x69], note: 'SQLite container (ETABS 18+ .EDB)' },
    { bytes: [0x50, 0x4B, 0x03, 0x04], note: 'ZIP container' }
  ];

  /**
   * Classify a dropped file before any expensive work happens.
   * @param {string} name
   * @param {Uint8Array} head First few kilobytes.
   */
  function detect(name, head) {
    var lower = String(name || '').toLowerCase();
    var ext = lower.indexOf('.') >= 0 ? lower.slice(lower.lastIndexOf('.')) : '';

    if (ext === '.edb' || ext === '.ebk') {
      return { kind: 'binary', ext: ext, signature: signatureOf(head) };
    }
    if (ext === '.xlsx' || ext === '.xls') return { kind: 'xlsx', ext: ext };

    // Content sniffing beats the extension: engineers rename these files.
    var sample = asciiOf(head, 4096);
    if (/TABLE:\s*"/.test(sample)) return { kind: 's2k', ext: ext };
    if (/\$\s*(POINT COORDINATES|PROGRAM INFORMATION|CONTROLS|STORIES)/i.test(sample)) {
      return { kind: 'e2k', ext: ext };
    }
    if (ext === '.e2k' || ext === '.$et') return { kind: 'e2k', ext: ext };
    if (ext === '.s2k' || ext === '.$2k') return { kind: 's2k', ext: ext };
    if (ext === '.csv' || ext === '.txt' || ext === '.tsv') return { kind: 'csv', ext: ext };

    if (isMostlyBinary(head)) return { kind: 'binary', ext: ext, signature: signatureOf(head) };
    return { kind: 'csv', ext: ext };
  }

  function signatureOf(head) {
    if (!head) return null;
    for (var i = 0; i < BINARY_SIGNATURES.length; i++) {
      var sig = BINARY_SIGNATURES[i], ok = true;
      for (var j = 0; j < sig.bytes.length; j++) {
        if (head[j] !== sig.bytes[j]) { ok = false; break; }
      }
      if (ok) return sig.note;
    }
    return 'Unrecognised binary container';
  }

  function asciiOf(bytes, limit) {
    if (!bytes) return '';
    var n = Math.min(bytes.length, limit || 4096), s = '';
    for (var i = 0; i < n; i++) {
      var c = bytes[i];
      s += (c >= 9 && c < 127) ? String.fromCharCode(c) : ' ';
    }
    return s;
  }

  function isMostlyBinary(bytes) {
    if (!bytes || !bytes.length) return false;
    var n = Math.min(bytes.length, 1024), odd = 0;
    for (var i = 0; i < n; i++) {
      var c = bytes[i];
      if (c === 0 || (c < 9 && c !== 0) || (c > 13 && c < 32)) odd++;
    }
    return odd / n > 0.08;
  }

  /**
   * Pull whatever is legible out of a proprietary binary. This is honest
   * reconnaissance, not a parse: it reports what it can see and nothing more.
   */
  function probeBinary(bytes) {
    var findings = { signature: signatureOf(bytes), version: null, strings: [] };
    var text = asciiOf(bytes, Math.min(bytes.length, 200000));
    var m = text.match(/ETABS\s*(?:Version|v)?\s*([0-9]+(?:\.[0-9]+)*)/i);
    if (m) findings.version = m[1];
    var seen = {}, re = /[A-Za-z][A-Za-z0-9 _\-\.\/]{5,40}/g, hit;
    while ((hit = re.exec(text)) && findings.strings.length < 40) {
      var s = hit[0].trim();
      if (s.length < 6 || seen[s]) continue;
      if (!/[A-Za-z]{3}/.test(s)) continue;
      seen[s] = 1;
      findings.strings.push(s);
    }
    return findings;
  }

  /* ================================================================== */
  /* Empty model scaffold                                                */
  /* ================================================================== */

  function emptyModel(fileName) {
    return {
      meta: {
        fileName: fileName || 'model',
        title: '', program: '', version: '',
        units: { force: 'KN', length: 'M', lengthToM: 1, forceToKN: 1 },
        warnings: [], notes: [], parseMs: 0, source: ''
      },
      stories: [],
      storyIndex: {},
      grids: [],
      points: {},
      materials: {},
      frameSections: {},
      rebarDefs: {},
      shellSections: {},
      diaphragms: {},
      elements: [],
      loads: [],
      loadPatterns: {},
      combos: {},
      counts: {},
      bbox: null
    };
  }

  /* ================================================================== */
  /* E2K reader                                                          */
  /* ================================================================== */

  function parseE2K(text, fileName) {
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var model = emptyModel(fileName);
    model.meta.source = 'ETABS text model (.e2k / .$et)';

    var lineConn = {};      // line name → connectivity
    var areaConn = {};      // area name → connectivity
    var lineAssigns = [];
    var areaAssigns = [];
    // Dialect records (FRAME/SECTION/PROPERTY…) that could target either a
    // line or an area. Routed after the whole file is read, because the
    // connectivity block that decides it may come later in the file.
    var deferredAssigns = [];
    var curves = {};          // "line\u0001storey" → [{n, p:[x,y,z]}] from LINE CURVE DATA
    var pointAssigns = [];
    var storyRecords = [];
    var unhandled = {};
    var census = {};      // every record keyword seen, with a count
    var samples = {};     // one raw line per keyword, for the diagnostic
    var blocks = [];      // every $ block header, in order

    var lines = text.split(/\r?\n/);
    var section = '';

    for (var li = 0; li < lines.length; li++) {
      var raw = lines[li];
      if (!raw) continue;
      var trimmed = raw.trim();
      if (!trimmed) continue;

      if (trimmed.charAt(0) === '$') {
        section = trimmed.replace(/^\$+\s*/, '').toUpperCase();
        if (blocks.indexOf(section) < 0) blocks.push(section);
        continue;
      }
      if (trimmed.charAt(0) === ';') continue; // comment

      var tk = tokenize(trimmed);
      if (!tk.length) continue;

      // A real record always names something in quotes or carries numbers.
      // A line with neither — "POINT COORDINATES", "STORY DATA", "END" — is a
      // human-readable heading. Some exports and most hand-built files carry
      // them, and reading one as a record invents a storey called "DATA".
      var hasQuoted = false, hasNumber = false;
      for (var hq = 0; hq < tk.length; hq++) {
        if (tk[hq].q) hasQuoted = true;
        else if (tk[hq].v !== '' && isFinite(parseFloat(tk[hq].v))) hasNumber = true;
      }
      if (!hasQuoted && !hasNumber) {
        var heading = trimmed.toUpperCase();
        if (blocks.indexOf(heading) < 0) blocks.push(heading);
        continue;
      }

      var rec = tk[0].v.toUpperCase();
      census[rec] = (census[rec] || 0) + 1;
      if (!samples[rec]) samples[rec] = trimmed.slice(0, 220);

      switch (rec) {
        case 'PROGRAM': {
          var p = readPairs(tk, 0);
          model.meta.program = tk[1] ? tk[1].v : 'ETABS';
          model.meta.version = p.VERSION || '';
          break;
        }
        case 'TITLE1': case 'TITLE2': case 'TITLE3':
          if (tk[1] && !model.meta.title) model.meta.title = tk[1].v;
          break;

        case 'UNITS': {
          // Written either as UNITS "KN" "M" or UNITS "KN-M" / "KN-M-C".
          var uparts = [];
          for (var uu = 1; uu < tk.length; uu++) {
            uparts = uparts.concat(String(tk[uu].v).split(/[-,\s]+/));
          }
          uparts = uparts.filter(Boolean).map(function (x) { return x.toUpperCase(); });
          var f = uparts[0] || 'KN';
          var l = uparts[1] || 'M';
          model.meta.units.force = f;
          model.meta.units.length = l;
          model.meta.units.lengthToM = LENGTH_TO_M[l] || 1;
          model.meta.units.forceToKN = FORCE_TO_KN[f] || 1;
          break;
        }

        case 'STORY': {
          var sp = readPairs(tk, 2);
          storyRecords.push({
            name: tk[1] ? tk[1].v : 'Story' + storyRecords.length,
            height: sp.HEIGHT !== undefined ? numOf(sp.HEIGHT) : null,
            elev: sp.ELEV !== undefined ? numOf(sp.ELEV) : null,
            master: (sp.MASTERSTORY || '').toUpperCase() === 'YES',
            similarTo: sp.SIMILARTO || null
          });
          break;
        }

        case 'GRID': {
          var gp = readPairs(tk, 2);
          model.grids.push({
            id: tk[1] ? tk[1].v : '',
            label: gp.LABEL || (tk[1] ? tk[1].v : ''),
            dir: (gp.DIR || 'X').toUpperCase(),
            coord: numOf(gp.COORD),
            visible: (gp.VISIBLE || 'Yes').toUpperCase() !== 'NO',
            bubbleLoc: gp.BUBBLELOC || 'End'
          });
          break;
        }

        case 'POINT': case 'JOINT': {
          if (!tk[1]) break;
          var pname = tk[1].v;
          var nums = [];
          for (var pi = 2; pi < tk.length; pi++) {
            var pv = parseFloat(tk[pi].v);
            if (isFinite(pv)) nums.push(pv); else break;
          }
          if (!nums.length) {
            // A restraint or diaphragm record reusing the POINT keyword.
            // Writing zeros here would move the point to the origin.
            var pp = readPairs(tk, 2);
            if (pp.RESTRAINT || pp.DIAPH || pp.SPRINGPROP) {
              pointAssigns.push({
                point: pname, story: pp.STORY || '',
                restraint: pp.RESTRAINT || null, diaph: pp.DIAPH || null,
                springProp: pp.SPRINGPROP || null
              });
            }
            break;
          }
          model.points[pname] = {
            x: nums[0] || 0,
            y: nums[1] || 0,
            z: nums.length > 2 ? nums[2] : null
          };
          break;
        }

        case 'LINE': {
          if (!tk[1] || !tk[2]) break;
          var lp = readPairs(tk, 5);
          lineConn[tk[1].v] = {
            type: tk[2].v.toUpperCase(),
            i: tk[3] ? tk[3].v : null,
            j: tk[4] ? tk[4].v : null,
            span: tk[5] ? (parseInt(tk[5].v, 10) || 0) : 0,
            section: lp.SECTION || lp.PROPERTY || lp.SECT || null,
            story: lp.STORY || null,
            ang: lp.ANG !== undefined ? numOf(lp.ANG) : 0
          };
          break;
        }

        case 'AREA': {
          if (!tk[1] || !tk[2]) break;
          var count = tk[3] ? (parseInt(tk[3].v, 10) || 0) : 0;
          var ids = [], offs = [], ti = 4;
          for (var a = 0; a < count && ti < tk.length; a++, ti++) ids.push(tk[ti].v);
          for (var b = 0; b < count && ti < tk.length; b++, ti++) offs.push(parseInt(tk[ti].v, 10) || 0);
          var acp = readPairs(tk, ti);
          areaConn[tk[1].v] = {
            type: tk[2].v.toUpperCase(), ids: ids, offsets: offs,
            section: acp.SECTION || acp.PROPERTY || null,
            story: acp.STORY || null
          };
          break;
        }

        case 'POINTASSIGN': {
          var pa = readPairs(tk, 3);
          pointAssigns.push({
            point: tk[1] ? tk[1].v : '',
            story: tk[2] ? tk[2].v : '',
            restraint: pa.RESTRAINT || null,
            diaph: pa.DIAPH || null,
            springProp: pa.SPRINGPROP || null
          });
          break;
        }

        case 'LINEASSIGN': {
          var la = readPairs(tk, 3);
          lineAssigns.push({
            line: tk[1] ? tk[1].v : '',
            story: tk[2] ? tk[2].v : '',
            section: la.SECTION || la.PROPERTY || '',
            ang: numOf(la.ANG),
            pier: la.PIER || null,
            spandrel: la.SPANDREL || null,
            release: la.RELEASE || null,
            offsets: la
          });
          break;
        }

        case 'LINECURVEDATA': {
          // Curved / multilinear frames: ordered global points per storey.
          var lc = readPairs(tk, 3);
          if (lc.POINT !== undefined && lc.GLOBALX !== undefined) {
            var ck = (tk[1] ? tk[1].v : '') + '\u0001' + (tk[2] ? tk[2].v : '');
            (curves[ck] = curves[ck] || []).push({
              n: parseInt(lc.POINT, 10) || 0,
              p: [numOf(lc.GLOBALX), numOf(lc.GLOBALY), numOf(lc.GLOBALZ)]
            });
          }
          break;
        }

        case 'AREAASSIGN': case 'SHELLASSIGN': {
          var aa = readPairs(tk, 3);
          areaAssigns.push({
            area: tk[1] ? tk[1].v : '',
            story: tk[2] ? tk[2].v : '',
            section: aa.SECTION || aa.PROPERTY || '',
            pier: aa.PIER || null,
            spandrel: aa.SPANDREL || null,
            diaph: aa.DIAPH || null,
            opening: (aa.OPENING || '').toUpperCase() === 'YES'
          });
          break;
        }

        case 'MATERIAL': {
          if (!tk[1]) break;
          var mname = tk[1].v;
          var mp = readPairs(tk, 2);
          var mat = model.materials[mname] || (model.materials[mname] = { name: mname });
          if (mp.TYPE) mat.type = mp.TYPE;
          if (mp.WEIGHTPERVOLUME !== undefined) mat.weightPerVolume = numOf(mp.WEIGHTPERVOLUME);
          if (mp.E !== undefined) mat.E = numOf(mp.E);
          if (mp.FC !== undefined) mat.fc = numOf(mp.FC);
          if (mp.FY !== undefined) mat.fy = numOf(mp.FY);
          if (mp.FU !== undefined) mat.fu = numOf(mp.FU);
          if (mp.GRADE) mat.grade = mp.GRADE;
          break;
        }

        case 'FRAMESECTION': case 'STEELSECTION':
          if (tk[1]) applyFrameSection(model, tk[1].v, readPairs(tk, 2));
          break;

        case 'CONCRETESECTION':
          // Carries the section's reinforcement *definition* — bar pattern,
          // bar area, cover and tie spacing. ETABS writes it for every
          // concrete section, so a column cage can be drawn from the file
          // rather than assumed.
          if (tk[1]) {
            var cp = readPairs(tk, 2);
            applyFrameSection(model, tk[1].v, cp);
            applyRebarDef(model, tk[1].v, cp);
          }
          break;

        case 'SHELLPROP': case 'SLABPROP': case 'WALLPROP': case 'DECKPROP':
          if (tk[1]) applyShellProp(model, tk[1].v, readPairs(tk, 2), rec);
          break;

        /* ---------------------------------------------------------------
         * Dialect aliases. Newer ETABS writes `SECTION`, `SHELL` and
         * `FRAME` where older builds wrote `FRAMESECTION`, `SHELLPROP` and
         * `LINEASSIGN`, and the same keyword means different things in
         * different blocks. Disambiguate on the fields the record actually
         * carries rather than on the block heading, which also varies.
         * ------------------------------------------------------------- */
        case 'SECTION': case 'SHELL': case 'FRAME': case 'AREAPROP':
        case 'PROPERTY': case 'JOINTASSIGN': {
          if (!tk[1]) break;
          var aName = tk[1].v;
          var ap = readPairs(tk, 2);
          var namedStorey = tk[2] && tk[2].q;

          if (rec === 'JOINTASSIGN' || (namedStorey && (ap.RESTRAINT || ap.DIAPH))) {
            pointAssigns.push({
              point: aName, story: tk[2] ? tk[2].v : '',
              restraint: ap.RESTRAINT || null, diaph: ap.DIAPH || null,
              springProp: ap.SPRINGPROP || null
            });
          } else if (namedStorey && (ap.SECTION || ap.PROPERTY || ap.SECT)) {
            // "<name>" "<storey>" SECTION "<prop>"  — an assignment.
            var target = { line: aName, story: tk[2].v,
              section: ap.SECTION || ap.PROPERTY || ap.SECT, ang: numOf(ap.ANG),
              pier: ap.PIER || null, spandrel: ap.SPANDREL || null,
              release: ap.RELEASE || null, offsets: ap };
            var asArea = {
              area: aName, story: tk[2].v,
              section: target.section, pier: ap.PIER || null,
              spandrel: ap.SPANDREL || null, diaph: ap.DIAPH || null,
              opening: (ap.OPENING || '').toUpperCase() === 'YES'
            };
            if (rec === 'SHELL' || rec === 'AREAPROP') areaAssigns.push(asArea);
            else deferredAssigns.push({ line: target, area: asArea });
          } else if (ap.JOINTI || ap.POINTI || ap.IPOINT) {
            lineConn[aName] = {
              type: (ap.TYPE || 'BEAM').toUpperCase(),
              i: ap.JOINTI || ap.POINTI || ap.IPOINT,
              j: ap.JOINTJ || ap.POINTJ || ap.JPOINT,
              span: parseInt(ap.NUMSTORIES || ap.SPAN || '0', 10) || 0
            };
          } else if (ap.PROPTYPE || ap.SLABTHICKNESS || ap.WALLTHICKNESS ||
                     ap.THICKNESS || ap.DECKSLABDEPTH || ap.SLABTYPE) {
            applyShellProp(model, aName, ap, rec === 'SHELL' ? 'SHELLPROP' : rec);
          } else if (ap.SHAPE || ap.D !== undefined || ap.B !== undefined ||
                     ap.MATERIAL || ap.MATPROP || ap.FILE) {
            applyFrameSection(model, aName, ap);
          } else if (!ALWAYS_IGNORE[rec]) {
            unhandled[rec] = (unhandled[rec] || 0) + 1;
          }
          break;
        }

        case 'DIAPHRAGM': {
          if (!tk[1]) break;
          var dp = readPairs(tk, 2);
          model.diaphragms[tk[1].v] = { name: tk[1].v, type: dp.TYPE || 'RIGID' };
          break;
        }

        case 'POINTLOAD': case 'LINELOAD': case 'AREALOAD': {
          var lp = readPairs(tk, 3);
          var v1 = lp.FVAL !== undefined ? lp.FVAL
            : lp.FVAL1 !== undefined ? lp.FVAL1
            : lp.FZ !== undefined ? lp.FZ : lp.VAL;
          model.loads.push({
            kind: rec === 'POINTLOAD' ? 'point' : (rec === 'LINELOAD' ? 'line' : 'area'),
            target: tk[1] ? tk[1].v : '',
            story: tk[2] ? tk[2].v : '',
            pattern: lp.LC || lp.LOADPAT || '',
            type: lp.TYPE || '',
            dir: lp.DIR || 'GRAV',
            value: numOf(v1),
            // A trapezoidal line load carries a second value; the average of
            // the two is what an intensity map should show.
            value2: lp.FVAL2 !== undefined ? numOf(lp.FVAL2) : null
          });
          break;
        }

        case 'LOADPATTERN': {
          if (!tk[1]) break;
          var pat = readPairs(tk, 2);
          model.loadPatterns[tk[1].v] = {
            name: tk[1].v,
            type: pat.TYPE || 'Other',
            selfWeight: numOf(pat.SELFWEIGHT)
          };
          break;
        }

        case 'COMBO': case 'LOADCOMBO': {
          if (!tk[1]) break;
          var cn = tk[1].v;
          var cb = model.combos[cn] || (model.combos[cn] = { name: cn, type: '', design: '', parts: [] });
          var co = readPairs(tk, 2);
          if (co.TYPE) cb.type = co.TYPE;
          if (co.DESIGN && !cb.design) cb.design = co.DESIGN;
          var part = co.LOADCASE || co.LOADPAT || co.LOADCOMBO;
          if (part) cb.parts.push({ name: part, sf: co.SF !== undefined ? numOf(co.SF) : 1 });
          break;
        }

        default:
          // Interesting only if it sits in a block that could hold geometry
          // and is not a keyword we already know to be metadata.
          if (!ALWAYS_IGNORE[rec] && GEOMETRY_BLOCKS.test(section)) {
            unhandled[rec] = (unhandled[rec] || 0) + 1;
          }
      }
    }

    buildStories(model, storyRecords);
    // Route ambiguous assignments now that all connectivity is known.
    // A name that exists only as an area goes to areas; everything else
    // (line-only, or a label shared by both) stays a line, matching ETABS.
    deferredAssigns.forEach(function (d) {
      if (areaConn[d.area.area] && !lineConn[d.line.line]) areaAssigns.push(d.area);
      else lineAssigns.push(d.line);
    });
    // ETABS writes one object's assignment across several records for the
    // same label + storey — e.g. the SECTION record, then a second record
    // carrying only the insertion offsets (OFFSETXI …). They describe ONE
    // member, so fold them together: later keys add to / override earlier
    // ones, and a record without SECTION never erases the section.
    var conflicts = { n: 0 };
    lineAssigns = mergeAssigns(lineAssigns, function (a) { return a.line + '\u0001' + a.story; }, conflicts);
    areaAssigns = mergeAssigns(areaAssigns, function (a) { return a.area + '\u0001' + a.story; }, conflicts);
    if (conflicts.n > 0) {
      (model.meta.notes = model.meta.notes || []).push(conflicts.n +
        ' member(s) were given two different sections for the same storey; the later one is used, as ETABS does.');
    }
    model.meta.curves = curves;
    resolveE2K(model, lineConn, areaConn, lineAssigns, areaAssigns, pointAssigns);
    delete model.meta.curves;
    finalise(model);

    model.meta.census = census;
    model.meta.samples = samples;
    model.meta.blocks = blocks;
    model.meta.unhandled = unhandled;
    model.meta.counts = {
      points: Object.keys(model.points).length,
      lineConn: Object.keys(lineConn).length,
      areaConn: Object.keys(areaConn).length,
      lineAssigns: lineAssigns.length,
      areaAssigns: areaAssigns.length,
      pointAssigns: pointAssigns.length
    };

    // Only say something when it could actually change what the reader sees.
    var unknownKeys = Object.keys(unhandled);
    if (unknownKeys.length && model.elements.length) {
      model.meta.notes = model.meta.notes || [];
      model.meta.notes.push(
        unknownKeys.length + ' record type(s) were skipped: ' +
        unknownKeys.slice(0, 8).join(', ') + (unknownKeys.length > 8 ? '…' : '') + '.'
      );
    }
    model.meta.parseMs = ((global.performance && performance.now) ? performance.now() : Date.now()) - t0;
    return model;
  }

  function applyFrameSection(model, name, fp) {
    var fs = model.frameSections[name] || (model.frameSections[name] = { name: name });
    if (fp.MATERIAL || fp.MATPROP) fs.material = fp.MATERIAL || fp.MATPROP;
    if (fp.SHAPE) fs.shape = fp.SHAPE;
    if (fp.FILE) fs.file = fp.FILE;
    // Newer exports use t3/t2/tf/tw; older ones D/B/TF/TW. Accept both.
    var map = { D: ['D', 'T3', 'DEPTH'], B: ['B', 'T2', 'WIDTH'],
                TF: ['TF', 'TFB', 'FLANGETHICKNESS'], TW: ['TW', 'WEBTHICKNESS'],
                TF2: ['TF2', 'TFT'], B2: ['B2', 'BF2'], GAP: ['GAP'] };
    Object.keys(map).forEach(function (key) {
      for (var i = 0; i < map[key].length; i++) {
        if (fp[map[key][i]] !== undefined) { fs[key] = numOf(fp[map[key][i]]); return; }
      }
    });
    if (fp.AUTOSELECT) fs.autoSelect = fp.AUTOSELECT;
    return fs;
  }

  /**
   * Reinforcement definition for a concrete section.
   *   PATTERN "R-3-2"   rectangular, 3 bars along local 3, 2 along local 2
   *   LONGBARAREA       area of one longitudinal bar (file units)
   *   CONFINEBARAREA    area of one tie/link bar
   *   CONFINEBARSPACING tie spacing
   *   COVER / COVERTOP / COVERBOTTOM   clear cover to the bar centre
   * Areas are converted to a bar diameter, which is what a schedule needs.
   */
  function applyRebarDef(model, name, cp) {
    var defs = model.rebarDefs || (model.rebarDefs = {});
    var d = defs[name] || (defs[name] = { section: name });
    var L = model.meta.units.lengthToM;
    var mm = L * 1000;                                  // file length → mm

    if (cp.TYPE) d.type = cp.TYPE;                      // "Column" | "Beam"
    if (cp.PATTERN) d.pattern = cp.PATTERN;
    if (cp.TRANSREINF) d.ties = cp.TRANSREINF;          // TIES | SPIRAL
    if (cp.DESIGNCHECK) d.designCheck = cp.DESIGNCHECK;
    if (cp.LONGBARMATERIAL) d.barMaterial = cp.LONGBARMATERIAL;
    if (cp.CONFINEBARMATERIAL) d.tieMaterial = cp.CONFINEBARMATERIAL;
    if (cp.COVER !== undefined) d.cover = numOf(cp.COVER) * mm;
    if (cp.COVERTOP !== undefined) d.coverTop = numOf(cp.COVERTOP) * mm;
    if (cp.COVERBOTTOM !== undefined) d.coverBottom = numOf(cp.COVERBOTTOM) * mm;
    if (cp.LONGBARAREA !== undefined) d.barDia = areaToDia(numOf(cp.LONGBARAREA) * L * L);
    if (cp.CONFINEBARAREA !== undefined) d.tieDia = areaToDia(numOf(cp.CONFINEBARAREA) * L * L);
    if (cp.CONFINEBARSPACING !== undefined) d.tieSpacing = numOf(cp.CONFINEBARSPACING) * mm;
    if (cp.NUMCONFINEBARS3 !== undefined) d.legs3 = parseInt(cp.NUMCONFINEBARS3, 10) || 0;
    if (cp.NUMCONFINEBARS2 !== undefined) d.legs2 = parseInt(cp.NUMCONFINEBARS2, 10) || 0;
    // Beam end areas, when the file carries a designed section.
    ['ATI', 'ABI', 'ATJ', 'ABJ'].forEach(function (k) {
      if (cp[k] !== undefined) {
        var v = numOf(cp[k]) * L * L;
        if (v > 0) { d.ends = d.ends || {}; d.ends[k] = v; }
      }
    });
    if (d.pattern) {
      var m = /^R-?(\d+)-?(\d+)$/i.exec(String(d.pattern).replace(/\s+/g, ''));
      if (m) { d.bars3 = parseInt(m[1], 10); d.bars2 = parseInt(m[2], 10); }
      else if (/^C/i.test(d.pattern)) {
        var c = /(\d+)/.exec(d.pattern);
        d.circular = true;
        d.barsCirc = c ? parseInt(c[1], 10) : 8;
      }
    }
    return d;
  }

  /** Round a bar area (m²) to the nearest standard Indian bar size, in mm. */
  var BAR_SIZES = [6, 8, 10, 12, 16, 20, 25, 28, 32, 36, 40];
  function areaToDia(areaM2) {
    if (!(areaM2 > 0)) return 0;
    var dia = Math.sqrt(areaM2 * 4 / Math.PI) * 1000;    // mm
    var best = BAR_SIZES[0];
    for (var i = 0; i < BAR_SIZES.length; i++) {
      if (Math.abs(BAR_SIZES[i] - dia) < Math.abs(best - dia)) best = BAR_SIZES[i];
    }
    return Math.abs(best - dia) <= 1.5 ? best : Math.round(dia);
  }

  function applyShellProp(model, name, sp, rec) {
    var sh = model.shellSections[name] || (model.shellSections[name] = { name: name });
    if (sp.PROPTYPE) sh.type = sp.PROPTYPE;
    if (rec === 'SLABPROP' && !sh.type) sh.type = 'Slab';
    if (rec === 'WALLPROP' && !sh.type) sh.type = 'Wall';
    if (rec === 'DECKPROP' && !sh.type) sh.type = 'Deck';
    if (sp.MATERIAL || sp.MATPROP) sh.material = sp.MATERIAL || sp.MATPROP;
    var th = sp.SLABTHICKNESS || sp.WALLTHICKNESS || sp.THICKNESS ||
             sp.DECKSLABDEPTH || sp.MEMBRANEF11;
    if (th !== undefined) sh.thickness = numOf(th);
    if (sp.SLABTYPE) sh.slabType = sp.SLABTYPE;
    if (sp.MODELINGTYPE) sh.modeling = sp.MODELINGTYPE;
    return sh;
  }

  /**
   * Stories arrive top-first. Walk them bottom-up so every elevation is
   * derived from the base, which is the only level with a stated ELEV.
   */
  function buildStories(model, records) {
    if (!records.length) {
      model.stories = [{ name: 'Base', height: 0, elev: 0, index: 0, master: false }];
      model.storyIndex = { Base: 0 };
      return;
    }
    var bottomUp = records.slice().reverse();
    var elev = bottomUp[0].elev !== null ? bottomUp[0].elev : 0;
    var out = [];
    for (var i = 0; i < bottomUp.length; i++) {
      var r = bottomUp[i];
      if (i === 0) {
        elev = r.elev !== null ? r.elev : 0;
      } else {
        elev = (r.elev !== null && r.height === null) ? r.elev : elev + (r.height || 0);
      }
      out.push({
        name: r.name,
        height: r.height || 0,
        elev: elev,
        index: i,
        master: r.master,
        similarTo: r.similarTo
      });
    }
    model.stories = out;
    model.storyIndex = {};
    out.forEach(function (s) { model.storyIndex[s.name] = s.index; });
  }

  function elevAt(model, index) {
    if (!model.stories.length) return 0;
    var i = Math.max(0, Math.min(model.stories.length - 1, index));
    return model.stories[i].elev;
  }

  /**
   * Fold every record for the same key into the first one, keeping file
   * order. Non-empty fields of later records override; `offsets` (the raw
   * key/value pairs) are unioned. Counts genuine section conflicts.
   */
  function mergeAssigns(list, keyOf, conflicts) {
    var byKey = {}, out = [];
    list.forEach(function (item) {
      var k = keyOf(item), base = byKey[k];
      if (!base) {
        base = byKey[k] = {};
        for (var f in item) base[f] = item[f];
        base.offsets = Object.assign({}, item.offsets || {});
        out.push(base);
        return;
      }
      for (var g in item) {
        if (g === 'offsets') continue;
        var v = item[g];
        if (v === null || v === undefined || v === '' || v === false) continue;
        if (g === 'ang' && !(item.offsets && item.offsets.ANG !== undefined)) continue;
        if (g === 'section' && base.section && base.section !== v) conflicts.n++;
        base[g] = v;
      }
      Object.assign(base.offsets, item.offsets || {});
    });
    return out;
  }

  function pathLength(path) {
    var L = 0;
    for (var i = 1; i < path.length; i++) L += dist(path[i - 1], path[i]);
    return L;
  }

  function resolveE2K(model, lineConn, areaConn, lineAssigns, areaAssigns, pointAssigns) {
    var scale = model.meta.units.lengthToM;
    var id = 0;
    var jointKeys = {};
    var curvesIn = model.meta.curves || {};

    function plan(label) {
      var p = model.points[label];
      return p ? [p.x * scale, p.y * scale] : null;
    }
    function z(index) { return elevAt(model, index) * scale; }

    /**
     * Elevation of one corner. A point written with three coordinates
     * carries its own level — that is how sloping slabs, stair flights and
     * sunshades appear in a file — so it wins over the storey elevation.
     */
    function zAt(label, index, storeyOffset) {
      var p = model.points[label];
      if (p && p.z !== null && p.z !== undefined) return p.z * scale;
      return z(index - (storeyOffset || 0));
    }

    var unresolved = model.meta.unresolved = {
      frameNoConnectivity: 0, frameNoStorey: 0, frameNoPoint: 0,
      areaNoConnectivity: 0, areaNoStorey: 0, areaNoPoint: 0,
      missingStoreyNames: {}, missingPointLabels: 0
    };

    // --- Frames ---------------------------------------------------------
    lineAssigns.forEach(function (as) {
      var conn = lineConn[as.line];
      if (!conn) { unresolved.frameNoConnectivity++; return; }
      var si = model.storyIndex[as.story];
      if (si === undefined) {
        unresolved.frameNoStorey++;
        unresolved.missingStoreyNames[as.story] = 1;
        return;
      }
      var pi = plan(conn.i), pj = plan(conn.j);
      if (!pi || !pj) { unresolved.frameNoPoint++; unresolved.missingPointLabels++; return; }

      var type = conn.type === 'COLUMN' ? 'Column'
               : conn.type === 'BRACE' ? 'Brace'
               : conn.type === 'BEAM' ? 'Beam' : titleCase(conn.type);

      var zTop = z(si), zBot;
      if (type === 'Column' || type === 'Brace') {
        zBot = z(si - (conn.span > 0 ? conn.span : 1));
      } else {
        zBot = zTop;
      }

      // Insertion-point offsets (global X/Y/Z at each end) move the drawn
      // member off its analytical line — ETABS uses them to keep a column
      // face flush with a beam or wall edge.
      var o = as.offsets || {};
      // A point written with its own Z (a landing, a plinth, a sunshade)
      // overrides the storey elevation at that end.
      var zI = model.points[conn.i] && model.points[conn.i].z !== null &&
               model.points[conn.i].z !== undefined ? model.points[conn.i].z * scale : zBot;
      var zJ = model.points[conn.j] && model.points[conn.j].z !== null &&
               model.points[conn.j].z !== undefined ? model.points[conn.j].z * scale : zTop;
      var a = [pi[0] + numOf(o.OFFSETXI) * scale, pi[1] + numOf(o.OFFSETYI) * scale, zI + numOf(o.OFFSETZI) * scale];
      var b = [pj[0] + numOf(o.OFFSETXJ) * scale, pj[1] + numOf(o.OFFSETYJ) * scale, zJ + numOf(o.OFFSETZJ) * scale];

      var path = null, curve = curvesIn[as.line + '\u0001' + as.story];
      if (curve && curve.length >= 2) {
        path = curve.slice().sort(function (p, q) { return p.n - q.n; })
          .map(function (c) { return [c.p[0] * scale, c.p[1] * scale, c.p[2] * scale]; });
        a = path[0]; b = path[path.length - 1];
      }
      var sec = model.frameSections[as.section];
      var el = {
        id: id++, kind: 'frame', type: type,
        name: as.line, story: as.story, storyIndex: si,
        section: as.section || '(none)',
        material: sec ? (sec.material || '') : '',
        a: a, b: b, ang: as.ang || 0,
        cardinal: parseInt((as.offsets && (as.offsets.CARDINALPT || as.offsets.CARDINALPOINT)) || '0', 10) || 0,
        pier: as.pier, spandrel: as.spandrel, release: as.release,
        path: path,
        // Analytical end nodes (before insertion offsets): connectivity and
        // health checks use these; a/b are where the member is drawn.
        na: path ? a : [pi[0], pi[1], zBot], nb: path ? b : [pj[0], pj[1], zTop],
        length: path ? pathLength(path) : dist(a, b)
      };
      model.elements.push(el);
      jointKeys[keyOf(el.na)] = 1; jointKeys[keyOf(el.nb)] = 1;
    });

    // --- Areas ----------------------------------------------------------
    areaAssigns.forEach(function (as) {
      var conn = areaConn[as.area];
      if (!conn) { unresolved.areaNoConnectivity++; return; }
      var si = model.storyIndex[as.story];
      if (si === undefined) {
        unresolved.areaNoStorey++;
        unresolved.missingStoreyNames[as.story] = 1;
        return;
      }
      var pts = [], ok = true;
      for (var k = 0; k < conn.ids.length; k++) {
        var p = plan(conn.ids[k]);
        if (!p) { ok = false; unresolved.areaNoPoint++; break; }
        var off = conn.offsets[k] || 0;
        pts.push([p[0], p[1], zAt(conn.ids[k], si, off)]);
      }
      if (!ok || pts.length < 3) return;
      pts = untwistQuad(pts);

      var shell = model.shellSections[as.section];
      var type = as.opening ? 'Opening'
        : conn.type === 'PANEL' ? 'Wall'
        : conn.type === 'FLOOR' ? 'Slab'
        : conn.type === 'RAMP' ? 'Ramp'
        : shell && shell.type ? titleCase(shell.type) : 'Slab';

      // A "floor" whose points span more than one level is a ramp or a
      // sloped slab, not a flat plate — label it truthfully.
      if (type === 'Slab' && spansLevels(pts)) type = 'Ramp';

      var el = {
        id: id++, kind: 'area', type: type,
        name: as.area, story: as.story, storyIndex: si,
        section: as.section || '(none)',
        material: shell ? (shell.material || '') : '',
        pts: pts,
        thickness: shell && shell.thickness ? shell.thickness * scale : 0.15,
        pier: as.pier, spandrel: as.spandrel, diaph: as.diaph,
        planArea: polygonArea3(pts)
      };
      model.elements.push(el);
      pts.forEach(function (p) { jointKeys[keyOf(p)] = 1; });
    });

    // --- Joints, supports, springs --------------------------------------
    pointAssigns.forEach(function (as) {
      var si = model.storyIndex[as.story];
      if (si === undefined) return;
      var p = plan(as.point);
      if (!p) return;
      var pos = [p[0], p[1], z(si)];
      model.elements.push({
        id: id++, kind: 'joint', type: restraintLabel(as.restraint),
        name: as.point, story: as.story, storyIndex: si,
        p: pos, restraint: as.restraint, diaph: as.diaph,
        spring: as.springProp || null,
        section: '', material: ''
      });
      delete jointKeys[keyOf(pos)];
    });

    // Remaining connectivity nodes become plain joints so the node layer
    // is complete without duplicating assigned points.
    Object.keys(jointKeys).forEach(function (k) {
      var parts = k.split('|');
      model.elements.push({
        id: id++, kind: 'joint', type: 'Joint', name: '',
        story: '', storyIndex: -1,
        p: [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])],
        restraint: null, section: '', material: ''
      });
    });
  }

  /**
   * Corner order for a four-point area is not consistent between ETABS
   * versions (and wall panels in particular arrive as p1,p2,p1,p2 with
   * storey offsets), which produces a self-intersecting "bow-tie" quad that
   * renders as two crossed slivers. For a quad, the vertex order with the
   * shortest perimeter is always the simple one, so reorder on that rather
   * than betting on one file convention.
   */
  function untwistQuad(pts) {
    if (pts.length !== 4) return pts;
    var orders = [[0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3]];
    var best = orders[0], bestP = Infinity;
    orders.forEach(function (o) {
      var p = 0;
      for (var i = 0; i < 4; i++) {
        var a = pts[o[i]], b = pts[o[(i + 1) % 4]];
        p += Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2) + Math.pow(b[2] - a[2], 2));
      }
      if (p < bestP - 1e-9) { bestP = p; best = o; }
    });
    return best.map(function (i) { return pts[i]; });
  }

  function spansLevels(pts) {
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][2] < min) min = pts[i][2];
      if (pts[i][2] > max) max = pts[i][2];
    }
    return (max - min) > 0.05;
  }

  function restraintLabel(code) {
    if (!code) return 'Joint';
    var c = code.toUpperCase();
    var dof = ['UX', 'UY', 'UZ', 'RX', 'RY', 'RZ'].filter(function (d) { return c.indexOf(d) >= 0; });
    if (dof.length >= 6) return 'Fixed';
    if (dof.length === 3 && c.indexOf('RX') < 0) return 'Pinned';
    if (dof.length >= 1) return 'Roller';
    return 'Joint';
  }

  function keyOf(p) { return p[0].toFixed(4) + '|' + p[1].toFixed(4) + '|' + p[2].toFixed(4); }
  function dist(a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  function titleCase(s) {
    s = String(s || '');
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  /** Newell's method — correct for the non-planar quads walls often are. */
  function polygonArea3(pts) {
    var nx = 0, ny = 0, nz = 0, n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  }

  /* ================================================================== */
  /* SAP2000 .s2k reader — TABLE: grammar, true 3-D joints               */
  /* ================================================================== */

  function parseS2K(text, fileName) {
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var model = emptyModel(fileName);
    model.meta.source = 'SAP2000 text model (.s2k / .$2k)';
    model.meta.program = 'SAP2000';

    var tables = {};
    var current = null;
    var lines = text.split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+_$/, '').trim();
      if (!line) continue;
      var tm = line.match(/^TABLE:\s*"(.+)"\s*$/i);
      if (tm) { current = tm[1].toUpperCase(); tables[current] = tables[current] || []; continue; }
      if (!current) continue;
      if (/^END TABLE DATA/i.test(line)) { current = null; continue; }
      var row = parseKeyValueRow(line);
      if (row) tables[current].push(row);
    }

    var unitRow = (tables['PROGRAM CONTROL'] || [])[0];
    if (unitRow) {
      var cu = String(unitRow.CurrUnits || '').toUpperCase();
      var parts = cu.split(/\s*,\s*/);
      if (parts.length >= 2) {
        model.meta.units.force = parts[0];
        model.meta.units.length = parts[1];
        model.meta.units.lengthToM = LENGTH_TO_M[parts[1]] || 1;
        model.meta.units.forceToKN = FORCE_TO_KN[parts[0]] || 1;
      }
      model.meta.version = unitRow.Version || '';
    }

    buildFromTables(model, tables);
    finalise(model);
    model.meta.parseMs = ((global.performance && performance.now) ? performance.now() : Date.now()) - t0;
    return model;
  }

  /** `Joint=12   X=3.5   Y=0   Text="Beam 1"` → object. */
  function parseKeyValueRow(line) {
    var re = /([A-Za-z0-9#_\-\.]+)\s*=\s*("([^"]*)"|[^\s]+)/g, m, row = null;
    while ((m = re.exec(line))) {
      row = row || {};
      row[m[1]] = m[3] !== undefined ? m[3] : m[2];
    }
    return row;
  }

  /* ================================================================== */
  /* Shared table → model builder (used by .s2k, CSV and XLSX)           */
  /* ================================================================== */

  var TABLE_ALIASES = {
    joints: ['JOINT COORDINATES', 'POINT OBJECT CONNECTIVITY', 'POINT COORDINATES', 'OBJECTS AND ELEMENTS - JOINTS'],
    frames: ['CONNECTIVITY - FRAME', 'FRAME OBJECT CONNECTIVITY', 'OBJECTS AND ELEMENTS - FRAMES'],
    areas:  ['CONNECTIVITY - AREA', 'AREA OBJECT CONNECTIVITY', 'OBJECTS AND ELEMENTS - AREAS'],
    frameAssign: ['FRAME SECTION ASSIGNMENTS', 'FRAME ASSIGNS - SECTION PROPERTIES'],
    areaAssign: ['AREA SECTION ASSIGNMENTS', 'AREA ASSIGNS - SECTION PROPERTIES'],
    stories: ['STORY DEFINITIONS', 'STORY DATA'],
    restraints: ['JOINT RESTRAINT ASSIGNMENTS', 'POINT ASSIGNS - RESTRAINTS'],
    frameProps: ['FRAME SECTION PROPERTIES 01 - GENERAL', 'FRAME SECTIONS'],
    shellProps: ['AREA SECTION PROPERTIES', 'SHELL PROPERTIES', 'SLAB PROPERTIES']
  };

  function pickTable(tables, group) {
    var names = TABLE_ALIASES[group] || [];
    for (var i = 0; i < names.length; i++) {
      if (tables[names[i]] && tables[names[i]].length) return tables[names[i]];
    }
    // Fuzzy fallback: any table whose name contains all words of an alias.
    var keys = Object.keys(tables);
    for (var j = 0; j < names.length; j++) {
      var want = names[j].split(/[\s\-]+/).filter(Boolean);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var all = want.every(function (w) { return key.indexOf(w) >= 0; });
        if (all && tables[key].length) return tables[key];
      }
    }
    return null;
  }

  function field(row, names) {
    for (var i = 0; i < names.length; i++) {
      if (row[names[i]] !== undefined && row[names[i]] !== '') return row[names[i]];
    }
    // Case-insensitive second pass — exporters vary the casing freely.
    var keys = Object.keys(row);
    for (var j = 0; j < names.length; j++) {
      var want = names[j].toLowerCase();
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].toLowerCase() === want && row[keys[k]] !== '') return row[keys[k]];
      }
    }
    return undefined;
  }

  function buildFromTables(model, tables) {
    var scale = model.meta.units.lengthToM;
    var id = 0;
    var joints = {};

    // Stories, when the export includes them.
    var storyRows = pickTable(tables, 'stories');
    if (storyRows) {
      var recs = storyRows.map(function (r) {
        return {
          name: String(field(r, ['Story', 'Name', 'Tower']) || ''),
          height: parseFloat(field(r, ['Height', 'StoryHeight'])),
          elev: parseFloat(field(r, ['Elevation', 'Elev'])),
          master: String(field(r, ['IsMaster', 'MasterStory']) || '').toUpperCase() === 'YES'
        };
      }).filter(function (r) { return r.name; });
      recs.forEach(function (r) {
        if (!isFinite(r.height)) r.height = null;
        if (!isFinite(r.elev)) r.elev = null;
      });
      // Tables are usually top-down like the .e2k block.
      buildStories(model, recs);
    }

    var jointRows = pickTable(tables, 'joints');
    if (jointRows) {
      jointRows.forEach(function (r) {
        var name = String(field(r, ['Joint', 'UniqueName', 'Point', 'PointName', 'Name']) || '');
        if (!name) return;
        joints[name] = {
          x: (parseFloat(field(r, ['XorR', 'X', 'GlobalX'])) || 0) * scale,
          y: (parseFloat(field(r, ['Y', 'GlobalY'])) || 0) * scale,
          z: (parseFloat(field(r, ['Z', 'GlobalZ'])) || 0) * scale,
          story: String(field(r, ['Story', 'Level']) || '')
        };
      });
    }
    if (!Object.keys(joints).length) {
      model.meta.warnings.push('No joint coordinate table found — nothing could be placed in space.');
      return;
    }

    // Derive stories from joint elevations when no story table was given.
    if (!model.stories.length) {
      var levels = {};
      Object.keys(joints).forEach(function (k) { levels[joints[k].z.toFixed(3)] = true; });
      var sorted = Object.keys(levels).map(parseFloat).sort(function (a, b) { return a - b; });
      model.stories = sorted.map(function (z, i) {
        return {
          name: i === 0 ? 'Base' : 'Story' + i,
          elev: z / scale,
          height: i === 0 ? 0 : (z - sorted[i - 1]) / scale,
          index: i, master: false
        };
      });
      model.storyIndex = {};
      model.stories.forEach(function (s) { model.storyIndex[s.name] = s.index; });
    }

    function storyOfZ(z) {
      var best = 0, bestD = Infinity;
      for (var i = 0; i < model.stories.length; i++) {
        var d = Math.abs(model.stories[i].elev * scale - z);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    // Section assignments, keyed by element name.
    var frameSectionOf = {}, areaSectionOf = {};
    var fa = pickTable(tables, 'frameAssign');
    if (fa) fa.forEach(function (r) {
      var n = String(field(r, ['Frame', 'UniqueName', 'Name']) || '');
      var s = String(field(r, ['AnalSect', 'Section', 'DesignSect', 'SectionProperty']) || '');
      if (n) frameSectionOf[n] = s;
    });
    var aa2 = pickTable(tables, 'areaAssign');
    if (aa2) aa2.forEach(function (r) {
      var n = String(field(r, ['Area', 'UniqueName', 'Name']) || '');
      var s = String(field(r, ['Section', 'SectionProperty', 'Property']) || '');
      if (n) areaSectionOf[n] = s;
    });

    // Section property definitions.
    var fp = pickTable(tables, 'frameProps');
    if (fp) fp.forEach(function (r) {
      var n = String(field(r, ['SectionName', 'Name', 'Section']) || '');
      if (!n) return;
      model.frameSections[n] = {
        name: n,
        material: String(field(r, ['Material', 'Mat']) || ''),
        shape: String(field(r, ['Shape', 'Type']) || ''),
        D: parseFloat(field(r, ['t3', 'Depth', 'D'])) || undefined,
        B: parseFloat(field(r, ['t2', 'Width', 'B'])) || undefined,
        TF: parseFloat(field(r, ['tf', 'FlangeThk', 'TF'])) || undefined,
        TW: parseFloat(field(r, ['tw', 'WebThk', 'TW'])) || undefined
      };
    });
    var shp = pickTable(tables, 'shellProps');
    if (shp) shp.forEach(function (r) {
      var n = String(field(r, ['Section', 'Name', 'SectionName']) || '');
      if (!n) return;
      model.shellSections[n] = {
        name: n,
        material: String(field(r, ['Material', 'Mat']) || ''),
        type: String(field(r, ['PropType', 'Type', 'DesignType']) || 'Slab'),
        thickness: parseFloat(field(r, ['Thickness', 'SlabThick', 'WallThick', 'Thick'])) || 0.15
      };
    });

    // Frames.
    var frameRows = pickTable(tables, 'frames');
    if (frameRows) frameRows.forEach(function (r) {
      var name = String(field(r, ['Frame', 'UniqueName', 'Name']) || '');
      var ji = String(field(r, ['JointI', 'PointI', 'IJoint']) || '');
      var jj = String(field(r, ['JointJ', 'PointJ', 'JJoint']) || '');
      var A = joints[ji], B = joints[jj];
      if (!A || !B) return;
      var a = [A.x, A.y, A.z], b = [B.x, B.y, B.z];
      var dz = Math.abs(b[2] - a[2]);
      var horiz = Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2));
      var type = String(field(r, ['Type', 'DesignType', 'FrameType']) || '');
      if (!type) type = dz < 0.01 ? 'Beam' : (horiz < 0.01 ? 'Column' : 'Brace');
      else type = titleCase(type);
      var si = storyOfZ(Math.max(a[2], b[2]));
      var sec = frameSectionOf[name] || '';
      model.elements.push({
        id: id++, kind: 'frame', type: type, name: name,
        story: model.stories[si] ? model.stories[si].name : '', storyIndex: si,
        section: sec || '(none)',
        material: model.frameSections[sec] ? (model.frameSections[sec].material || '') : '',
        a: a, b: b, ang: parseFloat(field(r, ['Angle', 'Ang'])) || 0,
        length: dist(a, b)
      });
    });

    // Areas.
    var areaRows = pickTable(tables, 'areas');
    if (areaRows) {
      var grouped = {};
      areaRows.forEach(function (r) {
        var name = String(field(r, ['Area', 'UniqueName', 'Name']) || '');
        if (!name) return;
        grouped[name] = grouped[name] || [];
        // Two shapes exist in the wild: one row per area listing Joint1..n,
        // or one row per corner with a Joint column.
        var single = field(r, ['Joint', 'Point']);
        if (single !== undefined) {
          grouped[name].push(String(single));
        } else {
          for (var k = 1; k <= 12; k++) {
            var jv = r['Joint' + k] || r['Point' + k];
            if (jv) grouped[name].push(String(jv));
          }
        }
      });
      Object.keys(grouped).forEach(function (name) {
        var pts = grouped[name].map(function (j) {
          var J = joints[j];
          return J ? [J.x, J.y, J.z] : null;
        }).filter(Boolean);
        if (pts.length < 3) return;
        pts = untwistQuad(pts);
        var sec = areaSectionOf[name] || '';
        var shell = model.shellSections[sec];
        var vertical = spansLevels(pts) && isVerticalPanel(pts);
        var si = storyOfZ(Math.max.apply(null, pts.map(function (p) { return p[2]; })));
        model.elements.push({
          id: id++, kind: 'area',
          type: vertical ? 'Wall' : (spansLevels(pts) ? 'Ramp' : 'Slab'),
          name: name,
          story: model.stories[si] ? model.stories[si].name : '', storyIndex: si,
          section: sec || '(none)',
          material: shell ? (shell.material || '') : '',
          pts: pts,
          thickness: shell && shell.thickness ? shell.thickness * scale : 0.15,
          planArea: polygonArea3(pts)
        });
      });
    }

    // Restraints → support joints.
    var restRows = pickTable(tables, 'restraints');
    var restrained = {};
    if (restRows) restRows.forEach(function (r) {
      var n = String(field(r, ['Joint', 'UniqueName', 'Point']) || '');
      if (!n) return;
      var flags = ['U1', 'U2', 'U3', 'R1', 'R2', 'R3', 'UX', 'UY', 'UZ', 'RX', 'RY', 'RZ']
        .filter(function (f) { return String(r[f] || '').toUpperCase() === 'YES'; });
      restrained[n] = flags.length >= 6 ? 'Fixed' : (flags.length >= 3 ? 'Pinned' : 'Roller');
    });

    Object.keys(joints).forEach(function (n) {
      var J = joints[n];
      model.elements.push({
        id: id++, kind: 'joint', type: restrained[n] || 'Joint', name: n,
        story: J.story, storyIndex: storyOfZ(J.z),
        p: [J.x, J.y, J.z], restraint: restrained[n] || null,
        section: '', material: ''
      });
    });
  }

  function isVerticalPanel(pts) {
    // A panel is vertical when its plan footprint collapses to a line.
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    return Math.min(maxX - minX, maxY - minY) < 0.05;
  }

  /* ================================================================== */
  /* CSV / delimited reader                                              */
  /* ================================================================== */

  /**
   * ETABS CSV exports come as a stack of named table blocks: a line holding
   * only the table name, then a header row, then data. Some exports give a
   * single table with no name line. Both are handled.
   */
  function parseDelimited(text, fileName) {
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var model = emptyModel(fileName);
    model.meta.source = 'Tabular export (.csv / .txt)';

    var delim = guessDelimiter(text);
    var rows = text.split(/\r?\n/).map(function (l) { return splitDelimited(l, delim); });
    var tables = blocksToTables(rows);
    buildFromTables(model, tables);
    finalise(model);
    model.meta.parseMs = ((global.performance && performance.now) ? performance.now() : Date.now()) - t0;
    if (!model.elements.length) {
      model.meta.warnings.push(
        'No recognisable ETABS tables found. Export "Joint Coordinates", ' +
        '"Connectivity - Frame" and "Frame Section Assignments" together.'
      );
    }
    return model;
  }

  function guessDelimiter(text) {
    var head = text.slice(0, 4000);
    var tabs = (head.match(/\t/g) || []).length;
    var commas = (head.match(/,/g) || []).length;
    var semis = (head.match(/;/g) || []).length;
    if (tabs > commas && tabs > semis) return '\t';
    if (semis > commas) return ';';
    return ',';
  }

  function splitDelimited(line, delim) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }

  /**
   * Group a flat grid of cells into named tables. A row with exactly one
   * non-empty cell starts a new table; the next row is its header.
   */
  function blocksToTables(rows) {
    var tables = {}, name = null, header = null, i;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var filled = row.filter(function (c) { return c !== ''; });
      if (!filled.length) { continue; }
      if (filled.length === 1 && row.length >= 1 && !header) {
        name = filled[0].toUpperCase().replace(/^TABLE:\s*/, '').replace(/^"|"$/g, '');
        header = null;
        continue;
      }
      if (filled.length === 1 && header) {
        name = filled[0].toUpperCase().replace(/^TABLE:\s*/, '').replace(/^"|"$/g, '');
        header = null;
        continue;
      }
      if (!header) {
        header = row.map(function (c) { return c.replace(/\s+/g, ''); });
        if (!name) name = 'TABLE 1';
        tables[name] = tables[name] || [];
        continue;
      }
      // Unit rows ETABS inserts under headers carry no letters worth keeping.
      if (row.every(function (c) { return c === '' || /^[a-zA-Z\/\^0-9\-]{0,8}$/.test(c) === false; })) {
        // keep going; this heuristic only skips obvious unit rows below
      }
      var obj = {}, any = false;
      for (var c2 = 0; c2 < header.length; c2++) {
        if (!header[c2]) continue;
        var val = row[c2] === undefined ? '' : row[c2];
        obj[header[c2]] = val;
        if (val !== '') any = true;
      }
      if (any) tables[name].push(obj);
    }
    return tables;
  }

  /* ================================================================== */
  /* Finalisation: counts, bbox, derived quantities                      */
  /* ================================================================== */

  function finalise(model) {
    var counts = {};
    var minX = Infinity, minY = Infinity, minZ = Infinity;
    var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    function grow(p) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }

    var sectionCache = {};
    model.elements.forEach(function (el) {
      counts[el.type] = (counts[el.type] || 0) + 1;
      if (el.kind === 'frame') {
        grow(el.a); grow(el.b);
        var profile = sectionCache[el.section];
        if (!profile) {
          var def = model.frameSections[el.section] || { name: el.section };
          profile = sectionCache[el.section] = global.ETABSSections.build(scaleSection(def, model));
        }
        el.sectionArea = profile.area;
        el.sectionFamily = profile.family;
        el.volume = profile.area * el.length;
      } else if (el.kind === 'area') {
        el.pts.forEach(grow);
        el.volume = el.planArea * (el.thickness || 0);
      } else if (el.kind === 'joint') {
        grow(el.p);
      }
    });

    if (!isFinite(minX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 1; }

    model.counts = counts;
    model.bbox = {
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    };
    model.sectionProfiles = sectionCache;
  }

  /** Section dimensions live in file length units; render in metres. */
  function scaleSection(def, model) {
    var s = model.meta.units.lengthToM;
    if (s === 1) return def;
    var out = { name: def.name, material: def.material, shape: def.shape };
    ['D', 'B', 'TF', 'TW', 'TF2', 'B2', 'GAP'].forEach(function (k) {
      if (def[k] !== undefined) out[k] = def[k] * s;
    });
    return out;
  }

  /* ================================================================== */
  /* Entry point                                                         */
  /* ================================================================== */

  function parse(kind, textOrTables, fileName) {
    if (kind === 'e2k') return parseE2K(textOrTables, fileName);
    if (kind === 's2k') return parseS2K(textOrTables, fileName);
    if (kind === 'csv') return parseDelimited(textOrTables, fileName);
    if (kind === 'tables') {
      var m = emptyModel(fileName);
      m.meta.source = 'Workbook export (.xlsx)';
      buildFromTables(m, textOrTables);
      finalise(m);
      return m;
    }
    throw new Error('Unsupported model kind: ' + kind);
  }

  /* ================================================================== */
  /* Diagnostics                                                         */
  /* ================================================================== */

  /**
   * Explain, in order of likelihood, why a file produced the geometry it did.
   * Written to be pasted to whoever maintains the parser: the census and the
   * sample lines are what make a missing dialect fixable in minutes.
   */
  function diagnose(model) {
    var meta = model.meta || {};
    var c = meta.counts || {};
    var u = meta.unresolved || {};
    var findings = [];

    function add(level, title, detail) { findings.push({ level: level, title: title, detail: detail }); }

    if (!model.elements.length) {
      if (!c.points) {
        add('critical', 'No point coordinates were read',
          'Nothing in this file matched a POINT or JOINT coordinate record, so there is no geometry to place. ' +
          'Check that the export included the "Point Coordinates" table.');
      }
      if (c.lineConn && !c.lineAssigns) {
        add('critical', 'Members have connectivity but no storey assignment',
          c.lineConn + ' line connectivity records were read, but no assignment records. A member cannot be ' +
          'placed in space without knowing which storey it belongs to — re-export with the "Line Assigns" ' +
          '(or "Frame Assignments") table included.');
      }
      if (!c.lineConn && !c.areaConn) {
        add('critical', 'No connectivity records',
          'Neither line nor area connectivity was found. Either the export omitted those tables, or this file ' +
          'uses a record layout the parser does not yet know.');
      }
      if ((model.stories || []).length <= 1) {
        add('critical', 'No storey definitions',
          'Only a base level was found. Without storeys, elevations cannot be derived.');
      }
    }

    var missingStoreys = Object.keys(u.missingStoreyNames || {});
    if (u.frameNoStorey || u.areaNoStorey) {
      add('critical', 'Assignments name storeys that are not defined',
        (u.frameNoStorey + u.areaNoStorey) + ' assignment(s) refer to storeys missing from the storey table' +
        (missingStoreys.length ? ': ' + missingStoreys.slice(0, 8).join(', ') : '') + '.');
    }
    if (u.frameNoConnectivity || u.areaNoConnectivity) {
      add('warn', 'Assignments refer to elements with no connectivity',
        (u.frameNoConnectivity + u.areaNoConnectivity) + ' assignment(s) name a line or area that never appears ' +
        'in a connectivity record.');
    }
    if (u.frameNoPoint || u.areaNoPoint) {
      add('warn', 'Connectivity refers to undefined points',
        (u.frameNoPoint + u.areaNoPoint) + ' element(s) reference a point label that has no coordinate.');
    }

    var unknown = Object.keys(meta.unhandled || {});
    if (unknown.length) {
      add('info', 'Record types the parser skipped',
        unknown.join(', ') + '. These appeared inside a block that can carry geometry, so they may be a ' +
        'dialect this build does not read yet.');
    }
    if (!findings.length) {
      add('ok', 'Nothing looks wrong',
        model.elements.length + ' elements were built from this file.');
    }

    return {
      findings: findings,
      counts: c,
      census: meta.census || {},
      samples: meta.samples || {},
      blocks: meta.blocks || [],
      text: reportText(model, findings)
    };
  }

  function reportText(model, findings) {
    var meta = model.meta || {};
    var lines = [];
    lines.push('STRUCTURA FILE DIAGNOSTIC');
    lines.push('file      : ' + meta.fileName);
    lines.push('format    : ' + meta.source);
    lines.push('program   : ' + (meta.program || '-') + ' ' + (meta.version || ''));
    lines.push('units     : ' + meta.units.force + '-' + meta.units.length);
    lines.push('elements  : ' + model.elements.length);
    lines.push('storeys   : ' + (model.stories || []).length);
    lines.push('');
    lines.push('FINDINGS');
    findings.forEach(function (f) {
      lines.push('  [' + f.level + '] ' + f.title);
      lines.push('      ' + f.detail);
    });
    lines.push('');
    lines.push('BLOCKS FOUND (' + (meta.blocks || []).length + ')');
    (meta.blocks || []).forEach(function (b) { lines.push('  $ ' + b); });
    lines.push('');
    lines.push('RECORD CENSUS');
    var census = meta.census || {};
    Object.keys(census).sort(function (a, b) { return census[b] - census[a]; })
      .forEach(function (k) { lines.push('  ' + String(census[k]).padStart(8) + '  ' + k); });
    lines.push('');
    lines.push('SAMPLE LINES');
    var samples = meta.samples || {};
    Object.keys(samples).forEach(function (k) { lines.push('  ' + samples[k]); });
    return lines.join('\n');
  }

  global.ETABSParser = {
    detect: detect,
    diagnose: diagnose,
    parse: parse,
    probeBinary: probeBinary,
    emptyModel: emptyModel,
    finalise: finalise,
    polygonArea3: polygonArea3,
    LENGTH_TO_M: LENGTH_TO_M,
    FORCE_TO_KN: FORCE_TO_KN
  };
})(window);
