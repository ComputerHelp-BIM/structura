/**
 * parse-worker.js — Model parsing off the main thread.
 * =================================================================
 * The parser modules attach themselves to `window`; a worker has no window,
 * so it is aliased to `self` before they load. Nothing else changes, which
 * means the same code runs on both threads and there is no second parser to
 * keep in step.
 *
 * The app falls back to main-thread parsing if a worker cannot start, so
 * this is an optimisation, never a dependency.
 */
/* eslint-env worker */
self.window = self;

try {
  importScripts('sections.js', 'parser.js');
} catch (e) {
  self.postMessage({ ok: false, fatal: true, error: 'Parser modules failed to load in the worker.' });
}

self.onmessage = function (event) {
  var job = event.data || {};
  var started = Date.now();
  try {
    if (!self.ETABSParser) throw new Error('Parser unavailable');
    self.postMessage({ progress: 0.05, id: job.id });
    var model = self.ETABSParser.parse(job.kind, job.payload, job.fileName);
    self.postMessage({
      ok: true,
      id: job.id,
      model: model,
      workerMs: Date.now() - started
    });
  } catch (err) {
    self.postMessage({
      ok: false,
      id: job.id,
      error: (err && err.message) ? err.message : 'Parsing failed'
    });
  }
};
