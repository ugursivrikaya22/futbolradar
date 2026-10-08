# FutbolRadar scheduled operations

## Production boundary

The durable writer is `.github/workflows/match-analysis.yml` in
`ugursivrikaya22/futbolradar`, production branch `main`. The existing Vercel
Git integration serves `www.futbolradar.com` from project/team `futbolradar`.
No new Vercel or Supabase cron, database migration, paid service or AI service
is introduced. SporX discovery and its enrichment remain disabled/manual.

## Schedule and freshness targets

- 05:00 Europe/Istanbul (02:00 UTC): full daily maintenance.
- Other hours at :07: limited update. GitHub scheduling is best effort.
- Today/yesterday/tomorrow fixture synchronization remains in the existing provider
  adapter. Stable provider IDs, date identities and manual overrides are preserved.
- Official broadcaster scans run inside the same writer at 05/11/15/19 Istanbul.
  The former separate broadcast schedule is removed; manual recovery remains.
- The tactical Trabzonspor column workflow is manual only. Existing factual,
  deterministic pre-match and post-match generators continue inside the main job.
- `.github/workflows/daily-health-check.yml`: a separate read-only monitor at :47
  every hour (no duplicate completion trigger). It has its own concurrency group,
  no provider secret, no npm/browser install and no repository write permission.
- Repository fixture freshness target: 90 minutes; intervention after 180 minutes.
  Stuck runs: 95 minutes. The monitor distinguishes delayed, missed, failed and
  deployment-pending states. None of these are guarantees of GitHub start time.
  A full daily update older than 36 hours is separately flagged even if hourly
  jobs succeed. Runtime `/api/matches` is checked through the same canonical cache.
- Live notifications poll the existing canonical `/api/matches` URL every 60 seconds
  while followed matches exist and the page is visible. It reuses CDN/provider
  caching; it does not query individual followed IDs or create another SSE stream.
  Existing live-score API/SSE cadence remains quota-aware. Daily/hourly refreshes
  never depend on a visitor. Live freshness acceptance is 120 seconds.

## Write, validation, publication

Source failures are isolated. Last valid data remains available. Critical fixture
shape, IDs, scores and existing coverage/transfer/analysis validations gate
publication. Hourly jobs run narrow data checks; broad SEO and browser gates remain
in full/code CI. A failed source does not authorize unvalidated replacement data.

Concurrency and local exclusive lock prevent simultaneous writers. Istanbul
hour/day dedupe keys reject repeated successful runs. The latest private ledger
is restored from an Actions artifact before a run. If unavailable, the published
ledger is the fallback; provider upserts remain idempotent.

`outputs/operations/update-status.json` stores last attempt and success per source,
source timestamp, available processed counts, error, mode and publication intent.
`observations.json` preserves unchanged-content source observations. Artifacts are
retained for 90 days. Public `data/update-status.json` changes only alongside real
public changes or a new Istanbul day; public status is the last *published* run,
not necessarily the last attempted run. `monitor.json` separately records actual
production versions, record counts, run state and page checks. The admin links to
these authenticated GitHub reports rather than claiming an old deployment is current.

Observation timestamps alone do not trigger generation, commit or deployment.
The runner compares semantic JSON, restores unchanged public bytes, and retains
observations privately. Match kickoff, event, score, editorial text, date and
verification changes are meaningful. New-day presentation refresh remains meaningful.
The no-op publication guard operates only in a dedicated canonical Actions checkout.
Push conflicts and exhausted push retries now fail visibly; they cannot look like a
successful publication. No force-push or conflict-side guessing is used.
The Git output buffer supports large generated change lists. Publication is
finalized after the push in the private ledger; failed publication never satisfies
the same-window duplicate guard and remains eligible for a bounded recovery run.

## Cost and failure modes

`data/operations-policy.json` accepts `normal`, `saving`, `protected`.
Provider headers below 15% remaining select saving; zero remaining or auth,
payment/plan, quota or suspension errors select protected for that run. Saving
skips optional predictions/news/enrichment/photos before core fixtures. Protected
stops further API-Football steps and preserves data. It does not increase quotas,
change plans, disable spending protection or restart a suspended service.

Transient monitor/RSS requests have at most three attempts with increasing wait.
401/402/403/429 are not retried. Source orchestrator steps run once because the
provider already implements request-level retries. Optional source failures do
not block core matches. Unknown faults produce reports, never autonomous code fixes.

## Owner screen and access

The existing `/admin-updates.html` now includes today's matches, trustworthy live
count, last published data, provider quota observation, factual-content links,
marketing copy drafts, mode and actionable gaps. No automatic social posting occurs.
The screen exposes only already-public data. All management actions link to the
repository's authenticated Actions/settings/edit interface; there is no new public
mutation endpoint, service-role key in the browser, or password stored in localStorage.

No owner Telegram/email credentials exist in repository Actions secrets at audit
time, so summaries remain in the panel/Actions. No ChatGPT notification is claimed.
Traffic source/popular-page analytics and monetary billing data are unavailable;
they are labelled unavailable rather than zero or estimated visitors.

## Preserved behavior and limits

- Individual default-off notification preferences, persistent dedupe, silent baseline,
  cancellation/correction handling, queue purge, TR/EN and central kill switch remain.
- News uses the existing approved feeds. Unverified sensitive claims and speculative
  headlines are skipped; manual archives are not rewritten. No new AI generation.
- Dated broadcaster verification and manual overrides win. Unknown channel remains
  unknown. No previous match's channel is copied.
- Match URLs and completed archives remain. Confirmed end timestamps allow a two-hour
  homepage result window. If no confirmed end timestamp exists, the existing safer
  behavior hides the final immediately; kickoff is never presented as a finish time.
- The provider cache is per warm process plus CDN, not a globally locked persistent
  cache across every Vercel instance/region. This limitation is explicit. No unverified
  Supabase project is used to create that missing distributed layer.
- Vercel reports existing Supabase environment configuration, but this session has no
  authenticated DB access to verify rows/project ownership. No DB write is added.
- This monitor is independent of the writer queue but still runs on GitHub. It cannot
  detect GitHub-wide suspension from outside GitHub. No external monitor is configured.
- A paused Vercel project does not guarantee even static page availability.

## Verification

`node --test tests/operations.test.mjs` tests no-op publication in a temporary Git
repo, Istanbul day rollover, cost priorities, bounded retries, invalid data and
HTTP-200 semantic mismatch. Existing scheduled-update, notification, live-score,
broadcast, English news, post-match and homepage tests cover preserved behavior.
`TEST_SHARED_API=1 node scripts/test-match-notifications-browser.cjs` verifies the
shared API transport with synthetic A/B goals (never production fake events).
`node scripts/monitor-operations.mjs` is a read-only production verification.
Manual runs, schedule-triggered runs and long-term reliability must be reported
separately. A successful deployment is not proof of uninterrupted future operation.
