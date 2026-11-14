/**
 * Tamamlanan her maç için otomatik maç raporu sayfası üretir.
 *
 * İçerik services/matchReportService.js tarafından maçın gerçek verisinden
 * türetilir; bu script yalnızca sunum katmanıdır.
 *
 * DİSİPLİN: "dolu bölüm / hiç bölüm". Sabit sırayla yalnızca ölçülmüş
 * bölümler basılır — skor başlığı, goller ve olaylar, kadrolar, takım
 * istatistikleri, maç sonu açıklamaları (yalnızca doğrulanmış alıntı) ve
 * sonraki maç (yalnızca doğrulanmış fikstür). Verisi olmayan bölüm
 * gizlenir; "veri sağlayıcı tarafından sunulmadı" kartı, "X/5 bölüm dolu"
 * sayacı ya da "bilgiler güncelleniyor" gibi bekleme metinleri YAZILMAZ.
 * Hiçbir bölümün verisi yoksa sayfa; skor başlığı, paylaşım ve gezinme
 * bağlantılarından oluşan kısa bir sonuç kartına küçülür.
 */
import { dropProviderDuplicates } from "./lib/postMatchDedupe.mjs";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { matchQuotesTickerBlock } from "./lib/matchQuotesTicker.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";
import { ROBOTS_INDEX, ROBOTS_META_RE, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { repairPlayerLinks, repairReportJsonLd } from "./lib/reportSchemaRepair.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { playerLink } = require("../services/playerLinks.js");
const { publishedLead } = require("../services/aiMatchSummary.js");
const domain = "https://www.futbolradar.com";

/**
 * İNCE SAYFA EŞİĞİ — bu yüzdenin ALTINDA VE EŞİTİNDE kalan rapor
 * indekslenmez.
 *
 * Ölçülen değer `services/analysisCoverage.js#coveragePercent`: sağlayıcının
 * GERÇEKTEN döndürdüğü alanların ağırlıklı toplamı (skor 10 + olaylar 30 +
 * istatistik 30 + kadrolar 20 + oyuncular 10). Varsayım yapmaz; eksik alan
 * sayılmaz. Kayıt `data/post-match-reports.json` içinde taşınıyor.
 *
 * %40 NEDEN SINIR: 10 yalnızca skor demek, 40 skor + kadrolar ya da skor +
 * olaylar. Bu kümede gol dakikası, olay akışı ve takım istatistiği YOK —
 * yani sayfada okunacak ölçülmüş bir şey yok. Bugün depodaki 1.154 kaydın
 * 1.082'si tam olarak %10; hepsi yayımlanmış durumda.
 *
 * Tek tek bunlar zararsız: sayfa dürüst, eksik bölümü göstermiyor ve yalan
 * söylemiyor. Toplamda zararlı: yüzlerce ölçülmemiş sayfa, Google'ın site
 * geneli kalite değerlendirmesini aşağı çekiyor ve "Taranan, şu anda
 * dizine eklenmemiş" kuyruğunu şişiriyor — o kuyruk da tarama bütçesini
 * asıl indekslenmesini istediğimiz sayfalardan çalıyor.
 *
 * KURAL KALICI VE ÇİFT YÖNLÜ. Bu bir kerelik temizlik değil: eşik her
 * koşuda yeniden uygulanır. Sağlayıcı eksik dökümü yayımlayıp kapsam
 * %40'ın ÜSTÜNE çıktığında sayfa bir sonraki koşuda kendiliğinden
 * `index,follow`a döner ve site haritasına geri girer. Ters yön de aynı:
 * kapsam düşerse sayfa yine çıkar.
 *
 * NE YAPILMIYOR: sayfa silinmiyor, yönlendirilmiyor, gizlenmiyor. Okuyucu
 * için erişilebilir kalıyor ve `follow` sayesinde iç bağlantıları
 * taranmaya devam ediyor — yalnızca ARAMA SONUCUNDA görünmüyor.
 */
const THIN_COVERAGE_THRESHOLD = 40;

/**
 * Kaydın kapsam yüzdesi. Kayıt yoksa 0: kapsamı BİLİNMEYEN bir sayfa
 * indekslenebilir sayılmaz. (Depoda karşılığı olmayan sayfalar, artık
 * üretilmeyen eski koşulardan kalan dosyalardır.)
 */
function coveragePercentOf(record) {
  const value = record && record.coveragePercent;
  return Number.isFinite(value) ? value : 0;
}

/** Sayfa ince mi? Eşik DAHİL. */
function isThinCoverage(record) {
  return coveragePercentOf(record) <= THIN_COVERAGE_THRESHOLD;
}

/**
 * Maçın KALICI `/mac/` sayfası var mı? Sicilden okunur
 * (`data/match-seo-index.json`); uydurulmaz, bulunamazsa null döner.
 */
function hasPermanentMatchPage(record) {
  return Boolean(record && slugForMatch(record));
}

/**
 * NOINDEX'İN İNCE OLMAKTAN FARKI: HEDEFİ OLAN KOPYA İNDEKSTEN ÇEKİLMEZ.
 *
 * İki kural aynı sayfada buluşabiliyor ve birbirini bozuyor:
 *
 *   • Buradaki kapsam kuralı ince raporu `noindex,follow` yapıyor.
 *   • `unify-match-canonicals` (postprocess) hedefi olan raporun
 *     canonical'ını `/mac/...` adresine çeviriyor ve robots'a BAKMIYOR.
 *     Zincirde bu adım bu üreticiden SONRA koşuyor.
 *
 * İkisi birden geçerse sayfa hem "beni indeksleme" hem "asıl adres şu"
 * diyor. Çelişkili sinyal: canonical indekslenecek sayfayı gösterirken
 * noindex onu iptal ediyor ve Google `noindex`i canonical hedefine
 * taşıyabiliyor — yani kopyayı düşürürken KANONİK sayfayı da düşürebilir.
 *
 * Ayrım şu: `noindex` sayfayı düşürür ve biriktirdiği otoriteyi hiçbir
 * yere aktarmaz; çapraz canonical otoriteyi tek adrese toplar. Hedefi
 * OLAN kopya için ikincisi her zaman daha iyi. Dolayısıyla:
 *
 *   hedefi var  → `index,follow` kalır, canonical'ı postprocess çevirir
 *   hedefi yok  → ince ise `noindex,follow` (o rapor o maçın tek adresi
 *                 değil, tek KAYNAĞI; kanibalize ettiği bir şey yok)
 *
 * Ölçüm (bu koşuda): 1.232 ince rapor, bunların 305'inin `/mac/` hedefi
 * var. O 305 sayfa artık indeksten çekilmiyor.
 */
function shouldNoindex(record) {
  return isThinCoverage(record) && !hasPermanentMatchPage(record);
}

const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const { buildMatchReport, buildMatchEvents } = require("../services/matchReportService.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { quotesForMatch } = require("../services/managerQuotes.js");
const { isAnalyzableMatch } = require("../services/matchStatus.js");
const { slugForMatch } = require("../services/matchSeoPages.js");
const { buildMatchShareText, renderShareBlock } = require("../services/shareText.js");
const { t } = require("../services/i18n.js");
const { getPlayers } = require("../services/playerService.js");
const { resolvePlayerByName } = require("../services/playerMatchLogService.js");
// main'den gelen takım merkezi bağlantıları — iki taraf da korunur.
const { teamHubHref } = require("../services/teamHubLinks.js");

/**
 * MAÇ KADROSUNDAN OYUNCU PROFİLİNE.
 *
 * Bağ çift yönlü olmalı: oyuncu sayfası maç raporuna bağlanıyor, maç raporu
 * da oyuncuya. Eşleşme belirsizse (aynı kulüpte aynı soyadı) bağlantı
 * basılmaz — bkz. services/playerMatchLogService.js.
 */
const squadPlayers = (() => {
  try {
    return getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
  } catch (error) {
    console.warn(`[futbolradar:post-match] players.json okunamadı (${error.code || error.message}); kadro bağlantıları basılmayacak`);
    return [];
  }
})();

/**
 * Yer tutucu metinler TEK KAYNAKTAN gelir (locales/tr.json → `fallback.*`).
 * Bileşen başına serbest metin yazılmıyor: aynı durum sitenin her yerinde
 * aynı cümleyle anlatılsın diye sözlükten okunuyor.
 */
const FALLBACK_STATS = t("fallback.stats", "tr");

/** Teknik direktör alıntıları: küratörlü, kaynaklı, uydurulmayan. */
const managerQuoteStore = (() => {
  const file = path.join(root, "data", "manager-quotes.json");
  if (!fs.existsSync(file)) return { quotes: [] };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.warn(`[post-match] manager-quotes.json okunamadı: ${error.message}`);
    return { quotes: [] };
  }
})();

/**
 * Sayfa başındaki "Maç Sonu Açıklamaları" şeridi.
 *
 * Tam liste artık `quotesSectionHtml`'de (bkz. aşağıda) basılıyor. Şerit
 * onun kısaltılmış hâli: okuyucu sayfanın tepesinde kimin ne dediğini
 * görüp aşağıda tamamını okuyor. İkisi de AYNI doğrulanmış listeden gelir.
 */
function matchQuotesTicker(report) {
  const verdict = quotesForMatch(report && report.matchId, managerQuoteStore);
  return matchQuotesTickerBlock(verdict, {
    awaitingNote: "Bu karşılaşma için doğrulanmış bir teknik direktör ya da futbolcu açıklaması henüz yayımlanmadı."
  });
}

const fixturePool = curatedMatches();
// Explicitly corrected archived identities must also refresh their existing
// pages, even after leaving the live calendar. Do not rebuild the entire
// historical archive on every hourly run.
const identityArchive = JSON.parse(fs.readFileSync(path.join(root, "data", "historical-match-archive.json"), "utf8"));
for (const record of identityArchive.records || []) {
  if (!record.match?.identityResolution || !isAnalyzableMatch(record.match)) continue;
  if (!fixturePool.some(match => match.id === record.canonicalId)) fixturePool.push(record.match);
}

/**
 * Rapor havuzu kürasyonlu kayıtlar ile sağlayıcı takviminin BİRLEŞİMİ.
 *
 * Eskiden yalnızca `data/matches.json` okunuyordu; yalnızca sağlayıcı
 * takviminde bulunan bitmiş maçlar (bugün Trabzonspor, Galatasaray ve
 * Çaykur Rizespor'un üç maçı) hiç rapor almıyordu. Tespit de artık
 * services/matchStatus.js üzerinden: FT/AET/PEN de bitmiş sayılır.
 */
const finishedDedupe = dropProviderDuplicates(fixturePool.filter(isAnalyzableMatch), { allMatches: fixturePool });
for (const item of finishedDedupe.dropped) {
  console.log(`[post-match] rapor atlandı (${item.reason}): ${item.id} (fikstür ${item.providerId})${item.keptId ? ` = ${item.keptId}` : ""}`);
}
const finished = finishedDedupe.matches
  .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")));

/** Depodaki analiz kaydı: sayfa, üretilmiş kaydın eksik veri listesini kullanır. */
const reportStore = (() => {
  const storePath = path.join(root, "data", "post-match-reports.json");
  if (!fs.existsSync(storePath)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return new Map((parsed.records || []).map((record) => [record.matchId, record]));
  } catch (error) {
    console.warn(`[post-match] post-match-reports.json okunamadı: ${error.message}`);
    return new Map();
  }
})();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value, options = {}) {
  if (!value) return "Tarih bekleniyor";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih bekleniyor";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul", ...options
  }).format(date);
}

