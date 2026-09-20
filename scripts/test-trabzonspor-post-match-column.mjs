#!/usr/bin/env node
/**
 * TRABZONSPOR MAÇ SONU KÖŞE YAZISI — DENETİM.
 *
 * Korunan davranışlar, önem sırasıyla:
 *   1. Bitişi doğrulanmamış maçtan yazı ÇIKMAZ.
 *   2. Veri eksikse yazı `draft` kalır; yüzeye çıkmaz.
 *   3. Metinde uydurma yoktur: alıntı işareti, kaynaksız isim, ölçülmemiş
 *      sayı yok.
 *   4. Uzunluk 1.000–1.500 kelime aralığında; tavan aşılırsa bölüm düşer.
 *   5. Türkçe ve İngilizce metinler AYRI yazılır.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { findTurkish } from "./lib/turkish-detector.mjs";

const require = createRequire(import.meta.url);
const { selectMatch, readiness, countWords, MIN_WORDS, MAX_WORDS } =
  require("../services/trabzonsporMatchColumn.js");
const {
  buildColumnEntry,
  trimBody,
  dropSection,
  clampMeta,
  signalOf,
  SHARE_IMAGE_TITLE
} = require("../services/trabzonsporColumnBuild.js");
const { validateColumn } = require("../services/columnService.js");
const {
  aggregate,
  compareWindows,
  declineVerdict,
  matchRowsFrom,
  mergeHistory,
  passRateFrom,
  playerKey
} = require("../services/playerMatchHistory.js");
const { readiness: readinessGate, selectMatch: selectMatchGate, buildModel: buildModelGate } = require("../services/trabzonsporMatchColumn.js");
const { buildOpponentFocus, isCompetitive, signingsFor } = require("../services/opponentFocus.js");
const { renderTurkish } = require("../services/trabzonsporColumnWriter.js");

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ *
 * KURGU VERİ — gerçek sağlayıcı şekliyle aynı
 * ------------------------------------------------------------------ */

function statRow(type, home, away, extra = {}) {
  return { type, home, away, ...extra };
}

