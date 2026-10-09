#!/usr/bin/env node
/**
 * İLGİLİ GEZİNME — REGRESYON DENETİMİ.
 *
 * İki katman:
 *   1. SAF KURALLAR: en fazla üç kart, aynı hedef iki kez yok, sayfa
 *      kendine bağlanmaz, diskte olmayan hedef basılmaz, duruma göre doğru
 *      setler (maç öncesi sayfası canlı/bitmiş setlerini de taşır), boş
 *      blok basılmaz, köşe yazısı eşleştirme önceliği.
 *   2. ÜRETİLMİŞ AĞAÇ: mac/, en/match/, kose-yazilari/, en/columns/ içindeki
 *      her ilgili kart seti aynı kuralları gerçek HTML'de sağlar ve her
 *      hedef dosya olarak vardır. Blok henüz üretilmemiş sayfalar (eski
 *      çıktı) atlanır; sayı raporlanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_RELATED_CARDS,
  buildMatchRelatedSets,
  columnRelatedHtml,
  matchRelatedHtml,
  pickRelatedCards,
  rankRelatedColumns,
  targetKey
} from "./lib/relatedNavigation.mjs";

const root = process.cwd();
let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

const card = (href, type = "x", title = href) => ({ href, type, title, kicker: "k" });

/* 1. SAF KURALLAR ------------------------------------------------------ */

check("en fazla üç kart", () => {
  const picked = pickRelatedCards(["a", "b", "c", "d", "e"].map((name) => card(`../${name}.html`)));
  assert.equal(picked.length, MAX_RELATED_CARDS);
  assert.equal(MAX_RELATED_CARDS, 3);
});

check("aynı hedef (temiz/uzantılı/çapalı biçimler) bir kez", () => {
  const picked = pickRelatedCards([card("../lig/super-lig.html"), card("../lig/super-lig"), card("/lig/super-lig#x"), card("../b.html")]);
  assert.deepEqual(picked.map((item) => targetKey(item.href)), ["lig/super-lig.html", "b.html"]);
});

check("sayfa kendine bağlanmaz", () => {
  const picked = pickRelatedCards([card("../mac/a-b-1-ekim-2026"), card("../c.html")], { self: "mac/a-b-1-ekim-2026.html" });
  assert.deepEqual(picked.map((item) => item.href), ["../c.html"]);
});

check("olmayan hedef ve eksik alanlı kart basılmaz", () => {
  const picked = pickRelatedCards(
    [card("../yok.html"), { href: "../var.html", type: "x", title: "", kicker: "k" }, null, card("../var.html")],
    { exists: (file) => file === "var.html" }
  );
  assert.deepEqual(picked.map((item) => item.href), ["../var.html"]);
});

const slots = {
  teamFixtures: [card("../galatasaray-maclari.html", "team_fixtures")],
  teamPages: [card("../takimlar/galatasaray", "team_page")],
  standings: card("../super-lig-puan-durumu", "league_standings"),
  leagueMatches: [card("../lig/super-lig.html", "league_matches"), card("../mac/self-page", "same_day_match")],
  nextMatches: [card("../mac/sonraki", "next_match")],
  previews: [card("../onizleme.html", "preview")],
  reviews: [card("../mac-raporu/r.html", "match_report")]
};

check("maç öncesi sayfası pre/live/post setlerini taşır; her set ≤3, tekil, kendine bağsız", () => {
  const result = buildMatchRelatedSets("pre", () => slots, { self: "mac/self-page.html" });
  assert.equal(result.state, "pre");
  assert.deepEqual(result.sets.map((set) => set.key), ["pre", "live", "post"]);
  for (const set of result.sets) {
    assert.ok(set.cards.length <= 3);
    const keys = set.cards.map((item) => targetKey(item.href));
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(!keys.includes("mac/self-page.html"));
  }
  const pre = result.sets.find((set) => set.key === "pre").cards.map((item) => item.type);
  assert.deepEqual(pre, ["team_fixtures", "league_standings", "preview"]);
  const post = result.sets.find((set) => set.key === "post").cards.map((item) => item.type);
  assert.deepEqual(post, ["match_report", "next_match", "league_standings"]);
  // Bitmiş maçta önizleme önerilmez.
  assert.ok(!post.includes("preview"));
});

check("bitmiş sayfa yalnızca post setini taşır; sonuç bekleyen sayfa post setini kullanır", () => {
  assert.deepEqual(buildMatchRelatedSets("post", () => slots).sets.map((set) => set.key), ["post"]);
  const pending = buildMatchRelatedSets("pending", () => slots);
  assert.equal(pending.state, "post");
  assert.deepEqual(pending.sets.map((set) => set.key), ["post"]);
});

