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

const root = process.cwd();
const require = createRequire(import.meta.url);
const { publicPlayerView } = require("../services/cardCredibility.js");
const { mergeSuperLigTeams } = require("../services/superLigTeams.js");

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

const EXTRA_PAGES = [
  { href: "index.html", title: "Ana Sayfa", subtitle: "Canlı skor ve maç merkezi" },
  { href: "mac-merkezi.html", title: "Maç Merkezi", subtitle: "Tüm maç ekranları" },
  // Arama niyeti sayfaları: site içi aramada da bulunabilmeliler, yoksa
  // yalnızca Google üzerinden erişilen sayfalar olarak kalırlar.
  { href: "gunluk-mac-analizleri.html", title: "Günlük Maç Analizleri", subtitle: "Bugünün maçları ve radar okuması" },
  { href: "super-lig-mac-analizleri.html", title: "Süper Lig Maç Analizleri", subtitle: "Maç önü okuma ve raporlar" },
  { href: "super-lig-form-durumu.html", title: "Süper Lig Form Durumu", subtitle: "18 takımın son maç serisi" },
  { href: "galatasaray-form-durumu.html", title: "Galatasaray Form Durumu", subtitle: "Son maç serisi ve momentum" },
  { href: "fenerbahce-form-durumu.html", title: "Fenerbahçe Form Durumu", subtitle: "Son maç serisi ve momentum" },
  { href: "besiktas-form-durumu.html", title: "Beşiktaş Form Durumu", subtitle: "Son maç serisi ve momentum" },
  { href: "trabzonspor-form-durumu.html", title: "Trabzonspor Form Durumu", subtitle: "Son maç serisi ve momentum" },
  { href: "oyuncu-karsilastirmalari.html", title: "Oyuncu Karşılaştırmaları", subtitle: "İki oyuncuyu kıyasla" },
  { href: "takim-trendleri.html", title: "Takım Trendleri", subtitle: "Form ve momentum" },
  { href: "oyuncu-trendleri.html", title: "Oyuncu Trendleri", subtitle: "Yükselen oyuncular" },
  { href: "hakkinda.html", title: "Hakkında", subtitle: "FutbolRadar nedir" },
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

for (const link of [...NAV_PRIMARY, ...NAV_SECONDARY]) {
  push({ type: "page", badge: "SYF", href: link.href, title: link.label, subtitle: "FutbolRadar sayfası" });
}

for (const page of EXTRA_PAGES) {
  push({ type: "page", badge: "SYF", href: page.href, title: page.title, subtitle: page.subtitle });
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
  const href = `oyuncular/${player.id}.html`;
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
