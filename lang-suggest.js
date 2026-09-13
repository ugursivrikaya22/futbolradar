/**
 * DİL ÖNERİ BANDI — ÖNERİR, YÖNLENDİRMEZ.
 *
 * Yurtdışından gelen ziyaretçi Türkçe bir sayfaya düştüğünde İngilizce
 * sürümün VAR OLDUĞUNU bilmiyor: `/en` bölümü sitenin en görünmez parçası.
 * Bu betik üstte tek satırlık bir öneri gösterir ("View FutbolRadar in
 * English") ve tek tıkla AYNI içeriğin İngilizce karşılığına götürür.
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
 *      açıkça uyardığı tarama sorunlarının başlıca kaynağıdır: bot Türkçe
 *      sayfayı hiç göremeyip yalnızca İngilizce sürümü indeksleyebilirdi.
 *
 *   3. SAYFA KAYMASI (CLS) ÜRETİLMEZ. Bant akışın DIŞINDA (`position: fixed`)
 *      çizilir; altındaki içerik bir piksel bile oynamaz. Yükleme sonrası
 *      araya giren akış-içi bir şerit, Core Web Vitals'ta doğrudan CLS
 *      cezasıdır.
 *
 * HEDEF ADRES UYDURULMAZ. Başlıktaki dil düğmesi (`a[data-lang-switch]`)
 * zaten AYNI içeriğin karşılığını taşıyor — derleme anında `counterpartPath`
 * ile çözülmüş gerçek bir adres. Bant onu okur; karşılığı olmayan sayfada
 * düğme de olmadığı için bant hiç çizilmez.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "futbolradar-lang";
  var COOKIE_KEY = "futbolradar_lang";
  var COOKIE_DAYS = 365;

  /** Tercih iki yerde birden tutulur: localStorage kapalıysa çerez kalır. */
  function readPreference() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) return stored;
    } catch (error) {
      /* Gizli sekmede localStorage erişimi istisna atabilir. */
    }
    var match = document.cookie.match(/(?:^|;\s*)futbolradar_lang=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

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
   * Tarayıcının TERCİH ETTİĞİ diller. `navigator.languages` sıralı bir
   * listedir ve tek bir `navigator.language` değerinden dürüsttür: Türkiye
   * dışında yaşayan çift dilli bir kullanıcının listesinde Türkçe de
   * bulunabilir ve o kişiye İngilizce önerisi çıkarmak gereksizdir.
   */
  function prefersTurkish() {
    var list = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ""];
    for (var i = 0; i < list.length; i += 1) {
      if (/^tr\b/i.test(String(list[i] || ""))) return true;
    }
    return false;
  }

  function switchLink() {
    return document.querySelector("a.lang-switch[data-lang-switch]");
  }

  function dismiss(value) {
    writePreference(value);
    var banner = document.querySelector("[data-lang-suggest]");
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
  }

  function render(targetLocale, href, copy) {
    var banner = document.createElement("div");
    banner.className = "lang-suggest";
    banner.setAttribute("data-lang-suggest", targetLocale);
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", copy.aria);
    banner.lang = targetLocale;

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
      dismiss(targetLocale === "en" ? "tr" : "en");
    });

    var text = document.createElement("span");
    text.className = "lang-suggest-text";
    text.textContent = copy.text;

    banner.appendChild(text);
    banner.appendChild(link);
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  function boot() {
    var current = (document.documentElement.getAttribute("lang") || "tr").slice(0, 2).toLowerCase();
    var target = current === "en" ? "tr" : "en";

    // Kullanıcı daha önce karar verdiyse bir daha sorulmaz — hangi yönde
    // olduğu fark etmez. "Hatırlama" tam olarak budur.
    if (readPreference()) return;

    var turkish = prefersTurkish();
    // Türkçe sayfada Türkçe konuşana, İngilizce sayfada İngilizce konuşana
    // öneri çıkarmak gürültüdür.
    if (current === "tr" && turkish) return;
    if (current === "en" && !turkish) return;

    var anchor = switchLink();
    if (!anchor || anchor.getAttribute("data-lang-switch") !== target) return;

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
