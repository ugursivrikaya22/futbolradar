const { brainState } = require("../services/brainService");
const {
  enforceRateLimit,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("./_utils");

const SOURCE = "FutbolRadar Kural Beyni";

/**
 * KURAL BEYNİ UCU — kayıt defterinin özeti ve boru hattının ölçülmüş durumu.
 *
 * Bu uç HİÇBİR ŞEY HESAPLAMAZ. `services/brainService.js` ne döndürdüyse onu
 * verir. Sebep tek: aynı sayı yönetim panelinde (ön render), burada (çalışma
 * zamanı) ve testte görünüyor. Uç kendi toplamını yapsaydı üç yüzey zamanla
 * ayrışır ve hangisinin doğru olduğu anlaşılamazdı — panelin "9 rapor" dediği
 * yerde API'nin "11" demesi, ikisine de güveni bitirir.
 *
 * UYDURMA SAYI YOK. `brainState()` ölçemediği her blokta sayı yerine
 * `measured: false` ve Türkçe bir `reason` taşır; bu uç o bloğu olduğu gibi
 * geçirir, boşluğu sıfırla doldurmaz.
 *
 * GİZLİ DEĞER YOK. Yanıtta yalnızca kural kimlikleri, dosya yolları, sayımlar
 * ve kayıt dosyalarının boyut/tarih bilgisi bulunur; ortam değişkeni okunmaz.
 */
module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "analysis-brain");
  // Defter doğrulaması her çağrıda kayıttaki modülleri yüklüyor; bu uç
  // sayfa trafiği değil, denetim trafiği taşır. Sınır bu yüzden dar.
  if (enforceRateLimit(req, res, { limit: 30 })) return;

  let state;
  try {
    state = brainState({});
  } catch (error) {
    // Beyin okunamadıysa boş bir özet döndürmek, "her şey yolunda ama veri
    // yok" gibi görünürdü. Hata gerekçesiyle birlikte açıkça bildiriliyor.
    return sendError(
      res,
      200,
      `Kural beyni durumu okunamadı: ${error.message || "bilinmeyen hata"}`,
      "BRAIN_STATE_UNAVAILABLE",
      SOURCE
    );
  }

  // `generatedAt` ölçümün yapıldığı an; `responseAt` yanıtın üretildiği an.
  // İkisi ayrı durmalı ki önbellekten dönen bir yanıtın verisinin ne kadar
  // eski olduğu okunabilsin.
  return sendSuccess(res, [state], SOURCE, state.generatedAt);
};
