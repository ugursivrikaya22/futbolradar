# Emir 11 — production baseline, 19 October 2026

Checked at 13:48–13:50 Europe/Istanbul, before changing code.
GitHub production deployment 7171192828 reports success for commit
`7b986d3904cb5457faa8e2805d7597b883fb7d76`; `/api/health` confirms
production/main/7b986d3 on www.futbolradar.com.

| Check | Observed result |
| --- | --- |
| `/en/player/victor-osimhen.html` | 200, English profile title |
| `/en/player/victor-osimhen` | 404: missing extensionless route |
| `/en/player/mauro-icardi.html` | 404: no published profile; do not fabricate one |
| `/en/player/does-not-exist-emir11.html` and `/emir11-missing-page` | Correct 404 |
| `/api/home-poll` | 200, no active poll; calendar has future opening dates |
| `/api/match-poll?slug=fatih-karagumruk-keciorengucu-19-ekim-2026` | 200, Supabase tally available |
| POST winner/draw, then GET with the same cookie | 200, choice=draw, alreadyVoted=true, total=1 persisted |
| `/api/match-comments` for the same slug | 200, Supabase, empty comments; comment writes not verified |

The explicitly requested poll write test added one draw vote to that live match.
The browser webview failed to attach twice, so these are HTTP/API checks,
not proof of a successful browser click or of visual layout.

## PR 1: narrowly scoped fixes

Success: published English player URLs resolve to their existing HTML pages,
and only a confirmed persisted vote counts as success while failed votes allow retry.

Rollback: revert this PR's merge commit and redeploy the previous production build.

Metrics: `fan_vote` / `fan_vote_attempt` is the successful vote ratio;
`fan_vote_error` / `fan_vote_attempt` is the failure ratio, segmented by locale;
use existing GA4 page views to compare subsequent match/team navigation for
voters and non-voters, and existing hosting 404 logs for `/en/player/`.
No new collector, database writes, recurring job, or polling is introduced.
Browser automation is still required before merging; full Interaction checks
remain the repository's release gate.
