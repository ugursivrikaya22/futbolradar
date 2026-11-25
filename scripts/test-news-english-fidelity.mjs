#!/usr/bin/env node
/**
 * ŞABLONLU HABERLERİN İNGİLİZCESİ TÜRKÇEYE SADIK KALIR.
 *
 * Şablonlu Türkçe haber, özneyi ve tutarı gövdeye yazar; İngilizcesi
 * yapısal alanlardan kurulur. Eskiden:
 *   • 78 haberin İngilizcesi özneyi düşürüyordu ("the matter in question"),
 *   • 6'sı tutarı düşürüyordu,
 *   • 8'i tutarı çevrilmemiş Türkçe parça olarak basıyordu
 *     ("The figure being discussed is 80 milyon euro.").
 * Bu test hem işlevleri hem de data/news.json içindeki tüm kayıtları sınar.
 *
 *   node scripts/test-news-english-fidelity.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { amountEn, recoverDetailsFromTurkish, buildEnglishArticle, subjectEn } = require("../services/sporxNews.js");

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.log(`  FAIL ${name} — ${String(error.message).split("\n")[0]}`);
    failures.push(name);
  }
}

console.log("news-english-fidelity");

// --- 1. Tutarın İngilizcesi: rakam değişmez, ölçek ve birim yazılır --------
check("amountEn: milyon/bin/TL/dolar biçimleri", () => {
  assert.equal(amountEn("80 milyon euro"), "€80 million");
  assert.equal(amountEn("35 milyon avro"), "€35 million");
  assert.equal(amountEn("7.2 milyon euro"), "€7.2 million");
  assert.equal(amountEn("3,15 milyon Euro"), "€3.15 million");
  assert.equal(amountEn("500 bin euro"), "€500,000");
  assert.equal(amountEn("250 milyon TL"), "250 million Turkish lira");
  assert.equal(amountEn("5 milyon dolar"), "$5 million");
  assert.equal(amountEn("3 milyon €"), "€3 million");
});
check("amountEn: çözülemeyen metin boş döner (ham Türkçe basılmaz)", () => {
  assert.equal(amountEn(""), "");
  assert.equal(amountEn(null), "");
  assert.equal(amountEn("yüksek bir bonservis"), "");
});

// --- 2. Türkçe gövdeden özne ve tutar --------------------------------------
const turkish = (...body) => ({ body });
check("recoverDetailsFromTurkish: özne ve tutarı gövde cümlesinden alır", () => {
  const d = recoverDetailsFromTurkish(turkish(
    "Sporx'in haberine göre ...",
    "Gündemdeki isim Okan Buruk olarak öne çıkıyor. Aktarılan tutar 20 milyon Euro olarak konuşuluyor."));
  assert.deepEqual(d, { player: "Okan Buruk", amount: "20 milyon Euro" });
});
check("recoverDetailsFromTurkish: kişi adı olmayan parçalar özne sayılmaz", () => {
  for (const noise of ["İşte", "İşte Konferans", "Şampiyonlar", "Kadın Futbol", "IN Trio"]) {
    const d = recoverDetailsFromTurkish(turkish(`Gündemdeki isim ${noise} olarak öne çıkıyor.`));
    assert.equal(d.player, "", `${noise} özne olmamalı`);
  }
});
check("recoverDetailsFromTurkish: cümle yoksa boş", () => {
  assert.deepEqual(recoverDetailsFromTurkish(turkish("Başka bir cümle.")), { player: "", amount: "" });
  assert.deepEqual(recoverDetailsFromTurkish({}), { player: "", amount: "" });
});

// --- 3. Kurucu: ham Türkçe tutar İngilizce sayfaya girmez -------------------
check("buildEnglishArticle: tutar çevrilerek girer, 'milyon' kalmaz", () => {
  const article = buildEnglishArticle({
    team: "Galatasaray", player: "Okan Buruk", eventType: "statement", confidence: "reported",
    amount: "80 milyon euro", sourceName: "Sporx", category: "Galatasaray", slug: "x", tags: ["Galatasaray"]
  });
  const body = article.body.join(" ");
  assert.match(body, /The name in the spotlight is Okan Buruk\./);
  assert.match(body, /The figure being discussed is €80 million\./);
  assert.doesNotMatch(body, /milyon/);
});
check("buildEnglishArticle: çözülemeyen tutar cümleye girmez", () => {
  const article = buildEnglishArticle({
    team: "Galatasaray", player: "", eventType: "statement", confidence: "reported",
    amount: "yüksek bir bonservis", sourceName: "Sporx", category: "Galatasaray", slug: "x", tags: []
  });
  assert.doesNotMatch(article.body.join(" "), /figure being discussed/);
});

// --- 4. Veri: data/news.json içindeki her şablonlu haber --------------------
const news = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "news.json"), "utf8"));
const templated = news.filter((article) => article.en && article.discovery && article.discovery.eventType);
const englishText = (article) => [article.en.title, article.en.summary, article.en.spot, ...(article.en.body || [])].join(" ");

check(`${templated.length} şablonlu haberde İngilizce tutar çevrilmiş (Türkçe sözcük yok)`, () => {
  const leaked = templated.filter((article) => /The figure being discussed is [^.]*(milyon|\bavro\b|\bbin\b|\btl\b|dolar)/i.test(englishText(article)));
  assert.equal(leaked.length, 0, leaked.slice(0, 5).map((article) => article.slug).join(", "));
});

check("Türkçe gövde tutar taşıyorsa İngilizcesi de aynı tutarı taşır", () => {
  const lost = [];
  for (const article of templated) {
    const { amount } = recoverDetailsFromTurkish(article);
    const money = amountEn(amount);
    if (money && !englishText(article).includes(`The figure being discussed is ${money}.`)) lost.push(`${article.slug} (${amount})`);
  }
  assert.equal(lost.length, 0, lost.slice(0, 5).join(", "));
});

// Lakap gibi, kişi adı olmadığı için elle ÇEVRİLEN özneler: İngilizcede özgün
// yazımla değil karşılığıyla bulunur. Yeni bir istisna eklemek bilinçli bir karar olmalı.
const TRANSLATED_SUBJECTS = new Map([["İstanbul Kralı", "King of Istanbul"]]);

check("Türkçe gövde özne taşıyorsa İngilizcesi de aynı özneyi taşır", () => {
  const lost = [];
  for (const article of templated) {
    const { player } = recoverDetailsFromTurkish(article);
    // İngilizce yazıma çevrilebilen özne (Türkçe kalıntı koruması geçmeli).
    const english = TRANSLATED_SUBJECTS.get(player) || (player ? subjectEn(player) : "");
    if (english && !englishText(article).includes(english)) lost.push(`${article.slug} (${player})`);
  }
  assert.equal(lost.length, 0, `${lost.length}: ${lost.slice(0, 5).join(", ")}`);
});

if (failures.length) {
  console.error(`\nnews-english-fidelity FAILED (${failures.length}):`);
  failures.forEach((name) => console.error(`  - ${name}`));
  process.exit(1);
}
console.log("\nnews-english-fidelity passed");
