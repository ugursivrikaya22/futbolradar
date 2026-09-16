#!/usr/bin/env node
/**
 * ANKET SAYFALARI — HER ANKETİN KENDİ PAYLAŞILABİLİR ADRESİ.
 *
 *   Türkçe:    /anket/<slug.tr>        (dosya: anket/<slug>.html)
 *   İngilizce: /en/poll/<slug.en>      (dosya: en/poll/<slug>.html)
 *
 * ── NEDEN AYRI SAYFA ────────────────────────────────────────────────────
 * Anket ana sayfada da duruyor. Ama paylaşılan bir bağlantının okuyucuyu
 * ana sayfaya bırakması iki şeyi birden bozuyordu: gelen kişi soruyu
 * BULMAK zorundaydı (ana sayfa uzun) ve paylaşılan adres anketin kapanıp
 * sıradakinin açılmasıyla BAŞKA bir anketi gösteriyordu. Kendi adresi olan
 * bir sayfa ikisini de çözüyor: bağlantı hep aynı soruya gidiyor ve sayfa
 * açıldığında ilk görülen şey o soru oluyor.
 *
 * ── SORU GERÇEK İÇERİKTİR, JAVASCRIPT DEĞİL ─────────────────────────────
 * Soru, alt başlık ve seçeneklerin tamamı derleme anında HTML'e basılıyor
 * (`scripts/lib/homePoll.mjs`). Arama motoru ve paylaşım önizlemesi
 * JavaScript'i beklemek zorunda kalmıyor; sayım ise gerçek depodan, istemci
 * tarafından ekleniyor.
 *
 * ── TAKVİMDEKİ HER ANKET SAYFA ALIR, AMA HER SAYFA İNDEKSLENMEZ ─────────
 * Henüz başlamamış bir anketin sayfası da üretiliyor (adres paylaşılmış
 * olabilir, bağlantı 404 vermemeli) ama `noindex` ile: içinde henüz sonuç
 * yok ve arama sonucunda boş bir anket göstermek okuyucuya bir şey vaat
 * edip vermemektir. Açık ve kapanmış anketler indekslenir.
 *
 * ── OG GÖRSELİ SABİT VE MARKALI ─────────────────────────────────────────
 * Sonuçlara göre DEĞİŞEN bir Open Graph görseli üretmek, isteği karşılayan
 * bir sunucusuz işlev ister; Vercel Hobby planındaki 12 işlev sınırı dolu
 * (gerekçe `server/homePollRoute.js` başlığında). Bu yüzden bağlantı
 * önizlemesinde FutbolRadar markalı sabit anket görseli
 * (`assets/og-poll.png`) kullanılıyor. SONUCA ÖZEL GÖRSEL YOK DEĞİL: o
 * görsel oy verildikten sonra tarayıcıda üretiliyor ve paylaşım panelinden
 * doğrudan paylaşılabiliyor (site.js → `drawShareCard`).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { homePollBlock } from "./lib/homePoll.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { listHomePolls, localizePoll, logRejected } = require("../services/homePoll.js");

// Kök normalde deponun kendisi. `POLL_PAGES_ROOT` yalnızca testin bu adımı
// geçici bir ağaçta koşturabilmesi için var: üretilmiş çıktılar (site
// haritası) depoda saatlik derlemenin bıraktığı hâliyle duruyor, test ise
// ADIMIN ÇIKTISINI denetlemek zorunda.
const root = process.env.POLL_PAGES_ROOT
  ? path.resolve(process.env.POLL_PAGES_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-poll.png`;
const today = new Date().toISOString().slice(0, 10);

/** Başlamamış anket indekslenmez; gerekçe dosya başında. */
const ROBOTS_NOINDEX = "noindex, follow";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", relative), "utf8"));
  } catch (error) {
    return fallback;
  }
}

