/* ═══════════════════════════════════════════════════════════════
   PERPLEXITY LIMITS DASHBOARD — pure logic
   No DOM, no network. Imported by app.js and by the test suite.
   Wahid Rouhli / Konnectoos
═══════════════════════════════════════════════════════════════ */

export const QUOTAS = [
  {
    id: 'pro',
    key: 'remaining_pro',
    limitKeys: ['limit_pro', 'monthly_pro', 'pro_limit'],
    label: 'Pro Queries',
    desc: 'Advanced model queries remaining',
    icon: 'pro',
  },
  {
    id: 'research',
    key: 'remaining_research',
    limitKeys: ['limit_research', 'monthly_research', 'research_limit'],
    label: 'Research',
    desc: 'Research-mode queries remaining',
    icon: 'research',
  },
  {
    id: 'labs',
    key: 'remaining_labs',
    limitKeys: ['limit_labs', 'monthly_labs', 'labs_limit'],
    label: 'Labs',
    desc: 'Perplexity Labs remaining',
    icon: 'labs',
  },
  {
    id: 'agentic',
    key: 'remaining_agentic_research',
    limitKeys: ['limit_agentic_research', 'monthly_agentic_research'],
    label: 'Agentic Research',
    desc: 'Autonomous multi-step research',
    icon: 'agentic',
  },
];

export const SOURCE_META = {
  apple_healthkit: { name: 'Apple Health', tag: 'Health' },
  asana_mcp_merge: { name: 'Asana', tag: 'Productivity' },
  box: { name: 'Box', tag: 'Storage' },
  cbinsights_mcp_cashmere: { name: 'CB Insights', tag: 'Business Intel' },
  confluence_mcp_merge: { name: 'Confluence', tag: 'Docs' },
  crunchbase: { name: 'Crunchbase', tag: 'Startup Data' },
  dropbox: { name: 'Dropbox', tag: 'Storage' },
  factset: { name: 'FactSet', tag: 'Finance' },
  gcal: { name: 'Google Calendar', tag: 'Productivity' },
  github_mcp_direct: { name: 'GitHub', tag: 'Dev' },
  google_drive: { name: 'Google Drive', tag: 'Storage' },
  jira_mcp_merge: { name: 'Jira', tag: 'Project Mgmt' },
  linear_alt: { name: 'Linear', tag: 'Project Mgmt' },
  microsoft_teams_mcp_merge: { name: 'MS Teams', tag: 'Collaboration' },
  notion_mcp: { name: 'Notion', tag: 'Productivity' },
  onedrive: { name: 'OneDrive', tag: 'Storage' },
  org: { name: 'Org', tag: 'Internal' },
  outlook: { name: 'Outlook', tag: 'Email' },
  pitchbook_mcp_cashmere: { name: 'PitchBook', tag: 'VC Data' },
  scholar: { name: 'Scholar', tag: 'Research' },
  sharepoint: { name: 'SharePoint', tag: 'Enterprise' },
  slack_direct: { name: 'Slack', tag: 'Messaging' },
  social: { name: 'Social', tag: 'Social' },
  statista_mcp_cashmere: { name: 'Statista', tag: 'Stats' },
  web: { name: 'Web Search', tag: 'Core' },
  wiley_mcp_cashmere: { name: 'Wiley', tag: 'Academic' },
};

/* ── primitives ───────────────────────────────────────────────── */

/** Finite number, or null. Accepts numeric strings. Never 0-for-missing. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function firstNumber(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const n = num(obj[k]);
    if (n !== null) return n;
  }
  return null;
}

/** null renders as an em dash, distinct from a real 0. */
export function fmt(n) {
  const v = num(n);
  return v === null ? '—' : v.toLocaleString();
}