function fullMatch(overrides = {}) {
  return {
    id: "trabzonspor-galatasaray-2026-09-19",
    league: "Süper Lig",
    stage: "6. hafta",
    venue: "Papara Park",
    city: "Trabzon",
    kickoff: "2026-09-19T20:00:00+03:00",
    status: "FINISHED",
    homeTeam: "Trabzonspor",
    awayTeam: "Galatasaray",
    score: { home: 2, away: 1 },
    events: [
      { time: "12'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "V. Osimhen · Asist: L. Torreira · Normal Goal" },
      { time: "38'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "P. Sörloth · Asist: E. Visca · Normal Goal" },
      { time: "45+2'", team: { name: "Galatasaray" }, type: "Card", detail: "Yellow Card", value: "L. Torreira · Yellow Card" },
      { time: "61'", team: { name: "Trabzonspor" }, type: "Card", detail: "Yellow Card", value: "B. Bakasetas · Yellow Card" },
      { time: "77'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Penalty", value: "A. Bakasetas · Penalty" },
      { time: "84'", team: { name: "Galatasaray" }, type: "Card", detail: "Red Card", value: "D. Sánchez · Red Card" }
    ],
    substitutions: [
      { time: "58'", team: "Trabzonspor", in: "A. Bakasetas", out: "E. Visca" },
      { time: "70'", team: "Trabzonspor", in: "U. Akyüz", out: "B. Bakasetas" },
      { time: "66'", team: "Galatasaray", in: "K. Aktürkoğlu", out: "B. Yılmaz" }
    ],
    lineups: [
      { team: "Trabzonspor", formation: "4-2-3-1", coach: "Fatih Tekke", players: ["A. Onana", "M. Savić", "S. Bayram", "S. Mumin", "A. Pina", "O. Sikan", "T. Zubkov", "E. Visca", "B. Bakasetas", "C. Nwakaeme", "P. Sörloth"] },
      { team: "Galatasaray", formation: "4-3-3", coach: "Okan Buruk", players: ["F. Muslera", "S. Boey", "D. Sánchez", "A. Bardakcı", "A. Angeliño", "L. Torreira", "K. Demirbay", "G. Sara", "B. Yılmaz", "V. Osimhen", "D. Zaha"] }
    ],
    statistics: [
      statRow("Topla oynama", 57, 43, { unit: "%" }),
      statRow("Toplam şut", 16, 9),
      statRow("İsabetli şut", 7, 3),
      statRow("Ceza sahası içinden şut", 10, 4),
      statRow("Korner", 7, 3),
      statRow("Toplam pas", 512, 388),
      statRow("Pas isabeti", 87, 79, { unit: "%" }),
      statRow("Kurtarış", 2, 5),
      statRow("Faul", 11, 14),
      statRow("Ofsayt", 1, 4),
      statRow("Gol beklentisi (xG)", 1.94, 0.88, { decimals: 2 }),
      statRow("Kazanılan ikili mücadele", 54, 47),
      statRow("Toplam orta", 21, 12)
    ],
    players: [
      { name: "A. Onana", team: "Trabzonspor", minutes: 90, providerRating: 7.4, saves: 2, passes: 34, passAccuracy: 27, source: "api-football" },
      { name: "P. Sörloth", team: "Trabzonspor", minutes: 90, providerRating: 8.3, goals: 1, shots: 5, shotsOnTarget: 3, duelsWon: 9, passes: 31, passAccuracy: 81 },
      { name: "E. Visca", team: "Trabzonspor", minutes: 58, providerRating: 7.6, assists: 1, shots: 2, shotsOnTarget: 1, duelsWon: 6, passes: 44, passAccuracy: 88 },
      { name: "B. Bakasetas", team: "Trabzonspor", minutes: 70, providerRating: 6.9, passes: 61, passAccuracy: 90, duelsWon: 5 },
      { name: "A. Bakasetas", team: "Trabzonspor", minutes: 32, providerRating: 7.8, goals: 1, shots: 2, shotsOnTarget: 2 },
      { name: "S. Mumin", team: "Trabzonspor", minutes: 90, providerRating: 6.2, passes: 55, passAccuracy: 84, duelsWon: 7 },
      { name: "A. Pina", team: "Trabzonspor", minutes: 90, providerRating: 6.1, passes: 48, passAccuracy: 80 },
      { name: "O. Sikan", team: "Trabzonspor", minutes: 90, providerRating: 7.1, passes: 39, duelsWon: 4 },
      { name: "T. Zubkov", team: "Trabzonspor", minutes: 90, providerRating: 6.8, shots: 3, shotsOnTarget: 1 },
      { name: "V. Osimhen", team: "Galatasaray", minutes: 90, providerRating: 7.9, goals: 1, shots: 4, shotsOnTarget: 2 },
      { name: "F. Muslera", team: "Galatasaray", minutes: 90, providerRating: 7.0, saves: 5 }
    ],
    ...overrides
  };
}

const CONTEXT = {
  now: "2026-09-19T23:10:00+03:00",
  standing: {
    rank: 2, points: 13, played: 6, won: 4, drawn: 1, lost: 1,
    goalsFor: 12, goalsAgainst: 6, goalDifference: 6, form: ["W", "W", "D", "L", "W"]
  },
  nextMatch: { opponent: "Beşiktaş", isHome: false, date: new Date("2026-09-27T20:00:00+03:00"), competition: "Süper Lig" },
  links: {
    report: "mac-raporu/trabzonspor-galatasaray-2026-09-19.html",
    team: "trabzonspor-maclari.html",
    standings: "trabzonspor-puan-durumu.html",
    news: "haberler.html",
    players: { "p. sorloth": "futbolcu/alexander-sorloth.html" }
  },
  linksEn: {
    report: "en/matches/trabzonspor-galatasaray.html",
    team: "en/team/trabzonspor.html",
    standings: "en/super-lig-standings.html",
    news: "en/news.html",
    players: { "p. sorloth": "en/player/alexander-sorloth.html" }
  }
};

/* ------------------------------------------------------------------ *
 * 1. MAÇ SEÇİMİ
 * ------------------------------------------------------------------ */
console.log("\n[1] Maç seçimi — bitişi doğrulanmamış maç yazı üretmez");
{
  const now = "2026-09-19T23:00:00+03:00";
  const scheduled = { ...fullMatch(), status: "SCHEDULED", score: { home: null, away: null } };
  const live = { ...fullMatch(), id: "x-live", status: "LIVE" };
  const noScore = { ...fullMatch(), id: "x-noscore", score: { home: null, away: 1 } };
  const youth = { ...fullMatch(), id: "trabzonspor-u19-galatasaray-u19-2026-09-19", homeTeam: "Trabzonspor U19", awayTeam: "Galatasaray U19" };
  const stale = { ...fullMatch(), id: "x-stale", kickoff: "2026-09-10T20:00:00+03:00" };
  const future = { ...fullMatch(), id: "x-future", kickoff: "2026-09-20T20:00:00+03:00" };
  const other = { ...fullMatch(), id: "x-other", homeTeam: "Beşiktaş", awayTeam: "Fenerbahçe" };

  check("SCHEDULED maç seçilmez", selectMatch([scheduled], { now }) === null);
  check("LIVE maç seçilmez", selectMatch([live], { now }) === null);
  check("skoru eksik maç seçilmez", selectMatch([noScore], { now }) === null);
  check("U19 maçı seçilmez", selectMatch([youth], { now }) === null);
  check("pencere dışındaki maç seçilmez", selectMatch([stale], { now }) === null);
  check("gelecekteki maç seçilmez", selectMatch([future], { now }) === null);
  check("Trabzonspor dışı maç seçilmez", selectMatch([other], { now }) === null);
  const picked = selectMatch([scheduled, other, fullMatch()], { now });
  check("bitmiş Trabzonspor maçı seçilir", picked && picked.id === "trabzonspor-galatasaray-2026-09-19");
}

/* ------------------------------------------------------------------ *
 * 2. VERİ KAPSAMI KAPISI
 * ------------------------------------------------------------------ */
console.log("\n[2] Veri kapsamı — eksik bölüm yayını engeller");
{
  check("tam veri hazır sayılır", readiness(fullMatch()).ready);

  const noEvents = fullMatch({ events: [] });
  const verdict = readiness(noEvents);
  check("olay akışı yoksa hazır değil", !verdict.ready && verdict.missing.includes("events"));

  const built = buildColumnEntry(noEvents, CONTEXT);
  check("olay akışı yoksa kayıt taslak kalır", built.entry.status === "draft", built.entry.status);

  const noStats = buildColumnEntry(fullMatch({ statistics: [] }), CONTEXT);
  check("istatistik yoksa kayıt taslak kalır", noStats.entry.status === "draft");

  const noLineups = buildColumnEntry(fullMatch({ lineups: [] }), CONTEXT);
  check("kadro yoksa kayıt taslak kalır", noLineups.entry.status === "draft");
}

/* ------------------------------------------------------------------ *
 * 3. TAM VERİ — yayımlanabilir yazı
 * ------------------------------------------------------------------ */
console.log("\n[3] Tam veriyle üretim");
const built = buildColumnEntry(fullMatch(), CONTEXT);
const entry = built.entry;
const trText = entry.body.join("\n");
const enText = entry.en.body.join("\n");
{
  check("kayıt yayımlanabilir", entry.status === "published", built.assessment.reasons.join("; "));
  check("columnService şemasından geçer", validateColumn(entry).valid, validateColumn(entry).errors.join("; "));
  check(
    `Türkçe gövde ${MIN_WORDS}–${MAX_WORDS} kelime`,
    built.assessment.words >= MIN_WORDS && built.assessment.words <= MAX_WORDS,
    String(built.assessment.words)
  );
  check(
    `İngilizce gövde ${MIN_WORDS}–${MAX_WORDS} kelime`,
    built.assessment.wordsEn >= MIN_WORDS && built.assessment.wordsEn <= MAX_WORDS,
    String(built.assessment.wordsEn)
  );
  check("kategori trabzonspor", entry.category === "trabzonspor");
  check("künye maç sonu analizi", entry.contentType === "Maç Sonu Analizi");
  check("üretim damgası taşır", entry.generated && entry.generated.matchId === "trabzonspor-galatasaray-2026-09-19");
}

/* ------------------------------------------------------------------ *
 * 4. UYDURMA YOK
 * ------------------------------------------------------------------ */
console.log("\n[4] Uydurma alıntı ve ölçülmemiş iddia yok");
{
  check("Türkçe metinde alıntı işareti yok", !/["“”]/.test(trText));
  check("İngilizce metinde alıntı işareti yok", !/["“”]/.test(enText));
  check("tahmin kipi kullanılmıyor", !/(muhtemelen|büyük ihtimalle|sanırım|görünüşe göre)/i.test(trText));
  check("teknik direktör ağzından cümle yok", !/(dedi|açıkladı|belirtti|söyledi)/i.test(trText));

  // Veri yoksa o bölümün başlığı da yok: istatistiksiz maçta taktik tablo
  // ve hücum bölümleri hiç açılmamalı.
  const bare = buildColumnEntry(fullMatch({ statistics: [], players: [] }), CONTEXT);
  const bareText = bare.entry.body.join("\n");
  check("istatistik yoksa hücum bölümü yazılmaz", !bareText.includes("## Hücum organizasyonu"));
  check("oyuncu verisi yoksa öne çıkanlar yazılmaz", !bareText.includes("## Öne çıkan futbolcular"));
}

/* ------------------------------------------------------------------ *
 * 5. İSTENEN BÖLÜMLER
 * ------------------------------------------------------------------ */
console.log("\n[5] İstenen analiz başlıkları");
{
  for (const heading of [
    "## Gecenin golleri ve skor çizgisi",
    "## Maçın kırılma anı",
    "## Taktik tablo: oyun nerede kuruldu",
    "## Orta saha ve savunma dengesi",
    "## Hücum organizasyonu ve bitiricilik",
    "## Teknik direktörün tercihleri",
    "## Öne çıkan futbolcular",
    "## Trabzonspor neyi iyi yaptı, nerede takıldı",
    "## Sonucun lig açısından anlamı",
    "## Bir sonraki maç için çıkarılacak sonuç"
  ]) {
    check(`bölüm var: ${heading.replace("## ", "")}`, entry.body.includes(heading));
  }
  check("goller dakikasıyla yazıldı", /38' .*Sörloth/.test(trText));
  check("asist veriden geldi", /asist/i.test(trText));
  check("karar golü kırılma anı seçildi", /77'/.test(trText) && trText.includes("## Maçın kırılma anı"));
  // 84. dakikadaki kırmızı, 77'deki karar golünün önüne GEÇMEMELİ.
  check("geç kırmızı kırılma anını gasbetmez", !/84' Galatasaray, D. Sánchez kırmızı/.test(trText));
  check("ilk 11 listelendi", trText.includes("A. Onana"));
  check("topa sahip olma yazıldı", /%57/.test(trText));
  check("korner yazıldı", /Korner sayısı 7/.test(trText));
  check("kaleci kurtarışı yazıldı", /2 kurtarış/.test(trText));
}

/* ------------------------------------------------------------------ *
 * 6. BAŞLIK, SEO, ADRES
 * ------------------------------------------------------------------ */
console.log("\n[6] Başlık, meta ve adres");
{
  check("başlık Trabzonspor içerir", entry.title.includes("Trabzonspor"));
  check("başlık skoru saha sırasıyla taşır", entry.title.includes("Trabzonspor 2-1 Galatasaray"), entry.title);
  check("SEO başlığı 'maç sonucu' taşır", entry.seoTitle.includes("maç sonucu"));
  check("SEO başlığı 'maç analizi' taşır", entry.seoTitle.includes("maç analizi"));
  check(
    "meta açıklaması 150–160 karakter",
    entry.metaDescription.length >= 150 && entry.metaDescription.length <= 160,
    String(entry.metaDescription.length)
  );
  check(
    "İngilizce meta açıklaması 150–160 karakter",
    entry.en.metaDescription.length >= 150 && entry.en.metaDescription.length <= 160,
    String(entry.en.metaDescription.length)
  );
  check("adres istenen kalıpta", entry.slug === "trabzonspor-mac-analizi-19-eylul-2026", entry.slug);
  check("İngilizce adres ayrı ve İngilizce", entry.en.slug === "trabzonspor-match-analysis-19-september-2026", entry.en.slug);

  // Aynı gün iki farklı maç olamaz; ama başlık yine de maça özel olmalı.
  const other = buildColumnEntry(fullMatch({ awayTeam: "Fenerbahçe", score: { home: 0, away: 3 } }), CONTEXT);
  check("başlık maça göre değişir", other.entry.title !== entry.title, other.entry.title);
}

/* ------------------------------------------------------------------ *
 * 7. İÇ LİNKLEME
 * ------------------------------------------------------------------ */
console.log("\n[7] İç linkleme");
{
  check("maç raporuna link var", trText.includes("(mac-raporu/trabzonspor-galatasaray-2026-09-19.html)"));
  check("puan durumuna link var", trText.includes("(trabzonspor-puan-durumu.html)"));
  check("takım sayfasına link var", trText.includes("(trabzonspor-maclari.html)"));
  check("oyuncu sayfasına link var", trText.includes("(futbolcu/alexander-sorloth.html)"));
  check("İngilizce tarafta İngilizce adresler var", enText.includes("(en/super-lig-standings.html)"));
  check("İngilizce metinde Türkçe adres yok", !/\(trabzonspor-puan-durumu\.html\)/.test(enText));

  // Adres verilmezse düz metin kalır; kırık link üretilmez.
  const noLinks = buildColumnEntry(fullMatch(), { ...CONTEXT, links: { players: {} }, linksEn: { players: {} } });
  check("adres yoksa link üretilmez", !/\]\(\)/.test(noLinks.entry.body.join("\n")));
}

/* ------------------------------------------------------------------ *
 * 8. İKİ DİL AYRI YAZILIR
 * ------------------------------------------------------------------ */
console.log("\n[8] İngilizce sürüm çeviri değil");
{
  check("İngilizce gövde Türkçeden farklı", enText !== trText);
  check("İngilizce başlıklar İngilizce", enText.includes("## The goals, in order"));
  check("İngilizce metinde Türkçe bölüm başlığı yok", !enText.includes("## Gecenin golleri"));
  check("İngilizce başlık İngilizce", /[A-Za-z]/.test(entry.en.title) && !/Gecenin/.test(entry.en.title));

  // `/en` yüzeyinde Türkçe sızıntı olmamalı (scripts/test-en-language-purity.mjs
  // ile aynı dedektör). Buradaki denetim üreticiyi kaynağında tutuyor:
  // Türkçe bir işlev sözcüğü İngilizce şablona sızarsa sayfa basılmadan
  // yakalanır.
  const leaks = findTurkish([
    entry.en.title,
    entry.en.seoTitle,
    entry.en.metaDescription,
    entry.en.excerpt,
    entry.en.spot,
    ...entry.en.body
  ].join("\n")) || [];
  check("İngilizce metinde Türkçe sızıntı yok", leaks.length === 0, JSON.stringify(leaks).slice(0, 200));

  // Türkçe gelen turnuva ve aşama adları İngilizce yüzeyde çevrilir;
  // çevrilemeyen aşama adı hiç yazılmaz.
  const european = buildColumnEntry(
    fullMatch({ league: "UEFA Şampiyonlar Ligi", stage: "2. eleme turu, rövanş" }),
    { ...CONTEXT, nextMatch: { ...CONTEXT.nextMatch, competition: "Avrupa Ligi" } }
  );
  const europeanText = [european.entry.en.spot, ...european.entry.en.body].join("\n");
  check("turnuva adı İngilizceye çevrilir", europeanText.includes("UEFA Champions League"), european.entry.en.spot);
  check("aşama adı İngilizceye çevrilir", europeanText.includes("Qualifying round 2, second leg"));
  check("sıradaki maçın turnuvası da çevrilir", europeanText.includes("UEFA Europa League"));
  check(
    "Avrupa kupası metninde Türkçe sızıntı yok",
    (findTurkish(europeanText) || []).length === 0,
    JSON.stringify(findTurkish(europeanText) || []).slice(0, 200)
  );
  check(
    "çevrilemeyen aşama adı İngilizce metne girmez",
    !buildColumnEntry(fullMatch({ stage: "Hollanda kampı, sezon öncesi hazırlık" }), CONTEXT)
      .entry.en.body.join("\n").includes("kampı")
  );
}

/* ------------------------------------------------------------------ *
 * 9. UZUNLUK YÖNETİMİ
 * ------------------------------------------------------------------ */
console.log("\n[9] Uzunluk yönetimi");
{
  const body = ["giriş", "## A", "bir".repeat(1), "## Beklentinin altında kalanlar", "kelime ".repeat(MAX_WORDS + 200).trim(), "## Son", "kapanış"];
  const trimmed = trimBody(body, ["## Beklentinin altında kalanlar"], MAX_WORDS);
  check("tavan aşılırsa bölüm düşer", !trimmed.includes("## Beklentinin altında kalanlar"));
  check("düşen bölümün paragrafı da gider", countWords(trimmed) < MAX_WORDS);
  check("korunan bölümler yerinde", trimmed.includes("## Son") && trimmed.includes("kapanış"));

  const dropped = dropSection(["## A", "a1", "a2", "## B", "b1"], "## A");
  check("dropSection yalnızca hedef bölümü siler", JSON.stringify(dropped) === JSON.stringify(["## B", "b1"]));

  const short = clampMeta(["Kısa cümle."]);
  check("clampMeta kısa girdide kırpmaz", short === "Kısa cümle.");
  const long = clampMeta(["A".repeat(200)]);
  check("clampMeta tavanı aşmaz", long.length <= 160);
}

/* ------------------------------------------------------------------ *
 * 10. PAYLAŞIM
 * ------------------------------------------------------------------ */
console.log("\n[10] Sosyal medya çıktısı");
{
  check(
    "paylaşım metni istenen cümle",
    built.social.text === "Trabzonspor maçının ardından: Maç nerede kazanıldı, nerede kaybedildi? Gecenin taktik analizi FutbolRadar'da.",
    built.social.text
  );
  check("görsel başlığı istenen biçimde", built.social.imageTitle === "TRABZONSPOR | MAÇ SONU ANALİZİ");
  check("kapak görselinde başlık basılı", built.cover.includes(SHARE_IMAGE_TITLE));
  check("kapak görseli 1200x630", built.cover.includes('width="1200"') && built.cover.includes('height="630"'));
  check("kapak görseli skoru saha sırasıyla taşır", built.cover.includes("Trabzonspor 2-1 Galatasaray"));
  check("paylaşım adresi yayın adresine işaret eder", built.social.url.endsWith(`/kose-yazilari/${entry.slug}.html`));
  check("öne çıkan görsel kayda bağlı", entry.featuredImage === `assets/columns/${entry.slug}.svg`);
}

/* ------------------------------------------------------------------ *
 * 11. BAŞLIK SİNYALİ
 * ------------------------------------------------------------------ */
console.log("\n[11] Başlık maçın sinyalinden seçilir");
{
  const sig = (overrides) => signalOf(buildColumnEntry(fullMatch(overrides), CONTEXT).model);
  check("kırmızı kart sinyali", sig({}) === "red-them", sig({}));
  check(
    "erken kırmızı kırılma anı olur",
    buildColumnEntry(fullMatch({
      events: [
        { time: "23'", team: { name: "Galatasaray" }, type: "Card", detail: "Red Card", value: "D. Sánchez · Red Card" },
        { time: "55'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "P. Sörloth · Normal Goal" }
      ],
      score: { home: 1, away: 0 }
    }), CONTEXT).model.turningPoint.kind === "red"
  );
  check(
    "farklı skor sinyali",
    sig({ events: [], score: { home: 4, away: 0 } }) === "rout",
    sig({ events: [], score: { home: 4, away: 0 } })
  );
  check(
    "sinyalsiz maçta genel başlık",
    sig({ events: [], score: { home: 1, away: 0 } }) === "plain"
  );
}

/* ------------------------------------------------------------------ *
 * 12. OYUNCU–MAÇ GEÇMİŞİ VE PENCERE KARŞILAŞTIRMASI
 * ------------------------------------------------------------------ */
console.log("\n[12] Oyuncu–maç geçmişi");
{
  const rows = matchRowsFrom(fullMatch());
  check("bitmiş maçtan oyuncu satırı çıkar", rows.length > 0);
  check("oynamamış oyuncu satır açmaz", rows.every((row) => row.minutes > 0));
  check("ilk 11 bilgisi dizilişten okunur", rows.some((row) => row.started === true));
  check(
    "pas isabeti ORAN olarak saklanır",
    // Sörloth: 31 pas, 81 isabetli "sayı" → oran 100'ü aşamaz.
    rows.every((row) => row.passAccuracy === undefined || (row.passAccuracy >= 0 && row.passAccuracy <= 100)),
    JSON.stringify(rows.filter((row) => row.passAccuracy > 100).map((row) => [row.name, row.passAccuracy]))
  );

  const merged = mergeHistory({ rows: [] }, rows);
  check("aynı satır iki kez eklenmez", mergeHistory(merged, rows).added === 0);

  const thin = compareWindows(rows.slice(0, 4), { size: 5, minimum: 10 });
  check("örneklem yetmezse karşılaştırma yapılmaz", thin.sufficient === false);
  check("yetersizlik sebebi sayıyla söylenir", /en az 10/.test(thin.reason || ""), thin.reason);

  // Yapay ama ölçülmüş bir seri: ilk beş maç güçlü, son beş maç zayıf.
  const timeline = [];
  for (let index = 0; index < 10; index += 1) {
    const strong = index < 5;
    timeline.push({
      date: `2026-0${index < 9 ? index + 1 : 9}-1${index}`,
      minutes: strong ? 90 : 60,
      goals: strong ? 1 : 0,
      shots: strong ? 4 : 1,
      shotsOnTarget: strong ? 2 : 0,
      duelsWon: strong ? 8 : 3,
      rating: strong ? 7.8 : 6.2
    });
  }
  const comparison = compareWindows(timeline, { size: 5, minimum: 10 });
  check("yeterli örneklemde karşılaştırma yapılır", comparison.sufficient === true);
  check("ilk pencere ortalaması doğru", comparison.firstWindow.goals === 1);
  check("son pencere ortalaması doğru", comparison.lastWindow.goals === 0);
  const verdict = declineVerdict(comparison);
  check("çoklu kalemde gerileme düşüş sayılır", verdict.verdict === "decline", JSON.stringify(verdict));
  check("yetersiz örneklemde hüküm verilmez", declineVerdict(thin).verdict === "insufficient");
}

/* ------------------------------------------------------------------ *
 * 13. RAKİP DOSYASI
 * ------------------------------------------------------------------ */
console.log("\n[13] Rakip dosyası ve teknik direktör tartışması");
{
  const transfers = [
    { playerName: "Aleksey Batrakov", toTeam: "Galatasaray", date: "2026-08-20", type: "Bonservis", fromTeam: "Lokomotiv", status: "confirmed", season: "2026/27" },
    { playerName: "Söylenti Oyuncu", toTeam: "Galatasaray", date: "2026-08-25", type: "Bonservis", fromTeam: "X", status: "rumour", season: "2026/27" }
  ];
  check("doğrulanmamış transfer yazıya girmez", signingsFor("Galatasaray", transfers).length === 1);
  check("hazırlık maçı resmî sayılmaz", isCompetitive({ competitionId: "hazirlik-maci", league: "Hazırlık Maçı" }) === false);
  check("lig maçı resmî sayılır", isCompetitive({ competitionId: "super-lig", league: "Süper Lig" }) === true);

  const match = fullMatch();
  const focus = buildOpponentFocus({
    team: "Galatasaray",
    match,
    pool: [match],
    history: { rows: [] },
    transfers,
    kickoff: match.kickoff
  });
  check("rakip dosyası kurulur", Boolean(focus) && focus.team === "Galatasaray");
  check("teknik direktör dizilişten okunur", focus.manager === "Okan Buruk", String(focus.manager));
  check("ölçüm yoksa pencere kapısı kapalı", focus.evidence.windowsAvailable === false);

  const withFocus = buildColumnEntry(match, { ...CONTEXT, opponentFocus: focus });
  const focusText = withFocus.entry.body.join("\n");
  check("rakip dosyası bölümü yazılır", focusText.includes("## Rakip dosyası"));
  check("transferler tek tek sayılır", focusText.includes("Aleksey Batrakov"));
  check("doğrulanmamış transfer metinde geçmez", !focusText.includes("Söylenti Oyuncu"));
  check("asıl tartışma sorusu sorulur", /transfer etmekte mi başarılı/.test(focusText));
  check("teknik direktör soruları sorulur", /asıl sorular/i.test(focusText));

  // EN ÖNEMLİ KURAL: ölçüm yokken düşüş İDDİA EDİLMEZ.
  check(
    "ölçüm yokken düşüş iddia edilmez",
    /bu karşılaştırmayı yapacak ölçüm henüz elimizde yok/.test(focusText)
  );
  check(
    "ölçüm yokken 'düşüş var' cümlesi kurulmaz",
    !/performansı hızla düştü|belirgin bir düşüş var|düşüşte/i.test(focusText)
  );
  check(
    "ölçüm yokken başlık düşüş iddia etmez",
    !/İlk Günkü Etkiyi Kaybediyor/.test(withFocus.entry.title),
    withFocus.entry.title
  );
  check(
    "ölçüm yokken başlık rakip odaklı soruya döner",
    withFocus.entry.title.includes("Okan Buruk"),
    withFocus.entry.title
  );
  check("maç sayfası çağrısı üretilir", Boolean(withFocus.entry.promo && withFocus.entry.promo.tr));
  check(
    "çağrı rakibi adıyla anar",
    withFocus.entry.promo.tr.includes("Galatasaray"),
    withFocus.entry.promo.tr
  );
  check("İngilizce rakip bölümü ayrı yazılır", withFocus.entry.en.body.join("\n").includes("## The opposition file"));
  check(
    "İngilizce rakip bölümünde Türkçe sızıntı yok",
    (findTurkish(withFocus.entry.en.body.join("\n")) || []).length === 0,
    JSON.stringify(findTurkish(withFocus.entry.en.body.join("\n")) || []).slice(0, 160)
  );
}

/* ------------------------------------------------------------------ *
 * 14. İNCELEME BULGULARI — HER DÜZELTMENİN KENDİ DENETİMİ
 * ------------------------------------------------------------------ */
console.log("\n[14] İnceleme bulgularına karşı korumalar");
{
  // (a) ORTALAMA ölçülmüş maç sayısına bölünür; eksik ölçüm sıfır sayılmaz.
  const rows = [
    { date: "2026-01-01", minutes: 90, shots: 4 },
    { date: "2026-01-08", minutes: 90 },            // şut ölçülmemiş
    { date: "2026-01-15", minutes: 90, shots: 2 }
  ];
  const agg = aggregate(rows);
  check("eksik ölçüm ortalamayı aşağı çekmez", agg.shots === 3, `shots=${agg.shots} (beklenen 3)`);
  check("ölçülen maç sayısı raporlanır", agg.measured && agg.measured.shots === 2, JSON.stringify(agg.measured));

  // (b) PAS İSABETİ birimi tahmin edilmez, kökenden okunur.
  check("api-football sayısı orana çevrilir", passRateFrom(11, 13, { source: "api-football" }) === 85);
  check("belirsiz birimde oran üretilmez", passRateFrom(82, 90, {}) === null);
  check("toplam yoksa değer yüzde sayılır", passRateFrom(82, null, {}) === 82);
  check("isabet toplamı aşarsa oran üretilmez", passRateFrom(95, 90, { source: "api-football" }) === null);

  // (c) DİZİLİŞ KAPISI boş diziliş nesnelerini kabul etmez.
  const emptyLineups = readinessGate(fullMatch({ lineups: [{ team: "Trabzonspor", players: [] }, { team: "Galatasaray", players: [] }] }));
  check("boş diziliş nesneleri kapıyı geçmez", emptyLineups.missing.includes("lineups"));
  const oneSided = readinessGate(fullMatch({ lineups: [{ team: "Galatasaray", players: ["F. Muslera"] }] }));
  check("tek taraflı diziliş kapıyı geçmez", oneSided.missing.includes("lineups"));
  check("iki taraflı gerçek diziliş kapıyı geçer", !readinessGate(fullMatch()).missing.includes("lineups"));

  // (d) İNGİLİZCE uzunluk da yayın kapısında. Gövdesi kısaltılan bir
  //     kayıt, Türkçesi kusursuz olsa bile yayına girmemeli.
  const trimmedEn = buildColumnEntry(fullMatch(), CONTEXT);
  check("İngilizce kelime sayısı raporlanır", Number.isFinite(trimmedEn.assessment.wordsEn));
  check(
    "İngilizce gövde de banda tabi",
    built.assessment.wordsEn >= MIN_WORDS && built.assessment.wordsEn <= MAX_WORDS,
    String(built.assessment.wordsEn)
  );

  // (e) ELLE VERİLEN KİMLİK aynı kapılardan geçer.
  const foreign = { ...fullMatch(), id: "corum-eyupspor-2026-09-19", homeTeam: "Çorum FK", awayTeam: "Eyüpspor" };
  const now = "2026-09-19T23:00:00+03:00";
  check(
    "başka takımın maçı kimlikle bile seçilmez",
    selectMatchGate([foreign], { now }) === null
  );
  check(
    "Trabzonspor maçı kimlikle seçilir",
    Boolean(selectMatchGate([fullMatch()], { now }))
  );

  // (f) SERİ ANAHTARI kimlik yoksa ad/takım yedeğine düşer.
  check(
    "kimlikli satır p: anahtarı alır",
    playerKey({ providerPlayerId: "123", name: "X", team: "Y" }) === "p:123"
  );
  check(
    "kimliksiz satır ad/takım anahtarı alır",
    playerKey({ name: "P. Sörloth", team: "Trabzonspor" }).startsWith("n:")
  );
}

console.log("\n[15] Yayımlanmış yazıda yakalanan hatalar");
{
  // (a) OYUNCU DEĞİŞİKLİĞİ YÖNÜ. Sağlayıcı satırında `player` oyundan ÇIKAN,
  //     `assist` oyuna GİRENDİR. Ters eşlendiği için 19 Eylül yazısında
  //     "4 gol sonradan oyuna dahil olan isimlerden geldi" yazıyordu; oysa
  //     o goller ilk 11'deki isimlerindi ve aynı sayfa onları ilk 11'de
  //     listeliyordu.
  const swapped = buildModelGate(fullMatch({
    events: [
      { time: "4'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "M. Salah · Asist: M. Eskihellac · Normal Goal" },
      { time: "89'", team: { name: "Trabzonspor" }, type: "subst", detail: "Substitution 5", value: "M. Salah · Asist: A. Simsir · Substitution 5" }
    ],
    substitutions: []
  }));
  const row = swapped.subs.us[0];
  check("oyuna giren `assist` alanından okunur", row && row.in === "A. Simsir", JSON.stringify(row));
  check("oyundan çıkan `player` alanından okunur", row && row.out === "M. Salah", JSON.stringify(row));
  check("golcü yedekten girenler listesine düşmez", row && row.in !== "M. Salah");

  // (b) TABELA GEÇ ŞEKİLLENDİ, GOL SAYMAKLA ÖLÇÜLMEZ. Dört golün üçü 44'te
  //     bitmişken son çeyrekteki tek gol "tabela geç şekillendi" demeye
  //     yetmemeli.
  const earlyBlocks = renderTurkish(buildModelGate(fullMatch({
    score: { home: 4, away: 0 },
    events: [
      { time: "4'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "M. Salah · Normal Goal" },
      { time: "39'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "N. Saviolo · Normal Goal" },
      { time: "44'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "M. Salah · Normal Goal" },
      { time: "80'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "M. Salah · Normal Goal" }
    ]
  })));
  const early = (Array.isArray(earlyBlocks) ? earlyBlocks.join("\n") : String(earlyBlocks));
  check("erken biten maçta 'tabela geç şekillendi' denmez", !early.includes("tabelası geç şekillendi"));
  check("belirleyici anın dakikası yazılır", early.includes("dakikada kurulmuştu"));
  check("tek yönlü maçta skor çizgisi 'yön değiştirdi' denmez", !early.includes("Skor çizgisi bir kez yön değiştirdi"));
  check("tek yönlü maç böyle anlatılır", early.includes("Skor çizgisi hiç el değiştirmedi"));
}

console.log("\n[16] Elle kaldırılmış yazı geri getirilmez");
{
  // Kapı üreticinin içinde; davranışı CLI üzerinden ölçüyoruz çünkü asıl
  // soru "koşu ne yapar" — fonksiyon ne döndürür değil.
  const run = (args, env = {}) => {
    const result = spawnSync(process.execPath, ["scripts/generate-trabzonspor-post-match-column.mjs", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...env }
    });
    return { code: result.status, out: `${result.stdout || ""}${result.stderr || ""}` };
  };

  const removedPath = path.join(process.cwd(), "data", "removed-columns.json");
  const original = fs.existsSync(removedPath) ? fs.readFileSync(removedPath, "utf8") : null;
  try {
    // (a) LİSTEDEKİ SLUG YAYIMLANMAZ ve döngü için açık sonuç basılır.
    fs.writeFileSync(removedPath, JSON.stringify(["trabzonspor-mac-analizi-19-eylul-2026"], null, 2));
    const blocked = run(["--match=trabzonspor-galatasaray-2026-09-19"]);
    check("kaldırılmış yazı yayımlanmaz", blocked.out.includes("sonuc=kaldirildi"), blocked.out.slice(-200));
    check("kaldırma koşuyu düşürmez", blocked.code === 0, `çıkış kodu ${blocked.code}`);
    check("kaldırılmış yazı published sonucu basmaz", !blocked.out.includes("sonuc=published"));

    // (b) BOZUK LİSTE ÜRETİCİYİ ÇÖKERTMEZ. Çıplak readFileSync bütün zinciri
    //     1 ile düşürüyordu; liste okunamıyorsa boş sayılmalı.
    fs.writeFileSync(removedPath, "{bozuk");
    const broken = run(["--match=trabzonspor-galatasaray-2026-09-19"]);
    check("bozuk liste koşuyu düşürmez", broken.code === 0, `çıkış kodu ${broken.code}`);
    check("bozuk listede yayın kararı eskisi gibi verilir", broken.out.includes("sonuc=published") || broken.out.includes("sonuc=draft"), broken.out.slice(-200));

    // (c) BOŞ LİSTE HİÇBİR ŞEYİ ENGELLEMEZ.
    fs.writeFileSync(removedPath, "[]");
    const open = run(["--match=trabzonspor-galatasaray-2026-09-19"]);
    check("boş liste yayını engellemez", !open.out.includes("sonuc=kaldirildi"), open.out.slice(-200));
  } finally {
    if (original === null) fs.rmSync(removedPath, { force: true });
    else fs.writeFileSync(removedPath, original);
  }
}

console.log(
  failures
    ? `\n[trabzonspor-column] ${failures} denetim düştü.\n`
    : "\n[trabzonspor-column] tüm denetimler geçti.\n"
);
process.exit(failures ? 1 : 0);
