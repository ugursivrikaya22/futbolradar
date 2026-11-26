/**
 * Şablon artıkları: ters tırnak, boş değişken ve yer tutucular görünür
 * metinde kalmamalı; kod bölgeleri ve temiz metin olduğu gibi kalmalı.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { POSTPROCESS_CHAIN } from "./lib/postprocessChain.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { cleanVisibleText, cleanTemplateLeaks, cleanProviderName, isDanglingLabel } = require("../services/templateLeaks.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}
const clean = (html) => cleanTemplateLeaks(html);

// --- Metin onarımı ---
expect(cleanVisibleText("York`s LNER Community Stadium").text === "York's LNER Community Stadium", "harf`harf apostrofa dönmeli");
expect(cleanVisibleText("Kayıt `sources` anahtarı").text === "Kayıt sources anahtarı", "kod aralığı işareti atılır, içerik kalır");
expect(cleanVisibleText("Veri kapsamı `").text === "Veri kapsamı", "yarım kalmış ters tırnak atılır");
expect(cleanVisibleText("Skor ${home}-${away}").text === "Skor -", "doldurulmamış ${} yer tutucusu atılır");
expect(cleanVisibleText("Skor {{home}}").text === "Skor", "{{}} yer tutucusu atılır");
expect(cleanVisibleText("Skor 2-1").changed === false, "temiz metin değişmez");
expect(cleanVisibleText("   \n    ").changed === false, "girinti/satır sonu düğümüne dokunulmaz");
expect(cleanProviderName("York`s LNER Community Stadium") === "York's LNER Community Stadium", "sağlayıcı adı onarılır");
expect(cleanProviderName(null) === null && cleanProviderName("") === null, "boş ad null kalır, uydurulmaz");
expect(isDanglingLabel("Veri kapsamı") && isDanglingLabel("Veri kapsamı:") && !isDanglingLabel("Veri kapsamı %14"), "boş etiket tespiti");

// --- HTML ---
{
  const r = clean("<div><em>Veri kapsamı `</em><span>x</span></div>");
  expect(r.html === "<div><span>x</span></div>", `değersiz "Veri kapsamı" etiketi öğesiyle kalkar: ${r.html}`);
  expect(clean("<em>Veri kapsamı undefined</em>").html === "", "etiket + undefined → öğe kalkar");
  expect(clean("<em>Veri kapsamı ${coverage}</em>").html === "", "etiket + yer tutucu → öğe kalkar");
  const keep = "<em>Veri kapsamı %14</em>";
  expect(clean(keep).html === keep && !clean(keep).changed, "değerli etiket olduğu gibi kalır");
  const meta = clean('<meta name="description" content="York`s stadı">');
  expect(meta.html.includes("York's stadı"), "meta açıklaması onarılır");
  const protectedHtml = "<pre>`kod`</pre><code>`x`</code><script>var a=`${x}`</script><!-- `c` -->";
  expect(clean(protectedHtml).html === protectedHtml, "kod bölgeleri ve yorumlar korunur");
  const ld = clean('<script type="application/ld+json">{"name":"York`s LNER"}</script>');
  expect(ld.html.includes("York's LNER") && JSON.parse(ld.html.match(/>([^<]+)</)[1]).name === "York's LNER", "JSON-LD apostrofu onarılır ve JSON geçerli kalır");
  const twice = clean(clean("<p>York`s ve `x`</p>").html);
  expect(!twice.changed, "idempotent");
  expect(clean("<p>Skor null kadar</p>").leaks.includes("empty-variable"), "serbest 'null' jetonu bildirilir");
}

// --- Zincir ---
{
  const ids = POSTPROCESS_CHAIN.map((step) => step.id);
  expect(ids.includes("template-leaks"), "son işlem zincirinde template-leaks adımı var");
  expect(ids.indexOf("template-leaks") < ids.indexOf("normalize-meta"), "template-leaks, normalize-meta'dan önce koşar");
  expect(fs.existsSync(path.join(root, "scripts", "clean-template-leaks.mjs")), "adım betiği diskte");
}

// --- Gerçek sayfalar: analiz yüzeylerinde sızıntı kalmamalı ---
{
  const dirs = ["mac-raporu", "mac", "mac-dosyasi"];
  const files = ["analizler.html", "mac-merkezi.html", "bugunun-maclari.html", "istatistik-merkezi.html"];
  for (const dir of dirs) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full)) if (name.endsWith(".html")) files.push(path.join(dir, name));
  }
  const dirty = [];
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    if (!/[`]|\$\{|\{\{|%\{|undefined|\bnull\b|NaN|\[object Object\]/.test(html)) continue;
    const result = cleanTemplateLeaks(html);
    if (result.leaks.length) dirty.push(`${rel} (${result.leaks.join(",")})`);
  }
  expect(dirty.length === 0, `analiz sayfalarında şablon artığı: ${dirty.slice(0, 5).join("; ")}`);
}

// --- Veri: sağlayıcı adlarında ters tırnak apostrof kalmamalı ---
for (const rel of ["data/fixture-calendar.json", "data/historical-match-archive.json", "data/post-match-reports.json", "data/season-archive.json"]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  expect(!/\p{L}`\p{L}/u.test(fs.readFileSync(file, "utf8")), `${rel}: harf\`harf (ters tırnak apostrof) kalmamalı`);
}

if (failures) {
  console.error(`${failures} test failed.`);
  process.exit(1);
}
console.log("template leak tests passed");
