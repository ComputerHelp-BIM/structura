/**
 * exporters.js — File output.
 * =================================================================
 * The artifact viewer sandbox blocks any download a page starts on its
 * own, so every file goes through the platform's `downloads` capability,
 * which shows the viewer a confirmation. When the page runs outside that
 * sandbox (saved locally, opened directly) it falls back to an anchor.
 *
 * Contains a minimal ZIP writer (store method + CRC-32) so an OBJ and its
 * material library travel together as one allowed file type.
 *
 * Namespace: window.ETABSExport
 */
(function (global) {
  'use strict';

  /* ================================================================== */
  /* Delivery                                                            */
  /* ================================================================== */

  var downloadsNs;       // resolved capability namespace, or null
  var downloadsReady = (function () {
    if (!global.claude || !global.claude.use) return Promise.resolve(null);
    return global.claude.use('downloads').then(function (ns) {
      downloadsNs = ns; return ns;
    }).catch(function () { return null; });
  })();

  /**
   * Offer a generated file to the viewer.
   * @returns {Promise<{status:string, message?:string}>}
   */
  function deliver(filename, data) {
    return downloadsReady.then(function (ns) {
      if (ns && ns.save) {
        return ns.save({ filename: filename, data: data }).then(function (r) {
          return { status: r.status };
        }, function (err) {
          return { status: 'error', code: err && err.code, message: messageFor(err, filename) };
        });
      }
      return anchorFallback(filename, data);
    });
  }

  function messageFor(err, filename) {
    var code = err && err.code;
    if (code === 'declined') return 'Save cancelled.';
    if (code === 'rejected_extension' || code === 'extension_not_enabled') {
      return 'This viewer will not accept a ' + ext(filename) + ' file.';
    }
    if (code === 'too_large') return 'That export is too large to save here — try a smaller scope.';
    if (code === 'rate_limited') return 'A save prompt is already open.';
    return 'The file could not be saved (' + (code || 'unknown') + ').';
  }

  function ext(name) {
    var i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i) : 'file';
  }

  function anchorFallback(filename, data) {
    try {
      var blob = data instanceof Blob ? data : new Blob([data]);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return { status: 'saved' };
    } catch (e) {
      return { status: 'error', message: 'Downloads are unavailable in this view.' };
    }
  }

  /* ================================================================== */
  /* CSV                                                                 */
  /* ================================================================== */

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /** Every element with its resolved geometry and properties. */
  function elementsCsv(model, Units) {
    var L = Units.lengthLabel();
    var rows = [[
      'Id', 'Kind', 'Type', 'Name', 'Story', 'Section', 'Material',
      'Length (' + L + ')', 'X1 (' + L + ')', 'Y1 (' + L + ')', 'Z1 (' + L + ')',
      'X2 (' + L + ')', 'Y2 (' + L + ')', 'Z2 (' + L + ')',
      'Section area (m2)', 'Volume (m3)', 'Plan area (m2)', 'Thickness (m)', 'Angle (deg)'
    ]];
    var v = function (m) { return Units.lengthValue(m).toFixed(4); };
    model.elements.forEach(function (el) {
      var a = el.kind === 'frame' ? el.a : (el.kind === 'area' ? el.pts[0] : el.p);
      var b = el.kind === 'frame' ? el.b : (el.kind === 'area' ? el.pts[2] || el.pts[1] : el.p);
      rows.push([
        el.id, el.kind, el.type, el.name, el.story, el.section, el.material,
        el.length ? v(el.length) : '',
        v(a[0]), v(a[1]), v(a[2]), v(b[0]), v(b[1]), v(b[2]),
        el.sectionArea ? el.sectionArea.toFixed(6) : '',
        el.volume ? el.volume.toFixed(5) : '',
        el.planArea ? el.planArea.toFixed(4) : '',
        el.thickness ? el.thickness.toFixed(4) : '',
        el.ang !== undefined ? el.ang : ''
      ]);
    });
    return csv(rows);
  }

  /** Concrete, steel and formwork takeoff, laid out for a costing sheet. */
  function bomCsv(model, q) {
    var rows = [];
    rows.push(['BILL OF MATERIALS — ' + (model.meta.title || model.meta.fileName)]);
    rows.push(['Generated', new Date().toISOString()]);
    rows.push([]);

    rows.push(['CONCRETE BY GRADE']);
    rows.push(['Grade', 'Volume (m3)', 'Columns (m3)', 'Beams (m3)', 'Slabs (m3)', 'Walls (m3)']);
    q.concrete.forEach(function (c) {
      rows.push([c.grade, c.volume.toFixed(3),
        (c.byType.Column || 0).toFixed(3), (c.byType.Beam || 0).toFixed(3),
        (c.byType.Slab || 0).toFixed(3), (c.byType.Wall || 0).toFixed(3)]);
    });
    rows.push(['TOTAL', q.totals.concreteVol.toFixed(3)]);
    rows.push([]);

    rows.push(['CONCRETE BY STOREY']);
    var storeys = {};
    q.concrete.forEach(function (c) {
      Object.keys(c.byStorey).forEach(function (s) { storeys[s] = true; });
    });
    var storeyList = Object.keys(storeys);
    rows.push(['Storey'].concat(q.concrete.map(function (c) { return c.grade + ' (m3)'; })));
    storeyList.forEach(function (s) {
      rows.push([s].concat(q.concrete.map(function (c) { return (c.byStorey[s] || 0).toFixed(3); })));
    });
    rows.push([]);

    rows.push(['STRUCTURAL STEEL BY SECTION']);
    rows.push(['Section', 'Material', 'Count', 'Total length (m)', 'Mass (t)']);
    q.steel.forEach(function (s) {
      rows.push([s.section, s.material || '', s.count, s.length.toFixed(2), s.tonnes.toFixed(3)]);
    });
    rows.push(['TOTAL', '', '', '', q.totals.steelTonnes.toFixed(3)]);
    rows.push([]);

    rows.push(['FORMWORK / SURFACE AREAS BY STOREY']);
    rows.push(['Storey', 'Formwork (m2)', 'Slab area (m2)', 'Wall face area (m2)']);
    Object.keys(q.formwork).forEach(function (s) {
      rows.push([s, (q.formwork[s] || 0).toFixed(2),
        (q.slabArea[s] || 0).toFixed(2), (q.wallArea[s] || 0).toFixed(2)]);
    });
    rows.push(['TOTAL', q.totals.formwork.toFixed(2), q.totals.slab.toFixed(2), q.totals.wall.toFixed(2)]);

    if (q.missingDensity.length) {
      rows.push([]);
      rows.push(['NOTE', 'No density stated in the file for: ' + q.missingDensity.join('; ') +
        '. Steel mass for those sections is reported as zero rather than assumed.']);
    }
    return csv(rows);
  }

  function statsCsv(model, stats, Units) {
    var rows = [];
    rows.push(['MODEL STATISTICS — ' + (model.meta.title || model.meta.fileName)]);
    rows.push(['Program', model.meta.program, 'Version', model.meta.version]);
    rows.push(['File units', model.meta.units.force + '-' + model.meta.units.length]);
    rows.push(['Storeys', stats.storeyCount]);
    rows.push(['Total height (' + Units.lengthLabel() + ')', Units.lengthValue(stats.height).toFixed(3)]);
    rows.push(['Footprint (' + Units.lengthLabel() + ')',
      Units.lengthValue(stats.footprint.x).toFixed(2), Units.lengthValue(stats.footprint.y).toFixed(2)]);
    rows.push(['Slenderness (H / min plan dimension)', stats.slenderness.toFixed(2)]);
    rows.push([]);
    rows.push(['ELEMENT COUNTS']);
    Object.keys(stats.counts).forEach(function (k) { rows.push([k, stats.counts[k]]); });
    rows.push([]);
    rows.push(['STOREY TABLE']);
    rows.push(['Storey', 'Height', 'Elevation', 'Floor area (m2)', 'Elements', 'Master']);
    stats.stories.forEach(function (s) {
      rows.push([s.name, Units.lengthValue(s.height).toFixed(3), Units.lengthValue(s.elev).toFixed(3),
        s.floorArea.toFixed(2), s.total, s.master ? 'Yes' : '']);
    });
    rows.push([]);
    rows.push(['SECTION INVENTORY']);
    rows.push(['Section', 'Kind', 'Material', 'Family', 'Count', 'Total length (m)']);
    stats.sections.forEach(function (s) {
      rows.push([s.name, s.kind, s.material || '', s.family || '', s.count, s.length.toFixed(2)]);
    });
    rows.push([]);
    rows.push(['MATERIAL INVENTORY']);
    rows.push(['Material', 'Type', 'Density (kN/m3)', 'Used by']);
    stats.materials.forEach(function (m) {
      rows.push([m.name, m.type, m.density === null ? 'not stated' : m.density.toFixed(2), m.count]);
    });
    return csv(rows);
  }

  /** Per-floor load table, plus the building summary, as CSV rows. */
  function loadsCsv(model, result) {
    var rows = [
      ['Structura load intensity', model.meta.fileName],
      ['Basis', result.basisLabel],
      ['Self weight', result.selfWeight ? 'included' : 'excluded'],
      ['Units', 'slabs kN/m², beams kN/m, totals kN'],
      [],
      ['Storey', 'Slab max', 'Slab avg (area weighted)', 'Beam max', 'Beam avg (length weighted)',
        'Slab area m2', 'Total kN']
    ];
    result.floors.forEach(function (f) {
      rows.push([f.name, r2(f.slabMax), r2(f.slabAvg), r2(f.beamMax), r2(f.beamAvg),
        r2(f.slabArea), Math.round(f.totalKN)]);
    });
    var b = result.building;
    rows.push([]);
    rows.push(['LOAD PATTERN TAKE-OFF']);
    rows.push(['Pattern', 'Kind', 'Factor', 'Total kN']);
    result.patterns.forEach(function (p) {
      rows.push([p.name, p.kind, p.factor, Math.round(p.totalKN)]);
    });
    rows.push([]);
    rows.push(['SEISMIC WEIGHT (IS 1893:2016 Cl 7.3)']);
    rows.push(['Storey', 'Dead kN', 'Structure kN', 'Imposed kN', 'Counted imposed kN', 'W kN']);
    result.floors.forEach(function (f) {
      rows.push([f.name, Math.round(f.deadKN), Math.round(f.structureKN), Math.round(f.liveKN),
        Math.round(f.seismicLive || 0), Math.round(f.seismicW)]);
    });
    rows.push(['Total W', '', '', '', '', Math.round(result.seismic.total)]);
    rows.push([]);
    rows.push(['Structure self weight — columns and braces kN', Math.round(result.structure.columnKN)]);
    rows.push(['Structure self weight — walls kN', Math.round(result.structure.wallKN)]);
    rows.push(['Point loads on joints kN', Math.round(result.pointKN)]);
    rows.push([]);
    rows.push(['Building maximum slab', r2(b.slabMax), b.worstSlabFloor ? b.worstSlabFloor.name : '']);
    rows.push(['Building maximum beam', r2(b.beamMax), b.worstBeamFloor ? b.worstBeamFloor.name : '']);
    rows.push(['Heaviest floor', b.heaviestFloor ? b.heaviestFloor.name : '',
      b.heaviestFloor ? Math.round(b.heaviestFloor.totalKN) : '']);
    rows.push(['Total applied gravity load kN', Math.round(b.totalKN)]);
    return csv(rows);
  }

  /** Every loaded element, one row each. */
  function loadElementsCsv(model, result) {
    var rows = [['Element', 'Type', 'Storey', 'Section', 'Intensity', 'Unit', 'Extent',
      'Extent unit', 'Total kN', 'Breakdown']];
    model.elements.forEach(function (e, i) {
      if (!global.ETABSLoads.carries(e)) return;
      var isArea = e.kind === 'area';
      var extent = isArea ? (e.planArea || 0) : (e.length || 0);
      var parts = (result.breakdown[e.id] || []).map(function (p) {
        return p.label + ' ' + r2(p.value);
      }).join('; ');
      rows.push([e.name || ('#' + e.id), e.type, e.story || '', e.section || '',
        r2(result.values[i]), isArea ? 'kN/m2' : 'kN/m', r2(extent), isArea ? 'm2' : 'm',
        r2(result.values[i] * extent), parts]);
    });
    return csv(rows);
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  /** Bar bending schedule plus the steel summaries, as CSV rows. */
  function rebarCsv(model, result) {
    var S = result.settings, t = result.totals;
    var rows = [
      ['Structura reinforcement', model.meta.fileName],
      ['Grade', S.grade],
      ['Basis', 'columns from the file’s bar pattern; beams ' + S.beamTopPercent + '% top / ' +
        S.beamBotPercent + '% bottom; slab mesh ' + S.slabBarDia + ' mm at ' + S.slabSpacing +
        '; wall mesh ' + S.wallBarDia + ' mm at ' + S.wallSpacing + ' — indicative detailing, not a design'],
      ['Laps', global.ETABSRebar.lapDescription(S) + ' over ' + S.stockLength + ' m stock'],
      ['Wastage %', S.wastagePercent], ['Chairs and spacers %', S.accessoriesPercent],
      [],
      ['BAR BENDING SCHEDULE'],
      ['Mark', 'Member', 'Section', 'Bar type', 'Shape', 'Dia mm', 'Cutting length m', 'Number', 'Weight kg']
    ];
    result.bbs.forEach(function (r) {
      rows.push([r.mark, r.member, r.section, r.kind, r.shape, r.dia, r2(r.cutting), r.count, r2(r.kg)]);
    });

    rows.push([], ['SUMMARY BY DIAMETER'], ['Dia mm', 'Bars', 'Length m', 'Weight kg']);
    result.byDia.forEach(function (d) { rows.push([d.dia, d.count, r2(d.lengthM), r2(d.kg)]); });

    rows.push([], ['SUMMARY BY MEMBER TYPE'], ['Type', 'Weight kg', 'Concrete m3', 'kg per m3']);
    result.byType.forEach(function (x) {
      rows.push([x.type, r2(x.kg), r2(x.volume), x.volume > 0 ? Math.round(x.kg / x.volume) : '']);
    });

    rows.push([], ['SUMMARY BY FLOOR'], ['Storey', 'Bars', 'Weight kg']);
    result.byFloor.forEach(function (f) { rows.push([f.name, f.bars, r2(f.kg)]); });

    rows.push([], ['TOTALS'],
      ['Net bar weight kg', r2(t.netKg)],
      ['Laps kg', r2(t.lapKg)],
      ['Wastage kg', r2(t.wastageKg)],
      ['Chairs and spacers kg', r2(t.accessoriesKg)],
      ['Total to order kg', r2(t.grossKg)],
      ['Tonnes', r2(t.tonnes)],
      ['Concrete m3', r2(t.concreteVol)],
      ['Steel kg per m3', Math.round(t.kgPerM3)]);
    return csv(rows);
  }

  /** Steel per element, for checking outliers. */
  function rebarElementsCsv(model, result) {
    var rows = [['Element', 'Type', 'Storey', 'Section', 'Bars', 'Weight kg', 'Concrete m3', 'kg per m3', 'Flag']];
    Object.keys(result.byElement).forEach(function (id) {
      var e = result.byElement[id];
      var el = model.elements[id];
      rows.push([(el && el.name) || ('#' + id), e.type, e.story || '', e.section || '',
        e.bars, r2(e.kg), r2(e.volume), Math.round(e.ratio), e.flag || '']);
    });
    return csv(rows);
  }

  function healthCsv(model, findings) {
    var rows = [['MODEL HEALTH — ' + (model.meta.title || model.meta.fileName)], []];
    rows.push(['Severity', 'Check', 'Affected', 'Detail']);
    findings.forEach(function (f) {
      rows.push([f.severity, f.title, f.ids.length, f.detail]);
    });
    if (!findings.length) rows.push(['ok', 'No issues found', 0, 'Every check passed.']);
    return csv(rows);
  }

  function compareCsv(diff) {
    var rows = [['REVISION COMPARISON'], []];
    rows.push(['Change', 'Type', 'Name', 'Storey', 'Field', 'Before', 'After']);
    diff.added.forEach(function (e) { rows.push(['Added', e.type, e.name, e.story, '', '', e.section]); });
    diff.removed.forEach(function (e) { rows.push(['Removed', e.type, e.name, e.story, '', e.section, '']); });
    diff.modified.forEach(function (m) {
      m.changes.forEach(function (c) {
        rows.push(['Modified', m.element.type, m.element.name, m.element.story, c.field, c.from, c.to]);
      });
    });
    return csv(rows);
  }

  /* ================================================================== */
  /* OBJ + MTL, packed into a ZIP                                        */
  /* ================================================================== */

  var TYPE_MATERIAL = {
    Column: [0.29, 0.44, 0.55], Beam: [0.36, 0.58, 0.62], Brace: [0.78, 0.50, 0.20],
    Slab: [0.72, 0.74, 0.76], Wall: [0.52, 0.56, 0.60], Ramp: [0.65, 0.60, 0.50],
    Joint: [0.35, 0.35, 0.38], Fixed: [0.2, 0.2, 0.2], Pinned: [0.2, 0.2, 0.2], Roller: [0.2, 0.2, 0.2]
  };

  /**
   * Read the welded geometry straight off the viewer's chunks, keeping only
   * elements that are currently visible, and write Wavefront OBJ.
   */
  function objFromViewer(viewer, model) {
    var lines = ['# Exported from the Computer Help ETABS Viewer',
                 '# Source: ' + (model.meta.fileName || 'model'),
                 'mtllib model.mtl'];
    var groups = {};
    var vertexOffset = 1;
    var STATE = global.ETABSViewer.STATE;

    viewer.chunks.forEach(function (chunk) {
      var pos = chunk.geometry.attributes.position.array;
      var idxAttr = chunk.geometry.attributes.aIndex.array;
      var index = chunk.geometry.index.array;
      var localMap = new Int32Array(pos.length / 3).fill(-1);
      var emitted = [];

      for (var i = 0; i < index.length; i += 3) {
        var elId = idxAttr[index[i]];
        if (viewer.states[elId] === STATE.HIDDEN) continue;
        var el = model.elements[elId];
        var mat = el ? (TYPE_MATERIAL[el.type] ? el.type : 'Other') : 'Other';
        var tri = [];
        for (var k = 0; k < 3; k++) {
          var vi = index[i + k];
          if (localMap[vi] < 0) {
            localMap[vi] = vertexOffset + emitted.length;
            emitted.push(vi);
          }
          tri.push(localMap[vi]);
        }
        (groups[mat] = groups[mat] || []).push(tri);
      }

      emitted.forEach(function (vi) {
        lines.push('v ' + pos[vi * 3].toFixed(4) + ' ' + pos[vi * 3 + 2].toFixed(4) + ' ' + (-pos[vi * 3 + 1]).toFixed(4));
      });
      vertexOffset += emitted.length;
    });

    Object.keys(groups).forEach(function (mat) {
      lines.push('g ' + mat);
      lines.push('usemtl ' + mat);
      groups[mat].forEach(function (t) { lines.push('f ' + t[0] + ' ' + t[1] + ' ' + t[2]); });
    });

    var mtl = ['# Computer Help ETABS Viewer material library'];
    Object.keys(groups).forEach(function (mat) {
      var c = TYPE_MATERIAL[mat] || [0.6, 0.6, 0.6];
      mtl.push('newmtl ' + mat);
      mtl.push('Kd ' + c[0].toFixed(3) + ' ' + c[1].toFixed(3) + ' ' + c[2].toFixed(3));
      mtl.push('Ka 0.10 0.10 0.10');
      mtl.push('Ks 0.05 0.05 0.05');
      mtl.push('Ns 12');
      mtl.push('');
    });

    return { obj: lines.join('\n'), mtl: mtl.join('\n'), triangles: countTris(groups) };
  }

  function countTris(groups) {
    return Object.keys(groups).reduce(function (a, k) { return a + groups[k].length; }, 0);
  }

  /* ---- Minimal ZIP (store, no compression) --------------------------- */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Build a ZIP archive from `[{name, text}]`. Store-only keeps the writer
   * to sixty lines and needs no deflate implementation; structural text
   * files are the one case where that trade is obviously right.
   */
  function zip(files) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = enc.encode(f.text);
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);       // version needed
      dv.setUint16(6, 0, true);        // flags
      dv.setUint16(8, 0, true);        // method: store
      dv.setUint16(10, 0, true);       // time
      dv.setUint16(12, 0x21, true);    // date (1 Jan 1996 — deterministic)
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      parts.push(local, data);

      var cen = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      central.push(cen);

      offset += local.length + data.length;
    });

    var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  /* ================================================================== */
  /* PDF report                                                          */
  /* ================================================================== */

  var JSPDF_URL = 'vendor/jspdf-2.5.1.umd.min.js';

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-src="' + url + '"]')) {
        var wait = setInterval(function () {
          if (global.jspdf || global.XLSX) { clearInterval(wait); resolve(); }
        }, 60);
        setTimeout(function () { clearInterval(wait); resolve(); }, 8000);
        return;
      }
      var s = document.createElement('script');
      s.src = url;
      s.setAttribute('data-src', url);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load ' + url)); };
      document.head.appendChild(s);
    });
  }

  var PALETTE = {
    ink: [16, 22, 29], teal: [14, 124, 134], ochre: [178, 107, 0],
    grey: [110, 122, 132], rule: [206, 214, 220], paper: [244, 246, 248]
  };

  /**
   * Build the branded report. `views` is a list of {title, dataUrl}.
   */
  function pdfReport(opts) {
    return loadScript(JSPDF_URL).then(function () {
      var jsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
      if (!jsPDF) throw new Error('PDF engine unavailable');

      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      var W = 210, H = 297, M = 16;
      var y = 0;

      function rule(yy, colour) {
        doc.setDrawColor.apply(doc, colour || PALETTE.rule);
        doc.setLineWidth(0.3);
        doc.line(M, yy, W - M, yy);
      }
      function heading(text, size, colour) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(size || 13);
        doc.setTextColor.apply(doc, colour || PALETTE.ink);
        doc.text(text, M, y);
        y += (size || 13) * 0.42 + 2;
      }
      function body(text, size) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(size || 9);
        doc.setTextColor.apply(doc, PALETTE.grey);
        var lines = doc.splitTextToSize(text, W - M * 2);
        doc.text(lines, M, y);
        y += lines.length * (size || 9) * 0.38 + 3;
      }
      function table(headers, rows, widths) {
        var x = M;
        doc.setFillColor.apply(doc, PALETTE.paper);
        doc.rect(M, y - 4, W - M * 2, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor.apply(doc, PALETTE.ink);
        headers.forEach(function (h, i) { doc.text(String(h), x + 1.5, y); x += widths[i]; });
        y += 5;
        doc.setFont('helvetica', 'normal');
        rows.forEach(function (r, ri) {
          if (y > H - 22) { footer(); doc.addPage(); y = M + 6; }
          if (ri % 2 === 1) {
            doc.setFillColor(250, 251, 252);
            doc.rect(M, y - 3.6, W - M * 2, 5.4, 'F');
          }
          x = M;
          doc.setTextColor.apply(doc, PALETTE.ink);
          r.forEach(function (c, i) {
            var text = String(c === undefined || c === null ? '' : c);
            doc.text(doc.splitTextToSize(text, widths[i] - 2)[0] || '', x + 1.5, y);
            x += widths[i];
          });
          y += 5.4;
        });
        y += 3;
      }
      function footer() {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor.apply(doc, PALETTE.grey);
        doc.text(opts.brand.name + '  ·  ' + opts.brand.site, M, H - 9);
        doc.text(opts.model.meta.fileName, W - M, H - 9, { align: 'right' });
        rule(H - 13);
      }

      /* --- Cover ---------------------------------------------------- */
      doc.setFillColor.apply(doc, PALETTE.ink);
      doc.rect(0, 0, W, 86, 'F');
      doc.setFillColor.apply(doc, PALETTE.teal);
      doc.rect(0, 86, W, 1.6, 'F');

      if (opts.logo) {
        try { doc.addImage(opts.logo, 'PNG', M, 18, 46, 13); } catch (e) { /* skip logo */ }
      } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(255, 255, 255);
        doc.text(opts.brand.name.toUpperCase(), M, 27);
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(26);
      doc.setTextColor(255, 255, 255);
      doc.text(doc.splitTextToSize(opts.model.meta.title || opts.model.meta.fileName, W - M * 2), M, 52);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(168, 180, 190);
      doc.text('Structural model review  ·  ' + new Date().toLocaleString(), M, 74);

      y = 100;
      var st = opts.stats;
      var tiles = [
        ['Storeys', String(st.storeyCount)],
        ['Elements', st.elementTotal.toLocaleString()],
        ['Height', opts.units.length(st.height)],
        ['Concrete', opts.units.volume(opts.qty.totals.concreteVol)],
        ['Steel', opts.units.mass(opts.qty.totals.steelTonnes)],
        ['Footprint', opts.units.area(st.footprint.area)]
      ];
      var tw = (W - M * 2 - 10) / 3;
      tiles.forEach(function (t, i) {
        var col = i % 3, row = Math.floor(i / 3);
        var x = M + col * (tw + 5), ty = y + row * 26;
        doc.setDrawColor.apply(doc, PALETTE.rule);
        doc.setLineWidth(0.3);
        doc.rect(x, ty, tw, 21);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor.apply(doc, PALETTE.grey);
        doc.text(t[0].toUpperCase(), x + 3, ty + 6);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor.apply(doc, PALETTE.teal);
        doc.text(t[1], x + 3, ty + 15);
      });
      y += 60;

      heading('Source file', 11);
      body(opts.model.meta.fileName + '  ·  ' + opts.model.meta.source +
        '  ·  program ' + (opts.model.meta.program || '—') + ' ' + (opts.model.meta.version || '') +
        '  ·  file units ' + opts.model.meta.units.force + '-' + opts.model.meta.units.length +
        '  ·  parsed in ' + Math.round(opts.model.meta.parseMs) + ' ms');
      footer();

      /* --- Views ----------------------------------------------------- */
      (opts.views || []).forEach(function (v) {
        doc.addPage();
        y = M + 4;
        heading(v.title, 14, PALETTE.ink);
        rule(y); y += 6;
        try {
          var imgH = 150;
          doc.addImage(v.dataUrl, 'PNG', M, y, W - M * 2, imgH, undefined, 'FAST');
          y += imgH + 8;
        } catch (e) {
          body('This view could not be rendered into the report.');
        }
        if (v.caption) body(v.caption);
        footer();
      });

      /* --- Statistics ------------------------------------------------ */
      doc.addPage();
      y = M + 4;
      heading('Model statistics', 14);
      rule(y); y += 7;
      heading('Storey table', 10);
      table(['Storey', 'Height', 'Elevation', 'Floor area', 'Elements'],
        st.stories.map(function (s) {
          return [s.name, opts.units.length(s.height), opts.units.length(s.elev),
            opts.units.area(s.floorArea), s.total];
        }), [45, 30, 32, 40, 31]);

      heading('Section inventory', 10);
      table(['Section', 'Material', 'Count', 'Total length'],
        st.sections.slice(0, 26).map(function (s) {
          return [s.name, s.material || '—', s.count, opts.units.length(s.length)];
        }), [66, 42, 26, 44]);
      footer();

      /* --- Quantities ------------------------------------------------ */
      doc.addPage();
      y = M + 4;
      heading('Bill of materials', 14);
      rule(y); y += 7;
      heading('Concrete by grade', 10);
      table(['Grade', 'Volume', 'Columns', 'Beams', 'Slabs', 'Walls'],
        opts.qty.concrete.map(function (c) {
          return [c.grade, opts.units.volume(c.volume),
            (c.byType.Column || 0).toFixed(1), (c.byType.Beam || 0).toFixed(1),
            (c.byType.Slab || 0).toFixed(1), (c.byType.Wall || 0).toFixed(1)];
        }), [38, 34, 26, 26, 26, 28]);

      if (opts.qty.steel.length) {
        heading('Structural steel by section', 10);
        table(['Section', 'Count', 'Total length', 'Mass'],
          opts.qty.steel.slice(0, 22).map(function (s) {
            return [s.section, s.count, opts.units.length(s.length), opts.units.mass(s.tonnes)];
          }), [66, 26, 46, 40]);
      }
      if (opts.qty.missingDensity.length) {
        body('Note — no density is stated in the file for: ' + opts.qty.missingDensity.join(', ') +
          '. Mass for those sections is reported as zero rather than assumed.');
      }
      footer();

      /* --- Loads ----------------------------------------------------- */
      if (opts.loads && opts.loads.floors.length) {
        var ld = opts.loads;
        doc.addPage();
        y = M + 4;
        heading('Load intensity', 14);
        rule(y); y += 7;
        body('Basis: ' + ld.basisLabel + (ld.selfWeight ? ', self weight included' : ', applied loads only') +
          '. Slab intensities are in kN/m² and beam intensities in kN/m. These are the loads assigned in ' +
          'the model file; no analysis is performed and no load is redistributed.');
        y += 2;
        heading('By floor', 10);
        table(['Storey', 'Slab max', 'Slab avg', 'Beam max', 'Beam avg', 'Total kN'],
          ld.floors.map(function (f) {
            return [f.name, f.slabMax.toFixed(2), f.slabAvg.toFixed(2),
              f.beamMax.toFixed(2), f.beamAvg.toFixed(2), Math.round(f.totalKN).toLocaleString()];
          }), [46, 27, 27, 27, 27, 24]);
        y += 2;
        if (ld.patterns && ld.patterns.length) {
          heading('What makes up the load', 10);
          table(['Load pattern', 'Kind', 'Factor', 'Total kN'],
            ld.patterns.map(function (p) {
              return [p.name, p.kind, p.factor === 1 ? '1.0' : p.factor.toFixed(2),
                Math.round(p.totalKN).toLocaleString()];
            }), [70, 34, 30, 44]);
          y += 2;
        }

        heading('Seismic weight — IS 1893:2016 Cl 7.3', 10);
        table(['Storey', 'Dead kN', 'Structure kN', 'Imposed kN', 'Counted kN', 'W kN'],
          ld.floors.map(function (f) {
            return [f.name, Math.round(f.deadKN).toLocaleString(), Math.round(f.structureKN).toLocaleString(),
              Math.round(f.liveKN).toLocaleString(), Math.round(f.seismicLive || 0).toLocaleString(),
              Math.round(f.seismicW).toLocaleString()];
          }).concat([['Total W', '', '', '', '', Math.round(ld.seismic.total).toLocaleString()]]),
          [46, 27, 30, 27, 27, 21]);
        body('Full dead load plus a quarter of an imposed load up to 3 kN/m² and a half above it; the roof ' +
          'imposed load is excluded and each storey\u2019s columns and walls are shared half above and half ' +
          'below. Arithmetic on the modelled loads, not an analysis.');
        y += 2;

        heading('Whole building', 10);
        table(['Measure', 'Value', 'Where'], [
          ['Maximum slab intensity', ld.building.slabMax.toFixed(2) + ' kN/m²',
            ld.building.worstSlabFloor ? ld.building.worstSlabFloor.name : '—'],
          ['Maximum beam intensity', ld.building.beamMax.toFixed(2) + ' kN/m',
            ld.building.worstBeamFloor ? ld.building.worstBeamFloor.name : '—'],
          ['Heaviest floor', ld.building.heaviestFloor ? Math.round(ld.building.heaviestFloor.totalKN).toLocaleString() + ' kN' : '—',
            ld.building.heaviestFloor ? ld.building.heaviestFloor.name : '—'],
          ['Total applied gravity load', Math.round(ld.building.totalKN).toLocaleString() + ' kN', 'all floors'],
          ['Vertical structure self weight', Math.round(ld.structure.total).toLocaleString() + ' kN', 'columns and walls'],
          ['Total seismic weight W', Math.round(ld.seismic.total).toLocaleString() + ' kN', 'IS 1893 Cl 7.3']
        ], [70, 55, 53]);
        footer();
      }

      /* --- Reinforcement --------------------------------------------- */
      if (opts.rebar && opts.rebar.bbs.length) {
        var rb = opts.rebar, rt = rb.totals, rs = rb.settings;
        doc.addPage();
        y = M + 4;
        heading('Reinforcement', 14);
        rule(y); y += 7;
        body('Grade ' + rs.grade + '. Column cages follow the bar pattern written in the model file. Beams use ' +
          rs.beamTopPercent + '% top and ' + rs.beamBotPercent + '% bottom steel, slabs a ' + rs.slabBarDia +
          ' mm mesh at ' + rs.slabSpacing + ' and walls ' + rs.wallBarDia + ' mm at ' + rs.wallSpacing +
          ' — indicative detailing for quantities, not a design.');
        y += 2;
        heading('By diameter', 10);
        table(['Diameter', 'Bars', 'Length m', 'Weight kg', 'Share'],
          rb.byDia.map(function (d) {
            return [d.dia + ' mm', d.count.toLocaleString(), Math.round(d.lengthM).toLocaleString(),
              Math.round(d.kg).toLocaleString(),
              Math.round(d.kg / (rt.netKg + rt.lapKg) * 100) + '%'];
          }), [40, 32, 36, 38, 32]);
        y += 2;
        heading('By member type', 10);
        table(['Type', 'Weight kg', 'Concrete m³', 'kg per m³'],
          rb.byType.map(function (x) {
            return [x.type, Math.round(x.kg).toLocaleString(), x.volume.toFixed(1),
              x.volume > 0 ? Math.round(x.kg / x.volume) : '—'];
          }), [52, 42, 42, 42]);
        y += 2;
        heading('Order quantity', 10);
        table(['Item', 'kg'], [
          ['Bars, net length', Math.round(rt.netKg).toLocaleString()],
          ['Laps — ' + global.ETABSRebar.lapDescription(rs) + ', over ' + rs.stockLength + ' m',
            Math.round(rt.lapKg).toLocaleString()],
          ['Wastage ' + rs.wastagePercent + '%', Math.round(rt.wastageKg).toLocaleString()],
          ['Chairs, spacers, binding ' + rs.accessoriesPercent + '%', Math.round(rt.accessoriesKg).toLocaleString()],
          ['Total to order', Math.round(rt.grossKg).toLocaleString() + '  (' + rt.tonnes.toFixed(2) + ' t)'],
          ['Steel per m³ of concrete', Math.round(rt.kgPerM3) + ' kg/m³']
        ], [110, 68]);
        footer();
      }

      /* --- Health ---------------------------------------------------- */
      doc.addPage();
      y = M + 4;
      heading('Model health', 14);
      rule(y); y += 7;
      if (!opts.findings.length) {
        body('Every check passed: no orphan joints, zero-length members, undefined sections, duplicate members or discontinuous columns were found.');
      } else {
        opts.findings.forEach(function (fd) {
          if (y > H - 45) { footer(); doc.addPage(); y = M + 6; }
          var col = fd.severity === 'critical' ? [176, 42, 42]
            : fd.severity === 'warn' ? PALETTE.ochre : PALETTE.teal;
          doc.setFillColor.apply(doc, col);
          doc.rect(M, y - 3.4, 2, 9, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor.apply(doc, PALETTE.ink);
          doc.text(fd.title + '   (' + fd.severity + (fd.ids.length ? ', ' + fd.ids.length + ' affected' : '') + ')', M + 5, y);
          y += 5;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor.apply(doc, PALETTE.grey);
          var lines = doc.splitTextToSize(fd.detail, W - M * 2 - 5);
          doc.text(lines, M + 5, y);
          y += lines.length * 3.6 + 6;
        });
      }
      footer();

      return doc.output('blob');
    });
  }

  /* ================================================================== */
  /* XLSX reading (lazy)                                                 */
  /* ================================================================== */

  var XLSX_URL = 'vendor/xlsx-0.18.5.full.min.js';

  /**
   * Read an ETABS workbook export into the same table shape the .s2k and
   * CSV readers produce. SheetJS is fetched only when a workbook is
   * actually dropped, so it costs nothing on a normal visit.
   */
  function readWorkbook(arrayBuffer) {
    return loadScript(XLSX_URL).then(function () {
      if (!global.XLSX) throw new Error('Workbook reader unavailable');
      var wb = global.XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      var tables = {};
      wb.SheetNames.forEach(function (name) {
        var rows = global.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' });
        if (!rows.length) return;
        // ETABS puts the table name in A1 and the header on the next row.
        var start = 0;
        var nonEmpty = rows[0].filter(function (c) { return String(c).trim() !== ''; });
        if (nonEmpty.length === 1) start = 1;
        var header = (rows[start] || []).map(function (c) { return String(c).replace(/\s+/g, ''); });
        var out = [];
        for (var r = start + 1; r < rows.length; r++) {
          var obj = {}, any = false;
          for (var c = 0; c < header.length; c++) {
            if (!header[c]) continue;
            var v = rows[r][c];
            obj[header[c]] = v === undefined ? '' : String(v);
            if (obj[header[c]] !== '') any = true;
          }
          if (any) out.push(obj);
        }
        if (out.length) tables[name.toUpperCase()] = out;
      });
      return tables;
    });
  }

  global.ETABSExport = {
    deliver: deliver,
    csv: csv,
    elementsCsv: elementsCsv,
    bomCsv: bomCsv,
    statsCsv: statsCsv,
    healthCsv: healthCsv,
    loadsCsv: loadsCsv,
    rebarCsv: rebarCsv,
    rebarElementsCsv: rebarElementsCsv,
    loadElementsCsv: loadElementsCsv,
    compareCsv: compareCsv,
    objFromViewer: objFromViewer,
    zip: zip,
    pdfReport: pdfReport,
    readWorkbook: readWorkbook,
    loadScript: loadScript,
    downloadsReady: downloadsReady,
    dataUrlToBlob: function (dataUrl) {
      var parts = dataUrl.split(',');
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'image/png' });
    }
  };
})(window);
