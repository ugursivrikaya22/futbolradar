/**
 * AYRIŞTIRICI — getirilen belgeden transfer ADAYI çıkarır.
 *
 * Buradan çıkan şey "transfer" değil, ADAYdır: doğrulayıcı ve güven katmanı
 * henüz konuşmadı. Ayrıştırıcının işi metinden yapı çıkarmak; neyin
 * yayımlanacağına karar vermek değil.
 *
 * İKİ KATMAN:
 *   1. BELGE AYRIŞTIRMA (rss/html/json) → başlık + özet + bağlantı + tarih.
 *   2. TRANSFER ÇIKARIMI → başlık/özet metninden oyuncu, kulüpler, tür ve
 *      DURUM çıkarımı.
 *
 * Durum çıkarımı kalıplara dayanıyor ve KASITLI OLARAK TEMKİNLİ: bir kalıp
 * tutmazsa aday `rumor` doğar. Yanlış tarafa düşmenin bedeli asimetriktir —
 * söylentiyi resmî sanmak, resmîyi söylenti sanmaktan çok daha pahalıdır.
 *
 * Ayrıca: buradaki durum bir TALEPTİR. Kaynak katmanı izin vermezse
 * statusModel.resolveStatus onu aşağı çeker. Yani "resmen açıkladı" yazan
 * bir gazete haberi tek başına `official` üretemez.
 */

const { canonicalClub, canonicalPlayer, fold, isTurkishClub } = require("./normalizer.js");

/** XML/HTML varlıklarını çözer ve etiketleri söker. */
function stripMarkup(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(block, ...names) {
  for (const name of names) {
    const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
    if (match) return stripMarkup(match[1]);
    const selfClosing = new RegExp(`<${name}[^>]*href=["']([^"']+)["'][^>]*/?>`, "i").exec(block);
    if (selfClosing) return stripMarkup(selfClosing[1]);
  }
  return "";
}

/**
 * RSS/Atom belgesini kayıtlara çevirir.
 * @returns {Array<{title, summary, link, publishedAt}>}
 */
function parseFeed(body) {
  const text = String(body || "");
  const blocks = text.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];

  return blocks.map((block) => ({
    title: firstTag(block, "title"),
    summary: firstTag(block, "description", "summary", "content"),
    link: firstTag(block, "link", "guid"),
    publishedAt: firstTag(block, "pubDate", "published", "updated", "dc:date")
  })).filter((entry) => entry.title);
}

/**
 * Genel HTML liste ayrıştırma: <a> bağlantılarından başlık/bağlantı çifti.
 * KAP gibi tablo tabanlı sayfalar için yeterli; seçici gerekmez.
 */
