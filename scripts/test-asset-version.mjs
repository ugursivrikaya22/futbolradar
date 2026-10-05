/**
 * VARLIK SÜRÜMÜ TESTLERİ — uzun tarayıcı önbelleği güvenli kalsın.
 *
 * `page.css` ve `app.js` artık bir yıl `immutable` olarak önbellekleniyor.
 * Bu ancak TEK BİR koşulda güvenlidir: adres, içerik değiştiğinde
 * değişmelidir. Koşul bozulursa hata sessizdir ve en kötü türdendir —
 * okuyucu eski CSS'e ya da eski JavaScript'e bir yıl boyunca takılı kalır,
 * biz de bunu göremeyiz çünkü bizim tarayıcımız zaten yeni sürümü almıştır.
 *
 * Depoda daha önce elle tutulan bir işaret vardı (`page.css?v=20260719-1`)
 * ve iki yönden bozulmuştu: dosya değiştiği hâlde işaret güncellenmemişti,
 * ve işaret ~4.800 sayfadan yalnızca birinde vardı. Uzun önbellek o hâliyle
 * kurulsaydı geri dönüşü olmayan bir sorun olurdu.
 *
 * Buradaki testler o koşulu bekçiye bağlar.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ASSETS = ["daily-fixtures-en.js", "page.css", "app.js", "site.js", "app-lite.js", "app-compare.js", "player-profile.js", "pwa.js", "match-detail-en.js", "performance-loader.js"];
const SKIP_DIRS = new Set([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs", "public"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

const expected = new Map();
for (const asset of ASSETS) {
  const filePath = path.join(root, asset);
  if (!fs.existsSync(filePath)) continue;
  expected.set(asset, crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 8));
}
assert.ok(expected.size > 0, "sürümlenecek varlık bulunmalı");

const files = walk(root);
assert.ok(files.length > 1000, `üretilen ağaç taranmalı; bulunan: ${files.length}`);

const stale = [];
const unversioned = [];

for (const file of files) {
  const relative = path.relative(root, file);
  const html = fs.readFileSync(file, "utf8");

  for (const [asset, stamp] of expected) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`(?:\\.{1,2}/|/)?${escaped}(\\?[^"']*)?(?=["'])`, "g");
    for (const found of html.matchAll(expression)) {
      const query = found[1] || "";
      if (!query) {
        unversioned.push(`${relative} → ${asset}`);
        continue;
      }
      if (query !== `?v=${stamp}`) stale.push(`${relative} → ${asset}${query} (beklenen ?v=${stamp})`);
    }
  }
}

const summarize = (list, limit = 4) =>
  list.slice(0, limit).join("; ") + (list.length > limit ? ` …(+${list.length - limit})` : "");

// ── 1. Sürümsüz başvuru kalmamalı ──────────────────────────────────────────
//
// Sürümsüz bir başvuru, uzun önbelleği KIRILAMAZ hâle getirir: içerik
// değişse bile tarayıcı aynı adresi bir yıl boyunca yeniden istemez.
assert.equal(
  unversioned.length,
  0,
  `sürümsüz varlık başvurusu: ${summarize(unversioned)}`
);

// ── 2. Damga İÇERİKLE eşleşmeli ────────────────────────────────────────────
//
// Eskimiş damga daha sinsi: sayfa yeni içeriği isteyecekmiş gibi görünür ama
// adres eski olduğu için tarayıcı önbellekteki eski dosyayı verir.
assert.equal(
  stale.length,
  0,
  `damga içerikle eşleşmiyor — derlemede inject-asset-version çalıştı mı? ${summarize(stale)}`
);

// ── 3. Uzun önbellek YALNIZCA sürümlü varlıklarda ──────────────────────────

{
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const rules = new Map(
    (vercel.headers || []).map((rule) => [
      rule.source,
      (rule.headers || []).find((header) => header.key === "Cache-Control")?.value || ""
    ])
  );

  // These three assets have dedicated immutable header rules. Other stamped
  // bundles may use a grouped rule or intentionally retain a shorter cache.
  for (const asset of ["page.css", "app.js", "site.js"]) {
    const value = rules.get(`/${asset}`) || "";
    assert.match(
      value,
      /max-age=31536000/,
      `${asset}: sürümlü varlık uzun önbelleklenmeli (mevcut: ${value || "kural yok"})`
    );
    assert.match(value, /immutable/, `${asset}: immutable olmalı — yeniden doğrulama turu gereksiz`);
  }

  // HTML uzun önbelleklenmemeli: adresi sabit, içeriği her derlemede değişir.
  const htmlRule = rules.get("/(.*)") || "";
  assert.doesNotMatch(
    htmlRule,
    /max-age=31536000/,
    "genel kural uzun önbellek olmamalı: HTML adresleri sabit, içerikleri değişken"
  );

  // Veri dosyaları da kısa kalmalı: saatlik tazeleniyorlar.
  const dataRule = rules.get("/data/:path*") || "";
  assert.doesNotMatch(dataRule, /max-age=31536000/, "veri dosyaları uzun önbelleklenmemeli");
}

// ── 4. Damga gerçekten içerikten türemeli ──────────────────────────────────

{
  const filePath = path.join(root, "page.css");
  const original = fs.readFileSync(filePath);
  const stampOf = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 8);

  assert.notEqual(
    stampOf(original),
    stampOf(Buffer.concat([original, Buffer.from("/* değişiklik */")])),
    "içerik değiştiğinde damga da değişmeli"
  );
  assert.equal(stampOf(original), stampOf(original), "içerik aynıysa damga da aynı kalmalı");
}

console.log(
  `Varlık sürümü testleri geçti (${files.length} sayfa, ` +
  `${[...expected.entries()].map(([asset, stamp]) => `${asset}=${stamp}`).join(" ")}).`
);

// ── performance-loader damgası ─────────────────────────────────────────────
//
// app.js sayfalara <script> ile girmiyor; performance-loader onu dinamik
// yüklüyor. Adres sürümsüz kalırsa /app.js'in bir yıllık immutable
// önbelleği dönen ziyaretçiyi ebediyen eski uygulamaya kilitler — sayfa
// damgaları bunu KURTARAMAZ. Bu denetim, yükleyicinin güncel app.js
// karmasını taşıdığını doğrular.
{
  const loader = fs.readFileSync(path.join(root, "performance-loader.js"), "utf8");
  const appStamp = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(root, "app.js")))
    .digest("hex").slice(0, 8);
  assert.ok(
    loader.includes(`/app.js?v=${appStamp}`),
    `performance-loader güncel app.js damgasını taşımalı (beklenen v=${appStamp})`
  );
  console.log("performance-loader damgası dogru.");
}
