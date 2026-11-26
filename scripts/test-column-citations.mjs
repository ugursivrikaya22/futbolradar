/**
 * KÖŞE YAZISI DİPNOTLARI
 *
 * Söz: metnin içinde [1][2] gibi dipnot işareti görünmez; kaynaklar yazının
 * sonunda "Kaynaklar" başlığıyla, bağlantılı listelenir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { columnPageHtml } from "./generate-column-pages.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { presentColumn, publishedColumns, stripCitationMarkers } = require("../services/columnService.js");

// 1) Ayıklayıcı: işaret gider, iç bağlantı ve başka köşeli parantez kalır.
assert.equal(stripCitationMarkers("Skor 1-1 [1][2]. Sonra yendi [3] ve"), "Skor 1-1. Sonra yendi ve");
assert.equal(stripCitationMarkers("Gol [1, 2] oldu ."), "Gol oldu.");
assert.equal(stripCitationMarkers("[Arsenal](../takimlar/arsenal.html) önde [4]"), "[Arsenal](../takimlar/arsenal.html) önde");
assert.equal(stripCitationMarkers("İşaretsiz  metin ."), "İşaretsiz  metin .", "işaretsiz metne dokunulmaz");

// 2) Sentetik yazı: gövdede işaret yok, Kaynaklar bölümü bağlantılı ve numarasız.
const entry = {
  id: "dipnot-testi", title: "Dipnot testi", author: "Yazar", date: "2026-11-20T10:00:00+03:00",
  category: "mac-yorumu", status: "published", excerpt: "Özet.",
  body: ["İlk iddia kaynaklıdır [1]. İkincisi de [2][3].", "Kapanış."],
  sources: [
    { label: "[1] Hürriyet — Maç özeti (20 Kasım 2026)", url: "https://www.hurriyet.com.tr/ornek-1" },
    { label: "[2] NTV — Açıklama", url: "https://www.ntv.com.tr/ornek-2" },
    { label: "[3] TFF — Rapor", url: "https://www.tff.org/ornek-3" }
  ],
  en: {
    title: "Footnote test", excerpt: "Summary.",
    body: ["First claim is sourced [1]. Second as well [2][3]."],
    sources: [{ label: "[1] Hürriyet — Match report", url: "https://www.hurriyet.com.tr/ornek-1" }]
  }
};
for (const locale of ["tr", "en"]) {
  const html = columnPageHtml(presentColumn(entry, locale), locale);
  const article = html.slice(html.indexOf("<article"), html.indexOf("</article>"));
  const prose = article.replace(/<section class="article-sources"[\s\S]*?<\/section>/, "");
  assert.ok(!/\[\d+\]/.test(prose), `${locale}: gövdede dipnot işareti kalmamalı`);
  assert.ok(!/aria-label="\[?\d/.test(prose), `${locale}: işaret bağlantısı kalmamalı`);
  const heading = locale === "tr" ? "Kaynaklar" : "Sources";
  assert.match(html, new RegExp(`<h2 id="column-sources-title">${heading}</h2>`), `${locale}: ${heading} başlığı`);
  const links = [...html.matchAll(/<section class="article-sources"[^>]*aria-labelledby="column-sources-title">[\s\S]*?<\/section>/g)][0][0];
  assert.match(links, /<a href="https:\/\/www\.hurriyet\.com\.tr\/ornek-1"/, `${locale}: kaynak bağlantılı`);
  assert.ok(!/>\[\d+\]/.test(links), `${locale}: kaynak etiketinde numara kalmamalı`);
}
// TR: işaret silinince cümle akışı bozulmaz.
{
  const html = columnPageHtml(presentColumn(entry, "tr"), "tr");
  assert.match(html, /İlk iddia kaynaklıdır\. İkincisi de\./);
}

// 3) Gerçek veri: yayımlanan hiçbir yazının (TR/EN) metninde dipnot işareti yok.
{
  const store = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
  for (const locale of ["tr", "en"]) {
    const { columns } = publishedColumns(store, { locale });
    for (const column of columns) {
      const lines = [...column.body, ...column.updates.map((row) => row.text)];
      for (const line of lines) {
        assert.ok(!/\[\d+\](?!\()/.test(line), `${column.id} (${locale}): dipnot işareti kalmış: ${line.slice(0, 80)}`);
      }
      for (const source of column.sources) {
        assert.ok(!/^\[\d+\]/.test(source.label), `${column.id} (${locale}): kaynak etiketinde numara: ${source.label}`);
      }
    }
  }
}
console.log("Köşe yazısı dipnot testleri geçti.");