function monogram(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part.charAt(0).toLocaleUpperCase("tr-TR")).join("");
}

/**
 * İLK YARI SKORU GERÇEKTEN YAYIMLANDI MI?
 *
 * `Number(null)` sıfırdır ve `Number.isFinite(0)` doğrudur; bu yüzden soru
 * `Number.isFinite(Number(x))` ile SORULAMAZ. Yayımlanmamış ilk yarı skoru
 * bu tuzağa düşüp "var" sayılıyor ve ekrana iki tarafı da boş bir
 * "İlk yarı -" satırı basılıyordu. Değerin KENDİSİ sayı mı diye sorulur.
 */
function hasHalftime(score) {
  return [score && score.halftimeHome, score && score.halftimeAway].every((value) => {
    if (value === null || value === undefined || value === "") return false;
    return Number.isFinite(Number(value));
  });
}

function metricValue(value, metric) {
  const number = Number(value);
  // measuredRows ölçülmemiş satırı zaten eliyor; bu dal savunma amaçlı.
  if (!Number.isFinite(number)) return FALLBACK_STATS;
  const decimals = Number.isInteger(metric.decimals) ? metric.decimals : Number.isInteger(number) ? 0 : 2;
  return `${number.toFixed(decimals).replace(".", ",")}${metric.unit || ""}`;
}

