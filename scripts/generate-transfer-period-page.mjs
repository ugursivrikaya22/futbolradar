#!/usr/bin/env node
/**
 * /transfer-donemi-2026-27 — ARA TRANSFER DÖNEMİ VE TRANSFER YASAKLARI SAYFASI.
 *
 * Kalıcı adres; içerik tek bir veri dosyasından gelir:
 * data/transfer-donemi-2026-27.json (tescil dönemi tarihleri, FIFA tescil
 * yasağı listesinin tarihli anlık görüntüsü, Hatayspor notu). Her satır kendi
 * kaynağını taşır; kaynak bağlantısı olmayan iddia basılmaz. Ana sayfadaki
 * Transfer Gündemi bandının transfer öğeleri (data/ticker.json) buraya bağlanır.
 *
 * Postprocess zincirinde koşar (scripts/lib/postprocessChain.mjs); çıktı yalnızca
 * içerik değişince yazılır. Sitemap girdisi tahmin-ligi deseniyle eklenir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const SLUG = "transfer-donemi-2026-27";
const CANONICAL = `${siteUrl}/${SLUG}`;
const socialImage = `${siteUrl}/assets/og-image.png`;
const DATA_FILE = path.join(root, "data", `${SLUG}.json`);

export const PAGE_TITLE = "Ara Transfer Dönemi Ne Zaman? Transfer Yasağı Olan Takımlar 2026-27";
export const PAGE_H1 = "Ara transfer dönemi ne zaman? 2026-27 tarihleri ve transfer yasağı olan takımlar";
export const PAGE_DESCRIPTION = "Süper Lig'de ara transfer dönemi 1 Ocak – 5 Şubat 2027. FIFA tescil yasağı listesindeki Eyüpspor, Antalyaspor, Fatih Karagümrük ve diğer kulüpler.";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const DAY = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" });
const STAMP = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
/** "2026-10-15" → "15 Ekim 2026" (gün kayması olmasın diye öğlen İstanbul saati). */
const dayLabel = (iso) => DAY.format(new Date(`${iso}T12:00:00+03:00`));
const periodsLabel = (value) => (String(value) === "Until lifted" ? "Kaldırılıncaya kadar" : `${value} dönem`);
const sourceLink = (url, name) => `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(name)}</a>`;

