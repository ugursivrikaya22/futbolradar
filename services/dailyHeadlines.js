/**
 * GÜNÜN ÜÇ BAŞLIĞI — kancası olan, uydurması olmayan.
 *
 * AMAÇ. Ana sayfa "bugün burada ne var?" sorusunu ilk ekranda yanıtlasın.
 * Kart ızgarası bunu yapmıyor: on maç kartı eşit ağırlıkta duruyor, hiçbiri
 * "şuna bak" demiyor. Üç başlık, sıralanmış ve gerekçeli bir giriş sunar.
 *
 * TEK KURAL: HER BAŞLIK GERÇEK BİR ALANDAN DOĞAR.
 *
 * Bir başlık iki parçadan oluşur ve İKİSİ DE kayıttan gelir:
 *
 *   başlık (title)  — ne oldu/olacak. Skor, analiz başlığı ya da eşleşme.
 *   kanca  (hook)   — neden tıklamalı. Analizin kendi cümlesi, maçın özeti,
 *                     saha ve saat bilgisi gibi DOĞRULANMIŞ bir ayrıntı.
 *
 * Kancası olmayan aday DÜŞER. Bu, "zayıfsa gizle" kuralının kendisidir:
 * "Analiz yakında", "Veriler yükleniyor", "Kaçırma!" gibi içi boş kancalar
 * üretmek yerine başlık hiç çizilmez. Üç aday yoksa iki, iki yoksa bir,
 * hiç yoksa bölüm tümüyle gizlenir.
 *
 * UYDURULMAYANLAR. Skor, xG, oran, tahmin, "günün maçı" gibi editoryal
 * iddialar burada ÜRETİLMEZ. Skor yalnızca kayıtta varsa yazılır; analiz
 * cümlesi yalnızca daha önce gerçek istatistikten üretilmiş `analysis`
 * alanından alınır. Bu modül veri OKUR, veri YARATMAZ.
 *
 * Kural tek yerde durur: istemci (app.js) ve ön derleme
 * (scripts/prerender-core-pages.mjs) aynı sıralamayı üretir.
 */
// DİKKAT: `isLiveStatus`/`isFinishedStatus` MAÇ KAYDI alır, durum dizesi
// değil — içeride `matchState(match)` çağırıyorlar ve o da canlı-zaman aşımı
// gibi kayda bağlı kuralları uyguluyor. Bunlara kanonik durum dizesi
// geçirmek sessizce her zaman `false` döndürür.
const { isFinishedStatus, isLiveStatus, istanbulDay, liveVerdict } = require("./matchStatus");
const { isTurkishMatch } = require("./turkishTeams");

/** Ekranda en fazla kaç başlık? Üç, "seçilmiş" ile "liste" arasındaki sınır. */
const MAX_HEADLINES = 3;

/**
 * Aday sırası. Küçük sayı önce çizilir.
 *
 * Sıra ilgiye göre: sahada olan bitmiş olandan, bitmiş olan başlayacak
 * olandan önce gelir; Türk takımı maçı kendi bandında öne alınır.
 */
const RANKS = Object.freeze({
  LIVE_TURKISH: 0,
  LIVE_OTHER: 1,
  FINISHED_TURKISH: 2,
  FINISHED_OTHER: 3,
  UPCOMING_TURKISH: 4,
  UPCOMING_OTHER: 5
});

/**
 * Metin okuma — VE SESSİZ `[object Object]` KALKANI.
 *
 * `String(value)` bir nesneye uygulandığında `"[object Object]"` üretir ve bu
 * dize her testten geçer: doğrudur, boş değildir, uzunluğu vardır. Ekrana
 * kadar giden yolda onu durduran hiçbir şey yoktur. Ana sayfada üç başlığın
 * kancası tam olarak böyle bozuldu: kanca alanına bir rapor nesnesi verildi.
 *
 * Bu yüzden dizeye çevirme yalnızca zaten dize/sayı olan değerler için
 * yapılır. Nesne gelirse BOŞ dize döner — böylece "kancası olmayan aday
 * düşer" kuralı devreye girer ve kart hiç çizilmez. Bozuk bir kanca
 * göstermektense başlığı hiç göstermemek doğrudur.
 */
function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  // Nesne, dizi, fonksiyon, symbol: metin değil. Uydurma yerine boş dön.
  return "";
}

