# FutbolRadar production scheduled updates

## Why GitHub Actions, not Vercel Cron

FutbolRadar is a static site whose durable data and generated pages are stored
in this repository. A Vercel Function runs against an immutable deployment and
cannot persist changes to `data/*.json` or generated HTML. The production-safe
writer is therefore GitHub Actions: it runs the real sync scripts, validates
the result, commits changed files, and lets the existing Vercel Git integration
deploy that commit.

No public cron/update HTTP endpoint exists. Normal visitors cannot trigger an
update. Scheduled and manual runs are accepted only inside GitHub Actions; the
orchestrator verifies the `schedule`/`workflow_dispatch` event, the canonical
repository, and the short-lived `${{ github.token }}` context before it writes.

## Exact schedule

GitHub cron is UTC. Istanbul is UTC+3 throughout the year.

- Full update: `7 2 * * *` = ~05:00 Europe/Istanbul.
- Hourly update, daytime: `7 4-21 * * *` = every UTC hour from 04:00 to 21:00
  (07:00-00:59 Istanbul), when fixtures, scores and the news feed actually move.
- Overnight update: `7 0,3,22 * * *` = every second UTC hour through the quiet
  window (01:00-06:59 Istanbul), skipping 02:00 UTC where the full job runs.
  The run costs ~13 billable minutes on a private repository and almost nothing
  changes overnight, so the hourly cadence was not worth its price there.

Both crons fire at minute 7, not minute 0. GitHub's own scheduling docs name
the start of every hour as the `schedule` event queue's highest-load window;
runs pinned to `:00` on this repository were observed starting 4-8 hours late
(e.g. the `05:00` full job landing past 09:00 Istanbul, some days not at all
before the next day's run). Offsetting a few minutes off the hour is GitHub's
documented mitigation and restored on-time starts. If the observed delay ever
returns even off-peak, it is a GitHub Actions scheduler symptom, not a bug in
this workflow — see "Detecting a missed or delayed run" below.

There is deliberately no minute-20 reliability fallback: the two schedules
above already trigger 25 runs/day, and each GitHub-hosted runner minute is
billed against the account's Actions quota. A dropped top-of-hour event (rare)
is simply picked up by the next scheduled run instead of a same-hour retry.

### Detecting a missed or delayed run

`data/update-status.json` → `lastFull.dedupeKey` should read `full:<today's
Istanbul date>` shortly after 05:00 Europe/Istanbul. If it still names an
earlier date, the scheduled trigger has not fired yet — check the
`FutbolRadar Scheduled Updates` workflow's recent runs for a queued or
delayed `schedule` event before assuming the pipeline itself failed. A manual
`workflow_dispatch` with `update_type: full` on `main` runs the exact same
pipeline immediately and is safe to use to unblock a delayed day.

Both schedules and authorized manual runs share the
`futbolradar-production-update` concurrency group with
`cancel-in-progress: false`. The full run is never interrupted and a second run
cannot write concurrently. A durable Istanbul-date/hour dedupe key in
`data/update-status.json` rejects repeated successful windows as an additional
guard.

## GitHub Actions configuration

Set the following in **Repository settings → Secrets and variables → Actions**:

- `APIFOOTBALL_API_KEY` — required for live fixtures, scores, events, lineups,
  standings, injuries/suspensions, squads and player refreshes.
- `APIFOOTBALL_LEAGUE_ID` — optional; the resolver discovers and caches the
  current Süper Lig identity when omitted.
- `APIFOOTBALL_SEASON` — optional; derived from the current date when omitted.
- `APIFOOTBALL_API_BASE_URL` — optional; provider default is used when omitted.
- `THESPORTSDB_API_KEY` — optional; the provider's public test key is the safe
  fallback for the daily fixture calendar.
- `FOOTBALL_NEWS_FEEDS` — optional JSON array of operator-approved RSS/Atom
  feeds. When omitted, official club/TFF/UEFA and trusted-media Google News RSS
  queries are used. Automated headlines are source-linked and never replace
  manually written articles.

The same API key in Vercel does not automatically exist in GitHub Actions. The
Actions secret is needed because repository synchronization runs in Actions.

## What each job does

The 05:00 full job performs the keyless fixture refresh, live fixture/detail
merge, standings and absence synchronization, news/ticker refresh, squads,
canonical player merge, confirmed-transfer reconciliation, official lineups,
results, match analyses, post-match reports, the full static build, validations
and QA. Monday's full run also performs the deeper player/profile/photo pass.

The hourly job performs only live fixtures and details (including goals, cards,
substitutions and lineups when supplied), standings, injuries/suspensions,
news, provider identity backfill and finished-result synchronization. Static
pages are regenerated only when watched data changed. The shared ticker/layout
pass is likewise skipped when nothing changed.

Provider records are upserted by provider ID plus a stable team/date identity.
Manual editorial fields remain authoritative. Empty, partial or failed source
responses never erase the last valid cache. Confirmed-transfer publication
continues to require the existing traceable-source rules.

## Failure and monitoring behavior

Every source runs independently with timeouts and retry/backoff. A failed source
is recorded and the pipeline continues with other sources. Validation and build
failures stop publication; the workflow log and `update-status.json` artifact
are still retained for diagnosis.

The final QA pass (`npm run qa`, page-level SEO/integrity lint) does **not**
stop publication. It used to: between 2026-09-03 and 2026-09-06 a set of
duplicate Sporx news titles turned every hourly run red, the commit step was
skipped and three days of live scores, standings and squad data were fetched
and thrown away. Data validity is guarded by the `validate-*` steps; a QA
failure now marks the run `partial`, lists the step under `errors`, and is
surfaced again by the daily health check (`npm run lint`).

When the hourly run regenerates player profiles (`playersUpdated`), it also
runs the comparison pages, English player pages and the player prerender pass.
A profile without those is not publishable (broken `karsilastirma/` links, no
prerendered body) and QA rejects it.

Successful and partially successful runs commit `data/update-status.json` with:

- start/finish time and duration;
- full/hourly type and status;
- sources checked and per-source errors;
- changed match, news, transfer, team and player counts;
- workflow URL and commit identity;
- the most recent 40 run summaries.

`admin-updates.html` shows the latest full/hourly result and failed source
list. It fetches `/data/update-status.json` with `no-store`, so the monitor is
not hidden behind the normal data cache.

## Local verification

These commands do not require the CI guard:

```text
node scripts/test-scheduled-updates.mjs
node scripts/sync-football-news.mjs --dry-run
node scripts/sync-fixture-calendar.mjs --dry-run
node scripts/run-scheduled-update.mjs --type=hourly --force
```

The last command performs real writes and should be used only when local API
credentials are configured and a complete local update is intended.
