#!/usr/bin/env node
/**
 * ÜYELİK SAYFALARI — /pro, /profil, /giris (+ İngilizce karşılıkları).
 *
 * =====================================================================
 * ÜÇ SAYFA, İKİ FARKLI INDEKSLEME KARARI
 * =====================================================================
 *   • `pro.html`    → İNDEKSLENİR. Ne sunulduğunu anlatan gerçek bir
 *                     içerik sayfası; arama sonucunda görünmeye değer
 *                     ve `data/en-route-map` üzerinden hreflang çifti
 *                     kuruluyor.
 *   • `profil.html` → `noindex,follow`. İçeriği KİŞİYE ÖZEL; sunucudan
 *                     gelen hâli boş bir kabuk. Google'a gösterilecek
 *                     bir şey yok ve boş kabuğun indekslenmesi zaten
 *                     zararlı olurdu.
 *   • `giris.html`  → `noindex,follow`. Aynı gerekçe.
 *
 * =====================================================================
 * GİRİŞ DUVARI YOK — SAYFALARIN KENDİSİ DE DAHİL
 * =====================================================================
 * Profil sayfası giriş yapmamış birine 401 vermez, YÖNLENDİRMEZ:
 * sayfayı açar ve "giriş yap" der. Sunucu tarafında oturum
 * denetimi yapan bir yönlendirme, bu depodaki statik + CDN modeliyle
 * zaten uyumsuz olurdu (yanıt paylaşılıyor); ama daha önemlisi, bu
 * sitenin ilkesi üyeliğin ZORUNLU OLMAMASI.
 *
 * =====================================================================
 * PRO SAYFASI FİYATI SABİT YAZMAZ
 * =====================================================================
 * "Ücretsiz" kelimesi bu dosyada hiçbir yerde sabit değil;
 * `services/membership/config.js` içindeki `priceLabel()` okunuyor.
 * Fiyat konduğu gün sayfa metni KENDİLİĞİNDEN doğru olur — aksi hâlde
 * ücretli döneme geçişte "şimdilik ücretsiz" yazan bir sayfa
 * unutulurdu, ve bu tam olarak unutulan türden bir cümledir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { DOMAIN, absoluteUrl, hreflangOf, routeMeta, t } = require("../services/i18n.js");
const config = require("../services/membership/config.js");
const { PREF_KEYS } = require("../services/membership/profileStore.js");

const root = process.cwd();
const OG_IMAGE = `${DOMAIN}/assets/og/futbolradar-og.png`;

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * HREFLANG'I İNGİLİZCE SAYFA KENDİ GÖMER.
 *
 * `scripts/inject-hreflang.mjs` kayıtlı rotalarda YALNIZCA Türkçe
 * tarafa yazıyor; İngilizce taraf kendi üreticisinde gömülü olmalı
 * (aksi hâlde aynı sayfaya gömülü + işaretli iki çakışan alternate
 * kümesi girerdi — bkz. o dosyadaki gerekçe). `/en/pro` da kendi
 * üreticisine sahip olduğu için kural burada geçerli.
 *
 * Üçlü tam yazılır (tr-TR + en + x-default): tek yönlü bir bildirimi
 * Google tamamen yok sayar.
 */
function alternatesFor(trPath, enPath) {
  const trUrl = absoluteUrl(trPath);
  const enUrl = absoluteUrl(enPath);
  return [
    `    <link rel="alternate" hreflang="${hreflangOf("tr")}" href="${trUrl}" />`,
    `    <link rel="alternate" hreflang="${hreflangOf("en")}" href="${enUrl}" />`,
    `    <link rel="alternate" hreflang="x-default" href="${trUrl}" />`
  ].join("\n");
}

