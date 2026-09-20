#!/usr/bin/env node
/**
 * MAÇ SAYFASINDAN KÖŞE YAZISINA KÖPRÜ.
 *
 * Maç bittikten sonra okuyucu önce maç sayfasına geliyor: skoru görüyor ve
 * çıkıyor. Yayımlanmış bir maç sonu analizi varsa o sayfanın en üstünde
 * yazıya götüren bir çağrı duruyor — bu betik onu basar.
 *
 * ── YALNIZCA YAYIMLANMIŞ YAZI İÇİN ──────────────────────────────────────
 *
 * Kaynak `data/columns.json` ve yalnızca `published` kayıtlar okunur.
 * Taslak bir yazıya maç sayfasından link vermek, yayına alınmamış bir
 * adresi herkese açmak olurdu.
 *
 * ── TEKRAR ÇALIŞTIRILABİLİR ─────────────────────────────────────────────
 *
 * Blok işaretçiler arasına yazılır; ikinci koşu bloğu ÇOĞALTMAZ, değiştirir.
 * Derleme zinciri sayfaları yeniden üretiyor, bu yüzden betik zincirin
 * sonunda, üretimden sonra çalışmalı.
 *
 * Kullanım:
 *   node scripts/inject-match-column-link.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { publishedColumns } = require("../services/columnService.js");

const START = "<!-- column-link:start -->";
const END = "<!-- column-link:end -->";

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[column-link] ${path.basename(filePath)} okunamadı: ${error.message}`);
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function calloutHtml({ href, promo, title, badge }) {
  return `${START}
      <aside class="match-column-callout">
        <a class="match-column-callout-link" href="${escapeHtml(href)}">
          <span class="match-column-callout-badge">${escapeHtml(badge)}</span>
          <span class="match-column-callout-text">${escapeHtml(promo)}</span>
          <span class="match-column-callout-title">${escapeHtml(title)}</span>
        </a>
      </aside>
${END}`;
}

/**
 * Bloğu sayfaya yerleştirir.
 *
 * Hedef, ilk `</h1>`in hemen ardı: okuyucu başlığı gördükten sonra ilk
 * karşılaştığı şey olur. Sayfada `<h1>` yoksa hiçbir şey yapılmaz —
 * tahmini bir yere enjekte etmek düzeni bozardı.
 */
function inject(html, block) {
  if (html.includes(START)) {
    return html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  }
  const index = html.indexOf("</h1>");
  if (index === -1) return null;
  const cut = index + "</h1>".length;
  return `${html.slice(0, cut)}\n${block}${html.slice(cut)}`;
}

function writeBoth(relativePath, html) {
  for (const base of [root, path.join(root, "public")]) {
    const target = path.join(base, relativePath);
    if (!fs.existsSync(target)) continue;
    fs.writeFileSync(target, html, "utf8");
  }
}

/** Maç kimliğinden hedef sayfalar — yalnızca var olanlar. */
function targetsFor(matchId, seoPages, locale) {
  const identity = String(matchId || "");
  const parts = identity.split("-");
  const date = parts.slice(-3).join("-");
  const teams = parts.slice(0, -3).join("-");

  const targets = [];
  if (locale === "tr") {
    for (const candidate of [`mac-raporu/${identity}.html`]) {
      if (fs.existsSync(path.join(root, candidate))) targets.push(candidate);
    }
  }

  for (const page of seoPages) {
    if (!page) continue;
    const pageIdentity = String(page.identity || "");
    const pageDate = pageIdentity.split("|").pop();
    if (pageDate !== date) continue;
    const slugTeams = `${page.homeTeam || ""}-${page.awayTeam || ""}`.toLocaleLowerCase("tr");
    if (!teams.split("-").every((token) => token.length < 3 || slugTeams.includes(token) || identity.includes(token))) continue;
    const candidate = locale === "en"
      ? (page.enSlug ? `en/match/${page.enSlug}.html` : "")
      : (page.slug ? `mac/${page.slug}.html` : "");
    if (candidate && fs.existsSync(path.join(root, candidate))) targets.push(candidate);
  }

  return [...new Set(targets)];
}

const store = readJson(path.join(root, "data", "columns.json"), { columns: [] });
const seo = readJson(path.join(root, "data", "match-seo-pages.json"), { pages: [] });
const seoPages = Array.isArray(seo.pages) ? seo.pages : [];

const raw = Array.isArray(store.columns) ? store.columns : [];
const byMatch = new Map();
for (const entry of raw) {
  if (!entry || entry.status !== "published") continue;
  const matchId = entry.generated && entry.generated.matchId;
  if (matchId) byMatch.set(matchId, entry);
}

if (!byMatch.size) {
  console.log("[column-link] maça bağlı yayımlanmış köşe yazısı yok; hiçbir sayfa değiştirilmedi.");
  process.exit(0);
}

const { columns } = publishedColumns(store);
const published = new Set(columns.map((row) => row.id));

let injected = 0;
for (const [matchId, entry] of byMatch) {
  if (!published.has(entry.id)) continue;
  const promo = entry.promo || {};

  for (const locale of ["tr", "en"]) {
    const href = locale === "en"
      ? (entry.en && entry.en.slug ? `/en/columns/${entry.en.slug}.html` : "")
      : `/kose-yazilari/${entry.slug}.html`;
    if (!href) continue;
    // İngilizce sayfaya ancak İngilizce yazı varsa link verilir.
    if (locale === "en" && !(entry.en && Array.isArray(entry.en.body) && entry.en.body.length)) continue;

    const block = calloutHtml({
      href,
      promo: locale === "en" ? (promo.en || "The column after the match") : (promo.tr || "Maçın ardından köşe yazısı"),
      title: locale === "en" ? (entry.en.title || entry.title) : entry.title,
      badge: locale === "en" ? "POST-MATCH ANALYSIS" : "MAÇ SONU ANALİZİ"
    });

    for (const relative of targetsFor(matchId, seoPages, locale)) {
      const filePath = path.join(root, relative);
      const html = fs.readFileSync(filePath, "utf8");
      const next = inject(html, block);
      if (!next || next === html) continue;
      writeBoth(relative, next);
      injected += 1;
      console.log(`[column-link] ${relative} → ${href}`);
    }
  }
}

console.log(`[column-link] ${injected} sayfaya köşe yazısı bağlantısı basıldı.`);