/**
 * Bir satır ancak İKİ TARAF DA ölçülmüşse anlamlıdır.
 *
 * Tek taraf boşken bar %50/%50 çiziliyor ve boş taraf bir yer tutucu
 * basıyordu; ikisi de okuyucuya yanlış bilgi veriyor. Ölçülmemiş satır
 * artık hiç çizilmez, kategori tümüyle boşalırsa başlığı da basılmaz.
 */
function measuredRows(stats, category) {
  return stats.filter((item) =>
    (item.category || "Genel") === category &&
    Number.isFinite(Number(item.home)) &&
    Number.isFinite(Number(item.away)));
}

function statsHtml(match) {
  const stats = match.statistics || [];
  if (!stats.length) return "";
  const categories = [...new Set(stats.map((item) => item.category || "Genel"))];
  return categories.map((category) => {
    const rows = measuredRows(stats, category);
    if (!rows.length) return "";
    const id = `stats-${category.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/gi, "-")}`;
    return `<section class="post-match-stat-group" aria-labelledby="${escapeHtml(id)}">
      <h3 id="${escapeHtml(id)}">${escapeHtml(category)}</h3>
      <div class="post-match-stat-list">${rows.map((metric) => {
        const home = Number(metric.home) || 0;
        const away = Number(metric.away) || 0;
        const total = home + away;
        const homeWidth = total > 0 ? Math.round((home / total) * 100) : 50;
        const awayWidth = total > 0 ? 100 - homeWidth : 50;
        return `<article class="post-match-stat-row">
          <b>${escapeHtml(metricValue(metric.home, metric))}</b>
          <div><span>${escapeHtml(metric.type)}</span><i aria-hidden="true"><em style="--value:${homeWidth}%"></em><em style="--value:${awayWidth}%"></em></i></div>
          <b>${escapeHtml(metricValue(metric.away, metric))}</b>
        </article>`;
      }).join("")}</div>
    </section>`;
  }).join("");
}

function lineupHtml(match, depth) {
  const lineups = (match.lineups || []).filter((row) => row && Array.isArray(row.players) && row.players.length);
  if (!lineups.length) return "";
  return lineups.map((lineup) => `<article class="post-match-lineup-card">
    <header><h3>${escapeHtml(lineup.team)}</h3><span>${escapeHtml(lineup.formation || "Diziliş doğrulanmadı")}</span></header>
    <ol>${lineup.players.map((name) => {
      const record = resolvePlayerByName(name, lineup.team, squadPlayers);
      return record
        ? `<li><a href="${escapeHtml(playerLink(record.id, depth))}">${escapeHtml(name)}</a></li>`
        : `<li>${escapeHtml(name)}</li>`;
    }).join("")}</ol>
  </article>`).join("");
}

function substitutionsHtml(match) {
  const subs = match.substitutions || [];
  if (!subs.length) return "";
  return subs.map((item) => `<article class="post-match-sub-row">
    <time>${escapeHtml(item.time || "-")}</time><div><span>${escapeHtml(item.team)}</span><strong>${escapeHtml(item.in)}</strong><small>${escapeHtml(item.out)} yerine</small></div>
  </article>`).join("");
}

// ── Rapor bölümleri ─────────────────────────────────────────────────────────
//
// DİSİPLİN: her bölüm ya DOLU basılır ya HİÇ basılmaz. "Veri sağlayıcı
// tarafından sunulmadı" kartı, "X/5 bölüm dolu" sayacı ya da "bilgiler
// güncelleniyor" gibi bekleme metinleri YOK — bunlar boş bölümü doluymuş
// gibi göstermeden okuyucunun önüne "iş yapılıyor" izlenimi bırakan
// tiyatro. Bölümlerin hiçbiri veri getirmiyorsa sayfa; skor başlığı,
// paylaşım ve gezinme bağlantılarından oluşan kısa bir sonuç kartına
// küçülür — bu da geçerli bir sonuç, gizlenecek bir eksiklik değil.

/**
 * 2. Goller ve olaylar — dakika, oyuncu (varsa), tür. Sağlayıcı olay akışı
 * paylaşmadıysa bölüm hiç açılmaz.
 */
