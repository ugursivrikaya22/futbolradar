#!/usr/bin/env node
/**
 * Takım / hub / haber / köşe sayfalarına "İlgili sayfalar" bloğu ekler.
 * #596/#532 üreticilerine dokunmaz — yalnızca son-işlem enjeksiyonu.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadTeamSlugMap,
  teamRelatedLinks,
  hubRelatedLinks,
  relatedPagesBlock,
  injectRelatedBlock
} from "./lib/relatedPages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const teams = loadTeamSlugMap(root);

export const HUB_PAGES = [
  "istatistik-merkezi.html",
  "arsiv.html",
  "super-lig-transferleri-2026-2027.html",
  "transfer-donemi-2026-27.html",
  "gol-kralligi.html",
  "kose-yazilari.html",
  "super-lig-puan-durumu.html",
  "oyuncu-radari.html"
];

function writeIfChanged(file, next) {
  const before = fs.readFileSync(file, "utf8");
  if (before === next) return false;
  fs.writeFileSync(file, next, "utf8");
  return true;
}

let changed = 0;
let scanned = 0;

for (const team of teams) {
  const file = path.join(root, "takimlar", `${team.slug}.html`);
  if (!fs.existsSync(file)) continue;
  scanned += 1;
  const links = teamRelatedLinks(root, team.slug, team.name);
  const block = relatedPagesBlock(links, { currentPath: `takimlar/${team.slug}`, title: "İlgili sayfalar" });
  if (writeIfChanged(file, injectRelatedBlock(fs.readFileSync(file, "utf8"), block))) changed += 1;

  // Alt sayfalar (kadro / istatistik …)
  const subdir = path.join(root, "takimlar", team.slug);
  if (fs.existsSync(subdir) && fs.statSync(subdir).isDirectory()) {
    for (const name of fs.readdirSync(subdir).filter((n) => n.endsWith(".html"))) {
      const sub = path.join(subdir, name);
      scanned += 1;
      const subBlock = relatedPagesBlock(links, {
        currentPath: `takimlar/${team.slug}/${name.replace(/\.html$/, "")}`,
        title: "İlgili sayfalar"
      });
      if (writeIfChanged(sub, injectRelatedBlock(fs.readFileSync(sub, "utf8"), subBlock))) changed += 1;
    }
  }

  // Takım puan / maç listeleri
  for (const rel of [`${team.slug}-puan-durumu.html`, `${team.slug}-maclari.html`]) {
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) continue;
    scanned += 1;
    const b = relatedPagesBlock(links, { currentPath: rel.replace(/\.html$/, ""), title: "İlgili sayfalar" });
    if (writeIfChanged(f, injectRelatedBlock(fs.readFileSync(f, "utf8"), b))) changed += 1;
  }
}

const hubLinks = hubRelatedLinks(root, teams);
for (const page of HUB_PAGES) {
  const file = path.join(root, page);
  if (!fs.existsSync(file)) continue;
  scanned += 1;
  const block = relatedPagesBlock(hubLinks, { currentPath: page.replace(/\.html$/, ""), title: "İlgili sayfalar" });
  if (writeIfChanged(file, injectRelatedBlock(fs.readFileSync(file, "utf8"), block))) changed += 1;
}

// Haber ve köşe: slug'ı dosya adında geçen takıma bağla (en fazla bir takım).
function injectForDir(dirName, urlPrefix) {
  const dir = path.join(root, dirName);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".html"))) {
    const team = teams.find((t) => name.includes(t.slug));
    if (!team) continue;
    const file = path.join(dir, name);
    scanned += 1;
    const links = teamRelatedLinks(root, team.slug, team.name).filter((l) =>
      l.href.startsWith("/takimlar/") ||
      l.href.includes("istatistik") ||
      l.href.includes("arsiv") ||
      l.href.includes("transfer") ||
      l.href.includes("puan-durumu") ||
      l.href.includes("gol-krall") ||
      l.href.includes("kose-yazilari") ||
      l.href.startsWith("/haber/")
    );
    const block = relatedPagesBlock(links, {
      currentPath: `${urlPrefix}/${name.replace(/\.html$/, "")}`,
      title: "İlgili sayfalar"
    });
    if (writeIfChanged(file, injectRelatedBlock(fs.readFileSync(file, "utf8"), block))) changed += 1;
  }
}
injectForDir("haber", "haber");
injectForDir("kose-yazilari", "kose-yazilari");

console.log(`inject-related-pages: ${scanned} sayfa tarandı, ${changed} güncellendi`);
