#!/usr/bin/env node
/**
 * İNGİLİZCE LİG VE KULÜP GİRİŞ SAYFALARI TESTİ.
 *
 * Bu sayfaların arızaları SESSİZDİR: sayfa render olur, tarayıcıda düzgün
 * görünür, yalnızca Google onu kopya sayar ya da hiç indekslemez. Üç şey
 * kontrol ediliyor:
 *
 *   1. KAPSAM — kataloğdaki her kaydın gerçekten bir dosyası var ve o dosya
 *      hem kökte hem `public/` aynasında.
 *   2. İNDEKSLENEBİLİRLİK — canonical kendini gösteriyor, `noindex` yok,
 *      hreflang çifti KARŞILIKLI (tek yönlü bildirim Google'ca yok sayılır)
 *      ve adres site haritasında.
 *   3. DİL SAFLIĞI — İngilizce sayfadan Türkçe bir sayfaya iç bağlantı yok
 *      (dil düğmesi ve hreflang hariç; onların işi zaten diğer dile gitmek).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EN_CLUB_HUBS, EN_LEAGUE_HUBS } from "./lib/enHubCatalog.mjs";

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
const HUBS = [...EN_LEAGUE_HUBS, ...EN_CLUB_HUBS];

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}: ${error.message}`);
  }
}

const sitemap = fs.existsSync(path.join(root, "sitemap.xml"))
  ? fs.readFileSync(path.join(root, "sitemap.xml"), "utf8")
  : "";

console.log("en-hubs");

for (const hub of HUBS) {
  const enPath = `en/${hub.slugEn}.html`;
  const enFile = path.join(root, enPath);
  const label = `/${enPath}`;

  check(`${label} üretilmiş (kök + public aynası)`, () => {
    assert.ok(fs.existsSync(enFile), `${enPath} yok`);
    assert.ok(fs.existsSync(path.join(root, "public", enPath)), `public/${enPath} yok`);
  });

  if (!fs.existsSync(enFile)) continue;
  const html = fs.readFileSync(enFile, "utf8");

  check(`${label} İngilizce ve indekslenebilir`, () => {
    assert.match(html, /<html lang="en"/, 'lang="en" yok');
    assert.doesNotMatch(html, /content="[^"]*noindex/i, "noindex bulundu");
    assert.match(
      html,
      new RegExp(`<link rel="canonical" href="${DOMAIN}/${enPath}"`),
      "canonical kendini göstermiyor"
    );
  });

  check(`${label} hreflang çifti KARŞILIKLI`, () => {
    const trUrl = `${DOMAIN}/${hub.trPath}`;
    const enUrl = `${DOMAIN}/${enPath}`;
    assert.ok(html.includes(`hreflang="en" href="${enUrl}"`), "EN sayfada kendi alternate'i yok");
    assert.ok(html.includes(`hreflang="tr-TR" href="${trUrl}"`), "EN sayfada TR alternate'i yok");

    const trFile = path.join(root, hub.trPath);
    assert.ok(fs.existsSync(trFile), `Türkçe karşılık yok: ${hub.trPath}`);
    const trHtml = fs.readFileSync(trFile, "utf8");
    assert.ok(trHtml.includes(`hreflang="en" href="${enUrl}"`), `TR sayfa geri bildirmiyor: ${hub.trPath}`);
  });

  check(`${label} tek bir alternate kümesi taşıyor`, () => {
    // İki küme, aynı ilişkiyi Google'a iki kez bildirmek demek.
    const count = (html.match(/<link rel="alternate" hreflang="en"/g) || []).length;
    assert.equal(count, 1, `${count} adet hreflang="en" etiketi var, 1 olmalı`);
  });

  check(`${label} site haritasında`, () => {
    assert.ok(sitemap.includes(`<loc>${DOMAIN}/${enPath}</loc>`), "sitemap.xml içinde yok");
  });

  check(`${label} İngilizce başlık ve açıklama taşıyor`, () => {
    assert.ok(html.includes(`<title>${hub.title}</title>`), "başlık katalogla uyuşmuyor");
    assert.ok(html.includes(hub.description), "açıklama katalogla uyuşmuyor");
    // Türkçeden çeviri değil, İngilizce arama terimi: başlık bunu taşımalı.
    assert.match(hub.title, /Fixtures|Results|Standings|Table|Live Scores|News/i);
  });

  check(`${label} yapılandırılmış veri geçerli JSON`, () => {
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(match, "JSON-LD bloğu yok");
    const graph = JSON.parse(match[1].replaceAll("\\u003c", "<"))["@graph"];
    assert.ok(Array.isArray(graph) && graph.length >= 2, "@graph eksik");
    assert.ok(graph.some((node) => node["@type"] === "BreadcrumbList"), "BreadcrumbList yok");
    assert.ok(graph.some((node) => node["@type"] === "CollectionPage"), "CollectionPage yok");
  });

  check(`${label} İngilizce okuyucuyu Türkçe sayfaya göndermiyor`, () => {
    // Sayfa /en/<slug>.html adresinde: "./x.html" İngilizce tarafta kalır,
    // "../en/x.html" da öyle. "../x.html" ise KÖKTEKİ Türkçe sayfadır.
    //
    // Dil düğmesi (data-lang-switch) bilerek dışarıda: onun İŞİ diğer dile
    // gitmek. <head> içindeki alternate etiketleri de gövde taranarak zaten
    // kapsam dışında kalıyor.
    const body = html.slice(html.indexOf("<body"));
    // Bağlantıyı SARAN etiketin tamamına bakılıyor: `data-lang-switch`
    // özniteliği `href`ten SONRA geliyor, dolayısıyla yalnızca öncesine
    // bakan bir pencere dil düğmesini kaçırır ve onu ihlal sanardı.
    const offenders = [...body.matchAll(/<a\b[^>]*href="(\.\.\/[^"#]*\.html)"[^>]*>/g)]
      .filter((match) => !match[0].includes("data-lang-switch"))
      .map((match) => match[1])
      .filter((href) => !href.startsWith("../en/"));
    assert.deepEqual([...new Set(offenders)], [], `Türkçe hedefli iç bağlantı: ${[...new Set(offenders)].join(", ")}`);
  });
}

check("kataloğda yinelenen İngilizce adres yok", () => {
  const slugs = HUBS.map((hub) => hub.slugEn);
  assert.equal(new Set(slugs).size, slugs.length, "yinelenen slugEn var");
});

check("kataloğda yinelenen Türkçe karşılık yok", () => {
  // Bir Türkçe sayfanın iki İngilizce karşılığı olamaz: rota eşlemesi
  // `tr → en` yönünde tek girişlidir, ikinci kayıt birincisini EZER ve
  // hreflang çifti sessizce tek yönlü kalır.
  const trPaths = HUBS.map((hub) => hub.trPath);
  assert.equal(new Set(trPaths).size, trPaths.length, "yinelenen trPath var");
});

check("hub'ların Türkçe karşılıkları başka bir EN sayfaya bağlı değil", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(root, "data", "en-route-map.json"), "utf8"));
  for (const hub of HUBS) {
    const owners = rows.filter((row) => row.tr === hub.trPath);
    assert.equal(
      owners.length,
      1,
      `${hub.trPath} ${owners.length} EN sayfa tarafından sahipleniliyor: ${owners.map((row) => row.en).join(", ")}`
    );
  }
});

if (failures) {
  console.error(`\nen-hubs FAILED (${failures})`);
  process.exitCode = 1;
} else {
  console.log(`\nen-hubs passed (${HUBS.length} sayfa)`);
}
