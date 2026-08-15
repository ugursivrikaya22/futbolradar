#!/usr/bin/env node
/**
 * SAYFA AİLESİNE GÖRE app.js DEMETİNİ SEÇ.
 *
 * `app.js` 483 KB ve 3.701 sayfada yükleniyordu. Sayfaların aradığı
 * kancalar sayıldığında ortaya çıkan tablo şuydu:
 *
 *   oyuncular/ (678) + mac/ (306) → app.js'ten YALNIZCA tema düğmesi
 *   karsilastirma/ (2.642)        → tema + oyuncu kıyaslama
 *
 * Yani 984 sayfa yarım megabaytlık bir dosyayı bir düğme için indiriyordu.
 * Bu adım o sayfalarda `<script src="app.js">` etiketini demetiyle
 * değiştiriyor; demetleri `build-app-bundles.mjs` app.js'ten türetiyor.
 *
 * ── KAPSAM DAR TUTULDU ───────────────────────────────────────────────────
 * Yalnızca kancaları KESİN olarak bilinen üç aile değiştiriliyor. Geri kalan
 * ~75 sayfa (ana sayfa, hub'lar, kampanya sayfaları) tam `app.js` almaya
 * devam ediyor: oralarda çalışan modül sayısı fazla ve kazanç küçük, risk
 * ise büyük olurdu. Bilinmeyen bir sayfa da her zaman tam dosyayı alır —
 * varsayılan güvenli tarafta.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

/**
 * Dizin öneki → demet dosyası. En uzun önek kazanır.
 *
 * ── İNGİLİZCE SAYFALARDA ÖLÜ TEMA DÜĞMESİ ────────────────────────────────
 * `en/player/` (552) ve `en/match/` (306) sayfaları `data-theme-toggle`
 * düğmesini BASIYOR ama app.js'i hiç yüklemiyorlardı — `initThemeToggle`
 * orada olduğu için düğme 858 sayfada hiçbir şey yapmıyordu. Türkçe
 * karşılıkları app.js'i yüklediği için çalışıyordu; yani bu aynı zamanda
 * bir TR/EN eşitlik kaybıydı.
 *
 * Bölme bu düzeltmeyi neredeyse bedava yaptı: gereken tek şey 4 KB'lık
 * `app-lite.js` (gzip 1 KB). Bu yüzden aşağıdaki aileler için demet, etiket
 * yoksa EKLENİYOR; varsa değiştiriliyor.
 */
const FAMILIES = [
  { prefix: "karsilastirma/", bundle: "app-compare.js" },
  { prefix: "oyuncular/", bundle: "app-lite.js" },
  { prefix: "mac/", bundle: "app-lite.js" },
  { prefix: "en/player/", bundle: "app-lite.js" },
  { prefix: "en/match/", bundle: "app-lite.js" }
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "public", ".vercel"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".html")) files.push(full);
  }
  return files;
}

function bundleFor(relative) {
  const hit = FAMILIES
    .filter((f) => relative.startsWith(f.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return hit ? hit.bundle : null;
}

const problems = [];
let switched = 0;
let untouched = 0;

for (const file of walk(root)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const bundle = bundleFor(relative);
  if (!bundle) { untouched += 1; continue; }

  const html = fs.readFileSync(file, "utf8");

  // Zaten doğru demetteyse dokunma (yeniden derlemede gürültü olmasın).
  if (new RegExp(`<script src="[^"]*${bundle.replace(".", "\\.")}`).test(html)) { untouched += 1; continue; }

  // Sürüm damgası bu adımdan SONRA basılıyor; burada damgasız adres aranır.
  let next = html.replace(
    /(<script src=")((?:\.{1,2}\/)*)app\.js(\?v=[0-9a-f]+)?(")/g,
    (match, open, prefix, version, close) => `${open}${prefix || ""}${bundle}${version || ""}${close}`
  );

  // Etiket hiç yoksa EKLE: bazı ailelerde app.js baştan beri yoktu ve
  // sayfadaki tema düğmesi bu yüzden ölüydü. site.js'in hemen ardına,
  // aynı göreli önekle girer.
  if (next === html) {
    const site = /<script src="((?:\.{1,2}\/)*)site\.js(\?v=[0-9a-f]+)?"([^>]*)><\/script>/.exec(html);
    // site.js de yoksa bu bir sayfa değil, yönlendirme/takma ad kütüğü
    // (ör. oyuncular/edina-dzeko.html: 3 KB, noindex, yalnızca satır içi
    // betik). Zenginleştirilecek bir arayüzü yok; demet bağlamak da
    // gereksiz bir istek eklemek olurdu. Atlanır, hata değil.
    if (!site) { untouched += 1; continue; }
    next = html.replace(site[0], `${site[0]}\n    <script src="${site[1]}${bundle}" defer></script>`);
  }

  if (next === html) { untouched += 1; continue; }
  if (CHECK_ONLY) { problems.push(`${relative}: demet etiketi güncel değil`); continue; }
  fs.writeFileSync(file, next, "utf8");

  const mirror = path.join(root, "public", relative);
  if (fs.existsSync(path.dirname(mirror))) fs.writeFileSync(mirror, next, "utf8");
  switched += 1;
}

if (problems.length) {
  console.error("app-bundle injection FAILED:");
  problems.slice(0, 5).forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log("app-bundle: sayfa demetleri güncel.");
} else {
  console.log(`app-bundle: ${switched} sayfa demete geçirildi, ${untouched} sayfa tam app.js ile kaldı.`);
}
