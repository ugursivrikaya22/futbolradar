/**
 * BEŞİKTAŞ TRANSFER GÜNDEMİ — HANGİ KAYIT, HANGİ DURUMLA, HANGİ SIRADA.
 *
 * Bu bant tek bir kulübün transfer gündemini taşır. Dar kapsam onu daha
 * masum değil, DAHA RİSKLİ yapar: okuyucu "Beşiktaş Transfer Gündemi"
 * başlığı altındaki her satırı Beşiktaş'a dair kesin bir gelişme sanmaya
 * yatkındır. Bu yüzden kurallar genel bantla aynı sertlikte.
 *
 * UYDURMA YOK — VE BU BİR SLOGAN DEĞİL, VERİ YOLU.
 *
 * Bant HİÇBİR metni kendisi yazmaz. İki gerçek kaynaktan okur:
 *
 *   1. `data/transfers.json` — gerçekleşmiş oyuncu hareketleri. Kayıtların
 *      kendi `sourceUrl`u, `sourceName`i ve doğrulama damgası var; başlık
 *      YAPISAL alanlardan şablonla kurulur (oyuncu, eski kulüp, yeni kulüp),
 *      serbest metin üretilmez. Özet olarak kaydın kendi `note` alanı
 *      kullanılır; yoksa yine yapısal alanlardan kurulur.
 *   2. `data/besiktas-transfer-ticker.json` — ELLE düzenlenen küratörlü
 *      dosya. Başlık ve özet editör tarafından yazılır, kaynak zorunludur.
 *
 * Örnek/placeholder kayıtlar dosyanın `_sample` anahtarında durur ve bu
 * modül onu HİÇ OKUMAZ. Yer tutucu bir kaydın yanlışlıkla yayına çıkması
 * mümkün olmasın diye ayrım anahtarda, bir bayrakta değil.
 *
 * DURUM ÜÇ KADEMEDİR VE KAYNAKTAN TÜRETİLİR, METİNDEN DEĞİL:
 *
 *   official       — kulübün/federasyonun KENDİ ağzı (bjk.com.tr, tff.org…)
 *   strong-rumour  — saygın yayın organı ya da sicilli muhabir aktardı
 *   rumour         — tanınmayan kaynak; kesinleşmemiş iddia
 *
 * Kademe `services/sourceTrust.js`ten gelir. Bir kaydın "resmî" demesi onu
 * resmî YAPMAZ: `status: "official"` yazan ama arkasında kulüp ağzı olmayan
 * kayıt `strong-rumour`a İNER. Bilgi silinmez, hak etmediği rozeti taşımaz.
 * Bu, transfer radarı bandındaki `AgreementReported` indirmesinin aynısıdır.
 *
 * RAF ÖMRÜ DURUMA GÖRE DEĞİŞİR, ÇÜNKÜ ESKİMENİN ANLAMI DEĞİŞİR:
 *
 *   • Gerçekleşmiş bir transfer eskiyince YANLIŞ OLMAZ, yalnızca "son
 *     dakika" olmaktan çıkar — kendi tarihiyle gösterilir. Sınır bir
 *     transfer penceresi kadardır; geçen sezonun hareketleri bu sezonun
 *     gündemi değildir.
 *   • Doğrulanmamış bir iddia eskidikçe DEĞERSİZLEŞİR: üç hafta önce
 *     ortaya atılıp bir daha doğrulanmayan iddia gündem değil, gürültüdür.
 *     Bu yüzden iddialar hızlı düşer.
 *
 * SIRALAMA GEREKSİNİMDİR: önce resmî açıklamalar, sonra güvenilir basın,
 * sonra iddialar. Aynı kademede en yeni üstte.
 */

const { TRUST_TIER, bestTrustTierOf, hasOfficialSource } = require("./sourceTrust");

/** Bandın kulübü. Tek kulüpli bant; isim tek yerde. */
const CLUB_NAME = "Beşiktaş";

/** Ekranda görünen başlık. */
const BAND_LABEL = "Beşiktaş Transfer Gündemi";

/**
 * Durum anahtarları. Anahtar İngilizce (CSS ve veri sözleşmesi), etiket
 * Türkçe (ekran).
 */
