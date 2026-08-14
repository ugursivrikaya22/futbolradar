/**
 * SON İŞLEM ZİNCİRİ — TEK KAYNAK.
 *
 * Sayfa üreticileri ham HTML basar; sayfayı YAYINA HAZIR hâle getiren şey
 * bu zincirdir. Ortak yerleşim, tema önyüklemesi, ölçüm etiketi, site
 * doğrulaması, şema, hreflang ve varlık sürümü — hepsi üretimden SONRA,
 * her sayfaya tek geçişte yazılır.
 *
 * Zincir NEDEN burada duruyor: iki ayrı çalıştırıcı vardı ve ikisi de
 * adımları elle sayıyordu — `package.json`'daki `postprocess` betiği ve
 * `scripts/run-scheduled-update.mjs` içindeki saatlik derleme kuyruğu.
 * Saatlik kuyruk zamanla geride kaldı: `inject-hreflang` ve
 * `inject-asset-version` oraya hiç eklenmedi. Saatlik koşu maç sayfalarını
 * yeniden ürettiği için her koşu, tam derlemenin yazdığı bu iki bloğu
 * sildi ve yerine hiçbir şey koymadı. Sonuç sessizdi ve iki yerden
 * vurdu:
 *
 *   • 306 Türkçe maç sayfası hreflang'sız kaldı. İngilizce eşleri Türkçe
 *     sayfayı gösteriyordu ama karşılık yoktu; Google tek yönlü bildirimi
 *     yok sayar, yani İngilizce maç yüzeyinin tamamı indekslenmeme
 *     riskindeydi.
 *   • ~1.100 sayfa `page.css`/`site.js`/`app.js` adreslerini sürümsüz
 *     verdi. Bu varlıklar `max-age=31536000, immutable` ile sunuluyor:
 *     sürümsüz bir adres, okuyucuyu bir yıl boyunca eski CSS'e kilitler.
 *
 * Bu yüzden zincir artık TEK yerde tanımlı. İki çalıştırıcı da bu listeyi
 * okur; `scripts/test-postprocess-chain.mjs` ikisinin de listeden
 * ayrılmadığını CI'da doğrular. Yeni bir son-işlem adımı eklemek için
 * yalnızca buraya bir satır yazmak yeterli ve YETERLİ OLMAK ZORUNDA.
 *
 * Sıra rastgele değil:
 *   1. `refresh-news-ticker` — bandı sayfaya gömer (gövde değişir).
 *   2. `apply-shared-layout` — ortak başlık/altlık, `<head>`i yeniden yazar.
 *   3-6. Enjektörler — `<head>` içine kendi işaretli bloklarını koyar.
 *   7. `inject-asset-version` EN SONDA: kendinden önceki adımlar sayfaya
 *      yeni varlık başvurusu ekleyebilir, damga hepsini görmek zorunda.
 */

/** Zincir; `scripts/` altına göreli betik adı + argümanlar. */
export const POSTPROCESS_CHAIN = [
  { id: "news-ticker", script: "refresh-news-ticker.mjs", args: ["--apply"], timeoutMinutes: 5 },
  { id: "shared-layout", script: "apply-shared-layout.mjs", args: [], timeoutMinutes: 12 },
  // Tahmin anketi ana sayfaya derleme anında basılır: mobilde ilk ekranda
  // JavaScript beklemeden görünmesi gerekiyor. Takvim saate bağlı olduğu
  // için her derlemede yeniden değerlendirilir (gerekçe: lib/homePoll.mjs).
  { id: "home-poll", script: "inject-home-poll.mjs", args: [], timeoutMinutes: 5 },
  { id: "theme-boot", script: "inject-theme-boot.mjs", args: [], timeoutMinutes: 5 },
  { id: "analytics", script: "inject-ga4.mjs", args: [], timeoutMinutes: 5 },
  { id: "site-verification", script: "inject-site-verification.mjs", args: [], timeoutMinutes: 5 },
  { id: "core-page-schema", script: "inject-core-page-schema.mjs", args: [], timeoutMinutes: 5 },
  { id: "hreflang", script: "inject-hreflang.mjs", args: [], timeoutMinutes: 5 },
  { id: "motm-poll", script: "inject-motm-poll.mjs", args: [], timeoutMinutes: 5 },
  // Meta uzunlukları üreticiler ne yazarsa yazsın son sözü burada bulur;
  // damga adımından ÖNCE koşmalı (içeriği değiştirir).
  { id: "normalize-meta", script: "normalize-meta.mjs", args: [], timeoutMinutes: 5 },
  { id: "asset-version", script: "inject-asset-version.mjs", args: [], timeoutMinutes: 5 }
];

/** `node scripts/<script> <args…>` biçiminde okunabilir komut dizisi. */
export function postprocessCommandLine(step) {
  return ["node", `scripts/${step.script}`, ...step.args].join(" ");
}
