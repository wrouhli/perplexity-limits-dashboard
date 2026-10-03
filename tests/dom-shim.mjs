/* A deliberately tiny DOM shim: just enough of the browser for app.js to
   run headlessly under Node or gjs, so the render path (including the
   chart, the paste fallback and the failure path) is actually executed
   in tests instead of being taken on trust.

   This is test scaffolding, not a DOM implementation. */

export function createElement(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    value: '',
    title: '',
    href: '',
    download: '',
    checked: false,
    style: {},
    dataset: {},
    attrs: {},
    handlers: {},
    classes: new Set(),
    children: [],
  };
  el.classList = {
    add: (...names) => names.forEach((n) => el.classes.add(n)),
    remove: (...names) => names.forEach((n) => el.classes.delete(n)),
    contains: (n) => el.classes.has(n),
    toggle: (n, force) => {
      const on = force === undefined ? !el.classes.has(n) : Boolean(force);
      if (on) el.classes.add(n);
      else el.classes.delete(n);
      return on;
    },
  };
  el.setAttribute = (k, v) => {
    el.attrs[k] = String(v);
  };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  el.addEventListener = (type, fn) => {
    (el.handlers[type] ||= []).push(fn);
  };
  el.removeEventListener = () => {};
  el.dispatch = (type, event = {}) => (el.handlers[type] || []).forEach((fn) => fn(event));
  el.querySelectorAll = () => [];
  el.querySelector = () => null;
  el.closest = () => null;
  el.click = () => el.dispatch('click', { target: el });
  el.lastChild = { textContent: '' };
  return el;
}

/** Reads a file on Node or gjs, whichever is hosting the test. */
export async function readText(path) {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs/promises');
    return fs.readFile(path, 'utf8');
  }
  const GLib = imports.gi.GLib;
  const [ok, bytes] = GLib.file_get_contents(path);
  if (!ok) throw new Error(`could not read ${path}`);
  return new TextDecoder().decode(bytes);
}

/**
 * Installs the shim on globalThis and returns handles for assertions.
 * @param {{snapshot: object, history: string, demo?: boolean}} input
 */
export function installDOM(input) {
  const registry = new Map();
  const fetches = [];
  const intervals = [];
  const documentHandlers = {};

  const get = (id) => {
    if (!registry.has(id)) registry.set(id, createElement('div', id));
    return registry.get(id);
  };

  const locationStub = { protocol: 'https:', search: input.search ?? '' };

  const documentStub = {
    documentElement: createElement('html'),
    body: createElement('body'),
    getElementById: get,
    createElement: (tag) => createElement(tag),
    addEventListener: (type, fn) => {
      (documentHandlers[type] ||= []).push(fn);
    },
    dispatch: (type, event = {}) => (documentHandlers[type] || []).forEach((fn) => fn(event)),
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  const env = {
    document: documentStub,
    get,
    fetches,
    intervals,
    documentHandlers,
    charts: [],
    failSnapshot: false,
    failHistory: false,
    failChart: false,
    snapshot: input.snapshot,
    history: input.history ?? '',
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async settle(timeoutMs = 1000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        await env.sleep(5);
        if (get('dashboard').classes.has('visible') || get('paste-zone').classes.has('visible')) return;
      }
    },
  };

  class ChartStub {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.destroyed = false;
      env.charts.push(this);
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const g = globalThis;
  // Some hosts expose read-only globals (gjs has `window`, Node 21+ has
  // `navigator`), so assignments have to be defensive.
  const defineGlobal = (name, value) => {
    try {
      g[name] = value;
    } catch {
      try {
        Object.defineProperty(g, name, { value, configurable: true, writable: true });
      } catch {
        /* already provided by the host; the value below is equivalent */
      }
    }
  };

  defineGlobal('document', documentStub);
  defineGlobal('navigator', {});
  defineGlobal('location', locationStub);
  defineGlobal('requestAnimationFrame', () => 1);
  defineGlobal('cancelAnimationFrame', () => {});
  defineGlobal('setInterval', (fn, ms) => {
    intervals.push({ fn, ms });
    return intervals.length;
  });
  defineGlobal('clearInterval', () => {});
  defineGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#123456' }));
  defineGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }));
  defineGlobal('Chart', ChartStub);
  defineGlobal('Blob', class Blob {
    constructor(parts) {
      this.parts = parts;
    }
  });
  if (!g.performance) defineGlobal('performance', { now: () => Date.now() });

  // gjs has no URLSearchParams; Node and browsers do.
  if (!g.URLSearchParams) {
    defineGlobal(
      'URLSearchParams',
      class URLSearchParams {
        constructor(init = '') {
          this.pairs = String(init)
            .replace(/^\?/, '')
            .split('&')
            .filter(Boolean)
            .map((pair) => {
              const [key, value = ''] = pair.split('=');
              return [decodeURIComponent(key), decodeURIComponent(value)];
            });
        }

        has(key) {
          return this.pairs.some(([k]) => k === key);
        }

        get(key) {
          const hit = this.pairs.find(([k]) => k === key);
          return hit ? hit[1] : null;
        }

        toString() {
          return this.pairs.map(([k, v]) => `${k}=${v}`).join('&');
        }
      }
    );
  }

  if (!g.URL) defineGlobal('URL', {});
  g.URL.createObjectURL = () => 'blob:stub';
  g.URL.revokeObjectURL = () => {};

  // gjs exposes `window` as a read-only alias of the global object, so this
  // has to be defensive rather than a plain assignment. Node has no `window`
  // at all, which is why it is defined rather than assumed.
  const win = typeof g.window === 'object' && g.window !== null ? g.window : g;
  if (typeof g.window !== 'object') defineGlobal('window', win);
  win.matchMedia = g.matchMedia;
  win.requestAnimationFrame = g.requestAnimationFrame;
  win.location = g.location;
  if (typeof win.addEventListener !== 'function') win.addEventListener = () => {};

  const fetchStub = async (url) => {
    const target = String(url);
    fetches.push(target);
    if (target.startsWith('./data/latest.json')) {
      if (env.failSnapshot) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => env.snapshot };
    }
    if (target.startsWith('./data/history.jsonl')) {
      if (env.failHistory) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => env.history };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };

  env.fetch = fetchStub;
  env.activate = () => {
    defineGlobal('document', documentStub);
    defineGlobal('location', locationStub);
    defineGlobal('fetch', fetchStub);
  };
  env.activate();

  return env;
}
