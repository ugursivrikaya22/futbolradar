/**
 * OYUNCU KARTI GÖRÜNÜM MODELİ — tek yetkili kaynak.
 *
 * Arama sonucu, oyuncu radarı ve /api/players?view=card aynı nesneyi
 * tüketir. Kart üç yerde ayrı ayrı kurulsaydı, biri gevşediğinde diğerleri
 * fark etmez ve aynı oyuncu iki yüzeyde farklı şeyler iddia ederdi.
 *
 * KURAL: BOŞ ALAN UYDURULMAZ.
 *
 * Her alan iki durumdan birindedir:
 *   • gerçek bir değer taşır, ya da
 *   • `awaiting: true` ile işaretlenir ve arayüz "Veri bekleniyor" yazar.
 *
 * Tire, sıfır ya da "bilinmiyor" gibi bir yer tutucu YAZILMAZ: "0 gol"
 * ölçülmemiş bir kayıtta "oynadı ve atamadı" diye okunur, yani ölçülmemiş
 * bir iddiayı ölçülmüş gibi gösterir. Alanın yokluğunu açıkça söylemek
 * doğru olandır.
 *
 * Hangi alanın yayımlanabileceğine bu dosya karar VERMEZ; kararı
 * services/cardCredibility.js verir (publicPlayerView). Burada yalnızca o
 * kararın sonucu bir karta çevrilir. Böylece kadro senkronu bir gün gerçek
 * istatistik göndermeye başladığında kart kendiliğinden dolar — burada
 * değiştirilecek bir şey yoktur.
 */

const { publicPlayerView } = require("./cardCredibility.js");
const { formatMarketValueEur } = require("./playerService.js");

/** Arayüzün eksik alan için basacağı tek ifade. */
const AWAITING_LABEL = "Veri bekleniyor";

const CONFIDENCE_LABELS = {
  high: "Yüksek güven",
  medium: "Orta güven",
  low: "Sınırlı güven",
  none: "Doğrulanmadı"
};

function textOrNull(value) {
  const text = String(value === null || value === undefined ? "" : value).trim();
  return text === "" ? null : text;
}

/**
 * Sayısal alanı okur.
 *
 * `Number(null)` ve `Number("")` SIFIR döndürür. Bu, yayın kapısının
 * gizlediği bir alanı "ölçüldü ve sıfır çıktı" diye göstermeye yeter:
 * gizlenmiş gol sayısı kartta "0 gol" olarak belirir ve okuyucu bunu
 * "oynadı, atamadı" diye okur. Bu yüzden boşluk Number()'a hiç
 * ulaştırılmadan elenir.
 */
function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Tek bir kart alanı.
 * @param {string} label okuyucuya gösterilecek etiket
 * @param {*} value yayımlanabilir değer; yoksa null
 */
function field(label, value) {
  const resolved = typeof value === "number" ? value : textOrNull(value);
  const missing = resolved === null || resolved === undefined;

  return {
    label,
    value: missing ? null : resolved,
    awaiting: missing,
    // Arayüzün karar vermesi gerekmesin diye gösterilecek metin burada
    // çözülür: üç yüzey de aynı ifadeyi basar.
    display: missing ? AWAITING_LABEL : String(resolved)
  };
}

/**
 * Kartın "dolu" sayılması için gereken çekirdek yuvalar. Güven seviyesi
 * bunların kaçının GERÇEKTEN ölçülmüş olduğundan türetilir — sabit bir
 * etiket değil, kaydın kendi durumunun özeti.
 */
function coreSlots(fields) {
  return [
    fields.team,
    fields.position,
    fields.age,
    fields.marketValue,
    fields.rating,
    fields.goals
  ];
}

/**
 * Güven seviyesi ölçülür, atanmaz.
 *
 * Kaynak doğrulanmamışsa kart hiçbir sayı taşımaz ve seviye "none" olur.
 * Doğrulanmış bir kayıtta seviye, çekirdek yuvaların kaçının dolduğuna
 * bakar: sağlayıcı bugün yalnızca kimlik/kadro alanı gönderiyor, ölçüm
 * göndermeye başladığında aynı kart yükselir.
 */
function confidenceOf(verified, fields, reasons) {
  if (!verified) {
    return { level: "none", label: CONFIDENCE_LABELS.none, filled: 0, total: coreSlots(fields).length, reasons };
  }

  const slots = coreSlots(fields);
  const filled = slots.filter((slot) => slot && !slot.awaiting).length;
  const level = filled >= 5 ? "high" : filled >= 3 ? "medium" : "low";

  return { level, label: CONFIDENCE_LABELS[level], filled, total: slots.length, reasons };
}

