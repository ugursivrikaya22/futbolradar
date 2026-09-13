/**
 * DİL ÖNERİ BANDI — ÖNERİR, YÖNLENDİRMEZ.
 *
 * Yurtdışından gelen ziyaretçi Türkçe bir sayfaya düştüğünde İngilizce
 * sürümün VAR OLDUĞUNU bilmiyor: `/en` bölümü sitenin en görünmez parçası.
 * Bu betik üstte tek satırlık bir öneri gösterir ("View FutbolRadar in
 * English") ve tek tıkla AYNI içeriğin İngilizce karşılığına götürür.
 *
 * KARARI BU BETİK VERMEZ. "Bant çıkacak mı" sorusu `<head>` içindeki senkron
 * snippet'te, İLK BOYAMADAN ÖNCE cevaplanıyor ve `<html data-lang-suggest>`
 * olarak işaretleniyor (bkz. scripts/lib/langSuggestBoot.mjs). Buradaki iş
 * yalnızca işaretlenmiş sayfaya bandı ÇİZMEK.
 *
 * Neden bölünmüş: bant üstte, başlık çubuğu ise normal akışta. Kararı geç
 * verip bandı akışın dışında çizmek başlığın üzerine biniyor ve mobilde
 * hamburger düğmesini tıklanamaz yapıyordu; akışa sokmak ise sayfayı
 * kaydırıyordu. Karar erken verilince CSS yeri önceden ayırıyor — ne
 * bindirme kalıyor ne kayma.
 *
 * ÜÇ ŞEY BİLEREK YAPILMIYOR:
 *
 *   1. ZORUNLU YÖNLENDİRME YOK. Ne IP'ye ne tarayıcı diline göre otomatik
 *      `location` değişikliği var. Kullanıcı Türkçe siteye bilerek gelmiş
 *      olabilir; onu istemediği bir dile atmak, geri düğmesiyle savaşan bir
 *      sayfa üretir. Öneri gösterilir, karar kullanıcıya bırakılır.
 *
 *   2. ARAMA MOTORU BOTLARI HİÇBİR ŞEKİLDE ETKİLENMEZ. Bant tamamen istemci
 *      tarafı ve HİÇ yönlendirme yapmadığı için Googlebot bir sayfayı hangi
 *      dilde isterse o dilde görür. Otomatik dil yönlendirmesi, Google'ın
 *      açıkça uyardığı tarama sorunlarının başlıca kaynağıdır.
 *
 *   3. SAYFA KAYMASI (CLS) ÜRETİLMEZ — yukarıdaki gerekçeyle.
 *
 * HEDEF ADRES UYDURULMAZ. Başlıktaki dil düğmesi (`a[data-lang-switch]`)
 * zaten AYNI içeriğin karşılığını taşıyor — derleme anında `counterpartPath`
 * ile çözülmüş gerçek bir adres. Bant onu okur.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "futbolradar-lang";
  var COOKIE_KEY = "futbolradar_lang";
  var COOKIE_DAYS = 365;

  /** Tercih iki yerde birden tutulur: localStorage kapalıysa çerez kalır. */
  function writePreference(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      /* Çerez yedeği aşağıda. */
    }
    var expires = new Date(Date.now() + COOKIE_DAYS * 86400000).toUTCString();
    document.cookie =
      COOKIE_KEY + "=" + encodeURIComponent(value) + ";path=/;expires=" + expires + ";SameSite=Lax";
  }

  /**
   * Kullanıcı karar verince ayrılan yer de geri alınır: işaret kalkar, CSS
   * gövdedeki üst boşluğu bırakır. Bu kayma KULLANICI EYLEMİYLE oluyor,
   * yani ölçülen CLS'e girmez ve beklenen davranıştır.
   */
  function settle(value) {
    writePreference(value);
    document.documentElement.removeAttribute("data-lang-suggest");
    var banner = document.querySelector("[data-lang-suggest-banner]");
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
  }

  function render(targetLocale, href, copy) {
    var banner = document.createElement("div");
    banner.className = "lang-suggest";
    banner.setAttribute("data-lang-suggest-banner", targetLocale);
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", copy.aria);
    banner.lang = targetLocale;

    var text = document.createElement("span");
    text.className = "lang-suggest-text";
    text.textContent = copy.text;

    var link = document.createElement("a");
    link.className = "lang-suggest-cta";
    link.href = href;
    link.hreflang = targetLocale === "en" ? "en" : "tr-TR";
    link.lang = targetLocale;
    link.textContent = copy.cta;
    // Tıklama TERCİHTİR: bir daha sorulmaz.
    link.addEventListener("click", function () {
      writePreference(targetLocale);
    });

    var close = document.createElement("button");
    close.type = "button";
    close.className = "lang-suggest-close";
    close.setAttribute("aria-label", copy.close);
    close.textContent = "×";
    // Kapatmak da TERCİHTİR: kullanıcı mevcut dilde kalmayı seçti.
    close.addEventListener("click", function () {
      settle(targetLocale === "en" ? "tr" : "en");
    });

    banner.appendChild(text);
    banner.appendChild(link);
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  function boot() {
    var target = document.documentElement.getAttribute("data-lang-suggest");
    if (target !== "en" && target !== "tr") return;

    var anchor = document.querySelector("a.lang-switch[data-lang-switch]");
    // Karşılığı olmayan sayfada gidilecek yer yok. Snippet böyle sayfalara
    // hiç gömülmüyor; yine de işaret bir şekilde oradaysa ayrılan yeri geri
    // vermek, boş bir şerit bırakmaktan doğrudur.
    if (!anchor || anchor.getAttribute("data-lang-switch") !== target) {
      document.documentElement.removeAttribute("data-lang-suggest");
      return;
    }

    var copy = target === "en"
      ? {
          text: "FutbolRadar is also available in English.",
          cta: "View FutbolRadar in English",
          aria: "Language suggestion",
          close: "Dismiss and stay in Turkish"
        }
      : {
          text: "FutbolRadar Türkçe olarak da yayında.",
          cta: "FutbolRadar'ı Türkçe görüntüle",
          aria: "Dil önerisi",
          close: "Kapat ve İngilizce kal"
        };

    render(target, anchor.getAttribute("href"), copy);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