const COPY = {
  tr: {
    lang: "tr",
    ogLocale: "tr_TR",
    kicker: "FutbolRadar Anketi",
    breadcrumbHome: "Ana Sayfa",
    breadcrumbPolls: "Anketler",
    pollsHref: "anketler.html",
    titleSuffix: "FutbolRadar",
    description: "FutbolRadar taraftar anketine katıl, takımını seç ve canlı sonuçları gör.",
    intro: "Takımını seç, oyunu ver ve sonucu sosyal medyada paylaş. Sonuçlar tüm okuyucuların oylarından hesaplanır.",
    statusLabel: { open: "Oylama açık", closed: "Oylama kapandı", upcoming: "Yakında açılıyor" },
    aboutTitle: "Bu anket nasıl işliyor?",
    about: [
      "Seçenekler FutbolRadar takım veritabanından geliyor: ligdeki kulüp değişirse anket kendiliğinden güncellenir.",
      "Her tarayıcı bir kez oy verebilir. Oy sayımı gerçek veritabanından okunur; tahmini sayı gösterilmez.",
      "Bu bölüm okuyucu tahminidir; sitenin doğrulanmış maç verisinden ayrıdır."
    ],
    allPolls: "Tüm anketleri gör",
    // Liste kartındaki bağlantı metni — site.js'teki `openPoll` ile aynı,
    // çünkü istemci aynı kartın üstüne yazıyor.
    openPoll: "Anket sayfasını aç ve paylaş",
    windowOpen: "Oylama bitişi",
    windowClosed: "Kapanış",
    windowUpcoming: "Başlangıç"
  },
  en: {
    lang: "en",
    ogLocale: "en_GB",
    kicker: "FutbolRadar Poll",
    breadcrumbHome: "Home",
    breadcrumbPolls: "Polls",
    pollsHref: "polls.html",
    titleSuffix: "FutbolRadar",
    description: "Join the FutbolRadar fan poll, pick your team and watch the live results.",
    intro: "Pick your team, cast your vote and share the result on social media. Results are calculated from every reader's vote.",
    statusLabel: { open: "Voting open", closed: "Voting closed", upcoming: "Opening soon" },
    aboutTitle: "How this poll works",
    about: [
      "The options come from the FutbolRadar team database: if the league line-up changes, the poll updates itself.",
      "Each browser can vote once. Counts are read from a real database; no estimated numbers are shown.",
      "This section is a reader prediction, separate from the site's verified match data."
    ],
    allPolls: "See every poll",
    openPoll: "Open the poll page and share it",
    windowOpen: "Voting closes",
    windowClosed: "Closed",
    windowUpcoming: "Opens"
  }
};

