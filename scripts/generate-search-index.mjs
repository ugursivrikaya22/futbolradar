/**
 * SİTE İÇİ ARAMA DİZİNİ
 * ----------------------------------------------------------------------------
 * Neden: üst çubuktaki arama kutusunun bir hedefi olmalı. Sunucu tarafı arama
 * eklemek yeni bir serverless fonksiyon demekti (Vercel Hobby'de 12 fonksiyon
 * sınırı dolmak üzere). Bunun yerine derleme sırasında küçük, statik bir dizin
 * üretilir; istemci onu bir kez indirip yerelde eşleştirir.
 *
 * Dizin yalnızca gerçekten var olan sayfaları içerir: kırık öneri üretmez.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { NAV_PRIMARY, NAV_SECONDARY } from "./lib/layout.mjs";
import { STANDINGS_LEAGUES, TR_PAGE_ORDER, EN_PAGE_ORDER } from "./lib/standingsCatalog.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { publicPlayerView } = require("../services/cardCredibility.js");
/**
 * Oyuncu adresleri tek çözücüden okunur. Kimlikten yol türetmek, oyuncu
 * tam isimli adrese taşındığı anda var olmayan bir dosyaya işaret ediyor.
 */
const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const { mergeSuperLigTeams, slug: teamSlug } = require("../services/superLigTeams.js");
const { publishedColumns } = require("../services/columnService.js");
const { ROUTES: I18N_ROUTES, routeMeta } = require("../services/i18n.js");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
  } catch {
    return null;
  }
}

function asArray(payload, ...keys) {
  if (Array.isArray(payload)) {
    return payload;
  }
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) {
      return payload[key];
    }
  }
  return [];
}

/**
 * İNGİLİZCE SAYFALAR DA DİZİNDE — LİSTE ROTA EŞLEMESİNDEN TÜRER.
 *
 * Dizin yalnızca Türkçe sayfaları taşıyordu ve İngilizce başlıkta arama
 * kutusu bu yüzden hiç açılmıyordu. Kutu artık iki dilde de var (layout.mjs),
 * dolayısıyla İngilizce sayfaların da aranabilir olması gerekiyor — yoksa
 * İngilizce okuyucu kendi dilindeki sayfayı arayıp bulamazdı.
 *
 * Liste ELLE TUTULMUYOR: `services/i18n.js` içindeki rota eşlemesinden
 * okunuyor. Elle tutulan bir kopya, ileride eklenen her İngilizce rotanın
 * aranamaz kalması demekti — nitekim rota sayısı 6'dan 17'ye çıktığında
 * kopya bir anda eskimişti.
 *
 * Takım ve oyuncu kayıtları ikinci kez çoğaltılmaz. Var olan İngilizce
 * profilleri aynı kayıttaki kısa `enHref` alanıyla arama diline bağlanır.
 */
const EN_PAGES = I18N_ROUTES.map((route) => {
  const meta = routeMeta(route.key, "en");
  return {
    href: route.en,
    // Başlıktaki " | FutbolRadar" kuyruğu sonuç satırında gereksiz gürültü.
    title: String(meta.title || "").split(" | ")[0],
    subtitle: String(meta.description || "").split(". ")[0]
  };
});

const EXTRA_PAGES = [
  { href: "index.html", title: "Ana Sayfa", subtitle: "Canlı skor ve maç merkezi" },
  { href: "mac-sonuclari.html", title: "Maç Sonuçları", subtitle: "Doğrulanmış tamamlanan maçlar" },
  { href: "mac-merkezi.html", title: "Maç Merkezi", subtitle: "Tüm maç ekranları" },
  { href: "oyuncu-karsilastirmalari.html", title: "Oyuncu Karşılaştırmaları", subtitle: "İki oyuncuyu kıyasla" },
  { href: "takim-trendleri.html", title: "Takım Trendleri", subtitle: "Form ve momentum" },
  { href: "oyuncu-trendleri.html", title: "Oyuncu Trendleri", subtitle: "Yükselen oyuncular" },
  { href: "hakkinda.html", title: "Hakkında", subtitle: "FutbolRadar nedir" },
  { href: "x-hesaplari.html", title: "Futbol X Hesapları", subtitle: "Doğrulanmış X hesapları" },
  { href: "iletisim.html", title: "İletişim", subtitle: "Bize ulaşın" },
  { href: "veri-notu.html", title: "Veri Notu", subtitle: "Kaynak ve doğrulama" }
];

