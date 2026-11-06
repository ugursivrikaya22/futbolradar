/**
 * DIŞ BAĞLANTI POLİTİKASI TESTLERİ
 *
 * Politika (services/sourceLinks.js): sitenin kendi URL'leri futbolradar.com,
 * dışarı YALNIZCA kaynak künyesi çıkar. Bu dosya o politikayı kapıya çevirir.
 *
 * Neden test gerekiyor: kaynak bağlantısı elle girilen bir alan. Bir editör
 * (ya da bir üretici araç) listede olmayan bir alan adı yapıştırdığında hiçbir
 * şey kırılmaz — sayfa çalışır, bağlantı da çalışır. Yanlışlık ancak biri
 * fark ederse görünür. Beyaz liste bu sessizliği bozar.
 *
 * Dört kural sınanır:
 *   1. Veri dosyalarındaki her dış alan adı beyaz listede olmalı.
 *   2. Üretilen HTML'deki her kaynak künyesi bağlantısı `nofollow` taşımalı;
 *      sitenin KENDİ hesapları taşımamalı.
 *   3. Sayfaların kendi kimliği (canonical / og:url) futbolradar.com olmalı.
 *   4. Üretici araç izleri (chatgpt.site vb.) hiçbir yerde geçmemeli.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  allowedSourceHosts,
  hostOf,
  isAllowedSourceHost,
  isOwnProfileHost,
  isShareHost,
  isSiteHost,
  SITE_HOST
} = require("../services/sourceLinks.js");

const DATA_FILES = [
  "news.json",
  "news-ticker.json",
  "ticker.json",
  "transfer-donemi-2026-27.json",
  "transfers.json",
  "matches.json",
  "broadcast-verifications.json",
  "columns.json",
  "manager-quotes.json",
  "post-match-reports.json"
];

/** Kök HTML sayfaları; üretilen alt klasörler örneklenerek taranır. */
function rootHtmlFiles() {
  return fs.readdirSync(root)
    .filter((name) => name.endsWith(".html"))
    .map((name) => path.join(root, name));
}

function sampleGeneratedHtml(dir, limit) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((name) => name.endsWith(".html"))
    .slice(0, limit)
    .map((name) => path.join(full, name));
}