const STATUS = Object.freeze({
  official: { key: "official", label: "Resmî", rank: 0, maxAgeDays: 120 },
  "strong-rumour": { key: "strong-rumour", label: "Güçlü iddia", rank: 1, maxAgeDays: 14 },
  rumour: { key: "rumour", label: "İddia", rank: 2, maxAgeDays: 7 }
});

const STATUS_KEYS = Object.freeze(Object.keys(STATUS));

/** "SON DAKİKA" bir zaman iddiasıdır: 72 saat. */
const BREAKING_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Bant bir liste değil; kayan şeritte okunabilir üst sınır. */
const MAX_ITEMS = 10;

/**
 * KESİNLİK FİİLLERİ. Kesinleşmemiş bir öğenin BAŞLIĞI bunları taşıyamaz.
 *
 * Gerekçe genel bantla aynı (services/newsTicker.js): rozet ekranda
 * küçüktür, cümle büyüktür. Rozet "İddia" derken başlık "imzaladı" diyorsa
 * okuyucu başlığa inanır.
 */
const CONFIRMATION_VERBS = Object.freeze([
  "resmen", "imzaladı", "imzaladi", "duyurdu", "açıkladı", "acikladi",
  "kesinleşti", "kesinlesti", "bitti", "tamam", "anlaşma sağlandı", "anlasma saglandi"
]);

/** Aksan ve büyük harf nötr karşılaştırma (transferRadarTicker ile aynı iş). */
function foldText(value) {
  return String(value === undefined || value === null ? "" : value)
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .trim();
}

const CLUB_KEY = foldText(CLUB_NAME);

function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

