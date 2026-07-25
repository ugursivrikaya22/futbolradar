/**
 * PAYLAŞILAN SAYFA İSKELETİ
 * ----------------------------------------------------------------------------
 * Neden bu dosya var: başlık ve alt bilgi işaretlemesi 6 ayrı üretici script
 * ile 61 kök HTML dosyasında ayrı ayrı kopyalanmıştı. Aynı menüyü değiştirmek
 * için 67 yerde düzenleme gerekiyordu ve sürümler birbirinden ayrışmıştı
 * (kimi sayfada "Radar Sinyalleri", kiminde "Maç Merkezi" düğmesi vardı).
 * Artık tek kaynak burasıdır; `scripts/apply-shared-layout.mjs` bu çıktıyı
 * derleme sırasında tüm sayfalara yazar.
 *
 * `base` her sayfanın köke göre önekidir: kökte "./", alt klasörde "../".
 */

export const NAV_PRIMARY = [
  { href: "bugunun-maclari.html", label: "Bugünün Maçları" },
  { href: "canli-skor.html", label: "Canlı Skor" },
  { href: "super-lig-fikstur.html", label: "Süper Lig" },
  { href: "analizler.html", label: "Analizler" },
  { href: "takimlar.html", label: "Takımlar" },
  { href: "puan-durumu.html", label: "Puan Durumu" }
];

/** Mobil çekmecede ve alt bilgide görünen ikincil bağlantılar. */
export const NAV_SECONDARY = [
  { href: "oyuncu-radari.html", label: "Oyuncu Radarı" },
  { href: "istatistik-merkezi.html", label: "İstatistik Merkezi" },
  { href: "transfer-radari.html", label: "Transfer Radarı" },
  { href: "momentum.html", label: "Momentum" },
  { href: "gol-kralligi.html", label: "Gol Krallığı" },
  { href: "haberler.html", label: "Haberler" }
];

const FOOTER_LEGAL = [
  { href: "hakkinda.html", label: "Hakkında" },
  { href: "iletisim.html", label: "İletişim" },
  { href: "veri-notu.html", label: "Veri Notu" },
  { href: "gizlilik.html", label: "Gizlilik" },
  { href: "kullanim-sartlari.html", label: "Kullanım Şartları" }
];

const ICONS = {
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 3h3.1l-6.8 7.8L21.8 21h-6.2l-4.9-6.4L5.1 21H2l7.3-8.3L2.4 3h6.3l4.4 5.8ZM16.4 19.2h1.7L7.7 4.7H5.9Z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none"/></svg>',
  youtube:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="4.5"/><path d="M10.4 9.3 15 12l-4.6 2.7Z" fill="currentColor" stroke="none"/></svg>',
  rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 18.5h.01"/><path d="M5 12a7 7 0 0 1 7 7"/><path d="M5 6a13 13 0 0 1 13 13"/></svg>'
};

const SOCIAL = [
  { href: "https://x.com/futbolradar", label: "X (Twitter)", icon: ICONS.x },
  { href: "https://www.instagram.com/futbolradar", label: "Instagram", icon: ICONS.instagram },
  { href: "https://www.youtube.com/@futbolradar", label: "YouTube", icon: ICONS.youtube }
];

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeBase(base) {
  const value = String(base || "./");
  return value.endsWith("/") ? value : `${value}/`;
}

function linkList(items, base, className) {
  return items
    .map((item) => `<a href="${base}${item.href}">${escapeHtml(item.label)}</a>`)
    .join("");
}

/**
 * Yapışkan üst çubuk. Sınıf adları (`nav`, `nav-menu`, `nav-toggle`,
 * `nav-links`, `brand`, `cta`) bilinçli olarak korunur: `site.js` içindeki
 * mobil menü mantığı ve mevcut sayfa-işaretleme kodu bu adlara bağlı.
 * Görsel yenileme `topbar-premium` sınıfı üzerinden yapılır, böylece eski
 * kurallar bozulmadan üzerine yazılır.
 */