export function fmtPct(fraction) {
  const v = num(fraction);
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/* ── classification ───────────────────────────────────────────── */

/**
 * Single source of truth for "is this level healthy?".
 * Both the KPI cards and the source cards route through here so the
 * page can never disagree with itself about what "Low" means.
 *
 * @param {number|null} remaining
 * @param {number|null} monthly  null = unlimited / unknown cap, 0 = not in plan
 */
export function classify(remaining, monthly) {
  if (monthly === 0) return { cls: 'badge-empty', label: 'Unavailable', tone: 'empty' };
  if (remaining === null) return { cls: 'badge-info', label: 'Unknown', tone: 'info' };
  if (remaining === 0) return { cls: 'badge-empty', label: 'Depleted', tone: 'empty' };
  if (monthly === null) return { cls: 'badge-info', label: 'Unlimited', tone: 'info' };
  const pct = remaining / monthly;
  if (pct <= 0.25) return { cls: 'badge-warn', label: 'Low', tone: 'warn' };
  return { cls: 'badge-ok', label: 'Available', tone: 'ok' };
}

export function progressColor(pct, isEmpty) {
  if (isEmpty) return 'var(--color-error)';
  const v = num(pct);
  if (v === null) return 'var(--color-text-faint)';
  if (v <= 0.25) return 'var(--color-warning)';
  if (v >= 0.99) return 'var(--color-success)';
  return 'var(--color-primary)';
}

/* ── reset detection ──────────────────────────────────────────── */

const RESET_KEY = /(^|_)(reset|resets|renew|renewal|refresh|cycle|period)(_|$|at$|_at$)|(^|_)(expires?_at|expiry|valid_until|end_date)$/i;
const DAY_MS = 86400000;

function parseDateish(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (v > 1e12) return new Date(v); // ms epoch
    if (v > 1e9) return new Date(v * 1000); // s epoch
    return null;
  }
  if (typeof v !== 'string') return null;
  if (/^\d{9,13}$/.test(v)) return parseDateish(Number(v));
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Hunt for the quota reset timestamp without knowing the exact schema.
 * Walks the payload, collects plausible candidates, keeps the soonest
 * one inside a sane window. Returns { resetAt, candidates }.
 */
export function findResetAt(raw, now = new Date()) {
  const candidates = [];
  const seen = new Set();
  const lo = now.getTime() - DAY_MS;
  const hi = now.getTime() + 400 * DAY_MS;

  (function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) {
      if (RESET_KEY.test(k)) {
        const d = parseDateish(v);
        if (d && d.getTime() >= lo && d.getTime() <= hi) candidates.push({ key: k, at: d });
      }
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  })(raw, 0);

  candidates.sort((a, b) => a.at - b.at);
  return { resetAt: candidates.length ? candidates[0].at : null, candidates };
}

