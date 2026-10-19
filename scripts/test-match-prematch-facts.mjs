#!/usr/bin/env node
/**
 * MAÇ ÖNCESİ DOĞRULANMIŞ NOTLAR + MAÇ ÖNCESİ KÖŞE YAZISI KÖPRÜSÜ.
 *
 *   1. Her madde kaynaklı; kaynaksız / beyaz liste dışı madde basılmaz.
 *   2. Bölüm yalnızca maç öncesi ve Türkçe sayfada çizilir.
 *   3. Gün tutmazsa (ertelenen maç) hiçbir şey basılmaz.
 *   4. Köşe yazısı köprüsü yalnızca yayımlanmış yazıya bağlanır ve yazının
 *      metni doğrulanmış notlara SIZMAZ.
 *   5. Gerçek veri dosyası şemadan geçer (TS–BJK, 19 Ekim 2026).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { prematchFactsFor, prematchFactsSectionHtml, prematchColumnFor, prematchColumnSectionHtml } from "./lib/matchPrematchFacts.mjs";

const entry = { slug: "trabzonspor-besiktas-19-ekim-2026", kickoff: "2026-10-19T20:00:00+03:00" };
const store = {
  matches: {
    [entry.slug]: {
      kickoff: "2026-10-19T20:00:00+03:00",
      items: [
        { id: "ok", label: "Hakem", text: "Cihan Aydın", sourceName: "Hürriyet", sourceUrl: "https://www.hurriyet.com.tr/x" },
        { id: "nosource", label: "X", text: "Kaynaksız iddia", sourceName: "Biri", sourceUrl: "" },
        { id: "badhost", label: "Y", text: "Beyaz liste dışı", sourceName: "Blog", sourceUrl: "https://example-blog.invalid/a" },
        { id: "own", label: "Z", text: "Site arşivi", sourceName: "FutbolRadar", sourceUrl: "https://www.futbolradar.com/mac/a" }
      ]
    }
  }
};

const facts = prematchFactsFor(store, entry);
assert.deepEqual(facts.items.map((row) => row.id), ["ok", "own"], "kaynaksız ve beyaz liste dışı madde elenmeli");
const html = prematchFactsSectionHtml(facts, { locale: "tr", state: "pre" });
assert.match(html, /Cihan Aydın/);
assert.match(html, /href="https:\/\/www\.hurriyet\.com\.tr\/x" target="_blank" rel="nofollow noopener noreferrer"/);
assert.doesNotMatch(html, /futbolradar\.com\/mac\/a" target=/, "sitenin kendi bağlantısı nofollow taşımamalı");
assert.doesNotMatch(html, /Kaynaksız iddia|Beyaz liste dışı/);
for (const state of ["live", "post", "pending", "postponed"]) {
  assert.equal(prematchFactsSectionHtml(facts, { locale: "tr", state }), "", `${state} durumunda bölüm basılmamalı`);
}
assert.equal(prematchFactsSectionHtml(facts, { locale: "en", state: "pre" }), "", "İngilizce sayfada Türkçe not basılmamalı");
assert.equal(prematchFactsFor(store, { ...entry, kickoff: "2026-10-20T20:00:00+03:00" }), null, "gün tutmazsa kayıt açılmamalı");
assert.equal(prematchFactsFor(store, { slug: "baska-mac", kickoff: entry.kickoff }), null);

// Köşe yazısı köprüsü
const columnBase = {
  id: "c1", slug: "c1", title: "Yorum", author: "FutbolRadar", date: "2026-10-19T14:30:00+03:00",
  category: "mac-yorumu", excerpt: "özet", body: ["Yirmi dokuz maç, yirmi dokuz beraberlik."],
  note: "Bu bir yorum yazısıdır; içerdiği istatistikler yazarın görüşüdür.",
  relatedMatch: { slug: entry.slug, phase: "pre" }
};
assert.equal(prematchColumnFor({ columns: [{ ...columnBase, status: "draft" }] }, entry), null, "taslak yazıya bağlantı verilmemeli");
const column = prematchColumnFor({ columns: [{ ...columnBase, status: "published" }] }, entry);
assert.equal(column.href, "/kose-yazilari/c1.html");
const callout = prematchColumnSectionHtml(column, { locale: "tr", state: "pre" });
assert.match(callout, /MAÇ ÖNCESİ YORUM/);
assert.match(callout, /Bu bir yorum yazısıdır; içerdiği istatistikler yazarın görüşüdür\./);
assert.doesNotMatch(callout, /yirmi dokuz beraberlik/i, "köprü yazının metnini taşımamalı");
assert.equal(prematchColumnSectionHtml(column, { locale: "tr", state: "post" }), "");

// Gerçek veri
const real = JSON.parse(fs.readFileSync("data/match-prematch-facts.json", "utf8"));
const record = real.matches[entry.slug];
assert.ok(record, "TS–BJK kaydı olmalı");
const realFacts = prematchFactsFor(real, entry);
assert.equal(realFacts.items.length, record.items.length, "gerçek kayıttaki her madde kaynaklı ve beyaz listede olmalı");
const realText = JSON.stringify(record.items);
assert.doesNotMatch(realText, /29 maçta 29|yirmi dokuz maç/i, "köşe yazısı iddiası doğrulanmış notlara girmemeli");
const columns = JSON.parse(fs.readFileSync("data/columns.json", "utf8"));
const realColumn = prematchColumnFor(columns, entry);
assert.ok(realColumn, "TS–BJK maç öncesi yorum yazısı yayımlanmış olmalı");
assert.equal(realColumn.note, "Bu bir yorum yazısıdır; içerdiği istatistikler yazarın görüşüdür.");

console.log(`test-match-prematch-facts: ${realFacts.items.length} kaynaklı madde, yorum köprüsü ${realColumn.href} — tamam.`);