/**
 * Cümlenin ilk tanesi. Kanca uzun bir paragraf değil, tek nefeslik olmalı.
 *
 * Nokta her zaman cümle sonu DEĞİLDİR. Futbol metinlerinde iki istisna sık:
 *
 *   ondalık ayırıcı — "1.54 xG", "0.06"
 *   kısaltılmış ad  — "A. Italiano", "B. Dortmund", "R. Madrid"
 *
 * İlkini "noktadan sonra boşluk olmalı" kuralı eler. İkincisini elemek için
 * noktadan önceki sözcüğe bakılır: tek harfse bu bir baş harftir, cümle
 * sonu değil. Bu olmadan "…maçında A. Italiano 2-2 bitirdi." kancası
 * "…maçında A." olarak kesiliyordu.
 */
function firstSentence(value, limit = 160) {
  const raw = text(value);
  if (!raw) return "";

  const boundary = /[.!?](?=\s|$)/g;
  let sentence = raw;
  let hit;
  while ((hit = boundary.exec(raw)) !== null) {
    // Noktadan önceki sözcük tek harfse (baş harf), burası cümle sonu değil.
    const before = raw.slice(0, hit.index);
    if (hit[0] === "." && /(^|[\s(«"'])\p{L}$/u.test(before)) continue;
    sentence = raw.slice(0, hit.index + 1);
    break;
  }

  sentence = text(sentence);
  if (sentence.length <= limit) return sentence;
  return `${sentence.slice(0, limit - 1).trimEnd()}…`;
}

/** Skor kayıtta gerçekten var mı? `0-0` geçerli, `null` değil. */
function scoreOf(match) {
  const score = match && match.score;
  if (!score || typeof score !== "object") return null;

  const home = Number(score.home);
  const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;

  return { home, away };
}

/**
 * Maçın kalıcı sayfası. UYDURULMAZ: yalnızca kayıtta yazan yol kullanılır,
 * yoksa var olan bir liste sayfasına düşülür. Var olmayan bir dosyaya
 * bağlanmak, kancası olan bir başlığı 404'e göndermek olurdu.
 */
function hrefFor(match, reports) {
  // SIRA: önce maçın KALICI sayfası. `matchPage` sicilden damgalanıyor
  // (`services/matchSeoPages.js#withMatchPages`) ve o adres maçın tek
  // kanonik adresi; `mac-raporu/...` raporu ise aynı maçın kopyası ve
  // kanonik'i bu sayfayı gösteriyor. Rapor yolu önce okunursa manşet,
  // sayfa yüklendikten sonra kopya adrese bağlanır — statik HTML'de
  // birleştirilmiş bağlantıyı JS geri bozar.
  //
  // Uydurma yok, sıra değişti: her aday yine yalnızca kayıtta YAZAN yol.
  const page = text(match && match.matchPage);
  if (page) return `./${page.replace(/^\.?\//, "")}`;

  const report = reportFor(match, reports);
  const reportPath = report && (text(report.reportUrl) || text(report.seo && report.seo.path));
  if (reportPath) return `./${reportPath.replace(/^\.?\//, "")}`;

  const legacy = text(match && match.analysisPage);
  if (legacy) return `./${legacy.replace(/^\.?\//, "")}`;

  if (isLiveStatus(match)) {
    return "./canli-skor.html";
  }

  return "./bugunun-maclari.html";
}

function reportFor(match, reports) {
  if (!Array.isArray(reports) || !match) return null;
  const id = text(match.id);
  if (!id) return null;
  return reports.find((record) => text(record && record.matchId) === id) || null;
}

function pairLabel(match) {
  const home = text(match && match.homeTeam);
  const away = text(match && match.awayTeam);
  if (!home || !away) return "";
  return `${home} – ${away}`;
}

/**
 * CANLI MAÇ BAŞLIĞI.
 *
 * Kanca skorun kendisi olamaz — skor zaten başlıkta. Kanca, okuyucunun
 * sayfada ne bulacağını söyler ve yalnızca kayıtta karşılığı varken yazılır.
 */
function liveHeadline(match, reports) {
  const score = scoreOf(match);
  const pair = pairLabel(match);
  if (!pair) return null;

  const title = score
    ? `${text(match.homeTeam)} ${score.home}-${score.away} ${text(match.awayTeam)}`
    : pair;

  // Kanca sırası: maçın kendi özeti → devre arası skoru → lig ve saha.
  //
  // `Number(null)` sıfır, `Number.isFinite(0)` doğru: yayımlanmamış ilk yarı
  // skoru bu tuzakta "0-0" diye basılıyordu, yani olmayan bir skor
  // uyduruluyordu. Boşluk önce elenir. (Aynı korumanın doğru yazılmış hâli:
  // services/matchEligibility.js)
  const published = (value) =>
    value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const halftime = match.score && published(match.score.halftimeHome)
    && published(match.score.halftimeAway)
    ? `İlk yarı ${Number(match.score.halftimeHome)}-${Number(match.score.halftimeAway)}.`
    : "";
  const venue = text(match.venue);
  const league = text(match.league);
  const place = league && venue ? `${league} · ${venue}` : league || venue;

  const hook = firstSentence(match.summary) || halftime || place;
  if (!hook) return null;

  return {
    key: `live:${text(match.id)}`,
    rank: isTurkishMatch(match) ? RANKS.LIVE_TURKISH : RANKS.LIVE_OTHER,
    kicker: "Canlı",
    state: "live",
    title,
    hook,
    href: hrefFor(match, reports),
    matchId: text(match.id),
    evidence: [score ? "score" : "teams", match.summary ? "summary" : (halftime ? "score.halftime" : "league/venue")]
  };
}

/**
 * BİTEN MAÇ BAŞLIĞI.
 *
 * Başlık, varsa analizin KENDİ başlığıdır: o cümle gerçek istatistikten
 * üretilmiştir ve skor satırından daha çok şey söyler. Analiz yoksa skor
 * satırı kullanılır — ama o zaman kanca da gerçek bir cümleden gelmeli,
 * yoksa aday düşer.
 */
function finishedHeadline(match, reports) {
  const score = scoreOf(match);
  const pair = pairLabel(match);
  if (!pair) return null;

  const analysis = (match && match.analysis) || {};
  const scoreLine = score
    ? `${text(match.homeTeam)} ${score.home}-${score.away} ${text(match.awayTeam)}`
    : pair;

  const analysisHeadline = text(analysis.headline);
  const title = analysisHeadline || scoreLine;

  // Kanca: analizin ilk maddesi → girişi → maçın özeti → raporun özeti.
  //
  // `digest` bir NESNEDİR (`{ headline, paragraph, result, ... }`), cümle
  // değil. Doğrudan geçirilirse `String()` onu `"[object Object]"` yapardı;
  // ana sayfadaki üç başlığın kancası tam olarak bu yüzden bozulmuştu.
  // Anlatan alan `paragraph`; `headline` skor satırını tekrarladığı için
  // yalnızca yedek.
  const report = reportFor(match, reports);
  const digest = (report && report.digest) || {};
  const keyPoint = Array.isArray(analysis.keyPoints) ? text(analysis.keyPoints[0]) : "";
  const hook = firstSentence(keyPoint)
    || firstSentence(analysis.lead)
    || firstSentence(match.summary)
    || firstSentence(digest.paragraph)
    || firstSentence(digest.headline);

  if (!hook) return null;

  return {
    key: `finished:${text(match.id)}`,
    rank: isTurkishMatch(match) ? RANKS.FINISHED_TURKISH : RANKS.FINISHED_OTHER,
    kicker: analysisHeadline ? "Maç sonu analizi" : "Maç sonucu",
    state: "finished",
    // Analiz başlığı skoru içermiyor; skor satırını ayrı taşıyoruz ki
    // kart hem ne olduğunu hem kaç kaç bittiğini gösterebilsin.
    title,
    subtitle: analysisHeadline && score ? scoreLine : "",
    hook,
    href: hrefFor(match, reports),
    matchId: text(match.id),
    evidence: [analysisHeadline ? "analysis.headline" : "score", keyPoint ? "analysis.keyPoints" : "analysis.lead/summary"]
  };
}

/**
 * BAŞLAYACAK MAÇ BAŞLIĞI.
 *
 * Burada söylenecek "olan" bir şey yok, o yüzden kanca somut olmalı: saat,
 * saha, turnuva aşaması. Bunların hiçbiri yoksa başlık çizilmez — "büyük
 * maç geliyor" demek, veri değil reklamdır.
 */
function upcomingHeadline(match, reports) {
  const pair = pairLabel(match);
  if (!pair) return null;

  const time = text(match.time);
  const venue = text(match.venue);
  const stage = text(match.stage);
  const league = text(match.league);

  const parts = [];
  if (time) parts.push(`${time} TSİ`);
  if (stage) parts.push(stage);
  else if (league) parts.push(league);
  if (venue) parts.push(venue);

  const hook = parts.join(" · ");
  if (!hook) return null;

  return {
    key: `upcoming:${text(match.id)}`,
    rank: isTurkishMatch(match) ? RANKS.UPCOMING_TURKISH : RANKS.UPCOMING_OTHER,
    kicker: "Bugün",
    state: "upcoming",
    title: pair,
    hook,
    href: hrefFor(match, reports),
    matchId: text(match.id),
    evidence: ["homeTeam/awayTeam", time ? "time" : (stage ? "stage" : "league"), venue ? "venue" : ""].filter(Boolean)
  };
}

/** Kayıt bugüne mi ait? Tarih karşılaştırması İstanbul gününe göre. */
function isOnDay(match, day) {
  if (!day) return true;
  return istanbulDay(text(match && (match.kickoff || match.date))) === day;
}

/**
 * Günün başlıkları.
 *
 * @param {Array} matches Küratörlü maç kayıtları.
 * @param {Object} [options]
 * @param {string} [options.today] `YYYY-MM-DD`, İstanbul günü.
 * @param {Array}  [options.reports] Maç sonu rapor kayıtları (kalıcı bağlantı için).
 * @param {number} [options.limit] En fazla kaç başlık (varsayılan 3).
 * @returns {Array} Sıralanmış başlıklar. Uygun aday yoksa BOŞ dizi.
 */
function buildDailyHeadlines(matches, options = {}) {
  const list = Array.isArray(matches) ? matches : [];
  const reports = Array.isArray(options.reports) ? options.reports : [];
  const day = text(options.today);
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : MAX_HEADLINES;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  const candidates = [];

  // İlgi puanı maç kaydında taşınır; başlığa olduğu gibi kopyalanır.
  const withRelevance = (headline, match) => {
    if (!headline) return headline;
    const score = match && match.relevance;
    if (Number.isFinite(score)) headline.relevance = score;
    return headline;
  };

  for (const match of list) {
    if (!match || typeof match !== "object") continue;

    // Canlı maç güne bakılmaksızın alınır: gece yarısını geçen bir maç hâlâ
    // sahadadır ve "bugün" filtresi onu haksız yere elerdi. Ama BAYAT canlı
    // (sağlayıcı bir maçı hiç "FINISHED"e çevirmemiş) aynı korumadan geçer:
    // services/matchStatus.js#liveVerdict, başlama üzerinden 150 dakikadan
    // uzun süre geçmişse canlı iddiasını reddeder.
    if (isLiveStatus(match) && liveVerdict(match, { nowMs }).live) {
      const headline = withRelevance(liveHeadline(match, reports), match);
      if (headline) candidates.push(headline);
      continue;
    }

    if (isFinishedStatus(match) || isLiveStatus(match)) {
      // Biten maç için pencere bugün: dünkü sonuçlar "günün başlığı" değil.
      // Bayat canlı da buraya düşer — muhtemelen bitmiş, sonucu güvenilmez.
      if (!isOnDay(match, day)) continue;
      const headline = withRelevance(finishedHeadline(match, reports), match);
      if (headline) candidates.push(headline);
      continue;
    }

    if (!isOnDay(match, day)) continue;
    const headline = withRelevance(upcomingHeadline(match, reports), match);
    if (headline) candidates.push(headline);
  }

  // SIRA: önce İLGİ, sonra durum.
  //
  // `rank` yalnızca durumu biliyor (canlı > biten > başlayacak) ve maçın
  // KİMİ ilgilendirdiğini hiç bilmiyor. Sonuç ana sayfada görünür oldu:
  // biten üç Güney Amerika maçı `FINISHED_OTHER` ile `UPCOMING_TURKISH`in
  // önüne geçtiği için günün üç başlığını doldurdu ve Fenerbahçe'nin aynı
  // gün oynanacak Şampiyonlar Ligi maçı listeye hiç giremedi.
  //
  // İlgi puanı maç kaydına damgalanır (services/matchRelevance.js; API ve
  // ön derleme aynı sayıyı yazar) — bu modül onu yalnızca OKUR. Böylece
  // yarışma kataloğu istemciye inmeden istemci ve servis aynı sırayı üretir.
  // Puan yoksa eski davranış aynen sürer: kayıt eksikse sıra bozulmaz.
  const relevanceOf = (headline) =>
    (Number.isFinite(headline.relevance) ? headline.relevance : Number.NEGATIVE_INFINITY);

  const seen = new Set();
  const unique = [];
  const ordered = candidates.sort((left, right) => {
    const gap = relevanceOf(right) - relevanceOf(left);
    if (gap !== 0 && Number.isFinite(gap)) return gap;
    return left.rank - right.rank;
  });
  for (const headline of ordered) {
    const id = headline.matchId || headline.key;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(headline);
  }

  return unique.slice(0, limit);
}

module.exports = {
  MAX_HEADLINES,
  RANKS,
  buildDailyHeadlines,
  firstSentence
};
