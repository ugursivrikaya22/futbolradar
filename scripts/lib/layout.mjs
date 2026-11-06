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
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Dış bağlantı politikası tek yerde: services/sourceLinks.js.
const { PLAIN_EXTERNAL_REL, SOURCE_LINK_REL, isExternalUrl } = require("../../services/sourceLinks.js");
// Sözlük, rota eşlemesi ve dil yardımcıları tek yerde: services/i18n.js.
const { NAV_KEYS, normalizeLocale, t } = require("../../services/i18n.js");

/**
 * Menü listeleri artık sözlükten TÜRETİLİYOR.
 *
 * Etiketler burada sabit yazılıydı; İngilizce sürüm için ikinci bir kopya
 * çıkarmak, aynı menünün iki yerde ayrışması demekti. Türkçe çıktı birebir
 * aynı kalıyor — `locales/tr.json` içindeki karşılıklar eski sabit metinlerle
 * aynı dizgeler.
 */
/**
 * KOŞULLU MENÜ HEDEFİ (`preferredHref`). Henüz üretilmemiş olabilecek bir
 * sayfa (ör. SEO botunun `transfer-radar.html`'i) derleme anında diskte
 * varsa ona, yoksa her zaman yayında olan `href`'e bağlanılır; `href` de
 * yoksa öğe hiç çizilmez. Kırık bağlantı denetimi bu yüzden hep geçer.
 */
