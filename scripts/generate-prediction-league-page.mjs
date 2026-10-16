#!/usr/bin/env node
/**
 * /tahmin-ligi — ÜCRETSİZ SÜPER LİG TAHMİN LİGİ SAYFASI (statik, hızlı, SEO dostu).
 *
 * Sayfa SUNUCUDA, dosya olarak üretilir; tarayıcıda yalnızca küçük bir betik
 * (tahmin-ligi.js) hesabı ve sıralamayı doldurur. Böylece:
 *   • açılış maliyeti sıfır: HTML CDN'de, API'ye ilk açılışta istek YOK
 *     (giriş yapmamış ziyaretçi yalnızca CDN'de önbellekli sıralamayı çeker);
 *   • açık maç listesi, kurallar ve SSS JavaScript olmadan da okunur/taranır;
 *   • saatlik güncellemede (postprocess zinciri) maç listesi tazelenir.
 *
 * Veri: data/prediction-league-fixtures.json (scripts/sync-prediction-league.mjs).
 * Sonuç uydurulmaz; maç listesi yalnızca takvimdeki Süper Lig maçlarından gelir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-image.png`;
const CANONICAL = `${siteUrl}/tahmin-ligi`;

export const PAGE_TITLE = "Süper Lig Tahmin Ligi: Ücretsiz Skor Tahmini | FutbolRadar";
export const PAGE_DESCRIPTION = "Süper Lig maçlarının skorunu tahmin et, haftalık, aylık ve sezonluk sıralamada yüksel. Ücretsiz, sadece rumuz yeter; doğru skor 5, doğru sonuç 2 puan.";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const TIME = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });

function readFixtures() {
  try {
    const file = JSON.parse(fs.readFileSync(path.join(root, "data", "prediction-league-fixtures.json"), "utf8"));
    return Array.isArray(file.fixtures) ? file.fixtures : [];
  } catch (error) {
    return [];
  }
}

/** Yalnızca tahmine açık (SCHEDULED) ve henüz başlamamış maçlar. */
export function openFixtures(fixtures, nowMs = Date.now()) {
  return fixtures.filter((row) => row.status === "SCHEDULED" && Date.parse(row.kickoff) > nowMs);
}

function fixtureCard(row) {
  const when = TIME.format(new Date(row.kickoff));
  return `<form class="league-fixture" data-fixture="${escapeHtml(row.fixtureId)}" data-kickoff="${escapeHtml(row.kickoff)}">
            <header><span>${row.round ? `${escapeHtml(row.round)}. hafta · ` : ""}<time datetime="${escapeHtml(row.kickoff)}">${escapeHtml(when)}</time> TSİ</span><span data-lock></span></header>
            <div class="teams"><b>${escapeHtml(row.homeTeam)}</b><span class="score"><label class="sr-only" for="h-${escapeHtml(row.fixtureId)}">${escapeHtml(row.homeTeam)} golü</label><input id="h-${escapeHtml(row.fixtureId)}" type="number" inputmode="numeric" min="0" max="20" step="1" disabled /><span aria-hidden="true">-</span><label class="sr-only" for="a-${escapeHtml(row.fixtureId)}">${escapeHtml(row.awayTeam)} golü</label><input id="a-${escapeHtml(row.fixtureId)}" type="number" inputmode="numeric" min="0" max="20" step="1" disabled /></span><b>${escapeHtml(row.awayTeam)}</b></div>
            <div class="actions"><span data-saved></span><button class="league-btn" type="submit" disabled>Tahmini kaydet</button></div>
          </form>`;
}

const FAQ = [
  ["Tahmin ligi ücretsiz mi?", "Evet. Üyelik, ödeme ya da reklam izleme gerekmez. Yalnızca bir rumuz seçersin."],
  ["Hangi bilgilerim saklanıyor?", "Rumuzun ve tahminlerin. E-posta, telefon ya da gerçek adın istenmez. Herkese açık sıralamada yalnızca rumuz ve puan görünür."],
  ["Kurtarma kodu ne işe yarar?", "Hesabını başka cihazda açmak için tek yolun. Kayıt olurken bir kez gösterilir; sunucuda yalnızca karması saklanır, bu yüzden kaybedersen biz de yeniden gösteremeyiz."],
  ["Tahminimi ne zamana kadar değiştirebilirim?", "Maç başlayana kadar, her maç için en fazla 10 kez. Başlama saatinden sonra tahmin kilitlenir; bu kural sunucuda ve veritabanında da uygulanır."],
  ["Puanlar nasıl hesaplanıyor?", "Doğru skor 5, doğru maç sonucu (1-X-2) 2, yanlış tahmin 0 puandır. Puanlar toplanmaz: skoru doğru bilirsen 5 alırsın, 7 değil."],
  ["Maç ertelenir ya da iptal edilirse?", "Puan verilmez, tahminin sayılmaz. Maç yeniden planlanırsa tahminini yeniden yapabilirsin."],
  ["Sonuçlar nereden geliyor?", "FutbolRadar'ın mevcut doğrulanmış sonuç verisinden. Sonucu kaynağın doğrulamadığı maçlar puanlanmaz."]
];