function eventsSectionHtml(match) {
  const block = buildMatchEvents(match);
  if (block.status !== "ready") return "";

  return `<section class="post-match-section" aria-labelledby="rapor-olaylar">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-olaylar">Goller ve olaylar</h2><p>Sağlayıcının bildirdiği dakika, oyuncu ve olay türüyle doğrulanmış akış.</p></div></div>
        <div class="post-match-events">${block.events.map((event) => `<article class="post-match-event${event.isGoal ? " is-goal" : ""}">
          <time>${escapeHtml(event.minute)}</time>
          <div><span>${escapeHtml(event.type)}${event.team ? ` · ${escapeHtml(event.team)}` : ""}</span><p>${escapeHtml(event.detail || "")}</p></div>
        </article>`).join("")}</div>
      </section>`;
}

/**
 * 4. Takım istatistikleri — sağlayıcı bir tek metrik bile vermediyse bölüm
 * (başlığıyla birlikte) hiç açılmaz.
 */
function statsSectionHtml(report, match) {
  const block = report.sections.statistics;
  if (block.status !== "ready") return "";

  const conversion = block.conversion.length
    ? `<div class="post-match-conversion">${block.conversion.map((row) => `<article><span>${escapeHtml(row.team)}</span><strong>%${escapeHtml(String(row.rate).replace(".", ","))}</strong><small>${escapeHtml(row.goals)} gol / ${escapeHtml(row.shots)} şut</small></article>`).join("")}</div>`
    : "";

  return `<section class="post-match-section" aria-labelledby="rapor-istatistik">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-istatistik">Takım istatistikleri</h2><p>${escapeHtml(match.homeTeam)} ve ${escapeHtml(match.awayTeam)} verilerinin karşılaştırmalı okuması.</p></div></div>
        <article class="card post-match-stat-reading">
          <p>${escapeHtml(block.lead)}</p>
          ${block.readings.length ? `<ul>${block.readings.map((reading) => `<li>${escapeHtml(reading)}</li>`).join("")}</ul>` : ""}
          ${conversion}
        </article>
        <div class="post-match-team-labels"><strong>${escapeHtml(match.homeTeam)}</strong><span>Karşılaştırma</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
        <div class="post-match-stats-grid">${statsHtml(match)}</div>
      </section>`;
}

/**
 * 5. Maç sonu açıklamaları — YALNIZCA kaynağı doğrulanmış alıntı. Alıntı
 * yoksa bölüm açılmaz; sayfanın tepesindeki şerit zaten bekleme durumunu
 * dürüstçe gösteriyor (bkz. matchQuotesTicker).
 */
function quotesSectionHtml(report) {
  const verdict = quotesForMatch(report && report.matchId, managerQuoteStore);
  const quotes = (verdict && verdict.quotes) || [];
  if (!quotes.length) return "";

  return `<section class="post-match-section" aria-labelledby="rapor-aciklama">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-aciklama">Maç sonu açıklamaları</h2><p>Kaynağı ve zaman damgası doğrulanmış alıntılar; hiçbiri uydurulmaz.</p></div></div>
        <div class="post-match-quotes">${quotes.map((quote) => `<figure class="core-quote">
          <blockquote>${escapeHtml(quote.quote)}</blockquote>
          <figcaption>${escapeHtml([quote.speaker, quote.roleLabel, quote.team].filter(Boolean).join(" · "))} — <a href="${escapeHtml(quote.source.url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(quote.source.name)}</a></figcaption>
        </figure>`).join("")}</div>
      </section>`;
}

/**
 * 6. Sonraki maç — YALNIZCA doğrulanmış fikstürden. Skor tahmini içermez;
 * fikstürde bir takım için sonraki maç yoksa o takım hiç satır almaz,
 * ikisi de yoksa bölüm hiç açılmaz.
 */
function nextMatchSectionHtml(report) {
  const block = report.sections.nextMatch;
  const ready = (block.entries || []).filter((entry) => entry.status === "ready");
  if (!ready.length) return "";

  return `<section class="post-match-section" aria-labelledby="rapor-sonraki">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-sonraki">Sonraki maç</h2><p>Doğrulanmış fikstüre dayanır.</p></div></div>
        <article class="card post-match-next">
          <ul>${ready.map((entry) => `<li>${escapeHtml(entry.text)}</li>`).join("")}</ul>
          <p class="muted-copy">${escapeHtml(block.note)}</p>
        </article>
      </section>`;
}

