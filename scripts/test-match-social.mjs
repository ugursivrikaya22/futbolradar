#!/usr/bin/env node
/**
 * MAÇ SAYFASI TOPLULUK KATMANI TESTLERİ — yorum ve oyuncu puanı.
 *
 * Hesapsız bir yorum alanının riskleri sıradan bir formunkinden farklı ve
 * buradaki denetimlerin çoğu o riskleri koruyor:
 *
 *   • KÜFÜR SÜZGECİ İKİ YÖNLÜ YANILABİLİR. Kaçan küfür kadar, masum bir
 *     kelimeyi yakalayıp okuyucuyu haksızca susturmak da hata.
 *   • GİZLENEN YORUMUN GÖVDESİ SIZMAMALI. Gövdeyi gönderip istemcide
 *     gizlemek, gizlemiş sayılmaz.
 *   • TEK SEVİYE CEVAP. Cevabın cevabı ağacı derinleştirir ve moderasyonu
 *     zorlaştırır.
 *   • ORTALAMA UYDURULMAMALI. Puan aralığı ve tekrar oy koruması sunucuda.
 *
 * Depo katmanı (Supabase) burada KOŞMUYOR: bu testler yapılandırmasız
 * ortamda çalışmalı, bu yüzden saf karar katmanı sınanıyor.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const social = require("../services/matchSocial.js");
const profanity = require("../services/turkishProfanity.js");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log("match-social");

/* ---------------------------------------------------------------- */
/* 1. KÜFÜR SÜZGECİ                                                   */
/* ---------------------------------------------------------------- */

test("açık küfür ve hakaret yakalanır", () => {
  for (const text of ["siktir git", "orospu çocuğu", "ibne herif", "şerefsiz hakem", "what the fuck"]) {
    assert.equal(profanity.isClean(text), false, `yakalanmalı: ${text}`);
  }
});

test("yazım oyunu süzgeci atlatmaz", () => {
  // Rakam ikamesi, araya nokta, harf tekrarı.
  for (const text of ["s1kt1r", "s.i.k.t.i.r", "siiiktir", "AMK", "a.m.k"]) {
    assert.equal(profanity.isClean(text), false, `yakalanmalı: ${text}`);
  }
});

test("MASUM KELİME YAKALANMAZ — haksız susturma, kaçan küfürden kötü", () => {
  const innocent = [
    "kaleci harika kurtardı", "sikke koleksiyonu", "bokser değil boksör",
    "boks maçı gibiydi", "piknik yaptık", "pikette kaldı",
    "hakem kötü yönetti", "defans dağıldı", "forvet bitiremedi",
    "orta saha boş kaldı", "çok kötü oynadılar", "asist muhteşemdi"
  ];
  for (const text of innocent) {
    assert.equal(profanity.isClean(text), true, `geçmeli: ${text}`);
  }
});

test("reddetme sebebi küfrün kendisini TAŞIMAZ", () => {
  // `matched` yalnızca teşhis; okuyucuya giden mesaj server katmanında
  // sabit metinden geliyor (server/matchSocialRoute.js#REASONS).
  const result = profanity.inspect("siktir");
  assert.equal(result.clean, false);
  assert.ok(result.matched, "teşhis alanı dolu olmalı");
});

/* ---------------------------------------------------------------- */
/* 2. TAKMA AD VE GÖVDE                                               */
/* ---------------------------------------------------------------- */

test("takma ad: sınırlar, bağlantı ve küfür", () => {
  assert.equal(social.validateName("").reason, "name-required");
  assert.equal(social.validateName("a").reason, "name-short");
  assert.equal(social.validateName("x".repeat(social.NAME_MAX + 1)).reason, "name-long");
  assert.equal(social.validateName("http://spam.com").reason, "name-invalid");
  assert.equal(social.validateName("<b>ad</b>").reason, "name-invalid");
  assert.equal(social.validateName("siktir").reason, "name-profanity");
  assert.equal(social.validateName("  Taraftar 19  ").value, "Taraftar 19", "baştaki/sondaki boşluk kırpılmalı");
});

test("gövde: boş, kısa, uzun, bağlantı ve küfür reddedilir", () => {
  assert.equal(social.validateBody("").reason, "body-required");
  assert.equal(social.validateBody("a").reason, "body-short");
  assert.equal(social.validateBody("x".repeat(social.BODY_MAX + 1)).reason, "body-long");
  assert.equal(social.validateBody("şuraya bak http://spam.com").reason, "body-link");
  assert.equal(social.validateBody("www.spam.com harika").reason, "body-link");
  assert.equal(social.validateBody("siktir lan").reason, "body-profanity");
  assert.equal(social.validateBody("Maç çok güzeldi.").value, "Maç çok güzeldi.");
});

