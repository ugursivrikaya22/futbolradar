/**
 * KURAL KATALOĞU ÜRETİCİSİ — docs/rules-catalogue.md artık elle yazılmıyor.
 *
 * NEDEN. Bu depoda her eşik ÜÇ yerde geçiyordu: yetkili kaynak (services/*.js),
 * makine okunur defter (rules/registry.json) ve bu doküman. İlk ikisinin
 * eşliği scripts/test-analysis-brain.mjs ile korunuyordu; üçüncüsünü hiçbir
 * test okumuyordu. Bir eşik serviste değiştiğinde defter ve test güncelleniyor,
 * doküman ise SESSİZCE yalan söylemeye başlıyordu. Yanlış bir katalog, hiç
 * katalog tutmamaktan zararlıdır: okuyucuya doğru sandığı bir sayı verir.
 *
 * ÇÖZÜM DAHA ÇOK TEST DEĞİL, DAHA AZ KOPYA. Üçüncü kopya artık bir KARAR
 * NOKTASI değil, defterin bir görünümü. Elle düzenlenecek bir yeri yok:
 * katalogda bir şeyi değiştirmek isteyen kişi defteri düzeltir, defter de
 * kaynağı yansıtmak zorundadır.
 *
 * Üretim `npm run build` zincirinde koşar; scripts/test-analysis-brain.mjs
 * ise dosyanın üretilmiş hâliyle birebir aynı olduğunu doğrular — yani elle
 * yapılmış bir düzenleme testte görünür, sessizce kalmaz.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Satır genişliği: dokümanın geri kalanıyla aynı ölçü. */
const WRAP_COLUMNS = 78;

/** Tablo hücresinde boru işareti tabloyu böler; kaçırılır. */
function cell(text) {
  return String(text == null ? "" : text).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/** Uzun metni sözcük sınırından böler. Markdown satır sonunu boşluk sayar. */
function wrap(text, indent = "") {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length + indent.length > WRAP_COLUMNS && line) {
      lines.push(line);
      line = word;
      continue;
    }
    line = candidate;
  }
  if (line) lines.push(line);

  return lines.map((value, index) => (index === 0 ? value : indent + value)).join("\n");
}

/**
 * Eşik değerinin okunur hâli.
 *
 * Dizi değerler virgülle açılıyor: defterde JSON dizisi olan bir küme,
 * dokümanda köşeli parantezle değil kendi elemanlarıyla okunur.
 */
function thresholdText(threshold) {
  const value = Array.isArray(threshold.value) ? threshold.value.join(", ") : String(threshold.value);
  const unit = threshold.unit ? ` ${threshold.unit}` : "";
  return `\`${threshold.name}\` = ${value}${unit}`;
}

function thresholdsText(rule) {
  if (!rule.thresholds || !rule.thresholds.length) return "—";
  return rule.thresholds.map(thresholdText).join(" · ");
}

function testText(rule) {
  return rule.test ? `\`${rule.test}\`` : "—";
}

/** Kuralları modüle göre, defterdeki sırayı bozmadan gruplar. */
function groupByModule(rules) {
  const groups = new Map();
  for (const rule of rules) {
    if (!groups.has(rule.module)) groups.set(rule.module, []);
    groups.get(rule.module).push(rule);
  }
  return groups;
}

function ruleTable(rules) {
  return [
    "| Kural | Giriş | Ne yapar | Eşikler | Test |",
    "| --- | --- | --- | --- | --- |",
    ...rules.map((rule) => `| \`${cell(rule.id)}\` | \`${cell(rule.entry)}\` | ` +
      `${cell(rule.title)} | ${cell(thresholdsText(rule))} | ${cell(testText(rule))} |`)
  ].join("\n");
}

function rationaleList(rules) {
  return rules
    .map((rule) => `- **\`${rule.id}\`** — ${wrap(rule.rationale, "  ")}`)
    .join("\n");
}