function formatDate(value, locale) {
  const stamp = Date.parse(value || "");
  if (!Number.isFinite(stamp)) return "";
  return new Date(stamp).toLocaleDateString(locale === "en" ? "en-GB" : "tr-TR", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function breadcrumbHtml(items) {
  const trail = items.map((item, index) => (index === items.length - 1
    ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
    : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a>`)).join(" › ");
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${trail}</nav>`;
}

/**
 * SORU SAYFA BAŞLIĞIDIR.
 *
 * "Anket | FutbolRadar" gibi genel bir başlık, paylaşılan bağlantının
 * önizlemesinde hiçbir şey söylemez. Başlık sorunun kendisi olduğunda hem
 * arama sonucunda hem paylaşım kartında okuyucu neye tıkladığını biliyor.
 */
function titleFor(poll, copy) {
  return `${poll.question} | ${copy.titleSuffix}`;
}

function descriptionFor(poll, copy) {
  const lead = poll.subtitle ? `${poll.subtitle} ` : "";
  return `${lead}${copy.description}`;
}

function pollDocument(entry, locale) {
  const copy = COPY[locale];
  const poll = localizePoll(entry.poll, locale);
  const status = entry.status;
  const canonical = `${siteUrl}${poll.path}`;
  const alternate = `${siteUrl}${localizePoll(entry.poll, locale === "tr" ? "en" : "tr").path}`;
  const trUrl = locale === "tr" ? canonical : alternate;
  const enUrl = locale === "tr" ? alternate : canonical;
  // İKİ AYRI KÖK. `base` SİTE köküne çıkar (varlıklar, başlık/altlık
  // bağlantıları oraya göre kuruluyor); `localeBase` ise DİLİN köküne —
  // İngilizce sayfa `/en/poll/x.html` içinde ve kardeş sayfası
  // `/en/polls.html`. İkisini tek değişkende toplamak, İngilizce anket
  // sayfasının "tüm anketler" bağlantısını kökteki Türkçe listeye
  // göndermek demekti (ve o adres yok — 404).
  const base = locale === "tr" ? "../" : "../../";
  const localeBase = "../";
  // `siteHeader` bağlantının başına `base`i kendisi ekliyor; buradaki değer
  // site KÖKÜNE göredir (diğer üreticilerle aynı sözleşme).
  const altHref = locale === "tr"
    ? `en/poll/${localizePoll(entry.poll, "en").slug}`
    : `anket/${localizePoll(entry.poll, "tr").slug}`;

  const title = titleFor(poll, copy);
  const description = descriptionFor(poll, copy);

  const whenLabel = status === "upcoming"
    ? `${copy.windowUpcoming}: ${formatDate(poll.startsAt, locale)}`
    : `${status === "closed" ? copy.windowClosed : copy.windowOpen}: ${formatDate(poll.endsAt, locale)}`;

  // Başlamamış ankette oy formu basılmaz ("closed" gibi davranır): oy
  // alamayan bir formu basmak, oyu sessizce kaybetmek olurdu.
  const block = homePollBlock(poll, {
    locale,
    status: status === "open" ? "open" : "closed",
    heading: "h1",
    pinned: true,
    containerClass: "poll-page__poll",
    regionLabel: poll.question
  });

  const breadcrumbs = [
    { name: copy.breadcrumbHome, href: localeBase, url: locale === "tr" ? `${siteUrl}/` : `${siteUrl}/en/` },
    { name: copy.breadcrumbPolls, href: `${localeBase}${copy.pollsHref}`, url: `${siteUrl}/${locale === "tr" ? "anketler.html" : "en/polls.html"}` },
    { name: poll.question, href: canonical, url: canonical }
  ];

  const graph = [
    {
      "@type": "WebPage",
      "@id": `${canonical}#page`,
      url: canonical,
      name: title,
      description,
      inLanguage: locale === "en" ? "en" : "tr",
      isPartOf: { "@id": `${siteUrl}/#website` },
      dateModified: today
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((item, index) => ({
        "@type": "ListItem", position: index + 1, name: item.name, item: item.url
      }))
    },
    // SEÇENEKLER MAKİNE OKUNUR BİÇİMDE DE VAR. Oy SAYISI buraya yazılmaz:
    // şema derleme anında üretiliyor ve sayım o an bilinmiyor; bilinmeyen
    // bir sayıyı yapılandırılmış veriye yazmak, arama motoruna uydurma
    // bildirmek olurdu.
    {
      "@type": "ItemList",
      "@id": `${canonical}#options`,
      name: poll.question,
      numberOfItems: poll.options.length,
      itemListElement: poll.options.map((option, index) => ({
        "@type": "ListItem", position: index + 1, name: option.label
      }))
    }
  ];

  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${status === "upcoming" ? ROBOTS_NOINDEX : ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="tr-TR" href="${trUrl}" />
    <link rel="alternate" hreflang="en" href="${enUrl}" />
    <link rel="alternate" hreflang="x-default" href="${trUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${copy.ogLocale}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base, locale, altHref })}
      <main class="poll-page">
        <div class="container">
          ${breadcrumbHtml(breadcrumbs)}
          <header class="poll-page__head">
            <span class="section-kicker">${escapeHtml(copy.kicker)}</span>
            <p class="poll-page__status is-${status}">${escapeHtml(copy.statusLabel[status] || "")} · ${escapeHtml(whenLabel)}</p>
            <p class="poll-page__intro">${escapeHtml(copy.intro)}</p>
          </header>
          ${block}
          <section class="poll-page__about" aria-labelledby="poll-about-title">
            <h2 id="poll-about-title">${escapeHtml(copy.aboutTitle)}</h2>
            <ul>${copy.about.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
            <a class="detail-link" href="${localeBase}${copy.pollsHref}">${escapeHtml(copy.allPolls)}</a>
          </section>
        </div>
      </main>
      ${siteFooter({ base, locale })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function writePage(relativePath, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const destination = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, "utf8");
  }
}

/**
 * ARTIK TAKVİMDE OLMAYAN ANKETİN SAYFASI KALMAZ.
 *
 * Kayıt silinince dosyanın diskte kalması, kendisini hâlâ yayında sanan bir
 * sayfa demek: site haritasından düşer ama adres yaşar ve oy alamayan bir
 * form gösterir. Yalnızca BU betiğin ürettiği dizinler temizlenir.
 */
function pruneStale(directory, keep) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const folder = path.join(outputRoot, directory);
    if (!fs.existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder)) {
      if (!file.endsWith(".html")) continue;
      if (keep.has(file)) continue;
      fs.unlinkSync(path.join(folder, file));
      console.warn(`[poll-pages] takvimde olmayan sayfa kaldırıldı: ${directory}/${file}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* ANKET LİSTESİ SUNUCUDAN DA GELİR                                     */
/* ------------------------------------------------------------------ */
/**
 * SİTE HARİTASINA YAZDIĞIMIZ HER ADRESİN SİTEDE GERÇEK BİR BAĞLANTISI OLMALI.
 *
 * Anket listesi (`anketler.html` / `en/polls.html`) kartları yalnızca
 * istemcide, `/api/home-poll`'dan çiziyordu. Sunucu çıktısında liste
 * kabı BOŞTU — yani site haritası "bu anketi indeksle" derken sitenin
 * kendisi o sayfaya hiçbir yerden bağlanmıyordu. İki sinyal çelişiyor:
 * Google'a "önemli" deyip aynı anda "hiçbir sayfadan bağlanmayacak kadar
 * önemsiz" demek. `scripts/test-seo-integrity.mjs` bu çelişkiyi zaten
 * arıyordu (`en-iyi-defanslar.html` aynı şekilde yakalanmıştı).
 *
 * Çözüm istemciyi kaldırmak değil: sayım ancak gerçek depodan gelir.
 * Kartların SORU + DURUM + BAĞLANTI kısmı derleme anında basılıyor,
 * sayım istemcide üstüne yazılıyor — sitenin geri kalanıyla aynı
 * kademeli geliştirme sözleşmesi.
 *
 * YALNIZCA İNDEKSLENEN anketler basılıyor: liste, site haritasının
 * birebir aynısı olsun diye. Başlamamış anket `noindex` — onu statik
 * listeye koymak, indekslenmesini istemediğimiz bir sayfayı öne
 * çıkarmak olurdu; istemci listesi onu yine de gösteriyor.
 */
const POLL_INDEX_BEGIN = "<!-- POLL-INDEX:BEGIN -->";
const POLL_INDEX_END = "<!-- POLL-INDEX:END -->";

/** İstemcideki `pollCard` ile AYNI sınıflar — CSS tek yerde kalsın. */
function staticPollCard(row, locale) {
  const copy = COPY[locale];
  const status = row.status;
  const when = status === "upcoming"
    ? `${copy.windowUpcoming}: ${formatDate(row.startsAt, locale)}`
    : `${status === "closed" ? copy.windowClosed : copy.windowOpen}: ${formatDate(row.endsAt, locale)}`;

  // SAYIM YOK, YÜZDE DE YOK. Derleme anında oy sayısı bilinmiyor; "%0"
  // basmak veride olmayan bir sayı iddia etmek olurdu (0001_core_schema.sql
  // birinci kuralı). Sayımı istemci gerçek depodan getiriyor.
  return `<article class="poll-archive__card is-${escapeHtml(status)}">`
    + `<div class="poll-archive__head">`
    + `<span class="poll-archive__badge is-${escapeHtml(status)}">${escapeHtml(copy.statusLabel[status] || status)}</span>`
    + (when.endsWith(": ") ? "" : `<span class="poll-archive__when">${escapeHtml(when)}</span>`)
    + `</div>`
    + `<h2 class="poll-archive__question">${escapeHtml(row.question)}</h2>`
    + (row.subtitle ? `<p class="poll-archive__subtitle">${escapeHtml(row.subtitle)}</p>` : "")
    + `<a class="poll-archive__link" href="${escapeHtml(row.path)}">${escapeHtml(copy.openPoll)}</a>`
    + `</article>`;
}

/**
 * Listeyi sayfaya yerleştirir. Kap zaten sayfada (`data-poll-archive-list`);
 * buraya yazmak, istemcinin canlı listeyi AYNI yere çizmesini sağlıyor —
 * ikinci bir liste belirip yinelenen bağlantı üretmiyor.
 *
 * `data-poll-archive-static` işareti istemciye "bu kartlar sunucudan geldi"
 * diyor: ağ hatasında istemci kabı boşaltmıyor (bkz. site.js).
 */
function injectPollIndex(relativePath, locale, rows) {
  const cards = rows.map((row) => staticPollCard(row, locale)).join("");
  let touched = 0;

  for (const outputRoot of [root, path.join(root, "public")]) {
    const file = path.join(outputRoot, relativePath);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");

    // ÖNCE ESKİ ENJEKSİYON SÖKÜLÜR, SONRA YENİSİ YAZILIR.
    //
    // Kabın gövdesini doğrudan kalıpla yakalamak mümkün değil: kartların
    // içinde de `</div>` var, yani "ilk kapanışa kadar" alan bir kalıp
    // ikinci koşuda yarım kart bırakır (ölçüldü). İşaretler arasını
    // silmek bu belirsizliği ortadan kaldırıyor ve adım kaç kez
    // koşarsa koşsun aynı çıktıyı veriyor.
    const stripped = html.replace(
      new RegExp(`${POLL_INDEX_BEGIN}[\\s\\S]*?${POLL_INDEX_END}`, "g"),
      ""
    );

    const emptyListRe = /<div class="poll-archive__list"([^>]*)data-poll-archive-list([^>]*)><\/div>/;
    const match = stripped.match(emptyListRe);
    if (!match) {
      console.warn(`[poll-pages] anket listesi kabı bulunamadı: ${relativePath}`);
      continue;
    }

    const attrs = `${match[1]}data-poll-archive-list${match[2]}`.replace(/\s*data-poll-archive-static/g, "");
    const replacement = `<div class="poll-archive__list"${attrs}${cards ? " data-poll-archive-static" : ""}>`
      + (cards ? `${POLL_INDEX_BEGIN}${cards}${POLL_INDEX_END}` : "")
      + `</div>`;

    // Durum satırı: kartlar sunucudan geldiyse "yükleniyor" yazmak yanlış
    // olurdu — liste zaten ekranda. İstemci hata durumunda kendisi açıyor.
    let next = stripped.replace(emptyListRe, replacement);
    next = next.replace(
      /<p class="poll-archive__status"([^>]*)data-poll-archive-status([^>]*)>/,
      (whole, before, after) => {
        const cleaned = `${before}data-poll-archive-status${after}`.replace(/\s*hidden/g, "");
        return `<p class="poll-archive__status"${cleaned}${cards ? " hidden" : ""}>`;
      }
    );

    if (next !== html) {
      fs.writeFileSync(file, next, "utf8");
      touched += 1;
    }
  }
  return touched;
}

/** Site haritası: yalnızca indekslenen (açık/kapanmış) anketler girer. */
function updateSitemap(file, rows) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const urls = new Map(rows.map((row) => [row.trUrl, row]));
  const existing = (xml.match(URL_ENTRY_RE) || [])
    .filter((entryXml) => ![...urls.keys()].some((url) => entryXml.includes(`<loc>${url}</loc>`)));
  const fresh = [...urls.values()].map((row) =>
    `  <url>\n    <loc>${row.trUrl}</loc>\n` +
    `    <xhtml:link rel="alternate" hreflang="tr-TR" href="${row.trUrl}"/>\n` +
    `    <xhtml:link rel="alternate" hreflang="en" href="${row.enUrl}"/>\n` +
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${row.trUrl}"/>\n` +
    `    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`);
  fs.writeFileSync(file, wrapUrlset([...existing, ...fresh]), "utf8");
}

const sources = {
  polls: readJson("home-polls.json", {}),
  teams: readJson("teams.json", []),
  matches: readJson("matches.json", [])
};

// `surface: "all"` — maç anketleri de kendi paylaşılabilir sayfasını alır.
const { entries, rejected } = listHomePolls(sources, { surface: "all" });
logRejected(rejected);

const keepTr = new Set();
const keepEn = new Set();
const indexed = [];

for (const entry of entries) {
  const trSlug = localizePoll(entry.poll, "tr").slug;
  const enSlug = localizePoll(entry.poll, "en").slug;
  if (!trSlug || !enSlug) continue;

  writePage(path.join("anket", `${trSlug}.html`), pollDocument(entry, "tr"));
  writePage(path.join("en", "poll", `${enSlug}.html`), pollDocument(entry, "en"));
  keepTr.add(`${trSlug}.html`);
  keepEn.add(`${enSlug}.html`);

  if (entry.status !== "upcoming") {
    const tr = localizePoll(entry.poll, "tr");
    const en = localizePoll(entry.poll, "en");
    indexed.push({
      trUrl: `${siteUrl}/anket/${trSlug}`,
      enUrl: `${siteUrl}/en/poll/${enSlug}`,
      // Liste kartının sunum verisi: site haritası satırıyla AYNI
      // kayıttan çıkıyor, böylece ikisi ayrışamaz.
      status: entry.status,
      tr: { question: tr.question, subtitle: tr.subtitle, path: tr.path, startsAt: tr.startsAt, endsAt: tr.endsAt, status: entry.status },
      en: { question: en.question, subtitle: en.subtitle, path: en.path, startsAt: en.startsAt, endsAt: en.endsAt, status: entry.status }
    });
  }
}

pruneStale("anket", keepTr);
pruneStale(path.join("en", "poll"), keepEn);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  updateSitemap(sitemapPath, indexed);
}

// Site haritasına giren her anket, anket listesinden GERÇEKTEN bağlanır.
const linked = injectPollIndex("anketler.html", "tr", indexed.map((row) => row.tr))
  + injectPollIndex(path.join("en", "polls.html"), "en", indexed.map((row) => row.en));

console.log(`[poll-pages] ${entries.length} anket için ${entries.length * 2} sayfa üretildi ` +
  `(${indexed.length} tanesi site haritasında, ${linked} liste sayfasına bağlandı).`);
