/**
 * TRANSFER RADARI BANDI — HANGİ KAYIT, HANGİ SIRADA, HANGİ DURUMLA.
 *
 * NEDEN BU DOSYA VAR. Bandın seçim kuralı ÜÇ yerde ayrı ayrı yazılmıştı:
 * istemcide (app.js `TransferRadarTicker`), İngilizce üreticide
 * (scripts/generate-en-pages.mjs) ve hiçbir yerde — çünkü Türkçe ana sayfa
 * bandı hiç ön derlemiyordu.
 *
 * Bunun canlıda görünür bir sonucu vardı: Türkçe ana sayfanın HTML'i banda
 * "Transfer güncellemeleri hazırlanıyor." yer tutucusuyla çıkıyor, ama aynı
 * sayfanın alt tarafındaki Transfer Takibi bölümü dolu transfer satırları
 * gösteriyordu. Aynı sayfa aynı anda hem "veri yok" hem "veri var" diyordu.
 * JavaScript yüklenene kadar okuyucunun ve Googlebot'un gördüğü hâl buydu.
 *
 * Kural artık burada. Ön derleme bandı derleme sırasında doldurur; istemci
 * canlı veriyle üstüne yazar. İkisi de aynı sıralamayı ve aynı durum
 * eşlemesini kullandığı için JavaScript yüklendiğinde bant yerinden
 * oynamaz.
 *
 * UYDURMA YOK. Bu modül veri OKUR, veri YARATMAZ:
 *
 *   • Oyuncu adı, gittiği ve geldiği takım eksikse kayıt banda GİRMEZ.
 *     Eksik tarafı "bilinmiyor" diye doldurmak bilgi üretmek olurdu.
 *   • Tarihi okunamayan kayıt "SON DAKİKA" SAYILMAZ. Bilinmeyen tarih,
 *     kaydın yeni olduğuna dair bir kanıt değildir.
 *   • Bant boşsa boş kalır; yer doldurmak için eski kayıt öne çekilmez.
 *
 * "SON DAKİKA" BİR ZAMAN İDDİASIDIR. Bant yalnızca son üç günün doğrulanmış
 * hareketlerini gösterir. Daha eski kayıt ana transfer veri tabanında kalır,
 * fakat güncel akışa geri sokulmaz.
 */

// "Resmî" rozeti kaynak gerektirir; kural services/sourceTrust.js.
const { hasOfficialSource } = require("./sourceTrust");

/** Üç gün. Bu pencerenin dışındaki kayıt güncel bantta gösterilmez. */
const BREAKING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 21 gün — scripts/lib/tickerFeed.mjs TRANSFER_MAX_AGE_HOURS ile AYNI
 * editoryal pencere (transferler bir maç sonucundan daha uzun ömürlü
 * sayılır). `selectRecentTickerRecords` bunu SON DAKİKA (3 gün) penceresi
 * boşken kullanır — bant sakin bir haftada tamamen boş kalmasın diye.
 */
const RECENT_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

/** Bantta en fazla kaç kayıt? Kayan bir şerit liste değildir. */
const MAX_ITEMS = 12;

/**
 * Türk kullanıcı için ilgi sırası. Aynı gün açıklanmış iki transferden
 * Süper Lig kulübünü ilgilendiren önce gelir.
 */
const PRIORITY_CLUBS = Object.freeze([
  "galatasaray", "fenerbahce", "besiktas", "trabzonspor",
  "basaksehir", "eyupspor", "samsunspor", "goztepe"
]);

/**
 * Durum anahtarları. Sınıf adı İngilizce, ekrandaki metin çağırana ait.
 *
 * `AgreementReported` çıkarımla ATANMAZ, yalnızca resmî kaynağı olmayan bir
 * "Resmî" iddiasının indirildiği yerdir: kaynak kulüp değilse anlaşma
 * "duyuruldu" değil "aktarıldı"dır.
 */
const STATUS_KEYS = Object.freeze(["Official", "AgreementReported", "Rumor", "Talks", "Loan"]);

/** app.js `normalizeSearchText` ile aynı iş: aksan ve büyük harf nötr. */
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

