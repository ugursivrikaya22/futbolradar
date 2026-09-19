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
      { name: "A. Onana", team: "Trabzonspor", minutes: 90, providerRating: 7.4, saves: 2, passes: 34, passAccuracy: 78 },
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

console.log(
  failures
    ? `\n[trabzonspor-column] ${failures} denetim düştü.\n`
    : "\n[trabzonspor-column] tüm denetimler geçti.\n"
);
process.exit(failures ? 1 : 0);