/** "6d 4h", "3h 12m", "in 40s", or null once past. */
export function formatCountdown(target, now = new Date()) {
  const d = target instanceof Date ? target : parseDateish(target);
  if (!d) return null;
  let ms = d.getTime() - now.getTime();
  if (ms <= 0) return null;
  const days = Math.floor(ms / DAY_MS);
  ms -= days * DAY_MS;
  const hours = Math.floor(ms / 3600000);
  ms -= hours * 3600000;
  const mins = Math.floor(ms / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  const secs = Math.floor(ms / 60000) === 0 ? Math.floor((d - now) / 1000) : 0;
  return mins > 0 ? `${mins}m` : `${secs}s`;
}

/** "just now" / "2h ago" / "3d ago" */
export function describeAge(iso, now = new Date()) {
  const d = parseDateish(iso);
  if (!d) return 'unknown';
  const ms = now.getTime() - d.getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ── normalisation ────────────────────────────────────────────── */

/**
 * Turn a raw /rest/rate-limit/all payload into the shape the UI wants.
 * Tolerant: unknown fields are ignored, unknown sources get a fallback
 * name, missing numbers stay null instead of becoming a false zero.
 */
export function normalize(raw, meta = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Payload is not a JSON object');
  }
  const sourceMap = raw.sources?.source_to_limit ?? raw.source_to_limit ?? raw.sources ?? null;
  const modelLimits = raw.model_specific_limits ?? null;

  const looksRight =
    raw.remaining_pro !== undefined ||
    raw.remaining_research !== undefined ||
    (sourceMap && typeof sourceMap === 'object') ||
    (modelLimits && typeof modelLimits === 'object');
  if (!looksRight) throw new Error('Unrecognised payload shape');

  const quotas = QUOTAS.map((q) => {
    const remaining =
      q.key in raw ? num(raw[q.key]) : num(modelLimits?.[q.key]);
    return {
      ...q,
      remaining,
      monthly: firstNumber(raw, q.limitKeys),
    };
  });

  const sources = [];
  if (sourceMap && typeof sourceMap === 'object' && !Array.isArray(sourceMap)) {
    for (const [key, value] of Object.entries(sourceMap)) {
      const obj = value && typeof value === 'object' ? value : { remaining: value };
      const remaining = num(obj.remaining ?? obj.remaining_count ?? obj.count);
      const hasMonthly =
        'monthly_limit' in obj || 'limit' in obj || 'monthly' in obj;
      const monthly = hasMonthly
        ? num(obj.monthly_limit ?? obj.limit ?? obj.monthly)
        : null;
      const capped = monthly !== null && monthly > 0;
      sources.push({
        key,
        name: SOURCE_META[key]?.name ?? key,
        tag: SOURCE_META[key]?.tag ?? '—',
        known: Boolean(SOURCE_META[key]),
        remaining,
        monthly,
        pct: capped ? clamp(remaining ?? 0, 0, monthly) / monthly : null,
        state: monthly === 0 ? 'not_in_plan' : monthly === null ? 'unlimited' : 'capped',
      });
    }
  }
  sources.sort((a, b) => {
    const rank = (s) => (s.state === 'capped' ? 0 : s.state === 'unlimited' ? 1 : 2);
    const d = rank(a) - rank(b);
    return d !== 0 ? d : (a.pct ?? 1) - (b.pct ?? 1) || a.name.localeCompare(b.name);
  });

  const { resetAt, candidates } = findResetAt(raw, meta.now ? new Date(meta.now) : new Date());

  return {
    demo: Boolean(meta.demo ?? raw.demo),
    fetchedAt: meta.fetchedAt ?? raw.fetched_at ?? null,
    status: raw.status ?? 'ok',
    plan: raw.plan ?? raw.subscription ?? null,
    quotas,
    sources,
    resetAt,
    resetCandidates: candidates,
    raw,
  };
}

/* ── history ──────────────────────────────────────────────────── */

/** Parses JSONL (one snapshot per line) or a JSON array. Sorted, junk dropped. */
export function parseHistory(text) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  let rows = [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) rows = arr;
    } catch {
      return [];
    }
  } else {
    rows = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  return rows
    .map((r) => {
      const t = parseDateish(r.t ?? r.at ?? r.fetchedAt ?? r.fetched_at);
      if (!t) return null;
      const point = { t };
      for (const q of QUOTAS) {
        const v = num(r[q.id] ?? r[q.key]);
        point[q.id] = v;
      }
      if (r.sources && typeof r.sources === 'object') {
        const s = {};
        for (const [k, v] of Object.entries(r.sources)) {
          const n = num(v?.remaining ?? v);
          if (n !== null) s[k] = n;
        }
        point.sources = s;
      }
      return point;
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

export function withinDays(points, days, now = new Date()) {
  if (!days || days <= 0) return points;
  const cutoff = now.getTime() - days * DAY_MS;
  const kept = points.filter((p) => p.t.getTime() >= cutoff);
  // Always keep the newest point so a fresh install still shows something.
  if (!kept.length && points.length) return points.slice(-1);
  return kept;
}

export function seriesFor(points, key) {
  return points
    .map((p) => ({
      t: p.t,
      // Quota keys live at the top level; source keys are nested under
      // `sources`, so look in both places.
      y: num(p[key] !== undefined ? p[key] : p.sources?.[key]),
    }))
    .filter((p) => p.y !== null);
}

/**
 * Least-squares fit over the window: how fast is this draining, and
 * when does it hit zero? Returns nulls rather than inventing numbers
 * when the data cannot support an estimate.
 */
export function projectExhaustion(points, key, now = new Date()) {
  const series = seriesFor(points, key);
  if (series.length < 3) return { perDay: null, exhaustion: null, r2: null, samples: series.length };

  const t0 = series[0].t.getTime();
  const xs = series.map((p) => (p.t.getTime() - t0) / DAY_MS);
  const ys = series.map((p) => p.y);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return { perDay: null, exhaustion: null, r2: null, samples: n };

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const perDay = slope;
  const r2 = syy === 0 ? null : (sxy * sxy) / (sxx * syy);
  const staleDays = (now.getTime() - series[series.length - 1].t.getTime()) / DAY_MS;

  // Evaluate the fitted line at *now*, not at the last sample: the newest
  // point may be hours old, and mixing the two skews the estimate.
  const yNow = intercept + slope * ((now.getTime() - t0) / DAY_MS);
  if (perDay >= -0.01 || yNow <= 0) {
    return { perDay, exhaustion: null, r2, samples: n, staleDays };
  }
  const daysLeft = yNow / -perDay;
  const exhaustion = new Date(now.getTime() + daysLeft * DAY_MS);
  return { perDay, exhaustion, daysLeft, r2, samples: n, staleDays };
}

/** Average change per day for one key across the window. */
export function deltaPerDay(points, key) {
  const series = seriesFor(points, key);
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const days = (last.t.getTime() - first.t.getTime()) / DAY_MS;
  if (days <= 0) return null;
  return (last.y - first.y) / days;
}

/* ── export ───────────────────────────────────────────────────── */

export function historyToCsv(points) {
  const cols = ['t', ...QUOTAS.map((q) => q.id)];
  const rows = [cols.join(',')];
  for (const p of points) {
    rows.push([p.t.toISOString(), ...QUOTAS.map((q) => (num(p[q.id]) ?? ''))].join(','));
  }
  return rows.join('\n');
}

export const HISTORY_POINT_KEYS = QUOTAS.map((q) => q.id);
