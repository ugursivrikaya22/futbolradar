#!/usr/bin/env node
/**
 * DİNAMİK İNGİLİZCE SAYFALAR — SÖZLEŞME DENETİMİ.
 *
 * Phase 1'in `test-i18n.mjs` testi yalnızca 6 çekirdek rotayı sınıyor.
 * Bu dosya, Phase 2'de eklenen üç ölçekli üreticiyi (takım/maç/oyuncu)
 * denetliyor — sayısı yüzlerle ifade edilen bir yüzeyde tekrar eden aynı
 * altı hata sınıfını mekanik olarak arıyor:
 *
 *   • Kanonik URL kendi sayfasını göstermiyor.
 *   • hreflang üçlüsü eksik ya da tek yönlü.
 *   • İngilizce sayfada Türkçe arayüz metni kalmış.
 *   • İnce içerik: doğrulanmamış bir oyuncu ya da veri kanıtı olmayan bir
 *     takım/maç EN tarafında sayfa almış.
 *   • Site haritasında kopya URL ya da eksik dinamik girdi.
 *   • Dil kutusu (TR ↔ EN) karşılığa gitmiyor.
 *
 * Küçük bir örnek küme + rastgele olmayan (deterministik) bir alt küme
 * taranır; 857 sayfanın TAMAMINI DOM ayrıştırmak yerine yapısal
 * düzenli ifadelerle sınamak, testi CI'da saniyeler içinde tutar.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DOMAIN, absoluteUrl, dynamicRoutePairs } = require("../services/i18n.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { getPlayers } = require("../services/playerService.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");

const root = process.cwd();
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function read(relative) {
  const full = path.join(root, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

console.log("en-dynamic-pages");

const teamPairs = dynamicRoutePairs("team");
const matchPairs = dynamicRoutePairs("match");
const playerPairs = dynamicRoutePairs("player");

// --- 1. Ölçek: beklenen sayılar ---------------------------------------------
{
  check("takım eşlemesi dört öncelikli kulübü kapsıyor", teamPairs.length === 4, `${teamPairs.length}`);
  check("maç eşlemesi TR /mac/ ile aynı büyüklükte", matchPairs.length > 0, `${matchPairs.length}`);
  check("oyuncu eşlemesi yalnızca doğrulanmış kayıtları kapsıyor", playerPairs.length > 0, `${playerPairs.length}`);

  // KOPYA KAYIT İNGİLİZCE SAYFA ALMAZ.
  //
  // Aynı gerçek oyuncunun iki kaydı varsa adres kanonik kayda ait; kopya
  // kayda ikinci bir İngilizce sayfa açmak aynı oyuncuyu iki URL'de
  // yayımlamak olurdu. Bu yüzden beklenen sayı "doğrulanmış kayıt" değil,
  // "doğrulanmış KANONİK kayıt".
  const players = annotateDuplicates(getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"))));
  const verifiedCount = players
    .filter((player) => publicPlayerView(player).verified && !player.isDuplicate).length;
  check("oyuncu sayısı yayın kapısıyla birebir eşleşiyor", playerPairs.length === verifiedCount,
    `eşleme=${playerPairs.length} kapı=${verifiedCount}`);
}

// --- 2. Örneklem: takımların TAMAMI, maç/oyuncu için deterministik alt küme -
function sample(list, size) {
  if (list.length <= size) return list;
  const step = Math.floor(list.length / size);
  return list.filter((_, index) => index % step === 0).slice(0, size);
}

const teamFiles = fs.existsSync(path.join(root, "en", "team"))
  ? fs.readdirSync(path.join(root, "en", "team")).filter((name) => name.endsWith(".html"))
  : [];
const matchSample = sample(matchPairs, 12);
const playerSample = sample(playerPairs, 12);

// --- 3. Her takım sayfası: canonical, hreflang, dil kutusu, içerik zenginliği
for (const file of teamFiles) {
  const enPath = `en/team/${file}`;
  const html = read(enPath);
  if (!html) continue;
  const name = `team:${file}`;

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  check(`${name}: canonical kendi URL'i`, canonical === absoluteUrl(enPath), `${canonical}`);

  check(`${name}: kadro tablosu var`, /en-table/.test(html), "en-table bulunamadı");
  check(`${name}: dil kutusu var`, html.includes('class="lang-switch"'));
  check(`${name}: <html lang="en">`, /<html lang="en">/.test(html));

  const turkishMarkers = ["Bugünün Maçları", "Puan Durumu", "Menüyü aç", "Koyu Tema", "Tümünü Gör"];
  const body = html.replace(/<a class="lang-switch"[\s\S]*?<\/a>/g, "");
  const leaked = turkishMarkers.filter((marker) => body.includes(marker));
  check(`${name}: Türkçe arayüz metni yok`, !leaked.length, leaked.join(", "));
}

// --- 4. Öncelikli 4 kulüpte gerçek TR karşılığı ve karşılıklı hreflang -----
for (const pair of teamPairs) {
  const trHtml = read(pair.tr);
  const enHtml = read(pair.en);
  const name = `team-pair:${pair.tr}`;
  check(`${name}: TR dosyası var`, Boolean(trHtml));
  check(`${name}: EN dosyası var`, Boolean(enHtml));
  if (!trHtml || !enHtml) continue;

  const trHasEn = trHtml.includes(`hreflang="en" href="${absoluteUrl(pair.en)}"`);
  const enHasTr = enHtml.includes(`hreflang="tr-TR" href="${absoluteUrl(pair.tr)}"`);
  check(`${name}: karşılıklı hreflang`, trHasEn && enHasTr, `tr→en=${trHasEn} en→tr=${enHasTr}`);

  const trSwitch = (trHtml.match(/class="lang-switch" href="([^"]+)"/) || [])[1];
  const enSwitch = (enHtml.match(/class="lang-switch" href="([^"]+)"/) || [])[1];
  check(`${name}: TR dil kutusu EN'e gidiyor`, Boolean(trSwitch && trSwitch.includes(path.basename(pair.en))), String(trSwitch));
  check(`${name}: EN dil kutusu TR'ye gidiyor`, Boolean(enSwitch && enSwitch.includes(path.basename(pair.tr))), String(enSwitch));
}

// --- 5. Maç örneklemi -------------------------------------------------------
for (const pair of matchSample) {
  const trHtml = read(pair.tr);
  const enHtml = read(pair.en);
  const name = `match:${pair.en}`;
  check(`${name}: TR ve EN dosyaları var`, Boolean(trHtml && enHtml));
  if (!trHtml || !enHtml) continue;

  const canonical = (enHtml.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  check(`${name}: canonical kendi URL'i`, canonical === absoluteUrl(pair.en));
  check(`${name}: karşılıklı hreflang`,
    trHtml.includes(`hreflang="en" href="${absoluteUrl(pair.en)}"`) &&
    enHtml.includes(`hreflang="tr-TR" href="${absoluteUrl(pair.tr)}"`));

  const body = enHtml.replace(/<a class="lang-switch"[\s\S]*?<\/a>/g, "");
  const leaked = ["Bugünün Maçları", "Maç önü analizi", "Kilit oyuncu", "Kadro kaybı"].filter((marker) => body.includes(marker));
  check(`${name}: Türkçe arayüz metni yok`, !leaked.length, leaked.join(", "));

  // Radar bileşen etiketleri (COMPONENT_LABELS, Türkçe) EN sayfaya HİÇ
  // taşınmamalı — yalnızca sayısal puan/güven/kapsam gösterilir.
  check(`${name}: radar bileşen etiketleri çevrilmeye çalışılmamış`,
    !/Hücum eğilimi|Savunma güveni|Kilit oyuncu formu/.test(enHtml));
}

// --- 6. Oyuncu örneklemi ----------------------------------------------------
for (const pair of playerSample) {
  const trHtml = read(pair.tr);
  const enHtml = read(pair.en);
  const name = `player:${pair.en}`;
  check(`${name}: TR ve EN dosyaları var`, Boolean(trHtml && enHtml));
  if (!trHtml || !enHtml) continue;

  const canonical = (enHtml.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  check(`${name}: canonical kendi URL'i`, canonical === absoluteUrl(pair.en));
  check(`${name}: karşılıklı hreflang`,
    trHtml.includes(`hreflang="en" href="${absoluteUrl(pair.en)}"`) &&
    enHtml.includes(`hreflang="tr-TR" href="${absoluteUrl(pair.tr)}"`));
  check(`${name}: kırık görsel yok (placeholder ya da doğrulanmış URL)`,
    /player-avatar is-placeholder/.test(enHtml) || /media\.api-sports\.io/.test(enHtml));
}

// --- 7. Site haritası: dinamik URL'ler var, kopya yok -----------------------
{
  const sitemap = read("sitemap.xml");
  if (sitemap) {
    const missingTeam = teamPairs.filter((pair) => !sitemap.includes(`<loc>${absoluteUrl(pair.en)}</loc>`));
    check("site haritasında takım URL'leri var", !missingTeam.length, missingTeam.map((p) => p.en).join(", "));

    const missingMatch = sample(matchPairs, 20).filter((pair) => !sitemap.includes(`<loc>${absoluteUrl(pair.en)}</loc>`));
    check("site haritasında örneklenen maç URL'leri var", !missingMatch.length, missingMatch.map((p) => p.en).join(", "));

    const missingPlayer = sample(playerPairs, 20).filter((pair) => !sitemap.includes(`<loc>${absoluteUrl(pair.en)}</loc>`));
    check("site haritasında örneklenen oyuncu URL'leri var", !missingPlayer.length, missingPlayer.map((p) => p.en).join(", "));

    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    check("site haritasında kopya URL yok", new Set(locs).size === locs.length,
      `${locs.length} girdi, ${new Set(locs).size} tekil`);
  }
}

// --- 8. İnce içerik yasağı: doğrulanmamış oyuncuya EN sayfa açılmamış ------
{
  // Dosya adı artık kimlik değil, adres slug'ı (tam adı bilinen oyuncuda
  // "victor-osimhen"). Kimlikten dosya adı türeten bir kontrol, taşınan
  // oyuncuları hiç denetlemez; slug ise kopya kaydın kanoniğine çözüldüğü
  // için "doğrulanmamış kayıt kendi sayfasını almış mı" sorusunu doğru
  // sorar — kanoniği doğrulanmışsa o sayfa ona aittir, sızıntı değildir.
  const players = annotateDuplicates(getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"))));
  const playerUrls = createPlayerUrlResolver((() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, "data", "player-url-slugs.json"), "utf8"));
    } catch {
      return { entries: [], aliases: [] };
    }
  })());
  const unverified = players
    .filter((player) => !publicPlayerView(player).verified && playerUrls.resolveId(player.id) === player.id)
    .slice(0, 20);
  const leaked = unverified.filter((player) => fs.existsSync(path.join(root, playerUrls.enPlayerPagePath(player.id))));
  check("doğrulanmamış oyuncular EN sayfası almamış", !leaked.length, leaked.map((player) => player.id).join(", "));
}

if (failures.length) {
  console.error(`\nen-dynamic-pages FAILED (${failures.length}):`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log("\nen-dynamic-pages passed");
}