function shellHtml({ locale, title, description, canonical, base, altHref, body, bodyClass, schema, indexable, alternates }) {
  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
${alternates ? `${alternates}\n` : ""}    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${locale === "en" ? "en_US" : "tr_TR"}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
${schema ? `    <script type="application/ld+json">${JSON.stringify(schema)}</script>\n` : ""}    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
  </head>
  <body class="subpage ${bodyClass}">
    ${siteHeader({ base, locale, altHref })}
    <main class="container">
${body}
    </main>
    ${siteFooter({ base, locale })}
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

/**
 * PRO ÖZELLİK KARTLARI.
 *
 * Sıra rastgele değil: önce okumayı DEĞİŞTİREN şeyler (sade arayüz,
 * istatistik, AI analizi), sonra KİŞİSELLEŞTİREN şeyler (favoriler,
 * bildirimler). Okuyucu listeyi yukarıdan aşağı okuduğunda önce "ne
 * göreceğim", sonra "bana nasıl uyacak" cevabını alıyor.
 */
const FEATURE_KEYS = [
  "adLight",
  "stats",
  "ai",
  "probability",
  "lineups",
  "availability",
  "form",
  "compare",
  "league",
  "favorites",
  "favoriteMatch",
  "notifications",
  "personalHome"
];

function proPage(locale) {
  const base = locale === "en" ? "../" : "./";
  const isEn = locale === "en";
  const pagePath = isEn ? "en/pro.html" : "pro.html";
  // KANONİK, ROTA EŞLEMESİNDEN. `/pro` gibi uzantısız bir adres
  // yazmak, bu sitenin kanonik biçimiyle (hep `.html`) çelişirdi ve
  // hreflang çifti tek yönlü kalırdı — Google'ın `alternate`
  // ilişkisini tamamen yok saydığı durum tam olarak budur.
  const canonical = absoluteUrl(pagePath);
  const altHref = isEn ? "pro.html" : "en/pro.html";
  const loginHref = isEn ? "en/login.html" : "giris.html";
  const profileHref = isEn ? "en/profile.html" : "profil.html";

  const features = FEATURE_KEYS.map((key) => `        <li class="pro-feature">
          <h3>${escapeHtml(t(`pro.feature.${key}.title`, locale))}</h3>
          <p>${escapeHtml(t(`pro.feature.${key}.body`, locale))}</p>
        </li>`).join("\n");

  // Başlık ve açıklama ROUTE_META'dan: kayıtlı bir rotanın metadata'sı
  // tek kaynakta durmalı, yoksa site haritası ile sayfa ayrışır.
  const meta = routeMeta("pro", locale);
  const title = meta.title;
  const description = meta.description;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "FutbolRadar PRO",
    description,
    brand: { "@type": "Brand", name: "FutbolRadar" },
    url: canonical,
    // FİYAT ŞEMADA DA CONFIG'TEN. Sabit "0" yazmak, fiyat konduğu gün
    // yapılandırılmış veride yanlış bir fiyat bırakırdı — ve Google'ın
    // gördüğü fiyat, sayfada yazandan daha uzun süre yaşar.
    offers: {
      "@type": "Offer",
      price: String(config.PRO_PRICE),
      priceCurrency: config.PRO_CURRENCY,
      availability: "https://schema.org/InStock",
      url: canonical
    }
  };

  const body = `      <nav class="breadcrumb" aria-label="${isEn ? "Breadcrumb" : "Site haritası"}"><a href="${base}${isEn ? "en/index.html" : "index.html"}">${escapeHtml(t("nav.home", locale))}</a> <span aria-hidden="true">›</span> <span>${escapeHtml(t("pro.title", locale))}</span></nav>
      <section class="hero pro-hero" data-pro-page>
        <p class="pro-free-banner">${escapeHtml(t("pro.freeBanner", locale))}</p>
        <h1>${escapeHtml(t("pro.title", locale))}</h1>
        <p class="lead">${escapeHtml(t("pro.subtitle", locale))}</p>
        <p class="pro-price-note">${escapeHtml(t("pro.priceLabel", locale))}: <strong>${escapeHtml(config.priceLabel(locale))}</strong> — ${escapeHtml(t("pro.earlyAccess", locale))}</p>
        <p data-pro-anonymous><a class="pro-cta" href="${base}${loginHref}?mode=signup">${escapeHtml(t("pro.cta", locale))}</a></p>
        <p data-pro-signed-in hidden>${escapeHtml(t("pro.alreadyPro", locale))} <a class="pro-cta" href="${base}${profileHref}">${escapeHtml(t("pro.ctaSignedIn", locale))}</a></p>
      </section>
      <section class="section">
        <h2>${escapeHtml(t("pro.featuresTitle", locale))}</h2>
        <ul class="pro-feature-grid">
${features}
        </ul>
      </section>
      <section class="section">
        <p class="muted-copy">${escapeHtml(t("pro.noPaywall", locale))}</p>
      </section>`;

  return {
    file: pagePath,
    html: shellHtml({
      locale, title, description, canonical, base, altHref, body,
      bodyClass: "pro-page", schema, indexable: true,
      alternates: isEn ? alternatesFor("pro.html", "en/pro.html") : ""
    })
  };
}

