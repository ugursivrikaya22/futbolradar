#!/usr/bin/env node
/**
 * CANLI SKOR BİLEŞENİNİ SAYFALARA BAS (postbuild, idempotent).
 *
 * Kaynak: data/live-score-widget.json. Takım sayfaları (takimlar/<slug>.html)
 * postbuild'de generate-evergreen-seo-pages.mjs tarafından yeniden üretildiği
 * için bu adım ondan SONRA, postprocess'ten ÖNCE çalışır. Yeni URL açmaz;
 * var olan sayfaları yerinde genişletir (live-score-widget yuvası).
 *
 * Kullanım: node scripts/inject-live-score-widget.mjs [--now=ISO] [--check]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFeaturedActive, renderMatchPageStrip, renderTeamWidget, upsertBlock, removeBlock } from "./lib/liveScoreWidget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const nowArg = args.find((a) => a.startsWith("--now="));
const now = nowArg ? new Date(nowArg.slice(6)) : new Date();
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const config = readJson("data/live-score-widget.json");
const HERO_RE = /<header class="evergreen-hero">[\s\S]*?<\/header>/;
const H1_RE = /<h1 class="msp-h1"[^>]*>[\s\S]*?<\/h1>/;

const norm = (v) => String(v || "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

/** Takımın şimdiden sonraki ilk kayıtlı maçı (8 gün içinde), match-seo-pages.json'dan. */
export function nextFixtureFor(teamName, pages, at = now) {
  const key = norm(teamName);
  const lo = at.getTime() - 3 * 3600 * 1000;
  const hi = at.getTime() + 8 * 24 * 3600 * 1000;
  return pages
    .filter((p) => (norm(p.homeTeam) === key || norm(p.awayTeam) === key) && p.indexable !== false)
    .filter((p) => { const t = Date.parse(p.kickoff); return Number.isFinite(t) && t >= lo && t <= hi; })
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0] || null;
}

export function run({ write = true } = {}) {
  let pages = [];
  try { pages = readJson("data/match-seo-pages.json").pages || []; } catch { pages = []; }
  const active = (config.featured || []).filter((f) => isFeaturedActive(f, now));
  const inactive = (config.featured || []).filter((f) => !isFeaturedActive(f, now));
  const changed = [];
  for (const team of config.teams || []) {
    const file = path.join(root, team.file);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    const featured = active.find((f) => (f.teamSlugs || []).includes(team.slug)) || null;
    const block = renderTeamWidget({
      team,
      featured,
      next: featured ? null : nextFixtureFor(team.name, pages),
      endpoint: config.endpoint,
      poll: config.pollSeconds,
      base: "../"
    });
    const out = upsertBlock(html, block, HERO_RE);
    if (out === null) { console.warn(`[live-score-widget] yuva bulunamadı: ${team.file}`); continue; }
    if (out !== html) { if (write) fs.writeFileSync(file, out); changed.push(team.file); }
  }
  for (const f of active) {
    if (!f.matchPageFile) continue;
    const file = path.join(root, f.matchPageFile);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    const out = upsertBlock(html, renderMatchPageStrip(f), H1_RE);
    if (out !== null && out !== html) { if (write) fs.writeFileSync(file, out); changed.push(f.matchPageFile); }
  }
  for (const f of inactive) {
    if (!f.matchPageFile || active.some((a) => a.matchPageFile === f.matchPageFile)) continue;
    const file = path.join(root, f.matchPageFile);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    const out = removeBlock(html);
    if (out !== html) { if (write) fs.writeFileSync(file, out); changed.push(f.matchPageFile); }
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = run({ write: !args.includes("--check") });
  console.log(`[live-score-widget] ${changed.length} sayfa güncellendi${changed.length ? `: ${changed.join(", ")}` : ""}`);
}
