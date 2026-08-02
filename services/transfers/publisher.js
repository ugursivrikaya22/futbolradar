/**
 * YAYINCI — kaydı okunur yüzeylere çevirir.
 *
 * Kaynağa özgü hiçbir şey bilmez; elinde yalnızca normalleştirilmiş transfer
 * kaydı vardır. Üç çıktı üretir:
 *
 *   1. BAŞLIK + HABER GÖVDESİ (data/news.json biçiminde)
 *   2. BANT ÖĞESİ (data/news-ticker.json biçiminde)
 *   3. TRANSFER KAYDI (data/transfers.json biçiminde, eski alanlarla uyumlu)
 *
 * DİL KURALI — BU DOSYANIN OMURGASI:
 *
 *   "resmen", "resmî açıklama", "kadrosuna kattı" gibi kesinlik ifadeleri
 *   YALNIZCA transferStatus === "official" iken kullanılır. Durum resmî
 *   değilken bu sözcükleri üretecek hiçbir yol yok — şablonlar durumdan
 *   seçiliyor, metni yazan taraf sözcüğü seçemiyor.
 *
 *   Bu, newsTicker.js'in kesinlik-fiili denetimiyle de uyumlu: resmî olmayan
 *   öğeler "reported"/"rumour" güveniyle gider ve o güven seviyesinde
 *   kesinlik fiili taşıyan metin zaten reddedilir.
 */

const { statusBadge, statusLabel } = require("./statusModel.js");
const { confidenceLabel } = require("./confidence.js");
const { transferKey } = require("./deduplicator.js");

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function known(value) {
  const raw = text(value);
  return raw && raw !== "unknown" && raw !== "undisclosed" ? raw : "";
}

/** Türkçe "-e/-a" yönelme eki için kaba ama yeterli sesli uyumu. */
function dative(name) {
  const raw = text(name);
  if (!raw) return "";
  const last = raw.slice(-1).toLocaleLowerCase("tr");
  const backVowels = "aıou";
  const lastVowel = [...raw.toLocaleLowerCase("tr")].reverse().find((ch) => "aeıioöuü".includes(ch)) || "e";
  const suffix = backVowels.includes(lastVowel) ? "a" : "e";
  const buffer = "aeıioöuü".includes(last) ? "y" : "";
  return `${raw}'${buffer}${suffix}`;
}

/**
 * BAŞLIK.
 *
 * Şablon DURUMDAN seçilir. "resmen" yalnızca official dalında geçer.
 */
function buildHeadline(record) {
  const player = text(record.playerName);
  const to = text(record.toTeam);
  const from = text(record.fromTeam);
  const actor = to || from;

  switch (record.transferStatus) {
    case "official":
      return actor
        ? `${actor}, ${player} transferini resmen açıkladı`
        : `${player} transferi resmen açıklandı`;
    case "agreement_reached":
      return actor
        ? `${actor}, ${player} ile anlaşmaya vardı`
        : `${player} transferinde anlaşma sağlandı`;
    case "advanced_talks":
      return actor
        ? `${actor}, ${player} transferinde sona yaklaştı`
        : `${player} transferinde sona yaklaşıldı`;
    case "negotiation":
      return actor
        ? `${actor}, ${player} transferinde görüşmelere başladı`
        : `${player} için görüşmeler başladı`;
    case "denied":
      return actor
        ? `${actor} cephesinden ${player} iddialarına yalanlama`
        : `${player} iddiaları yalanlandı`;
    case "cancelled":
      return actor
        ? `${actor}, ${player} transferinden vazgeçti`
        : `${player} transferi iptal oldu`;
    default:
      return actor
        ? `${actor} gündeminde ${player} iddiası`
        : `${player} transfer iddiası`;
  }
}

/** Kısa özet — 2-3 cümle, atıf dilli. */
function buildSummary(record) {
  const player = text(record.playerName);
  const from = text(record.fromTeam);
  const to = text(record.toTeam);
  const official = record.transferStatus === "official";
  const attribution = official ? "Yapılan resmî açıklamaya göre" : "Basına yansıyan bilgilere göre";

  const route = from && to
    ? `${player}, ${dative(to)} ${from} formasından transfer sürecinde.`
    : to
      ? `${player} için adres olarak ${to} gösteriliyor.`
      : `${player} için ${from} cephesinde ayrılık gündemde.`;

  const statusLine = official
    ? `${to || from}, transferi resmî kanallarından duyurdu.`
    : `Süreç şu an "${statusLabel(record.transferStatus)}" aşamasında ve kulüpler tarafından resmî olarak doğrulanmadı.`;

  return `${attribution} ${route} ${statusLine}`.replace(/\s+/g, " ").trim();
}

/**
 * HABER GÖVDESİ — istenen yapı sırasıyla.
 * Eksik bilgi UYDURULMAZ; alan yoksa cümle de yazılmaz.
 */
