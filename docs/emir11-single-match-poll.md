# Emir 11 — one-match poll release

Success: only Fenerbahçe–Slavia Praha's TR/EN pages expose the winner poll, a
browser vote survives a full reload, and every other match stays closed.

Rollback: set `enabled=false` in `data/match-poll-release.json` and deploy;
this preserves saved votes and the comment-persistence fix from #445.

The canonical match is `fenerbahce-slavia-praha-20-ekim-2026`; its English
alias is `fenerbahce-slavia-praha-october-20-2026`. The registry kickoff is
20 October 2026, 19:45 Europe/Istanbul. The existing route closes winner
voting at kickoff. Do not merge after that time expecting an open poll;
choosing another fixture requires a separate reviewed configuration change.

This is a configuration-only activation: no route, UI, database schema,
dependency or infrastructure change. The existing gate resolves EN aliases
to the canonical match and checks the release before any storage access.
Other matches return no questions and reject votes with `POLL_DISABLED`.

Prerequisites were verified on 19 October: the production browser poll on
`d1baa2a` saved a draw vote and retained it after reload; production `e7ae87a`
then saved comment 3 and retained it after reload, with an independent
`storage=supabase` read. #445's complete CI passed. Its closed-gate check
did not exercise an enabled poll. This activation's own preview save/reload,
TR/EN shared selection and another match's closed state must pass before
the PR leaves draft; record the preview commit and results in the PR body.

## Measurement without additional infrastructure

Use existing GA4 events filtered to these two page paths; no new events,
collectors, database counters, polling or paid services are introduced.

| Metric | Existing signals |
| --- | --- |
| Votes per poll view | `fan_vote / match_poll_view` |
| Failed save attempts | `fan_vote_error / fan_vote_attempt` |
| Match → team navigation | `match_navigation_click` with `destination_type=team` / `match_navigation_view` with `has_team=1` |
| Match → player/related/next match | The same navigation ratio for `player`, `related_match`, `next_match`, using the corresponding `has_*` denominator |

These are event ratios, not unique-user conversion rates. Poll views include
reloads and returning voters. Compare navigation after `fan_vote` with visits
without a vote using existing GA4 explorations; the small pilot is descriptive,
not a causal experiment. Consent settings and automation suppression remain in
effect. The pilot adds the normal reads/writes for one enabled poll; measurement
itself adds no instrumentation or server-side requests.

## Checks

`node --test tests/emir11-comment-persistence.test.cjs tests/emir11-poll-release.test.cjs tests/emir11-poll-client.test.cjs`

The scope test checks the actual registry selects exactly one match. Route
tests cover both aliases, another registered match's rejected writes with no
storage calls, winner-only exposure, and saved selection after reread. Browser
verification uses one real preview vote; Preview shares the existing store,
so record that test vote rather than repeatedly submitting votes.
