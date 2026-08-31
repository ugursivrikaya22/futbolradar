import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeHeadToHead } = require("../services/matchContextService.js");

function match({ home, away, homeGoals, awayGoals, kickoff, status = "FT", competitionId = "super-lig" }) {
  return {
    id: `${home}-${away}-${kickoff}`,
    homeTeam: home,
    awayTeam: away,
    kickoff,
    status,
    competitionId,
    score: { home: homeGoals, away: awayGoals }
  };
}

// ── Temel sayım: her iki yönde de oynanan maçlar aynı takıma sayılmalı ─────
{
  const matches = [
    match({ home: "Takım A", away: "Takım B", homeGoals: 2, awayGoals: 1, kickoff: "2026-01-10T20:00:00Z" }),
    match({ home: "Takım B", away: "Takım A", homeGoals: 0, awayGoals: 0, kickoff: "2026-03-10T20:00:00Z" }),
    match({ home: "Takım A", away: "Takım B", homeGoals: 1, awayGoals: 3, kickoff: "2026-05-10T20:00:00Z" })
  ];

  const h2h = computeHeadToHead("Takım A", "Takım B", "2026-12-31T00:00:00Z", matches);

  assert.equal(h2h.sampleSize, 3, "üç geçmiş karşılaşma da sayılmalı");
  assert.equal(h2h.home.wins, 1, "Takım A bir kez kazanmış olmalı");
  assert.equal(h2h.home.draws, 1, "bir beraberlik olmalı");
  assert.equal(h2h.home.losses, 1, "Takım A bir kez kaybetmiş olmalı (deplasmanda oynadığı maçta da)");
  assert.equal(h2h.away.wins, 1, "Takım B'nin kazanma sayısı Takım A'nın kaybıyla eşit olmalı");
  assert.equal(h2h.home.wins, h2h.away.losses, "bir tarafın galibiyeti öbürünün mağlubiyetine eşit olmalı");
  assert.equal(h2h.home.goalsFor, 3, "2+0+1 taraf gözetmeksizin Takım A'nın attığı gollerin toplamı");
  assert.equal(h2h.home.goalsAgainst, 4, "1+0+3 Takım A'nın yediği goller");
  assert.equal(h2h.meetings.length, 3, "meetings sampleSize ile eşleşmeli");
  assert.equal(h2h.meetings[0].kickoff, "2026-05-10T20:00:00Z", "en yeni karşılaşma başta olmalı");
  assert.equal(h2h.lastMeeting.kickoff, h2h.meetings[0].kickoff, "lastMeeting en yeni karşılaşma olmalı");
  assert.equal(h2h.dataStatus, "sufficient", "3+ örneklemde durum yeterli olmalı");
}

// ── UYDURULMAZ: örneklem sıfırsa hiçbir sayaç icat edilmez ─────────────────
{
  const h2h = computeHeadToHead("Takım A", "Takım C", "2026-12-31T00:00:00Z", []);
  assert.equal(h2h.sampleSize, 0, "hiç karşılaşma yoksa örneklem sıfır olmalı");
  assert.equal(h2h.lastMeeting, null, "hiç karşılaşma yoksa lastMeeting null olmalı");
  assert.equal(h2h.home.wins + h2h.home.draws + h2h.home.losses, 0, "sayaçlar uydurulmamalı");
  assert.equal(h2h.dataStatus, "insufficient", "sıfır örneklemde durum yetersiz olmalı");
}

// ── Fikstürün kickoff'undan SONRAKİ karşılaşmalar sızmamalı ────────────────
{
  const matches = [
    match({ home: "Takım A", away: "Takım B", homeGoals: 5, awayGoals: 0, kickoff: "2027-01-01T20:00:00Z" })
  ];
  const h2h = computeHeadToHead("Takım A", "Takım B", "2026-06-01T00:00:00Z", matches);
  assert.equal(h2h.sampleSize, 0, "fikstürden sonraki maç geçmişe sızmamalı");
}

// ── Bitmemiş maçlar (skorsuz/ertelenmiş) sayılmamalı ───────────────────────
{
  const matches = [
    match({ home: "Takım A", away: "Takım B", homeGoals: null, awayGoals: null, kickoff: "2026-02-01T20:00:00Z", status: "PST" }),
    match({ home: "Takım A", away: "Takım B", homeGoals: 2, awayGoals: 2, kickoff: "2026-02-15T20:00:00Z" })
  ];
  const h2h = computeHeadToHead("Takım A", "Takım B", "2026-12-31T00:00:00Z", matches);
  assert.equal(h2h.sampleSize, 1, "yalnızca bitmiş ve skoru olan maç sayılmalı");
}

// ── limit parametresi: en yeni N karşılaşmayla sınırlı, sayaçlar da öyle ───
{
  const matches = [1, 2, 3, 4].map((n) =>
    match({ home: "Takım A", away: "Takım B", homeGoals: 1, awayGoals: 0, kickoff: `2026-0${n}-01T20:00:00Z` })
  );
  const h2h = computeHeadToHead("Takım A", "Takım B", "2026-12-31T00:00:00Z", matches, 2);
  assert.equal(h2h.sampleSize, 2, "limit=2 iken yalnızca en yeni iki karşılaşma sayılmalı");
  assert.equal(h2h.meetings[0].kickoff, "2026-04-01T20:00:00Z", "en yeni karşılaşma ilk sırada olmalı");
  assert.equal(h2h.meetings[1].kickoff, "2026-03-01T20:00:00Z");
}

console.log("FutbolRadar match context (head-to-head) tests passed");
