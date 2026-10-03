/* ═══════════════════════════════════════════════════════════════
   PERPLEXITY LIMITS DASHBOARD — rendering
   Pure logic lives in lib.js. This file only touches the DOM.

   Data comes from ./data/latest.json (+ ./data/history.jsonl), which
   sit next to this file, so there is no cross-origin request anywhere.
   If those files are missing the page falls back to paste mode.
   Wahid Rouhli / Konnectoos
═══════════════════════════════════════════════════════════════ */

import * as L from './lib.js';

const DATA_URL = './data/latest.json';
const HISTORY_URL = './data/history.jsonl';
const STALE_AFTER_HOURS = 6;
const TICK_MS = 30000;

const state = {
  model: null,
  history: [],
  windowDays: 30,
  chart: null,
  installPrompt: null,
};

const el = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const charts = {};
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ── status ─────────────────────────────────────────────────── */

function setStatus(kind, text) {
  const dot = el('status-dot');
  dot.className = 'status-dot' + (kind === 'loading' ? ' loading' : kind === 'error' ? ' error' : '');
  dot.title = text;
  el('last-updated').textContent = text;
}

function showStaleBanner(model) {
  const banner = el('stale-banner');
  if (!model?.fetchedAt || model.demo) {
    banner.classList.remove('visible');
    return;
  }
  const ageMs = Date.now() - new Date(model.fetchedAt).getTime();
  const hours = ageMs / 3600000;
  if (hours < STALE_AFTER_HOURS) {
    banner.classList.remove('visible');
    return;
  }
  banner.innerHTML = `<strong>Showing last known data</strong> — refreshed ${esc(
    L.describeAge(model.fetchedAt)
  )}. The refresh job may need attention.`;
  banner.classList.add('visible');
}

function showDemoChip(model) {
  el('demo-chip').classList.toggle('visible', Boolean(model?.demo));
}

/* ── quota cards ────────────────────────────────────────────── */

const KPI_ICONS = {
  pro: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  research: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  labs: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0a4 4 0 0 0 4 4 4 4 0 0 0 4-4M9 14H5a2 2 0 0 1-2-2V8m16 6h-4"/>',
  agentic: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
};

function renderQuotas(model) {
  const container = el('kpi-grid');
  container.innerHTML = model.quotas
    .map((q) => {
      const badge = L.classify(q.remaining, q.monthly);
      const pctText =
        q.remaining !== null && q.monthly ? L.fmtPct(q.remaining / q.monthly) : '';
      return `<article class="kpi-card" aria-label="${esc(q.label)}: ${badge.label}">
        <div class="kpi-top">
          <div class="kpi-icon ${esc(q.icon)}" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${KPI_ICONS[q.icon] ?? ''}</svg>
          </div>
          <span class="kpi-badge ${badge.cls}">${badge.label}</span>
        </div>
        <div>
          <div class="kpi-number${q.remaining === 0 ? ' zero' : ''}" ${q.remaining === null ? '' : `data-countup="${q.remaining}"`}>${q.remaining === null ? '—' : '0'}</div>
          <div class="kpi-label">${esc(q.label)}${pctText ? ` · ${pctText}` : ''}</div>
        </div>
        <div class="kpi-desc">${esc(q.desc)}</div>
      </article>`;
    })
    .join('');

  container.querySelectorAll('[data-countup]').forEach((node) => {
    const target = Number.parseInt(node.dataset.countup, 10);
    if (Number.isFinite(target)) countUp(node, target);
  });
}

