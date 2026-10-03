/* Portable test harness for the pure logic.
   Runs on Node (CI) and on gjs (local, no Node needed):
     node tests/pure.test.mjs
     gjs -m tests/pure.test.mjs
*/
import * as L from '../lib.js';
import { ok, eq, near, throws, report } from './harness.mjs';

const DAY = 86400000;
const NOW = new Date('2026-10-03T12:00:00Z');

/* ── primitives ─────────────────────────────────────────────── */
eq(L.num(null), null, 'num(null) is null');
eq(L.num(undefined), null, 'num(undefined) is null');
eq(L.num(''), null, 'num("") is null');
eq(L.num(0), 0, 'num(0) stays 0');
eq(L.num('42'), 42, 'num("42") parses');
eq(L.num('nope'), null, 'num("nope") is null');
eq(L.num(NaN), null, 'num(NaN) is null');
eq(L.fmt(null), '—', 'fmt(null) renders an em dash, not 0');
eq(L.fmt(0), '0', 'fmt(0) renders a real zero');
eq(L.clamp(5, 0, 3), 3, 'clamp upper');
eq(L.clamp(-1, 0, 3), 0, 'clamp lower');

/* ── classification: one definition of "Low" ─────────────────── */
eq(L.classify(null, 100).label, 'Unknown', 'unknown remaining is not Depleted');
eq(L.classify(0, 100).label, 'Depleted', 'zero remaining is Depleted');
eq(L.classify(10, 100).label, 'Low', '10% is Low');
eq(L.classify(25, 100).label, 'Low', 'exactly 25% is Low');
eq(L.classify(26, 100).label, 'Available', '26% is Available');
eq(L.classify(196, 600).label, 'Available', '196/600 is Available');
eq(L.classify(5, null).label, 'Unlimited', 'null limit means Unlimited');
eq(L.classify(null, 0).label, 'Unavailable', 'zero limit means not in plan');
eq(L.classify(0, 0).label, 'Unavailable', 'not-in-plan outranks depleted');
eq(L.progressColor(0.1, false), 'var(--color-warning)', 'progress colour warns under 25%');
eq(L.progressColor(null, false), 'var(--color-text-faint)', 'progress colour handles null');

/* ── normalize ──────────────────────────────────────────────── */
const PAYLOAD = {
  remaining_pro: 196,
  remaining_research: 48,
  remaining_labs: 1,
  remaining_agentic_research: 0,
  sources: {
    source_to_limit: {
      github_mcp_direct: { remaining: 45, monthly_limit: 100 },
      notion_mcp: { remaining: 12, monthly_limit: 50 },
      web: { remaining: 9, monthly_limit: null },
      social: { remaining: 0, monthly_limit: 0 },
      mystery_source: { remaining: 3, monthly_limit: 10 },
    },
  },
  reset_at: '2026-10-09T12:00:00Z',
};

const m = L.normalize(PAYLOAD, { now: NOW, fetchedAt: '2026-10-03T12:00:00Z' });
eq(m.quotas.length, 4, 'four quota cards');
eq(m.quotas.find((q) => q.id === 'pro').remaining, 196, 'pro remaining parsed');
eq(m.quotas.find((q) => q.id === 'agentic').remaining, 0, 'agentic zero preserved');
eq(m.sources.length, 5, 'all five sources parsed');
eq(m.sources.find((s) => s.key === 'github_mcp_direct').pct, 0.45, 'capped source pct');
eq(m.sources.find((s) => s.key === 'web').state, 'unlimited', 'null limit is unlimited');
eq(m.sources.find((s) => s.key === 'social').state, 'not_in_plan', 'zero limit is not_in_plan');
eq(m.sources.find((s) => s.key === 'mystery_source').name, 'mystery_source', 'unknown source falls back to its key');
eq(m.sources.find((s) => s.key === 'mystery_source').known, false, 'unknown source flagged');
eq(m.sources.find((s) => s.key === 'notion_mcp').name, 'Notion', 'known source gets a friendly name');
eq(m.resetAt.toISOString(), '2026-10-09T12:00:00.000Z', 'reset timestamp found');
eq(m.sources[0].state, 'capped', 'capped sources sort first');
ok(
  m.sources.findIndex((s) => s.key === 'notion_mcp') <
    m.sources.findIndex((s) => s.key === 'github_mcp_direct'),
  'sources sort by how drained they are'
);

/* the bug this rewrite exists to kill */
const sparse = L.normalize({ remaining_pro: 196, sources: { source_to_limit: {} } }, { now: NOW });
eq(sparse.quotas.find((q) => q.id === 'labs').remaining, null, 'absent key is null, not 0');
eq(L.classify(sparse.quotas.find((q) => q.id === 'labs').remaining, null).label, 'Unknown', 'absent key does not claim Depleted');

eq(L.normalize({ remaining_pro: 5, sources: { source_to_limit: { box: 7 } } }, { now: NOW }).sources[0].remaining, 7, 'bare-number source value tolerated');
eq(L.normalize({ model_specific_limits: { remaining_pro: 11 } }, { now: NOW }).quotas[0].remaining, 11, 'model_specific_limits fallback');

