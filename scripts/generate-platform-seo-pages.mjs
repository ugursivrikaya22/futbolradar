import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";
const competitions = JSON.parse(fs.readFileSync(path.join(root, "data", "competitions.json"), "utf8"));
const rawMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const cachedMatchesPath = path.join(root, "data", "matches-cache.json");
const cachedMatches = fs.existsSync(cachedMatchesPath) ? JSON.parse(fs.readFileSync(cachedMatchesPath, "utf8")) : [];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "generated-match-pages.json"), "utf8"));
const { dateInTimeZone, dedupeMatches, normalizeCompetition, slugify } = require("../services/matchDataService.js");
const matches = dedupeMatches([...rawMatches, ...cachedMatches]);
const slugById = new Map(manifest.matches.map((item) => [item.id, item.slug]));

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function writeMirrored(relativePath, content) {
  for (const base of [root, path.join(root, "public")]) {
    const destination = path.join(base, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, "utf8");
  }
}

function nav(prefix) {
  return `<header class="topbar"><nav class="container nav" aria-label="Ana menü"><a class="brand" href="${prefix}index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a><button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button><div class="nav-menu" id="primary-menu"><div class="nav-links"><a href="${prefix}maclar/">Bugünkü Maçlar</a><a href="${prefix}canli-skor.html">Canlı Skor</a><a href="${prefix}puan-durumu.html">Puan Durumu</a><a href="${prefix}takimlar.html">Takımlar</a><a href="${prefix}oyuncu-radari.html">Oyuncu Radarı</a><a href="${prefix}momentum.html">Momentum</a></div><a class="cta" href="${prefix}index.html#radar-sinyalleri">Radar Sinyalleri</a></div></nav></header>`;
}

function footer(prefix) {
  return `<footer class="footer"><div class="container footer-links">FutbolRadar · <a href="${prefix}hakkinda.html">Hakkında</a> · <a href="${prefix}veri-metodolojisi.html">Veri Metodolojisi</a> · <a href="${prefix}duzeltme-politikasi.html">Düzeltme Politikası</a> · <a href="${prefix}editorial-politikasi.html">Editoryal Politika</a> · <a href="${prefix}iletisim.html">İletişim</a></div></footer>`;
}

function shell({ title, description, canonical, robots = "index,follow", eyebrow, lead, body, prefix = "./", breadcrumb }) {
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: title, description, url: canonical, isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${domain}/` } },
      { "@type": "BreadcrumbList", itemListElement: breadcrumb.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.url })) }
    ]
  };
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}" /><link rel="canonical" href="${canonical}" /><meta name="robots" content="${robots}" /><meta property="og:type" content="website" /><meta property="og:locale" content="tr_TR" /><meta property="og:site_name" content="FutbolRadar" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${canonical}" /><meta property="og:image" content="${domain}/assets/og-image.svg" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(title)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><script type="application/ld+json">${JSON.stringify(schema)}</script><link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml" /><link rel="manifest" href="${prefix}site.webmanifest" /><link rel="stylesheet" href="${prefix}page.css" /></head><body class="subpage trust-page">${nav(prefix)}<main class="container"><nav class="breadcrumb" aria-label="Sayfa yolu">${breadcrumb.map((item, index) => index === breadcrumb.length - 1 ? `<span>${escapeHtml(item.name)}</span>` : `<a href="${item.local || prefix + "index.html"}">${escapeHtml(item.name)}</a><span>/</span>`).join("")}</nav><section class="hero"><div class="hero-row"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title.replace(/ \| FutbolRadar$/, ""))}</h1><p class="lead">${escapeHtml(lead)}</p></div></div></section>${body}</main>${footer(prefix)}<script src="${prefix}site.js" defer></script><script src="${prefix}app.js" defer></script></body></html>`;
}

function matchRows(records, prefix = "../../") {
  if (!records.length) return `<article class="data-empty"><strong>Doğrulanmış maç kaydı bekleniyor</strong><span>Program sağlayıcıdan doğrulandığında bu turnuvanın maçları burada listelenecek.</span></article>`;
  return `<div class="league-match-grid">${records.map((match) => `<article class="card match-card"><span class="card-kicker">${escapeHtml(match.league)} · ${escapeHtml(match.status)}</span><h2>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</h2><div class="metric-grid compact"><span>Tarih <b>${escapeHtml(dateInTimeZone(match.kickoffAtUtc) || "Bekleniyor")}</b></span><span>Saat <b>${escapeHtml(match.time || "Doğrulanmadı")}</b></span></div><a class="detail-link" href="${prefix}mac/${escapeHtml(slugById.get(match.id))}/">Maç detayını aç</a></article>`).join("")}</div>`;
}