const items = [];
const seen = new Set();

function push(entry) {
  if (!entry || !entry.href || seen.has(entry.href)) {
    return;
  }
  if (!fs.existsSync(path.join(root, entry.href.split("?")[0].split("#")[0]))) {
    return;
  }
  seen.add(entry.href);
  items.push(entry);
}

function existingHref(href) {
  return fs.existsSync(path.join(root, href)) ? href : undefined;
}

for (const link of [...NAV_PRIMARY, ...NAV_SECONDARY]) {
  push({ type: "page", badge: "SYF", href: link.href, title: link.label, subtitle: "FutbolRadar sayfası" });
}

for (const page of EXTRA_PAGES) {
  push({ type: "page", badge: "SYF", href: page.href, title: page.title, subtitle: page.subtitle });
}

// İngilizce sayfalar KENDİ TİPİYLE girer ("enPage", rozet "EN"). Türkçe
// sayfalarla aynı rozeti taşısalardı, Türkçe bir sayfada arayan okuyucu
// tıkladığında habersizce İngilizce bir sayfaya düşerdi; rozet hedefin
// dilini tıklamadan önce söyler.
for (const page of EN_PAGES) {
  push({ type: "enPage", badge: "EN", href: page.href, title: page.title, subtitle: page.subtitle, locale: "en" });
}

// Lig sayfaları da katalogdan türer (bucket'ı dolu her kayıt bir sayfa
// aldı, bkz. generate-league-pages.mjs). Dosya gerçekten var mı diye
// ayrıca kontrol edilir: kimliği çözülmemiş bir lig için de sayfa
// üretilir ama competitions.json'da bucket'ı olmayan (hazırlık maçı gibi)
// kayıtlar hiç dizine girmez.
for (const competition of asArray(readJson("competitions.json"))) {
  if (!competition || !competition.bucket || !competition.id) continue;
  const href = `lig/${competition.id}.html`;
  if (!fs.existsSync(path.join(root, href))) continue;
  push({
    type: "league",
    badge: "LİG",
    href,
    title: competition.name,
    subtitle: competition.country || "Lig sayfası"
  });
}

// Puan durumu sayfaları (bkz. scripts/lib/standingsCatalog.mjs): on TR
// sayfa + dokuz EN sayfa. Süper Lig TR sayfası önceden var olan
// `super-lig-puan-durumu.html`, kalanını generate-league-standings-
// pages.mjs üretir; EN'in tamamı generate-en-league-standings-pages.mjs'ten.
// TR tarafı sekme sırasını değil SAYFA sırasını okur: 1. Lig'in sayfası
// var, ana sayfa sekmesi yok.
for (const id of TR_PAGE_ORDER) {
  const entry = STANDINGS_LEAGUES[id];
  const href = `${entry.slugTr}.html`;
  if (!fs.existsSync(path.join(root, href))) continue;
  push({ type: "page", badge: "SYF", href, title: `${entry.nameTr} Puan Durumu`, subtitle: "Güncel puan durumu" });
}
for (const id of EN_PAGE_ORDER) {
  const entry = STANDINGS_LEAGUES[id];
  const href = `en/${entry.slugEn}.html`;
  if (!fs.existsSync(path.join(root, href))) continue;
  push({ type: "enPage", badge: "EN", href, title: `${entry.nameEn} Standings`, subtitle: "Current standings", locale: "en" });
}