/** Yalnızca yayımlanabilir alanlardan okur. */
function readable(published, ...keys) {
  for (const key of keys) {
    const value = published[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return null;
}

/**
 * Bir oyuncu kaydını kart görünüm modeline çevirir.
 *
 * @param {object} player ham oyuncu kaydı
 * @param {object} [options] cardCredibility'ye geçirilir (ör. { now, trend })
 * @returns {object} kart görünüm modeli
 */
function buildPlayerCard(player, options = {}) {
  const view = publicPlayerView(player, options);
  const published = view.fields;

  const marketValueEur = finiteOrNull(published.marketValueEur);
  const marketValue = textOrNull(published.marketValue)
    || (marketValueEur === null ? null : formatMarketValueEur(marketValueEur));

  const fields = {
    team: field("Takım", readable(published, "currentTeam", "team")),
    position: field("Mevki", readable(published, "position")),
    age: field("Yaş", finiteOrNull(readable(published, "computedAge", "age"))),
    marketValue: field("Piyasa değeri", marketValue),
    rating: field("Rating", finiteOrNull(readable(published, "overallRating", "aiRating", "rating"))),
    goals: field("Gol", finiteOrNull(published.goals)),
    assists: field("Asist", finiteOrNull(published.assists)),
    appearances: field("Maç", finiteOrNull(readable(published, "appearances"))),
    minutes: field("Dakika", finiteOrNull(readable(published, "minutesPlayed", "minutes"))),
    nationality: field("Uyruk", textOrNull(published.nationality))
  };

  const id = textOrNull(published.id) || textOrNull(player && player.id);

  return {
    id,
    name: textOrNull(published.name) || textOrNull(player && player.name),
    href: id ? `oyuncular/${id}.html` : null,
    // Fotoğraf yayın kapısından geçmişse taşınır; geçmemişse alan hiç
    // gönderilmez ve arayüz baş harf rozetine düşer.
    photo: textOrNull(published.photo),
    verified: view.verified,
    fields,
    confidence: confidenceOf(view.verified, fields, view.reasons),
    // Hangi alanların KASITLI gizlendiği taşınır: arayüz "ölçülmedi" ile
    // "hata" arasını ayırabilsin.
    awaiting: Object.entries(fields).filter(([, slot]) => slot.awaiting).map(([key]) => key),
    withheld: view.restricted,
    source: {
      name: textOrNull(view.meta && view.meta.source_name),
      url: textOrNull(view.meta && view.meta.source_url),
      verifiedAt: textOrNull(view.meta && view.meta.last_verified_at)
    }
  };
}

/**
 * Kartın taşıdığı yuvaların DEĞİŞMEZ sırası.
 *
 * Hem sunucu hem istemci bu listeyi bilir. Arama dizini yalnızca ölçülmüş
 * değerleri yazar; listede olup dizinde bulunmayan her yuva "bekleniyor"
 * demektir. Böylece eksik alan adları 612 kayıt boyunca tekrar tekrar
 * taşınmaz — yokluk zaten bilginin kendisidir.
 */
const CARD_SLOTS = [
  "team", "position", "age", "marketValue", "rating",
  "goals", "assists", "appearances", "minutes", "nationality"
];

/**
 * Arama sonucu için sıkıştırılmış kart.
 *
 * Dizin her ziyaretçiye bir kez indiriliyor, bu yüzden biçim dar tutuldu:
 * yalnızca ölçülmüş değerler yazılır, türetilebilen hiçbir şey tekrar
 * edilmez (etiketler istemcide sabit, eksik yuvalar yokluktan okunur,
 * doğrulama tarihi gün hassasiyetinde yeter).
 *
 * Kural aynı kalır: burada yazılan her değer yayın kapısından geçmiştir.
 * İstemci kendi kuralını yeniden hesaplamaz.
 */
function buildSearchCard(player, options = {}) {
  const card = buildPlayerCard(player, options);
  const values = {};

  for (const key of CARD_SLOTS) {
    const slot = card.fields[key];
    if (slot && !slot.awaiting) values[key] = slot.value;
  }

  return {
    verified: card.verified,
    confidence: card.confidence.level,
    photo: card.photo,
    values,
    source: card.source.name,
    verifiedOn: (card.source.verifiedAt || "").slice(0, 10) || null
  };
}

module.exports = {
  AWAITING_LABEL,
  CONFIDENCE_LABELS,
  CARD_SLOTS,
  buildPlayerCard,
  buildSearchCard
};