function countUp(node, target, duration = 900) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.textContent = target.toLocaleString();
    return;
  }
  const start = performance.now();
  const step = (ts) => {
    const p = Math.min((ts - start) / duration, 1);
    const eased = 1 - (1 - p) ** 3;
    node.textContent = Math.round(eased * target).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── reset countdown ────────────────────────────────────────── */

function renderReset(model) {
  const strip = el('reset-strip');
  if (!model.resetAt) {
    strip.classList.remove('visible');
    return;
  }
  strip.classList.add('visible');
  el('reset-when').textContent = new Date(model.resetAt).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  tickCountdown();
}

function tickCountdown() {
  if (!state.model?.resetAt) return;
  const left = L.formatCountdown(state.model.resetAt);
  el('reset-countdown').textContent = left ? `in ${left}` : 'any moment';
}

/* ── history chart ──────────────────────────────────────────── */

/**
 * The rows the current window selects, falling back to the whole series when
 * the window would leave the chart empty — an aged demo dataset, or opening
 * the page after a long gap, should still show a line.
 */
function pointsInWindow() {
  const points = L.withinDays(state.history, state.windowDays);
  if (points.length < 2 && state.history.length >= 2) return state.history;
  return points;
}

function renderHistory(model) {
  const section = el('history-section');
  const points = pointsInWindow();
  const series = L.seriesFor(points, 'pro');

  el('history-empty').classList.toggle('visible', series.length < 2);
  section.classList.toggle('visible', series.length >= 2);
  if (series.length < 2) return;

  const projection = L.projectExhaustion(points, 'pro');

  const summary = el('history-summary');
  const parts = [];
  if (projection.perDay !== null) {
    parts.push(`Draining ~${Math.abs(projection.perDay).toFixed(1)} Pro queries/day`);
  }
  if (projection.exhaustion) {
    parts.push(
      `at this rate you run out around ${projection.exhaustion.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })}`
    );
  } else if (projection.perDay !== null && projection.perDay >= -0.01) {
    parts.push('usage is flat or recovering');
  }
  summary.textContent = parts.length ? `${parts.join(' — ')}.` : 'Not enough history yet for a trend.';

  if (typeof Chart === 'undefined') {
    el('history-chart-note').classList.add('visible');
    return;
  }
  el('history-chart-note').classList.remove('visible');

  const labels = series.map((p) =>
    p.t.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  );
  const actual = series.map((p) => p.y);

  const projected = new Array(series.length).fill(null);
  if (projection.exhaustion) {
    const horizon = Math.min(6, Math.max(2, Math.ceil((projection.exhaustion - new Date()) / 86400000)));
    const lastY = series[series.length - 1].y;
    projected[series.length - 1] = lastY;
    for (let i = 1; i <= horizon; i++) {
      labels.push(`+${i}d`);
      actual.push(null);
      projected.push(Math.max(0, Math.round(lastY - Math.abs(projection.perDay) * i)));
    }
  }

  const data = {
    labels,
    datasets: [
      {
        label: 'Pro queries left',
        data: actual,
        borderColor: cssVar('--color-primary'),
        backgroundColor: cssVar('--color-primary-hl'),
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.25,
        fill: true,
        spanGaps: false,
      },
    ],
  };
  if (projected.some((v) => v !== null)) {
    data.datasets.push({
      label: 'Projected',
      data: projected,
      borderColor: cssVar('--color-warning'),
      borderDash: [5, 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      fill: false,
    });
  }

  state.chart?.destroy();
  state.chart = new Chart(el('history-chart'), {
    type: 'line',
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString?.() ?? ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 7, color: cssVar('--color-text-faint'), font: { size: 10 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: cssVar('--color-divider') },
          ticks: { color: cssVar('--color-text-faint'), font: { size: 10 } },
        },
      },
    },
  });
}

function renderVelocity() {
  const points = pointsInWindow();
  const container = el('velocity-list');
  const rows = state.model.sources
    .filter((s) => s.state === 'capped')
    .map((s) => {
      const perDay = L.deltaPerDay(points, s.key);
      if (perDay === null || perDay >= -0.01) return null;
      return { name: s.name, perDay };
    })
    .filter(Boolean)
    .sort((a, b) => a.perDay - b.perDay)
    .slice(0, 6);

  el('velocity-section').classList.toggle('visible', rows.length > 0);
  container.innerHTML = rows
    .map(
      (r) => `<div class="velocity-row">
        <span class="velocity-name">${esc(r.name)}</span>
        <span class="velocity-val">${Math.abs(r.perDay).toFixed(2)}/day</span>
      </div>`
    )
    .join('');
}