for (const article of asArray(readJson("news.json"), "news", "items")) {
  if (!article || String(article.status || "").toLowerCase() !== "verified" || !article.slug || !article.title || !Array.isArray(article.body)) {
    continue;
  }
  push({
    type: "news",
    badge: "HBR",
    href: `haber/${article.slug}.html`,
    title: article.title,
    subtitle: article.spot || article.summary || "FutbolRadar haberi"
  });
}

const { columns } = publishedColumns(readJson("columns.json") || {});
const indexedAuthors = new Set();
for (const column of columns) {
  push({
    type: "column",
    badge: "KÖŞE",
    href: column.path,
    title: column.title,
    subtitle: [column.author, column.categoryLabel].filter(Boolean).join(" · ") || "Köşe Yazısı"
  });

  if (!indexedAuthors.has(column.authorPath)) {
    indexedAuthors.add(column.authorPath);
    push({
      type: "author",
      badge: "YZR",
      href: column.authorPath,
      title: column.author,
      subtitle: "FutbolRadar yazarı"
    });
  }
}

// Takım kapsamı elle tutulan listeyle sınırlı kalmaz: TFF fikstüründe adı
// geçen her takım bu sezon ligdedir ve aranabilir olmalıdır. Daha önce dizin
// yalnızca teams.json'daki beş takımı içerdiği için "Göztepe" ve "Konyaspor"
// aramaları sıfır sonuç veriyordu.
const curatedTeams = asArray(readJson("teams.json"), "teams");
for (const team of mergeSuperLigTeams(curatedTeams)) {
  if (!team || !team.name) {
    continue;
  }
  push({
    type: "team",
    badge: "TKM",
    href: `takim-detay.html?team=${encodeURIComponent(team.name)}`,
    enHref: existingHref(`en/team/${teamSlug(team.name)}.html`),
    title: team.name,
    subtitle: team.league || "Takım profili"
  });
}

// Takım sayfası sorgu parametresiyle çalıştığı için varlık kontrolünü ayrıca
// yapamıyoruz; hedef dosyanın kendisi kontrol edilir.
const teamPageExists = fs.existsSync(path.join(root, "takim-detay.html"));
if (!teamPageExists) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].type === "team") {
      items.splice(index, 1);
    }
  }
}

for (const player of asArray(readJson("players.json"), "players")) {
  if (!player || !player.id || !player.name) {
    continue;
  }
  const href = playerUrls.playerCanonicalHref(player.id, "");
  // Arama sonucu altyazısı da bir KULÜP İDDİASIDIR. Denetimde burada
  // "Serbest oyuncu · Santrfor" ve "Schalke 04 · Santrfor" yazıyordu —
  // doğrulanmamış kayıtlar için sonuç listesinde beyan edilmiş kulüpler.
  // Doğrulanmamış kayıtta yalnızca mevki gösteriliyor; oyuncu aranabilir
  // kalıyor, ama hakkında doğrulanmamış bir iddia taşınmıyor.
  const verified = publicPlayerView(player).verified;
  const club = verified ? (player.team || player.club || "") : "";
  const position = player.position || player.role || "";
  push({
    type: "player",
    badge: "OYN",
    href,
    enHref: existingHref(playerUrls.enPlayerPagePath(player.id)),
    title: player.name,
    subtitle: [club, position].filter(Boolean).join(" · ") || "Oyuncu profili"
  });
}

const payload = JSON.stringify(items);

for (const target of [path.join(root, "search-index.json"), path.join(root, "public", "search-index.json")]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, payload, "utf8");
}

const counts = items.reduce((accumulator, entry) => {
  accumulator[entry.type] = (accumulator[entry.type] || 0) + 1;
  return accumulator;
}, {});

console.log(
  `Search index: ${items.length} entries (${Object.entries(counts)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ")})`
);