test("gövdedeki aşırı boş satır sadeleşir ama metin korunur", () => {
  const result = social.validateBody("İlk yarı\n\n\n\n\nikinci yarı");
  assert.equal(result.ok, true);
  assert.equal(result.value, "İlk yarı\n\nikinci yarı");
});

/* ---------------------------------------------------------------- */
/* 3. GÖNDERİ BÜTÜNÜ                                                  */
/* ---------------------------------------------------------------- */

test("geçerli gönderi saklanacak satıra iner", () => {
  const result = social.validateComment({
    matchSlug: "fenerbahce-besiktas-5-eylul-2026",
    authorName: "Taraftar",
    body: "Talisca çok iyiydi.",
    locale: "en"
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.parentId, null);
  assert.equal(result.value.locale, "en");
  assert.equal(result.value.matchSlug, "fenerbahce-besiktas-5-eylul-2026");
});

test("maç slug'ı olmayan gönderi reddedilir", () => {
  assert.equal(social.validateComment({ authorName: "Ad", body: "Metin metin" }).reason, "match-required");
});

test("geçersiz cevap kimliği reddedilir", () => {
  const base = { matchSlug: "m", authorName: "Ad", body: "Metin metin" };
  assert.equal(social.validateComment({ ...base, parentId: "abc" }).reason, "parent-invalid");
  assert.equal(social.validateComment({ ...base, parentId: -1 }).reason, "parent-invalid");
  assert.equal(social.validateComment({ ...base, parentId: 1.5 }).reason, "parent-invalid");
  assert.equal(social.validateComment({ ...base, parentId: "12" }).value.parentId, 12, "metin kimlik sayıya inmeli");
});

/* ---------------------------------------------------------------- */
/* 4. BEKLEME SÜRESİ                                                  */
/* ---------------------------------------------------------------- */

test("ilk yorumda bekleme yok; arka arkaya yazmada var", () => {
  const now = Date.UTC(2026, 8, 19, 12, 0, 0);
  assert.equal(social.cooldownRemaining(null, now), 0, "ilk yorum serbest");
  const justNow = new Date(now - 5000).toISOString();
  assert.ok(social.cooldownRemaining(justNow, now) > 0, "5 sn önce yazan beklemeli");
  const old = new Date(now - social.COMMENT_COOLDOWN_MS - 1000).toISOString();
  assert.equal(social.cooldownRemaining(old, now), 0, "süre dolduysa serbest");
});

/* ---------------------------------------------------------------- */
/* 5. BİLDİRİM VE GİZLEME                                             */
/* ---------------------------------------------------------------- */

test("tek bildirim gizlemez; eşikte gizler", () => {
  assert.equal(social.statusAfterReport(0), "visible");
  assert.equal(social.statusAfterReport(1), "reported", "tek kişiye susturma yetkisi verilmemeli");
  assert.equal(social.statusAfterReport(social.HIDE_AFTER_REPORTS), "hidden");
  assert.equal(social.statusAfterReport(social.HIDE_AFTER_REPORTS + 5), "hidden");
});

test("GİZLENEN YORUMUN GÖVDESİ VE ADI TAŞINMAZ", () => {
  const view = social.publicComment({
    id: 7, parent_id: null, author_name: "Kötü Ad", body: "kaldırılmış metin",
    status: "hidden", created_at: "2026-09-19T12:00:00Z", voter_key: "v1"
  }, "v1");
  assert.equal(view.hidden, true);
  assert.equal(view.body, "", "gövde sızmamalı");
  assert.equal(view.authorName, "", "ad da sızmamalı");
});

test("okuyucu kendi yorumunu tanır, başkasınınkini değil", () => {
  const row = { id: 1, parent_id: null, author_name: "A", body: "b", status: "visible", voter_key: "v1" };
  assert.equal(social.publicComment(row, "v1").mine, true);
  assert.equal(social.publicComment(row, "v2").mine, false);
  assert.equal(social.publicComment(row, "").mine, false);
});

/* ---------------------------------------------------------------- */
/* 6. AĞAÇ                                                            */
/* ---------------------------------------------------------------- */

test("kökler EN YENİ üstte, cevaplar ESKİDEN YENİYE", () => {
  const rows = [
    { id: 1, parent_id: null, author_name: "A", body: "eski kök", status: "visible", created_at: "2026-09-19T10:00:00Z" },
    { id: 2, parent_id: null, author_name: "B", body: "yeni kök", status: "visible", created_at: "2026-09-19T12:00:00Z" },
    { id: 3, parent_id: 1, author_name: "C", body: "geç cevap", status: "visible", created_at: "2026-09-19T11:30:00Z" },
    { id: 4, parent_id: 1, author_name: "D", body: "erken cevap", status: "visible", created_at: "2026-09-19T10:30:00Z" }
  ];
  const tree = social.threadComments(rows, "");
  assert.deepEqual(tree.map((item) => item.id), [2, 1], "yeni kök üstte");
  assert.deepEqual(tree[1].replies.map((item) => item.id), [4, 3], "konuşma tersten okunmaz");
  assert.deepEqual(tree[0].replies, []);
});

test("sayfa boyu aşılmaz", () => {
  const rows = [];
  for (let index = 1; index <= social.PAGE_SIZE + 20; index += 1) {
    rows.push({ id: index, parent_id: null, author_name: "A", body: "x", status: "visible", created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() });
  }
  assert.equal(social.threadComments(rows, "").length, social.PAGE_SIZE);
});

test("beğeni sayısı depo katmanından gelir, satırdan değil", () => {
  const view = social.publicComment({ id: 1, parent_id: null, author_name: "A", body: "b", status: "visible", likeCount: 4, likedByMe: true }, "");
  assert.equal(view.likes, 4);
  assert.equal(view.likedByMe, true);
});

/* ---------------------------------------------------------------- */
/* 7. OYUNCU PUANI                                                    */
/* ---------------------------------------------------------------- */

test("puan aralığı SUNUCUDA kısıtlı", () => {
  const base = { matchSlug: "m", playerName: "Talisca" };
  assert.equal(social.validateRating({ ...base, rating: 0 }).reason, "rating-range");
  assert.equal(social.validateRating({ ...base, rating: 11 }).reason, "rating-range");
  assert.equal(social.validateRating({ ...base, rating: 7.5 }).reason, "rating-range");
  assert.equal(social.validateRating({ ...base, rating: "8" }).value.rating, 8);
  // `Number(null) === 0` tuzağı: boş değer 0 puana dönüşmemeli.
  assert.equal(social.validateRating({ ...base, rating: null }).reason, "rating-range");
  assert.equal(social.validateRating({ ...base, rating: "" }).reason, "rating-range");
});

test("oyuncusuz ya da maçsız puan reddedilir", () => {
  assert.equal(social.validateRating({ playerName: "X", rating: 5 }).reason, "match-required");
  assert.equal(social.validateRating({ matchSlug: "m", rating: 5 }).reason, "player-required");
  assert.equal(social.validateRating({ matchSlug: "m", playerName: "!!!", rating: 5 }).reason, "player-required");
});

test("oyuncu anahtarı Türkçe harfe duyarsız — aynı oyuncu bölünmez", () => {
  assert.equal(social.playerKey("İrfan Can Kahveci"), social.playerKey("Irfan Can Kahveci"));
  assert.equal(social.playerKey("Şükrü Özyıldız"), social.playerKey("Sukru Ozyildiz"));
  assert.ok(social.playerKey("Anderson Talisca").length > 0);
});

test("ortalama hesaplanır, saklanmaz; tek ondalık", () => {
  const rows = [
    { player_key: "talisca", player_name: "Talisca", rating: 9, voter_key: "v1" },
    { player_key: "talisca", player_name: "Talisca", rating: 8, voter_key: "v2" },
    { player_key: "talisca", player_name: "Talisca", rating: 7, voter_key: "v3" },
    { player_key: "fred", player_name: "Fred", rating: 5, voter_key: "v1" }
  ];
  const summary = social.summarizeRatings(rows, "v1");
  assert.equal(summary[0].playerKey, "talisca");
  assert.equal(summary[0].average, 8, "(9+8+7)/3");
  assert.equal(summary[0].votes, 3);
  assert.equal(summary[0].mine, 9, "okuyucunun kendi puanı işaretli");
  assert.equal(summary[1].playerKey, "fred");
  assert.equal(summary[1].mine, 5);
});

test("ortalama iki basamaklı sahte kesinlik iddia etmez", () => {
  const rows = [
    { player_key: "p", player_name: "P", rating: 8, voter_key: "a" },
    { player_key: "p", player_name: "P", rating: 9, voter_key: "b" },
    { player_key: "p", player_name: "P", rating: 9, voter_key: "c" }
  ];
  // 26/3 = 8.666… → 8.7
  assert.equal(social.summarizeRatings(rows, "").average, undefined);
  assert.equal(social.summarizeRatings(rows, "")[0].average, 8.7);
});

test("oy vermeyen okuyucunun 'benim puanım' alanı boş", () => {
  const rows = [{ player_key: "p", player_name: "P", rating: 6, voter_key: "someone" }];
  assert.equal(social.summarizeRatings(rows, "baskasi")[0].mine, null);
});

if (failures) {
  console.error(`match-social: ${failures} test başarısız.`);
  process.exit(1);
}
console.log("match-social OK");
