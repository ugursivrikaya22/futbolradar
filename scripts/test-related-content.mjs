import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { columnPageHtml } from "./generate-column-pages.mjs";

const require = createRequire(import.meta.url);
const { relatedColumns, relatedForNews, teamMatchPage } = require("../services/relatedContent.js");
const { publishedColumns } = require("../services/columnService.js");
const fs = require("node:fs");

const col = (id, tags, extra = {}) => ({ path: `kose-yazilari/${id}.html`, title: id, tags, categoryLabel: "Maç Yorumu", author: "A", locale: "tr", date: "2026-10-01T00:00:00Z", ...extra });

// Köşe: kendine link yok, ortak etiket öne, boş veride boş
const self = col("self", ["Trabzonspor", "Beşiktaş"]);
const others = [self, col("a", ["Trabzonspor"]), col("b", ["Galatasaray"], { categoryLabel: "X", author: "B" }), col("c", ["Trabzonspor", "Beşiktaş"])];
const rel = relatedColumns(self, others);
assert.ok(!rel.includes(self), "kendine link verilmez");
assert.equal(rel[0].title, "c");
assert.ok(!rel.some((r) => r.title === "b"), "ilgisiz yazı girmez");
assert.deepEqual(relatedColumns(self, []), []);
assert.deepEqual(relatedColumns(self, [self]), []);

// Köşe sayfası: ilgili yoksa modül basılmaz
const store = JSON.parse(fs.readFileSync("data/columns.json", "utf8"));
const { columns } = publishedColumns(store);
const one = columns[0];
assert.ok(!columnPageHtml(one, "tr", []).includes('data-related="columns"'), "boş veride modül yok");
const withRel = columnPageHtml(one, "tr", columns);
if (relatedColumns(one, columns).length) {
  assert.ok(withRel.includes("İlgili yazılar"));
  assert.ok(!withRel.includes(`data-related="columns"`) || !withRel.split('data-related="columns"')[1].split("</aside>")[0].includes(`href="../${one.path}"`), "kendine link yok");
}

// Haber: maç sayfası, kendine link yok, en az 3 öğe yoksa boş
const now = Date.parse("2026-10-20T12:00:00Z");
const matchPages = [
  { slug: "fenerbahce-x-20-ekim-2026", homeTeam: "Fenerbahçe", awayTeam: "X", kickoff: "2026-10-20T21:00:00+03:00", league: "UCL" },
  { slug: "y-fenerbahce-1-ekim-2026", homeTeam: "Y", awayTeam: "Fenerbahçe", kickoff: "2026-10-01T21:00:00+03:00" }
];
assert.equal(teamMatchPage("Fenerbahce", matchPages, { now }).slug, "fenerbahce-x-20-ekim-2026");
assert.equal(teamMatchPage("Fenerbahçe", matchPages, { now, exists: () => false }), null);
const art = (id, team, tags = []) => ({ id, title: `Haber ${id}`, team, tags, publishedAt: "2026-10-10T00:00:00Z" });
const article = art("n1", "Fenerbahçe");
const pool = [article, art("n2", "Fenerbahçe"), art("n3", "Fenerbahçe"), art("n4", "Galatasaray")];
const items = relatedForNews(article, { news: pool, matchPages, now, articlePath: (a) => `haber/${a.id}.html` });
assert.ok(items.length >= 3 && items.length <= 5);
assert.equal(items[0].kind, "match");
assert.ok(!items.some((i) => i.path === "haber/n1.html"), "kendine link yok");
assert.ok(!items.some((i) => i.path === "haber/n4.html"), "başka takım girmez");
assert.deepEqual(relatedForNews(art("z", "Bilinmeyen"), { news: pool, matchPages, now, articlePath: (a) => `haber/${a.id}.html` }), []);
assert.deepEqual(relatedForNews(article, {}), []);

console.log("related content tests passed");