/**
 * DURUM. Kayıt açıkça bir durum bildiriyorsa o kullanılır; bildirmiyorsa
 * metinden çıkarılır. Çıkarım BELİRSİZLİK YÖNÜNE düşer: hiçbir kalıp
 * tutmazsa sonuç "Rumor"dur, "Official" değil. Kesinliği varsayılan yapmak,
 * doğrulanmamış bir kaydı doğrulanmış göstermek olurdu.
 */
function transferStatusKey(record) {
  const declared = record && STATUS_KEYS.includes(record.displayStatus)
    ? record.displayStatus
    : inferStatusFromText(record);

  // "RESMÎ" ROZETİ KAYNAK GEREKTİRİR.
  //
  // Durum şimdiye kadar yalnızca METİNDEN çıkarılıyordu: kayıtta "resmi",
  // "kesin", "signed" gibi bir kelime geçiyorsa transfer "Resmî" sayılıyordu.
  // Kaynağın kim olduğuna hiç bakılmıyordu ve depoda sonucu görülüyordu:
  // "Resmî" gösterilen 20 transferin beşinin arkasında kulüp değil bir haber
  // kuruluşu vardı (TRT Spor, Anadolu Ajansı, Sporx). Hepsi saygın yayın
  // organı — ama bir gazetenin "imzalandı" yazması, kulübün imzayı
  // duyurması değildir. Rozet okuyucuya kulübün konuştuğunu söyler.
  //
  // Resmî ağız yoksa iddia "Anlaşma iddiası"na iner: bilgi SİLİNMEZ,
  // yalnızca hak etmediği kesinlik rozetini taşımaz.
  if (declared === "Official" && !hasOfficialSource(record)) return "AgreementReported";
  return declared;
}

function inferStatusFromText(record) {
  const raw = foldText([
    record && record.type,
    record && record.status,
    record && record.stage
  ].filter(Boolean).join(" "));
  if (/kiralik|loan/.test(raw)) return "Loan";
  if (/talk|negotiat|gorus|temas/.test(raw)) return "Talks";
  if (/rumou?r|iddia|reported|linked/.test(raw)) return "Rumor";
  if (/confirm|official|complete|signed|resmi|kesin/.test(raw)) return "Official";
  return "Rumor";
}

function clubRank(record) {
  const sides = [record && record.toTeam, record && record.fromTeam]
    .filter(Boolean)
    .map(foldText);
  for (let index = 0; index < PRIORITY_CLUBS.length; index += 1) {
    if (sides.includes(PRIORITY_CLUBS[index])) return index;
  }
  return PRIORITY_CLUBS.length;
}

/** Kaydın zaman damgası. Okunamayan tarih 0'dır — "yeni" değil, "bilinmiyor". */
function stampOf(record) {
  const value = record && (record.date || record.publishedAt || record.lastVerifiedAt || record.updatedAt);
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Ham `transfers.json` yükünü listeye çevirir. */
function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.transfers)) return payload.transfers;
  return [];
}

/**
 * BANDA GİRECEK KAYITLAR.
 *
 * `now` çağırandan gelir: ön derleme derleme anını, istemci sayfa açılış
 * anını verir. Testler sabit bir an geçirerek "son dakika" penceresini
 * saate bağlı olmadan doğrular.
 */
function selectTickerRecords(payload, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_ITEMS;
  const locale = options.locale === "en" ? "en-GB" : "tr-TR";

  return asList(payload)
    .map((record) => {
      const playerName = String((record && (record.playerName || record.name)) || "").trim();
      const toTeam = String((record && (record.toTeam || record.newTeam)) || "").trim();
      const fromTeam = String((record && (record.fromTeam || record.oldTeam)) || "").trim();
      // Tarafı eksik kayıt banda girmez: boşluğu doldurmak bilgi üretmektir.
      if (!playerName || !toTeam || !fromTeam) return null;

      const stamp = stampOf(record);
      const age = nowMs - stamp;
      if (stamp <= 0 || age < 0 || age > BREAKING_WINDOW_MS) return null;

      return {
        playerName,
        toTeam,
        fromTeam,
        isBreaking: true,
        dateLabel: stamp > 0
          ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Europe/Istanbul" })
            .format(new Date(stamp))
          : "",
        statusKey: transferStatusKey(record),
        url: (record && (record.url || record.sourceUrl || (record.source && record.source.url))) || "",
        stamp,
        clubRank: clubRank(record)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.stamp - left.stamp ||
      left.clubRank - right.clubRank ||
      left.playerName.localeCompare(right.playerName, "tr"))
    .slice(0, limit);
}

/**
 * Durumu kayda damgala. Kaynak alan adları ve "resmî" koşulu sunucuda
 * kalır; istemciye yalnızca çözülmüş anahtar gider ve bant yeniden
 * çizildiğinde ön derlenmiş rozetten farklı bir şey göstermez.
 *
 * Kayıt değiştirilmez, kopyalanır.
 */
function withDisplayStatus(records) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => {
    if (!record || typeof record !== "object") return record;
    return { ...record, displayStatus: transferStatusKey(record) };
  });
}

