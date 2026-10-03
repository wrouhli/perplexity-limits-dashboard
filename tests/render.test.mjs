/* Integration test: runs the real app.js against a shimmed DOM, with the
   real committed data files, and inspects what it rendered.

   This is the closest thing to opening the page that CI can do.

   Run: node tests/render.test.mjs   (or: gjs -m tests/render.test.mjs)
*/

import { installDOM, readText } from './dom-shim.mjs';
import { ok, eq, countOf, report } from './harness.mjs';

const here = import.meta.url.replace(/^file:\/\//, '');
const root = here.replace(/\/tests\/[^/]+$/, '');

const snapshot = JSON.parse(await readText(`${root}/data/latest.json`));
const historyText = await readText(`${root}/data/history.jsonl`);

const snapshotWithoutLabs = {
  remaining_pro: 196,
  sources: { source_to_limit: {} },
};

const hostile = {
  remaining_pro: 10,
  sources: {
    source_to_limit: {
      '<img src=x onerror="alert(1)">': { remaining: 1, monthly_limit: 10 },
    },
  },
};

const pastePayload = {
  remaining_pro: 42,
  remaining_labs: 3,
  sources: { source_to_limit: { notion_mcp: { remaining: 5, monthly_limit: 10 } } },
};

/* ── main env: the published snapshot ───────────────────────── */
const env = installDOM({ snapshot, history: historyText });
await import('../app.js');
await env.settle();

eq(env.fetches.length, 2, 'the page requests exactly the snapshot and the history');
ok(env.fetches[0].startsWith('./data/latest.json'), 'snapshot is fetched same-origin');
ok(env.get('dashboard').classes.has('visible'), 'dashboard becomes visible');
ok(!env.get('paste-zone').classes.has('visible'), 'paste fallback stays hidden when data exists');
eq(env.get('skeleton-loader').style.display, 'none', 'skeleton is cleared');

const kpi = env.get('kpi-grid').innerHTML;
eq(countOf(kpi, 'class="kpi-card"'), 4, 'four quota cards rendered');
ok(kpi.includes(`data-countup="${snapshot.remaining_pro}"`), 'pro remaining rendered from the payload');
ok(kpi.includes('Pro Queries'), 'quota labels rendered');
ok(!kpi.includes('undefined'), 'no undefined leaked into the cards');

eq(countOf(env.get('capped-grid').innerHTML, 'class="source-card"'), 4, 'four capped sources rendered');
ok(env.get('capped-grid').innerHTML.includes('GitHub'), 'known source gets its friendly name');
ok(!env.get('capped-grid').innerHTML.includes('FactSet'), 'not-in-plan sources are not shown as capped');
ok(env.get('connectors-grid').innerHTML.includes('Web Search'), 'unlimited source listed as active');
ok(env.get('unavail-grid').innerHTML.includes('FactSet'), 'unavailable source listed separately');
ok(env.get('unavail-section').style.display !== 'none', 'unavailable section is shown when it has content');
ok(env.get('raw-block').textContent.includes('source_to_limit'), 'raw payload is dumped verbatim');

ok(env.get('demo-chip').classes.has('visible'), 'demo data is labelled');
ok(!env.get('stale-banner').classes.has('visible'), 'demo data is not nagged about being stale');

ok(env.get('reset-when').textContent.length > 0, 'reset date resolved from the payload');
ok(/^in \d+d \d+h$/.test(env.get('reset-countdown').textContent), `countdown rendered (${env.get('reset-countdown').textContent})`);
ok(env.get('reset-strip').classes.has('visible'), 'reset strip is shown');

eq(env.intervals.length, 2, 'countdown and freshness tickers registered');
ok(env.intervals.some((i) => i.ms === 30000), 'countdown ticks every 30s');
const before = env.get('reset-countdown').textContent;
env.intervals[0].fn();
eq(env.get('reset-countdown').textContent, before, 'countdown stays stable within the hour');

/* chart */
eq(env.charts.length, 1, 'one history chart created');
const chart = env.charts[0];
eq(chart.config.type, 'line', 'chart is a line chart');
eq(chart.config.data.datasets.length, 2, 'actual + projected series');
eq(chart.config.data.datasets[1].label, 'Projected', 'second series is the projection');
ok(chart.config.data.datasets[1].borderDash.length === 2, 'projection is dashed');
const points = chart.config.data.datasets[0].data.filter((v) => v !== null).length;
const expectedRows = historyText.split('\n').filter((line) => line.trim()).length;
eq(points, expectedRows, 'every history row is plotted');
ok(chart.config.data.datasets[1].data.slice(-1)[0] >= 0, 'projection never goes negative');
ok(env.get('history-summary').textContent.includes('Draining'), 'burn rate summarised in words');
ok(env.get('history-section').classes.has('visible'), 'history section visible');
ok(env.get('velocity-section').classes.has('visible'), 'per-source drain list visible');
ok(env.get('velocity-list').innerHTML.includes('/day'), 'velocity rows formatted');

/* controls */
env.get('history-window').handlers.change[0]({ target: { value: '7' } });
ok(env.charts.length > 1, 'changing the window redraws the chart');
ok(env.charts[0].destroyed, 'the previous chart is destroyed, not stacked');

env.get('theme-toggle').dispatch('click');
eq(env.document.documentElement.attrs['data-theme'], 'dark', 'theme toggle switches the theme');

env.get('raw-toggle').dispatch('click');
ok(env.get('raw-block').classes.has('open'), 'raw JSON can be revealed');
eq(env.get('raw-toggle-text').textContent, 'Hide raw JSON', 'raw toggle label updates');

/* ── paste mode is always reachable ─────────────────────────── */
const manual = installDOM({ snapshot, history: historyText });
manual.activate();
env.get('paste-toggle').dispatch('click');
await manual.settle();

ok(manual.get('paste-zone').classes.has('visible'), 'the Paste data button reveals the paste zone');
ok(!manual.get('dashboard').classes.has('visible'), 'opening paste mode hides the published view');
eq(manual.fetches.length, 0, 'opening paste mode fetches nothing');

const forced = installDOM({ snapshot, history: historyText, search: '?paste=1' });
forced.activate();
env.get('refresh-btn').dispatch('click');
await forced.settle();

ok(forced.get('paste-zone').classes.has('visible'), '?paste=1 forces paste mode');
eq(forced.fetches.filter((u) => u.includes('latest.json')).length, 0, '?paste=1 skips the snapshot request');
eq(forced.fetches.filter((u) => u.includes('history.jsonl')).length, 1, '?paste=1 still loads history');
ok(forced.get('paste-note').textContent.includes('Paste the JSON'), 'forced paste mode explains itself');

/* ── no fabricated zeros ────────────────────────────────────── */
const sparse = installDOM({ snapshot: snapshotWithoutLabs, history: '' });
sparse.activate();
env.get('refresh-btn').dispatch('click');
await sparse.settle();

const sparseKpi = sparse.get('kpi-grid').innerHTML;
eq(countOf(sparseKpi, '—'), 3, 'absent quotas render an em dash');
eq(countOf(sparseKpi, 'Depleted'), 0, 'absent quotas never claim Depleted');
eq(countOf(sparseKpi, 'data-countup'), 1, 'only the known quota counts up');
ok(!sparse.get('capped-section').classes.has('visible'), 'empty source list hides the section');
ok(!sparse.get('history-section').classes.has('visible'), 'no history hides the chart');
ok(sparse.get('history-empty').classes.has('visible'), 'no history shows the explanatory note');

/* ── escaping ───────────────────────────────────────────────── */
const nasty = installDOM({ snapshot: hostile, history: '' });
nasty.activate();
env.get('refresh-btn').dispatch('click');
await nasty.settle();

const nastyKpi = nasty.get('capped-grid').innerHTML;
ok(!nastyKpi.includes('<img'), 'markup in a source key is escaped, not injected');
ok(nastyKpi.includes('&lt;img'), 'escaped entity present instead');

/* ── failure path: no published data ────────────────────────── */
const broken = installDOM({ snapshot: {}, history: '' });
broken.activate();
broken.failSnapshot = true;
env.get('refresh-btn').dispatch('click');
await broken.settle();

ok(broken.get('paste-zone').classes.has('visible'), 'missing data falls back to paste mode');
ok(!broken.get('dashboard').classes.has('visible'), 'no dashboard is claimed without data');
ok(broken.get('paste-note').textContent.includes('latest.json'), 'the fallback explains what is missing');
ok(broken.get('status-dot').className.includes('error'), 'status dot reports the failure');

/* ── paste path ─────────────────────────────────────────────── */
broken.get('paste-input').value = JSON.stringify(pastePayload);
env.get('paste-submit').dispatch('click');

const pasted = broken.get('kpi-grid').innerHTML;
ok(pasted.includes('data-countup="42"'), 'pasted payload renders');
ok(broken.get('dashboard').classes.has('visible'), 'pasted payload reveals the dashboard');
ok(!broken.get('paste-zone').classes.has('visible'), 'paste zone closes once data is shown');
ok(broken.get('capped-grid').innerHTML.includes('Notion'), 'pasted sources render');

broken.get('paste-input').value = '{ not json';
env.get('paste-submit').dispatch('click');
ok(broken.get('paste-error').classes.has('visible'), 'bad paste shows an error');
ok(broken.get('dashboard').classes.has('visible'), 'bad paste keeps the previous render');

/* ── offline / degraded ─────────────────────────────────────── */
const offline = installDOM({ snapshot: {}, history: '' });
offline.activate();
offline.failSnapshot = true;
offline.failHistory = true;
env.get('refresh-btn').dispatch('click');
await offline.settle();
ok(offline.get('paste-zone').classes.has('visible'), 'total failure still leaves a usable page');

report('integration assertions');
