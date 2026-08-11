/**
 * HABER AKIŞI TESTLERİ — "kart var ama sayfa yok" bir daha olmasın.
 *
 * Bu testler canlıda görülen somut bir hatadan doğdu: İngilizce ana sayfa
 * `status: "archived"` iki habere kart açıyordu, ama o haberlerin sayfası
 * hiç üretilmediği için ikisi de 404 veriyordu. Sebep basit ve tanıdıktı —
 * aynı kural iki dosyada ayrı ayrı yazılmıştı ve biri güncellenmemişti:
 *
 *   scripts/prerender-core-pages.mjs → `status === "verified"` süzgeci vardı
 *   scripts/generate-en-pages.mjs    → süzgeç YOKTU
 *
 * Kural artık services/newsFeed.js içinde tek yerde. Buradaki testler o
 * kuralın hem doğru olduğunu hem de üç üreticinin ondan saptığında fark
 * edileceğini garanti eder.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  hasOwnPage,
  isExternalHref,
  newsHref,
  publishableNews
} = require("../services/newsFeed.js");

const newsPayload = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));

// ── 1. Yayımlanabilirlik ölçütü ────────────────────────────────────────────

{
  const verified = { slug: "a", title: "A", status: "verified", body: ["dolu"] };
  assert.equal(hasOwnPage(verified), true, "doğrulanmış ve gövdeli haber yayımlanabilir");

  assert.equal(
    hasOwnPage({ ...verified, status: "archived" }),
    false,
    "arşivlenmiş haber ana sayfaya bağlanmamalı — sayfası üretilmiyor"
  );
  assert.equal(
    hasOwnPage({ ...verified, status: "draft" }),
    false,
    "taslak haber yayımlanamaz"
  );
  assert.equal(
    hasOwnPage({ ...verified, body: [] }),
    false,
    "gövdesiz haber için sayfa yazılmıyor, karta da girmemeli"
  );
  assert.equal(
    hasOwnPage({ ...verified, body: ["   ", ""] }),
    false,
    "yalnızca boşluk taşıyan gövde gövde sayılmaz"
  );
  assert.equal(hasOwnPage({ ...verified, title: "" }), false, "başlıksız haber yayımlanamaz");
  assert.equal(hasOwnPage(null), false, "boş kayıt yayımlanamaz");

  // Sayfa üreticisi slug'ı `slug → id → title` sırasıyla türetiyor; ölçüt de
  // aynı sırayı görmeli, yoksa yalnızca başlıklı kayıt burada elenip orada
  // sayfası yazılırdı.
  assert.equal(
    hasOwnPage({ title: "Yalnızca başlık", status: "verified", body: ["dolu"] }),
    true,
    "slug başlıktan türetilebiliyorsa haber yayımlanabilir"
  );
}

// ── 2. Sıralama ────────────────────────────────────────────────────────────

{
  const list = publishableNews([
    { slug: "eski", title: "Eski", status: "verified", body: ["x"], publishedAt: "2026-08-01T10:00:00Z" },
    { slug: "yeni", title: "Yeni", status: "verified", body: ["x"], publishedAt: "2026-08-09T10:00:00Z" }
  ]);
  assert.deepEqual(list.map((item) => item.slug), ["yeni", "eski"], "en yeni haber başta olmalı");
}

// ── 3. Bağlantı biçimi ─────────────────────────────────────────────────────

{
  const own = { slug: "galatasaray-transfer", url: "https://www.futbolradar.com/haber/galatasaray-transfer.html" };
  assert.equal(newsHref(own, "./"), "./haber/galatasaray-transfer", "kendi haberimiz göreli yola çevrilmeli");
  assert.equal(newsHref(own, "../"), "../haber/galatasaray-transfer", "İngilizce alt dizinden bir üst kök kullanılmalı");
  assert.equal(isExternalHref(newsHref(own, "./")), false, "iç bağlantı dış sayılmamalı");

  const external = { slug: "x", url: "https://www.uefa.com/aciklama" };
  assert.equal(newsHref(external, "./"), "https://www.uefa.com/aciklama", "dış künye olduğu gibi kalmalı");
  assert.equal(isExternalHref(newsHref(external, "./")), true, "dış bağlantı dış sayılmalı");

  // `url` yoksa slug'dan kanonik iç yol kurulur — adres UYDURULMAZ.
  assert.equal(newsHref({ slug: "sade" }, "./"), "./haber/sade", "url yoksa slug'dan yol kurulmalı");
  assert.equal(newsHref({}, "./"), "", "slug da yoksa bağlantı üretilmemeli");
}

// ── 4. GERÇEK DEPO: bağlanan her haberin sayfası olmalı ────────────────────
//
// Asıl kalkan bu. Yukarıdaki birim testleri kuralın kendisini doğrular; bu
// blok kuralın DEPODAKİ VERİYLE tuttuğunu doğrular — canlıda 404 veren iki
// bağlantı tam olarak burada yakalanırdı.

{
  const feed = publishableNews(newsPayload);
  assert.ok(feed.length > 0, "yayımlanabilir haber akışı boş olmamalı");

  const missing = [];
  for (const article of feed) {
    const href = newsHref(article, "./");
    if (!href || isExternalHref(href)) continue;
    const localPath = href.replace(/^\.\//, "");
    const candidates = [localPath, `${localPath}.html`];
    if (!candidates.some((candidate) => fs.existsSync(path.join(root, candidate)))) {
      missing.push({ slug: article.slug || article.id, href });
    }
  }

  assert.deepEqual(
    missing,
    [],
    `ana sayfaya bağlanan her haberin sayfası üretilmiş olmalı; eksik: ${JSON.stringify(missing)}`
  );
}

// ── 5. Elenen kayıtlar gerçekten eleniyor mu? ──────────────────────────────

{
  const all = Array.isArray(newsPayload) ? newsPayload : (newsPayload.news || newsPayload.items || []);
  const dropped = all.filter((article) => !hasOwnPage(article));
  for (const article of dropped) {
    const slug = article && (article.slug || article.id);
    if (!slug) continue;
    assert.equal(
      fs.existsSync(path.join(root, "haber", `${slug}.html`)),
      false,
      `${slug}: elenen haberin sayfası olmamalı (varsa ölçüt sayfa üreticisiyle ayrışmış demektir)`
    );
  }
}

console.log(
  `Haber akışı testleri geçti (${publishableNews(newsPayload).length} yayımlanabilir haber, ` +
  "bağlanan her habere karşılık bir sayfa var)."
);
