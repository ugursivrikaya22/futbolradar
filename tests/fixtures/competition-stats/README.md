# EXAMPLE DATA — not real

Everything in this folder is fabricated for `scripts/test-competition-stats.mjs`.
Clubs ("Example Club A"…), players and scores are invented. They exist only to
exercise round mapping, form/round maths and page generation without an
`APIFOOTBALL_API_KEY`.

* `api-football-fixtures.example.json` – raw `/fixtures?league=2&season=2026` shaped response
* `api-football-rounds.example.json` – raw `/fixtures/rounds` shaped response. The label strings
  follow API-Football's real naming for the 2024+ UEFA format (`League Stage - N`,
  `Knockout Round Play-offs`, `Round of 16`, …); `Mystery Round` is a deliberate unknown label.
* `competition-leaders.example.json` – `data/competition-leaders.json` shaped store

Pages generated from these files carry an "ÖRNEK VERİ / EXAMPLE DATA" banner and
`noindex, nofollow`, and the generator refuses to touch `sitemap.xml` with them.
Never copy these files into `data/`.
