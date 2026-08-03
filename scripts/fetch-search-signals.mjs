/**
 * ARAMA SİNYALİ TOPLAYICI
 * ----------------------------------------------------------------------------
 * Search Console dışındaki talep sinyallerini tek dosyada toplar:
 *
 *   • Google otomatik tamamlama: takım/oyuncu/maç kalıpları için öneri
 *     listeleri (öneri VARLIĞI ve SIRASI kaydedilir — hacim uydurulmaz).
 *   • İç sinyaller: yaklaşan doğrulanmış maçlar, taze doğrulanmış
 *     transferler, doğrulanmış haber başlıkları. Bunlar "aranacağı bilinen"
 *     değil, "takvimde/veride var olan" gerçeklerdir; talep kanıtı olarak
 *     kullanılırken kaynak alanında iç veri yolu gösterilir.
 *
 * Ağ erişimi yoksa otomatik tamamlama bölümü boş kalır ve durum alanına
 * yazılır; script düşmez, iç sinyaller yine üretilir. HER KAYIT kaynak
 * (provenance) taşır — services/searchDemand.js kanıtsız sinyali puana
 * çevirmez.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outPath = path.join(root, "data", "search-demand", "signals.json");

const AUTOCOMPLETE_ENDPOINT = "https://suggestqueries.google.com/complete/search";

/** Otomatik tamamlama tohumları: önce Türkiye futbolu, sonra kalıp sorgular. */
const SEED_TERMS = [
  "galatasaray", "fenerbahçe", "beşiktaş", "trabzonspor",
  "süper lig", "süper lig puan durumu",
  "fenerbahçe sturm graz", "beşiktaş hradec", "galatasaray maçı ne zaman",
  "salah trabzonspor", "osimhen", "transfer son dakika",
  "maç hangi kanalda", "muhtemel 11", "canlı skor"
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchAutocomplete(term) {
  const url = `${AUTOCOMPLETE_ENDPOINT}?client=firefox&hl=tr&gl=tr&q=${encodeURIComponent(term)}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (FutbolRadar demand probe)" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const suggestions = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
  return suggestions.map((suggestion, index) => ({
    suggestion: String(suggestion),
    rank: index + 1
  }));
}

function hoursFromNow(value) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return (time - Date.now()) / 3600000;
}

/** Yaklaşan doğrulanmış maçlar: maç-niyetli sorguların iç kanıtı. */
function fixtureSignals() {
  const calendar = readJson("data/fixture-calendar.json", { matches: [] });
  return (calendar.matches || [])
    .filter((match) => match && match.status === "SCHEDULED" && match.kickoff)
    .filter((match) => {
      const hours = hoursFromNow(match.kickoff);
      return hours !== null && hours > -6 && hours < 24 * 14;
    })
    .map((match) => ({
      type: "upcoming-match",
      topic: `${match.homeTeam} - ${match.awayTeam}`,
      league: match.league || "",
      kickoff: match.kickoff,
      source: "internal-fixtures",
      ref: "data/fixture-calendar.json",
      note: `${match.league || "Maç"}: ${match.homeTeam}-${match.awayTeam}, ${match.kickoff}. Saat/kanal/11 sorguları maça yaklaştıkça yükselir.`
    }));
}

/** Son 21 günün doğrulanmış transferleri. */
function transferSignals() {
  const transfers = readJson("data/transfers.json", []);
  const rows = Array.isArray(transfers) ? transfers : transfers.transfers || [];
  return rows
    .filter((row) => row && row.status === "confirmed")
    .filter((row) => {
      const hours = hoursFromNow(row.date);
      return hours !== null && hours > -24 * 21;
    })
    .map((row) => ({
      type: "confirmed-transfer",
      topic: row.playerName,
      source: "internal-transfers",
      ref: "data/transfers.json",
      note: `${row.playerName}: ${row.fromTeam} → ${row.toTeam} (${row.type}). "nereye transfer oldu" sorguları için doğrulanmış kayıt.`
    }));
}

/** Son 7 günün doğrulanmış haber konuları. */
function newsSignals() {
  const news = readJson("data/news.json", []);
  const rows = Array.isArray(news) ? news : news.items || [];
  return rows
    .filter((row) => row && String(row.status || "").toLowerCase() === "verified")
    .filter((row) => {
      const hours = hoursFromNow(row.publishedAt);
      return hours !== null && hours > -24 * 7;
    })
    .map((row) => ({
      type: "verified-news-topic",
      topic: row.title,
      team: row.team || "",
      source: "internal-news",
      ref: `data/news.json#${row.id}`,
      note: `Kaynaklı haber gündemi: ${row.category || "haber"}.`
    }));
}

async function main() {
  const autocomplete = [];
  let autocompleteStatus = "ok";

  for (const term of SEED_TERMS) {
    try {
      const suggestions = await fetchAutocomplete(term);
      autocomplete.push({
        term,
        fetched: true,
        suggestions,
        source: "google-autocomplete",
        ref: `${AUTOCOMPLETE_ENDPOINT}?hl=tr&q=${encodeURIComponent(term)}`,
        note: suggestions.length
          ? `"${term}" için ${suggestions.length} öneri döndü.`
          : `"${term}" için öneri dönmedi.`
      });
    } catch (error) {
      autocompleteStatus = "partial-or-unavailable";
      autocomplete.push({
        term,
        fetched: false,
        suggestions: [],
        source: "google-autocomplete",
        ref: `${AUTOCOMPLETE_ENDPOINT}?hl=tr&q=${encodeURIComponent(term)}`,
        note: `İstek başarısız (${String(error.message).slice(0, 120)}). VERİ YOK olarak işaretlendi; tahmin üretilmedi.`
      });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    autocompleteStatus,
    autocomplete,
    internal: {
      upcomingMatches: fixtureSignals(),
      confirmedTransfers: transferSignals(),
      verifiedNewsTopics: newsSignals()
    },
    note: "Her kayıt kaynak (source/ref) taşır. Otomatik tamamlama yalnızca öneri varlığını ve sırasını kaydeder; arama hacmi İDDİA EDİLMEZ."
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const fetchedCount = autocomplete.filter((row) => row.fetched).length;
  console.log(`[search-signals] yazıldı: ${path.relative(root, outPath)} — autocomplete ${fetchedCount}/${SEED_TERMS.length}, maç ${payload.internal.upcomingMatches.length}, transfer ${payload.internal.confirmedTransfers.length}, haber ${payload.internal.verifiedNewsTopics.length}.`);
}

main().catch((error) => {
  console.error(`[search-signals] beklenmeyen hata: ${error.message}`);
  process.exitCode = 1;
});
