/**
 * app-files.js — Loading models and getting work back out.
 * =================================================================
 * Parsing runs in a Web Worker when one can start, so a large text model
 * never freezes the interface; the main thread is kept as a fallback rather
 * than a second code path (the worker loads the same parser modules).
 *
 * Namespace: window.FILES
 */
(function (global) {
  'use strict';

  var A = global.APP;
  var S = A.S;
  var $ = A.$;
  var toast = A.toast;
  var Parser = global.ETABSParser;
  var Analysis = global.ETABSAnalysis;
  var Exporter = global.ETABSExport;
  var Costing = global.ETABSCosting;
  var Units = global.ETABSUnits;

  var listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, d) { (listeners[evt] || []).forEach(function (f) { f(d); }); }

  /* ================================================================== */
  /* Progress                                                            */
  /* ================================================================== */

  function showProgress(p) {
    var bar = $('progress');
    bar.style.display = 'block';
    bar.querySelector('i').style.width = Math.round(p * 100) + '%';
  }
  function hideProgress() {
    var bar = $('progress');
    bar.querySelector('i').style.width = '100%';
    setTimeout(function () {
      bar.style.display = 'none';
      bar.querySelector('i').style.width = '0%';
    }, 260);
  }

  /* ================================================================== */
  /* Worker-backed parsing                                               */
  /* ================================================================== */

  var worker = null;
  var workerBroken = false;
  var jobId = 0;
  var jobs = {};

  function ensureWorker() {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
      worker = new Worker('js/parse-worker.js');
      worker.onmessage = function (e) {
        var d = e.data || {};
        var job = jobs[d.id];
        if (d.progress !== undefined && job) { job.progress(d.progress); return; }
        if (!job) return;
        delete jobs[d.id];
        if (d.ok) job.resolve(d.model);
        else job.reject(new Error(d.error || 'Parsing failed'));
      };
      worker.onerror = function () {
        // One failure is enough: fall back for the rest of the session.
        workerBroken = true;
        Object.keys(jobs).forEach(function (k) {
          jobs[k].reject(new Error('worker-unavailable'));
          delete jobs[k];
        });
        worker = null;
      };
    } catch (e) {
      workerBroken = true;
      worker = null;
    }
    return worker;
  }

  function parseAsync(kind, payload, fileName, onProgress) {
    var w = ensureWorker();
    if (!w) return Promise.resolve(Parser.parse(kind, payload, fileName));

    return new Promise(function (resolve, reject) {
      var id = ++jobId;
      jobs[id] = { resolve: resolve, reject: reject, progress: onProgress || function () {} };
      w.postMessage({ id: id, kind: kind, payload: payload, fileName: fileName });
      setTimeout(function () {
        if (jobs[id]) {
          delete jobs[id];
          reject(new Error('worker-timeout'));
        }
      }, 120000);
    }).catch(function (err) {
      if (err && /worker-/.test(err.message)) {
        // Parse on the main thread instead — slower, but it always works.
        return Parser.parse(kind, payload, fileName);
      }
      throw err;
    });
  }

  /* ================================================================== */
  /* Loading                                                             */
  /* ================================================================== */

  function readHead(file, bytes) {
    return file.slice(0, bytes).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function handleFile(file, asCompare) {
    if (!file) return;
    showProgress(0.02);

    readHead(file, 8192).then(function (head) {
      var info = Parser.detect(file.name, head);

      if (info.kind === 'binary') {
        hideProgress();
        return file.arrayBuffer().then(function (buf) {
          emit('binary', { file: file, probe: Parser.probeBinary(new Uint8Array(buf.slice(0, 400000))) });
        });
      }

      if (info.kind === 'xlsx') {
        return file.arrayBuffer().then(function (buf) {
          showProgress(0.2);
          if (!asCompare) S.source = { kind: 'file', file: file, format: 'xlsx', name: file.name };
          return Exporter.readWorkbook(buf).then(function (tables) {
            return adopt(Parser.parse('tables', tables, file.name), asCompare);
          });
        });
      }

      return file.text().then(function (text) {
        showProgress(0.15);
        if (!asCompare) S.source = { kind: 'file', file: file, format: info.kind, name: file.name };
        return parseAsync(info.kind, text, file.name, function (p) { showProgress(0.15 + p * 0.1); })
          .then(function (model) { return adopt(model, asCompare); });
      });
    }).catch(function (err) {
      hideProgress();
      toast('Could not read that file: ' + (err && err.message ? err.message : 'unknown error'), 'err');
    });
  }

  function adopt(model, asCompare) {
    if (!model || !model.elements.length) {
      hideProgress();
      // A red banner listing record names told the reader nothing actionable.
      // Show the diagnostic instead: it names the cause and can be copied.
      emit('diagnose', { model: model, reason: 'empty' });
      return;
    }
    if (asCompare) {
      hideProgress();
      applyCompare(model);
      return;
    }
    return loadModel(model);
  }

  function loadSample(id) {
    showProgress(0.05);
    setTimeout(function () {
      var sample = global.ETABSDemo.samples.filter(function (s) { return s.id === id; })[0];
      if (!sample) { hideProgress(); toast('Unknown sample "' + id + '"', 'err'); return; }
      var text = global.ETABSDemo.text(id);
      S.source = { kind: 'sample', id: id, name: sample.name };
      parseAsync('e2k', text, sample.file).then(function (model) { loadModel(model); });
    }, 20);
  }

  function loadModel(model) {
    S.model = model;
    Units.set(guessUnitSystem(model));

    if (!S.viewer) {
      S.viewer = global.ETABSViewer.create($('canvas'));
      S.overlays = global.ETABSOverlays.create(S.viewer);
      emit('viewer-created');
    }

    resetViewState(model);
    A.computeLoads();                     // the load map is ready before first paint
    if (S.history) S.history.clear();

    return S.viewer.load(model, function (p) { showProgress(0.25 + p * 0.7); }).then(function () {
      hideProgress();
      $('dropzone').classList.add('hide');
      S.viewer.resize();
      S.viewer.frameAll(false);
      $('fileChip').hidden = false;
      $('fileName').textContent = model.meta.fileName;
      $('fileChip').setAttribute('data-tip',
        (model.meta.title ? model.meta.title + ' — ' : '') + model.meta.source);

      S.viewer.setQualityPreset(S.quality);
      S.viewer.setEnvironment(S.environment);
      S.viewer.setRenderStyle(S.renderStyle);
      emit('model-loaded', model);

      if (S.viewer.autoLines) {
        toast('Large model — started in fast wireframe. Solid is in Display style.');
      }
      // Skipped metadata records are not problems and never surface as alerts;
      // they live in the file diagnostic for anyone who wants them.
      model.meta.warnings.slice(0, 2).forEach(function (w) { toast(w); });
    });
  }

  /**
   * Put every view-level choice back to its default. Preferences that belong
   * to the person rather than the model — theme, palette, saved views, the
   * rate card, panel widths — are deliberately left alone.
   */
  function resetViewState(model) {
    S.typeOn = {};
    S.keyOff = {};
    S.hidden = {};
    S.isolation = null;
    S.compare = null;
    S.filter.conditions = [];
    S.filter.lastIds = null;
    S.colorMode = 'type';
    S.renderStyle = 'solid';
    S.scope = 'visible';
    S.ghostMode = true;
    S.clip = A.defaultClip();
    S.explode = { storey: 0, radial: 0, type: 0 };
    S.load.basis = 'service';
    S.load.scope = 'building';
    S.load.result = null;
    S.measure = { mode: null, points: [], pinned: 0 };
    S.storeyRange = [0, model.stories.length - 1];

    if (S.overlays) S.overlays.reset();
    if (S.viewer) {
      S.viewer.setClipPlanes([]);
      S.viewer.setExplode(0, 0, 0);
      S.viewer.setProjection('persp');
      S.viewer.setTurntable(false, false);
      S.viewer.setWalk(false);
    }
  }

  /** A plain-English description of where the current model came from. */
  function sourceLabel() {
    if (!S.source) return '';
    if (S.source.kind === 'sample') return 'the sample “' + S.source.name + '”';
    return S.source.name;
  }

  /**
   * Re-read the original file and rebuild from scratch. Re-parsing rather than
   * resetting in place is deliberate: the viewer annotates element objects as
   * it builds, so a genuinely clean model is cheaper to get from the bytes
   * than to unpick.
   */
  function reloadModel() {
    if (!S.source) { toast('There is nothing to reload'); return Promise.resolve(); }
    showProgress(0.05);

    if (S.source.kind === 'sample') {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var text = global.ETABSDemo.text(S.source.id);
          var sample = global.ETABSDemo.samples.filter(function (x) { return x.id === S.source.id; })[0];
          parseAsync('e2k', text, sample.file)
            .then(loadModel)
            .then(function () { toast('Model reloaded — every change discarded', 'ok'); resolve(); });
        }, 20);
      });
    }

    var file = S.source.file;
    if (!file) { hideProgress(); toast('The original file is no longer available', 'err'); return Promise.resolve(); }

    if (S.source.format === 'xlsx') {
      return file.arrayBuffer()
        .then(function (buf) { return Exporter.readWorkbook(buf); })
        .then(function (tables) { return loadModel(Parser.parse('tables', tables, file.name)); })
        .then(function () { toast('Model reloaded — every change discarded', 'ok'); })
        .catch(reloadFailed);
    }

    return file.text()
      .then(function (text) {
        return parseAsync(S.source.format, text, file.name, function (p) { showProgress(0.15 + p * 0.1); });
      })
      .then(loadModel)
      .then(function () { toast('Model reloaded — every change discarded', 'ok'); })
      .catch(reloadFailed);
  }

  function reloadFailed(err) {
    hideProgress();
    toast('Could not reload that file: ' + ((err && err.message) || 'unknown error') +
      '. Open it again from File & model.', 'err');
  }

  function guessUnitSystem(model) {
    var l = (model.meta.units.length || 'M').toUpperCase();
    if (l === 'MM') return 'N-mm';
    if (l === 'FT') return 'kip-ft';
    if (l === 'IN') return 'kip-in';
    return 'kN-m';
  }

  function closeModel() {
    if (S.viewer) S.viewer.clearModel();
    if (S.overlays) S.overlays.reset();
    S.model = null;
    S.source = null;
    $('dropzone').classList.remove('hide');
    $('fileChip').hidden = true;
    $('stElements').textContent = 'No model loaded';
    $('ladder').innerHTML = '';
    emit('model-closed');
  }

  /* ================================================================== */
  /* Comparison                                                          */
  /* ================================================================== */

  function applyCompare(revision) {
    var diff = Analysis.compare(S.model, revision);
    S.compare = { model: revision, diff: diff };
    A.computeColors();
    emit('compare', S.compare);
    toast('Compared with ' + revision.meta.fileName + ' — ' +
      diff.summary.modified + ' modified, ' + diff.summary.added + ' added, ' +
      diff.summary.removed + ' removed');
  }

  function clearCompare() {
    S.compare = null;
    A.computeColors();
    emit('compare', null);
    toast('Comparison cleared');
  }

  /* ================================================================== */
  /* Saving                                                              */
  /* ================================================================== */

  function save(filename, data) {
    return Exporter.deliver(filename, data).then(function (r) {
      if (r.status === 'saved') toast('Saved ' + filename, 'ok');
      else if (r.status === 'delivered') toast('Sent ' + filename, 'ok');
      else if (r.message) toast(r.message, 'err');
      return r;
    });
  }

  function baseName() {
    return (S.model.meta.fileName || 'model')
      .replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 48);
  }

  /* ---- Images ------------------------------------------------------- */

  /** Paint the load colour scale, its range and the load case onto a capture. */
  function drawLoadLegend(ctx, W, H) {
    var L = global.ETABSLoads;
    var r = S.load.result;
    var pad = Math.round(W * 0.018);
    var barW = Math.round(W * 0.26);
    var barH = Math.max(10, Math.round(H * 0.016));
    var fs = Math.max(12, Math.round(W * 0.0125));
    var x = pad * 1.6;
    var y = H - pad * 1.6 - barH - fs * 2.2;

    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    roundRect(ctx, x - pad * 0.7, y - fs * 1.7, barW + pad * 1.4, barH + fs * 3.6, fs * 0.5);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#10151b';
    ctx.font = '600 ' + fs + 'px "Barlow Semi Condensed", system-ui, sans-serif';
    ctx.fillText(r.basisLabel + (r.selfWeight ? ' + self weight' : ''), x, y - fs * 0.5);

    var grad = ctx.createLinearGradient(x, 0, x + barW, 0);
    for (var i = 0; i <= 10; i++) grad.addColorStop(i / 10, L.rampCss(i / 10));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);
    ctx.strokeStyle = 'rgba(16,25,35,.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barW, barH);

    ctx.fillStyle = '#46555f';
    ctx.font = (fs * 0.85) + 'px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText('0', x, y + barH + fs * 1.1);
    var right = 'slab ' + L.fmt(r.slabMax, 'kN/m²') + '  ·  beam ' + L.fmt(r.beamMax, 'kN/m');
    ctx.fillText(right, x + barW - ctx.measureText(right).width, y + barH + fs * 1.1);
    ctx.restore();
  }

  function watermark(dataUrl, transparent) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // In load mode the image is meaningless without its scale, so the
        // legend and the load case are drawn into the picture itself.
        if (S.colorMode === 'load' && S.load.result) drawLoadLegend(ctx, img.width, img.height);

        var pad = Math.round(img.width * 0.018);
        var fs = Math.max(13, Math.round(img.width * 0.0145));
        ctx.font = '600 ' + fs + 'px "Barlow Semi Condensed", system-ui, sans-serif';
        var text = A.BRAND.name.toUpperCase() + '  ·  ' + A.BRAND.site;
        var w = ctx.measureText(text).width;

        ctx.globalAlpha = transparent ? 0.75 : 0.9;
        ctx.fillStyle = 'rgba(12,17,21,.55)';
        roundRect(ctx, img.width - w - pad * 2.4, img.height - fs - pad * 2.1,
          w + pad * 1.6, fs + pad * 1.15, fs * 0.45);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, img.width - w - pad * 1.6, img.height - pad * 1.45);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function exportPng(transparent) {
    if (!S.model) return;
    var scale = S.captureScale || 2;
    var url = S.viewer.capture(scale, transparent);
    return watermark(url, transparent).then(function (stamped) {
      var name = baseName() + (transparent ? '-transparent' : '') +
        '-' + (scale === 4 ? '4k' : scale + 'x') + '.png';
      return save(name, Exporter.dataUrlToBlob(stamped));
    });
  }

  /* ---- Tabular ------------------------------------------------------ */

  function currentQuantities() {
    var scope = A.scopeIds();
    return { q: Analysis.quantities(S.model, scope.ids), scope: scope };
  }

  /**
   * Measured steel for the costing, when the bars have been drawn. Without
   * it the bill falls back to the assumed kg/m³ rate card.
   */
  function measuredSteel() {
    var r = S.rebar.result;
    if (!r || !r.byType.length) return null;
    return { byType: r.byType, totals: r.totals };
  }

  function exportBom() {
    if (!S.model) return;
    var c = currentQuantities();
    save(baseName() + '-bom.csv', Exporter.bomCsv(S.model, c.q));
  }

  function exportElements() {
    if (!S.model) return;
    save(baseName() + '-elements.csv', Exporter.elementsCsv(S.model, Units));
  }

  function exportStats() {
    if (!S.model) return;
    save(baseName() + '-statistics.csv', Exporter.statsCsv(S.model, Analysis.statistics(S.model), Units));
  }

  /** Floor table as CSV, plus the per-element list, as two files. */
  function exportLoads() {
    if (!S.model) return;
    var r = S.load.result || A.computeLoads();
    if (!r) return;
    save(baseName() + '-loads-by-floor.csv', Exporter.loadsCsv(S.model, r));
    setTimeout(function () {
      save(baseName() + '-loads-by-element.csv', Exporter.loadElementsCsv(S.model, r));
    }, 400);
  }

  /** Bar schedule and steel summaries, as two CSV files. */
  function exportRebar() {
    if (!S.model) return;
    var r = S.rebar.result;
    if (!r) { toast('Turn the reinforcement on first — Reinforcement & bars', 'err'); return; }
    save(baseName() + '-bar-schedule.csv', Exporter.rebarCsv(S.model, r));
    setTimeout(function () {
      save(baseName() + '-steel-by-element.csv', Exporter.rebarElementsCsv(S.model, r));
    }, 400);
  }

  function exportHealth() {
    if (!S.model) return;
    save(baseName() + '-health.csv', Exporter.healthCsv(S.model, Analysis.healthChecks(S.model)));
  }

  function exportCompare() {
    if (!S.compare) { toast('Load a revision to compare first'); return; }
    save(baseName() + '-revision-changes.csv', Exporter.compareCsv(S.compare.diff));
  }

  function exportBoqCsv() {
    if (!S.model) return;
    var c = currentQuantities();
    var billData = Costing.bill(c.q, S.costing, {
      builtUpArea: c.q.totals.slab, measuredSteel: measuredSteel()
    });
    save(baseName() + '-boq.csv', Exporter.csv(Costing.billCsv(billData, S.model, A.scopeSentence())));
  }

  /* ---- Workbook ----------------------------------------------------- */

  function exportWorkbook() {
    if (!S.model) return;
    toast('Building the workbook…');
    setTimeout(function () {
      try {
        var c = currentQuantities();
        var blob = global.ETABSBOQ.workbook({
          model: S.model,
          quantities: c.q,
          settings: S.costing,
          stats: Analysis.statistics(S.model),
          basis: A.scopeSentence(),
          ids: c.scope.ids,
          brand: A.BRAND,
          loads: S.load.result || A.computeLoads(),
          rebar: S.rebar.result,
          measuredSteel: measuredSteel(),
          Units: Units
        });
        save(baseName() + '-BOQ.xlsx', blob);
      } catch (err) {
        toast('The workbook could not be built: ' + err.message, 'err');
      }
    }, 30);
  }

  /* ---- 3D ----------------------------------------------------------- */

  function exportObj() {
    if (!S.model) return;
    if (S.viewer.autoLines) {
      toast('This model is in fast wireframe — there is no solid geometry to export.', 'err');
      return;
    }
    toast('Building the 3D export…');
    setTimeout(function () {
      var out = Exporter.objFromViewer(S.viewer, S.model);
      var blob = Exporter.zip([
        { name: 'model.obj', text: out.obj },
        { name: 'model.mtl', text: out.mtl },
        { name: 'README.txt', text:
          'Exported from Structura — the ' + A.BRAND.name + ' ETABS viewer.\n' +
          'Source file: ' + S.model.meta.fileName + '\n' +
          'Triangles: ' + out.triangles + '\n' +
          'Axis convention: Y is up (converted from the structural Z-up model).\n' +
          'Only elements visible at export time are included.\n' }
      ]);
      save(baseName() + '-model.zip', blob);
    }, 30);
  }

  /* ---- Sample files -------------------------------------------------- */

  function downloadSamples() {
    var files = global.ETABSDemo.samples.map(function (s) {
      return { name: s.file, text: global.ETABSDemo.text(s.id) };
    });
    files.push({ name: 'README.txt', text:
      'Sample ETABS text models, generated by Structura (' + A.BRAND.name + ').\n\n' +
      global.ETABSDemo.samples.map(function (s) { return s.file + ' — ' + s.name + '\n    ' + s.note; }).join('\n') +
      '\n\nThese are ordinary .e2k files: open them in a text editor to see the grammar, ' +
      'or drop them back into the viewer.\n' });
    save('Structura-sample-models.zip', Exporter.zip(files));
  }

  /* ---- PDF ----------------------------------------------------------- */

  function exportPdf() {
    if (!S.model) return;
    toast('Rendering the report…');
    var views = [];
    var original = S.viewer.captureView();

    function shoot(viewName, title, caption) {
      S.viewer.setView(viewName);
      return new Promise(function (resolve) {
        setTimeout(function () {
          views.push({ title: title, dataUrl: S.viewer.capture(2, false), caption: caption });
          resolve();
        }, 620);
      });
    }

    shoot('iso', 'Isometric view', 'Coloured by ' + S.colorMode + ', ' + S.renderStyle + ' style.')
      .then(function () { return shoot('front', 'Front elevation', 'Looking along the +Y axis.'); })
      .then(function () { return shoot('top', 'Plan', 'Looking down the Z axis.'); })
      .then(function () {
        S.viewer.restoreView(original);
        var c = currentQuantities();
        var code = global.ETABSCode.screen(S.model);
        return Exporter.pdfReport({
          model: S.model,
          stats: Analysis.statistics(S.model),
          qty: c.q,
          findings: Analysis.healthChecks(S.model).concat(code.findings),
          units: Units,
          views: views,
          loads: S.load.result || A.computeLoads(),
          rebar: S.rebar.result,
          brand: A.BRAND,
          logo: A.BRAND.logo
        });
      })
      .then(function (blob) { return save(baseName() + '-report.pdf', blob); })
      .catch(function (err) {
        toast('The report could not be built: ' + (err.message || 'unknown error'), 'err');
      });
  }

  /* ================================================================== */
  /* View state sharing                                                  */
  /* ================================================================== */

  /**
   * A view state is copied as text rather than a URL: the app runs inside a
   * frame whose address the page cannot rely on, and a pasteable token works
   * in an email, a chat message or a comment without depending on that.
   */
  function copyViewState() {
    if (!S.model) return;
    var token = 'STRUCTURA/1|' + btoa(unescape(encodeURIComponent(JSON.stringify({
      file: S.model.meta.fileName,
      snap: A.captureSnapshot(),
      units: Units.current
    }))));
    var done = function () {
      toast('View state copied — paste it into View & camera → Restore a view state', 'ok');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(token).then(done, function () { showToken(token); });
    } else showToken(token);
  }

  function showToken(token) {
    emit('show-token', token);
  }

  function restoreViewState(token) {
    try {
      var body = String(token).trim().replace(/^STRUCTURA\/1\|/, '');
      var data = JSON.parse(decodeURIComponent(escape(atob(body))));
      if (data.units) Units.set(data.units);
      A.pushHistory('restore a shared view');
      A.applySnapshot(data.snap);
      toast(data.file && data.file !== S.model.meta.fileName
        ? 'View restored — note it was saved from ' + data.file
        : 'View restored');
      return true;
    } catch (e) {
      toast('That does not look like a Structura view state', 'err');
      return false;
    }
  }

  global.FILES = {
    on: on,
    handleFile: handleFile, loadSample: loadSample, loadModel: loadModel, closeModel: closeModel,
    reloadModel: reloadModel, sourceLabel: sourceLabel,
    diagnose: function () {
      if (!S.model) { toast('Open a model first'); return; }
      emit('diagnose', { model: S.model, reason: 'requested' });
    },
    applyCompare: applyCompare, clearCompare: clearCompare,
    save: save, baseName: baseName, currentQuantities: currentQuantities,
    exportPng: exportPng, exportPdf: exportPdf, exportBom: exportBom, exportElements: exportElements,
    exportStats: exportStats, exportHealth: exportHealth, exportCompare: exportCompare,
    exportLoads: exportLoads, exportRebar: exportRebar, measuredSteel: measuredSteel,
    exportBoqCsv: exportBoqCsv, exportWorkbook: exportWorkbook, exportObj: exportObj,
    downloadSamples: downloadSamples,
    copyViewState: copyViewState, restoreViewState: restoreViewState,
    showProgress: showProgress, hideProgress: hideProgress
  };
})(window);