function parseHtmlLinks(body, options = {}) {
  const base = String(options.baseUrl || "");
  const anchors = String(body || "").match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  const seen = new Set();
  const entries = [];

  for (const anchor of anchors) {
    const href = (/href=["']([^"']+)["']/i.exec(anchor) || [])[1] || "";
    const title = stripMarkup(anchor);
    if (!title || title.length < 12) continue;

    let link = href;
    if (link.startsWith("/") && base) {
      try { link = new URL(link, base).toString(); } catch { /* bağlantı olduğu gibi kalır */ }
    }
    if (!/^https?:\/\//i.test(link)) continue;
    if (seen.has(link)) continue;
    seen.add(link);

    entries.push({ title, summary: "", link, publishedAt: "" });
  }

  return entries;
}

function parseJsonItems(body, options = {}) {
  let payload;
  try {
    payload = JSON.parse(String(body || ""));
  } catch {
    return [];
  }
  const path = options.itemsKey || "items";
  const list = Array.isArray(payload) ? payload : (Array.isArray(payload[path]) ? payload[path] : []);
  return list.map((row) => ({
    title: stripMarkup(row && (row.title || row.headline || "")),
    summary: stripMarkup(row && (row.summary || row.description || "")),
    link: String((row && (row.url || row.link)) || ""),
    publishedAt: String((row && (row.publishedAt || row.date)) || "")
  })).filter((entry) => entry.title);
}

/** Belgeyi biçimine göre ayrıştırır. */
function parseDocument(source, body) {
  const format = String((source && source.format) || "rss");
  if (format === "rss") return parseFeed(body);
  if (format === "json") return parseJsonItems(body, source);
  return parseHtmlLinks(body, { baseUrl: (source && source.url) || "" });
}

// ── Transfer çıkarımı ───────────────────────────────────────────────────

/**
 * Durum kalıpları. Sıra ÖNEMLİ: en kesin ifade en üstte, ilk tutan kazanır.
 * Her kalıp katlanmış (Türkçe'den arındırılmış) metne uygulanır.
 */
const STATUS_PATTERNS = [
  { status: "denied", patterns: ["yalanladi", "yalanlama", "asilsiz", "gercegi yansitmiyor", "boyle bir gorusme yok", "boyle bir anlasma yok"] },
  // Kalıplar EK ALMAYAN köke yazılır: Türkçe çekim ekleri ("transferinden",
  // "iptal etti/edildi") tam cümle kalıplarını kaçırır.
  { status: "cancelled", patterns: ["vazgecti", "iptal etti", "iptal edildi", "iptal oldu", "rafa kaldirdi", "masadan kalkti", "gorusmeleri sonlandirdi"] },
  { status: "official", patterns: ["resmen acikladi", "resmen aciklandi", "resmi aciklama", "imzayi atti", "imzalari atti", "sozlesme imzaladi", "kadrosuna katti", "transferi tamamlandi", "transfer oldu", "kap a bildirdi", "kap bildirimi"] },
  { status: "agreement_reached", patterns: ["anlasmaya vardi", "anlasma saglandi", "el sikisti", "prensipte anlasti", "prensip anlasmasi", "her konuda anlasti"] },
  { status: "advanced_talks", patterns: ["sona yaklasti", "sona gelindi", "saglik kontrolu", "istanbul a geliyor", "imza icin", "son asamaya", "bitme asamasinda"] },
  { status: "negotiation", patterns: ["gorusmelere basladi", "gorusuyor", "temaslara basladi", "teklif yapti", "teklifini iletti", "masaya oturdu"] },
  // "X gündeminde" ve "ilgileniyor" AKTİF GÖRÜŞME DEĞİLDİR: kulübün bir
  // oyuncuyu beğenmesiyle masaya oturması aynı şey değil. Bu kalıpları
  // negotiation'a saymak, her ilgi haberini görüşmeye terfi ettirirdi.
  { status: "rumor", patterns: ["iddia", "iddiasi", "one suruldu", "raporuna gore", "soz ediliyor", "ilgileniyor", "ilgilendigi", "gundeminde", "istiyor", "rotasinda"] }
];

/** Transfer türü kalıpları. */
const TYPE_PATTERNS = [
  { type: "Kiralık dönüş", patterns: ["kiralik donus", "kiraliktan dondu", "kiralik bitti"] },
  { type: "Kiralık", patterns: ["kiralik", "kiraladi", "kiralik olarak"] },
  { type: "Sözleşme feshi", patterns: ["sozlesme feshi", "karsilikli fesih", "yollarini ayirdi", "sozlesmesini feshetti"] },
  { type: "Bonservissiz", patterns: ["bonservissiz", "serbest oyuncu", "bedelsiz"] },
  { type: "Bonservis", patterns: ["bonservis", "transfer bedeli", "satin aldi"] }
];

/**
 * Metin transferle ilgili mi? İlgisiz spor haberi hatta girmemeli.
 *
 * Liste iki gruptan oluşuyor. İlk grup kesin transfer sözcükleri. İkinci
 * grup SÖYLENTİ dilidir ("ilgileniyor", "gündeminde", "rotasında") ve
 * gerçek haber başlıklarının çoğu bu grupta: "Fenerbahçe gündeminde X
 * iddiası" cümlesinde "transfer" sözcüğü hiç geçmez.
 *
 * İkinci grup yanlış pozitif riskini artırır; bu yüzden tek başına yetmez.
 * Aday üretmek için AYRICA bir Süper Lig kulübü geçmeli (extractCandidate)
 * ve oyuncu adı veritabanında bulunmalı (playerDirectory). Üç kapı birden
 * geçilmeden hiçbir kayıt yayımlanmıyor.
 */
const TRANSFER_MARKERS = [
  // Kesin transfer sözcükleri
  "transfer", "bonservis", "kiralik", "imza", "sozlesme", "anlasma",
  "kadrosuna", "takviye", "ayrilik", "fesih", "teklif",
  // Söylenti dili — gerçek başlıkların çoğu burada
  "iddia", "gundeminde", "ilgileniyor", "ilgilendigi", "istiyor",
  "rotasinda", "gorusme", "temaslar", "yolcu", "vazgecti"
];

function looksLikeTransfer(text) {
  const folded = fold(text);
  return TRANSFER_MARKERS.some((marker) => folded.includes(marker));
}

function detectStatus(text) {
  const folded = fold(text);
  for (const group of STATUS_PATTERNS) {
    if (group.patterns.some((pattern) => folded.includes(pattern))) {
      return group.status;
    }
  }
  return "";
}

function detectType(text) {
  const folded = fold(text);
  for (const group of TYPE_PATTERNS) {
    if (group.patterns.some((pattern) => folded.includes(pattern))) {
      return group.type;
    }
  }
  return "";
}

/**
 * Metinde geçen Süper Lig kulüplerini bulur.
 *
 * Yön (kimden kime) metinden güvenilir biçimde çıkarılamayabilir; bu yüzden
 * yalnızca BULUNANLAR döner ve yön çıkarımı ayrı yapılır. Uydurma yön
 * yazmaktansa alanı boş bırakmak yeğdir.
 */
function detectClubs(text) {
  const { CLUB_ALIASES, fixtureClubNames } = require("./normalizer.js");
  const folded = fold(text);
  const hits = new Map();

  const record = (canonical, index) => {
    if (index < 0) return;
    const current = hits.get(canonical);
    if (current === undefined || index < current) hits.set(canonical, index);
  };

  for (const name of fixtureClubNames()) {
    const target = fold(name);
    if (target.length >= 4) record(name, folded.indexOf(target));
  }

  // Takma adlar da sayılır ("Cimbom", "Fırtına").
  for (const [alias, canonical] of Object.entries(CLUB_ALIASES)) {
    if (alias.length >= 5) record(canonical, folded.indexOf(alias));
  }

  // SIRA METİNDEKİ SIRADIR. Fikstür listesinin sırası burada anlamsızdır ve
  // ona güvenmek yön çıkarımını ters çevirir: "Kasımpaşa, X'i Beşiktaş'tan
  // kadrosuna kattı" cümlesinde özne metinde önce geçen kulüptür.
  return [...hits.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([canonical]) => canonical);
}

/**
 * "X, Y'yi kadrosuna kattı" / "X ile anlaştı" gibi kalıplardan yön çıkarır.
 * Çıkaramazsa boş döner — çağıran bunu eksik alan olarak işler.
 */
function detectDirection(text, clubs) {
  if (clubs.length < 1) return { fromTeam: "", toTeam: "" };
  const folded = fold(text);

  // Tek kulüp geçiyorsa: "kadrosuna kattı / transfer etti" → hedef o kulüp.
  const inboundMarkers = ["kadrosuna katti", "transfer etti", "kiraladi", "imzalatti", "renklerine bagladi", "bitirdi"];
  const outboundMarkers = ["a transfer oldu", "e transfer oldu", "ya transfer oldu", "yolcu", "ayriliyor", "gonderdi", "sattı", "satti"];

  if (clubs.length === 1) {
    if (inboundMarkers.some((marker) => folded.includes(marker))) {
      return { fromTeam: "", toTeam: clubs[0] };
    }
    if (outboundMarkers.some((marker) => folded.includes(marker))) {
      return { fromTeam: clubs[0], toTeam: "" };
    }
    return { fromTeam: "", toTeam: clubs[0] };
  }

  // İki kulüp: metinde önce geçen genelde özne (alan taraf).
  const first = clubs[0];
  const second = clubs[1];
  if (inboundMarkers.some((marker) => folded.includes(marker))) {
    return { fromTeam: second, toTeam: first };
  }
  return { fromTeam: second, toTeam: first };
}

/**
 * Ücret çıkarımı. BULAMAZSA UYDURMAZ.
 *
 * "Açıklanmadı" ile "bilinmiyor" farklıdır: ilki kaynağın söylediği, ikincisi
 * bizim bilmediğimizdir. Kalıp tutmazsa `null` döner ve alan `unknown` kalır.
 */
function detectFee(text) {
  const raw = String(text || "");

  if (/bonservissiz|bedelsiz|serbest oyuncu/i.test(raw)) {
    return { fee: "Bonservissiz", feeEur: 0 };
  }
  if (/açıklanmad|aciklanmad|gizli tutul/i.test(raw)) {
    return { fee: "Açıklanmadı", feeEur: null };
  }

  const match = /(\d+(?:[.,]\d+)?)\s*milyon\s*(euro|avro|dolar|sterlin|€|\$)/i.exec(raw);
  if (match) {
    const amount = Number(String(match[1]).replace(",", "."));
    const currency = fold(match[2]);
    const isEuro = currency.includes("euro") || currency.includes("avro") || match[2] === "€";
    return {
      fee: `${match[1]} milyon ${match[2]}`,
      feeEur: isEuro && Number.isFinite(amount) ? Math.round(amount * 1_000_000) : null
    };
  }

  return { fee: "", feeEur: null };
}

/**
 * Tek bir belge kaydını transfer adayına çevirir.
 * @returns {Object|null} Transferle ilgili değilse null.
 */
function extractCandidate(entry, source) {
  const title = String((entry && entry.title) || "");
  const summary = String((entry && entry.summary) || "");
  const haystack = `${title} ${summary}`;

  if (!looksLikeTransfer(haystack)) return null;

  // İlgi kapısı Süper Lig'le sınırlı DEĞİL: 1. Lig kulüpleri ve ligden
  // düşmüş kulüpler de haberdir (bkz. normalizer.isTurkishClub).
  const clubs = detectClubs(haystack).map(canonicalClub);
  if (!clubs.some((club) => isTurkishClub(club))) return null;

  const { fromTeam, toTeam } = detectDirection(haystack, clubs);
  const { fee, feeEur } = detectFee(haystack);

  return {
    playerName: canonicalPlayer(extractPlayerName(title, clubs)),
    fromTeam,
    toTeam,
    type: detectType(haystack),
    // TALEP EDİLEN durum. Kaynak katmanı izin vermezse aşağı çekilir.
    requestedStatus: detectStatus(haystack) || "rumor",
    fee,
    feeEur,
    summary: summary || title,
    headline: title,
    sourceId: (source && source.id) || "",
    sourceName: (source && source.label) || "",
    sourceTier: (source && source.tier) || "other_media",
    sourceUrl: String((entry && entry.link) || ""),
    sourcePublishedAt: String((entry && entry.publishedAt) || "")
  };
}

/**
 * Başlıktan oyuncu adını tahmin eder.
 *
 * Kulüp adları ve kalıp sözcükler düşüldükten sonra kalan büyük harfle
 * başlayan sözcük öbeği. Tahmin başarısızsa BOŞ döner — doğrulayıcı oyuncusuz
 * kaydı zaten reddeder, uydurma isim üretmekten iyidir.
 */
function extractPlayerName(title, clubs) {
  let text = String(title || "");

  // Kanonik adlar VE takma adlar birlikte düşülür. Yalnızca kanonik adı
  // silmek, "Cimbom, X transferinde..." başlığında "Cimbom"u oyuncu adının
  // parçası bırakırdı.
  const { CLUB_ALIASES, fixtureClubNames } = require("./normalizer.js");
  const needles = [
    ...clubs,
    ...fixtureClubNames(),
    ...Object.keys(CLUB_ALIASES)
  ].filter((needle) => String(needle || "").length >= 3);

  // Uzun adlar önce silinsin ki kısa parçalar uzununu bozmasın.
  for (const needle of [...new Set(needles)].sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }

  const stopWords = new Set([
    "transfer", "transferi", "transferini", "resmen", "açıkladı", "aciklandi",
    "anlaşma", "anlaşmaya", "vardı", "bonservis", "kiralık", "imza", "imzayı",
    "attı", "sözleşme", "kadrosuna", "kattı", "için", "ile", "son", "dakika",
    "oldu", "yalanladı", "iddia", "iddiası", "görüşmelere", "başladı", "milyon",
    "euro", "avro", "yeni", "eski", "resmi", "açıklama"
  ]);

  const words = text.split(/[\s,;:!?"“”'’()\-–—]+/).filter(Boolean);
  const parts = [];

  for (const word of words) {
    const bare = word.replace(/['’].*$/, "");
    if (!bare) continue;
    if (stopWords.has(bare.toLocaleLowerCase("tr"))) {
      if (parts.length >= 2) break;
      parts.length = 0;
      continue;
    }
    // Unicode kategorileriyle: futbolcu adları Türkçe dışı aksan taşır
    // (Sánchez, Özküçük, Nélson, Đurić). Sabit harf listesi bunları keser ve
    // "Davinson Sánchez" adı "Davinson"a düşerdi.
    const isNameLike = /^\p{Lu}[\p{L}\p{M}'’.-]*$/u.test(bare) && bare.length > 1;
    if (isNameLike) {
      parts.push(bare);
      if (parts.length >= 3) break;
    } else if (parts.length) {
      break;
    }
  }

  return parts.length >= 2 ? parts.join(" ") : (parts[0] || "");
}

/** Bir belgeden tüm adayları çıkarır. */
function extractCandidates(source, body) {
  const entries = parseDocument(source, body);
  const candidates = [];
  for (const entry of entries) {
    const candidate = extractCandidate(entry, source);
    if (candidate) candidates.push(candidate);
  }
  return { entries: entries.length, candidates };
}

module.exports = {
  STATUS_PATTERNS,
  TRANSFER_MARKERS,
  TYPE_PATTERNS,
  detectClubs,
  detectDirection,
  detectFee,
  detectStatus,
  detectType,
  extractCandidate,
  extractCandidates,
  extractPlayerName,
  looksLikeTransfer,
  parseDocument,
  parseFeed,
  parseHtmlLinks,
  parseJsonItems,
  stripMarkup
};
