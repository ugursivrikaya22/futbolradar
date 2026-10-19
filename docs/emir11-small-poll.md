# Emir 11 — conditional, small match poll

Success: the poll stays closed until poll persistence, comment persistence and
the browser flow are verified, then only one selected match exposes the winner question.

Rollback: set `enabled` to false in data/match-poll-release.json and deploy;
to remove the change entirely, revert this PR's merge commit and redeploy.

This draft ships disabled. The production test on 19 October 2026 confirmed a
poll POST followed by GET persisted a draw vote; comments could be read but
comment writes and browser clicks were not verified. Do not mark those checks
true merely because the read endpoint returns 200. Before activation, record
successful comment save/reload and poll click/save/reload evidence on a test
fixture, including the deployment commit and browser width, in this document.

After those checks pass, a separate reviewed change may set enabled=true and
matchSlug to one upcoming canonical TR match slug; its EN alias shares the
same poll. The server checks the gate before accessing storage. Disabled POST
returns 503/POLL_DISABLED; GET returns storage=none so the existing UI stays hidden.
Only the winner question can be read or voted on. Existing comments are not
expanded and no additional interaction surface is introduced.

Metrics: `fan_vote` / `match_poll_view` for participation, and existing GA4
page_view paths following fan_vote for return-to-match/team navigation. Compare
to visits without a vote. With PR 1, use fan_vote_error / fan_vote_attempt to
monitor persistence failures. match_poll_view is emitted once per page load
only after the poll is shown. No extra requests, new database, cron or service.

Tests: `node --test tests/emir11-poll-release.test.cjs` and
`node scripts/test-radar-fan.mjs`; the new route tests are also in verify-production.
Mocked storage tests do not replace live comment persistence or browser checks.

## 19 October follow-up: first-comment persistence failure

At 15:13 Türkiye time, production `d1baa2a` returned an empty comment list
for `trabzonspor-besiktas-19-ekim-2026`. Submitting one browser comment as
`FutbolRadar Test` made both save and subsequent GET return 503
`COMMENT_STORE_UNAVAILABLE`. The comment was not resubmitted.

The store requested 8,000 like rows after finding the first comment, but the
shared REST client rejects any per-request limit over 1,000. The fix pages
likes in stable order within the original 8,000-row budget; a one-row sentinel
detects overflow instead of publishing an incomplete tally. Typical small
threads still use one likes request. There is no schema change or new service.

`tests/emir11-comment-persistence.test.cjs` exercises the actual route, store
and REST client with a simulated HTTP database: first save/reload across TR/EN,
multi-page likes and viewer state, later-page failure, bounded overflow and
invalid offsets. All five tests pass, along with the existing fan and social
checks. The real preview verification result and deployment commit are recorded
in PR #445's description after the run. Keep `enabled=false`, `matchSlug=null`,
and the PR draft while any release check is incomplete; verification does not
itself activate the feature.

The production browser poll check on `d1baa2a` passed: click Beraberlik on
Trabzonspor–Beşiktaş, observe the saved state, reload, and read the same selection
again. The independent API read returned `storage=supabase`, `alreadyVoted=true`,
`choice=draw`, and `total=1`. This test added one labelled-in-the-report draw vote.
The existing production poll is the tested surface; this disabled draft was not
deployed to production. Do not treat the earlier comment 503 as a successful
comment-save check merely because the poll works.

## Verified preview and source-policy integration

Preview `c8531ec` (19 October 2026, 16:27 Türkiye time) used the same comment
and poll runtime code as this PR. The original failed production submission
was recovered as comment 1. One new browser submission was persisted as comment
2, survived a full page reload, and was returned by an independent authenticated
API GET with `storage=supabase`. The browser viewport was approximately 1265 px
wide. Both comments are visibly labelled `FutbolRadar Test`.

The preview poll remained hidden; its GET returned `storage=none` and no questions.
The source allow-list CI failure was fixed upstream in #453 by changing the
column's citations and removing unsupported claims, without expanding the
allow-list. This PR integrates that existing fix rather than changing policy.

Release remains disabled. After the complete PR CI passes, verify the deployed
commit, a new production comment submission and reload, and the closed poll
state across reloads. A disabled production poll must reject writes; do not
temporarily enable it or bypass the gate just to manufacture a passing vote test.
The earlier production vote/save/reload evidence remains separate from this
closed-state check. Activation requires a separate reviewed change.