// ── 1. Veri dosyalarındaki her dış alan adı beyaz listede ──────────────────
{
  const offenders = new Map();
  let checked = 0;

  // `public/data` yayına giden aynadır: Vercel oradan servis eder. Kaynak
  // dosyayı denetleyip aynayı atlamak, asıl sunulan dosyayı denetimsiz
  // bırakırdı — ayna bir derleme adımıyla üretilse bile kapı ikisini de görür.
  const scanTargets = [];
  for (const dir of ["data", path.join("public", "data")]) {
    for (const file of DATA_FILES) {
      const full = path.join(root, dir, file);
      if (fs.existsSync(full)) scanTargets.push([path.join(dir, file), full]);
    }
  }

  for (const [file, full] of scanTargets) {
    const raw = fs.readFileSync(full, "utf8");

    for (const match of raw.matchAll(/https?:\/\/[^\s"'\\]+/g)) {
      const host = hostOf(match[0]);
      if (!host || isSiteHost(host)) continue;
      checked += 1;
      if (isAllowedSourceHost(host)) continue;
      if (!offenders.has(host)) offenders.set(host, []);
      offenders.get(host).push(`${file}: ${match[0].slice(0, 90)}`);
    }
  }

  assert.equal(
    offenders.size,
    0,
    "Beyaz listede olmayan kaynak alan adı bulundu. Kaynak gerçekten güvenilirse " +
    "services/sourceLinks.js içindeki ALLOWED_SOURCE_HOSTS listesine BİLİNÇLİ olarak " +
    `ekleyin:\n${[...offenders.entries()].map(([host, rows]) => `  ${host}\n    ${rows[0]}`).join("\n")}`
  );

  assert.ok(checked > 0, "veri dosyalarında hiç dış bağlantı bulunamadı — tarama bozuk olabilir");
  console.log(`test-source-links: ${checked} dış bağlantı, ${allowedSourceHosts().length} izinli alan adı.`);
}

// ── 2. HTML: künye `nofollow` taşır, kendi hesap taşımaz ───────────────────
{
  const pages = [
    ...rootHtmlFiles(),
    ...sampleGeneratedHtml("oyuncular", 5),
    ...sampleGeneratedHtml("mac-raporu", 5),
    ...sampleGeneratedHtml("karsilastirma", 3)
  ];

  const missingNofollow = [];
  const wrongNofollow = [];
  const unknownHosts = new Map();
  const missingSecurity = [];
  let anchors = 0;

  for (const page of pages) {
    const html = fs.readFileSync(page, "utf8");
    const rel = path.relative(root, page);

    for (const match of html.matchAll(/<a\b([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/g)) {
      const attrs = `${match[1]} ${match[3]}`;
      const host = hostOf(match[2]);
      if (!host || isSiteHost(host)) continue;

      anchors += 1;
      const relValue = (attrs.match(/rel="([^"]*)"/) || [])[1] || "";
      const tokens = relValue.split(/\s+/).filter(Boolean);

      // Güvenlik öznitelikleri her dış bağlantıda zorunlu: yeni sekmenin
      // `window.opener` üzerinden sayfaya erişmesi engellenmeli.
      if (!tokens.includes("noopener") || !tokens.includes("noreferrer")) {
        missingSecurity.push(`${rel}: ${host} rel="${relValue}"`);
      }

      // Kendi hesap kontrolü TAM ADRESLE yapılır: youtube.com'un tamamı
      // "bizim" değil, yalnızca /@futbolradar. Alıntılanan bir video
      // kimlik bağlantısı sayılıp nofollow'unu kaybetmemeli.
      if (isOwnProfileHost(match[2]) || isShareHost(match[2])) {
        // Kendi hesabı / paylaşım hedefi: alıntı değil, `nofollow` OLMAMALI.
        if (tokens.includes("nofollow")) {
          wrongNofollow.push(`${rel}: ${host}`);
        }
        continue;
      }

      if (!isAllowedSourceHost(host)) {
        if (!unknownHosts.has(host)) unknownHosts.set(host, rel);
        continue;
      }

      // Kaynak künyesi: alıntı, tavsiye değil.
      if (!tokens.includes("nofollow")) {
        missingNofollow.push(`${rel}: ${host}`);
      }
    }
  }

  assert.equal(
    unknownHosts.size,
    0,
    `HTML'de beyaz liste dışı alan adı:\n${[...unknownHosts].map(([h, f]) => `  ${h} (${f})`).join("\n")}`
  );
  assert.equal(
    missingSecurity.length,
    0,
    `Dış bağlantıda noopener/noreferrer eksik:\n  ${missingSecurity.slice(0, 5).join("\n  ")}`
  );
  assert.equal(
    missingNofollow.length,
    0,
    `Kaynak künyesi bağlantısında nofollow eksik:\n  ${[...new Set(missingNofollow)].slice(0, 8).join("\n  ")}`
  );
  assert.equal(
    wrongNofollow.length,
    0,
    "Sitenin kendi hesabına/paylaşım bağlantısına nofollow konmuş — kendi markasını " +
    `inkâr eder:\n  ${[...new Set(wrongNofollow)].slice(0, 5).join("\n  ")}`
  );

  assert.ok(anchors > 0, "HTML'de hiç dış bağlantı bulunamadı — tarama bozuk olabilir");
  console.log(`test-source-links: ${pages.length} sayfada ${anchors} dış bağlantı denetlendi.`);
}

// ── 3. Sayfaların KENDİ kimliği futbolradar.com ────────────────────────────
//
// Dışarı bağlanmak serbest; sitenin kendini TANITTIĞI adres değil.
{
  const wrong = [];
  for (const page of rootHtmlFiles()) {
    const html = fs.readFileSync(page, "utf8");
    const rel = path.relative(root, page);

    const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    const ogUrl = (html.match(/property="og:url" content="([^"]*)"/) || [])[1];

    for (const [label, value] of [["canonical", canonical], ["og:url", ogUrl]]) {
      if (!value) continue;
      if (!isSiteHost(hostOf(value))) wrong.push(`${rel} ${label}=${value}`);
    }
  }

  assert.equal(
    wrong.length,
    0,
    `Sayfa kimliği ${SITE_HOST} altında olmalı:\n  ${wrong.slice(0, 5).join("\n  ")}`
  );
}

// ── 4. Üretici araç izleri ─────────────────────────────────────────────────
//
// Yayımlanan bir sayfada üretici aracın barındırma alan adı görünmemeli:
// hem kırık bir bağlantıdır hem de içeriğin nereden geldiğini sızdırır.
{
  const FORBIDDEN = ["chatgpt.site", "chatgpt.com", "openai.com", "oaiusercontent", "claude.site"];
  // Nested developer worktrees are separate checkouts, not published site content.
  const skipDirs = new Set(["node_modules", ".git", ".worktrees", "public"]);
  const hits = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(html|json|js|mjs|css|md)$/.test(entry.name)) continue;
      // Bu testin kendisi yasaklı dizeleri tanım gereği içerir.
      if (full === path.join(root, "scripts", "test-source-links.mjs")) continue;

      const content = fs.readFileSync(full, "utf8");
      for (const needle of FORBIDDEN) {
        if (content.includes(needle)) hits.push(`${path.relative(root, full)}: ${needle}`);
      }
    }
  }

  walk(root);
  assert.equal(hits.length, 0, `Üretici araç izi bulundu:\n  ${hits.slice(0, 10).join("\n  ")}`);
}

console.log(
  "Dış bağlantı testleri geçti (kaynak beyaz listesi, künyede nofollow, " +
  "kendi hesapta nofollow yok, güvenlik öznitelikleri, sayfa kimliği, üretici izi yok)."
);