export function siteHeader(options = {}) {
  const base = normalizeBase(options.base);
  const primary = linkList(NAV_PRIMARY, base);
  const secondary = linkList(NAV_SECONDARY, base);

  return `<header class="topbar topbar-premium" data-shared-layout="header">
      <div class="topbar-inner">
        <nav class="container-wide nav" aria-label="Ana menü">
          <a class="brand" href="${base}index.html" aria-label="FutbolRadar ana sayfa">
            <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 12 17 8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg></span>
            <span class="brand-text"><b>Futbol</b>Radar</span>
          </a>
          <button class="nav-search-toggle" type="button" aria-label="Arama kutusunu aç" aria-controls="primary-menu">${ICONS.search}</button>
          <button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button>
          <div class="nav-menu" id="primary-menu">
            <div class="nav-links">${primary}</div>
            <div class="nav-links nav-links-secondary">${secondary}</div>
            <a class="cta" href="${base}mac-merkezi.html">Maç Merkezi</a>
          </div>
          <form class="site-search" role="search" method="get" action="${base}oyuncu-radari.html" data-search-base="${base}" autocomplete="off">
            <span class="site-search-icon" aria-hidden="true">${ICONS.search}</span>
            <input class="site-search-input" type="search" name="search" placeholder="Takım, oyuncu ara" aria-label="Sitede ara" aria-expanded="false" aria-controls="site-search-results" role="combobox" />
            <button class="site-search-clear" type="button" aria-label="Aramayı temizle" hidden>×</button>
            <div class="site-search-panel" id="site-search-results" role="listbox" hidden></div>
          </form>
        </nav>
      </div>
    </header>`;
}

/**
 * Üst çubuğun altındaki kayan son dakika bandı. Sonsuz döngü için içerik iki
 * kez basılır ve şerit %50 kaydırılır; bu sayede JavaScript olmadan da (CSS
 * animasyonu) kesintisiz akar. `:hover`/`:focus-within` durumunda durur.
 * Öğeler gerçek bağlantıdır - dekoratif değil, tıklanabilir.
 */
export function newsTicker(options = {}) {
  const base = normalizeBase(options.base);
  const items = Array.isArray(options.items) ? options.items.filter(Boolean) : [];

  if (!items.length) {
    return "";
  }

  const renderItem = (item) => {
    const href = item.href ? item.href : `${base}haberler.html`;
    const external = /^https?:/i.test(href);
    const rel = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    const label = item.label ? `<span class="news-ticker-tag">${escapeHtml(item.label)}</span>` : "";
    return `<a class="news-ticker-item" href="${escapeHtml(href)}"${rel}>${label}<span>${escapeHtml(item.text)}</span></a>`;
  };

  const track = items.map(renderItem).join('<span class="news-ticker-sep" aria-hidden="true"></span>');

  return `<div class="news-ticker" data-shared-layout="ticker" aria-label="Son dakika futbol gündemi">
      <div class="container-wide news-ticker-inner">
        <span class="news-ticker-badge"><i class="live-pulse" aria-hidden="true"></i>Son Dakika</span>
        <div class="news-ticker-viewport">
          <div class="news-ticker-track">
            <div class="news-ticker-group">${track}</div>
            <div class="news-ticker-group" aria-hidden="true">${track}</div>
          </div>
        </div>
        <a class="news-ticker-all" href="${base}haberler.html">Tümü</a>
      </div>
    </div>`;
}

/** Kurumsal alt bilgi: hakkında metni, gezinme sütunları, sosyal ikonlar. */
export function siteFooter(options = {}) {
  const base = normalizeBase(options.base);
  const year = options.year || new Date().getFullYear();

  const social = SOCIAL.map(
    (item) =>
      `<a href="${escapeHtml(item.href)}" aria-label="${escapeHtml(item.label)}" target="_blank" rel="noopener noreferrer">${item.icon}</a>`
  ).join("");

  return `<footer class="footer footer-premium" data-shared-layout="footer">
      <div class="container-wide footer-grid">
        <div class="footer-brand">
          <a class="brand" href="${base}index.html" aria-label="FutbolRadar ana sayfa">
            <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 12 17 8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg></span>
            <span class="brand-text"><b>Futbol</b>Radar</span>
          </a>
          <p>Süper Lig ve Avrupa kupalarında canlı skor, maç programı, puan durumu, oyuncu istatistikleri ve doğrulanmış transfer hareketleri. Veriler resmî kaynaklardan derlenir, üretilmez.</p>
          <div class="footer-social" aria-label="Sosyal medya">${social}</div>
        </div>
        <div class="footer-col">
          <h2>Maç</h2>
          <div class="footer-col-links">${linkList(NAV_PRIMARY, base)}</div>
        </div>
        <div class="footer-col">
          <h2>Veri</h2>
          <div class="footer-col-links">${linkList(NAV_SECONDARY, base)}</div>
        </div>
        <div class="footer-col">
          <h2>Kurumsal</h2>
          <div class="footer-col-links">${linkList(FOOTER_LEGAL, base)}</div>
        </div>
      </div>
      <div class="container-wide footer-bottom">
        <span>© ${escapeHtml(year)} FutbolRadar · Canlı skor ve futbol istatistikleri</span>
        <span class="footer-links"><a href="${base}veri-notu.html">Veri Notu</a><a href="${base}iletisim.html">İletişim</a></span>
      </div>
    </footer>`;
}

export { escapeHtml as escapeLayoutHtml, normalizeBase };