/* ── sources ────────────────────────────────────────────────── */

function renderSources(model) {
  const capped = model.sources.filter((s) => s.state === 'capped');
  el('capped-section').classList.toggle('visible', capped.length > 0);
  el('capped-grid').innerHTML = capped.length
    ? capped
        .map((s) => {
          const badge = L.classify(s.remaining, s.monthly);
          const used = s.monthly !== null && s.remaining !== null ? s.monthly - s.remaining : null;
          const color = L.progressColor(s.pct, s.remaining === 0);
          return `<article class="source-card" aria-label="${esc(s.name)}: ${badge.label}">
        <div class="source-card-header">
          <span class="source-card-name">${esc(s.name)}</span>
          <span class="source-card-tag">${esc(s.tag)}</span>
        </div>
        <div class="source-stats">
          <div class="source-stat-row"><span class="source-stat-label">Remaining</span><span class="source-stat-val" style="color:${color}">${L.fmt(s.remaining)}${s.monthly ? ` / ${L.fmt(s.monthly)}` : ''}</span></div>
          <div class="source-stat-row"><span class="source-stat-label">Used</span><span class="source-stat-val">${L.fmt(used)}</span></div>
        </div>
        <div class="source-progress-track"><div class="source-progress-fill" style="width:${(s.pct ?? 0) * 100}%;background:${color}"></div></div>
      </article>`;
        })
        .join('')
    : '<p class="empty-note">No capped data sources in this plan.</p>';
}

function renderConnectors(model) {
  const active = model.sources.filter((s) => s.state === 'unlimited');
  const unavailable = model.sources.filter((s) => s.state === 'not_in_plan');

  el('connectors-grid').innerHTML = active
    .map(
      (s) => `<div class="connector-chip" role="listitem" aria-label="${esc(s.name)} — active, no limit">
      <div class="conn-dot active" title="Active"></div>
      <div class="conn-info"><span class="conn-name">${esc(s.name)}</span><span class="conn-sub">${esc(s.tag)}</span></div>
    </div>`
    )
    .join('');

  el('unavail-grid').innerHTML = unavailable
    .map(
      (s) => `<div class="connector-chip unavailable" role="listitem" aria-label="${esc(s.name)} — not in plan">
      <div class="conn-dot off" title="Not available"></div>
      <div class="conn-info"><span class="conn-name">${esc(s.name)}</span><span class="conn-sub">${esc(s.tag)}</span></div>
    </div>`
    )
    .join('');

  el('unavail-section').style.display = unavailable.length ? '' : 'none';
}

/* ── raw + misc ─────────────────────────────────────────────── */

function renderRaw(model) {
  el('raw-block').textContent = JSON.stringify(model.raw, null, 2);
}

function renderAll(model) {
  state.model = model;
  el('skeleton-loader').style.display = 'none';
  el('paste-zone').classList.remove('visible');
  el('dashboard').classList.add('visible');

  renderQuotas(model);
  renderReset(model);
  renderHistory(model);
  renderVelocity();
  renderSources(model);
  renderConnectors(model);
  renderRaw(model);
  renderHistoryWindow();
  showStaleBanner(model);
  showDemoChip(model);
  setStatus(model.status === 'error' ? 'error' : 'ok', `Updated ${L.describeAge(model.fetchedAt)}`);
}

function renderHistoryWindow() {
  el('history-window').value = String(state.windowDays);
  el('history-window-wrap').classList.toggle('visible', state.history.length > 0);
}

/* ── loading ────────────────────────────────────────────────── */

async function fetchSnapshot() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return L.normalize(json, { fetchedAt: json.fetched_at, demo: json.demo });
}

