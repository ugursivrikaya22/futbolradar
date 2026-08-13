#!/usr/bin/env node
/**
 * SON İŞLEM ZİNCİRİ TESTLERİ — sessiz sapmayı bekçiye bağla.
 *
 * Bu testin var oluş nedeni gerçek bir olay: saatlik derleme kuyruğu, tam
 * derlemenin son işlem zincirinin elle kopyalanmış bir alt kümesiydi.
 * Zincire `inject-hreflang` ve `inject-asset-version` eklendiğinde saatlik
 * kuyruk güncellenmedi. Saatlik koşu sayfaları yeniden ürettiği için her
 * koşu bu iki bloğu SİLDİ — ve kimse fark etmedi, çünkü tam derleme
 * (haftada bir) doğru çıktı üretiyordu; arada kalan onlarca saatlik koşu
 * onu geri alıyordu.
 *
 * Hata sınıfı "unutulan ikinci liste". Testler o sınıfı hedefliyor:
 * zincirin İKİ tüketicisi de listeyi türetmek zorunda, kopyalamak değil.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { POSTPROCESS_CHAIN, postprocessCommandLine } from "./lib/postprocessChain.mjs";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

console.log("postprocess-chain");

// ── 1. Zincirin kendisi tutarlı ────────────────────────────────────────────
{
  assert.ok(POSTPROCESS_CHAIN.length > 0, "zincir boş olamaz");

  const ids = POSTPROCESS_CHAIN.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length, `zincirde kopya adım kimliği var: ${ids.join(", ")}`);

  for (const step of POSTPROCESS_CHAIN) {
    assert.ok(
      fs.existsSync(path.join(root, "scripts", step.script)),
      `${step.id}: scripts/${step.script} yok`
    );
    assert.ok(Array.isArray(step.args), `${step.id}: args dizi olmalı`);
    assert.ok(
      Number.isFinite(step.timeoutMinutes) && step.timeoutMinutes > 0,
      `${step.id}: timeoutMinutes pozitif bir sayı olmalı`
    );
  }
}

// ── 2. Sıra: varlık damgası EN SONDA ───────────────────────────────────────
//
// `inject-asset-version` kendinden önceki adımların eklediği varlık
// başvurularını da damgalamak zorunda. Araya bir adım girerse o adımın
// yazdığı `page.css` başvurusu sürümsüz kalır ve bir yıllık `immutable`
// önbellek okuyucuyu eski dosyaya kilitler.
{
  const last = POSTPROCESS_CHAIN[POSTPROCESS_CHAIN.length - 1];
  assert.equal(
    last.script,
    "inject-asset-version.mjs",
    `varlık damgası zincirin son adımı olmalı; şu an son adım: ${last.script}`
  );
}

// ── 3. npm `postprocess` zinciri ÇALIŞTIRICIDAN geçmeli ────────────────────
//
// Betik yeniden `&&` ile dizilmiş bir komut satırına dönerse zincir yine
// iki yerde tanımlanmış olur — düzeltilen hata aynen geri gelir.
{
  const pkg = JSON.parse(read("package.json"));
  const postprocess = pkg.scripts.postprocess || "";
  assert.equal(
    postprocess.trim(),
    "node scripts/postprocess.mjs",
    `npm postprocess zinciri çalıştırıcıdan geçmeli, elle dizilmemeli (mevcut: ${postprocess})`
  );

  // Derleme, son işlemi gerçekten çağırıyor mu?
  assert.match(pkg.scripts.build || "", /npm run postprocess/, "build, postprocess'i çağırmalı");
}

// ── 4. Saatlik kuyruk zinciri TÜRETMELİ ────────────────────────────────────
//
// Asıl bekçi bu. Saatlik derleme adımları `POSTPROCESS_CHAIN` üzerinde
// dönmek zorunda; kuyruğa elle bir enjektör satırı yazılırsa listeler
// yeniden ayrışır.
{
  const source = read("scripts/run-scheduled-update.mjs");
  assert.match(
    source,
    /import \{ POSTPROCESS_CHAIN \} from "\.\/lib\/postprocessChain\.mjs"/,
    "run-scheduled-update.mjs zinciri içe aktarmalı"
  );
  assert.match(
    source,
    /for \(const step of POSTPROCESS_CHAIN\)/,
    "saatlik kuyruk zincir üzerinde dönmeli"
  );

  // Zincirdeki hiçbir betik kuyrukta AYRICA elle çağrılmamalı: hem türetip
  // hem elle yazmak adımı iki kez koşturur.
  const handWritten = POSTPROCESS_CHAIN
    .filter((step) => source.includes(`"${step.script}"`))
    .map((step) => step.script);
  assert.deepEqual(
    handWritten,
    [],
    `saatlik kuyrukta elle yazılmış son işlem adımı var: ${handWritten.join(", ")}`
  );
}

// ── 5. Saatlik ve tam derleme aynı adımları görmeli ────────────────────────
//
// Tam derleme `npm run build` → `npm run postprocess` yolundan, saatlik
// koşu doğrudan zincirden geçiyor. İkisi de aynı listeyi okuduğu için
// kapsam eşit; burada o eşitliği açıkça yazıya döküyoruz ki zincire adım
// ekleyen kişi iki yolun da kapsandığını görsün.
{
  const ids = POSTPROCESS_CHAIN.map((step) => step.id);
  for (const required of ["hreflang", "asset-version", "shared-layout"]) {
    assert.ok(ids.includes(required), `zincirde "${required}" adımı bulunmalı`);
  }
  console.log(`  ok  zincir ${ids.length} adım: ${ids.join(" → ")}`);
  for (const step of POSTPROCESS_CHAIN) console.log(`      ${postprocessCommandLine(step)}`);
}

console.log("postprocess-chain OK");
