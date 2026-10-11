#!/usr/bin/env node
/**
 * MOBİL ÖZET SATIRI — HANGİ MAÇA SABİTLENİR.
 *
 * NEDEN VAR. Öne çıkan maç listesi canlı yoklamada yeniden sıralanıyor:
 * başlayan bir maç öne geçince ilk kart değişiyor. Özet satırı "ilk kartı"
 * izlediği sürece, okuyucu ekranda gördüğü maça dokunup BAŞKA maçın
 * sayfasına düşebiliyordu. Üretim denetiminde ölçüldü (19 Eylül,
 * tıklanabilirlik taraması): bağlantı okunurken "Ankaragücü - Serik Spor"
 * (mac-detay.html?id=1591610), tıklandıktan sonra varılan yer
 * /mac/basaksehir-genclerbirligi-19-eylul-2026.
 *
 * Bu test, satırın hangi kartı izleyeceğine karar veren saf mantığı
 * site.js'ten AYIKLAYIP çalıştırır: kopyalanmış bir sürümü değil, sayfada
 * çalışan kodun kendisini sınar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "site.js"), "utf8");

const block = source.match(/\/\/ summary-pin:start([\s\S]*?)\/\/ summary-pin:end/);
assert.ok(block, "site.js içindeki summary-pin bloğu bulunamadı — işaret yorumları silinmiş olabilir");

// eslint-disable-next-line no-new-func
const { pickSummaryCardIndex, summaryPinKey } = new Function(`${block[1]}; return { pickSummaryCardIndex, summaryPinKey };`)();

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}: ${error.message}`);
  }
}

check("kart yoksa izlenecek satır da yoktur", () => {
  assert.equal(pickSummaryCardIndex([], ""), -1);
  assert.equal(pickSummaryCardIndex(null, "a"), -1);
});

check("sabitlenmiş maç yokken listenin ilki izlenir", () => {
  assert.equal(pickSummaryCardIndex(["a", "b", "c"], ""), 0);
});

check("SIRA DEĞİŞSE DE sabitlenen maç izlenmeye devam eder", () => {
  // Canlı yoklama listeyi yeniden sıraladı: başlayan maç öne geçti.
  // Satır yine kendi maçını göstermeli — bağlantı parmağın altında
  // değişmemeli.
  assert.equal(pickSummaryCardIndex(["basaksehir", "ankaragucu"], "ankaragucu"), 1);
  assert.equal(pickSummaryCardIndex(["x", "y", "ankaragucu"], "ankaragucu"), 2);
});

check("sabitlenen maç listeden düşerse ilk kart devralır", () => {
  assert.equal(pickSummaryCardIndex(["basaksehir", "genclerbirligi"], "ankaragucu"), 0);
});

check("kimlik tam eşleşir — benzer ad başka maçı devralmaz", () => {
  assert.equal(pickSummaryCardIndex(["Ankaragücü|Serik Spor|2026-09-19T19:00:00+03:00"], "Ankaragücü|Serik Spor|2026-09-20T19:00:00+03:00"), 0,
    "aynı takımlar farklı tarihte farklı maçtır; sabitleme kimliğe bağlı");
  assert.equal(
    pickSummaryCardIndex(["Ankaragücü|Serik Spor|2026-09-19T19:00:00+03:00"], "Ankaragücü|Serik Spor|2026-09-19T19:00:00+03:00"),
    0
  );
});

check("İSTEMCİ ÇİZİMİNDEN ÖNCE sabitlenmez (ön-render kartı kilitlenmez)", () => {
  // CI 37996238770: ön-render ilk kartı "Boluspor – Antalyaspor" idi,
  // istemci U19 maçını öne aldı; özet ön-render kartında kilitli kalıp
  // kahraman kartından ayrıştı.
  assert.equal(summaryPinKey(["boluspor", "genclerbirligi"], 0, null, true), "");
  assert.equal(summaryPinKey(["boluspor"], 0, "loading", true), "");
  // Ön-render sonrası istemci listesi geldi: yeni ilk kart izlenir.
  assert.equal(pickSummaryCardIndex(["alanyaspor-u19", "boluspor"], ""), 0);
});

check("istemci çizimi bitince ilk kart sabitlenir; sonraki yeniden sıralamada korunur", () => {
  const keys = ["alanyaspor-u19", "boluspor"];
  const pin = summaryPinKey(keys, pickSummaryCardIndex(keys, ""), "ready", true);
  assert.equal(pin, "alanyaspor-u19");
  assert.equal(pickSummaryCardIndex(["boluspor", "alanyaspor-u19"], pin), 1);
  for (const state of ["fallback", "empty", "unavailable"]) {
    assert.equal(summaryPinKey(keys, 0, state, true), "alanyaspor-u19", `${state} da yerleşmiş durumdur`);
  }
});

check("istemcide çizilmeyen kahramanda hemen sabitlenir; kart yoksa sabit yok", () => {
  assert.equal(summaryPinKey(["a"], 0, null, false), "a");
  assert.equal(summaryPinKey([], -1, "ready", true), "");
});

if (failures) {
  console.error(`\nsummary-pin testi BAŞARISIZ: ${failures} kontrol düştü.`);
  process.exitCode = 1;
} else {
  console.log("\nsummary-pin testi geçti.");
}