throws(() => L.normalize(null), 'null payload rejected');
throws(() => L.normalize([]), 'array payload rejected');
throws(() => L.normalize({ hello: 'world' }), 'unrelated payload rejected');

/* ── reset detection ────────────────────────────────────────── */
eq(L.findResetAt({ data: { quota: { reset_at: 1791500000 } } }, NOW).resetAt.getTime(), 1791500000000, 'epoch seconds reset found');
eq(L.findResetAt({ data: { quota: { reset_at: '1791500000000' } } }, NOW).resetAt.getTime(), 1791500000000, 'numeric-string epoch found');
eq(L.findResetAt({ note: 'resets whenever' }, NOW).resetAt, null, 'prose is not a date');
eq(L.findResetAt({ reset_at: '2020-01-01T00:00:00Z' }, NOW).resetAt, null, 'stale reset ignored');
eq(L.formatCountdown('2026-10-09T12:00:00Z', NOW), '6d 0h', 'countdown days');
eq(L.formatCountdown('2026-10-04T03:30:00Z', NOW), '15h 30m', 'countdown hours');
eq(L.formatCountdown('2026-10-03T11:00:00Z', NOW), null, 'past reset has no countdown');
eq(L.describeAge('2026-10-03T10:00:00Z', NOW), '2h ago', 'age in hours');
eq(L.describeAge('2026-10-03T11:59:30Z', NOW), 'just now', 'age under a minute');
eq(L.describeAge(null, NOW), 'unknown', 'age of a missing timestamp');

/* ── history ────────────────────────────────────────────────── */
const jsonl = [
  '{"t":"2026-10-03T06:00:00Z","pro":220,"research":60,"labs":3,"agentic":2}',
  'not json at all',
  '{"t":"2026-10-03T00:00:00Z","pro":260,"research":70,"labs":5,"agentic":4}',
  '{"t":"2026-10-03T12:00:00Z","pro":196,"research":48,"labs":1,"agentic":0}',
].join('\n');
const hist = L.parseHistory(jsonl);
eq(hist.length, 3, 'junk lines dropped');
eq(hist[0].t.toISOString(), '2026-10-03T00:00:00.000Z', 'history sorted oldest first');
eq(hist[2].pro, 196, 'history values parsed');
eq(L.parseHistory('').length, 0, 'empty history');
eq(L.parseHistory('[{"t":"2026-10-03T00:00:00Z","pro":1}]').length, 1, 'JSON array history accepted');
eq(L.parseHistory('garbage').length, 0, 'unparseable history');
eq(L.withinDays(hist, 0.4, NOW).length, 2, 'window filter keeps the recent points');

/* source keys are nested under `sources` in history rows */
const withSources = L.parseHistory(
  [
    '{"t":"2026-10-03T00:00:00Z","pro":100,"sources":{"github_mcp_direct":50,"notion_mcp":10}}',
    '{"t":"2026-10-03T12:00:00Z","pro":90,"sources":{"github_mcp_direct":38,"notion_mcp":10}}',
  ].join('\n')
);
eq(withSources[1].sources.github_mcp_direct, 38, 'nested source history parsed');
eq(L.seriesFor(withSources, 'github_mcp_direct').length, 2, 'source series reads the nested value');
near(L.deltaPerDay(withSources, 'github_mcp_direct'), -24, 1, 'per-source drain measured');
eq(L.deltaPerDay(withSources, 'notion_mcp'), 0, 'a flat source reports no drain');
eq(L.seriesFor(withSources, 'pro').length, 2, 'top-level quota series still works');

/* ── projection ─────────────────────────────────────────────── */
const draining = [0, 1, 2, 3, 4].map((d) => ({
  t: new Date(NOW.getTime() - (5 - d) * DAY),
  pro: 100 - 12 * d,
}));
const p = L.projectExhaustion(draining, 'pro', NOW);
near(p.perDay, -12, 0.3, 'burn rate per day');
near(p.daysLeft, 40 / 12, 0.35, 'projected days left');
ok(p.exhaustion instanceof Date, 'exhaustion date produced');
ok(p.r2 > 0.99, 'clean drain fits cleanly');

const flat = draining.map((d) => ({ ...d, pro: 50 }));
eq(L.projectExhaustion(flat, 'pro', NOW).exhaustion, null, 'flat usage projects nothing');
eq(L.projectExhaustion(draining.slice(0, 2), 'pro', NOW).exhaustion, null, 'two points is not enough to project');
eq(L.projectExhaustion([], 'pro', NOW).samples, 0, 'empty history projects nothing');
near(L.deltaPerDay(draining, 'pro'), -12, 0.3, 'delta per day');
eq(L.deltaPerDay(draining.slice(0, 1), 'pro'), null, 'single point has no delta');

/* ── export ─────────────────────────────────────────────────── */
const csv = L.historyToCsv(hist).split('\n');
eq(csv[0], 't,pro,research,labs,agentic', 'csv header');
eq(csv[1], '2026-10-03T00:00:00.000Z,260,70,5,4', 'csv row');

/* ── report ─────────────────────────────────────────────────── */
report();