function loginPage(locale) {
  const base = locale === "en" ? "../" : "./";
  const isEn = locale === "en";
  const pagePath = isEn ? "en/login.html" : "giris.html";
  const canonical = absoluteUrl(pagePath);
  const altHref = isEn ? "giris.html" : "en/login.html";

  const title = `${t("auth.loginTitle", locale)} | FutbolRadar`;

  /**
   * TEK SAYFADA İKİ FORM, BİRİ GİZLİ.
   *
   * Giriş ve kayıt ayrı sayfalar olsaydı aralarındaki geçiş bir sayfa
   * yüklemesi olurdu; mobilde form doldururken bu, yazılanların
   * kaybolması demek. `?mode=signup` ile gelindiğinde kayıt formu
   * açık başlar (PRO sayfasındaki düğme böyle bağlanıyor).
   */
  const body = `      <div class="auth-card">
        <h1 data-auth-title>${escapeHtml(t("auth.loginTitle", locale))}</h1>
        <p class="auth-note" data-auth-note hidden></p>
        <p class="auth-error" data-auth-error hidden role="alert"></p>

        <form data-auth-form="login" data-auth-panel="login" novalidate>
          <label class="auth-field"><span>${escapeHtml(t("auth.email", locale))}</span>
            <input type="email" name="email" autocomplete="email" required />
          </label>
          <label class="auth-field"><span>${escapeHtml(t("auth.password", locale))}</span>
            <input type="password" name="password" autocomplete="current-password" required />
          </label>
          <button class="auth-submit" type="submit">${escapeHtml(t("auth.submitLogin", locale))}</button>
        </form>

        <form data-auth-form="signup" data-auth-panel="signup" hidden novalidate>
          <label class="auth-field"><span>${escapeHtml(t("auth.displayName", locale))}</span>
            <input type="text" name="displayName" autocomplete="nickname" maxlength="80" />
          </label>
          <label class="auth-field"><span>${escapeHtml(t("auth.email", locale))}</span>
            <input type="email" name="email" autocomplete="email" required />
          </label>
          <label class="auth-field"><span>${escapeHtml(t("auth.password", locale))}</span>
            <input type="password" name="password" autocomplete="new-password" minlength="8" required />
            <small class="muted-copy">${escapeHtml(t("auth.passwordHint", locale))}</small>
          </label>
          <button class="auth-submit" type="submit">${escapeHtml(t("auth.submitSignup", locale))}</button>
          <p class="muted-copy">${escapeHtml(t("auth.noPaymentNote", locale))}</p>
        </form>

        <p class="auth-divider">${escapeHtml(t("auth.or", locale))}</p>
        <button class="auth-google" type="button" data-auth-google>${escapeHtml(t("auth.googleButton", locale))}</button>

        <p class="auth-switch"><button type="button" class="link-button" data-auth-switch>${escapeHtml(t("auth.toSignup", locale))}</button></p>
      </div>`;

  return {
    file: pagePath,
    html: shellHtml({
      locale, title, description: t("auth.loginTitle", locale), canonical, base, altHref, body,
      bodyClass: "auth-page", schema: null, indexable: false
    })
  };
}

