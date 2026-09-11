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

  /**
   * İki ayrı yerde başlama saati duyuruluyor ve İKİSİ DE denetlenmeli:
   *   · `data-kickoff` — kartın görünen işaretlemesi.
   *   · JSON-LD `SportsEvent.startDate` — okuyucuya görünmeyen, arama
   *     motoruna giden hâli.
   *
   * İlk sürüm yalnızca ilkine bakıyordu. Kart silindikten sonra şema bloğu
   * sayfada KALDI ve dünkü maçı Google'a "EventScheduled" diye bildirmeye
   * devam etti — göze görünmediği için de fark edilmedi. Görünmeyen bayat
   * veri, görünenden daha uzun ömürlü oluyor; bu yüzden ikisi bir arada.
   */
  const matches = [
    ...html.matchAll(/data-kickoff="([^"]+)"/g),
    ...html.matchAll(/"startDate":\s*"([^"]+)"/g)
  ];
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

// ── Canlı skorlar bandı: "CANLI" diyen her kayıt BUGÜNDEN olmalı ───────
//
// NEDEN VAR: 11 Eylül 2026 akşamı yayındaki ana sayfanın en üstündeki bant,
// 6 Eylül'de oynanmış on altı maçı — Gladiator-Manfredonia 89', Oviedo-Burgos
// 90' — yanıp sönen canlı nabzıyla gösteriyordu. Kayıtlar sahteydi değil,
// DONMUŞTU: sağlayıcı o maçları hiç FINISHED'e çevirmeyince
// data/fixture-calendar.json onları "LIVE" olarak sakladı ve yalnızca
// `status` alanına bakan bant her derlemede aynı on altı maçı yeniden bastı.
//
// Kapı artık servis katmanında (services/liveScoresTicker.js →
// services/matchStatus.js#liveVerdict). Bu denetim ÜRETİLEN ÇIKTIYA bakıyor:
// kural bir gün yeniden delinirse, hata bu dosyalarda yayına çıkmadan önce
// burada görünür. Bandın her öğesi kendi maç gününü bağlantısında taşıyor
// (`?id=…&date=YYYY-MM-DD`), dolayısıyla iddia dışarıdan okunabilir.

{
  const istanbulToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(now));
  // Dün 23:00'te başlayan maç bu gece 00:30'da hâlâ oynanıyor olabilir;
  // bandın takvim günü bu yüzden dünü de kapsar. İKİ günden eskisi kapsamaz.
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" })
    .format(new Date(now - 24 * 3600000));
  const allowedDays = new Set([istanbulToday, yesterday]);

  const staleLive = [];
  let liveItems = 0;

  for (const page of HOME_PAGES) {
    const file = path.join(root, page);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");

    // Bant TR'de ön derleme işaretleri arasında, EN'de üreticinin kendi
    // çıktısında duruyor; iki yüzey de AYNI sınıfı basıyor (işaretleme
    // scripts/lib/liveScoresTicker.mjs'te tek yerde). Denetim bu yüzden
    // işarete değil sınıfa bakıyor — kural iki dilde de aynı.
    for (const [, day] of html.matchAll(/live-scores-ticker__item"[^>]*href="[^"]*?date=(\d{4}-\d{2}-\d{2})/g)) {
      liveItems += 1;
      if (!allowedDays.has(day)) staleLive.push(`${page}: ${day} tarihli maç "canlı" olarak basılmış`);
    }
  }

  assert.equal(
    staleLive.length,
    0,
    "Canlı skorlar bandında bayat maç var — bant yalnızca ŞU AN oynanan maçları taşır:\n  " +
    [...new Set(staleLive)].join("\n  ")
  );
  console.log(`  ok  canlı skorlar bandında bayat maç yok (${liveItems} canlı öğe denetlendi)`);
}

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

console.log("hero-freshness OK (3 bölüm)");
