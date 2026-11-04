/**
 * İÇERİK TEKRARI KORUMASI. X aynı metni ikinci kez reddeder (duplicate) ve
 * otomasyon kuralları tekrarlayan içeriği yasaklar. İki katman:
 *  1) olay anahtarı (`goal:<olay>`, `result:af:<id>` …) — store.js
 *  2) içerik özeti (`hash:<sha256>`): işaretler/bağlantılar/boşluklar
 *     atılıp küçük harfe çevrilmiş metnin özeti. Aynı tabloya ayrı satır
 *     olarak yazılır → yeni Supabase göçü gerekmez.
 * Yerel kuru koşu için dosya tabanlı depo (`createFileDedupe`).
 */
const crypto = require("crypto");

function normalizeForHash(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/🤖\s*Otomatik/gi, "")
    .replace(/#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function contentHash(text) {
  return crypto.createHash("sha256").update(normalizeForHash(text)).digest("hex").slice(0, 32);
}

function hashKey(text) { return `hash:${contentHash(text)}`; }

/** JSON dosyasında anahtar kümesi (yerel/kuru koşu). Yazma hatası yutulur. */
function createFileDedupe(file) {
  const fs = require("fs");
  let set;
  const load = () => {
    if (set) return set;
    try { set = new Set(JSON.parse(fs.readFileSync(file, "utf8")).keys || []); } catch { set = new Set(); }
    return set;
  };
  return {
    has(key) { return load().has(key); },
    add(key) {
      load().add(key);
      try { fs.mkdirSync(require("path").dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ keys: [...set].slice(-5000) })); } catch { /* yoksay */ }
    },
    size() { return load().size; }
  };
}

function createMemoryDedupe() {
  const set = new Set();
  return { has: (k) => set.has(k), add: (k) => { set.add(k); }, size: () => set.size };
}

module.exports = { normalizeForHash, contentHash, hashKey, createFileDedupe, createMemoryDedupe };
