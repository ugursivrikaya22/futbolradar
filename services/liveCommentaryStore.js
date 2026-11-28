/**
 * BİTMİŞ MAÇ ANLATIMININ KALICI KOPYASI.
 *
 * Veri katmanı bu repoda JSON dosyasıdır (`data/live-commentary.json`),
 * tahmin deposu ve maç siciliyle aynı yerde. Sunucusuz ortamda disk çoğu
 * zaman salt okunur; yazma o zaman sessizce düşer ve süreç içi kopya ile
 * CDN'deki son yanıt kalır. Dosya yazılabildiğinde bir sonraki derleme
 * satırları maç sayfasına basar, böylece maç bittikten sonra anlatım
 * sayfada durur.
 *
 * Şema değişmez. Supabase tablosu eklenmez.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(process.cwd(), "data", "live-commentary.json");
const MAX_MATCHES = 200;
const memory = new Map();

function emptyArchive() {
  return { version: 1, updatedAt: null, matches: {} };
}

function bundled() {
  try {
    const data = require("../data/live-commentary.json");
    if (data && typeof data === "object" && data.matches && typeof data.matches === "object") return data;
  } catch {
    /* Dosya yoksa boş arşiv. */
  }
  return emptyArchive();
}

function readArchive() {
  try {
    const disk = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (disk && disk.matches && typeof disk.matches === "object") {
      const diskCount = Object.keys(disk.matches).length;
      const bundledCount = Object.keys(bundled().matches).length;
      if (diskCount >= bundledCount) return disk;
    }
  } catch {
    /* Salt okunur ya da henüz yazılmamış. */
  }
  return bundled();
}

function read(fixtureId) {
  const key = String(fixtureId || "").trim();
  if (!key) return null;
  if (memory.has(key)) return memory.get(key);
  const saved = readArchive().matches[key];
  return saved && typeof saved === "object" ? saved : null;
}

function remember(snapshot, file) {
  const key = String(snapshot && snapshot.fixtureId || "").trim();
  if (!key || !snapshot || snapshot.final !== true || snapshot.enabled !== true) return false;
  const record = { ...snapshot, savedAt: new Date().toISOString() };
  memory.set(key, record);

  const target = file || FILE;
  try {
    const archive = file ? emptyArchive() : readArchive();
    if (file) {
      try {
        const existing = JSON.parse(fs.readFileSync(target, "utf8"));
        if (existing && existing.matches) archive.matches = existing.matches;
      } catch {
        archive.matches = {};
      }
    }
    archive.matches[key] = record;
    const keys = Object.keys(archive.matches);
    if (keys.length > MAX_MATCHES) {
      keys
        .sort((left, right) => String((archive.matches[left] && archive.matches[left].savedAt) || "").localeCompare(String((archive.matches[right] && archive.matches[right].savedAt) || "")))
        .slice(0, keys.length - MAX_MATCHES)
        .forEach((stale) => { delete archive.matches[stale]; });
    }
    archive.version = 1;
    archive.updatedAt = record.savedAt;
    fs.writeFileSync(target, `${JSON.stringify(archive, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  FILE,
  read,
  remember
};
