#!/usr/bin/env node
// Kilit SEO sayfalarının tazelik denetimi. Kullanım:
//   node scripts/audit-page-freshness.mjs            # yalnız repo
//   node scripts/audit-page-freshness.mjs --live     # canlı siteyi de curl'le
// Çıktı: data/page-freshness-audit.json yazılmaz; stdout'a JSON/tablo basar (--json).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { extractDateModified, extractVisibleUpdate, sitemapLastmod, freshnessFlags } from "./lib/pageFreshness.mjs";

const SITE = "https://www.futbolradar.com";
const BIG4 = ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"];
const pages = [];
for (const t of BIG4) {
  pages.push({ file: `takimlar/${t}.html`, url: `/takimlar/${t}`, data: "data/super-lig-squads.json" });
  pages.push({ file: `takimlar/${t}/kadro.html`, url: `/takimlar/${t}/kadro.html`, data: "data/super-lig-squads.json" });
  pages.push({ file: `takimlar/${t}/istatistikler.html`, url: `/takimlar/${t}/istatistikler.html`, data: "data/league-leaders.json" });
  pages.push({ file: `takimlar/${t}/mac-sonuclari.html`, url: `/takimlar/${t}/mac-sonuclari.html`, data: "data/historical-match-archive.json" });
  pages.push({ file: `takimlar/${t}/tarihce.html`, url: `/takimlar/${t}/tarihce.html`, data: "data/teams.json" });
  pages.push({ file: `${t}-puan-durumu.html`, url: `/${t}-puan-durumu`, data: "data/league-standings.json" });
}
pages.push(
  { file: "puan-durumu.html", url: "/puan-durumu.html", data: "data/league-standings.json" },
  { file: "gol-kralligi.html", url: "/gol-kralligi.html", data: "data/league-leaders.json" },
  { file: "gol-kralligi.html", url: "/gol-kralligi", data: "data/league-leaders.json" },
  { file: "asist-kralligi.html", url: "/asist-kralligi.html", data: "data/league-leaders.json" },
  { file: "istatistik-merkezi.html", url: "/istatistik-merkezi.html", data: "data/league-leaders.json" },
  { file: "takimlar.html", url: "/takimlar.html", data: "data/teams.json" },
  { file: "transfer-donemi-2026-27.html", url: "/transfer-donemi-2026-27.html", data: "data/transfers.json" },
  { file: "super-lig-transferleri-2026-2027.html", url: "/super-lig-transferleri-2026-2027.html", data: "data/transfers.json" },
);
const extra = process.argv.find((a) => a.startsWith("--pages="));
if (extra) for (const p of extra.slice(8).split(",")) pages.push({ file: p.replace(/^\//, ""), url: p, data: null });

const live = process.argv.includes("--live");
const gitDate = (f) => { try { return execFileSync("git", ["log", "-1", "--format=%cs", "--", f], { encoding: "utf8" }).trim() || null; } catch { return null; } };
const sitemap = fs.existsSync("sitemap.xml") ? fs.readFileSync("sitemap.xml", "utf8") : "";
const curl = (u) => { try { return execFileSync("curl", ["-sL", "--max-time", "20", u], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch { return ""; } };
let liveSitemap = live ? curl(`${SITE}/sitemap.xml`) : "";

const rows = pages.map((p) => {
  const html = fs.existsSync(p.file) ? fs.readFileSync(p.file, "utf8") : "";
  const loc = SITE + p.url;
  const r = {
    url: p.url, file: p.file,
    fileCommit: gitDate(p.file), dataFile: p.data, dataCommit: p.data ? gitDate(p.data) : null,
    repoDateModified: extractDateModified(html), repoVisible: extractVisibleUpdate(html),
    repoLastmod: sitemapLastmod(sitemap, loc) || sitemapLastmod(sitemap, loc.replace(/\.html$/, "")) || sitemapLastmod(sitemap, loc + ".html"),
  };
  r.repoFlags = freshnessFlags({ dateModified: r.repoDateModified, visible: r.repoVisible, lastmod: r.repoLastmod, dataDate: r.dataCommit }).flags;
  if (live) {
    const lh = curl(loc);
    r.liveStatus = lh ? "ok" : "fetch-failed";
    r.liveDateModified = extractDateModified(lh); r.liveVisible = extractVisibleUpdate(lh);
    r.liveLastmod = sitemapLastmod(liveSitemap, loc) || sitemapLastmod(liveSitemap, loc.replace(/\.html$/, "")) || sitemapLastmod(liveSitemap, loc + ".html");
    r.liveFlags = freshnessFlags({ dateModified: r.liveDateModified, visible: r.liveVisible, lastmod: r.liveLastmod }).flags;
  }
  return r;
});
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else console.table(rows.map((r) => ({ url: r.url, fileCommit: r.fileCommit, dataCommit: r.dataCommit, dM: r.repoDateModified, vis: r.repoVisible, lastmod: r.repoLastmod, flags: r.repoFlags.join(" "), ...(live ? { liveDM: r.liveDateModified, liveVis: r.liveVisible, liveLM: r.liveLastmod, liveFlags: r.liveFlags.join(" ") } : {}) })));
