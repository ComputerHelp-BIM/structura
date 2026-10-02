/**
 * audio.js — Generative ambient engine.
 * =================================================================
 * Fifteen original tracks, synthesised in the browser from oscillators,
 * filtered noise and a procedurally generated reverb impulse. Nothing is
 * sampled, streamed or licensed: the whole library costs zero bytes and
 * never repeats identically, because every phrase is chosen at schedule
 * time from the track's own scale and density rules.
 *
 * Four archetypes cover the four families the brief asked for — calm pads,
 * lo-fi keys, cinematic swells and generated nature textures — each
 * parameterised per track. Mood biases brightness and voicing; tempo scales
 * the scheduler.
 *
 * Namespace: window.ETABSAudio
 */
(function (global) {
  'use strict';

  var LOOKAHEAD_MS = 25;      // scheduler wake interval
  var SCHEDULE_AHEAD = 0.35;  // seconds of events queued in front of now

  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function pick(arr, rnd) { return arr[Math.floor((rnd || Math.random()) * arr.length) % arr.length]; }

  /* ------------------------------------------------------------------ */
  /* Track definitions                                                   */
  /* ------------------------------------------------------------------ */

  var TRACKS = [
    // --- Calm: pads, drones, deep space ---
    { id: 'deep-field',   name: 'Deep Field',      family: 'Calm',      bpm: 44, arch: 'pad',
      root: 33, scale: [0, 3, 7, 10, 14], cutoff: 700,  bed: 'air',  note: 'Slow minor pad, five-note voicing' },
    { id: 'slow-tide',    name: 'Slow Tide',       family: 'Calm',      bpm: 40, arch: 'pad',
      root: 36, scale: [0, 5, 7, 12, 17], cutoff: 560,  bed: 'swell', note: 'Suspended fourths, tidal filter' },
    { id: 'glass-atrium', name: 'Glass Atrium',    family: 'Calm',      bpm: 52, arch: 'pad',
      root: 40, scale: [0, 4, 7, 11, 14], cutoff: 1400, bed: 'air',  note: 'Bright major seventh, long reverb' },
    { id: 'long-span',    name: 'Long Span',       family: 'Calm',      bpm: 38, arch: 'pad',
      root: 31, scale: [0, 7, 12, 19],    cutoff: 480,  bed: null,   note: 'Open fifths, sub-heavy drone' },

    // --- Lo-fi: warm keys, soft beats ---
    { id: 'drafting-table', name: 'Drafting Table', family: 'Lo-fi',   bpm: 76, arch: 'lofi',
      root: 45, scale: [0, 3, 5, 7, 10], cutoff: 1800, swing: 0.16, note: 'Dusty keys, brushed hats' },
    { id: 'site-office',    name: 'Site Office',    family: 'Lo-fi',   bpm: 82, arch: 'lofi',
      root: 43, scale: [0, 2, 3, 7, 9],  cutoff: 1500, swing: 0.2,  note: 'Dorian keys, soft kick' },
    { id: 'blue-hour',      name: 'Blue Hour',      family: 'Lo-fi',   bpm: 70, arch: 'lofi',
      root: 41, scale: [0, 3, 7, 10, 12], cutoff: 1200, swing: 0.22, note: 'Late, warm, tape-slow' },
    { id: 'grid-lines',     name: 'Grid Lines',     family: 'Lo-fi',   bpm: 88, arch: 'lofi',
      root: 48, scale: [0, 2, 5, 7, 10], cutoff: 2200, swing: 0.1,  note: 'Tighter pulse, clean keys' },

    // --- Cinematic: builds, swells ---
    { id: 'cantilever',   name: 'Cantilever',      family: 'Cinematic', bpm: 60, arch: 'cine',
      root: 36, scale: [0, 3, 7, 10, 15], cutoff: 900,  note: 'Rising swell over a low pulse' },
    { id: 'load-path',    name: 'Load Path',       family: 'Cinematic', bpm: 66, arch: 'cine',
      root: 34, scale: [0, 5, 7, 12, 14], cutoff: 1100, note: 'Stepped arpeggio, wide stereo' },
    { id: 'topping-out',  name: 'Topping Out',     family: 'Cinematic', bpm: 54, arch: 'cine',
      root: 38, scale: [0, 4, 7, 9, 11],  cutoff: 1600, note: 'Major swell, bell overtones' },

    // --- Nature: generated textures ---
    { id: 'monsoon',   name: 'Monsoon',     family: 'Nature', bpm: 50, arch: 'nature',
      texture: 'rain',   root: 38, scale: [0, 3, 7, 10], note: 'Rain on glass, distant thunder' },
    { id: 'harbour',   name: 'Harbour',     family: 'Nature', bpm: 46, arch: 'nature',
      texture: 'ocean',  root: 33, scale: [0, 5, 7, 12], note: 'Slow surf, buoy tones' },
    { id: 'canopy',    name: 'Canopy',      family: 'Nature', bpm: 58, arch: 'nature',
      texture: 'forest', root: 45, scale: [0, 2, 4, 7, 9], note: 'Leaves, birds, soft light' },
    { id: 'high-wind', name: 'High Wind',   family: 'Nature', bpm: 42, arch: 'nature',
      texture: 'wind',   root: 31, scale: [0, 7, 12],     note: 'Wind across a tower crane' }
  ];

  /* ------------------------------------------------------------------ */
  /* Engine                                                              */
  /* ------------------------------------------------------------------ */

  function Engine() {
    this.ctx = null;
    this.tracks = TRACKS.slice();
    this.userTracks = [];
    this.index = 0;
    this.playing = false;
    this.volume = 0.55;
    this.mood = 0.5;     // 0 darker / slower-moving, 1 brighter / busier
    this.tempo = 1.0;
    this.shuffleOn = false;
    this.listeners = {};
    this.voices = [];
    this.step = 0;
    this.nextNoteTime = 0;
  }

  Engine.prototype.on = function (evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
    return this;
  };
  Engine.prototype.emit = function (evt, d) {
    (this.listeners[evt] || []).forEach(function (f) { f(d); });
  };

  /** Audio contexts may only start from a user gesture — call on click. */
  Engine.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    var ctx = this.ctx = new Ctx();

    this.master = ctx.createGain();
    this.master.gain.value = 0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.82;
    this.levels = new Uint8Array(this.analyser.frequencyBinCount);

    // Gentle bus compression keeps swells from clipping the mix.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.02;
    this.comp.release.value = 0.35;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 4.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.42;

    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.38;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.3;
    this.delayGain = ctx.createGain();
    this.delayGain.gain.value = 0.0;

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.85;

    this.dry.connect(this.comp);
    this.reverbGain.connect(this.reverb);
    this.reverb.connect(this.comp);
    this.delayGain.connect(this.delay);
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.noiseBuffer = makeNoise(ctx, 3);
    return ctx;
  };

  Engine.prototype.allTracks = function () { return this.tracks.concat(this.userTracks); };
  Engine.prototype.current = function () { return this.allTracks()[this.index] || null; };

  Engine.prototype.play = function (index) {
    var ctx = this.ensure();
    if (!ctx) { this.emit('error', 'Web Audio is unavailable in this browser.'); return; }
    if (index !== undefined) this.index = Math.max(0, Math.min(this.allTracks().length - 1, index));
    this.stopVoices();
    var track = this.current();
    if (!track) return;

    this.playing = true;
    this.step = 0;
    this.nextNoteTime = ctx.currentTime + 0.08;

    if (track.userFile) {
      this.playUserTrack(track);
    } else {
      this.delayGain.gain.setTargetAtTime(track.arch === 'lofi' || track.arch === 'cine' ? 0.28 : 0.1, ctx.currentTime, 0.4);
      this.startScheduler();
    }
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 1.2);
    this.emit('track', track);
    this.emit('state', true);
  };

  Engine.prototype.playUserTrack = function (track) {
    var ctx = this.ctx, self = this;
    var el = track.audio;
    if (!track.source) {
      track.source = ctx.createMediaElementSource(el);
      track.source.connect(this.dry);
      el.addEventListener('ended', function () { self.next(); });
    }
    el.loop = false;
    el.currentTime = 0;
    var p = el.play();
    if (p && p.catch) p.catch(function () { self.emit('error', 'That file could not be played.'); });
  };

  Engine.prototype.pause = function () {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.25);
    this.playing = false;
    var tr = this.current();
    if (tr && tr.audio) tr.audio.pause();
    var self = this;
    clearInterval(this.timer); this.timer = null;
    setTimeout(function () { if (!self.playing) self.stopVoices(); }, 700);
    this.emit('state', false);
  };

  Engine.prototype.toggle = function () { this.playing ? this.pause() : this.play(); };

  Engine.prototype.next = function () {
    var n = this.allTracks().length;
    if (!n) return;
    this.index = this.shuffleOn
      ? Math.floor(Math.random() * n)
      : (this.index + 1) % n;
    this.play(this.index);
  };
  Engine.prototype.prev = function () {
    var n = this.allTracks().length;
    if (!n) return;
    this.index = (this.index - 1 + n) % n;
    this.play(this.index);
  };

  Engine.prototype.setVolume = function (v) {
    this.volume = v;
    if (this.ctx && this.playing) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12);
    }
  };
  Engine.prototype.setMood = function (v) { this.mood = v; };
  Engine.prototype.setTempo = function (v) { this.tempo = v; };
  Engine.prototype.setShuffle = function (on) { this.shuffleOn = !!on; };

  Engine.prototype.getLevels = function () {
    if (!this.analyser || !this.playing) return null;
    this.analyser.getByteFrequencyData(this.levels);
    return this.levels;
  };

  Engine.prototype.stopVoices = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    this.voices.forEach(function (v) {
      try { v.stop(ctx.currentTime + 0.05); } catch (e) { /* already stopped */ }
    });
    this.voices = [];
    clearInterval(this.timer); this.timer = null;
  };

  Engine.prototype.startScheduler = function () {
    var self = this;
    clearInterval(this.timer);
    this.timer = setInterval(function () { self.tick(); }, LOOKAHEAD_MS);
  };

  Engine.prototype.tick = function () {
    var ctx = this.ctx, track = this.current();
    if (!ctx || !track || !this.playing) return;
    var beat = 60 / (track.bpm * this.tempo) / 2;  // eighth-note grid
    while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      this.scheduleStep(track, this.step, this.nextNoteTime);
      this.nextNoteTime += beat;
      this.step++;
    }
  };

  Engine.prototype.scheduleStep = function (track, step, time) {
    switch (track.arch) {
      case 'pad':    return this.stepPad(track, step, time);
      case 'lofi':   return this.stepLofi(track, step, time);
      case 'cine':   return this.stepCine(track, step, time);
      case 'nature': return this.stepNature(track, step, time);
    }
  };

  /* ---- Voice primitives --------------------------------------------- */

  Engine.prototype.tone = function (opts) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter = ctx.createBiquadFilter();

    osc.type = opts.type || 'sine';
    osc.frequency.value = opts.freq;
    if (opts.detune) osc.detune.value = opts.detune;

    filter.type = 'lowpass';
    filter.frequency.value = opts.cutoff || 2000;
    filter.Q.value = opts.q || 0.8;

    var t = opts.time;
    var a = opts.attack || 0.01, d = opts.decay || 0.4, s = opts.sustain || 0, r = opts.release || 0.4;
    var peak = opts.gain === undefined ? 0.2 : opts.gain;

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + a);
    if (s > 0) {
      gain.gain.linearRampToValueAtTime(peak * 0.7, t + a + d);
      gain.gain.setValueAtTime(peak * 0.7, t + a + d + s);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d + s + r);
    } else {
      gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d + r);
    }

    osc.connect(filter); filter.connect(gain);
    gain.connect(this.dry);
    if (opts.reverb !== 0) {
      var send = ctx.createGain();
      send.gain.value = opts.reverb === undefined ? 0.5 : opts.reverb;
      gain.connect(send); send.connect(this.reverbGain);
    }
    if (opts.delay) {
      var ds = ctx.createGain();
      ds.gain.value = opts.delay;
      gain.connect(ds); ds.connect(this.delayGain);
    }
    if (opts.pitchTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.pitchTo, t + (opts.pitchTime || 0.2));
    }
    if (opts.sweep) {
      filter.frequency.setValueAtTime(opts.cutoff || 2000, t);
      filter.frequency.linearRampToValueAtTime(opts.sweep, t + a + d + s + r);
    }

    osc.start(t);
    var stopAt = t + a + d + s + r + 0.1;
    osc.stop(stopAt);
    this.voices.push(osc);
    var self = this;
    osc.onended = function () {
      var i = self.voices.indexOf(osc);
      if (i >= 0) self.voices.splice(i, 1);
      osc.disconnect(); filter.disconnect(); gain.disconnect();
    };
    return osc;
  };

  Engine.prototype.noise = function (opts) {
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    var filter = ctx.createBiquadFilter();
    filter.type = opts.filterType || 'bandpass';
    filter.frequency.value = opts.freq || 900;
    filter.Q.value = opts.q || 1.0;

    var gain = ctx.createGain();
    var t = opts.time;
    var a = opts.attack || 0.2, h = opts.hold || 0.5, r = opts.release || 0.8;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.gain || 0.08, t + a);
    gain.gain.setValueAtTime(opts.gain || 0.08, t + a + h);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r);

    if (opts.sweepTo) {
      filter.frequency.linearRampToValueAtTime(opts.sweepTo, t + a + h + r);
    }

    src.connect(filter); filter.connect(gain); gain.connect(this.dry);
    if (opts.reverb) {
      var send = ctx.createGain();
      send.gain.value = opts.reverb;
      gain.connect(send); send.connect(this.reverbGain);
    }
    src.start(t);
    src.stop(t + a + h + r + 0.05);
    this.voices.push(src);
    var self = this;
    src.onended = function () {
      var i = self.voices.indexOf(src);
      if (i >= 0) self.voices.splice(i, 1);
      src.disconnect(); filter.disconnect(); gain.disconnect();
    };
    return src;
  };

  /* ---- Archetype: evolving pad --------------------------------------- */

  Engine.prototype.stepPad = function (track, step, time) {
    var bright = 0.5 + this.mood;
    var cutoff = track.cutoff * bright;

    // New chord every 16 eighths; the voicing walks the scale slowly so the
    // harmony drifts instead of looping.
    if (step % 16 === 0) {
      var degree = Math.floor(step / 16) % track.scale.length;
      var chord = [0, 2, 4].map(function (i) {
        return track.root + track.scale[(degree + i) % track.scale.length] +
               12 * Math.floor((degree + i) / track.scale.length);
      });
      var self = this;
      chord.forEach(function (n, i) {
        [0, -7, 7].forEach(function (det) {
          self.tone({
            time: time + i * 0.05, freq: midi(n), type: i === 0 ? 'triangle' : 'sawtooth',
            detune: det, cutoff: cutoff, gain: 0.06 - i * 0.012,
            attack: 2.2, decay: 1.5, sustain: 3.4, release: 3.6,
            reverb: 0.75, sweep: cutoff * 1.5
          });
        });
      });
      // Sub-octave root anchors the chord.
      this.tone({
        time: time, freq: midi(track.root - 12), type: 'sine',
        cutoff: 220, gain: 0.1, attack: 2.5, decay: 2, sustain: 3, release: 3, reverb: 0.2
      });
    }

    // A high glint every so often, more often at higher mood.
    if (step % 8 === 0 && Math.random() < 0.28 + this.mood * 0.3) {
      var n2 = track.root + 24 + pick(track.scale);
      this.tone({
        time: time, freq: midi(n2), type: 'sine', cutoff: 6000,
        gain: 0.05, attack: 0.02, decay: 1.6, release: 2.4, reverb: 0.9, delay: 0.35
      });
    }

    if (track.bed && step % 32 === 0) {
      this.noise({
        time: time, freq: track.bed === 'air' ? 2400 : 500, q: 0.7,
        gain: 0.022 + this.mood * 0.012, attack: 3, hold: 2, release: 4,
        sweepTo: track.bed === 'air' ? 5200 : 260, reverb: 0.6
      });
    }
  };

  /* ---- Archetype: lo-fi keys ----------------------------------------- */

  Engine.prototype.stepLofi = function (track, step, time) {
    var swing = (step % 2 === 1) ? (track.swing || 0.15) * (60 / (track.bpm * this.tempo)) / 4 : 0;
    var t = time + swing;
    var cutoff = track.cutoff * (0.6 + this.mood * 0.8);
    var bar = Math.floor(step / 8);

    // Kick on 1 and the "and" of 3 — sparse, never busy.
    if (step % 8 === 0) {
      this.tone({ time: t, freq: 110, pitchTo: 42, pitchTime: 0.09, type: 'sine',
        cutoff: 400, gain: 0.32, attack: 0.004, decay: 0.26, release: 0.08, reverb: 0.08 });
    }
    if (step % 8 === 5) {
      this.tone({ time: t, freq: 96, pitchTo: 40, pitchTime: 0.08, type: 'sine',
        cutoff: 360, gain: 0.2, attack: 0.004, decay: 0.2, release: 0.06, reverb: 0.08 });
    }

    // Brushed hat on every off-eighth, humanised in level.
    if (step % 2 === 1) {
      this.noise({ time: t, freq: 7200, q: 1.4, filterType: 'highpass',
        gain: 0.018 + Math.random() * 0.014, attack: 0.002, hold: 0.008, release: 0.05, reverb: 0.15 });
    }

    // Bass on the bar.
    if (step % 8 === 0) {
      var bn = track.root - 12 + track.scale[bar % track.scale.length];
      this.tone({ time: t, freq: midi(bn), type: 'triangle', cutoff: 420,
        gain: 0.16, attack: 0.02, decay: 0.5, sustain: 0.3, release: 0.4, reverb: 0.12 });
    }

    // Chord stab, slightly behind the beat for the dragged feel.
    if (step % 4 === 0) {
      var deg = (bar * 2) % track.scale.length;
      var self = this;
      [0, 2, 4].forEach(function (i, k) {
        var n = track.root + 12 + track.scale[(deg + i) % track.scale.length] +
                12 * Math.floor((deg + i) / track.scale.length);
        self.tone({
          time: t + 0.012 * k + 0.02, freq: midi(n), type: 'triangle',
          cutoff: cutoff, gain: 0.07, attack: 0.012, decay: 0.9, release: 1.1,
          reverb: 0.4, delay: 0.22
        });
      });
    }

    // Melodic fragment, appearing more often as mood rises.
    if (step % 2 === 0 && Math.random() < 0.12 + this.mood * 0.26) {
      var mn = track.root + 24 + pick(track.scale);
      this.tone({ time: t, freq: midi(mn), type: 'sine', cutoff: 4200,
        gain: 0.06, attack: 0.008, decay: 0.45, release: 0.6, reverb: 0.55, delay: 0.3 });
    }

    // Tape hiss bed.
    if (step % 32 === 0) {
      this.noise({ time: t, freq: 3600, q: 0.5, gain: 0.012, attack: 2, hold: 4, release: 3, reverb: 0.2 });
    }
  };

  /* ---- Archetype: cinematic swell ------------------------------------ */

  Engine.prototype.stepCine = function (track, step, time) {
    var phase = Math.floor(step / 32) % 4;   // four-phase build
    var intensity = (phase + 1) / 4;
    var cutoff = track.cutoff * (0.5 + this.mood + intensity * 0.6);
    var self = this;

    if (step % 32 === 0) {
      var deg = phase % track.scale.length;
      [0, 2, 4, 6].forEach(function (i, k) {
        var n = track.root + track.scale[(deg + i) % track.scale.length] +
                12 * Math.floor((deg + i) / track.scale.length);
        self.tone({
          time: time + k * 0.03, freq: midi(n), type: k % 2 ? 'sawtooth' : 'triangle',
          detune: (k - 1.5) * 6, cutoff: cutoff, gain: 0.05 + intensity * 0.04,
          attack: 3.4, decay: 1.2, sustain: 2.6, release: 3.8, reverb: 0.85, sweep: cutoff * 2.2
        });
      });
      // Low pulse marking the phase change.
      this.tone({ time: time, freq: midi(track.root - 24), type: 'sine', cutoff: 160,
        gain: 0.18 + intensity * 0.1, attack: 0.02, decay: 1.4, release: 1.8, reverb: 0.3 });
      this.noise({ time: time, freq: 240, q: 0.6, gain: 0.05 * intensity,
        attack: 2.4, hold: 0.4, release: 2.2, sweepTo: 1800, reverb: 0.8 });
    }

    // Stepped arpeggio, denser in later phases.
    var density = [4, 4, 2, 2][phase];
    if (step % density === 0 && phase >= 1) {
      var n2 = track.root + 12 + track.scale[(step / density) % track.scale.length] +
               (phase >= 3 ? 12 : 0);
      this.tone({
        time: time, freq: midi(n2), type: 'triangle', cutoff: cutoff * 2,
        gain: 0.055 * intensity, attack: 0.01, decay: 0.5, release: 0.9,
        reverb: 0.7, delay: 0.4
      });
    }

    // Bell overtone at the peak of each cycle.
    if (step % 128 === 96) {
      this.tone({ time: time, freq: midi(track.root + 36), type: 'sine', cutoff: 9000,
        gain: 0.08, attack: 0.005, decay: 3.2, release: 3.6, reverb: 0.95 });
    }
  };

  /* ---- Archetype: generated nature ----------------------------------- */

  Engine.prototype.stepNature = function (track, step, time) {
    var tex = track.texture;
    var density = 0.4 + this.mood * 0.6;

    if (tex === 'rain') {
      // A continuous filtered bed plus individual droplets.
      if (step % 8 === 0) {
        this.noise({ time: time, freq: 3200, q: 0.4, gain: 0.05 + this.mood * 0.02,
          attack: 1.2, hold: 1.6, release: 1.6, sweepTo: 2600, reverb: 0.5 });
      }
      for (var d = 0; d < 3; d++) {
        if (Math.random() < 0.45 * density) {
          this.noise({ time: time + Math.random() * 0.3, freq: 5000 + Math.random() * 4000,
            q: 6, gain: 0.02, attack: 0.001, hold: 0.004, release: 0.05, reverb: 0.4 });
        }
      }
      if (step % 64 === 0 && Math.random() < 0.5) {
        this.noise({ time: time, freq: 90, q: 0.5, gain: 0.12, attack: 0.9, hold: 0.5,
          release: 3.4, sweepTo: 40, reverb: 0.9 });
      }
    } else if (tex === 'ocean') {
      if (step % 16 === 0) {
        this.noise({ time: time, freq: 700, q: 0.4, gain: 0.07,
          attack: 2.6, hold: 0.6, release: 3.2, sweepTo: 260, reverb: 0.7 });
      }
      if (step % 48 === 8) {
        this.tone({ time: time, freq: midi(track.root), type: 'sine', cutoff: 500,
          gain: 0.09, attack: 0.4, decay: 2.2, release: 3, reverb: 0.9 });
      }
    } else if (tex === 'forest') {
      if (step % 12 === 0) {
        this.noise({ time: time, freq: 2200, q: 0.8, gain: 0.03,
          attack: 1.4, hold: 0.8, release: 1.8, sweepTo: 3800, reverb: 0.6 });
      }
      // Birdsong: a short rising pair of pitches, sparsely.
      if (Math.random() < 0.10 * density) {
        var base = midi(track.root + 24 + pick(track.scale));
        this.tone({ time: time, freq: base, pitchTo: base * 1.32, pitchTime: 0.09,
          type: 'sine', cutoff: 9000, gain: 0.045, attack: 0.01, decay: 0.1, release: 0.12, reverb: 0.8 });
        this.tone({ time: time + 0.17, freq: base * 1.18, pitchTo: base * 1.5, pitchTime: 0.07,
          type: 'sine', cutoff: 9000, gain: 0.038, attack: 0.01, decay: 0.09, release: 0.12, reverb: 0.8 });
      }
    } else { // wind
      if (step % 8 === 0) {
        this.noise({ time: time, freq: 380 + Math.random() * 700, q: 2.4,
          gain: 0.055 + this.mood * 0.02, attack: 1.8, hold: 0.8, release: 2.4,
          sweepTo: 200 + Math.random() * 1400, reverb: 0.75 });
      }
      if (step % 40 === 0) {
        this.tone({ time: time, freq: midi(track.root + pick(track.scale)), type: 'sine',
          cutoff: 900, gain: 0.05, attack: 2.4, decay: 1.4, sustain: 1, release: 3, reverb: 0.9 });
      }
    }
  };

  /* ---- User-supplied audio ------------------------------------------- */

  /**
   * Add a viewer's own file as a track for this session only. The object
   * URL stays local: nothing is uploaded anywhere.
   */
  Engine.prototype.addUserFile = function (file) {
    this.ensure();
    var url = URL.createObjectURL(file);
    var audio = new Audio();
    audio.src = url;
    audio.crossOrigin = 'anonymous';
    var track = {
      id: 'user-' + this.userTracks.length,
      name: file.name.replace(/\.[^.]+$/, ''),
      family: 'Your files',
      note: 'Added from this device',
      userFile: true, audio: audio, url: url
    };
    this.userTracks.push(track);
    this.emit('library', this.allTracks());
    return this.tracks.length + this.userTracks.length - 1;
  };

  Engine.prototype.removeUserTracks = function () {
    var self = this;
    this.userTracks.forEach(function (t) {
      try { t.audio.pause(); URL.revokeObjectURL(t.url); } catch (e) { /* noop */ }
    });
    this.userTracks = [];
    if (this.index >= this.tracks.length) this.index = 0;
    this.emit('library', self.allTracks());
  };

  /* ------------------------------------------------------------------ */
  /* Buffers                                                             */
  /* ------------------------------------------------------------------ */

  /** Exponentially decaying noise — a convincing hall without an IR file. */
  function makeImpulse(ctx, seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        // A short pre-delay keeps the early reflections from muddying the attack.
        var env = Math.pow(1 - t, decay) * (i < rate * 0.012 ? 0.15 : 1);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  function makeNoise(ctx, seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  global.ETABSAudio = {
    create: function () { return new Engine(); },
    TRACKS: TRACKS
  };
})(window);
