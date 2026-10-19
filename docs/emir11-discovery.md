# Emir 11 — match discovery

Success: a match visitor can reach either available team page, a published player,
a related match and the nearest scheduled next match in one click in TR and EN.

Rollback: revert this PR's merge commit and rebuild/redeploy the previous version.

The compact navigation appears immediately after the match hero, outside the
tabs, using existing responsive card styles and ordinary links that work without
JavaScript. A missing target is omitted. There are at most two player links,
two recent match links and one next match recommendation. Data comes from the
existing build inputs; there are no runtime requests, new packages or services.

GA4 metrics (existing analytics.js only):
- Team transition rate: `match_navigation_click` with destination_type=team /
  `match_navigation_view` with has_team=1.
- Likewise player, related_match and next_match using their corresponding has_* flags.
- Segment by locale; compare the first seven days with the preceding seven days
  using existing page_view path exploration for the historical baseline.
- Clicks are deduplicated per destination type per page load, so repeated clicks
  do not inflate the numerator. These are page-load ratios, not unique-user rates.
- Denominators mean the navigation was rendered, not that it entered the viewport.
- Existing DNT/GPC and automation exclusions remain in force; ads-only setups do
  not send these GA4 events. There is no local storage or database telemetry.

Run `node --test tests/emir11-discovery.test.mjs`; this is also in verify-production.
The full build and browser release checks must pass in CI before merging.