async function fetchHistory() {
  const res = await fetch(`${HISTORY_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return [];
  return L.parseHistory(await res.text());
}

async function load() {
  setStatus('loading', 'Loading…');
  const forcePaste = new URLSearchParams(location.search).has('paste');

  const [snapshot, history] = await Promise.allSettled([
    forcePaste ? Promise.reject(new Error('paste mode requested')) : fetchSnapshot(),
    fetchHistory(),
  ]);
  state.history = history.status === 'fulfilled' ? history.value : [];

  if (snapshot.status === 'fulfilled') {
    renderAll(snapshot.value);
    return;
  }

  if (forcePaste) {
    showPasteMode('Paste the JSON from perplexity.ai/rest/rate-limit/all below.');
    return;
  }

  showPasteMode(
    snapshot.reason?.message === 'HTTP 404'
      ? 'No data/latest.json published yet. Paste your limits below, or enable the refresh workflow.'
      : `Could not load data (${snapshot.reason?.message ?? 'unknown error'}). Paste it below.`
  );
}

function showPasteMode(message) {
  el('skeleton-loader').style.display = 'none';
  el('dashboard').classList.remove('visible');
  el('paste-zone').classList.add('visible');
  el('paste-note').textContent = message;
  setStatus('error', 'Paste your data below');
}

/* ── exports ────────────────────────────────────────────────── */

function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/* ── wiring ─────────────────────────────────────────────────── */

function bindUI() {
  el('refresh-btn').addEventListener('click', async () => {
    el('refresh-btn').classList.add('spinning');
    await load();
    el('refresh-btn').classList.remove('spinning');
  });

  el('raw-toggle').addEventListener('click', () => {
    const open = el('raw-block').classList.toggle('open');
    el('raw-toggle').setAttribute('aria-expanded', String(open));
    el('raw-toggle-text').textContent = open ? 'Hide raw JSON' : 'Show raw JSON';
  });

  el('paste-submit').addEventListener('click', () => {
    const raw = el('paste-input').value.trim();
    el('paste-error').classList.remove('visible');
    try {
      const parsed = JSON.parse(raw);
      renderAll(L.normalize(parsed, { fetchedAt: new Date().toISOString() }));
    } catch (e) {
      el('paste-error').textContent = `Could not read that: ${e.message}`;
      el('paste-error').classList.add('visible');
    }
  });

  el('paste-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el('paste-submit').click();
  });

  document.addEventListener('paste', (e) => {
    if (!el('paste-zone').classList.contains('visible')) return;
    if (e.target === el('paste-input')) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    el('paste-input').value = text;
    el('paste-submit').click();
  });

  el('history-window').addEventListener('change', (e) => {
    state.windowDays = Number(e.target.value);
    renderHistory(state.model);
    renderVelocity();
  });

  el('paste-toggle').addEventListener('click', () => {
    showPasteMode('Paste the JSON from perplexity.ai/rest/rate-limit/all below.');
  });

  el('export-json').addEventListener('click', () => {
    download(
      `perplexity-limits-${stamp()}.json`,
      JSON.stringify({ latest: state.model?.raw ?? null, history: state.history.map((p) => ({ ...p, t: p.t.toISOString() })) }, null, 2)
    );
  });

  el('export-csv').addEventListener('click', () => {
    download(`perplexity-limits-${stamp()}.csv`, L.historyToCsv(state.history), 'text/csv');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      el('refresh-btn').click();
    }
  });
}

function initTheme() {
  const html = document.documentElement;
  const btn = el('theme-toggle');
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  const icon = (t) =>
    t === 'dark'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  const apply = (t) => {
    html.setAttribute('data-theme', t);
    btn.innerHTML = icon(t);
    btn.setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} mode`);
  };

  apply(theme);
  btn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    apply(theme);
    // Chart colours are read from CSS custom properties, so the chart has to
    // be redrawn to pick up the new theme's palette.
    if (state.model) renderHistory(state.model);
  });
}

function initInstall() {
  const btn = el('install-btn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    btn.classList.add('visible');
  });
  btn.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    btn.classList.remove('visible');
  });
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is a bonus, never a blocker */
  });
}

bindUI();
initTheme();
initInstall();
initServiceWorker();
setInterval(tickCountdown, TICK_MS);
setInterval(() => {
  if (state.model) setStatus('ok', `Updated ${L.describeAge(state.model.fetchedAt)}`);
  showStaleBanner(state.model);
}, 60000);
load();
