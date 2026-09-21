/**
 * TRANSFER DURUM ROZETİ — BİR KAYIT HANGİ KESİNLİKLE SUNULUR.
 *
 * NEDEN BU DOSYA VAR. Kural eskiden services/transferRadarTicker.js'in
 * içindeydi; o dosya hem ana sayfanın Transfer Radarı bandına hangi kaydın
 * gireceğini seçiyor hem de her kaydın durum rozetini çözüyordu. Bant
 * kaldırıldığında seçim kuralının tamamı gereksizleşti — ama DURUM kuralı
 * gereksizleşmedi: `/api/transfers` her transfer kaydını hâlâ bu eşlemeyle
 * damgalıyor ve transfer izleme ekranı ile takım sayfaları rozeti oradan
 * okuyor. Kural bandın kalıntısı olarak ölü bir dosyada kalmasın diye
 * buraya, kendi adıyla taşındı.
 *
 * UYDURMA YOK. Bu modül veri OKUR, veri YARATMAZ: hiçbir kalıp tutmazsa
 * sonuç "Rumor"dur, "Official" değil. Kesinliği varsayılan yapmak,
 * doğrulanmamış bir kaydı doğrulanmış göstermek olurdu.
 */

// "Resmî" rozeti kaynak gerektirir; kural services/sourceTrust.js.
const { hasOfficialSource } = require("./sourceTrust");

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
 * metinden çıkarılır. Çıkarım BELİRSİZLİK YÖNÜNE düşer.
 */
function transferStatusKey(record) {
  const declared = record && STATUS_KEYS.includes(record.displayStatus)
    ? record.displayStatus
    : inferStatusFromText(record);

  // "RESMÎ" ROZETİ KAYNAK GEREKTİRİR.
  //
  // Durum bir zamanlar yalnızca METİNDEN çıkarılıyordu: kayıtta "resmi",
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

/**
 * Durumu kayda damgala. Kaynak alan adları ve "resmî" koşulu sunucuda
 * kalır; istemciye yalnızca çözülmüş anahtar gider.
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

module.exports = {
  STATUS_KEYS,
  foldText,
  transferStatusKey,
  withDisplayStatus
};
