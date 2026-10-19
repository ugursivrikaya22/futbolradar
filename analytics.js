(function () {
  "use strict";

  var current = document.currentScript;
  if (!current) return;

  var ga4Id = String(current.dataset.ga4Id || "").trim();
  var adsId = String(current.dataset.googleAdsId || "").trim();
  var pageViewLabel = String(current.dataset.pageViewLabel || "").trim();
  var matchClickLabel = String(current.dataset.matchClickLabel || "").trim();
  var ga4Valid = /^G-[A-Z0-9]+$/i.test(ga4Id);
  var adsValid = /^AW-\d+$/i.test(adsId);

  if (!ga4Valid && !adsValid) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") return;
  // Otomasyon (Lighthouse, Playwright, Selenium, başsız tarayıcı) gerçek
  // ziyaretçi sayısını şişirmesin: tarayıcı kendini webdriver olarak bildirirse ölçüm yok.
  if (navigator.webdriver === true) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());

  if (ga4Valid) {
    window.gtag("config", ga4Id, {
      anonymize_ip: true,
      send_page_view: true
    });
  }

  if (adsValid) {
    window.gtag("config", adsId, { send_page_view: false });
    if (pageViewLabel) {
      window.gtag("event", "conversion", {
        send_to: adsId + "/" + pageViewLabel,
        page_location: window.location.href,
        page_title: document.title
      });
    }
  }

  var loader = document.createElement("script");
  loader.async = true;
  loader.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga4Valid ? ga4Id : adsId);
  document.head.appendChild(loader);

  // Reuse GA4; at most one click per destination type per page view.
  // No IDs, query strings, extra collector, storage, polling, or provider calls.
  var discovery = document.querySelector("[data-match-discovery]");
  if (ga4Valid && discovery) {
    var types = ["team", "player", "related_match", "next_match"];
    var dimensions = { locale: document.documentElement.lang === "en" ? "en" : "tr" };
    types.forEach(function (type) {
      dimensions["has_" + type] = discovery.querySelector('[data-discovery-link="' + type + '"]') ? 1 : 0;
    });
    window.gtag("event", "match_navigation_view", dimensions);
    var clicked = {};
    discovery.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("[data-discovery-link]") : null;
      if (!link || !discovery.contains(link)) return;
      var type = link.getAttribute("data-discovery-link");
      if (types.indexOf(type) === -1 || clicked[type]) return;
      clicked[type] = true;
      window.gtag("event", "match_navigation_click", {
        destination_type: type, locale: dimensions.locale, transport_type: "beacon"
      });
    });
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;

    var matchContainer = link.closest("[data-match]");
    if (!matchContainer && !link.hasAttribute("data-match-click")) return;

    var matchId = link.dataset.match || (matchContainer && matchContainer.dataset.match) || "unknown";
    var eventData = {
      match_id: matchId,
      link_url: link.href,
      link_text: String(link.textContent || "").trim().slice(0, 100),
      page_path: window.location.pathname,
      transport_type: "beacon"
    };

    if (ga4Valid) {
      window.gtag("event", "match_click", eventData);
    }

    if (adsValid && matchClickLabel) {
      window.gtag("event", "conversion", Object.assign({}, eventData, {
        send_to: adsId + "/" + matchClickLabel
      }));
    }
  }, { capture: true });
})();