for (const competition of competitions) {
  const competitionMatches = matches.filter((match) => normalizeCompetition(match).id === competition.id);
  const title = `${competition.name} Maçları ve Maç Analizleri | FutbolRadar`;
  const description = `${competition.name} maç programı, TSİ saatleri, skor durumu ve doğrulanmış maç analizleri FutbolRadar'da.`;
  const canonical = `${domain}/turnuva/${competition.slug || competition.id}/`;
  const body = `<section class="section"><div class="section-head"><div class="section-title"><span class="section-kicker">Turnuva merkezi</span><h2>Doğrulanmış program</h2><p>Maçlar yalnızca takım, tarih ve turnuva eşleşmesi doğrulandığında listelenir.</p></div><a class="section-link" href="../../maclar/?league=${escapeHtml(competition.id)}">Tarihe göre tüm maçlar</a></div>${matchRows(competitionMatches)}</section><section class="popular-links" aria-label="İlgili turnuvalar"><span>Diğer turnuvalar</span>${competitions.filter((item) => item.id !== competition.id).slice(0, 5).map((item) => `<a href="../${escapeHtml(item.slug || item.id)}/">${escapeHtml(item.name)}</a>`).join("")}</section>`;
  writeMirrored(path.join("turnuva", competition.slug || competition.id, "index.html"), shell({
    title,
    description,
    canonical,
    robots: competitionMatches.length ? "index,follow" : "noindex,follow",
    eyebrow: "Turnuva radarı",
    lead: `${competition.name} programını canlı skor, güncellik ve maç detaylarıyla tek merkezde takip et.`,
    body,
    prefix: "../../",
    breadcrumb: [
      { name: "Ana Sayfa", url: `${domain}/`, local: "../../index.html" },
      { name: "Turnuvalar", url: `${domain}/maclar/`, local: "../../maclar/" },
      { name: competition.name, url: canonical }
    ]
  }));
}

const trustPages = [
  {
    file: "veri-metodolojisi.html",
    title: "FutbolRadar Veri Metodolojisi | FutbolRadar",
    description: "FutbolRadar maç, saat, yayın, form ve momentum verilerini nasıl doğrular; eksik ve eski kayıtları nasıl gösterir?",
    eyebrow: "Şeffaf veri yaklaşımı",
    lead: "FutbolRadar kesin olmayan bilgiyi kesinmiş gibi sunmaz; veri durumu, güncellik ve analiz kapsamı ayrı ayrı değerlendirilir.",
    body: `<section class="policy-grid"><article class="card"><h2>Maç verisi ve güncellik</h2><p>Sağlayıcı kayıtları ortak şemaya dönüştürülür, temel alanlar doğrulanır ve aynı sağlayıcı maçı tekilleştirilir. Canlı maçlar kısa, fikstür orta süreli cache ile yenilenir.</p></article><article class="card"><h2>Saat dilimi</h2><p>Sağlayıcı zamanları UTC biçiminde saklanır. Kullanıcıya gösterilen tarih ve saat Europe/Istanbul saat dilimine çevrilir ve TSİ etiketiyle sunulur.</p></article><article class="card"><h2>Hazırlık ve turnuva sınıfları</h2><p>Ligler serbest metin yerine canonical turnuva kimliği ve sağlayıcı eşlemesiyle sınıflandırılır. Hazırlık maçları resmî müsabakalardan ayrı tutulur.</p></article><article class="card"><h2>Yayın bilgisi</h2><p>“Yayın bulunmuyor” yalnızca bu durum doğrulandığında kullanılır. Kanal verisi teyit edilmediyse “Yayın bilgisi doğrulanmadı” ifadesi gösterilir.</p></article><article class="card"><h2>Radar ve momentum</h2><p>Model yalnızca mevcut form, hücum, savunma, kadro ve maç bağlamı bileşenlerini kullanır. Eksik metrikler tahminle doldurulmaz; sonuçlar kesin skor vaadi değildir.</p></article><article class="card"><h2>Otomatik ve editoryal içerik</h2><p>Veri tabanlı özetler deterministik kurallarla oluşur. Ayrı editoryal analizlerde yayın ve güncelleme tarihi gösterilir; veri bulunmadığında yorum üretilmez.</p></article></section>`
  },
  {
    file: "duzeltme-politikasi.html",
    title: "Düzeltme Politikası | FutbolRadar",
    description: "FutbolRadar maç, takım, oyuncu ve transfer verilerindeki düzeltme taleplerini nasıl değerlendirir ve günceller?",
    eyebrow: "Doğruluk ve hesap verebilirlik",
    lead: "Yanlış veya güncelliğini kaybetmiş bir kayıt bildirildiğinde kaynak, zaman ve değişiklik kapsamı birlikte incelenir.",
    body: `<section class="policy-grid"><article class="card"><h2>Bildirim</h2><p>Düzeltme talebinde sayfa adresi, hatalı görünen alan ve mümkünse resmî kaynak bağlantısı iletilmelidir.</p><a class="detail-link" href="./iletisim.html">İletişim kanalını aç</a></article><article class="card"><h2>İnceleme</h2><p>Takım, tarih, skor ve transfer kayıtları birincil veya yetkili kaynakla karşılaştırılır. Çelişkili bilgi kesin kayıt olarak yayınlanmaz.</p></article><article class="card"><h2>Güncelleme</h2><p>Doğrulanan düzeltme veri kaydına, ilgili statik sayfaya ve güncellik zamanına birlikte uygulanır. Önemli değişiklikler sayfanın son kontrol alanına yansır.</p></article></section>`
  },
  {
    file: "editorial-politikasi.html",
    title: "Editoryal Politika | FutbolRadar",
    description: "FutbolRadar veri analizi, otomatik özet, kaynak kullanımı ve tahmin dili için uygulanan editoryal ilkeler.",
    eyebrow: "Analiz ilkeleri",
    lead: "FutbolRadar haber kopyalamak yerine doğrulanmış veriyi açık, temkinli ve yeniden üretilebilir bir yöntemle yorumlar.",
    body: `<section class="policy-grid"><article class="card"><h2>Kaynak ve özgünlük</h2><p>Maç ve transfer iddiaları doğrulanabilir kaynağa dayanır. Başka yayınların metni kopyalanmaz; veriden özgün ve kısa analiz üretilir.</p></article><article class="card"><h2>Tahmin dili</h2><p>“Garanti”, “kesin kazanır” veya benzeri yanıltıcı ifadeler kullanılmaz. Model çıktıları veri kapsamı ve belirsizlikle birlikte sunulur.</p></article><article class="card"><h2>Otomasyon</h2><p>Otomatik özetler eksik alanları uydurmaz. Kalite eşiğini geçmeyen sayfalar indeks dışı tutulur ve sitemap'e eklenmez.</p></article></section>`
  }
];