function profilePage(locale) {
  const base = locale === "en" ? "../" : "./";
  const isEn = locale === "en";
  const pagePath = isEn ? "en/profile.html" : "profil.html";
  const canonical = absoluteUrl(pagePath);
  const altHref = isEn ? "profil.html" : "en/profile.html";
  const loginHref = isEn ? "en/login.html" : "giris.html";
  const proHref = isEn ? "en/pro.html" : "pro.html";

  const favoriteBlocks = [
    ["team", "profile.favoriteTeams"],
    ["player", "profile.favoritePlayers"],
    ["league", "profile.favoriteLeagues"],
    ["match", "profile.followedMatches"]
  ].map(([kind, key]) => `          <section class="card">
            <h2>${escapeHtml(t(key, locale))}</h2>
            <ul class="profile-favorites" data-profile-favorites="${kind}"></ul>
          </section>`).join("\n");

  // Bildirim anahtarları ŞEMADAN geliyor (`PREF_KEYS`), burada elle
  // sayılmıyor: yeni bir bildirim tipi eklendiğinde profil sayfası
  // kendiliğinden onu da gösterir.
  const preferences = PREF_KEYS.map((key) => `              <li class="profile-pref">
                <label for="pref-${key}">${escapeHtml(t(`notify.${key}`, locale))}</label>
                <input type="checkbox" id="pref-${key}" data-preference="${key}" />
              </li>`).join("\n");

  const body = `      <div data-profile-root>
        <section class="card" data-profile-signin>
          <h1>${escapeHtml(t("profile.title", locale))}</h1>
          <p>${escapeHtml(t("profile.signInRequired", locale))}</p>
          <p><a class="pro-cta" href="${base}${loginHref}?returnTo=${encodeURIComponent(`/${pagePath}`)}">${escapeHtml(t("account.signIn", locale))}</a></p>
        </section>

        <div data-profile-body hidden>
          <section class="profile-head">
            <span class="profile-avatar" data-profile-avatar aria-hidden="true"></span>
            <div>
              <h1>
                <span data-profile-name></span>
                <span class="pro-badge" data-profile-badge hidden>PRO</span>
              </h1>
              <p class="muted-copy" data-profile-email></p>
              <p>${escapeHtml(t("account.membership", locale))}: <strong data-profile-membership></strong></p>
              <p class="muted-copy"><a href="${base}${proHref}">${escapeHtml(t("pro.title", locale))}</a></p>
            </div>
          </section>

          <section class="card">
            <form data-profile-form>
              <label class="auth-field"><span>${escapeHtml(t("profile.displayNameLabel", locale))}</span>
                <input type="text" data-profile-name-input maxlength="80" />
              </label>
              <button class="auth-submit" type="submit">${escapeHtml(t("profile.save", locale))}</button>
              <p class="auth-note" data-profile-saved hidden></p>
            </form>
          </section>

${favoriteBlocks}

          <section class="card">
            <h2>${escapeHtml(t("profile.notificationSettings", locale))}</h2>
            <ul class="profile-prefs">
${preferences}
            </ul>
          </section>
        </div>
      </div>`;

  return {
    file: pagePath,
    html: shellHtml({
      locale, title: `${t("profile.title", locale)} | FutbolRadar`,
      description: t("profile.title", locale), canonical, base, altHref, body,
      bodyClass: "profile-page", schema: null, indexable: false
    })
  };
}

const pages = [];
for (const locale of ["tr", "en"]) {
  pages.push(proPage(locale), loginPage(locale), profilePage(locale));
}

let written = 0;
for (const page of pages) {
  const target = path.join(root, page.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (existing === page.html) continue;
  fs.writeFileSync(target, page.html, "utf8");
  written += 1;
}

console.log(`membership pages: ${written}/${pages.length} yazıldı (${pages.map((page) => page.file).join(", ")})`);