function navTargetExists(href) {
  const clean = String(href || "").replace(/[?#].*$/, "");
  if (!clean) return false;
  return fs.existsSync(path.join(process.cwd(), clean)) ||
    fs.existsSync(path.join(process.cwd(), "public", clean));
}

export function resolveNavHref(item, exists = navTargetExists) {
  if (item.preferredHref && exists(item.preferredHref)) return item.preferredHref;
  return item.href || null;
}

function navList(locale, group) {
  const resolved = NAV_KEYS[normalizeLocale(locale)] || NAV_KEYS.tr;
  return (resolved[group] || []).map((item) => ({ ...item, href: resolveNavHref(item) }))
    .filter((item) => item.href)
    .map((item) => ({
    href: item.href,
    label: t(item.key, locale),
    // Hedef sayfa yalnızca Türkçe var: bağlantı bunu okuyucuya SÖYLER
    // (etiketinde "(TR)", işaretlemede `hreflang="tr"`). Gerekçe
    // services/i18n.js içindeki NAV_KEYS.en yorumunda.
    trOnly: Boolean(item.trOnly),
    key: item.key
  }));
}

export const NAV_PRIMARY = navList("tr", "primary");

/** Mobil çekmecede ve alt bilgide görünen ikincil bağlantılar. */
export const NAV_SECONDARY = navList("tr", "secondary");

/**
 * Kurumsal bağlantılar yalnızca Türkçede var.
 *
 * Bu sayfaların (hakkında, gizlilik, kullanım şartları) İngilizce karşılığı
 * henüz üretilmiyor. İngilizce alt bilgide Türkçe hukuk metinlerine bağlantı
 * vermek, "İngilizce sayfada Türkçe içerik gösterme" kuralını ihlal ederdi;
 * bu yüzden İngilizce alt bilgide bu sütun hiç çizilmiyor.
 */
const FOOTER_LEGAL = [
  { href: "hakkinda.html", key: "footer.about" },
  { href: "iletisim.html", key: "footer.contact" },
  { href: "veri-notu.html", key: "footer.dataNote" },
  { href: "gizlilik.html", key: "footer.privacy" },
  { href: "kullanim-sartlari.html", key: "footer.terms" }
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

/**
 * ANKETLER MENÜSÜNDEKİ "YENİ" RÖZETİ — yayından itibaren yalnızca 7 gün.
 *
 * Tarih burada SABİT yazılır (özellik 2026-08-15'te yayınlandı) ve rözet
 * işaretlemede HER derleme için basılır; ne zaman kaybolacağı istemcide
 * (`site.js#hideExpiredNavBadges`) karşılaştırılır. Böylece derleme
 * gecikse/duraklasa bile (bu oturumda olduğu gibi) rözet süresi geçmiş bir
 * tarihte asılı kalmaz — geçerliliği tarayıcıda, gerçek saatle denetlenir.
 */
const NAV_NEW_BADGE_UNTIL = "2026-08-22T21:00:00+03:00";
const NAV_NEW_BADGE_KEY = "nav.polls";

/**
 * "Transfer Radar" ve "İstatistik" üst menüye girince 1366-1920 px tek satırlık
 * masaüstü çubuğu 11 bağlantıyı taşıyamıyor (önceki 9 bağlantı bile 0-3 px
 * payla sığıyordu; 1440 px'te ölçülen taşma 11 bağlantıyla ~130 px).
 * Yalnızca "Arşiv" geniş masaüstü satırında gösterilmez; dar ekran
 * çekmecesinde ve alt bilgide aynen durur. "Köşe Yazıları" masaüstü satırına
 * geri döndü: yer, maç merkezi grubu ve bağlantılar sıkıştırılarak açıldı
 * (bkz. page.css → "NAV KOMPAKT").
 */
const DESKTOP_DRAWER_KEYS = new Set(["nav.archive"]);

function linkList(items, base, locale, options = {}) {
  // Rözet yalnızca ÜST menüde gösterilir (`showBadges: true` ile açıkça
  // istenmedikçe): alt bilgi bağlantı listesi gezinme değil kaynakça, aynı
  // rözeti orada da basmak "menü öğesi" iddiasını orada tekrarlamış olurdu.
  const showBadges = Boolean(options.showBadges);
  return items
    .map((item) => {
      // Türkçe-only hedef: dil işareti hem makineye (`hreflang`) hem
      // okuyucuya ("(TR)") verilir. Sessizce başka dile götürmek, bağlantıyı
      // hiç vermemekten daha kötü olurdu.
      const attributes = item.trOnly ? ' hreflang="tr" lang="tr"' : "";
      const suffix = item.trOnly ? " (TR)" : "";
      const badge = showBadges && item.key === NAV_NEW_BADGE_KEY
        ? ` <span class="nav-badge" data-nav-badge-until="${NAV_NEW_BADGE_UNTIL}">${escapeHtml(t("nav.newBadge", locale))}</span>`
        : "";
      // Geniş masaüstü satırına sığmayan öğe (bkz. page.css → DESKTOP_DRAWER)
      // yalnızca üst menüde işaretlenir; çekmece ve alt bilgide görünür kalır.
      const drawerOnly = options.showBadges && DESKTOP_DRAWER_KEYS.has(item.key) ? " data-nav-drawer-only" : "";
      return `<a href="${base}${item.href}"${attributes}${drawerOnly}>${escapeHtml(item.label)}${suffix}${badge}</a>`;
    })
    .join("");
}

/**
 * Yapışkan üst çubuk. Sınıf adları (`nav`, `nav-menu`, `nav-toggle`,
 * `nav-links`, `brand`, `cta`) bilinçli olarak korunur: `site.js` içindeki
 * mobil menü mantığı ve mevcut sayfa-işaretleme kodu bu adlara bağlı.
 * Görsel yenileme `topbar-premium` sınıfı üzerinden yapılır, böylece eski
 * kurallar bozulmadan üzerine yazılır.
 */
/**
 * DİL KUTUSU — GERÇEK BİR BAĞLANTI, DÜĞME DEĞİL.
 *
 * `<a href>` seçilmesi bilinçli. JavaScript ile dil değiştiren bir düğme
 * arama motoru için görünmez olurdu; bu bağlantı ise iki dilli sürümü
 * taranabilir kılar ve `hreflang` çiftini gövde içinde de destekler.
 * Aynı sebeple klavye erişimi ve orta tıkla yeni sekmede açma bedava gelir.
 *
 * Kutu `.nav-menu` içinde DEĞİL, doğrudan `.nav` altında duruyor: menü
 * mobilde katlanıyor ve kutu orada kalsaydı hamburgerin içinde kaybolurdu.
 * Kullanıcı dil değiştirmek için menü açmak zorunda kalmamalı.
 *
 * `altHref` köke göre karşı sayfanın yolu; `base` ile birleştirilir.
 */
function languageSwitch(base, locale, altHref) {
  const current = normalizeLocale(locale);
  const target = current === "en" ? "tr" : "en";
  const fallback = target === "en" ? "en/index.html" : "index.html";
  const href = `${base}${String(altHref || fallback).replace(/^\.?\//, "")}`;
  // GÖRÜNEN ETİKET HEDEF DİLİ GÖSTERİR, ERİŞİLEBİLİR AD SAYFANIN DİLİNDEDİR.
  //
  // Görünen "TR"/"ENG" bir dil KODUDUR: hedefi işaret eder ve hangi dili
  // okursa okusun herkes tanır. `aria-label` ise ekran okuyucusunun SESLİ
  // OKUDUĞU cümledir ve sayfanın diliyle seslendirilir — İngilizce sayfada
  // Türkçe bir cümle ("Türkçeye geç") İngilizce sentezleyiciden anlaşılmaz
  // çıkar. Bu yüzden iki alan farklı dillerden beslenir: kod hedeften,
  // cümle sayfadan.
  const text = t("lang.switchText", current);
  const label = t("lang.switchLabel", current);

  return `<a class="lang-switch" href="${escapeHtml(href)}" lang="${target}" hreflang="${target === "en" ? "en" : "tr-TR"}" data-lang-switch="${target}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(text)}</a>`;
}

export function siteHeader(options = {}) {
  const base = normalizeBase(options.base);
  const locale = normalizeLocale(options.locale);
  const primary = linkList(navList(locale, "primary"), base, locale, { showBadges: true });
  const secondaryItems = navList(locale, "secondary");
  const secondary = secondaryItems.length
    ? `<div class="nav-links nav-links-secondary">${linkList(secondaryItems, base, locale, { showBadges: true })}</div>`
    : "";
  // MAÇ MERKEZİ DÜĞMESİ İKİ DİLDE DE KENDİ SAYFASINA GİDER.
  //
  // Düğme bir süre İngilizce tarafta da Türkçe `mac-merkezi.html`e
  // bağlanıyordu ve etiketinde "(TR)" taşıyordu: o sırada sayfanın
  // İngilizcesi üretilmiyordu ve düğmeyi hiç çizmemek, İngilizce okuyucuyu
  // sitenin en kapsamlı maç ekranından tamamen mahrum bırakıyordu.
  //
  // `en/match-centre.html` artık üretiliyor, dolayısıyla o gerekçe ortadan
  // kalktı: İngilizce başlıktaki düğme İngilizce sayfaya gider, "(TR)" eki
  // ve `lang="tr"` işareti kalkar.
  const matchCentreHref = locale === "en" ? "en/match-centre.html" : "mac-merkezi.html";
  const cta = `<a class="cta" href="${base}${matchCentreHref}">${escapeHtml(t("nav.matchCentre", locale))}</a>`;

  // ARAMA KUTUSU İKİ DİLDE DE VAR.
  //
  // Dizin ağırlıklı olarak Türkçe içerik taşıyor ve kutu bu yüzden İngilizce
  // başlıkta hiç açılmıyordu. Ama arama, sitenin 700'den fazla sayfasına
  // ulaşmanın tek pratik yolu: kutuyu hiç göstermemek, İngilizce okuyucuyu
  // o içeriğin tamamından mahrum bırakıyordu. Kutu artık iki dilde de
  // çiziliyor; yer tutucu ve etiketler çevrildi, sonuç satırları hedef
  // sayfanın kendi dilini taşıyor.
  const search = `<form class="site-search" role="search" method="get" action="${base}${locale === "en" ? "en/teams.html" : "oyuncu-radari.html"}" data-search-base="${base}" data-search-locale="${escapeHtml(locale)}" autocomplete="off">
            <span class="site-search-icon" aria-hidden="true">${ICONS.search}</span>
            <input class="site-search-input" type="search" name="search" placeholder="${escapeHtml(t("nav.searchPlaceholder", locale))}" aria-label="${escapeHtml(t("nav.searchInSite", locale))}" aria-expanded="false" aria-controls="site-search-results" role="combobox" />
            <button class="site-search-clear" type="button" aria-label="${escapeHtml(t("nav.searchClear", locale))}" hidden>×</button>
            <div class="site-search-panel" id="site-search-results" role="listbox" hidden></div>
          </form>`;
  const searchToggles = {
    mobile: `<button class="nav-search-toggle nav-search-toggle-mobile" type="button" aria-label="${escapeHtml(t("nav.search", locale))}" aria-controls="primary-menu">${ICONS.search}</button>`,
    desktop: `<button class="nav-search-toggle nav-search-toggle-desktop" type="button" data-search-open aria-label="${escapeHtml(t("nav.search", locale))}" aria-expanded="false" title="${escapeHtml(t("nav.search", locale))}">${ICONS.search}</button>`
  };

  return `<header class="topbar topbar-premium" data-shared-layout="header">
      <div class="topbar-inner">
        <nav class="container-wide nav" aria-label="${escapeHtml(t("nav.ariaLabel", locale))}">
          <a class="brand" href="${base}${locale === "en" ? "en/index.html" : "index.html"}" aria-label="${escapeHtml(t("nav.brandAria", locale))}">
            <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 12 17 8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg></span>
            <span class="brand-text"><b>Futbol</b>Radar</span>
          </a>
          ${searchToggles.mobile}${languageSwitch(base, locale, options.altHref)}
          <button class="nav-toggle" type="button" aria-label="${escapeHtml(t("nav.openMenu", locale))}" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button>
          <div class="nav-menu" id="primary-menu">
            <div class="nav-links">${primary}</div>
            ${secondary}
            ${cta}
            ${searchToggles.desktop}
            <button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false" aria-label="${escapeHtml(t("nav.themeToDark", locale))}">
              <svg class="theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>
              <svg class="theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
              <span class="theme-toggle-label">${escapeHtml(t("nav.themeDark", locale))}</span>
            </button>
          </div>
          ${search}
        </nav>
      </div>
    </header>`;
}

/**
 * Bant öğesinin bağlantısını çözer: iç/dış ayrımı ve iç adresin kök-göreli
 * hâli TEK yerde. Hem sunucuda basılan tam bant (`newsTicker`) hem de
 * istemciye giden paylaşılan veri dosyası (`tickerFeedPayload`) bunu kullanır.
 */
export function resolveTickerHref(rawHrefInput, allHref) {
  const rawHref = rawHrefInput ? rawHrefInput : allHref;
  // Mutlak bir futbolradar.com bağlantısı (news.json'dan gelen haber
  // URL'i gibi) İÇ sayılır: göreli yol gibi yeni sekme/nofollow almaz.
  // Yalnızca gerçekten sitenin dışına çıkan bağlantı kaynak künyesidir.
  const external = /^https?:/i.test(rawHref) && isExternalUrl(rawHref);
  // İÇ ADRES MUTLAK YAZILMAZ. Kendi haberimizin künyesi
  // `https://www.futbolradar.com/haber/<slug>` biçiminde üretiliyor;
  // bant bunu olduğu gibi yazınca bağlantı, sayfanın sunulduğu kopyadan
  // ÇIKIP üretime gidiyordu. Önizlemede ya da CI'ın yerel sunucusunda
  // henüz dağıtılmamış taze bir haber bu yüzden 404 veriyor ve
  // tıklanabilirlik denetimi dokuz görünümde birden düşüyordu. Kök
  // dizinden göreli yol her kopyada o kopyanın sayfasını açar; temiz
  // adres hem vercel.json'da hem yerel önizleme sunucusunda çözülüyor.
  const href = !external && /^https?:/i.test(rawHref)
    ? (() => { const parsed = new URL(rawHref); return `${parsed.pathname}${parsed.search}${parsed.hash}`; })()
    : rawHref;
  return { href, external };
}

/** İstemci bandının okuduğu paylaşılan veri dosyası (site köküne göre). */
export const TICKER_FEED_PATH = "data/ticker-feed.json";

/**
 * İstemci bandı için paylaşılan veri yükü. Sunucudaki `newsTicker` ile AYNI
 * bağlantı kuralını (`resolveTickerHref`) ve aynı kompakt öğe sınırını
 * kullanır; yalnızca sayfaya göre değişen önek (`base`) burada YOKTUR —
 * istemci onu sayfanın `data-ticker-base` değerinden ekler.
 *
 * Yük deterministik: zaman damgası yok. Haber içeriği değişmediyse bayt da
 * değişmez, dosya yeniden yazılmaz.
 */
export function tickerFeedPayload({ tr, en } = {}) {
  const view = (group, locale) => {
    const allHref = locale === "en" ? "en/news.html" : "haberler.html";
    const rows = (Array.isArray(group && group.items) ? group.items : []).filter(Boolean).slice(0, COMPACT_TICKER_MAX_ITEMS);
    const liveBadge = t("ticker.breaking", locale);
    const badge = typeof (group && group.badge) === "string" && group.badge.trim() ? group.badge.trim() : t("ticker.agenda", locale);
    return {
      badge,
      live: badge === liveBadge,
      items: rows.map((item) => {
        const { href, external } = resolveTickerHref(item.href, allHref);
        const attribution = item.publisher || item.sourceName || "";
        const out = { href, text: String(item.text || "") };
        if (external) out.external = true;
        if (item.label) out.label = String(item.label);
        if (item.confidenceBadge) {
          out.confidenceBadge = String(item.confidenceBadge);
          out.confidence = String(item.confidence || "rumour");
        }
        if (attribution) out.attribution = String(attribution);
        return out;
      })
    };
  };
  return { schemaVersion: 1, tr: view(tr, "tr"), en: view(en, "en") };
}

/** Kompakt bantta gösterilecek en fazla öğe. */
export const COMPACT_TICKER_MAX_ITEMS = 3;

/**
 * Üst çubuğun altındaki kayan son dakika bandı. Sonsuz döngü için içerik iki
 * kez basılır ve şerit %50 kaydırılır; bu sayede JavaScript olmadan da (CSS
 * animasyonu) kesintisiz akar. `:hover`/`:focus-within` durumunda durur.
 * Öğeler gerçek bağlantıdır - dekoratif değil, tıklanabilir.
 *
 * `options.compact`: iç sayfalar (maç raporu, oyuncu, takım, transfer, köşe
 * vb.) tam 8 öğelik akışın birebir kopyasını taşımaz — aynı haberin onlarca
 * sayfada tekrarı hem yanıltıcı hem de gereksiz ağırlık. Kompakt modda bant
 * tek satıra döner, kaymaz (`marquee` yok) ve en fazla
 * `COMPACT_TICKER_MAX_ITEMS` öğe basar. Tam akış yalnızca ana sayfa ve
 * haberler.html'de kalır (bkz. scripts/apply-shared-layout.mjs).
 */
export function newsTicker(options = {}) {
  const base = normalizeBase(options.base);
  const locale = normalizeLocale(options.locale);
  const compact = Boolean(options.compact);
  const allItems = Array.isArray(options.items) ? options.items.filter(Boolean) : [];
  const items = compact ? allItems.slice(0, COMPACT_TICKER_MAX_ITEMS) : allItems;
  // Rozet çağırandan gelir: "Son Dakika" bir zaman iddiasıdır ve yalnızca
  // gerçekten taze içerik varsa yazılır. Taze içerik yoksa bant kaldırılmaz,
  // rozet nötr "Gündem" olur — okuyucu gerçek ama eski başlık görür.
  const badge = typeof options.badge === "string" && options.badge.trim()
    ? options.badge.trim()
    : t("ticker.agenda", locale);
  // "Tümü" bağlantısının hedefi dile göre değişir: İngilizce tarafta Türkçe
  // haber sayfasına göndermek dil karışması olurdu.
  const allHref = locale === "en" ? `${base}en/news.html` : `${base}haberler.html`;
  const liveBadge = t("ticker.breaking", locale);

  if (!items.length) {
    return "";
  }

  const renderItem = (item) => {
    const { href, external } = resolveTickerHref(item.href, allHref);
    // Banttaki dış bağlantı bir kaynak künyesidir: alıntı, tavsiye değil.
    const rel = external ? ` target="_blank" rel="${SOURCE_LINK_REL}"` : "";
    const label = item.label ? `<span class="news-ticker-tag">${escapeHtml(item.label)}</span>` : "";

    // GÜVEN ROZETİNİ ŞABLON ÇİZER, EDİTÖR DEĞİL.
    //
    // Rozet `confidence` alanından üretiliyor; metne elle yazılmıyor. Bu
    // bilinçli: editörün rozeti "unutması" mümkün olmamalı. Kesinleşmemiş
    // bir iddia, çekincesi olmadan banda giremez.
    //
    // `confirmed` öğelerde rozet yok — gösterilecek bir çekince olmadığı
    // için. Rozetin varlığı bu yüzden anlamlı bir sinyal.
    const confidence = item.confidenceBadge
      ? `<span class="news-ticker-confidence is-${escapeHtml(item.confidence || "rumour")}">${escapeHtml(item.confidenceBadge)}</span>`
      : "";

    // KAYNAK ATFI ROZETSİZ ÖĞEDE DE GÖRÜNÜR.
    //
    // "Resmî açıklama" etiketi okuyucuya kurumun kendisinin konuştuğunu
    // söyler, ama bağlantı bir toplayıcı üzerinden gidebiliyor: tıklayan
    // kişi kulübün sitesine değil Google News'e düşüyordu ve etiketin
    // arkasındaki kurumu hiçbir yerde göremiyordu. Yayıncı adı artık hem
    // ekran okuyucuya hem de fareyle üzerine gelene gösteriliyor.
    const attribution = item.publisher || item.sourceName || "";
    const ariaText = item.confidenceBadge
      ? `${item.confidenceBadge}: ${item.text}`
      : item.text;
    const aria = attribution || item.confidenceBadge
      ? ` aria-label="${escapeHtml(`${ariaText}${attribution ? ` — kaynak: ${attribution}` : ""}`)}"`
      : "";
    const title = attribution ? ` title="${escapeHtml(`Kaynak: ${attribution}`)}"` : "";

    return `<a class="news-ticker-item" href="${escapeHtml(href)}"${rel}${aria}${title}>${label}${confidence}<span>${escapeHtml(item.text)}</span></a>`;
  };

  const track = items.map(renderItem).join('<span class="news-ticker-sep" aria-hidden="true"></span>');
  const badgeMarkup = `<span class="news-ticker-badge${badge === liveBadge ? " is-live" : ""}">${badge === liveBadge ? '<i class="live-pulse" aria-hidden="true"></i>' : ""}${escapeHtml(badge)}</span>`;
  const allLink = `<a class="news-ticker-all" href="${allHref}">${escapeHtml(t("ticker.all", locale))}</a>`;

  if (compact && options.deferred) {
    // İSTEMCİDE DOLAN BANT (iç sayfalar).
    //
    // Haber başlıkları ve bağlantıları ~14.800 sayfaya gömülünce her haber
    // değişikliği hepsini yeniden yazıyordu (commit başına ~11-14 bin dosya).
    // Artık sayfada HABERDEN BAĞIMSIZ, sabit bir iskelet var; öğeler tek bir
    // paylaşılan dosyadan (`data/ticker-feed.json`) site.js ile doldurulur.
    // Bu işaretleme haber akışına hiç bağlı OLMAMALI: rozet her zaman nötr
    // "Gündem", metin sabit bir çağrı, bağlantı "Tümü" ile aynı hedef. Böylece
    // JS yoksa ya da veri dosyası inmezse sayfa bozulmaz, yükseklik aynı kalır
    // ve haber değişince bu bloğun baytı değişmez.
    const feedHref = `${base}${TICKER_FEED_PATH}`;
    return `<div class="news-ticker news-ticker-compact" data-shared-layout="ticker" data-ticker-source="ticker-feed" data-ticker-mode="compact" data-ticker-render="client" data-ticker-src="${feedHref}" data-ticker-base="${base}" data-ticker-locale="${locale}" aria-label="${escapeHtml(t("ticker.aria", locale))}">
      <div class="container-wide news-ticker-inner">
        <span class="news-ticker-badge">${escapeHtml(t("ticker.agenda", locale))}</span>
        <div class="news-ticker-viewport">
          <div class="news-ticker-track">
            <div class="news-ticker-group"><a class="news-ticker-item" href="${allHref}"><span>${escapeHtml(t("ticker.fallback", locale))}</span></a></div>
          </div>
        </div>
        ${allLink}
      </div>
    </div>`;
  }

  if (compact) {
    // Sabit tek satır: kayan ikinci kopya yok, `animation` da yok — bu
    // sayede aynı sekiz öğelik akış iç sayfada tekrar basılmıyor.
    return `<div class="news-ticker news-ticker-compact" data-shared-layout="ticker" data-ticker-source="ticker-feed" data-ticker-mode="compact" aria-label="${escapeHtml(t("ticker.aria", locale))}">
      <div class="container-wide news-ticker-inner">
        ${badgeMarkup}
        <div class="news-ticker-viewport">
          <div class="news-ticker-track">
            <div class="news-ticker-group">${track}</div>
          </div>
        </div>
        ${allLink}
      </div>
    </div>`;
  }

  const duration = Math.max(36, items.length * 10);

  return `<div class="news-ticker" data-shared-layout="ticker" data-ticker-source="ticker-feed" aria-label="${escapeHtml(t("ticker.aria", locale))}">
      <div class="container-wide news-ticker-inner">
        ${badgeMarkup}
        <div class="news-ticker-viewport">
          <div class="news-ticker-track" style="--ticker-duration:${duration}s">
            <div class="news-ticker-group">${track}</div>
            <div class="news-ticker-group" aria-hidden="true">${track}</div>
          </div>
        </div>
        ${allLink}
      </div>
    </div>`;
}

/** Kurumsal alt bilgi: hakkında metni, gezinme sütunları, sosyal ikonlar. */
export function siteFooter(options = {}) {
  const base = normalizeBase(options.base);
  const locale = normalizeLocale(options.locale);
  const year = options.year || new Date().getFullYear();
  const primaryItems = navList(locale, "primary");
  const secondaryItems = navList(locale, "secondary");
  const legalItems = locale === "tr"
    ? FOOTER_LEGAL.map((item) => ({ href: item.href, label: t(item.key, locale) }))
    : [];

  const social = SOCIAL.map(
    (item) =>
      // Bunlar FutbolRadar'ın KENDİ hesapları; `nofollow` kendi markasını
      // inkâr etmek olurdu. Yalnızca güvenlik öznitelikleri.
      `<a href="${escapeHtml(item.href)}" aria-label="${escapeHtml(item.label)}" target="_blank" rel="${PLAIN_EXTERNAL_REL}">${item.icon}</a>`
  ).join("");

  const column = (titleKey, items) => (items.length
    ? `<div class="footer-col">
          <h2>${escapeHtml(t(titleKey, locale))}</h2>
          <div class="footer-col-links">${linkList(items, base)}</div>
        </div>`
    : "");

  const bottomLinks = locale === "tr"
    ? `<span class="footer-links"><a href="${base}veri-notu.html">${escapeHtml(t("footer.dataNote", locale))}</a><a href="${base}iletisim.html">${escapeHtml(t("footer.contact", locale))}</a><a href="${base}bulten.html">E-posta bülteni</a></span>`
    : "";

  return `<footer class="footer footer-premium" data-shared-layout="footer">
      <div class="container-wide footer-grid">
        <div class="footer-brand">
          <a class="brand" href="${base}${locale === "en" ? "en/index.html" : "index.html"}" aria-label="${escapeHtml(t("nav.brandAria", locale))}">
            <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 12 17 8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg></span>
            <span class="brand-text"><b>Futbol</b>Radar</span>
          </a>
          <p class="footer-tagline"><strong>${escapeHtml(t("footer.tagline", locale))}</strong></p>
          <p>${escapeHtml(t("footer.blurb", locale))}</p>
          <div class="footer-social" aria-label="${escapeHtml(t("footer.social", locale))}">${social}</div>
        </div>
        ${column("footer.match", primaryItems)}
        ${column("footer.data", secondaryItems)}
        ${column("footer.corporate", legalItems)}
      </div>
      <div class="container-wide footer-bottom">
        <span>© ${escapeHtml(year)} FutbolRadar · ${escapeHtml(t("site.tagline", locale))}</span>
        ${bottomLinks}
      </div>
      ${bottomNav(base, locale)}
    </footer>`;
}

/**
 * MOBİL ALT NAVİGASYON.
 *
 * NEDEN ALT BİLGİNİN İÇİNDE: `apply-shared-layout.mjs` sayfalardaki
 * `<footer class="footer">…</footer>` bloğunun TAMAMINI her derlemede
 * değiştiriyor. Çubuk alt bilginin DIŞINA yazılsaydı, o düzenli ifade
 * `</footer>` etiketinde durur ve önceki çubuk yerinde kalırdı: her
 * derleme bir çubuk daha eklerdi. İçeride durduğu sürece değiştirme
 * atomik. `position: fixed` olduğu için DOM'daki yeri görünümü etkilemiyor.
 *
 * "MENÜ" YENİ BİR MENÜ AÇMIYOR. Başlıktaki mevcut mobil çekmecede zaten
 * Analizler, Puan Durumu, Köşe Yazıları, Arşiv ve Oyuncu Radarı var;
 * ikinci bir menü yazmak aynı listeyi iki yerde ayrıştırırdı. Düğme o
 * çekmeceyi açıyor (site.js).
 *
 * Aktif sayfa işaretlemesi derleme anında YAPILMIYOR: bu bileşen ~900
 * sayfaya aynı çıktıyla basılıyor ve hangi dosyaya yazıldığını bilmiyor.
 * İşaretleme site.js'te `location.pathname` ile yapılıyor.
 */
function bottomNav(base, locale) {
  const en = locale === "en";
  const items = [
    { key: "bottomNav.home", href: en ? "en/index.html" : "index.html", icon:
      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>' },
    { key: "bottomNav.live", href: en ? "en/live-football-scores.html" : "canli-skor.html", icon:
      '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>' },
    { key: "bottomNav.matches", href: en ? "en/todays-matches.html" : "bugunun-maclari.html", icon:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>' },
    { key: "bottomNav.teams", href: en ? "en/teams.html" : "takimlar.html", icon:
      '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 11a3 3 0 1 0-2-5.2"/><path d="M18 20c0-2.2-.9-4.2-2.3-5.6"/>' }
  ];

  const links = items.map((item) => {
    const label = escapeHtml(t(item.key, locale));
    return `<a class="bottom-nav__item" href="${base}${item.href}" data-bottom-nav-item>
          <svg class="bottom-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg>
          <span class="bottom-nav__label">${label}</span>
        </a>`;
  }).join("");

  const menuLabel = escapeHtml(t("bottomNav.menu", locale));

  return `<nav class="bottom-nav" data-bottom-nav aria-label="${escapeHtml(t("bottomNav.aria", locale))}">
        ${links}
        <button class="bottom-nav__item" type="button" data-bottom-nav-menu aria-expanded="false">
          <svg class="bottom-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          <span class="bottom-nav__label">${menuLabel}</span>
        </button>
      </nav>`;
}

export { escapeHtml as escapeLayoutHtml, normalizeBase };
