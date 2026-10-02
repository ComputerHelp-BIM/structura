/**
 * ui.js — Panels, tooltips, action popups, history.
 * =================================================================
 * The interaction substrate the rest of the app sits on:
 *
 *   Panels   resizable rail / stage / drawer with live re-measure
 *   Tips     fast custom tooltips that say what a control does, in words
 *   Menu     right-click and "what next?" action popups
 *   Ask      confirmation prompts before slow or destructive actions
 *   History  one undo stack covering everything the user can change
 *
 * Namespace: window.ETABSUI
 */
(function (global) {
  'use strict';

  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, html) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  /* ================================================================== */
  /* Resizable panels                                                    */
  /* ================================================================== */

  /**
   * A divider the user drags. The 3-D canvas is re-measured on every
   * animation frame during the drag rather than at the end, because a
   * viewport that only catches up on mouse-up is exactly the bug that left
   * a dead band beside the model.
   */
  function Panels(opts) {
    this.onResize = opts.onResize || function () {};
    this.panels = {};
    this.dragging = null;
  }

  Panels.prototype.register = function (name, element, config) {
    this.panels[name] = {
      name: name,
      el: element,
      min: config.min,
      max: config.max,
      def: config.def,
      side: config.side,          // 'left' | 'right'
      varName: config.varName,    // CSS custom property to drive
      width: config.def
    };
    return this;
  };

  Panels.prototype.setWidth = function (name, px, persist) {
    var p = this.panels[name];
    if (!p) return;
    var max = Math.min(p.max, Math.max(p.min, global.innerWidth - 360));
    p.width = Math.round(Math.max(p.min, Math.min(max, px)));
    doc.documentElement.style.setProperty(p.varName, p.width + 'px');
    if (persist !== false) this.persist();
    this.onResize();
  };

  Panels.prototype.reset = function (name) { this.setWidth(name, this.panels[name].def); };

  Panels.prototype.persist = function () {
    var out = {};
    var self = this;
    Object.keys(this.panels).forEach(function (k) { out[k] = self.panels[k].width; });
    try { localStorage.setItem('structura.panelWidths', JSON.stringify(out)); } catch (e) { /* private mode */ }
  };

  Panels.prototype.restore = function () {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('structura.panelWidths') || 'null'); } catch (e) { saved = null; }
    var self = this;
    Object.keys(this.panels).forEach(function (k) {
      var w = (saved && saved[k]) || self.panels[k].def;
      self.setWidth(k, w, false);
    });
  };

  /**
   * Attach a grip element as the handle for a panel.
   * @param {HTMLElement} grip
   * @param {string} name Panel key registered above.
   */
  Panels.prototype.attach = function (grip, name) {
    var self = this;
    var p = this.panels[name];
    if (!p) return;

    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', 'Resize panel — drag, or use the arrow keys');

    var raf = null, pending = null;

    function frame() {
      raf = null;
      if (pending === null) return;
      self.setWidth(name, pending, false);
      pending = null;
    }

    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('dragging');
      doc.body.classList.add('resizing');
      self.dragging = { name: name, startX: e.clientX, startW: p.width };
    });

    grip.addEventListener('pointermove', function (e) {
      if (!self.dragging || self.dragging.name !== name) return;
      var dx = e.clientX - self.dragging.startX;
      pending = self.dragging.startW + (p.side === 'left' ? dx : -dx);
      if (!raf) raf = requestAnimationFrame(frame);
    });

    function end() {
      if (!self.dragging || self.dragging.name !== name) return;
      grip.classList.remove('dragging');
      doc.body.classList.remove('resizing');
      self.dragging = null;
      self.persist();
      self.onResize();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);

    grip.addEventListener('dblclick', function () { self.reset(name); });

    grip.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 48 : 16;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        self.setWidth(name, p.width + (p.side === 'left' ? -step : step));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        self.setWidth(name, p.width + (p.side === 'left' ? step : -step));
      } else if (e.key === 'Home') {
        e.preventDefault();
        self.reset(name);
      }
    });
  };

  /* ================================================================== */
  /* Tooltips                                                            */
  /* ================================================================== */

  /**
   * One floating tip element for the whole page. Controls opt in with a
   * `data-tip` attribute; `data-key` adds the keyboard shortcut. Text should
   * say what the control *does*, in one short line — not repeat its label.
   */
  var Tips = {
    node: null,
    timer: null,
    current: null,
    delay: 260,

    init: function () {
      this.node = el('div', 'tipbox');
      this.node.setAttribute('role', 'tooltip');
      doc.body.appendChild(this.node);
      var self = this;

      doc.addEventListener('pointerover', function (e) {
        var target = e.target.closest ? e.target.closest('[data-tip]') : null;
        if (!target || target === self.current) return;
        self.schedule(target);
      });
      doc.addEventListener('pointerout', function (e) {
        var target = e.target.closest ? e.target.closest('[data-tip]') : null;
        if (target && target === self.current) self.hide();
      });
      doc.addEventListener('pointerdown', function () { self.hide(); });
      doc.addEventListener('focusin', function (e) {
        var target = e.target.closest ? e.target.closest('[data-tip]') : null;
        if (target) self.show(target);
      });
      doc.addEventListener('focusout', function () { self.hide(); });
      global.addEventListener('scroll', function () { self.hide(); }, true);
      return this;
    },

    schedule: function (target) {
      var self = this;
      clearTimeout(this.timer);
      // Once one tip is open, the next appears immediately — moving along a
      // toolbar should not mean waiting again at every button.
      var wait = this.node.classList.contains('show') ? 40 : this.delay;
      this.timer = setTimeout(function () { self.show(target); }, wait);
    },

    show: function (target) {
      // A tip must never sit over an open action menu — the menu is the thing
      // asking for a decision, and its title is what gets covered.
      if (this.suppressed) return;
      var text = target.getAttribute('data-tip');
      if (!text) return;
      this.current = target;
      var key = target.getAttribute('data-key');
      this.node.innerHTML = '';
      var span = el('span');
      span.textContent = text;
      this.node.appendChild(span);
      if (key) {
        var kb = el('kbd');
        kb.textContent = key;
        this.node.appendChild(kb);
      }
      this.node.classList.add('show');

      var r = target.getBoundingClientRect();
      var tw = this.node.offsetWidth, th = this.node.offsetHeight;
      var place = target.getAttribute('data-tip-place') || 'auto';
      var top, left;

      if (place === 'right' || (place === 'auto' && r.left < 180 && r.width < 80)) {
        left = r.right + 9;
        top = r.top + r.height / 2 - th / 2;
      } else if (place === 'left') {
        left = r.left - tw - 9;
        top = r.top + r.height / 2 - th / 2;
      } else if (r.top < th + 18) {
        left = r.left + r.width / 2 - tw / 2;
        top = r.bottom + 9;
      } else {
        left = r.left + r.width / 2 - tw / 2;
        top = r.top - th - 9;
      }
      left = Math.max(8, Math.min(global.innerWidth - tw - 8, left));
      top = Math.max(8, Math.min(global.innerHeight - th - 8, top));
      this.node.style.left = Math.round(left) + 'px';
      this.node.style.top = Math.round(top) + 'px';
    },

    hide: function () {
      clearTimeout(this.timer);
      this.current = null;
      if (this.node) this.node.classList.remove('show');
    }
  };

  /* ================================================================== */
  /* Action popup                                                        */
  /* ================================================================== */

  /**
   * A floating list of choices. Used for the right-click menu on an element,
   * for the "what next?" prompt, and for confirmations — one component, so
   * every decision point in the app looks and behaves the same way.
   */
  var Menu = {
    node: null,
    onOpen: null,
    onClose: null,

    init: function () {
      this.node = el('div', 'actionmenu');
      this.node.hidden = true;
      doc.body.appendChild(this.node);
      var self = this;
      doc.addEventListener('pointerdown', function (e) {
        if (self.node.hidden) return;
        if (!self.node.contains(e.target)) self.close();
      });
      doc.addEventListener('keydown', function (e) {
        if (self.node.hidden) return;
        if (e.key === 'Escape') { e.stopPropagation(); self.close(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          self.move(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
          var sel = self.node.querySelector('.am-item.sel');
          if (sel) { e.preventDefault(); sel.click(); }
        }
      });
      return this;
    },

    move: function (d) {
      var items = [].slice.call(this.node.querySelectorAll('.am-item'));
      if (!items.length) return;
      var i = items.findIndex(function (n) { return n.classList.contains('sel'); });
      items.forEach(function (n) { n.classList.remove('sel'); });
      var next = items[(i + d + items.length) % items.length];
      next.classList.add('sel');
      next.scrollIntoView({ block: 'nearest' });
    },

    /**
     * @param {{title, subtitle, items:[{label, note, icon, kind, run}], x, y, anchor}} opts
     */
    open: function (opts) {
      var self = this;
      this.node.innerHTML = '';
      this.node.className = 'actionmenu' + (opts.wide ? ' wide' : '');

      if (opts.title) {
        var head = el('div', 'am-head');
        var t = el('strong');
        t.textContent = opts.title;
        head.appendChild(t);
        if (opts.subtitle) {
          var s = el('span');
          s.textContent = opts.subtitle;
          head.appendChild(s);
        }
        this.node.appendChild(head);
      }

      var list = el('div', 'am-list');
      (opts.items || []).forEach(function (it, i) {
        if (it.divider) { list.appendChild(el('div', 'am-divider')); return; }
        var b = el('button', 'am-item' + (i === 0 ? ' sel' : '') + (it.kind ? ' ' + it.kind : ''));
        b.innerHTML = '<span class="am-ico">' + (it.icon || '') + '</span>' +
          '<span class="am-text"><b></b><em></em></span>' +
          (it.key ? '<kbd>' + it.key + '</kbd>' : '');
        b.querySelector('b').textContent = it.label;
        b.querySelector('em').textContent = it.note || '';
        if (!it.note) b.querySelector('em').remove();
        b.addEventListener('click', function () {
          self.close();
          if (it.run) it.run();
        });
        list.appendChild(b);
      });
      this.node.appendChild(list);

      if (opts.footer) {
        var f = el('div', 'am-foot');
        f.textContent = opts.footer;
        this.node.appendChild(f);
      }

      Tips.hide();
      Tips.suppressed = true;
      this.node.hidden = false;
      var w = this.node.offsetWidth, h = this.node.offsetHeight;
      var x = opts.x, y = opts.y;
      if (opts.anchor) {
        var r = opts.anchor.getBoundingClientRect();
        x = r.left; y = r.bottom + 6;
      }
      if (x === undefined) x = (global.innerWidth - w) / 2;
      if (y === undefined) y = (global.innerHeight - h) / 2;
      this.node.style.left = Math.round(Math.max(8, Math.min(global.innerWidth - w - 8, x))) + 'px';
      this.node.style.top = Math.round(Math.max(8, Math.min(global.innerHeight - h - 8, y))) + 'px';
      return this;
    },

    close: function () {
      if (this.node) this.node.hidden = true;
      Tips.suppressed = false;
    }
  };

  /**
   * Ask before doing something slow or destructive. Resolves true when the
   * user confirms. Never used for ordinary actions — a confirmation on
   * everything trains people to click through without reading.
   */
  function confirmAction(opts) {
    return new Promise(function (resolve) {
      Menu.open({
        title: opts.title,
        subtitle: opts.detail,
        items: [
          { label: opts.confirmLabel || 'Yes, do it', note: opts.confirmNote, kind: 'primary', run: function () { resolve(true); } },
          { label: 'Cancel', note: opts.cancelNote, run: function () { resolve(false); } }
        ],
        x: opts.x, y: opts.y, anchor: opts.anchor, wide: true
      });
    });
  }

  /* ================================================================== */
  /* History                                                             */
  /* ================================================================== */

  /**
   * A single undo stack over *state snapshots*, not over inverse operations.
   * Snapshots are small (camera numbers plus a few maps), and snapshotting
   * sidesteps a whole class of bugs where an inverse operation drifts out of
   * step with the forward one.
   *
   * @param {{capture:Function, apply:Function, limit:number}} opts
   */
  function History(opts) {
    this.capture = opts.capture;
    this.apply = opts.apply;
    this.limit = opts.limit || 80;
    this.past = [];
    this.future = [];
    this.suspended = 0;
    this.listeners = [];
  }

  History.prototype.onChange = function (fn) { this.listeners.push(fn); return this; };
  History.prototype.emit = function () {
    var self = this;
    this.listeners.forEach(function (fn) { fn(self.describe()); });
  };

  /** Record the state *before* an action, labelled with what the action is. */
  History.prototype.push = function (label) {
    if (this.suspended) return;
    this.past.push({ label: label, state: this.capture() });
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    this.emit();
  };

  History.prototype.undo = function () {
    if (!this.past.length) return null;
    var entry = this.past.pop();
    this.future.push({ label: entry.label, state: this.capture() });
    this.suspended++;
    try { this.apply(entry.state); } finally { this.suspended--; }
    this.emit();
    return entry.label;
  };

  History.prototype.redo = function () {
    if (!this.future.length) return null;
    var entry = this.future.pop();
    this.past.push({ label: entry.label, state: this.capture() });
    this.suspended++;
    try { this.apply(entry.state); } finally { this.suspended--; }
    this.emit();
    return entry.label;
  };

  History.prototype.describe = function () {
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past.length ? this.past[this.past.length - 1].label : null,
      redoLabel: this.future.length ? this.future[this.future.length - 1].label : null,
      depth: this.past.length
    };
  };

  History.prototype.clear = function () {
    this.past.length = 0;
    this.future.length = 0;
    this.emit();
  };

  /** Run a function without recording anything (e.g. while restoring). */
  History.prototype.silent = function (fn) {
    this.suspended++;
    try { return fn(); } finally { this.suspended--; }
  };

  global.ETABSUI = {
    Panels: function (opts) { return new Panels(opts); },
    History: function (opts) { return new History(opts); },
    Tips: Tips,
    Menu: Menu,
    confirmAction: confirmAction
  };
})(window);
