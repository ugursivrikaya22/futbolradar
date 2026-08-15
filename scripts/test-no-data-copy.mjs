/**
 * "VERİ YOK" YASAĞI.
 *
 * Kural: kullanıcı hiçbir sayfada "Veri yok" / "No data" / "N/A" gibi ham
 * yer tutucular görmez. Bir alan boşsa ya bağlama uygun bir cümle yazılır
 * (locales/*.json → `fallback.*`) ya da o kutu/bölüm hiç çizilmez.
 *
 * TEK İSTİSNA ve NEDEN İSTİSNA: ana sayfadaki "Veri yoksa sayı
 * uydurmuyoruz, o bölümü hiç göstermiyoruz" cümlesi. Bu bir yer tutucu
 * DEĞİL, sitenin editoryal vaadidir — yasağın kendisini anlatan cümleyi
 * yasağa kurban etmek anlamsız olurdu.
 *
 * Bu testin işi metni kovalamak değil, KURALI kilitlemek: yarın biri
 * bileşenine elle "Veri yok" yazarsa derleme burada durur.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/** Editoryal vaat cümlesi — yer tutucu değil, bilinçli metin. */
const EDITORIAL_PROMISE = "Veri yoksa sayı uydurmuyoruz";

/** Kullanıcıya asla görünmemesi gereken ham ifadeler. */
const BANNED = [
  { pattern: /Veri\s+yok/gi, label: "Veri yok" },
  { pattern: /Veri\s+bulunamad[ıi]/gi, label: "Veri bulunamadı" },
  { pattern: />\s*No data\s*</gi, label: "No data" },
  { pattern: />\s*Data unavailable\s*</gi, label: "Data unavailable" },
  { pattern: />\s*N\/A\s*</g, label: "N/A" },
  { pattern: />\s*(null|undefined)\s*</g, label: "null/undefined" },
  // Yayımlanmamış ilk yarı skoru bir zamanlar "İlk yarı -" diye basılıyordu
  // (Number(null) === 0 tuzağı). Skor yoksa satır hiç çizilmemeli.
  { pattern: /İlk yarı\s*-\s*</g, label: "boş ilk yarı skoru" }
];

const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "work", "outputs"]);

function* htmlFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

// ── 1. Hiçbir sayfada ham yer tutucu yok ────────────────────────────────
const offenders = [];
let scanned = 0;

for (const file of htmlFiles(root)) {
  scanned += 1;
  // Editoryal vaat cümlesi taramadan düşürülür; kalan her eşleşme gerçek.
  const html = fs.readFileSync(file, "utf8").split(EDITORIAL_PROMISE).join("");
  for (const { pattern, label } of BANNED) {
    pattern.lastIndex = 0;
    if (pattern.test(html)) offenders.push(`${path.relative(root, file)} → ${label}`);
  }
}

assert.equal(
  offenders.length,
  0,
  `Kullanıcıya görünen ham yer tutucu bulundu (${offenders.length}):\n  ${offenders.slice(0, 20).join("\n  ")}`
);
console.log(`  ok  ${scanned} HTML sayfada ham yer tutucu yok`);

// ── 2. Sözlükte bağlama uygun karşılıklar var ve iki dil eşit ───────────
const tr = JSON.parse(fs.readFileSync(path.join(root, "locales/tr.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(root, "locales/en.json"), "utf8"));
const FALLBACK_KEYS = ["general", "match", "lineup", "stats", "transfer"];

for (const key of FALLBACK_KEYS) {
  const full = `fallback.${key}`;
  assert.ok(tr[full] && tr[full].trim(), `locales/tr.json içinde ${full} yok`);
  assert.ok(en[full] && en[full].trim(), `locales/en.json içinde ${full} yok`);
  assert.doesNotMatch(tr[full], /veri yok/i, `${full} (tr) yasaklı ifadeyi içeriyor`);
  assert.doesNotMatch(en[full], /no data/i, `${full} (en) yasaklı ifadeyi içeriyor`);
}
console.log(`  ok  ${FALLBACK_KEYS.length} bağlam karşılığı iki dilde de tanımlı`);

// ── 3. app.js'teki demet sözlükle birebir aynı ─────────────────────────
// app.js tarayıcıda çalışıyor ve locales/*.json'u okuyamıyor; metinler
// orada elle kopyalı. Kopya sessizce ayrışmasın diye burada karşılaştırılır.
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const block = app.match(/var FALLBACK = \{([\s\S]*?)\};/);
assert.ok(block, "app.js içinde FALLBACK demeti bulunamadı");

for (const key of FALLBACK_KEYS) {
  const found = block[1].match(new RegExp(`${key}:\\s*"([^"]+)"`));
  assert.ok(found, `app.js FALLBACK içinde ${key} yok`);
  assert.equal(
    found[1],
    tr[`fallback.${key}`],
    `app.js FALLBACK.${key} sözlükten farklı — locales/tr.json ile eşitleyin`
  );
}
console.log("  ok  app.js FALLBACK demeti locales/tr.json ile birebir aynı");

console.log("no-data-copy OK (3 bölüm)");
