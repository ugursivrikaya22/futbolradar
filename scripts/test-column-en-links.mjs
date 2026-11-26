/**
 * İNGİLİZCE KÖŞE YAZISI İÇ BAĞLANTILARI
 *
 * İngilizce yazı gövdesinde iç bağlantı `en/team/x.html` biçiminde yazılır;
 * üretici sayfanın dizinine göre ön eki kendisi ekler. Yazar `../en/team/x.html`
 * yazarsa bağlantı `en/columns/` içinden `/en/en/team/x.html` olarak çözülür ve
 * `audit-interaction-routes` kapısı derlemeyi düşürür. Bu test hatayı yazı
 * yayımlanmadan, kaynakta yakalar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { columnPageHtml } from "./generate-column-pages.mjs";

const require = createRequire(import.meta.url);
const { publishedColumns } = require("../services/columnService.js");
const store = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "columns.json"), "utf8"));

let checked = 0;
for (const column of publishedColumns(store, { locale: "en" }).columns) {
  assert.ok(column.path.startsWith("en/columns/"), `${column.id}: beklenmeyen yol ${column.path}`);
  const html = columnPageHtml(column, "en");
  const body = html.slice(html.indexOf('class="column-body"'), html.indexOf("</article>"));
  for (const [, href] of body.matchAll(/<a href="([^"]+)"/g)) {
    if (/^(?:[a-z]+:|\/|#)/i.test(href)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(column.path), href.split("#")[0]));
    assert.ok(!resolved.startsWith("en/en/") && !resolved.startsWith("../"),
      `${column.id}: iç bağlantı yanlış çözülüyor: ${href} → ${resolved}`);
    checked += 1;
  }
}
assert.ok(checked > 0, "denetlenen iç bağlantı olmalı");
console.log(`İngilizce köşe yazısı iç bağlantı testi geçti (${checked} bağlantı).`);
