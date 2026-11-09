#!/usr/bin/env node
/**
 * Futbolcu piyasa değerleri sayfası denetimi.
 *   • Her liste izinli bir kaynak ve tarih taşır; kaynaksız liste çizilmez.
 *   • Sıralar 1'den kesintisiz, değerler sıraya göre azalan (eşitlik serbest).
 *   • Aynı futbolcu bir listede iki kez geçmez.
 *   • Sayfa: tek H1, kanonik, FAQ ve ItemList şeması, "undefined"/"NaN" yok.
 *   • Süper Lig oyuncusu profil sayfasına bağlanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildModel, formatEur, renderMarketValues, MARKET_VALUES_SLUG } from "./generate-market-values-page.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "data", "market-values.json"), "utf8"));

function checkList(label, list) {
  assert.ok(list && Array.isArray(list.players) && list.players.length, `${label}: liste boş`);
  assert.ok(!Number.isNaN(Date.parse(list.asOf)), `${label}: asOf geçersiz`);
  assert.ok(isAllowedSourceUrl(list.source.url), `${label}: kaynak izinli değil (${list.source.url})`);
  const names = new Set();
  list.players.forEach((p, i) => {
    assert.equal(p.rank, i + 1, `${label}: sıra kesintili (${p.name})`);
    assert.ok(Number(p.valueEur) > 0, `${label}: değer yok (${p.name})`);
    if (i > 0) assert.ok(p.valueEur <= list.players[i - 1].valueEur, `${label}: değerler azalan değil (${p.name})`);
    assert.ok(!names.has(p.name), `${label}: tekrar eden futbolcu (${p.name})`);
    names.add(p.name);
  });
  for (const u of list.updates || []) assert.ok(isAllowedSourceUrl(u.source.url), `${label}: güncelleme kaynağı izinli değil (${u.source.url})`);
}

checkList("dünya", data.world);
checkList("türk", data.turkish);
assert.ok(isAllowedSourceUrl(data.valueSource.url), "Transfermarkt bağlantısı izinli listede olmalı");

assert.equal(formatEur(220000000), "220 milyon €");
assert.equal(formatEur(6500000), "6,5 milyon €");
assert.equal(formatEur(0), "—");

const model = buildModel({ data });
assert.ok(model.sections.world && model.sections.turkish, "iki bölüm de çizilmeli");
assert.ok(model.indexable, "dünya listesi varken sayfa indekslenebilir olmalı");
const linked = model.turkish.players.filter((p) => p.href);
assert.ok(linked.length >= 5, `Süper Lig oyuncuları profillere bağlanmalı (bağlı: ${linked.length})`);

// Kaynaksız liste çizilmez.
const noSource = buildModel({ data: { ...data, world: { ...data.world, source: { name: "x", url: "https://example.com/x" } } } });
assert.equal(noSource.sections.world, false, "izinsiz kaynaklı dünya listesi çizilmemeli");
assert.equal(noSource.indexable, false, "dünya listesi yoksa sayfa noindex olmalı");

const { html } = renderMarketValues({ data });
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, "tek H1 olmalı");
assert.ok(html.includes(`<link rel="canonical" href="https://www.futbolradar.com/${MARKET_VALUES_SLUG}" />`), "kanonik eksik");
assert.match(html, /"@type":"FAQPage"/, "FAQ şeması eksik");
assert.match(html, /"@type":"ItemList"/, "ItemList şeması eksik");
assert.ok(!/undefined|NaN/.test(html), "sayfada undefined/NaN var");
for (const p of data.world.players) assert.ok(html.includes(p.name.replaceAll("'", "&#039;")), `dünya listesinde eksik: ${p.name}`);

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
assert.ok(vercel.rewrites.some((r) => r.source === `/${MARKET_VALUES_SLUG}`), "temiz URL rewrite eksik");
assert.ok(vercel.redirects.some((r) => r.source === `/${MARKET_VALUES_SLUG}.html`), ".html yönlendirmesi eksik");

console.log(`test-market-values: dünya ${data.world.players.length}, Türk ${data.turkish.players.length} oyuncu; ${linked.length} profil bağlantısı; kaynak, sıra ve şema denetimleri geçti.`);
