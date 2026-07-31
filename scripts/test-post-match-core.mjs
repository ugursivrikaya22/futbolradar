/**
 * BEŞ BÖLÜMLÜK MAÇ SONU RAPORU TESTLERİ
 *
 * Raporun sözleşmesi:
 *   1. Beş bölüm HER ZAMAN çizilir. Eksik bölüm gizlenmez, "Veri yok" der ve
 *      GEREKÇESİNİ yazar — sessiz boşluk, okuyucuya hata gibi görünür.
 *   2. Teknik direktör yorumu ASLA üretilmez. Kayıtlı, kaynaklı alıntı yoksa
 *      bölüm boş kalır. Bir teknik direktörün ağzına cümle koymak hesap
 *      hatası değil uydurmadır.
 *   3. "ready" işaretli bir bölüm boş görünemez. Bu bir çelişkidir ve
 *      alan eşlemesi bozulduğunda sessizce ortaya çıkar.
 *   4. Omurga bölümleri YENİDEN HESAPLAMAZ, seçer. Aynı veriden iki farklı
 *      sonuç çıkarsa sayfanın iki yeri birbiriyle çelişir.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { buildCoreReport, CORE_SECTIONS, NO_DATA_LABEL } = require("../services/postMatchCoreReport.js");
const { quotesForMatch, validateQuote } = require("../services/managerQuotes.js");
const { buildMatchReport } = require("../services/matchReportService.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { isAnalyzableMatch } = require("../services/matchStatus.js");

// ── 1. Beş bölüm, her koşulda ──────────────────────────────────────────────
{
  assert.equal(CORE_SECTIONS.length, 5, "omurga beş bölüm olmalı");
  const keys = CORE_SECTIONS.map((section) => section.key);
  assert.deepEqual(
    keys,
    ["summary", "turning-point", "team-performance", "player-impact", "manager-comment"],
    "bölüm sırası olaydan yoruma doğru olmalı"
  );

  // Tamamen boş bir rapor bile beş bölüm çizmeli.
  const empty = buildCoreReport({ matchId: "yok", sections: {} }, { quoteStore: { quotes: [] } });
  assert.equal(empty.sections.length, 5, "veri yokken de beş bölüm çizilmeli");
  assert.equal(empty.readyCount, 0, "boş raporda dolu bölüm olmamalı");
  assert.equal(empty.complete, false, "boş rapor tam sayılmamalı");

  for (const section of empty.sections) {
    assert.equal(section.status, "unavailable");
    assert.ok(section.reason && section.reason.trim(), `${section.key}: gerekçe yazılmalı`);
    assert.equal(section.noDataLabel, NO_DATA_LABEL);
  }
}

// ── 2. Teknik direktör yorumu uydurulmaz ───────────────────────────────────
{
  const report = { matchId: "mac-1", sections: {} };

  const none = buildCoreReport(report, { quoteStore: { quotes: [] } });
  const manager = none.sections.find((section) => section.key === "manager-comment");
  assert.equal(manager.status, "unavailable", "alıntı yokken bölüm dolu görünmemeli");
  assert.deepEqual(manager.quotes, [], "alıntı üretilmemeli");
  assert.match(manager.reason, /kaydedilmedi|doğrulanamadı/, "gerekçe açık olmalı");

  // Gerçek, kaynaklı alıntı varsa OLDUĞU GİBİ taşınır.
  const withQuote = buildCoreReport(report, {
    quoteStore: {
      quotes: [{
        matchId: "mac-1",
        speaker: "Örnek Teknik Direktör",
        team: "Örnek Kulüp",
        quote: "İlk yarıdaki tempomuzu ikinci yarıda sürdüremedik.",
        at: "2026-07-21T23:30:00+03:00",
        source: { name: "Kulüp", url: "https://example.com/aciklama" }
      }]
    }
  });
  const filled = withQuote.sections.find((section) => section.key === "manager-comment");
  assert.equal(filled.status, "ready", "kaynaklı alıntı bölümü doldurmalı");
  assert.equal(
    filled.quotes[0].quote,
    "İlk yarıdaki tempomuzu ikinci yarıda sürdüremedik.",
    "alıntı metni değiştirilmemeli — kısaltmak anlamı değiştirir"
  );
  assert.ok(filled.quotes[0].source.url, "alıntının kaynağı taşınmalı");
}

// ── 3. Kaynaksız alıntı reddedilir ─────────────────────────────────────────
{
  const base = {
    matchId: "m", speaker: "A", team: "B",
    quote: "Söz", at: "2026-07-21T23:30:00+03:00",
    source: { name: "K", url: "https://example.com/a" }
  };

  assert.equal(validateQuote(base).valid, true, "tam kayıt geçerli olmalı");
  assert.equal(validateQuote({ ...base, source: { name: "K" } }).valid, false, "url'siz alıntı reddedilmeli");
  assert.equal(validateQuote({ ...base, at: "" }).valid, false, "zaman damgasız alıntı reddedilmeli");
  assert.equal(validateQuote({ ...base, quote: "" }).valid, false, "boş alıntı reddedilmeli");
  assert.equal(
    validateQuote({ ...base, source: { name: "K", url: "javascript:alert(1)" } }).valid,
    false,
    "http(s) olmayan kaynak reddedilmeli"
  );

  // Geçersiz kayıt bölümü doldurmaz ve elendiği raporlanır.
  const verdict = quotesForMatch("m", { quotes: [{ ...base, source: { name: "K" } }] });
  assert.equal(verdict.status, "unavailable", "geçersiz alıntı bölümü doldurmamalı");
  assert.ok(verdict.rejected.length, "elenen alıntı raporlanmalı");
}

// ── 4. Başka maçın alıntısı sızmaz ─────────────────────────────────────────
{
  const verdict = quotesForMatch("mac-a", {
    quotes: [{
      matchId: "mac-b", speaker: "A", team: "B", quote: "Söz",
      at: "2026-07-21T23:30:00+03:00", source: { name: "K", url: "https://example.com/a" }
    }]
  });
  assert.equal(verdict.status, "unavailable", "başka maçın alıntısı bu maça girmemeli");
}

// ── 5. "ready" bölüm boş görünemez (gerçek veriyle) ────────────────────────
//
// Alan eşlemesi bozulduğunda bu sessizce olur: bölüm dolu sayılır ama
// ekranda hiçbir satır çıkmaz.
{
  const finished = curatedMatches().filter(isAnalyzableMatch);
  assert.ok(finished.length, "ön koşul: tamamlanmış maç olmalı");

  let checked = 0;

  for (const match of finished) {
    const report = buildMatchReport(match, {});
    if (!report) continue;

    const core = buildCoreReport(report, { quoteStore: { quotes: [] } });
    checked += 1;

    assert.equal(core.sections.length, 5, `${match.id}: beş bölüm çizilmeli`);

    for (const section of core.sections) {
      if (section.status !== "ready") {
        assert.ok(section.reason && section.reason.trim(), `${match.id}/${section.key}: boş bölüm gerekçesiz olamaz`);
        continue;
      }

      if (section.key === "manager-comment") continue;

      const body = section.body || {};
      const hasText = ["paragraph", "lead"].some((field) => body[field] && body[field].trim());
      const hasList = ["entries", "notes", "items", "players", "moments", "readings", "highlights", "conversion"]
        .some((field) => Array.isArray(body[field]) && body[field].length);

      assert.ok(
        hasText || hasList,
        `${match.id}/${section.key}: "ready" işaretli bölüm boş — alan eşlemesi bozuk`
      );
    }
  }

  assert.ok(checked > 0, "en az bir gerçek rapor sınanmalı");
  console.log(`test-post-match-core: ${checked} gerçek rapor sınandı`);
}

// ── 6. Omurga yeniden hesaplamaz, seçer ────────────────────────────────────
{
  const report = {
    matchId: "m",
    sections: {
      summary: { status: "ready", paragraph: "Özgün özet cümlesi." },
      turningPoints: { status: "ready", moments: [{ minute: "37'", detail: "Gol" }] },
      statistics: { status: "unavailable", reason: "İstatistik dökümü sağlayıcıdan gelmedi." },
      tactical: { status: "ready", notes: ["4-4-2 dizilişi"] },
      standoutPlayers: { status: "ready", players: [{ name: "Oyuncu" }] }
    }
  };

  const core = buildCoreReport(report, { quoteStore: { quotes: [] } });
  const summary = core.sections.find((section) => section.key === "summary");
  assert.equal(summary.body.paragraph, "Özgün özet cümlesi.", "özet metni değiştirilmemeli");

  // İstatistik yoksa taktik okuma devreye girmeli — aynı soru, farklı kanıt.
  const team = core.sections.find((section) => section.key === "team-performance");
  assert.equal(team.status, "ready", "istatistik yokken taktik okuma kullanılmalı");
  assert.equal(team.sourceKey, "tactical", "hangi kaynaktan geldiği taşınmalı");

  assert.equal(core.readyCount, 4, "dört bölüm dolu olmalı");
  assert.equal(core.complete, false, "beşi dolmadan tam sayılmamalı");
}

console.log("Maç sonu omurga testleri geçti (beş bölüm, uydurulmayan alıntı, kaynak zorunluluğu, boş-ready çelişkisi, seçim-yeniden hesaplama ayrımı).");