/** Zaman damgası. Okunamayan tarih 0'dır — "yeni" değil, "bilinmiyor". */
function stampOf(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Kayıt Beşiktaş'ı ilgilendiriyor mu? */
function mentionsClub(...values) {
  return values.some((value) => foldText(value).includes(CLUB_KEY));
}

/**
 * DURUMU KAYNAK BELİRLER.
 *
 * Beyan edilen durum yalnızca bir TALEPTİR; kaynak kademesi onu doğrular ya
 * da indirir. Yükseltme YOK: kaynak resmî diye editörün "iddia" dediği kayıt
 * "resmî"ye çıkarılmaz — editör bir şeyi bilerek geri çekmiş olabilir.
 */
function resolveStatus(record) {
  const declared = STATUS_KEYS.includes(text(record && record.status)) ? text(record.status) : null;

  // KAYNAĞIN TAŞIYABİLECEĞİ EN YÜKSEK DURUM.
  //
  // Beyan bir TALEPTİR, kanıt değil. Tavan kaynaktan gelir ve beyan tavanı
  // AŞAMAZ: kulüp ağzı yoksa "resmî" olunmaz, tanınmayan bir site
  // "güvenilir basın" kademesine çıkamaz.
  //
  // İndirmenin NEREYE düştüğü de kaynağa bağlı. Hak edilmemiş bir "resmî"
  // iddiasını sabit biçimde "güçlü iddia"ya indirmek, tanınmayan bir sitenin
  // iddiasını saygın basının kademesine TERFİ ETTİRİRDİ — indirme
  // görünümünde bir yükseltme. Tavan bu yüzden tek yerde hesaplanıyor.
  const ceiling = hasOfficialSource(record) ? "official" : tierCeiling(bestTrustTierOf(record));

  // Beyan yoksa tavan doğrudan sonuçtur.
  if (!declared) return ceiling;

  // Beyan tavandan düşükse beyana uyulur: YÜKSELTME YOK. Editör bir şeyi
  // bilerek geri çekmiş olabilir (kulüp sitesinden alıntılanan ama henüz
  // kesinleşmemiş bir gelişme gibi) ve o kararı ezmek editörün elindeki tek
  // frene el koymak olurdu.
  return STATUS[declared].rank >= STATUS[ceiling].rank ? declared : ceiling;
}

/** Kaynak kademesinin taşıyabileceği en yüksek durum. */
function tierCeiling(tier) {
  if (tier === TRUST_TIER.OFFICIAL) return "official";
  if (tier === TRUST_TIER.HIGH || tier === TRUST_TIER.REPORTER) return "strong-rumour";
  return "rumour";
}

/** Kesinleşmemiş öğenin başlığı kesinlik fiili taşıyor mu? */
function hasConfirmationVerb(headline) {
  const folded = foldText(headline);
  return CONFIRMATION_VERBS.some((verb) => folded.includes(foldText(verb)));
}

/**
 * TRANSFER KAYITLARINDAN ÖĞE.
 *
 * Başlık YAPISAL alanlardan kurulur ve ok imi kullanır (`Arsenal → Beşiktaş`).
 * Türkçe ek uydurmak (`Arsenal'dan`, `Bayern Münih'ten`) kulüp adına göre
 * değişen bir çekim işidir ve yanlış ek okuyucuya özensiz bir metin olarak
 * döner; ok imi hem dilden bağımsız hem de bandın diğer şeridiyle tutarlı.
 */
function fromTransferRecord(record) {
  const playerName = text(record && (record.playerName || record.name));
  const fromTeam = text(record && (record.fromTeam || record.oldTeam));
  const toTeam = text(record && (record.toTeam || record.newTeam));

  // Tarafı eksik kayıt banda girmez: boşluğu doldurmak bilgi üretmektir.
  if (!playerName || !fromTeam || !toTeam) return null;
  if (!mentionsClub(fromTeam, toTeam)) return null;

  const sourceUrl = text(record.sourceUrl || record.url || (record.source && record.source.url));
  const sourceName = text(record.sourceName || (record.source && record.source.name));
  if (!sourceName && !sourceUrl) return null;

  const movement = mentionsClub(toTeam) ? "geliş" : "gidiş";
  // Özet: kaydın KENDİ notu varsa o kullanılır (editoryal, doğrulanmış).
  // Yoksa yalnızca yapısal alanlar özetlenir — yorum eklenmez.
  const details = [record.type, record.fee, record.position].map(text).filter(Boolean);
  const summary = text(record.note) ||
    `${fromTeam} → ${toTeam}${details.length ? ` · ${details.join(" · ")}` : ""}`;

  return {
    id: text(record.id) || `transfer-${foldText(playerName)}-${foldText(toTeam)}`,
    headline: `${playerName}: ${fromTeam} → ${toTeam}`,
    summary,
    sourceName: sourceName || sourceUrl,
    url: sourceUrl,
    // TARİH, HAREKETİN TARİHİDİR — BİZİM DOĞRULAMA DAMGAMIZ DEĞİL.
    //
    // `lastVerifiedAt` "bu kaydı en son ne zaman kontrol ettik" demektir ve
    // eski kayıtlar da düzenli olarak yeniden doğrulanır. Onu haber tarihi
    // saymak, geçen sezonun transferini bu haftanın gündemi gibi gösterir:
    // Gedson Fernandes'in 2025-07-31 tarihli ayrılığı, 2026-07-25 damgasıyla
    // banda "25 Tem" diye giriyordu. Sıralama ve raf ömrü artık `date`e bakar.
    publishedAt: text(record.date || record.publishedAt || record.lastVerifiedAt),
    status: resolveStatus({
      status: text(record.status) === "confirmed" ? "official" : text(record.status),
      sourceUrl,
      sources: record.sources
    }),
    movement,
    origin: "transfers"
  };
}

/**
 * KÜRATÖRLÜ KAYITTAN ÖĞE. Başlık ve özet editörün; doğrulama bizim.
 */
function fromCuratedRecord(record) {
  const headline = text(record && record.headline);
  const sourceName = text(record && record.source && record.source.name);
  const url = text(record && record.source && record.source.url);

  if (!headline || !sourceName) return null;
  if (!mentionsClub(headline, record.summary, record.team, record.player)) return null;

  return {
    id: text(record.id) || `curated-${foldText(headline).slice(0, 40)}`,
    headline,
    summary: text(record.summary),
    sourceName,
    url,
    publishedAt: text(record.publishedAt || record.timestamp),
    status: resolveStatus({ status: text(record.status), sourceUrl: url, sources: record.sources }),
    movement: text(record.movement),
    origin: "curated"
  };
}

/**
 * ÖĞE DOĞRULAMASI. Geçersiz öğe elenir ve NEDENİ döner — sessiz eleme,
 * hata ayıklanamaz eleme demek.
 */
function validateItem(item) {
  const errors = [];
  if (!item) return { valid: false, errors: ["kayıt okunamadı"] };
  if (!item.headline) errors.push("headline zorunlu");
  if (!item.sourceName) errors.push("source.name zorunlu");
  if (!STATUS_KEYS.includes(item.status)) errors.push(`status geçersiz: ${item.status}`);
  if (!stampOf(item.publishedAt)) errors.push("publishedAt okunabilir bir tarih olmalı");
  if (item.url && !/^https?:\/\//i.test(item.url)) errors.push("source.url http(s) olmalı");
  // Kesinleşmemiş öğe kesinlik fiili taşıyamaz.
  if (item.status !== "official" && hasConfirmationVerb(item.headline)) {
    errors.push("kesinleşmemiş öğenin başlığında kesinlik ifadesi var");
  }
  return { valid: errors.length === 0, errors };
}

/** Raf ömrü duruma göre. Süresi dolan öğe düşer. */
function withinShelfLife(item, nowMs) {
  const stamp = stampOf(item.publishedAt);
  if (!stamp) return false;
  const maxAgeMs = STATUS[item.status].maxAgeDays * 24 * 60 * 60 * 1000;
  return (nowMs - stamp) <= maxAgeMs;
}

function asList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}

/**
 * BANDIN ÖĞELERİ.
 *
 * `now` çağırandan gelir: derleme derleme anını, test sabit bir anı geçirir.
 * Böylece raf ömrü ve "son dakika" penceresi saate bağlı olmadan sınanır.
 *
 * `exclude` çağıranın ELEDİĞİ başlıklardır. Genel haber bandı aynı sayfada
 * aynı transferi zaten taşıyorsa okuyucu iki şeritte aynı cümleyi okur ve
 * arama motoru sayfada yinelenen metin görür; çağıran o başlıkları buraya
 * verip ikinci kopyayı engeller.
 */
function selectBesiktasTransferItems(sources = {}, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_ITEMS;
  const excluded = new Set((Array.isArray(options.exclude) ? options.exclude : []).map(foldText).filter(Boolean));

  const candidates = [
    ...asList(sources.transfers, "transfers").map(fromTransferRecord),
    ...asList(sources.curated, "items").map(fromCuratedRecord)
  ];

  const items = [];
  const rejected = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate) continue;

    const verdict = validateItem(candidate);
    if (!verdict.valid) {
      rejected.push({ id: candidate.id || "(kimliksiz)", errors: verdict.errors });
      continue;
    }
    if (!withinShelfLife(candidate, nowMs)) {
      rejected.push({ id: candidate.id, errors: [`raf ömrü doldu (${candidate.status})`] });
      continue;
    }

    const key = foldText(candidate.headline);
    if (seen.has(key)) {
      rejected.push({ id: candidate.id, errors: ["aynı başlık zaten bantta"] });
      continue;
    }
    // Genel bantta görünen başlık burada tekrarlanmaz.
    if ([...excluded].some((entry) => entry.includes(key) || key.includes(entry))) {
      rejected.push({ id: candidate.id, errors: ["başlık genel bantta zaten var"] });
      continue;
    }
    seen.add(key);

    const stamp = stampOf(candidate.publishedAt);
    items.push({
      ...candidate,
      statusLabel: STATUS[candidate.status].label,
      isBreaking: (nowMs - stamp) <= BREAKING_WINDOW_MS,
      dateLabel: new Intl.DateTimeFormat("tr-TR", {
        day: "numeric", month: "short", timeZone: "Europe/Istanbul"
      }).format(new Date(stamp)),
      stamp
    });
  }

  // GEREKSİNİM SIRASI: önce resmî, sonra güvenilir basın, sonra iddia.
  // Aynı kademede en yeni üstte.
  items.sort((left, right) =>
    STATUS[left.status].rank - STATUS[right.status].rank ||
    right.stamp - left.stamp ||
    left.headline.localeCompare(right.headline, "tr"));

  return { items: items.slice(0, limit), rejected };
}

/** Elenen öğeleri görünür kılar. */
function logRejected(rejected) {
  for (const row of Array.isArray(rejected) ? rejected : []) {
    console.warn(`[futbolradar:besiktas-ticker-rejected] id=${row.id} reasons="${row.errors.join("; ")}"`);
  }
}

module.exports = {
  BAND_LABEL,
  BREAKING_WINDOW_MS,
  CLUB_NAME,
  CONFIRMATION_VERBS,
  MAX_ITEMS,
  STATUS,
  STATUS_KEYS,
  foldText,
  fromCuratedRecord,
  fromTransferRecord,
  hasConfirmationVerb,
  logRejected,
  resolveStatus,
  selectBesiktasTransferItems,
  validateItem
};
