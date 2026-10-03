# Perplexity Limits Dashboard

Track your Perplexity AI usage at a glance — limits, remaining queries, data source quotas, and how fast you are burning through them.

![tests](https://github.com/wrouhli/perplexity-limits-dashboard/actions/workflows/ci.yml/badge.svg)

A single static page with no build step, no framework, no backend, and no CORS hacks. It reads two JSON files that sit next to it and draws the dashboard.

## Two ways it gets data

| Mode | How | When to use |
| --- | --- | --- |
| **Published** | A scheduled GitHub Action fetches your limits and commits them to `data/`. The page reads them same-origin. | You want it always current. |
| **Paste** | You paste the JSON from `perplexity.ai/rest/rate-limit/all` straight into the page. Nothing is stored or sent anywhere. | You would rather not put a credential in GitHub, or the fetch is blocked. |

The page starts in paste mode automatically whenever `data/latest.json` is missing or unreadable. You can also open it deliberately: the **Paste data** button in the Raw data toolbar, or `?paste=1` on the URL. Nothing about paste mode is stored — it is parsed in memory and forgotten on reload.

## Why this shape

Perplexity's own endpoint needs your session cookie, so the browser cannot call it from another origin — and `credentials: 'include'` across origins is blocked by CORS and `SameSite` regardless. Putting a proxy somewhere would work but wants a server. Publishing the numbers as a static file sidesteps all of it: the page only ever requests a relative path.

The trade-off is that **anything published is public**. If your usage numbers are not something you want readable by anyone, use paste mode and skip the workflow.

## Enable live refresh

1. Sign in to Perplexity and open `https://www.perplexity.ai/rest/rate-limit/all` to confirm the payload loads.
2. Copy your cookie: DevTools → **Network** → reload → click `rate-limit/all` → **Request Headers** → copy the whole `cookie:` value. Either the full header or just the `__Secure-next-auth.session-token` value works.
3. Repo → **Settings → Secrets and variables → Actions → New repository secret**, name `PERPLEXITY_COOKIE`, paste, save.
4. Run the **refresh data** workflow once (Actions → refresh data → Run workflow).

That is the whole setup. The workflow runs every two hours at :17, commits only when something changed, and redeploys.

### Things to know

- **The cookie is a credential.** It is the same token your logged-in browser uses, so treat a leaked secret as a compromised account. It lives only in GitHub Secrets; the script never prints it, and deliberately never logs quota numbers either, because logs on a public repo are public.
- **It expires.** These session tokens last weeks, not forever. When the workflow starts failing, paste a fresh cookie into the secret. There is no way around this that does not involve a server.
- **Cloudflare may block the runner.** Perplexity sits behind bot protection and a datacenter IP can get a 403. If that happens, append the `cf_clearance` cookie to the same secret value.
- **A failure never empties the page.** On error the script writes nothing, exits non-zero, and the page keeps the last good snapshot while showing a staleness banner after six hours. A red workflow after repeated failures is the signal.
- **GitHub disables scheduled workflows after ~60 days with no repository activity.** Any commit re-enables it. Cron is also best-effort and can run late.

## GitHub Pages

**Settings → Pages → Source: GitHub Actions.** Then the `deploy` workflow publishes on every push to `main`, and `refresh data` publishes its own commits too.

Do not use "Deploy from a branch": commits pushed by a workflow's `GITHUB_TOKEN` do not trigger other workflows, so refresh commits would silently never reach Pages.

The staged site is only the page itself (`index.html`, `styles.css`, `app.js`, `lib.js`, `sw.js`, `icon.svg`, `manifest.webmanifest`, `data/`). Scripts, tests and workflows stay in the repo and are not served.

## Run it locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Serve it — do not open the file directly. `file://` blocks module scripts and service workers, so `app.js` will not load.

The page is installable: open it on the phone browser and "Add to Home Screen". The service worker caches the shell and the last snapshot, so it opens offline with the last known numbers.

## Tests

```bash
python3 -m unittest discover -s tests -t tests   # fetcher, wiring, data files
node tests/pure.test.mjs                         # logic
node tests/render.test.mjs                       # renders app.js in a DOM shim
```

No Node on the machine? `gjs -m tests/pure.test.mjs` and `gjs -m tests/render.test.mjs` work too. Both suites use a tiny portable harness and exit non-zero on failure; CI runs everything on every push.

The render tests exist because there is no headless browser in CI: `tests/dom-shim.mjs` is a minimal fake DOM that lets the real `app.js` execute, so a missing element id or a broken render path fails the build instead of failing in your browser.

## Layout

```
index.html            markup
styles.css            design tokens and components
app.js                rendering; imports lib.js
lib.js                pure logic: parsing, classification, projection
sw.js                 offline cache
manifest.webmanifest  installable metadata
scripts/make_demo_data.py   regenerates the committed demo series
data/latest.json      current snapshot (committed copy is demo data)
data/history.jsonl    one compact JSON row per fetch, 30-day retention
scripts/fetch_limits.py
tests/
.github/workflows/
```

`lib.js` holds every decision worth testing — how a payload is normalised, when a quota counts as "Low", how a reset timestamp is discovered, how a burn rate is projected. `app.js` only touches the DOM.

## How it reads the payload

- Quotas come from `remaining_pro`, `remaining_research`, `remaining_labs`, `remaining_agentic_research`, falling back to `model_specific_limits`.
- Sources come from `sources.source_to_limit`, where `monthly_limit: 0` means "not in your plan" and `monthly_limit: null` means "no cap".
- A missing number stays missing — it renders as `—`, and never as a confident `0` or "Depleted".
- The reset timestamp is found by scanning for reset-ish keys rather than hardcoding one field name, so a schema change degrades gracefully instead of breaking.

## Credit

Built and designed by [Wahid Rouhli](https://www.wahidrouhli.com) for [Konnectoos](https://konnectoos.com). MIT licensed — see `LICENSE`.