export function renderPage(fixtures, nowMs = Date.now()) {
  const open = openFixtures(fixtures, nowMs);
  const rounds = new Map();
  for (const row of open) {
    const key = row.round || 0;
    if (!rounds.has(key)) rounds.set(key, []);
    rounds.get(key).push(row);
  }
  const fixtureHtml = open.length
    ? [...rounds.entries()].map(([, rows]) => rows.map(fixtureCard).join("\n          ")).join("\n          ")
    : `<p class="league-note">Şu an tahmine açık Süper Lig maçı yok. Yeni haftanın maçları takvime girdiğinde burada listelenir. Bu arada <a href="./super-lig-fikstur.html">Süper Lig fikstürüne</a> göz atabilirsin.</p>`;

  const graph = [
    { "@type": "WebPage", "@id": `${CANONICAL}#page`, url: CANONICAL, name: PAGE_TITLE, description: PAGE_DESCRIPTION, inLanguage: "tr-TR", isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${siteUrl}/` } },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Tahmin Ligi", item: CANONICAL }
    ] }
  ];

  const related = [
    ["./super-lig-puan-durumu.html", "Süper Lig puan durumu"], ["./bugunun-maclari.html", "Bugünün maçları"], ["./canli-skor.html", "Canlı skorlar"],
    ["./super-lig-fikstur.html", "Süper Lig fikstürü"], ["./galatasaray-maclari.html", "Galatasaray maçları"], ["./fenerbahce-maclari.html", "Fenerbahçe maçları"],
    ["./besiktas-maclari.html", "Beşiktaş maçları"], ["./trabzonspor-maclari.html", "Trabzonspor maçları"]
  ];

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(PAGE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <link rel="canonical" href="${CANONICAL}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <meta property="og:image" content="${socialImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./page.css" />
    <link rel="stylesheet" href="./prediction-league.css" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="league-page" id="tahmin-ligi" data-league>
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><span aria-current="page">Tahmin Ligi</span></nav>
          <header class="league-hero">
            <span class="section-kicker">Ücretsiz · Süper Lig</span>
            <h1>Süper Lig Tahmin Ligi</h1>
            <p>Maçın skorunu başlamadan önce tahmin et, puan topla, haftalık, aylık ve sezonluk sıralamada yüksel. Üyelik yok, ödeme yok: bir rumuz yeter.</p>
            <p class="league-note">Tahminler maç başladığında kilitlenir. Puanlama FutbolRadar'ın doğrulanmış maç sonuçlarıyla yapılır.</p>
            <div class="league-cta"><a href="#tahmin">Tahmin yap</a><a class="ghost" href="#siralama">Sıralamayı gör</a></div>
          </header>
          <p class="league-live" data-live role="status" aria-live="polite"></p>

          <div class="league-grid">
            <section class="league-card" id="tahmin" aria-labelledby="tahmin-baslik">
              <h2 id="tahmin-baslik">Bu haftanın maçları</h2>
              <div data-guest>
                <p>Tahmin yapmak için rumuz seç. Giriş yapmadan sıralamayı ve maçları görebilirsin.</p>
                <form class="league-form" data-register autocomplete="off">
                  <label>Rumuz (3-16 karakter)<input type="text" name="nickname" required minlength="3" maxlength="16" pattern="[A-Za-z0-9ÇĞİÖŞÜçğıöşü_.\\-]{3,16}" autocomplete="off" /></label>
                  <div class="league-trap" aria-hidden="true"><label>Web sitesi<input type="text" name="website" tabindex="-1" autocomplete="off" /></label></div>
                  <button type="submit">Katıl ve tahmin et</button>
                  <button class="league-btn ghost" type="button" data-switch="login">Zaten hesabım var</button>
                </form>
                <form class="league-form" data-login hidden autocomplete="off">
                  <label>Rumuz<input type="text" name="nickname" required maxlength="16" autocomplete="username" /></label>
                  <label>Kurtarma kodu<input type="text" name="code" required maxlength="19" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" /></label>
                  <button type="submit">Giriş yap</button>
                  <button class="league-btn ghost" type="button" data-switch="register">Yeni hesap aç</button>
                </form>
              </div>
              <div class="league-recovery" data-recovery hidden>
                <strong><span data-recovery-nick></span>, hesabın hazır.</strong>
                <p class="league-note">Kurtarma kodun yalnızca şimdi gösterilir. Başka cihazda giriş için gerekli; kaybedersen yeniden gösteremeyiz.</p>
                <code data-recovery-code></code>
                <button class="league-btn" type="button" data-copy>Kodu kopyala</button>
                <button class="league-btn ghost" type="button" data-recovery-done>Kaydettim</button>
              </div>
              <div data-member hidden>
                <p>Merhaba <strong data-nick></strong> · <button class="league-btn ghost" type="button" data-logout>Çıkış</button></p>
              </div>
              <div class="league-fixtures" data-fixtures>
          ${fixtureHtml}
              </div>
              <noscript><p class="league-note">Tahmin yapmak için JavaScript gerekir. Sıralama ve kurallar bu sayfada okunabilir.</p></noscript>
            </section>

            <div class="league-side">
              <section class="league-card" id="siralama" aria-labelledby="siralama-baslik">
                <h2 id="siralama-baslik">Sıralama</h2>
                <div class="league-tabs" role="tablist" aria-label="Sıralama dönemi">
                  <button type="button" role="tab" data-period="week" aria-selected="true">Haftalık</button>
                  <button type="button" role="tab" data-period="month" aria-selected="false">Aylık</button>
                  <button type="button" role="tab" data-period="season" aria-selected="false">Sezonluk</button>
                </div>
                <div class="league-table-wrap"><table class="league-table"><caption class="sr-only">İlk 50 oyuncu</caption><thead><tr><th scope="col">#</th><th scope="col">Rumuz</th><th scope="col">Puan</th><th scope="col">Skor</th><th scope="col">Maç</th></tr></thead><tbody data-board-body><tr><td colspan="5">Yükleniyor…</td></tr></tbody></table></div>
                <p class="league-note">Herkese açık sıralamada yalnızca rumuz ve puan görünür. "Skor": doğru skor sayısı, "Maç": puanlanan tahmin sayısı.</p>
              </section>

              <section class="league-card" data-member hidden aria-labelledby="durum-baslik">
                <h2 id="durum-baslik">Durumum</h2>
                <div class="league-stats"><div data-stat="week"></div><div data-stat="month"></div><div data-stat="season"></div></div>
                <p class="league-note" data-summary></p>
                <h3>Rozetler</h3>
                <ul class="league-badges" data-badges></ul>
              </section>

              <section class="league-card" aria-labelledby="puan-baslik">
                <h2 id="puan-baslik">Puanlama</h2>
                <ul class="league-points"><li><strong>5</strong><small>Doğru skor</small></li><li><strong>2</strong><small>Doğru sonuç</small></li><li><strong>0</strong><small>Yanlış</small></li></ul>
                <p class="league-note">Puanlar toplanmaz. Ertelenen veya iptal edilen maçta puan verilmez. Tahmin, maç başlayınca kilitlenir.</p>
              </section>
            </div>
          </div>

          <section class="league-card league-faq" aria-labelledby="sss-baslik">
            <h2 id="sss-baslik">Sık sorulanlar</h2>
            ${FAQ.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("\n            ")}
          </section>

          <aside class="evergreen-related" aria-labelledby="league-related"><h2 id="league-related">Süper Lig'i takip et</h2><div class="evergreen-link-grid">${related.map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`).join("")}</div></aside>
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
    <script src="./tahmin-ligi.js" defer></script>
  </body>
</html>\n`;
}

function updateSitemap(file) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`<loc>${CANONICAL}</loc>`));
  const today = new Date().toISOString().slice(0, 10);
  const fresh = `  <url>\n    <loc>${CANONICAL}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  const next = wrapUrlset([...existing, fresh]);
  // Aynı içerik (lastmod hariç) ise dosyaya dokunma: gereksiz sitemap farkı üretme.
  const strip = (text) => text.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
  if (strip(next) !== strip(xml)) fs.writeFileSync(file, next, "utf8");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const html = renderPage(readFixtures());
  for (const outputRoot of [root, path.join(root, "public")]) {
    const target = path.join(outputRoot, "tahmin-ligi.html");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Saat bazlı geri sayım istemcide; sayfa yalnızca maç listesi değişince yeniden yazılır.
    const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (previous !== html) fs.writeFileSync(target, html, "utf8");
  }
  for (const sitemap of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sitemap);
  console.log(`[prediction-league-page] tahmin-ligi.html: ${openFixtures(readFixtures()).length} açık maç`);
}