function buildArticleBody(record) {
  const paragraphs = [];
  const headings = [];

  const player = text(record.playerName);
  const from = text(record.fromTeam);
  const to = text(record.toTeam);
  const official = record.transferStatus === "official";

  headings.push("");
  paragraphs.push(buildSummary(record));

  headings.push("Transfer durumu");
  paragraphs.push(
    `Bu kayıt FutbolRadar transfer hattında "${statusLabel(record.transferStatus)}" olarak işaretli. ` +
    (official
      ? "Durum resmî bir kaynağa dayanıyor."
      : "Durum resmî bir açıklamaya değil, basına yansıyan bilgilere dayanıyor; kulüpler doğrulamadı.")
  );

  headings.push("Kulüpler");
  paragraphs.push(
    [
      from ? `Ayrıldığı belirtilen kulüp: ${from}.` : "",
      to ? `Adı geçen yeni kulüp: ${to}.` : "",
      known(record.type) ? `Transfer türü: ${record.type}.` : ""
    ].filter(Boolean).join(" ") || "Kulüp bilgisi kaynakta eksik."
  );

  const details = [
    known(record.fee) ? `Bonservis: ${record.fee}.` : "",
    known(record.loanFee) ? `Kiralık bedeli: ${record.loanFee}.` : "",
    known(record.contractUntil) ? `Sözleşme süresi: ${record.contractUntil}.` : "",
    known(record.loanEndDate) ? `Kiralık bitiş: ${record.loanEndDate}.` : "",
    known(record.purchaseOption) ? `Satın alma opsiyonu: ${record.purchaseOption}.` : ""
  ].filter(Boolean);

  headings.push("Sözleşme ve bonservis");
  paragraphs.push(
    details.length
      ? details.join(" ")
      : "Bonservis, sözleşme süresi ve opsiyon başlıklarına dair açıklanmış bir bilgi bulunmuyor. " +
        "Bu alanlar kaynaklarda yer almadığı için boş bırakıldı."
  );

  headings.push("Kaynaklar");
  const sourceNames = (record.sources || []).map((source) => source.name).filter(Boolean);
  paragraphs.push(
    sourceNames.length
      ? `Bilgi ${sourceNames.join(", ")} üzerinden alındı. Birincil kaynak bağlantısı haberin altında listelendi.`
      : "Birincil kaynak bağlantısı haberin altında listelendi."
  );

  if (known(record.position) || Number.isFinite(record.age) || known(record.nationality)) {
    headings.push("Oyuncu künyesi");
    paragraphs.push([
      known(record.nationality) ? `Uyruk: ${record.nationality}.` : "",
      Number.isFinite(record.age) ? `Yaş: ${record.age}.` : "",
      known(record.position) ? `Mevki: ${record.position}.` : ""
    ].filter(Boolean).join(" "));
  }

  // "Bu haber güncellenecek" notu: eksik alan varsa AÇIKÇA söylenir.
  const incomplete = !official || !details.length || !from || !to;
  if (incomplete) {
    headings.push("");
    paragraphs.push(
      `${player} transferine dair ayrıntılar netleştikçe bu haber güncellenecek. ` +
      "Kulüplerden resmî açıklama geldiğinde kayıt yeni bilgilerle yenilenir."
    );
  }

  return { body: paragraphs, bodyHeadings: headings, incomplete };
}

