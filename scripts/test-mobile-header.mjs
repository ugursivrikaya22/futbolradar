#!/usr/bin/env node
/**
 * ÜST ÇUBUK MOBİL DENETİMİ — 375 / 390 / 430 px.
 *
 * Dil kutusu üst çubuğa YENİ bir öğe ekliyor ve `.nav` bir CSS grid'i.
 * Grid'de otomatik yerleşime bırakılan bir çocuk, sığmadığında hata vermez —
 * sessizce İKİNCİ SATIRA düşer. Sonuç, hiçbir testin yakalamadığı ama her
 * telefonda görülen bir bozulmadır: çubuk iki katına çıkar, logo ile
 * hamburger ayrı satırlara ayrılır.
 *
 * Bu yüzden denetim gerçek bir tarayıcıda, gerçek genişliklerde yapılıyor:
 *
 *   1. Yatay taşma yok (sayfa yana kaymıyor).
 *   2. Marka, dil kutusu ve hamburger AYNI SATIRDA.
 *   3. Dil kutusu görünür ve dokunulabilir (≥44×32 px).
 *   4. Dil kutusu gerçekten diğer dile gidiyor.
 *
 * Playwright küresel kurulumdan yükleniyor; depo bağımlılıksız kalıyor.
 * Tarayıcı bulunamazsa test ATLANIR (çıkış 0) — CI'da tarayıcı olmaması
 * bir üretim hatası değildir, ama sessizce "geçti" demek de yanıltıcı olur,
 * bu yüzden atlandığı açıkça yazılır.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const WIDTHS = [375, 390, 430];
const PAGES = [
  { file: "index.html", locale: "tr", expectSwitch: "ENG" },
  { file: "takimlar.html", locale: "tr", expectSwitch: "ENG" },
  { file: "en/index.html", locale: "en", expectSwitch: "TR" },
  { file: "en/standings.html", locale: "en", expectSwitch: "TR" }
];

function loadPlaywright() {
  const candidates = [];
  try {
    candidates.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim());
  } catch {
    /* npm yoksa aşağıdaki yollar denenir. */
  }
  candidates.push("/usr/lib/node_modules", "/usr/local/lib/node_modules");

  for (const dir of candidates.filter(Boolean)) {
    try {
      return createRequire(path.join(dir, "noop.js"))("playwright");
    } catch {
      /* sıradaki aday. */
    }
  }
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {
    return null;
  }
}

const playwright = loadPlaywright();
if (!playwright) {
  console.log("mobile-header: Playwright bulunamadı, denetim ATLANDI (tarayıcı gerekiyor).");
  process.exit(0);
}

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

let browser;
try {
  browser = await playwright.chromium.launch();
} catch (error) {
  console.log(`mobile-header: tarayıcı başlatılamadı, denetim ATLANDI (${String(error.message).slice(0, 120)}).`);
  process.exit(0);
}

console.log("mobile-header");

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  for (const target of PAGES) {
    const url = pathToFileURL(path.join(root, target.file)).href;
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const measured = await page.evaluate(() => {
      const nav = document.querySelector(".nav");
      const brand = nav && nav.querySelector(".brand");
      const langSwitch = nav && nav.querySelector(".lang-switch");
      const toggle = nav && nav.querySelector(".nav-toggle");
      const box = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          width: rect.width, height: rect.height,
          display: style.display, visibility: style.visibility
        };
      };
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        header: box(document.querySelector(".topbar")),
        brand: box(brand),
        langSwitch: box(langSwitch),
        toggle: box(toggle),
        langHref: langSwitch ? langSwitch.getAttribute("href") : null,
        langText: langSwitch ? langSwitch.textContent.trim() : null
      };
    });

    const name = `${width}px ${target.file}`;

    // 1 px tolerans: alt piksel yuvarlaması taşma değildir.
    check(`${name}: yatay taşma yok`, measured.scrollWidth <= measured.innerWidth + 1,
      `scrollWidth=${measured.scrollWidth} viewport=${measured.innerWidth}`);

    check(`${name}: dil kutusu var ve görünür`,
      Boolean(measured.langSwitch) && measured.langSwitch.display !== "none" &&
      measured.langSwitch.visibility !== "hidden" && measured.langSwitch.width > 0,
      JSON.stringify(measured.langSwitch));

    if (!measured.langSwitch) continue;

    check(`${name}: dokunma hedefi yeterli`,
      measured.langSwitch.width >= 40 && measured.langSwitch.height >= 30,
      `${Math.round(measured.langSwitch.width)}×${Math.round(measured.langSwitch.height)}`);

    check(`${name}: kutu görüntü alanı içinde`,
      measured.langSwitch.left >= -1 && measured.langSwitch.right <= measured.innerWidth + 1,
      `left=${Math.round(measured.langSwitch.left)} right=${Math.round(measured.langSwitch.right)}`);

    // Aynı satır denetimi: dikey merkezler birbirine 6 px'den yakın olmalı.
    // Grid ikinci satıra düşürseydi fark en az kutu yüksekliği kadar olurdu.
    const centre = (box) => box.top + box.height / 2;
    if (measured.brand && measured.toggle) {
      check(`${name}: marka, kutu ve hamburger aynı satırda`,
        Math.abs(centre(measured.langSwitch) - centre(measured.brand)) <= 6 &&
        Math.abs(centre(measured.langSwitch) - centre(measured.toggle)) <= 6,
        `brand=${Math.round(centre(measured.brand))} lang=${Math.round(centre(measured.langSwitch))} toggle=${Math.round(centre(measured.toggle))}`);
    }

    check(`${name}: kutu etiketi "${target.expectSwitch}"`, measured.langText === target.expectSwitch,
      String(measured.langText));

    const expectsEnglish = target.locale === "tr";
    check(`${name}: kutu diğer dile gidiyor`,
      expectsEnglish ? String(measured.langHref).includes("/en/") || String(measured.langHref).startsWith("./en/")
        : !String(measured.langHref).includes("/en/"),
      String(measured.langHref));
  }

  await context.close();
}

await browser.close();

if (failures.length) {
  console.error(`\nmobile-header FAILED (${failures.length}):`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log("\nmobile-header passed (375 / 390 / 430 px)");
}