export function readData(file = DATA_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function faqEntries(data) {
  const [summer, winter] = data.windows;
  const superLig = data.bans.clubs.filter((row) => row.league === "Süper Lig").map((row) => row.club);
  const firstLeague = data.bans.clubs.filter((row) => row.league === "1. Lig").map((row) => row.club);
  return [
    ["Ara transfer dönemi ne zaman?", `Süper Lig'de 2026-27 sezonunun ara (2.) transfer ve tescil dönemi ${dayLabel(winter.opens)}'de başlıyor, ${dayLabel(winter.closes)}'de sona eriyor. Tarihleri TFF Yönetim Kurulu 14 Mayıs 2026'da belirledi.`],
    ["Yaz transfer dönemi ne zaman kapandı?", `Süper Lig'de yaz (1.) transfer ve tescil dönemi ${dayLabel(summer.opens)}'da açıldı, ${dayLabel(summer.closes)}'te kapandı.`],
    ["Transfer yasağı olan takımlar hangileri?", `FIFA'nın tescil yasağı listesinde (${STAMP.format(new Date(data.bans.snapshotAt))} itibarıyla) Süper Lig'den ${superLig.join(" ve ")}, 1. Lig'den ${firstLeague.join(", ")} yer alıyor. Liste 6 saatte bir güncellenir; güncel durum için FIFA'nın kendi listesine bakın.`],
    ["\"3 dönem transfer yasağı\" ne demek?", "FIFA tescil yasağı süresince kulüp yeni oyuncu tescil ettiremez. \"3 dönem\" yasağın üç tescil dönemi boyunca sürebileceğini, \"kaldırılıncaya kadar\" ise süresiz olduğunu gösterir. Yasağa yol açan dosya çözülürse FIFA yasağı süresi dolmadan kaldırabilir."],
    ["Avrupa'da yaz transfer dönemi ne zaman kapandı?", `Premier Lig, LaLiga, Serie A, Bundesliga ve Ligue 1'de yaz transfer dönemi ${dayLabel(data.europe.summerClosed)}'de kapandı. Premier Lig'de kış penceresi ${dayLabel(data.europe.premierLeagueWinterOpens)} – ${dayLabel(data.europe.premierLeagueWinterCloses)} arasında açık.`]
  ];
}

export function renderPage(data) {
  const [summer, winter] = data.windows;
  const faq = faqEntries(data);
  const snapshot = STAMP.format(new Date(data.bans.snapshotAt));
  const modified = STAMP.format(new Date(data.dateModified));
  const fifa = sourceLink(data.bans.sourceUrl, data.bans.sourceName);
  const eyup = data.bans.clubs.find((row) => row.club === "Eyüpspor") || {};

  const banRows = data.bans.clubs.map((row) => {
    const press = row.pressUrl ? ` · ${sourceLink(row.pressUrl, row.pressName)}` : "";
    const note = row.note ? `<br /><small>${escapeHtml(row.note)}</small>` : "";
    return `<tr><th scope="row">${escapeHtml(row.club)}${note}</th><td>${escapeHtml(row.league)}</td><td><time datetime="${escapeHtml(row.latestStart)}">${escapeHtml(dayLabel(row.latestStart))}</time></td><td>${escapeHtml(periodsLabel(row.latestPeriods))}</td><td>${escapeHtml(String(row.entries))}</td><td>${sourceLink(data.bans.sourceUrl, "FIFA")}${press}</td></tr>`;
  }).join("\n                ");

  const windowRows = data.windows.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td><time datetime="${escapeHtml(row.opens)}">${escapeHtml(dayLabel(row.opens))}</time></td><td><time datetime="${escapeHtml(row.closes)}">${escapeHtml(dayLabel(row.closes))}</time></td><td>${sourceLink(row.sourceUrl, row.sourceName)}</td></tr>`).join("\n                ");

  const graph = [
    {
      "@type": "Article",
      "@id": `${CANONICAL}#article`,
      headline: PAGE_H1,
      description: PAGE_DESCRIPTION,
      inLanguage: "tr-TR",
      datePublished: data.datePublished,
      dateModified: data.dateModified,
      author: { "@type": "Organization", name: "FutbolRadar", url: `${siteUrl}/` },
      publisher: { "@type": "Organization", name: "FutbolRadar", url: `${siteUrl}/`, logo: { "@type": "ImageObject", url: `${siteUrl}/favicon-512x512.png` } },
      image: socialImage,
      mainEntityOfPage: CANONICAL,
      url: CANONICAL,
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${siteUrl}/` }
    },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Transfer", item: `${siteUrl}/super-lig-transferleri-2026-2027.html` },
      { "@type": "ListItem", position: 3, name: "Transfer Dönemi 2026-27", item: CANONICAL }
    ] },
    { "@type": "FAQPage", mainEntity: faq.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) }
  ];

  const related = [
    ["./super-lig-transferleri-2026-2027.html", "Süper Lig transferleri 2026-2027"],
    ["./transfer-sezonu-ne-zaman-bitiyor.html", "Transfer sezonu ne zaman bitiyor?"],
    ["./super-lig-puan-durumu", "Süper Lig puan durumu"],
    ["./1-lig-puan-durumu", "1. Lig puan durumu"],
    ["./eyupspor-puan-durumu", "Eyüpspor puan durumu"],
    ["./haberler.html", "Son futbol haberleri"]
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
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <meta property="og:image" content="${socialImage}" />
    <meta property="article:published_time" content="${escapeHtml(data.datePublished)}" />
    <meta property="article:modified_time" content="${escapeHtml(data.dateModified)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./page.css" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="evergreen-page" id="transfer-donemi">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><a href="./super-lig-transferleri-2026-2027.html">Transfer</a><span aria-hidden="true">/</span><span aria-current="page">Transfer Dönemi 2026-27</span></nav>
          <header class="evergreen-hero">
            <span class="section-kicker">Transfer · 2026-27 sezonu</span>
            <h1>${escapeHtml(PAGE_H1)}</h1>
            <p>Süper Lig'de yaz transfer dönemi ${escapeHtml(dayLabel(summer.closes))}'te kapandı. <strong>Ara transfer dönemi ${escapeHtml(dayLabel(winter.opens))}'de açılıyor, ${escapeHtml(dayLabel(winter.closes))}'de kapanıyor.</strong> FIFA'nın tescil yasağı listesinde ise Süper Lig'den Eyüpspor ve Gaziantep FK, 1. Lig'den Antalyaspor ve Fatih Karagümrük dahil birçok Türk kulübü var.</p>
            <p class="evergreen-freshness">Son güncelleme: <time datetime="${escapeHtml(data.dateModified)}">${escapeHtml(modified)}</time> TSİ · Yasak tablosu: FIFA listesinin ${escapeHtml(snapshot)} TSİ görüntüsü.</p>
          </header>

          <section class="evergreen-section" id="tarihler" aria-labelledby="tarihler-baslik">
            <h2 id="tarihler-baslik">Süper Lig transfer dönemi tarihleri (2026-27)</h2>
            <div class="evergreen-table-wrap">
              <table class="evergreen-table"><caption>TFF tescil dönemleri</caption>
                <thead><tr><th scope="col">Dönem</th><th scope="col">Açılış</th><th scope="col">Kapanış</th><th scope="col">Kaynak</th></tr></thead>
                <tbody>
                ${windowRows}
                </tbody>
              </table>
            </div>
            <p class="evergreen-note">TFF Yönetim Kurulu tarihleri 14 Mayıs 2026 toplantısında belirledi. Ara dönem bitiş tarihi 5 Şubat 2027 (Cuma). Ayrıntılı geri sayım: <a href="./transfer-sezonu-ne-zaman-bitiyor.html">Transfer sezonu ne zaman bitiyor?</a></p>
          </section>

          <section class="evergreen-section" id="yasaklar" aria-labelledby="yasaklar-baslik">
            <h2 id="yasaklar-baslik">Transfer yasağı olan takımlar (FIFA tescil yasağı listesi)</h2>
            <p>Tablo, FIFA tescil yasağı listesinin ${escapeHtml(snapshot)} TSİ görüntüsündeki Türkiye kayıtlarından ligi FutbolRadar puan durumu verisiyle doğrulanan kulüpleri gösterir (kaynak: ${fifa}). "Süre", kulübün listedeki en yeni kaydının süresidir. Bir kulübün birden fazla kaydı olabilir; yasak, kayıtların hepsi kalkana kadar sürer.</p>
            <div class="evergreen-table-wrap">
              <table class="evergreen-table"><caption>FIFA tescil yasağı listesindeki Türk kulüpleri</caption>
                <thead><tr><th scope="col">Kulüp</th><th scope="col">Lig</th><th scope="col">En yeni kayıt başlangıcı</th><th scope="col">Süre</th><th scope="col">Kayıt sayısı</th><th scope="col">Kaynak</th></tr></thead>
                <tbody>
                ${banRows}
                </tbody>
              </table>
            </div>
            <p class="evergreen-note">Nisan 2026'dan bu yana listeye yeni kayıt eklenen diğer kulüpler (lig bilgisi bu sayfada doğrulanmadı): ${escapeHtml(data.bans.otherClubs.join(", "))}. FIFA listesi 6 saatte bir güncellenir; yasağa yol açan dosya çözülürse kayıt süresi dolmadan kalkabilir.</p>
          </section>

          <section class="evergreen-section" id="eyupspor" aria-labelledby="eyupspor-baslik">
            <h2 id="eyupspor-baslik">Eyüpspor: 15 Ekim'den geçerli 3 dönem yasak</h2>
            <p>FIFA listesine göre Eyüpspor için 15 Ekim 2026 başlangıçlı, 3 dönemlik bir tescil yasağı kaydı var; listede ayrıca 25 Ağustos 2026 başlangıçlı ve "kaldırılıncaya kadar" süren ikinci bir kayıt bulunuyor (${fifa}${eyup.pressUrl ? `, ${sourceLink(eyup.pressUrl, eyup.pressName)}` : ""}). Yasak kalkmazsa kulüp ocak ayındaki ara dönemde yeni oyuncu tescil ettiremez. Eyüpspor, 19 Ekim 2026 itibarıyla Süper Lig'de 8 maçta 3 puanla son sırada (<a href="./super-lig-puan-durumu">puan durumu</a>).</p>
          </section>

          <section class="evergreen-section" id="hatayspor" aria-labelledby="hatayspor-baslik">
            <h2 id="hatayspor-baslik">Hatayspor: yasak Ocak 2026'da kalkmıştı, yeniden listede</h2>
            <p>Hatayspor'un FIFA kaynaklı yasağı Ocak 2026'da, 2025-26 sezonunun ara döneminde kaldırılmış ve kulüp o dönemde 10 transfer yapmıştı (${sourceLink(data.hatayspor.pastLiftedSourceUrl, `${data.hatayspor.pastLiftedSourceName}, ${dayLabel(data.hatayspor.pastLiftedDate)}`)}). Bu bilgi geçen sezona ait. FIFA listesinde (${fifa}) Hatayspor için 23 Şubat – 18 Eylül 2026 arasında başlayan 12 yeni kayıt var; en yenisinin süresi "kaldırılıncaya kadar". Yani Hatayspor'un tescil yasağı bugün yürürlükte.</p>
          </section>

          <section class="evergreen-section" id="avrupa" aria-labelledby="avrupa-baslik">
            <h2 id="avrupa-baslik">Avrupa'nın büyük liglerinde transfer dönemi</h2>
            <p>Premier Lig, LaLiga, Serie A, Bundesliga ve Ligue 1'de yaz transfer dönemi ${escapeHtml(dayLabel(data.europe.summerClosed))}'de kapandı. Premier Lig'de kış penceresi ${escapeHtml(dayLabel(data.europe.premierLeagueWinterOpens))}'de açılıp ${escapeHtml(dayLabel(data.europe.premierLeagueWinterCloses))}'de kapanacak (${sourceLink(data.europe.sourceUrl, data.europe.sourceName)}).</p>
          </section>

          <section class="evergreen-section" id="sss" aria-labelledby="sss-baslik">
            <h2 id="sss-baslik">Sık sorulanlar</h2>
            ${faq.map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("\n            ")}
          </section>

          <aside class="evergreen-related" aria-labelledby="transfer-related"><h2 id="transfer-related">Transfer ve puan durumu</h2><div class="evergreen-link-grid">${related.map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`).join("")}</div></aside>
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
  </body>
</html>\n`;
}

function updateSitemap(file, lastmod) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`<loc>${CANONICAL}</loc>`));
  const fresh = `  <url>\n    <loc>${CANONICAL}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  const next = wrapUrlset([...existing, fresh]);
  if (next !== xml) fs.writeFileSync(file, next, "utf8");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const data = readData();
  const html = renderPage(data);
  for (const outputRoot of [root, path.join(root, "public")]) {
    const target = path.join(outputRoot, `${SLUG}.html`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (previous !== html) fs.writeFileSync(target, html, "utf8");
  }
  // lastmod = içeriğin gerçek değişim tarihi (dateModified), derleme günü değil.
  const lastmod = String(data.dateModified).slice(0, 10);
  for (const sitemap of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sitemap, lastmod);
  console.log(`[transfer-period-page] ${SLUG}.html yazıldı (${data.bans.clubs.length} yasaklı kulüp satırı)`);
}
