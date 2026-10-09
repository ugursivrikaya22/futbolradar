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

  document.addEventListener("click", function (event) {
    var link = event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    // İlgili kartlar kendi tek olayını gönderiyor (site.js related_card_click);
    // maç sayfası `data-match` taşıdığı için burada ikinci olay doğmasın.
    if (link.hasAttribute("data-related-card")) return;

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