/** data/news.json biçiminde haber kaydı. */
function buildArticle(record, options = {}) {
  const slug = `transfer-${transferKey(record)}`;
  const { body, bodyHeadings, incomplete } = buildArticleBody(record);
  const official = record.transferStatus === "official";

  return {
    id: slug,
    slug,
    category: "Transfer Gündemi",
    title: buildHeadline(record),
    summary: buildSummary(record),
    spot: buildSummary(record),
    body,
    bodyHeadings,
    infoBox: {
      title: "Transfer künyesi",
      rows: [
        { label: "Transfer durumu", value: statusLabel(record.transferStatus) },
        { label: "Oyuncu", value: text(record.playerName) },
        { label: "Eski kulüp", value: known(record.fromTeam) || "Bilinmiyor" },
        { label: "Yeni kulüp", value: known(record.toTeam) || "Bilinmiyor" },
        { label: "Transfer türü", value: known(record.type) || "Bilinmiyor" },
        { label: "Bonservis", value: known(record.fee) || "Bilinmiyor" },
        { label: "Sözleşme", value: known(record.contractUntil) || "Bilinmiyor" },
        { label: "Güven skoru", value: String(record.confidenceScore ?? "-") },
        { label: "Son güncelleme", value: text(record.lastUpdatedAt) }
      ].filter((row) => row.value)
    },
    updateNote: incomplete
      ? "Transfer ayrıntıları netleştiğinde ve kulüplerden resmî açıklama geldiğinde bu haber güncellenecektir."
      : "",
    publishedAt: record.announcedAt || record.ingestedAt,
    team: known(record.toTeam) || known(record.fromTeam) || "",
    url: `https://www.futbolradar.com/haber/${slug}.html`,
    sourceName: "FutbolRadar",
    sources: (record.sources || [])
      .filter((source) => source && source.name && /^https?:\/\//i.test(String(source.url || "")))
      .map((source) => ({ name: source.name, url: source.url })),
    status: "verified",
    isFeatured: official && options.major === true,
    includeInTicker: false,
    tags: [
      known(record.toTeam),
      known(record.fromTeam),
      text(record.playerName),
      "Transfer",
      statusLabel(record.transferStatus)
    ].filter(Boolean)
  };
}

/**
 * BANT ÖĞESİ.
 *
 * Ön ek durumdan gelir: RESMİ yalnızca official'da, SON DAKİKA büyük kulüp
 * + resmî bileşiminde. Kategori de durumdan seçilir; `transfer-rumour`
 * kategorisi `confirmed` güveniyle birlikte kullanılamadığı için resmî
 * kayıtlar `official` kategorisine gider.
 */
function buildTickerItem(record, options = {}) {
  const official = record.transferStatus === "official";
  const player = text(record.playerName);
  const actor = text(record.toTeam) || text(record.fromTeam);
  const score = Number(record.confidenceScore || 0);

  const prefix = official
    ? (options.major ? "SON DAKİKA" : "RESMİ")
    : "TRANSFER";

  let sentence;
  if (official) {
    sentence = actor ? `${actor}, ${player} transferini açıkladı` : `${player} transferi açıklandı`;
  } else if (record.transferStatus === "denied") {
    sentence = actor ? `${actor} cephesinden ${player} iddialarına yalanlama` : `${player} iddiaları yalanlandı`;
  } else if (record.transferStatus === "cancelled") {
    sentence = actor ? `${actor}, ${player} transferinden vazgeçti` : `${player} transferi iptal oldu`;
  } else if (record.transferStatus === "agreement_reached") {
    sentence = actor ? `${actor}, ${player} ile anlaşmaya vardı` : `${player} transferinde anlaşma sağlandı`;
  } else if (record.transferStatus === "advanced_talks") {
    sentence = actor ? `${actor}, ${player} transferinde sona yaklaştı` : `${player} transferinde sona yaklaşıldı`;
  } else if (record.transferStatus === "negotiation") {
    sentence = actor ? `${actor}, ${player} için görüşmelere başladı` : `${player} için görüşmeler başladı`;
  } else {
    sentence = actor ? `${actor} gündeminde ${player} iddiası` : `${player} transfer iddiası`;
  }

  return {
    id: `transfer-${transferKey(record)}`,
    // Resmî kayıt "official", geri kalanı doğası gereği iddia.
    category: official || record.transferStatus === "denied" || record.transferStatus === "cancelled"
      ? "official"
      : "transfer-rumour",
    confidence: confidenceLabel(record.transferStatus, score),
    text: `${prefix} | ${sentence}`,
    team: known(record.toTeam) || known(record.fromTeam) || "",
    timestamp: record.announcedAt || record.ingestedAt,
    source: {
      name: "FutbolRadar",
      url: `https://www.futbolradar.com/haber/transfer-${transferKey(record)}.html`
    }
  };
}

/**
 * data/transfers.json biçimi.
 *
 * Eski alanlar (status/confidence/date) KORUNUYOR: services/transferService.js
 * ve takım sayfaları onları okuyor. Yeni alanlar yanlarına ekleniyor.
 */
function buildTransferRecord(record) {
  const { toLegacyStatus } = require("./statusModel.js");
  const date = String(record.announcedAt || record.ingestedAt || "").slice(0, 10);

  return {
    id: record.id || transferKey(record),
    playerId: record.playerId || "",
    playerName: record.playerName,
    date,
    season: record.season || "",
    fromTeam: record.fromTeam,
    toTeam: record.toTeam,
    league: "Süper Lig",
    position: known(record.position) || "",
    type: known(record.type) || "Bilinmiyor",
    fee: known(record.fee) || "Açıklanmadı",
    feeEur: record.feeEur ?? null,
    // Eski sözlük — takım sayfaları bunu okuyor.
    status: toLegacyStatus(record.transferStatus),
    confidence: record.confidenceScore,
    sourceName: record.sourceName,
    sourceUrl: record.sourceUrl,
    lastVerifiedAt: record.lastUpdatedAt,
    note: record.summary,
    // Yeni sözlük ve künye.
    transferStatus: record.transferStatus,
    transferStatusLabel: statusLabel(record.transferStatus),
    transferStatusBadge: statusBadge(record.transferStatus),
    transferWindow: record.transferWindow,
    nationality: record.nationality,
    age: record.age,
    loanFee: record.loanFee,
    contractUntil: record.contractUntil,
    loanEndDate: record.loanEndDate,
    purchaseOption: record.purchaseOption,
    confidenceScore: record.confidenceScore,
    announcedAt: record.announcedAt,
    ingestedAt: record.ingestedAt,
    ingestionDelaySeconds: record.ingestionDelaySeconds,
    sources: record.sources,
    history: record.history
  };
}

module.exports = {
  buildArticle,
  buildArticleBody,
  buildHeadline,
  buildSummary,
  buildTickerItem,
  buildTransferRecord,
  dative
};