function pageHtml(report, match, indexable, stored) {
  const { seo } = report;
  const url = `${domain}/${seo.path}`;
  const depth = seo.path.includes("/") ? "../" : "./";
  const score = match.score || {};
  const hasScore = typeof score.home === "number" && typeof score.away === "number";
  const pageHeading = hasScore
    ? `${match.homeTeam} ${score.home}-${score.away} ${match.awayTeam} Maç Raporu`
    : `${match.homeTeam} - ${match.awayTeam} Maç Raporu`;
  const summary = report.sections.summary;
  // Uydurulan "bu rapor genişler" beklemesi yok: cümle yoksa hiç basılmaz.
  // Doğrulanmış AI özeti varsa o gövde şablon cümlenin yerine geçer; skor
  // veya golcü uyuşmazsa publishedLead null döner ve şablon kalır.
  const templateLead = summary.status === "ready" ? summary.paragraph : "";
  const aiLead = publishedLead(stored, "tr");
  const lead = aiLead ? aiLead.body : templateLead;
  const attribution = aiLead ? aiLead.attribution : "";

  // PAYLAŞIM METNİ. Yalnızca doğrulanmış alanlardan kurulur
  // (services/shareText.js): skor kayıtta varsa yazılır, analiz başlığı
  // üretilmişse eklenir, ikisi de yoksa cümle eşleşmeyle yetinir. Metin
  // kurulamıyorsa blok hiç basılmaz.
  const shareHtml = renderShareBlock(
    buildMatchShareText(match, { path: seo.path, origin: domain }),
    escapeHtml,
    { heading: "Bu raporu paylaş" }
  );

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SportsEvent",
        name: `${match.homeTeam} - ${match.awayTeam}`,
        url,
        startDate: match.kickoff,
        // `EventStatusType` "EventCompleted" diye bir değer TANIMIYOR
        // (yalnızca Scheduled/Cancelled/Postponed/Rescheduled/MovedOnline).
        // Geçersiz değer Google tarafından atılıyordu. Oynanmış maç
        // "planlandığı gibi gerçekleşti" demek: EventScheduled.
        eventStatus: "https://schema.org/EventScheduled",
        sport: "Football",
        // Stat/şehir yalnızca kayıtlıysa yazılır. "Bilinmiyor" yer tutucusu ve
        // boş `address` zorunlu alanı boş bırakan geçersiz şemaydı (7.000+ sayfa).
        ...(match.venue && match.venue !== "Açıklanmadı" && match.venue !== "Bilinmiyor"
          ? { location: { "@type": "StadiumOrArena", name: match.venue, ...(match.city ? { address: { "@type": "PostalAddress", addressLocality: match.city } } : {}) } }
          : {}),
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        description: lead || match.summary || ""
      },
      {
        "@type": "NewsArticle",
        headline: seo.title,
        description: seo.description,
        datePublished: match.lastVerifiedAt || match.kickoff,
        dateModified: match.lastVerifiedAt || match.kickoff,
        // Yazar KURUM. Rapor bir kişi tarafından yazılmıyor; maçın
        // doğrulanmış verisinden FutbolRadar'ın üretim hattı üretiyor ve
        // sayfada bir imza satırı YOK. Uydurma bir kişi adı yazmak hem
        // yanlış olur hem de sayfada görünmeyen bir bilgi bildirmek olur;
        // kurum adı ise sayfanın başlığında ve altlığında görünüyor.
        author: { "@type": "Organization", name: "FutbolRadar", url: domain },
        mainEntityOfPage: url,
        publisher: { "@type": "Organization", name: "FutbolRadar", url: domain }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: "Maç Merkezi", item: `${domain}/mac-merkezi.html` },
          { "@type": "ListItem", position: 3, name: `${match.homeTeam} - ${match.awayTeam}`, item: url }
        ]
      }
    ]
  };

  // Rapor sayfası ya kökte (`...-mac-analizi.html`) ya `mac-raporu/`
  // altında basılıyor; oyuncu bağlantısı bu yüzden sabit "../" olamaz.
  const lineups = lineupHtml(match, depth);
  const subs = substitutionsHtml(match);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(seo.title)}</title>
    <meta name="description" content="${escapeHtml(seo.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(seo.title)}" />
    <meta property="og:description" content="${escapeHtml(seo.description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(seo.title)}" />
    <meta name="twitter:description" content="${escapeHtml(seo.description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${depth}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${depth}site.webmanifest" />
    <link rel="stylesheet" href="${depth}page.css" />
  </head>
  <body class="subpage post-match-page">
    ${siteHeader({ base: depth })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${depth}index.html">Ana Sayfa</a><span>/</span><a href="${depth}mac-merkezi.html">Maç Merkezi</a><span>/</span><span>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</span></nav>
      <section class="post-match-hero">
        <div class="post-match-heading"><span class="eyebrow">${escapeHtml(match.league)}${match.stage ? ` · ${escapeHtml(match.stage)}` : ""}</span><h1>${escapeHtml(pageHeading)}</h1>${lead ? `<p>${escapeHtml(lead)}</p>` : ""}${attribution ? `<p class="muted-copy">${escapeHtml(attribution)}</p>` : ""}<div class="post-match-meta"><span>${escapeHtml(formatDate(match.kickoff))}</span>${match.venue && match.venue !== "Açıklanmadı" ? `<span>${escapeHtml(match.venue)}</span>` : ""}${match.referee ? `<span>Hakem: ${escapeHtml(match.referee)}</span>` : ""}</div></div>
        <div class="post-match-scoreboard" aria-label="Maç sonucu">
          <div><span class="team-monogram">${escapeHtml(monogram(match.homeTeam))}</span><strong>${escapeHtml(match.homeTeam)}</strong></div>
          ${hasScore ? `<div class="post-match-score"><span>Maç sonucu</span><b>${escapeHtml(score.home)}<i>-</i>${escapeHtml(score.away)}</b>${hasHalftime(score) ? `<small>İlk yarı ${escapeHtml(score.halftimeHome)}-${escapeHtml(score.halftimeAway)}</small>` : ""}</div>` : '<div class="post-match-score is-empty" aria-label="Skor verisi bekleniyor"></div>'}
          <div><span class="team-monogram away">${escapeHtml(monogram(match.awayTeam))}</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
        </div>
      </section>

      ${matchQuotesTicker(report)}

      ${shareHtml}

      ${eventsSectionHtml(match)}

      ${lineups ? `<section class="post-match-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Kadrolar</span><h2>İlk 11 ve dizilişler</h2><p>Başlangıç kadroları ve maç içindeki oyuncu değişiklikleri.</p></div></div>
        <div class="post-match-lineups">${lineups}</div>
        ${subs ? `<div class="post-match-substitutions"><h3>Oyuncu değişiklikleri</h3><div>${subs}</div></div>` : ""}
      </section>` : ""}

      ${statsSectionHtml(report, match)}

      ${quotesSectionHtml(report)}

      ${nextMatchSectionHtml(report)}

      <section class="post-match-next-grid">
        ${teamHubHref(match.homeTeam, depth) ? `<a href="${escapeHtml(teamHubHref(match.homeTeam, depth))}"><span>Takım merkezi</span><strong>${escapeHtml(match.homeTeam)}</strong><p>Maçlar, puan durumu, kadro ve takım gündemi.</p></a>` : ""}
        ${teamHubHref(match.awayTeam, depth) ? `<a href="${escapeHtml(teamHubHref(match.awayTeam, depth))}"><span>Takım merkezi</span><strong>${escapeHtml(match.awayTeam)}</strong><p>Maçlar, puan durumu, kadro ve takım gündemi.</p></a>` : ""}
        <a href="${depth}mac-merkezi.html"><span>Maç merkezi</span><strong>Tüm maç raporları</strong><p>Tamamlanan karşılaşmaların veri odaklı okumalarına geç.</p></a>
        <a href="${depth}oyuncu-radari.html"><span>Oyuncu analizi</span><strong>${escapeHtml(match.homeTeam)} Oyuncu Radarı</strong><p>Kadro içindeki form ve rol sinyallerini incele.</p></a>
        <a href="${depth}bugunun-maclari.html"><span>Program</span><strong>Bugünkü maçlar</strong><p>Günün doğrulanmış karşılaşmalarını aç.</p></a>
      </section>
    </main>
    ${siteFooter({ base: depth })}
    <script src="${depth}site.js" defer></script>
  </body>
</html>`;
}

// ── Site geneli bağlantılar ─────────────────────────────────────────────────
function replaceOrInsert(file, startMarker, endMarker, content, beforeNeedle) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, "utf8");
  const block = `${startMarker}\n${content}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (pattern.test(html)) {
    html = html.replace(pattern, block);
  } else if (beforeNeedle && html.includes(beforeNeedle)) {
    html = html.replace(beforeNeedle, `${block}\n\n        ${beforeNeedle}`);
  } else {
    return;
  }
  fs.writeFileSync(filePath, html, "utf8");
  fs.writeFileSync(path.join(root, "public", file), html, "utf8");
}