/**
 * BANT BOŞ KALMASIN — SON DAKİKA (3 GÜN) YOKSA DAHA GENİŞ, DOĞRULANMIŞ
 * PENCEREDEN GÖSTERİLİR.
 *
 * `selectTickerRecords` kasıtlı dar tutuldu ve öyle kalıyor — "SON DAKİKA"
 * rozetini kullanan her yer (üçüncü bant dahil) hâlâ ondan geçer. Ama
 * transfer sezonunda sakin günler her zaman olur; bant o günlerde
 * tamamen boş kalırsa üçüncü bant fiilen hiç var olmamış gibi görünür.
 *
 * Bu yüzden SON DAKİKA boşsa RECENT_WINDOW_MS (21 gün) penceresine
 * düşülür — ama yalnızca `status: "confirmed"` kayıtlar oraya girer.
 * Söylenti/görüşme (Rumor/Talks) bu geniş pencereden ASLA gösterilmez:
 * "SON DAKİKA" rozeti olmadan tarihli görünen bir iddia, okuyucuya
 * "eski ama doğru" der — oysa doğrulanmamış bir iddia hiçbir zaman öyle
 * sunulamaz. Sonuç `isBreaking: false` taşır; şablon (transferTicker.mjs)
 * bunu tarih etiketiyle çizer, "SON DAKİKA" rozetiyle değil.
 */
function selectRecentTickerRecords(payload, options = {}) {
  const breaking = selectTickerRecords(payload, options);
  if (breaking.length) return breaking;

  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_ITEMS;
  const locale = options.locale === "en" ? "en-GB" : "tr-TR";
  // Biçimlendirici döngü başına değil, çağrı başına bir kez kurulur.
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });

  return asList(payload)
    .filter((record) => record && record.status === "confirmed")
    .map((record) => {
      const playerName = String((record.playerName || record.name) || "").trim();
      const toTeam = String((record.toTeam || record.newTeam) || "").trim();
      const fromTeam = String((record.fromTeam || record.oldTeam) || "").trim();
      // Tarafı eksik kayıt banda girmez: boşluğu doldurmak bilgi üretmektir.
      if (!playerName || !toTeam || !fromTeam) return null;

      const stamp = stampOf(record);
      const age = nowMs - stamp;
      if (stamp <= 0 || age < 0 || age > RECENT_WINDOW_MS) return null;

      return {
        playerName,
        toTeam,
        fromTeam,
        isBreaking: false,
        dateLabel: dateFormatter.format(new Date(stamp)),
        statusKey: transferStatusKey(record),
        url: (record.url || record.sourceUrl || (record.source && record.source.url)) || "",
        stamp,
        clubRank: clubRank(record)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.stamp - left.stamp ||
      left.clubRank - right.clubRank ||
      left.playerName.localeCompare(right.playerName, "tr"))
    .slice(0, limit);
}

module.exports = {
  BREAKING_WINDOW_MS,
  RECENT_WINDOW_MS,
  withDisplayStatus,
  MAX_ITEMS,
  PRIORITY_CLUBS,
  STATUS_KEYS,
  asList,
  clubRank,
  foldText,
  selectRecentTickerRecords,
  selectTickerRecords,
  stampOf,
  transferStatusKey
};
