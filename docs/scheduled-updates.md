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

- Full update: `0 2 * * *` = 05:00 Europe/Istanbul.
- Hourly update: `0 0-1,3-23 * * *` = every UTC hour except 02:00.
- Reliability fallbacks: `20 2 * * *` for the full job and
  `20 0-1,3-23 * * *` for hourly jobs. The primary schedules still run at the
  requested exact time; the minute-20 schedules recover a run only when GitHub
  drops a top-of-hour event under load.

Both schedules and authorized manual runs share the
`futbolradar-production-update` concurrency group with
`cancel-in-progress: false`. The full run is never interrupted and a second run
cannot write concurrently. A durable Istanbul-date/hour dedupe key in
`data/update-status.json` rejects repeated successful windows as an additional
guard. When a primary run already succeeded, its fallback exits without
touching the published status or data.

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
is recorded and the pipeline continues with other sources. Validation/build/QA
failures stop publication; the workflow log and `update-status.json` artifact
are still retained for diagnosis.

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
