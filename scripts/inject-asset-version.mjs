/**
 * VARLIK SÜRÜMÜNÜ İÇERİKTEN DAMGALA — tarayıcı önbelleği güvenli hâle gelsin.
 *
 * PROBLEM. `page.css` (392 KB ham, 62 KB brotli) render'ı blokluyor ve
 * `app.js` (471 KB ham, 115 KB brotli) her sayfada yükleniyor. İkisi de
 * `max-age=0` ile geliyordu: CDN 24 saat tutuyor ama TARAYICI hiç
 * önbelleklemiyor. Yani okuyucu sitede ikinci sayfayı açtığında ikisi için
 * de yeniden doğrulama turu atıyor — mobil bağlantıda her tur ~150 ms ve
 * CSS turu ilk boyamayı bekletiyor.
 *
 * Bu doğrudan ürünün hedefiyle çelişiyordu: "kullanıcıların sitede daha
 * fazla sayfa gezmesi" isteniyor ama gezilen her sayfa aynı bedeli yeniden
 * ödüyordu.
 *
 * NEDEN ŞİMDİYE KADAR UZUN ÖNBELLEK KURULAMADI. Uzun önbellek ancak adres
 * içerikle birlikte değişiyorsa güvenlidir. Depoda bir sürüm işareti vardı
 * — `page.css?v=20260719-1` — ama iki sorunu vardı:
 *
 *   1. ELLE TUTULUYORDU ve eskimişti: dosya o tarihten sonra değişti,
 *      işaret değişmedi.
 *   2. YALNIZCA `index.html`de vardı. Diğer ~4.800 sayfa varlıkları
 *      sürümsüz bağlıyordu; uzun önbellek onlarda kırılamaz hâle gelirdi.
 *
 * Bu betik işareti İÇERİKTEN türetir ve HER sayfaya uygular. Dosya
 * değiştiğinde damga kendiliğinden değişir, değişmediğinde aynı kalır —
 * yani gereksiz önbellek boşaltması da olmaz.
 *
 * SIRA ÖNEMLİ. Bu adım, sayfaları yazan ve varlıkları üreten bütün
 * adımlardan SONRA çalışmalı; damga son hâlin özetidir.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/** Sürümlenecek varlıklar. Yol, sitenin kökünden. */
const ASSETS = ["page.css", "app.js", "site.js"];

const SKIP_DIRS = new Set([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs"]);
const VERIFICATION_FILE = "googlef881b0d7527a8fba.html";

/** İçerikten kısa damga. Sekiz onaltılık basamak çakışma için fazlasıyla yeterli. */
function contentStamp(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 8);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name === VERIFICATION_FILE) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

const stamps = new Map();
for (const asset of ASSETS) {
  const filePath = path.join(root, asset);
  if (!fs.existsSync(filePath)) continue;
  stamps.set(asset, contentStamp(filePath));
}

if (!stamps.size) {
  console.log("Asset version: sürümlenecek varlık bulunamadı, atlandı.");
  process.exit(0);
}

/**
 * Bir varlığa yapılan başvuruyu damgalar.
 *
 * Başvurular farklı biçimlerde yazılıyor: `./page.css`, `../page.css`,
 * `/page.css`, ve kimi yerlerde eski elle yazılmış bir sorgu ekiyle.
 * Hepsinin önündeki yol korunur, sorgu eki damgayla DEĞİŞTİRİLİR — eskisi
 * birikmesin.
 */
function stampReferences(html) {
  let output = html;
  for (const [asset, stamp] of stamps) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // (önek yolu)(varlık adı)(varsa eski sorgu)
    const expression = new RegExp(`((?:\\.{1,2}/|/)?)(${escaped})(\\?[^"']*)?(?=["'])`, "g");
    output = output.replace(expression, (match, prefix, name) => `${prefix}${name}?v=${stamp}`);
  }
  return output;
}

const files = walk(root);
let updated = 0;

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const next = stampReferences(html);
  if (next !== html) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

const summary = [...stamps.entries()].map(([asset, stamp]) => `${asset}=${stamp}`).join(" ");
console.log(`Asset version: ${updated} sayfa damgalandı (${summary}).`);
