/**
 * RADAR YORUMU TASLAĞI OLUŞTUR.
 *
 * Yeni yazı HER ZAMAN `draft` doğar. Bu betik bir yazıyı yayına ALAMAZ;
 * `--status` gibi bir seçenek bilerek yok. Yayın kararı sitenin sesini
 * değiştirir ve bir betiğin kendiliğinden vereceği karar değildir.
 *
 * Taslak yazıldıktan sonra Telegram bildirimi gönderilir. Bildirim bir YAN
 * ETKİDİR: gönderilemezse taslak yine oluşmuş olur ve betik çökmez.
 *
 * Kullanım:
 *   node scripts/create-column-draft.mjs --title="..." --category=mac-yorumu
 *   node scripts/create-column-draft.mjs --title="..." --author="..." --category=lig-analizi \
 *        --tags=fenerbahce,avrupa --excerpt="..." --dry-run
 *
 * --author verilmezse imza "futbolradar" olur (services/columnService.js).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  CATEGORIES,
  COLUMN_AUTHOR,
  slugify,
  presentColumn,
  validateColumn
} = require("../services/columnService.js");
const {
  draftMessage,
  sendTelegramMessage,
  telegramConfig
} = require("../services/telegramNotifier.js");

const STORE = path.join(root, "data", "columns.json");

function parseArgs(argv) {
  const args = { tags: [], dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--title=")) args.title = raw.slice(8);
    else if (raw.startsWith("--author=")) args.author = raw.slice(9);
    else if (raw.startsWith("--category=")) args.category = raw.slice(11);
    else if (raw.startsWith("--excerpt=")) args.excerpt = raw.slice(10);
    else if (raw.startsWith("--tags=")) args.tags = raw.slice(7).split(",").map((tag) => tag.trim()).filter(Boolean);
    else if (raw.startsWith("--date=")) args.date = raw.slice(7);
  }
  return args;
}

function readStore() {
  if (!fs.existsSync(STORE)) return { columns: [] };
  return JSON.parse(fs.readFileSync(STORE, "utf8"));
}

function writeStore(store) {
  const temp = `${STORE}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(temp, STORE);
}

const args = parseArgs(process.argv.slice(2));

if (!args.title || !args.category) {
  console.error(
    "[column] --title ve --category zorunlu. Yazar verilmezse imza " + COLUMN_AUTHOR + " olur.\n" +
    `[column] geçerli kategoriler: ${Object.keys(CATEGORIES).join(", ")}`
  );
  process.exit(1);
}

if (!CATEGORIES[args.category]) {
  console.error(`[column] bilinmeyen kategori: ${args.category}\n[column] geçerli: ${Object.keys(CATEGORIES).join(", ")}`);
  process.exit(1);
}

const store = readStore();
const columns = Array.isArray(store.columns) ? store.columns : [];

const slug = slugify(args.title);
if (!slug) {
  console.error("[column] başlıktan geçerli bir kısa ad üretilemedi.");
  process.exit(1);
}

if (columns.some((entry) => entry && entry.id === slug)) {
  console.error(`[column] bu kısa ad zaten var: ${slug}`);
  process.exit(1);
}

const draft = {
  id: slug,
  slug,
  title: args.title.trim(),
  author: args.author && args.author.trim() ? args.author.trim() : COLUMN_AUTHOR,
  // Tarih üretim anıdır; yayın tarihi yayına alınırken güncellenir.
  date: args.date || new Date().toISOString(),
  category: args.category,
  tags: args.tags,
  // DURUM SABİT: taslak. Betiğin bunu değiştirmesinin yolu yok.
  status: "draft",
  excerpt: args.excerpt ? args.excerpt.trim() : "",
  body: []
};

const verdict = validateColumn(draft);
if (!verdict.valid) {
  console.error(`[column] taslak geçersiz: ${verdict.errors.join("; ")}`);
  process.exit(1);
}

if (args.dryRun) {
  console.log("[column] kuru koşu — dosyaya yazılmadı:");
  console.log(JSON.stringify(draft, null, 2));
} else {
  columns.push(draft);
  writeStore({ ...store, updatedAt: new Date().toISOString(), columns });
  console.log(`[column] taslak oluşturuldu: ${slug} (durum: draft)`);
}

// ── Bildirim ───────────────────────────────────────────────────────────────
//
// Yan etki. Buradan sonra ne olursa olsun taslak yazılmış durumda.
const presented = presentColumn(draft);
const config = telegramConfig();

if (!config.ready) {
  console.warn(
    `[column] Telegram bildirimi GÖNDERİLMEDİ. Eksik değişken: ${config.missing.join(", ")}.\n` +
    "[column] Bu bir çökme değil; taslak oluştu. Bildirim için değişkenleri tanımlayın."
  );
  process.exit(0);
}

const message = draftMessage(presented);
const result = await sendTelegramMessage(message, { dryRun: args.dryRun });

if (result.sent) {
  console.log("[column] Telegram bildirimi gönderildi.");
} else {
  console.warn(`[column] Telegram bildirimi gönderilemedi: ${result.reason}`);
}

// Bildirim başarısızlığı taslağı geçersiz kılmaz.
process.exit(0);
