#!/usr/bin/env node
/**
 * Haftalık bülteni GERÇEK veriden e-posta göndermeden dosyaya basar (önizleme).
 *
 *   node scripts/newsletter-dry-run.mjs                     # depodaki data/*.json
 *   node scripts/newsletter-dry-run.mjs --site              # canlı site verisi (SITE_URL/data/...)
 *   node scripts/newsletter-dry-run.mjs --out=/tmp/bulten --now=2026-11-02T06:00:00Z
 *
 * Çıktı: <out>.html ve <out>.txt. Hiçbir e-posta gönderilmez, abone okunmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const content = require("../services/newsletter/content.js");
const render = require("../services/newsletter/render.js");
const config = require("../services/newsletter/config.js");

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const site = config.siteUrl();
const now = args.now ? Date.parse(args.now) : Date.now();
const out = path.resolve(String(args.out || "outputs/newsletter-preview"));
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8")); } catch { return null; } };

const sources = args.site
  ? await content.loadSourcesFromSite(site)
  : { calendar: readJson("data/fixture-calendar.json"), archive: readJson("data/historical-match-archive.json"), standings: readJson("data/league-standings.json"), columnsJson: readJson("data/columns.json"), supabaseColumns: null };

const issue = content.buildIssue(sources, { now, site });
const sample = { name: "Okur", unsubscribeUrl: `${site}/api/newsletter?action=unsubscribe&token=ONIZLEME` };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(`${out}.html`, render.renderHtml(issue, sample), "utf8");
fs.writeFileSync(`${out}.txt`, render.renderText(issue, sample), "utf8");
console.log(JSON.stringify({ issue: issue.key, subject: render.subject(issue), source: args.site ? site : "repo data/", results: issue.results.length, standings: issue.standings.rows.length, columns: issue.columns.length, html: `${out}.html`, text: `${out}.txt` }, null, 2));