check("boş blok basılmaz; geçerli set boşsa blok gizli doğar", () => {
  assert.equal(matchRelatedHtml({ state: "post", sets: [{ key: "post", cards: [] }] }, "tr"), "");
  const html = matchRelatedHtml({ state: "pre", sets: [{ key: "pre", cards: [] }, { key: "live", cards: [card("../a.html")] }] }, "tr");
  assert.match(html, /<section[^>]*\bhidden\b/);
  assert.match(html, /data-related-set="live" hidden/);
  assert.equal(columnRelatedHtml([], "en"), "");
});

check("köşe yazısı: aynı maç > ortak takım > tek ortak etiket önerilmez", () => {
  const current = { id: "1", path: "kose-yazilari/a.html", date: "2026-09-05", matchSlug: "m", teams: ["Beşiktaş"], tags: ["Vlahovic", "Süper Lig"] };
  const ranked = rankRelatedColumns(current, [
    { id: "1", path: "kose-yazilari/a.html", date: "2026-09-05", matchSlug: "m", teams: [], tags: [] },
    { id: "2", path: "kose-yazilari/b.html", date: "2026-08-01", teams: ["Beşiktaş"], tags: [] },
    { id: "3", path: "kose-yazilari/c.html", date: "2026-09-04", matchSlug: "m", teams: [], tags: [] },
    { id: "4", path: "kose-yazilari/d.html", date: "2026-09-05", teams: [], tags: ["Vlahovic"] },
    { id: "5", path: "kose-yazilari/e.html", date: "2026-09-05", teams: [], tags: ["Süper Lig"] }
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["3", "2"]);
});

/* 2. ÜRETİLMİŞ AĞAÇ ---------------------------------------------------- */

const DIRS = ["mac", "en/match", "kose-yazilari", "en/columns"];
let pagesWithBlock = 0;
let setsChecked = 0;
const failures = [];

function resolveTarget(pageRel, href) {
  const clean = href.split("#")[0].split("?")[0];
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(pageRel), clean));
  if (clean.startsWith("/")) resolved = clean.slice(1);
  if (!/\.[a-z0-9]+$/i.test(resolved)) resolved += ".html";
  return resolved;
}

for (const dir of DIRS) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of fs.readdirSync(abs)) {
    if (!file.endsWith(".html")) continue;
    const pageRel = `${dir}/${file}`;
    const html = fs.readFileSync(path.join(abs, file), "utf8");
    const sections = html.match(/<section[^>]*data-related-nav[\s\S]*?<\/section>/g) || [];
    if (!sections.length) continue;
    pagesWithBlock += 1;
    if (sections.length > 1) failures.push(`${pageRel}: birden fazla ilgili blok`);
    for (const section of sections) {
      const grids = section.match(/<div class="msp-related-grid rel-nav-grid"[^>]*>[\s\S]*?<\/div>/g) || [];
      if (!grids.length) failures.push(`${pageRel}: boş ilgili blok`);
      for (const grid of grids) {
        setsChecked += 1;
        const hrefs = [...grid.matchAll(/<a class="match-related-card rel-nav-card" href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
        if (!hrefs.length) failures.push(`${pageRel}: boş kart seti`);
        if (hrefs.length > MAX_RELATED_CARDS) failures.push(`${pageRel}: ${hrefs.length} kart (> ${MAX_RELATED_CARDS})`);
        const targets = hrefs.map((href) => resolveTarget(pageRel, href));
        if (new Set(targets).size !== targets.length) failures.push(`${pageRel}: tekrar eden hedef ${targets.join(", ")}`);
        for (const target of targets) {
          if (target === pageRel) failures.push(`${pageRel}: sayfa kendine bağlanıyor`);
          if (!fs.existsSync(path.join(root, target))) failures.push(`${pageRel}: hedef yok → ${target}`);
          if (dir.startsWith("en/") && !target.startsWith("en/")) failures.push(`${pageRel}: İngilizce sayfadan Türkçe hedef → ${target}`);
          if (!dir.startsWith("en/") && target.startsWith("en/")) failures.push(`${pageRel}: Türkçe sayfadan İngilizce hedef → ${target}`);
        }
      }
    }
  }
}

check(`üretilmiş sayfalar (${pagesWithBlock} sayfa, ${setsChecked} set)`, () => {
  assert.deepEqual(failures.slice(0, 20), []);
});

console.log(`[related-navigation] ${checks} denetim geçti; ${pagesWithBlock} sayfada ilgili blok tarandı.`);
