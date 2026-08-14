#!/usr/bin/env node
/**
 * İKİ DİLLİ SÜRÜM — SÖZLEŞME DENETİMİ.
 *
 * İki dilli bir sitede sessizce bozulan şeyler her zaman aynıdır ve hiçbiri
 * gözle fark edilmez:
 *
 *   • Dil kutusu var olmayan bir sayfaya bağlanır (404).
 *   • hreflang tek yönlü kalır; Google alternate ilişkisini tamamen yok sayar.
 *   • İngilizce sayfanın canonical'ı Türkçe sayfayı gösterir; İngilizce
 *     sürüm indeksten düşer.
 *   • Aynı içerik iki URL'de birden yayımlanır (kopya).
 *   • İngilizce sayfada Türkçe arayüz metni kalır.
 *   • Sözlükte bir anahtar bir dilde eksiktir; kullanıcı ham anahtarı görür.
 *
 * Bu dosya altısını da mekanik olarak sınar. Ağ gerekmez; üretilmiş
 * dosyalar okunur.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DOMAIN,
  LOCALES,
  NAV_KEYS,
  ROUTES,
  absoluteUrl,
  competitionLabel,
  counterpartPath,
  dictionary,
  formatDate,
  htmlLang,
  localeOfPath,
  routeMeta,
  statusLabelFor,
  t
} = require("../services/i18n.js");

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

console.log("i18n");

// --- 1. Sözlük eşliği ------------------------------------------------------
{
  const keys = LOCALES.map((locale) => Object.keys(dictionary(locale)));
  const [trKeys, enKeys] = keys;
  const missingInEn = trKeys.filter((key) => !enKeys.includes(key));
  const missingInTr = enKeys.filter((key) => !trKeys.includes(key));
  check("her anahtar iki dilde de var", !missingInEn.length && !missingInTr.length,
    `en'de yok: ${missingInEn.join(", ") || "-"} | tr'de yok: ${missingInTr.join(", ") || "-"}`);

  const emptyValues = LOCALES.flatMap((locale) =>
    Object.entries(dictionary(locale)).filter(([, value]) => !String(value).trim()).map(([key]) => `${locale}:${key}`));
  check("boş çeviri yok", !emptyValues.length, emptyValues.join(", "));

  // Bilinmeyen anahtar sessizce Türkçeye düşmemeli.
  check("bilinmeyen anahtar anahtarın kendisini döndürür", t("does.not.exist", "en") === "does.not.exist");
}

// --- 2. Rota eşlemesi ------------------------------------------------------
{
  const missing = ROUTES.flatMap((route) => [route.tr, route.en]).filter((file) => !read(file));
  check("eşlemedeki her sayfa gerçekten üretilmiş", !missing.length, missing.join(", "));

  const trPaths = ROUTES.map((route) => route.tr);
  const enPaths = ROUTES.map((route) => route.en);
  check("kopya Türkçe yol yok", new Set(trPaths).size === trPaths.length);
  check("kopya İngilizce yol yok", new Set(enPaths).size === enPaths.length);
  check("her İngilizce yol /en/ altında", enPaths.every((value) => value.startsWith("en/")), enPaths.join(", "));

  const roundTrip = ROUTES.every((route) =>
    counterpartPath(route.tr, "en") === route.en && counterpartPath(route.en, "tr") === route.tr);
  check("eşleme iki yönde de tutarlı", roundTrip);

  check("locale yol üzerinden doğru okunur",
    localeOfPath("en/standings.html") === "en" && localeOfPath("puan-durumu.html") === "tr" &&
    localeOfPath("oyuncular/mauro-icardi.html") === "tr");

  check("karşılığı olmayan sayfa null döner", counterpartPath("oyuncular/mauro-icardi.html", "en") === null);
}

// --- 3. İngilizce sayfaların SEO başlığı -----------------------------------
for (const route of ROUTES) {
  const html = read(route.en);
  if (!html) continue;
  const name = route.key;

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  check(`${name}: canonical kendi İngilizce URL'i`, canonical === absoluteUrl(route.en),
    `${canonical} != ${absoluteUrl(route.en)}`);

  const alternates = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
    .map((match) => ({ lang: match[1], href: match[2] }));
  const en = alternates.find((row) => row.lang === "en");
  const tr = alternates.find((row) => row.lang === "tr-TR");
  const xdefault = alternates.find((row) => row.lang === "x-default");
  check(`${name}: hreflang üçlüsü tam`, Boolean(en && tr && xdefault),
    alternates.map((row) => row.lang).join(", "));
  check(`${name}: hreflang hedefleri doğru`,
    en && en.href === absoluteUrl(route.en) && tr && tr.href === absoluteUrl(route.tr),
    JSON.stringify(alternates));

  check(`${name}: <html lang="en">`, /<html lang="en">/.test(html));
  check(`${name}: dil kutusu Türkçe karşılığa gider`,
    html.includes(`class="lang-switch" href="../${route.tr}"`) || (route.tr === "index.html" && html.includes('class="lang-switch" href="../index.html"')),
    (html.match(/class="lang-switch" href="[^"]*"/) || [])[0]);

  const meta = routeMeta(route.key, "en");
  check(`${name}: başlık İngilizce metadata'dan`, html.includes(`<title>${meta.title.replace(/'/g, "&#039;")}</title>`),
    (html.match(/<title>[^<]*<\/title>/) || [])[0]);
}

// --- 4. hreflang Türkçe tarafta da var mı (karşılıklılık) ------------------
for (const route of ROUTES) {
  const html = read(route.tr);
  if (!html) continue;
  const hasEn = html.includes(`<link rel="alternate" hreflang="en" href="${absoluteUrl(route.en)}" />`);
  const hasTr = html.includes(`<link rel="alternate" hreflang="tr-TR" href="${absoluteUrl(route.tr)}" />`);
  check(`${route.tr}: karşılıklı hreflang`, hasEn && hasTr, `en=${hasEn} tr=${hasTr}`);

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  check(`${route.tr}: canonical İngilizceyi göstermiyor`, !String(canonical || "").includes("/en/") && canonical !== `${DOMAIN}/en`,
    String(canonical));
}

// --- 5. İngilizce sayfalarda Türkçe arayüz metni kalmamalı ------------------
{
  // Türkçeye özgü, İngilizcede geçmesi mümkün olmayan işaretler. Takım ve
  // stat adları hariç tutuluyor: "Beşiktaş" İngilizce sayfada da Beşiktaş'tır.
  const TURKISH_UI_MARKERS = [
    "Bugünün Maçları", "Canlı Skor", "Puan Durumu", "Takımlar", "Analizler",
    "Maç Sonuçları", "Köşe Yazıları", "Arşiv", "Tümünü Gör", "Menüyü aç",
    "Gizlilik", "Kullanım Şartları", "Hakkında", "Veri Notu", "Sosyal medya",
    "Ana menü", "Koyu Tema", "Devre arası", "Başlamadı", "Tamamlandı",
    "Ertelendi", "İptal edildi", "Hükmen"
  ];

  for (const route of ROUTES) {
    const html = read(route.en);
    if (!html) continue;
    // Dil kutusunun aria etiketi bilinçli olarak Türkçedir ("Türkçeye geç"):
    // kullanıcıyı gideceği dile kendi dilinde çağırır. Denetim dışında.
    const body = html.replace(/<a class="lang-switch"[\s\S]*?<\/a>/g, "");
    const found = TURKISH_UI_MARKERS.filter((marker) => body.includes(marker));
    check(`${route.en}: Türkçe arayüz metni yok`, !found.length, found.join(", "));
  }
}

// --- 6. İngilizce menü: var olan sayfalar, işaretli Türkçe hedefler --------
//
// KURAL DEĞİŞTİ VE SEBEBİ ÖNEMLİ. Menü daha önce YALNIZCA İngilizce rotalara
// bağlanabiliyordu; sonuç, İngilizce okuyucunun maç sonuçlarına, köşe
// yazılarına, arşive ve istatistik yüzeylerine üst çubuktan HİÇ
// ulaşamamasıydı. Bağlantıyı hiç vermemek, Türkçe hedefe götürmekten daha
// kötü bir sonuç.
//
// Yeni kural iki şartlı: hedef ya İngilizce bir rotadır, YA DA `trOnly`
// işaretlidir. İşaretli bağlantı okuyucuya hangi dile gittiğini tıklamadan
// önce söyler (`hreflang="tr"` + etikette "(TR)"). İşaretsiz Türkçe hedef
// hâlâ hatadır: sessizce dil değiştiren bağlantı, kırık bağlantı kadar kötü.
{
  const enNav = [...NAV_KEYS.en.primary, ...NAV_KEYS.en.secondary];
  const broken = enNav.filter((item) => !read(item.href)).map((item) => item.href);
  check("İngilizce menüde kırık bağlantı yok", !broken.length, broken.join(", "));

  const enPaths = new Set(ROUTES.map((route) => route.en));
  const unmarked = enNav
    .filter((item) => !enPaths.has(item.href) && !item.trOnly)
    .map((item) => item.href);
  check("İngilizce menüde işaretsiz Türkçe hedef yok", !unmarked.length, unmarked.join(", "));

  // Ters yön de kapalı: İngilizce karşılığı OLAN bir sayfa "(TR)" diye
  // işaretlenirse okuyucu İngilizce sürümü varken Türkçesine gönderilir.
  const mislabelled = enNav
    .filter((item) => item.trOnly && enPaths.has(item.href))
    .map((item) => item.href);
  check("İngilizce karşılığı olan sayfa (TR) diye işaretlenmemiş", !mislabelled.length, mislabelled.join(", "));

  // İşaret İŞARETLEMEYE de yansımalı: dil bilgisi yalnızca veri katmanında
  // kalırsa okuyucu ve arama motoru onu göremez.
  const enHome = read("en/index.html");
  if (enHome) {
    for (const item of enNav.filter((entry) => entry.trOnly)) {
      const pattern = new RegExp(`href="[^"]*${item.href.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"[^>]*hreflang="tr"`);
      check(`en/index.html: ${item.href} bağlantısı hreflang="tr" taşıyor`, pattern.test(enHome));
    }
    check("en/index.html: Türkçe hedefler (TR) etiketi taşıyor", enHome.includes("(TR)</a>"));
  }
}

// --- 7. Türkçe sayfalarda dil kutusu var mı --------------------------------
{
  const samples = ["index.html", "takimlar.html", "oyuncular/mauro-icardi.html", "404.html"];
  for (const sample of samples) {
    const html = read(sample);
    if (!html) continue;
    check(`${sample}: dil kutusu var`, html.includes('class="lang-switch"'));
  }

  // Karşılığı olmayan derin sayfa İngilizce ana sayfaya düşmeli, 404'e değil.
  const deep = read("oyuncular/mauro-icardi.html");
  if (deep) {
    check("karşılığı olmayan sayfa /en/ girişine düşer",
      deep.includes('class="lang-switch" href="../en/index.html"'),
      (deep.match(/class="lang-switch" href="[^"]*"/) || [])[0]);
  }
}

// --- 8. Biçimleme ----------------------------------------------------------
{
  const stamp = "2026-08-10T18:30:00+03:00";
  check("tarih İngilizcede ay adıyla", formatDate(stamp, "en") === "10 August 2026", formatDate(stamp, "en"));
  check("tarih Türkçede ay adıyla", formatDate(stamp, "tr").includes("Ağustos"), formatDate(stamp, "tr"));
  check("maç durumu İngilizce", statusLabelFor("FINISHED", "en") === "Full Time" && statusLabelFor("HALFTIME", "en") === "Half Time");
  check("maç durumu Türkçe", statusLabelFor("FINISHED", "tr") === "Tamamlandı");
  check("turnuva adı çevrilir", competitionLabel("Avrupa Ligi", "en") === "UEFA Europa League" &&
    competitionLabel("Friendlies Clubs", "en") === "Club Friendlies");
  check("tanınmayan turnuva olduğu gibi kalır", competitionLabel("Copa Libertadores", "en") === "Copa Libertadores");
  // "Primera División" tek bir ülkeye ait değil; LaLiga'ya eşlenirse
  // Uruguay ve Venezuela maçları İspanya ligi gibi etiketlenir.
  check("belirsiz lig adı uydurulmuş bir lige eşlenmez",
    competitionLabel("Primera División", "en") === "Primera División" &&
    competitionLabel("Primera Division", "en") === "Primera Division",
    `${competitionLabel("Primera División", "en")} / ${competitionLabel("Primera Division", "en")}`);
  check("html lang değerleri", htmlLang("en") === "en" && htmlLang("tr") === "tr");
}

// --- 9. Site haritası ------------------------------------------------------
{
  const sitemap = read("sitemap.xml");
  if (sitemap) {
    check("site haritası xhtml ad alanını bildiriyor",
      !sitemap.includes("<xhtml:link") || sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));

    const missing = ROUTES.filter((route) => !sitemap.includes(`<loc>${absoluteUrl(route.en)}</loc>`))
      .map((route) => route.en);
    check("İngilizce sayfalar site haritasında", !missing.length, missing.join(", "));

    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    check("site haritasında kopya URL yok", new Set(locs).size === locs.length,
      `${locs.length} girdi, ${new Set(locs).size} tekil`);
  }
}

// --- 10. Vercel yönlendirmeleri --------------------------------------------
{
  const vercel = JSON.parse(read("vercel.json") || "{}");
  const rewrites = new Map((vercel.rewrites || []).map((row) => [row.source, row.destination]));
  const expected = ROUTES.map((route) => {
    const clean = route.en === "en/index.html" ? "/en" : `/${route.en.replace(/\.html$/, "")}`;
    return [clean, `/${route.en}`];
  });
  const wrong = expected.filter(([source, destination]) => rewrites.get(source) !== destination)
    .map(([source]) => source);
  check("her İngilizce rota için temiz URL yönlendirmesi var", !wrong.length, wrong.join(", "));
}

if (failures.length) {
  console.error(`\ni18n FAILED (${failures.length}):`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log("\ni18n passed");
}