/** Katalogun tamamı. Girdi yalnızca defter; başka hiçbir kaynak okunmaz. */
export function renderCatalogue(registry) {
  const rulesOf = (domainId) => registry.rules.filter((rule) => rule.domain === domainId);
  const testedCount = (rules) => rules.filter((rule) => rule.test).length;

  const lines = [];

  lines.push("# Kural Kataloğu");
  lines.push("");
  lines.push(wrap(
    "Bu katalog `rules/registry.json`'dan ÜRETİLİR — elle düzenlenmez. " +
    "Üreten betik `scripts/generate-rules-catalogue.mjs` ve `npm run build` " +
    "zincirinde koşar; `scripts/test-analysis-brain.mjs` dosyanın üretilmiş " +
    "hâliyle birebir aynı olduğunu doğrular."
  ));
  lines.push("");
  lines.push(wrap(
    "Bir fark görürseniz sıra şudur: katalog ile defter arasında **defter**, " +
    "defter ile kaynak arasında **kaynak** (`services/*.js`) doğrudur. " +
    "Katalogda düzeltilecek bir şey varsa defterde düzeltilir."
  ));
  lines.push("");
  lines.push(wrap(
    "Katalog kural uygulamaz, kural da buradan okunmaz — bu bir dizindir. " +
    "Kayıt biçimi ve yeni kural ekleme sırası [`rules/README.md`](../rules/README.md), " +
    "beynin mimarisi [`docs/analysis-brain.md`](analysis-brain.md) içindedir."
  ));
  lines.push("");
  lines.push("## Nasıl okunur");
  lines.push("");
  lines.push("| Sütun | Anlamı |");
  lines.push("| --- | --- |");
  lines.push("| **Kural** | Defterdeki `id`. Nokta ayraçlı ve benzersizdir. |");
  lines.push("| **Giriş** | Kuralın dosyadan dışa aktarılan adı (`entry`) — kararın verildiği yer. |");
  lines.push("| **Ne yapar** | Kaydın Türkçe kısa başlığı (`title`). Kuralın tek cümlelik tam ifadesi (`statement`) ve basabildiği metinler (`vocabulary`) defterdedir. |");
  lines.push("| **Eşikler** | Kuralın çalıştığı sabitler ve değerleri; birden çok eşik `·` ile ayrılır. `—` eşiksiz kural demektir. |");
  lines.push("| **Test** | Kuralı koruyan dosya. `—` **testi olmayan** kural demektir; bkz. son bölüm. |");
  lines.push("");
  lines.push(wrap(
    "Her tablonun başlığı kuralın yaşadığı dosyadır; tablonun altındaki liste " +
    "her kuralın NEDEN var olduğunu, yani hangi somut hatayı önlediğini söyler."
  ));
  lines.push("");
  lines.push("## Alanlar");
  lines.push("");
  lines.push("| Alan | Başlık | Kural | Testli | Ne sorar |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const domain of registry.domains) {
    const rules = rulesOf(domain.id);
    lines.push(`| \`${cell(domain.id)}\` | ${cell(domain.title)} | ${rules.length} | ` +
      `${testedCount(rules)}/${rules.length} | ${cell(domain.summary)} |`);
  }

  for (const domain of registry.domains) {
    const rules = rulesOf(domain.id);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`## ${domain.title}`);
    lines.push("");
    lines.push(`Alan kimliği: \`${domain.id}\` · ${rules.length} kural`);
    lines.push("");
    lines.push(wrap(domain.summary));

    for (const [module, moduleRules] of groupByModule(rules)) {
      lines.push("");
      lines.push(`### \`${module}\``);
      lines.push("");
      lines.push(ruleTable(moduleRules));
      lines.push("");
      lines.push("**Neden var:**");
      lines.push("");
      lines.push(rationaleList(moduleRules));
    }
  }

  const untested = registry.rules.filter((rule) => !rule.test);

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Testi olmayan kurallar");
  lines.push("");
  lines.push(wrap(
    "Defter korumasız kuralı gizlemez: testi olmayan kayıtta `test` alanı boş " +
    "bırakılır, uydurma bir yol yazılmaz. Bu liste `registrySummary().untested` " +
    "ile birebir aynıdır ve kısalması beklenen bir listedir."
  ));
  lines.push("");

  if (untested.length) {
    lines.push("| Kural | Dosya | Giriş |");
    lines.push("| --- | --- | --- |");
    for (const rule of untested) {
      lines.push(`| \`${cell(rule.id)}\` | \`${cell(rule.module)}\` | \`${cell(rule.entry)}\` |`);
    }
  } else {
    // Boş liste bir hedef, bir hata değil: bunu bir tablo başlığıyla değil
    // cümleyle söylemek doğru — boş tablo "veri gelmedi" gibi okunur.
    lines.push("Şu anda testi olmayan kural yok.");
  }

  lines.push("");
  lines.push(wrap(
    "Korumasız bir kural, ilk yeniden düzenlemede sessizce kaybolabilecek bir " +
    "karardır. Yeni bir test yazıldığında `rules/registry.json` içindeki `test` " +
    "alanı doldurulur ve `package.json` `test` betiğine eklenir."
  ));
  lines.push("");

  return lines.join("\n");
}

export const CATALOGUE_PATH = path.join("docs", "rules-catalogue.md");

/** Betik doğrudan çalıştırıldığında dosyayı yazar. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const root = process.cwd();
  const registry = require(path.join(root, "rules/registry.json"));
  const output = renderCatalogue(registry);
  const target = path.join(root, CATALOGUE_PATH);

  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  fs.writeFileSync(target, output, "utf8");

  console.log(
    `Kural kataloğu üretildi: ${registry.rules.length} kural / ${registry.domains.length} alan` +
    `${previous === output ? " (değişiklik yok)" : " (güncellendi)"}`
  );
}
