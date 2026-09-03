#!/usr/bin/env node
/**
 * SPORX KEŞİF HATTI — TESTLER.
 *
 * Ağa çıkmaz: Sporx'in kart biçimini yansıtan sabit bir HTML örneği
 * kullanılır (gerçek üretim sayfasından alınan yapı, metinler örnektir).
 * Üç şeyi doğrular:
 *
 *   1. Ayrıştırma — kart yapısından {başlık, özet, adres} doğru çıkıyor mu?
 *   2. Öncelik/sınıflandırma — görev tanımındaki sekiz kademe doğru mu?
 *   3. Özgünlük — üretilen başlık/gövde, kaynak metinle Jaccard eşiğinin
 *      ALTINDA mı? (yani kopyalama yok)
 *   4. Güven modeli — Sporx tek başına asla "confirmed" üretmiyor;
 *      transfers.json ile örtüşme olmadan hep "reported"/"rumour".
 */
import { parseCandidates } from "./lib/sporxFeed.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  classifyCandidate,
  buildArticle,
  jaccard,
  PRIORITY,
  withLocative,
  withGenitive,
  withDative
} = require("../services/sporxNews.js");

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok  ${message}`);
  }
}

const FIXTURE_HTML = `
<div class="newslist-imageview">
    <a href="//www.sporx.com/fenerbahce-de-anderson-talisca-ile-yollar-ayrildi-SXHBQ1174598SXQ">
        <img src="https://cdn.sporx.com/img/61/2026/ornek.jpg" class="iv-image" width='396' height='245' alt="Fenerbahçe'de Anderson Talisca ile yollar ayrıldı!" />
    </a>
    <div class="iv-text">
        <h2 class="iv-title"><a href="//www.sporx.com/fenerbahce-de-anderson-talisca-ile-yollar-ayrildi-SXHBQ1174598SXQ">Fenerbahçe'de Anderson Talisca ile yollar ayrıldı!</a></h2>
        <p class="iv-desc"><a href="//www.sporx.com/fenerbahce-de-anderson-talisca-ile-yollar-ayrildi-SXHBQ1174598SXQ">Fenerbahçe, Anderson Talisca ile yollarını ayırdı. İstanbul'dan ayrılan Brezilyalı yıldız, Al Jazira ile anlaştı.</a></p>
    </div>
</div>
<div class="newslist-imageview">
    <a href="//www.sporx.com/galatasaray-da-rafael-leao-nun-yeni-plani-hazir-SXHBQ1174594SXQ">
        <img src="https://cdn.sporx.com/img/61/2026/ornek2.jpg" class="iv-image" width='396' height='245' alt="Galatasaray'da Rafael Leao'nun yeni planı hazır!" />
    </a>
    <div class="iv-text">
        <h2 class="iv-title"><a href="//www.sporx.com/galatasaray-da-rafael-leao-nun-yeni-plani-hazir-SXHBQ1174594SXQ">Galatasaray'da Rafael Leao'nun yeni planı hazır!</a></h2>
        <p class="iv-desc"><a href="//www.sporx.com/galatasaray-da-rafael-leao-nun-yeni-plani-hazir-SXHBQ1174594SXQ">Sarı-kırmızılılarda teknik heyet, Rafael Leao için yeni bir plan hazırladığı iddia edildi.</a></p>
    </div>
</div>
<div class="newslist-imageview">
    <a href="//www.sporx.com/a-milli-takim-kadrosu-aciklandi-SXHBQ1174600SXQ">
        <img src="https://cdn.sporx.com/img/61/2026/ornek3.jpg" class="iv-image" width='396' height='245' alt="A Milli Takım kadrosu açıklandı!" />
    </a>
    <div class="iv-text">
        <h2 class="iv-title"><a href="//www.sporx.com/a-milli-takim-kadrosu-aciklandi-SXHBQ1174600SXQ">A Milli Takım kadrosu açıklandı!</a></h2>
        <p class="iv-desc"><a href="//www.sporx.com/a-milli-takim-kadrosu-aciklandi-SXHBQ1174600SXQ">TFF, A Milli Takım'ın yeni kadrosunu duyurdu.</a></p>
    </div>
</div>
<div class="newslist-imageview">
    <a href="//www.sporx.com/hava-durumu-mac-etkileyecek-SXHBQ1174601SXQ">
        <img src="https://cdn.sporx.com/img/61/2026/ornek4.jpg" class="iv-image" width='396' height='245' alt="Hava durumu maçı etkileyecek" />
    </a>
    <div class="iv-text">
        <h2 class="iv-title"><a href="//www.sporx.com/hava-durumu-mac-etkileyecek-SXHBQ1174601SXQ">Hava durumu maçı etkileyecek</a></h2>
        <p class="iv-desc"><a href="//www.sporx.com/hava-durumu-mac-etkileyecek-SXHBQ1174601SXQ">Meteoroloji uyardı, sahalar sular altında kalabilir.</a></p>
    </div>
