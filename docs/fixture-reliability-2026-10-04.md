# Fixture reliability audit — 4 October 2026

## Observed production failure

Read-only production checks on 2026-10-04 found `/api/matches?date=2026-10-04&debug=1` returning zero matches. API-Football reported its daily request quota exhausted (HTTP 200 with a provider error); football-data.org reported authentication failure. These are not evidence of a day without football.

Production `/api/health` identified commit `fff7b303a88880a204fcf6fb080a1a38f948de93`, deployed on September 23. Its fixture calendar had 2,727 rows and zero October 4 rows. GitHub main `0fe2ffa793695091a2f7a5476076e0bfcaea2074` had 671 rows, including 89 October 4 fixtures, and a successful calendar timestamp on October 4. The production deployment had not caught up with the repository. GitHub's latest scheduled job completed with a **partial** internal status, despite a green workflow result.

The original local checkout was an August snapshot with extensive pre-existing edits. All changes for this audit are isolated in the `codex/fixture-reliability` worktree based on current main.

## Data path and fixes

- API-Football `/fixtures` is the primary daily/live source. Removed catalogue exclusions from its daily results. Explicit league filters still work.
- football-data.org is the secondary live provider. Removed its catalogue exclusions and fixed the zero-width date range: v4's `dateTo` is exclusive. Fetch the two UTC days intersecting an Istanbul day, then filter by the shared Istanbul day function. [Provider date contract](https://docs.football-data.org/general/v4/match.html).
- TheSportsDB daily events are an additional, explicitly **partial** backup. Query both UTC dates crossing the Istanbul day. The free endpoint limits results, so an empty backup never proves that no matches exist. [Provider limits](https://www.thesportsdb.com/docs_api_guide).
- `scripts/sync-live-fixtures.mjs` merges into `data/fixture-calendar.json` and its public copy without deleting saved fixtures on provider failure. Provider IDs remain namespaced; canonical page IDs remain stable. Optional details stop at the existing quota reserve in all modes, not only bulk backfills. Date discovery precedes live/details requests; primary quota/configuration failures stop further primary requests in that run.
- `api/matches.js` walks past empty daily providers, combines partial/degraded responses with persisted fixtures, and reports `fixtureHealth` separately from freshness. Live empty results keep their existing authoritative semantics.
- `services/providers/mockProvider.js` no longer filters today's persisted pool by the major-league catalogue and uses the same Istanbul date conversion as the frontend. Live fallback includes ongoing matches crossing midnight, subject to the existing freshness guard.
- `services/dailyFixturePriority.js` expresses the requested domestic/UEFA/international/world ordering. Unknown leagues are retained. API and persisted rows carry the priority; TR and EN presentation consume it.
- English daily fixtures refresh from the same API as Turkish fixtures. The existing English calendar gets a daily section without changing its canonical URL or archive content. Existing match/team/standings routes and language mappings remain intact; `/canli` is an alias of the existing live score page.
- The existing daily health workflow runs `scripts/check-fixture-publication.mjs`. It fails when the repository has fixtures for the queried day and production returns none.

## Supabase

Supabase is a secondary durable store, not the frontend's direct fixture query. The frontend reads `/api/matches` and static JSON. Existing ingestion writes `public.matches` using upsert, but only read curated matches and reports; the daily calendar was omitted. Ingestion now includes calendar rows, deduplicates namespaced provider identities, preserves existing database IDs, and reports rows read/written plus insert/update candidates.

Migration `0008_fixture_identity.sql` adds a unique provider/source index without deleting legacy rows. Legacy duplicate identities must be reconciled if this index fails; the migration intentionally fails visibly rather than deleting referenced records.

The latest GitHub Actions log shows Supabase ingestion **skipped** because `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` were unset there. Production health reports those variables present in Vercel, which does not make them available to Actions. No service key was exposed or copied. The production Supabase probe successfully read `home_poll_votes` (HTTP 200); this confirms connectivity, not fixture ingestion. Database fixture writes and remote scheduled jobs could not be verified from this environment. The migration has not been applied remotely.

## Schedule and health

The existing GitHub Actions workflow remains the scheduler: 05:00 Istanbul full sync and hourly sync in every other hour, including overnight. Live scores continue through the existing API/SSE refresh. No Vercel Cron or database cron was introduced. Routine discovery is today/yesterday/tomorrow; explicit backfill can add dates. GitHub schedules are not guaranteed to start at the exact minute.

`fixtureHealth` records queried date, timezone, primary fixture count, inserted/updated records, visible count, request outcomes/status codes, rate-limit observations, last successful primary/backup sync and errors. It is persisted even when no fixture changed and exposed through `/api/health`. Unknown rate-limit values remain null.

## Validation and release conditions

- A–E regression coverage: lower Turkish leagues without Premier League games; 00:30 Istanbul boundary; failed API preserving saved records; repeated sync without duplicates; FT score/status updating the same record.
- Additional checks cover all requested status codes, football-data's exclusive date range, partial backup provenance, stable URLs, catalogue-free persisted reads and TR/EN endpoint parity.
- Real TheSportsDB query returned five fixtures within October 4 Istanbul after combining adjacent UTC dates. These are limited backup results, not a worldwide fixture total.
- After merging and deduplicating with the saved pool, local API and browser checks showed **91 fixtures in both locales**, without JavaScript errors. Production still returned **0**; publication check correctly returned `PUBLICATION_FAILED`.
- API resilience, fixture deduplication, match programme, scheduled updates, Supabase contract, live stream and timezone performance checks passed.
- The complete test chain encountered existing English news language-purity failures in unmodified news pages. This is not reported as a passing full suite.
- Release requires deploying the corrected/current main build, restoring primary provider availability, configuring the existing Actions Supabase secrets and applying the migration. A local passing fixture test does not establish production deployment or database ingestion success.

Operational commands:

```sh
node scripts/test-daily-fixture-reliability.mjs
node scripts/sync-live-fixtures.mjs --date=2026-10-04 --mode=full --apply
node scripts/check-fixture-publication.mjs --date=2026-10-04
node scripts/supabase-ingest.mjs --dry-run --only=matches
```
