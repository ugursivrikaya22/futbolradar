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
  // Canlı puan durumu çekirdeğinin tarayıcı kopyası, kaynağından yeniden
  // üretilir. EN BAŞTA: varlık damgası (`inject-asset-version`) bu dosyayı
  // da damgalıyor, yani içerik damgadan önce kesinleşmiş olmalı.
  { id: "live-standings-core", script: "build-live-standings-client.mjs", args: [], timeoutMinutes: 2 },
  // Maç merkezi çekirdeğinin tarayıcı kopyası ve maç sayfasının hafif haber
  // dizini. İkisi de kaynağından üretiliyor ve varlık damgasından ÖNCE
  // kesinleşmek zorunda (bkz. build-match-hub-client.mjs).
  { id: "match-hub-core", script: "build-match-hub-client.mjs", args: [], timeoutMinutes: 2 },
  { id: "match-news-index", script: "build-match-news-index.mjs", args: [], timeoutMinutes: 2 },
  // Resolve English links after match registries and Turkish pages exist.
  // Scheduled postprocessing must refresh these links as well as full builds.
  { id: "en-team-pages", script: "generate-en-team-pages.mjs", args: [], timeoutMinutes: 5 },
  { id: "en-pages", script: "generate-en-pages.mjs", args: [], timeoutMinutes: 5 },
  { id: "match-focus-pages", script: "generate-match-focus.mjs", args: [], timeoutMinutes: 5 },
  // Anketin kendi paylaşılabilir sayfaları (`/anket/<slug>`, `/en/poll/<slug>`).
  // ORTAK YERLEŞİMDEN ÖNCE: sayfa yeni doğuyor ve başlık/altlık, favicon,
  // tema, ölçüm, hreflang ve varlık damgası adımlarının hepsini görmek
  // zorunda. Ayrıca takvime bağlı: anket kapanınca sayfanın durumu ve site
  // haritası kaydı saatlik koşuda kendiliğinden güncelleniyor.
  { id: "poll-pages", script: "generate-poll-pages.mjs", args: [], timeoutMinutes: 4 },
  { id: "search-index", script: "generate-search-index.mjs", args: [], timeoutMinutes: 4 },
  { id: "news-ticker", script: "refresh-news-ticker.mjs", args: ["--apply"], timeoutMinutes: 5 },
  { id: "shared-layout", script: "apply-shared-layout.mjs", args: [], timeoutMinutes: 12 },
  // Maç dosyası tanıtım kutusu da saate bağlı: penceresi kapanınca kutu
  // kendiliğinden düşsün diye her derlemede yeniden değerlendirilir.
  { id: "match-special", script: "inject-match-special.mjs", args: [], timeoutMinutes: 5 },
  { id: "match-focus-ticker", script: "inject-match-focus-ticker.mjs", args: [], timeoutMinutes: 5 },
  // Ana sayfa maç vitrini. Saate bağlı: kutu maçtan 48 saat önce açılır ve
  // GERÇEK bitiş düdüğünden 2 saat sonra kendiliğinden düşer, bu yüzden her
  // koşuda yeniden değerlendirilmek ZORUNDA. Maç sayfasına dokunmaz;
  // yalnızca ana sayfadaki geçici öne çıkarmayı ve takım/lig sayfasındaki
  // iç bağlantı şeridini yazar. `match-special`den SONRA: ikisi de hero'nun
  // ardına yazıyor ve vitrin en üstte kalmalı.
  { id: "featured-match-spotlight", script: "generate-featured-match-spotlight.mjs", args: [], timeoutMinutes: 5 },
  // Favicon bildirimi kök-mutlak ve tek biçimli olmalı: 16 üretici kendi
  // göreli satırını basıyor, bu adım onları söküp tek bloğu koyuyor.
  { id: "favicon", script: "inject-favicon.mjs", args: [], timeoutMinutes: 8 },
  // Service worker kaydı + "ana ekrana ekle" bandı + favori takım/push
  // widget'ı: tek betik (`pwa.js`), tüm sayfalarda. VAPID genel anahtarı
  // burada `<meta>` olarak gömülür — bu yüzden asset-version'dan ÖNCE
  // çalışmalı ki damga adımı yeni eklenen `<script>` etiketini de görsün
  // pwa.js içerik damgası alır; bu yüzden önce sayfaya bağlanmalıdır.
  { id: "pwa", script: "inject-pwa.mjs", args: [], timeoutMinutes: 8 },
  { id: "theme-boot", script: "inject-theme-boot.mjs", args: [], timeoutMinutes: 5 },
  // Kulüp armaları tek bir dış kaynaktan geliyor ve sayfada 240'ı aşıyor;
  // bağlantı önden ısıtılmazsa ilk arma DNS + TLS el sıkışmasını bekliyor.
  { id: "preconnect", script: "inject-preconnect.mjs", args: [], timeoutMinutes: 8 },
  { id: "analytics", script: "inject-ga4.mjs", args: [], timeoutMinutes: 5 },
  { id: "site-verification", script: "inject-site-verification.mjs", args: [], timeoutMinutes: 5 },
  { id: "core-page-schema", script: "inject-core-page-schema.mjs", args: [], timeoutMinutes: 5 },
  { id: "hreflang", script: "inject-hreflang.mjs", args: [], timeoutMinutes: 5 },
  // Aynı maçın kopya adresleri (tur sayfası, maç raporu, kök dizindeki eski
  // `-mac-analizi` deseni) tek kanonik `/mac/<slug>` adresine bağlanır.
  // Zincirde olmak ZORUNDA: hedef sayfayı `generate-match-seo-pages.mjs`
  // üretiyor ve kopyaları basan iki üretici de ondan ÖNCE koşuyor — kendi
  // kanoniğini yazarken hedefin var olup olmadığını bilemiyorlar. Burada
  // disk gerçeği bellidir. `inject-hreflang`den SONRA: hreflang bildirimleri
  // bu geçişin dışında tutuluyor, önce yazılmış olmaları gerekiyor.
  { id: "match-canonicals", script: "unify-match-canonicals.mjs", args: [], timeoutMinutes: 8 },
  // Ana sayfa anketi: canlı skor kahramanının hemen ardına, vitrin kartları
  // maç/transfer bölümlerinin arasına, sabit kutu altlığın ardına.
  // `shared-layout`ten SONRA koşar (blok gövdeye yazılıyor, `<head>`e değil)
  // ve damga adımından ÖNCE.
  { id: "home-poll", script: "inject-home-poll.mjs", args: [], timeoutMinutes: 5 },
  { id: "motm-poll", script: "inject-motm-poll.mjs", args: [], timeoutMinutes: 5 },
  // Meta uzunlukları üreticiler ne yazarsa yazsın son sözü burada bulur;
  // damga adımından ÖNCE koşmalı (içeriği değiştirir).
  { id: "normalize-meta", script: "normalize-meta.mjs", args: [], timeoutMinutes: 5 },
  // Demetler app.js'ten TÜRETİLİR; app.js değiştiyse önce yeniden üretilmeli,
  // sonra sayfalara bağlanmalı. İkisi de damga adımından ÖNCE: damga
  // sayfadaki adresi okuyup sürümlüyor, adres önce doğru olmalı.
  { id: "app-bundles", script: "build-app-bundles.mjs", args: [], timeoutMinutes: 5 },
  { id: "app-bundle-link", script: "inject-app-bundle.mjs", args: [], timeoutMinutes: 8 },
  { id: "asset-version", script: "inject-asset-version.mjs", args: [], timeoutMinutes: 5 }
];

/** `node scripts/<script> <args…>` biçiminde okunabilir komut dizisi. */
export function postprocessCommandLine(step) {
  return ["node", `scripts/${step.script}`, ...step.args].join(" ");
}