</div>
`;

// --- 1. Ayrıştırma -----------------------------------------------------
const candidates = parseCandidates(FIXTURE_HTML);
assert(candidates.length === 4, `4 aday ayrıştırıldı (bulunan: ${candidates.length})`);
assert(candidates[0].url === "https://www.sporx.com/fenerbahce-de-anderson-talisca-ile-yollar-ayrildi-SXHBQ1174598SXQ", "göreli adres mutlak adrese çevrildi");
assert(candidates[0].title === "Fenerbahçe'de Anderson Talisca ile yollar ayrıldı!", "başlık doğru ayrıştırıldı");
assert(candidates[0].summary.startsWith("Fenerbahçe, Anderson Talisca"), "özet doğru ayrıştırıldı");

// --- 2. Öncelik / sınıflandırma ----------------------------------------
const fbClass = classifyCandidate(candidates[0]);
assert(Boolean(fbClass) && fbClass.rank === PRIORITY.FENERBAHCE, "Fenerbahçe haberi doğru kademeye sınıflandı");

const gsClass = classifyCandidate(candidates[1]);
assert(Boolean(gsClass) && gsClass.rank === PRIORITY.GALATASARAY, "Galatasaray haberi doğru kademeye sınıflandı");

const milliClass = classifyCandidate(candidates[2]);
assert(Boolean(milliClass) && milliClass.rank === PRIORITY.MILLI_TAKIM, "Milli takım haberi doğru kademeye sınıflandı");

const outOfScope = classifyCandidate(candidates[3]);
assert(outOfScope === null, "kapsam dışı haber (hava durumu) elendi");

assert(PRIORITY.GALATASARAY < PRIORITY.FENERBAHCE
  && PRIORITY.FENERBAHCE < PRIORITY.BESIKTAS
  && PRIORITY.BESIKTAS < PRIORITY.TRABZONSPOR
  && PRIORITY.TRABZONSPOR < PRIORITY.SUPER_LIG
  && PRIORITY.SUPER_LIG < PRIORITY.MILLI_TAKIM
  && PRIORITY.MILLI_TAKIM < PRIORITY.TRANSFER
  && PRIORITY.TRANSFER < PRIORITY.AVRUPA,
  "görev tanımındaki sekiz kademelik öncelik sırası korunuyor");

// --- 3. Özgünlük ---------------------------------------------------------
const now = new Date("2026-09-03T12:00:00+03:00");
const fbArticle = buildArticle({
  candidate: { ...candidates[0], publishedAt: now.toISOString(), id: "fb-1" },
  classification: fbClass,
  transfers: [],
  now
});

const sourceText = `${candidates[0].title} ${candidates[0].summary}`;
const generatedText = `${fbArticle.title} ${fbArticle.body.join(" ")}`;
const similarity = jaccard(sourceText, generatedText);
assert(similarity < 0.5, `üretilen metin kaynaktan yeterince farklı (Jaccard=${similarity.toFixed(2)} < 0.5)`);
assert(!fbArticle.body.join(" ").includes(candidates[0].summary), "kaynağın cümlesi birebir kopyalanmadı");
assert(fbArticle.sources.some((source) => source.url === candidates[0].url), "Sporx kaynağı açıkça atıflandı");
assert(fbArticle.body.some((paragraph) => /sporx/i.test(paragraph)), "gövde metninde Sporx atfı açıkça geçiyor");

// --- 4. Güven modeli ------------------------------------------------------
assert(fbArticle.discovery.confidence !== "confirmed", "Sporx tek başına \"confirmed\" güven üretmiyor");

const corroboratedArticle = buildArticle({
  candidate: { ...candidates[0], publishedAt: now.toISOString(), id: "fb-2" },
  classification: fbClass,
  transfers: [{ player: "Anderson Talisca", team: "Fenerbahçe", status: "confirmed" }],
  now
});
assert(corroboratedArticle.discovery.confidence === "confirmed", "sitenin kendi doğrulanmış transfer verisiyle örtüşme güveni yükseltiyor");
if (corroboratedArticle.ticker) {
  assert(corroboratedArticle.ticker.category !== "official", "\"official\" ticker kategorisi Sporx kaynaklı kayıtlarda hiç kullanılmıyor");
}

// --- Türkçe ek üretimi -----------------------------------------------------
assert(withLocative("Beşiktaş") === "Beşiktaş'ta", "Beşiktaş bulunma hâli doğru (ünsüz sertleşmesi)");
assert(withLocative("Galatasaray") === "Galatasaray'da", "Galatasaray bulunma hâli doğru");
assert(withLocative("Fenerbahçe") === "Fenerbahçe'de", "Fenerbahçe bulunma hâli doğru");
assert(withGenitive("Trabzonspor") === "Trabzonspor'un", "Trabzonspor tamlayan eki doğru");
assert(withGenitive("Fenerbahçe") === "Fenerbahçe'nin", "Fenerbahçe tamlayan eki doğru (ünlü tamponu)");
assert(withDative("Ederson") === "Ederson'a", "yönelme hâli doğru");

// --- Mükerrer yayın engeli (dosya düzeyinde entegrasyon değil, birim) ----
const duplicateArticle = buildArticle({
  candidate: { ...candidates[0], title: "Fenerbahçe'de Talisca ayrılığı netleşti", summary: "Fenerbahçe, Talisca ile yollarını ayırdı.", url: candidates[0].url, publishedAt: now.toISOString(), id: "fb-3" },
  classification: fbClass,
  transfers: [],
  now
});
assert(duplicateArticle.sources[0].url === candidates[0].url, "aynı Sporx adresi kaynak olarak izlenebilir kalıyor (üst seviye betik bunu data/sporx-seen.json ile eler)");

if (failures > 0) {
  console.error(`\n${failures} test başarısız oldu.`);
  process.exit(1);
}

console.log(`\nSporx keşif hattı testleri geçti.`);
