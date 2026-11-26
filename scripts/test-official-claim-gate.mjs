/**
 * "Resmen" kapısı: resmîlik iddiası taşıyan başlık, resmî kaynak bağlantısı
 * olmadan yayımlanmaz (sayfa, ana sayfa akışı, otomatik giriş).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { claimsOfficial, articleClaimsOfficial, officialClaimCheck } = require("../services/officialClaimGate.js");
const { hasOwnPage, publishableNews } = require("../services/newsFeed.js");
const { allowAutomatedNews } = require("../services/automatedNewsPolicy.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// --- İddia tespiti ---
expect(claimsOfficial("Mohamed Salah Trabzonspor transferi resmen açıklandı"), "resmen yakalanmalı");
expect(claimsOfficial("Mohamed Salah Trabzonspor transferi resmen aciklandi"), "ASCII resmen yakalanmalı");
expect(claimsOfficial("RESMEN: İmza attı") && claimsOfficial("Officially announced: Salah"), "büyük harf ve İngilizce");
expect(!claimsOfficial("Resmî açıklama bekleniyor") && !claimsOfficial("resmenlik"), "yalnızca 'resmen' sözcüğü (türev/komşu sözcük değil)");

// --- Karar ---
const base = { id: "x", slug: "x", status: "verified", body: ["Gövde."], title: "Takım oyuncuyu resmen açıkladı", publishedAt: "2026-11-01T10:00:00+03:00" };
const club = { name: "Kulüp", url: "https://www.trabzonspor.org.tr/news/duyuru" };
const kap = { name: "KAP", url: "https://www.kap.org.tr/tr/Bildirim/1" };
const agency = { name: "AA", url: "https://www.aa.com.tr/tr/spor/x" };

expect(officialClaimCheck({ ...base, sources: [club] }).ok, "kulüp sitesi kaynağı yeter");
expect(officialClaimCheck({ ...base, sources: [kap] }).ok, "KAP kaynağı yeter");
expect(officialClaimCheck({ ...base, sources: [agency, club] }).ok, "ajans + kulüp: kulüp yeter");
const noSource = officialClaimCheck({ ...base, sources: [] });
expect(!noSource.ok && /kaynak bağlantısı yok/.test(noSource.reason), "kaynaksız 'resmen' reddedilmeli");
const agencyOnly = officialClaimCheck({ ...base, sources: [agency] });
expect(!agencyOnly.ok && /resmî ağız/.test(agencyOnly.reason), "yalnızca ajans kaynağı yetmez");
expect(!officialClaimCheck({ ...base, sources: [{ name: "Blog", url: "javascript:alert(1)" }] }).ok, "http(s) olmayan bağlantı kaynak sayılmaz");
expect(officialClaimCheck({ ...base, title: "Takım maç öncesi açıklama yaptı", sources: [] }).ok, "iddia yoksa kural uygulanmaz");
expect(!officialClaimCheck({ ...base, title: "Takım oyuncuyu açıkladı", en: { title: "Club officially announce the player" }, sources: [] }).ok, "İngilizce başlıktaki 'officially' de denetlenir");
expect(!officialClaimCheck({ ...base, title: "Takım oyuncuyu açıkladı", seo: { metaTitle: "Takım oyuncuyu resmen açıkladı" }, sources: [] }).ok, "meta başlıktaki 'resmen' de denetlenir");

// --- Yayın yolları ---
expect(hasOwnPage({ ...base, sources: [club] }), "kapıyı geçen haberin sayfası üretilir");
expect(!hasOwnPage({ ...base, sources: [] }), "kapıyı geçemeyen haberin sayfası üretilmez");
expect(publishableNews([{ ...base, sources: [] }, { ...base, id: "y", slug: "y", title: "Normal haber", sources: [] }]).map((a) => a.id).join() === "y", "ana sayfa akışı kaynaksız 'resmen' haberi dışlar");
expect(!allowAutomatedNews("Galatasaray Leão'yu resmen açıkladı", false), "otomatik giriş: resmî olmayan kaynak + 'resmen' reddedilir");
expect(allowAutomatedNews("Galatasaray Leão'yu resmen açıkladı", true), "otomatik giriş: resmî kaynak + 'resmen' geçer");
expect(allowAutomatedNews("Galatasaray maç öncesi basın toplantısı", false), "otomatik giriş: iddiasız başlık etkilenmez");

// --- Gerçek veri: yayımlanmış hiçbir haber kuralı çiğnemez ---
const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const violations = news.filter((a) => a.status === "verified" && articleClaimsOfficial(a) && !officialClaimCheck(a).ok);
expect(violations.length === 0, `"resmen" başlıklı ama resmî kaynaksız yayımlanmış haber: ${violations.map((a) => a.id).join(", ")}`);
const salah = news.find((a) => a.id === "mohamed-salah-trabzonspor-transferi-resmen-aciklandi");
expect(salah && salah.status === "verified" && officialClaimCheck(salah).ok, "Salah haberi resmî kaynak (kulüp + KAP) taşıyor ve yayında");
expect(salah && salah.sources.some((s) => /trabzonspor\.org\.tr/.test(s.url)) && salah.sources.some((s) => /kap\.org\.tr/.test(s.url)), "Salah haberinin kulüp ve KAP bağlantıları kayıtta");
const oulai = news.find((a) => a.id === "christ-oulai-fiorentina-transferi");
expect(oulai && oulai.status === "archived", "kaynaksız 'resmen' başlıklı Oulai kaydı arşivde (silinmedi)");

if (failures) {
  console.error(`${failures} test failed.`);
  process.exit(1);
}
console.log("official claim gate tests passed");