function addInternalLinks(report, match) {
  const summary = report.sections.summary;
  const hasScore = match.score && typeof match.score.home === "number" && typeof match.score.away === "number";
  const score = hasScore ? `${match.score.home}-${match.score.away}` : "";
  const headline = hasScore ? `${match.homeTeam} ${score} ${match.awayTeam}` : `${match.homeTeam} - ${match.awayTeam}`;
  const verdict = summary.status === "ready" ? summary.paragraph : match.summary || "";

  // ANA SAYFA ARTIK BU VİTRİNİ TAŞIMIYOR.
  //
  // Ana sayfa temizliği: "eski maç kartları" (tamamlanmış maçların rapor
  // vitrinleri) ana sayfadan kaldırıldı, üst kısım Canlı Skorlar bandına ve
  // bugünün öne çıkan maçlarına bırakıldı. Rapor hâlâ üretiliyor ve
  // `mac-merkezi.html` (addReportIndex) ile takım sayfalarında (teamFeature,
  // aşağıda) linkleniyor — yalnızca ana sayfaya enjekte edilmiyor.

  const teamFeature = `<section class="card team-latest-match"><span class="card-kicker">Son tamamlanan maç</span><div class="team-latest-match-score"><div><h2>${escapeHtml(headline)}</h2><p>${escapeHtml(verdict)}</p></div>${score ? `<strong>${escapeHtml(score)}</strong>` : ""}</div><a class="detail-link" href="./${escapeHtml(report.seo.path)}">Maç raporunu aç</a></section>`;
  replaceOrInsert("takimlar.html", "<!-- team-latest-match:start -->", "<!-- team-latest-match:end -->", teamFeature, '<section class="container section"');
}

/**
 * Raporların tümünü Maç Merkezi'nden listeler. Hem kullanıcı için giriş
 * noktası, hem de her raporun en az bir iç bağlantıyla taranabilir olmasını
 * sağlar; aksi halde yalnızca sitemap üzerinden erişilebilir kalırlardı.
 */
function addReportIndex(entries) {
  const cards = entries.map(({ report, match }) => {
    const hasScore = match.score && typeof match.score.home === "number" && typeof match.score.away === "number";
    const score = hasScore ? `${match.score.home}-${match.score.away}` : "";
    const summary = report.sections.summary;
    const line = summary.status === "ready" ? summary.headline : `${match.homeTeam} - ${match.awayTeam}`;
    return `<a class="match-report-card" href="./${escapeHtml(report.seo.path)}">
      <span>${escapeHtml(match.league)} · ${escapeHtml(formatDate(match.kickoff))}</span>
      ${score ? `<strong>${escapeHtml(match.homeTeam)} ${escapeHtml(score)} ${escapeHtml(match.awayTeam)}</strong>` : ""}
      <p>${escapeHtml(line)}</p>
      <em>Veri kapsamı %${escapeHtml(report.coverage)}</em>
    </a>`;
  }).join("");

  const block = `<section class="section match-report-index" aria-labelledby="match-report-index-title">
          <div class="section-head"><div class="section-title"><span class="section-kicker">Maç raporları</span><h2 id="match-report-index-title">Tamamlanan maçların otomatik raporları</h2><p>Her rapor yalnızca ölçülmüş bölümleri gösterir: skor başlığı, goller ve olaylar, kadrolar, takım istatistikleri, doğrulanmış maç sonu açıklamaları ve sonraki maç.</p></div></div>
          <div class="match-report-grid">${cards}</div>
        </section>`;

  replaceOrInsert(
    "mac-merkezi.html",
    "<!-- match-report-index:start -->",
    "<!-- match-report-index:end -->",
    block,
    '<section class="route-chain"'
  );
}

