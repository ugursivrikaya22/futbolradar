/**
 * ANA SAYFADAKİ BÜYÜK MAÇ KARTI BAYATLAYAMAZ.
 *
 * NEDEN VAR: 14 Ağustos'ta oynanan Galatasaray - Çorum FK maçı, 15 Ağustos
 * sabahı ana sayfanın en üstünde hâlâ duruyordu ve üzerinde "CANLI" yazıyordu.
 * İki ayrı hata üst üste bindi:
 *
 *   1. Kart elle yazılmış işaretlemeydi ve hiçbir zaman aşırısı yoktu —
 *      maç bitince kendiliğinden düşmesini sağlayan bir kural yoktu.
 *   2. İstemci kodu canlılığı SAATTEN türetiyordu (`Date.now() >= kickoff`),
 *      sağlayıcıya sormadan. Dünkü bir maç bu kurala göre sonsuza dek
 *      "canlı" görünür.
 *
 * Kart bir kez silindi, sonra bir birleştirme çakışmasında `index.html`
 * "üretilmiş dosya" sanılıp karşı taraftan alınınca SESSİZCE geri geldi.
 * Bu test tam olarak o sessizliği kırmak için var: bayat kart geri gelirse
 * derleme burada durur.
 *
 * KURAL, TEK BİR MAÇA DEĞİL DAVRANIŞA BAĞLI:
 *   · Ana sayfada geçmiş tarihli bir maç kartı bulunamaz.
 *   · İstemci kodu bir kartı yalnızca saate bakarak "canlı" ilan edemez;
 *     canlılık sağlayıcı durumundan gelmek zorundadır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/** Ana sayfalar — iki dil de aynı kurala tabi. */
const HOME_PAGES = ["index.html", "en/index.html"];

/**
 * Bir maç bittikten sonra kartın düşmesi için tanınan süre.
 *
 * Maç ~2 saat sürüyor; devre arası, uzatma ve maç sonu özeti için üstüne
 * pay bırakılıyor. Bu payın DIŞINDA kalan bir başlama saati, kartın
 * yayında unutulduğu anlamına gelir.
 */
const GRACE_HOURS = 6;

const now = Date.now();
let scanned = 0;
const stale = [];

for (const page of HOME_PAGES) {
  const file = path.join(root, page);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");

  // Kart işaretlemesi `data-kickoff` ile başlama saatini duyuruyor.
  const matches = [...html.matchAll(/data-kickoff="([^"]+)"/g)];
  for (const [, value] of matches) {
    scanned += 1;
    const kickoff = Date.parse(value);
    if (!Number.isFinite(kickoff)) {
      stale.push(`${page}: okunamayan başlama saati "${value}"`);
      continue;
    }
    const ageHours = (now - kickoff) / 3600000;
    if (ageHours > GRACE_HOURS) {
      stale.push(`${page}: ${value} (${Math.round(ageHours)} saat önce başlamış)`);
    }
  }
}

assert.equal(
  stale.length,
  0,
  `Ana sayfada bayat maç kartı var — geçmiş maç hero alanında DURAMAZ:\n  ${stale.join("\n  ")}`
);
console.log(`  ok  ${HOME_PAGES.length} ana sayfada bayat maç kartı yok (${scanned} başlama saati denetlendi)`);

// ── İstemci canlılığı saatten türetemez ────────────────────────────────
//
// `Date.now() >= kickoff` deyip karta "canlı" demek, sağlayıcı maçı canlı
// bildirmese bile — hatta maç bittikten günler sonra bile — CANLI etiketi
// basar. Canlılık yalnızca sağlayıcı durumundan (status/live alanı) gelir.
for (const script of ["app.js", "site.js"]) {
  const file = path.join(root, script);
  if (!fs.existsSync(file)) continue;
  const code = fs.readFileSync(file, "utf8");

  const selfDeclared = /is-live[\s\S]{0,200}?Date\.now\(\)\s*>=|Date\.now\(\)\s*>=[\s\S]{0,200}?is-live/.test(code);
  assert.ok(
    !selfDeclared,
    `${script}: bir kart canlılığı saatten türetiyor (Date.now() >= kickoff → is-live). ` +
    "Canlılık sağlayıcı durumundan gelmeli; saat tek başına maçın oynandığını söylemez."
  );
}
console.log("  ok  istemci kodu canlılığı saatten türetmiyor");

console.log("hero-freshness OK (2 bölüm)");