for (const page of trustPages) {
  writeMirrored(page.file, shell({
    ...page,
    canonical: `${domain}/${page.file}`,
    body: page.body,
    breadcrumb: [
      { name: "Ana Sayfa", url: `${domain}/`, local: "./index.html" },
      { name: page.title.replace(/ \| FutbolRadar$/, ""), url: `${domain}/${page.file}` }
    ]
  }));
}

const turkishTeams = ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Başakşehir", "Samsunspor", "Göztepe"];
const europeanMatches = matches.filter((match) => match.competition && match.competition.country === "UEFA" && turkishTeams.some((team) => match.homeTeam === team || match.awayTeam === team));
writeMirrored("turk-takimlari-avrupada.html", shell({
  title: "Türk Takımları Avrupa'da: Maçlar ve Sonuçlar | FutbolRadar",
  description: "Türk takımlarının Şampiyonlar Ligi, Avrupa Ligi ve Konferans Ligi maçları, TSİ saatleri ve maç detayları.",
  canonical: `${domain}/turk-takimlari-avrupada.html`,
  robots: europeanMatches.length ? "index,follow" : "noindex,follow",
  eyebrow: "Avrupa maç merkezi",
  lead: "Türk temsilcilerinin UEFA karşılaşmalarını aynı doğrulanmış maç akışında takip et.",
  body: `<section class="section"><div class="section-head"><div class="section-title"><span class="section-kicker">Temsilciler</span><h2>Avrupa programı</h2><p>Yalnızca turnuva ve takım eşleşmesi doğrulanan kayıtlar gösterilir.</p></div></div>${matchRows(europeanMatches, "./")}</section><section class="popular-links"><span>UEFA turnuvaları</span><a href="./turnuva/sampiyonlar-ligi/">Şampiyonlar Ligi</a><a href="./turnuva/avrupa-ligi/">Avrupa Ligi</a><a href="./turnuva/konferans-ligi/">Konferans Ligi</a></section>`,
  breadcrumb: [
    { name: "Ana Sayfa", url: `${domain}/`, local: "./index.html" },
    { name: "Türk Takımları Avrupa'da", url: `${domain}/turk-takimlari-avrupada.html` }
  ]
}));

console.log(`Generated ${competitions.length} competition hubs and ${trustPages.length + 1} trust/discovery pages`);