/**
 * Rapor sayfalarını site haritasına yaz.
 *
 * GİRDİ VARSA DA YENİDEN YAZILIR. Eskiden mevcut kayıt atlanıyordu
 * (`if (xml.includes(loc)) continue`) ve bunun sessiz bir bedeli vardı:
 * girdiler `<lastmod>` olmadan basılmıştı, bir kez yazıldıktan sonra da bir
 * daha dokunulmuyordu. 101 rapor sayfası site haritasında tazelik sinyali
 * olmadan duruyordu — tarayıcıya sayfa hakkında hiçbir zaman bilgisi
 * vermeyen bir kayıt. Girdi artık her koşuda yeniden kuruluyor.
 */
function sitemapEntryRe(loc) {
  return new RegExp(`  <url>\\n    <loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>[\\s\\S]*?  </url>\\n`);
}

function upsertSitemap(paths, removePaths = []) {
  const sitemapPath = path.join(root, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) return;
  let xml = fs.readFileSync(sitemapPath, "utf8");
  const freshness = createFreshnessTracker(root);

  // ÖNCE SÖKME. İnce sayfa site haritasından çıkar; sayfa DURUR, yalnızca
  // kaydı düşer. Aynı adres sonra kapsamı yükselip tekrar eklenebilsin
  // diye sökme ile ekleme aynı geçişte, bu sırayla yapılıyor.
  for (const relative of removePaths) {
    xml = xml.replace(sitemapEntryRe(`${domain}/${relative}`), "");
  }

  for (const relative of paths) {
    const loc = `${domain}/${relative}`;
    const lastmod = freshness.lastmodForFile(relative, path.join(root, relative));
    // Çok satırlı biçim zorunlu: generate-player-comparison-pages.mjs sitemap'i
    // yeniden yazarken yalnızca "  <url> ... \n  </url>" kalıbına uyan
    // girdileri koruyor, tek satırlık girdiler sessizce düşüyor.
    const entry = `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    const existing = sitemapEntryRe(loc);
    xml = existing.test(xml) ? xml.replace(existing, `${entry}\n`) : xml.replace("</urlset>", `${entry}\n</urlset>`);
  }

  freshness.save();
  fs.writeFileSync(sitemapPath, xml, "utf8");
  fs.writeFileSync(path.join(root, "public", "sitemap.xml"), xml, "utf8");
}

/**
 * KURALI DİSKTEKİ TÜM RAPOR SAYFALARINA UYGULA.
 *
 * Üretim döngüsü yalnızca `finished` havuzunu yazıyor (bugün 166 sayfa).
 * `mac-raporu/` altında ise daha geniş havuzlu eski koşulardan kalan
 * ~1.000 dosya daha var: yayında, indekslenebilir ve büyük çoğunluğu
 * %10 kapsamlı. İnce sayfa probleminin ASIL kütlesi orada olduğu için
 * kural yalnızca yeniden üretilenlere uygulanamaz.
 *
 * Eşleştirme dosya adı üzerinden: depo kaydı `seo.path` ile kendi
 * adresini taşıyor. Depoda karşılığı OLMAYAN dosya da ince sayılır —
 * kapsamı bilinmiyor demek, bilinmeyen kapsam indekslenmez.
 *
 * Yalnızca `<meta name="robots">` satırına dokunulur; sayfanın geri
 * kalanı ve dosyanın kendisi olduğu gibi kalır.
 */
function applyCoverageRuleToExistingPages() {
  const dir = path.join(root, "mac-raporu");
  if (!fs.existsSync(dir)) return;

  // Depo kaydını dosya adına göre indeksle.
  const byFile = new Map();
  for (const record of reportStore.values()) {
    const relative = record && record.seo && record.seo.path;
    if (relative) byFile.set(path.basename(relative), record);
  }

  // Bu koşuda zaten yazılanlara tekrar dokunma: onların yönergesi
  // üretim döngüsünde, aynı kuralla basıldı.
  const justWritten = new Set(generated.map((entry) => path.basename(entry.report.seo.path)));

  const toRemove = [];
  let thin = 0;
  let indexable = 0;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".html")) continue;
    const record = byFile.get(file);
    const isThin = shouldNoindex(record);
    if (isThin) thin += 1; else indexable += 1;
    if (isThin) toRemove.push(`mac-raporu/${file}`);
    if (justWritten.has(file)) continue;

    const directive = isThin ? ROBOTS_NOINDEX_FOLLOW : ROBOTS_INDEX;
    const replacement = `<meta name="robots" content="${directive}" />`;
    for (const base of [root, path.join(root, "public")]) {
      const target = path.join(base, "mac-raporu", file);
      if (!fs.existsSync(target)) continue;
      const html = fs.readFileSync(target, "utf8");
      // Robots satırı + eski üretici sürümlerinden kalan şema hataları
      // (EventCompleted, boş address, yazarsız Article): bu döngü yalnızca
      // son pencereyi yeniden yazan üreticinin ulaşamadığı sayfalara dokunur.
      const next = repairPlayerLinks(repairReportJsonLd(html.replace(ROBOTS_META_RE, replacement)), playerLink);
      if (next !== html) fs.writeFileSync(target, next, "utf8");
    }
  }

  // Bu koşuda üretilenler yukarıda zaten ele alındı; buradaki sökme listesi
  // yalnızca eski sayfaları kapsıyor.
  const stale = toRemove.filter((relative) => !justWritten.has(path.basename(relative)));
  if (stale.length) upsertSitemap([], stale);

  console.log(`[post-match] kapsam kuralı (eşik %${THIN_COVERAGE_THRESHOLD}): ${thin} ince (noindex,follow), ${indexable} indekslenebilir`);
}

// ── Üretim ──────────────────────────────────────────────────────────────────
const generated = [];
const seenTitles = new Map();
const seenDescriptions = new Map();
const seenPaths = new Map();

for (const match of finished) {
  const report = buildMatchReport(match, { fixtures: fixturePool });
  if (!report) continue;

  // Ölçülmüş tek bir bölümü olmayan maç için bağımsız sayfa basılmaz:
  // tamamen "veri sunulmadı" yazan bir URL ne okuyucuya ne aramaya değer
  // verir. Analiz yine de depoda durur ve maç detay ile analiz
  // sayfalarında eksik veri açıkça yazılarak gösterilir.
  const stored = reportStore.get(match.id);
  if (stored && stored.publishState === "store-only") {
    console.log(`[post-match] sayfa atlandı (ölçülmüş bölüm yok): ${match.id}`);
    continue;
  }

  const { title, description, path: relative } = report.seo;
  for (const [label, value, store] of [
    ["başlık", title, seenTitles],
    ["meta açıklaması", description, seenDescriptions],
    ["URL", relative, seenPaths]
  ]) {
    if (store.has(value)) {
      throw new Error(`Yinelenen ${label}: "${value}" hem ${store.get(value)} hem ${match.id} raporunda kullanılıyor.`);
    }
    store.set(value, match.id);
  }

  const indexable = !shouldNoindex(stored);
  const html = pageHtml(report, match, indexable, stored);
  for (const base of [root, path.join(root, "public")]) {
    const target = path.join(base, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html, "utf8");
  }
  generated.push({ report, match, indexable });
}

// Ana sayfa temizliği: bu iki işaretleyici arasında kalan eski "tamamlanmış
// maç" vitrini KOŞULSUZ boşaltılır — `generated.length` sıfır olduğu bir
// koşuda bile. Önceki hâl yalnızca yeni rapor üretildiğinde işaretleyiciye
// dokunuyordu; bu da üretim durmuşken (ör. o gün yeni rapor yoksa) eski
// bloğun sayfada sonsuza dek kalmasına yol açıyordu — tam olarak
// scripts/test-hero-freshness.mjs'in yakalamak için var olduğu bayatlık.
replaceOrInsert("index.html", "<!-- post-match-feature:start -->", "<!-- post-match-feature:end -->", "", null);
replaceOrInsert("index.html", "<!-- post-match-recent:start -->", "<!-- post-match-recent:end -->", "", null);

if (generated.length) {
  addInternalLinks(generated[0].report, generated[0].match);
  // Rapor vitrini ana sayfaya enjekte edilmiyor (yukarıda temizlendi).
  // Raporlar `mac-merkezi.html`de (addReportIndex, aşağıda) tam liste
  // olarak kalıyor.
  addReportIndex(generated);
  // Site haritası indekslenebilirliği İZLER: ince sayfa eklenmez, daha önce
  // eklenmişse SÖKÜLÜR. `noindex` bir sayfayı site haritasında bırakmak
  // çelişkili bir sinyaldir — tarayıcıya "bunu al" deyip sayfada "alma"
  // demek; scripts/test-seo-integrity.mjs bu çelişkiyi zaten hata sayıyor.
  upsertSitemap(
    generated.filter((entry) => entry.indexable).map((entry) => entry.report.seo.path),
    generated.filter((entry) => !entry.indexable).map((entry) => entry.report.seo.path)
  );
}

// ÜRETİLMEYEN ESKİ SAYFALAR DA KURALA TABİ.
//
// Bu koşu yalnızca `finished` havuzundaki maçların sayfasını yeniden yazar;
// `mac-raporu/` altında ise daha geniş havuzlu eski koşulardan kalan
// yüzlerce dosya duruyor. Onlar da yayında ve indekslenebilir — yani
// problemin ASIL kütlesi orada. Kural yalnızca yeniden üretilenlere
// uygulansaydı temizlik görünürde yapılır, etkisi olmazdı.
applyCoverageRuleToExistingPages();

// GEÇERSİZ KAYITTAN KALMIŞ SAYFALAR SÖKÜLÜR.
//
// Üretim döngüsü atlanan maçın sayfasını yazmıyor ama daha önceki bir
// koşunun yazdığı dosya yayında kalıyordu (ör. sağlayıcının maçtan önce
// "FT" dediği ya da hükmen 0-0'ı beraberlik gibi gösteren rapor). Atlanan
// kaydın rapor yolu bu koşuda başka bir maç için YAZILMADIYSA dosya kök ve
// public altından kaldırılır, site haritasından da düşer. Yalnızca bu
// koşuda gerekçeli olarak atlanan kayıtlara dokunulur; toplu silme yok.
pruneInvalidReportPages(finishedDedupe.dropped, generated);

function pruneInvalidReportPages(dropped, written) {
  const writtenPaths = new Set(written.map((entry) => entry.report.seo.path));
  const removed = [];
  for (const item of dropped || []) {
    let relative = null;
    try {
      const report = item.match ? buildMatchReport(item.match, { fixtures: fixturePool }) : null;
      relative = report && report.seo && report.seo.path;
    } catch (error) {
      relative = null;
    }
    const stored = reportStore.get(item.id);
    const candidates = [relative, stored && stored.seo && stored.seo.path].filter(Boolean);
    for (const candidate of new Set(candidates)) {
      if (!candidate.startsWith("mac-raporu/") || writtenPaths.has(candidate)) continue;
      let hit = false;
      for (const base of [root, path.join(root, "public")]) {
        const target = path.join(base, candidate);
        if (fs.existsSync(target)) { fs.unlinkSync(target); hit = true; }
      }
      if (hit) removed.push(candidate);
    }
  }
  if (removed.length) upsertSitemap([], removed);
  for (const relative of removed) console.log(`[post-match] geçersiz kayıttan kalan sayfa kaldırıldı: ${relative}`);
}


const complete = generated.filter((entry) => entry.report.dataStatus === "complete").length;
console.log(`Generated ${generated.length} match report page(s) (${complete} complete, ${generated.length - complete} partial)`);
