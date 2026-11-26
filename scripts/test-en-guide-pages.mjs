#!/usr/bin/env node
/**
 * İNGİLİZCE REHBER SAYFALARI TESTİ — /en/guides/
 *
 * Diskteki üretilmiş çıktıya BAĞLI DEĞİL: sayfalar bellekte kurulur, böylece
 * derlemeden önce de (depoda üretilmiş İngilizce rehber yokken) çalışır.
 *
 *   node scripts/test-en-guide-pages.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildEnglishGuide, guideHtml, structureProblems } from "./generate-en-guide-pages.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { SITEMAP_BUCKETS } from "./lib/sitemapBuckets.mjs";

const require = createRequire(import.meta.url);
const { DOMAIN } = require("../services/i18n.js");
const root = process.cwd();
const failures = [];

function check(name, condition, detail = "") {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const plan = JSON.parse(fs.readFileSync(path.join(root, "data/search-demand/content-plan.json"), "utf8")).pages
  .filter((page) => page.type !== "dashboard");
const translations = JSON.parse(fs.readFileSync(path.join(root, "data/search-demand/content-plan.en.json"), "utf8"));

// --- 1. Kapsam: her Türkçe rehberin çevirisi var, öksüz çeviri yok ---------
{
  const missing = plan.filter((page) => !translations[page.slug]).map((page) => page.slug);
  check(`her Türkçe rehberin İngilizcesi var (${plan.length} sayfa)`, !missing.length, missing.join(", "));
  const orphan = Object.keys(translations).filter((slug) => !plan.some((page) => page.slug === slug));
  check("Türkçe karşılığı olmayan çeviri yok", !orphan.length, orphan.join(", "));
  const slugs = Object.values(translations).map((entry) => entry.slug);
  check("İngilizce slug'lar benzersiz", new Set(slugs).size === slugs.length);
  check("her Türkçe rehberin sayfası diskte", plan.every((page) => fs.existsSync(path.join(root, `${page.slug}.html`))),
    plan.filter((page) => !fs.existsSync(path.join(root, `${page.slug}.html`))).map((page) => page.slug).join(", "));
}

// --- 2. Yapı: bölüm, paragraf, SSS, iddia, kaynak sayıları Türkçeyle aynı --
for (const page of plan) {
  const problems = structureProblems(page, translations[page.slug]);
  check(`${page.slug}: yapı Türkçeyle aynı`, !problems.length, problems.join("; "));
}

// --- 3. Sayfalar: dil, etiketler, sızıntı, bağlantılar ---------------------
const built = plan.map((page) => buildEnglishGuide(page, translations[page.slug]));
const planned = new Set(built.map((page) => page.en));
const isAvailable = (href) => {
  const clean = String(href || "").split("#")[0].split("?")[0];
  return planned.has(clean) || fs.existsSync(path.join(root, clean));
};

for (const page of built) {
  const trPage = plan.find((entry) => entry.slug === page.trSlug);
  const skipped = [];
  const html = guideHtml(page, isAvailable, (slug, href) => skipped.push(href));
  const name = page.en;

  check(`${name}: bağlantısı atlanan hedef yok`, !skipped.length, skipped.join(", "));
  check(`${name}: <html lang="en">`, /<html lang="en">/.test(html));
  check(`${name}: kanonik kendi İngilizce adresi`, html.includes(`<link rel="canonical" href="${DOMAIN}/${page.en}" />`));
  check(`${name}: dil düğmesi Türkçe karşılığa gider`, html.includes(`class="lang-switch" href="../../${page.tr}"`));
  check(`${name}: indekslenebilir`, /<meta name="robots" content="index/.test(html));

  const visible = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ")
    .replace(/<[^>]+>/g, " ");
  const leaks = findTurkish(visible);
  check(`${name}: görünür metinde Türkçe yok`, !leaks.length, leaks.slice(0, 4).join(", "));

  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const graph = ld["@graph"];
  const article = graph.find((node) => node["@type"] === "Article");
  check(`${name}: Article şeması İngilizce ve tarihler Türkçe kayıtla aynı`,
    article.inLanguage === "en" && article.datePublished === trPage.publishedAt && article.dateModified === trPage.updatedAt);
  const faq = graph.find((node) => node["@type"] === "FAQPage");
  check(`${name}: SSS şeması soru sayısı Türkçeyle aynı`, (trPage.faq || []).length === (faq ? faq.mainEntity.length : 0));
  check(`${name}: kaynak adresleri Türkçeyle aynı`,
    JSON.stringify(article.citation) === JSON.stringify((trPage.sources || []).map((source) => source.url)));

  if (trPage.type === "match-guide") {
    const event = graph.find((node) => node["@type"] === "SportsEvent");
    check(`${name}: maç saati ve takımlar Türkçe kayıtla aynı`,
      event && event.startDate === trPage.match.kickoff
        && event.competitor[0].name === trPage.match.homeTeam && event.competitor[1].name === trPage.match.awayTeam);
  }

  if (trPage.type === "transfer-hub") {
    // Güven etiketi Türkçe kayıttan gelir: sıra ve değer aynı olmalı.
    const rendered = [...html.matchAll(/data-confidence="([a-z]+)"/g)].map((match) => match[1]);
    check(`${name}: her iddianın güven etiketi Türkçeyle aynı`,
      JSON.stringify(rendered) === JSON.stringify(trPage.claims.map((claim) => claim.confidence)), rendered.join(","));
    check(`${name}: kesinleşmemiş dosya "confirmed" gibi sunulmuyor`,
      trPage.overallStatus === "confirmed" || !/Status: Confirmed/.test(html));
    check(`${name}: genel durum etiketi Türkçeyle aynı`,
      html.includes(`Status: ${{ confirmed: "Confirmed", reported: "Reported", rumour: "Rumour", denied: "Denied" }[trPage.overallStatus]}`));
  }
}

// --- 4. Rakamlar: Türkçe metindeki her rakam İngilizcede de var ------------
// Sıra sözcüğüne çevrilen ("3. eleme turu" → "third") ve ISO tarihlerin parçaları
// bilinen, zararsız farklardır; onun dışındaki kayıp bir çeviri hatasıdır.
{
  const textOf = (entry) => JSON.stringify({
    t: entry.title, d: entry.description, h: entry.h1, a: entry.directAnswer, u: entry.updateNote,
    s: entry.sections, f: entry.faq, c: (entry.claims || []).map((claim) => [claim.statement, claim.sourceName]),
    pf: entry.playerFacts, src: (entry.sources || []).map((source) => source.name)
  });
  const digits = (text) => new Set((text.match(/\d+/g) || []).map(Number));
  // "11'i / ilk 11" → "XI"; sıra sayıları → sözcük. Bu rakamlar TR'de ayrı geçer, EN'de harfle yazılır.
  const WORDED = new Set([3, 11]);
  for (const page of plan) {
    const english = digits(textOf(translations[page.slug]));
    const lost = [...digits(textOf(page))].filter((value) => !english.has(value) && !WORDED.has(value));
    check(`${page.slug}: Türkçedeki rakamlar İngilizcede korunuyor`, !lost.length, `kayıp: ${lost.join(", ")}`);
  }
}

// --- 5. Site haritası: /en/guides/ adresleri İngilizce kovaya düşer --------
{
  const bucket = SITEMAP_BUCKETS.find((entry) => entry.test(`${DOMAIN}/en/guides/europa-league-top-8-rule.html`));
  check("/en/guides/ adresleri sitemap-en.xml kovasına gider", bucket && bucket.id === "en", bucket && bucket.id);
}

// --- 6. Üretici Türkçe sayfalara yazmıyor ----------------------------------
{
  const source = fs.readFileSync(path.join(root, "scripts/generate-en-guide-pages.mjs"), "utf8");
  const writes = [...source.matchAll(/writeFileSync\(([^,]+),/g)].map((match) => match[1].trim());
  check("üretici yalnızca hedef, sitemap ve rota haritası dosyalarına yazıyor",
    writes.every((target) => ["target", "sitemapPath"].includes(target)), writes.join(", "));
}

if (failures.length) {
  console.error(`\nen-guide-pages FAILED (${failures.length}):`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log("\nen-guide-pages passed");
