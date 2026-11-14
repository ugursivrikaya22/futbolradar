#!/usr/bin/env node
/**
 * /x-hesaplari.html — doğrulanmış hesap listesi, künye bağlantıları ve site haritası.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadAccounts, profileUrl } from "./generate-x-accounts-page.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { SOURCE_LINK_REL, isAllowedSourceHost, isAllowedSourceUrl, isXDirectoryProfileUrl } = require("../services/sourceLinks.js");

const data = loadAccounts();
const html = fs.readFileSync(path.join(root, "x-hesaplari.html"), "utf8");
const publicHtml = fs.readFileSync(path.join(root, "public", "x-hesaplari.html"), "utf8");
assert.equal(publicHtml, html, "public/x-hesaplari.html ayna kopyası kökle aynı olmalı");

assert.match(html, /<title>Takip Edilecek Futbol X Hesapları \| FutbolRadar<\/title>/);
assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/x-hesaplari\.html" \/>/);
assert.match(html, /<meta name="description" content="[^"]+" \/>/);
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
assert.ok(html.includes(data.intro));
assert.ok(html.includes('data-shared-layout="header"') && html.includes('data-shared-layout="footer"'));
assert.ok(html.includes('href="./page.css?v='));
assert.ok(html.includes(">Bizi X'te takip edin</a>"));
assert.ok(!/takipçi|followers?|abone/i.test(html), "takipçi sayısı yazılmamalı");

const accounts = [
  ...data.groups.flatMap((group) => group.accounts),
  data.ownAccount
];
let cursor = 0;
for (const group of data.groups) {
  const titleAt = html.indexOf(`>${group.title}<`, cursor);
  assert.ok(titleAt > cursor, `grup sırası bozuldu: ${group.title}`);
  cursor = titleAt;
  for (const account of group.accounts) {
    const href = profileUrl(account.handle);
    const anchor = `<a href="${href}" target="_blank" rel="${SOURCE_LINK_REL}"><span>@${account.handle}</span><strong>${account.label}</strong><p>${href}</p></a>`;
    const at = html.indexOf(anchor, cursor);
    assert.ok(at > cursor, `hesap eksik ya da sırası yanlış: @${account.handle}`);
    cursor = at;
  }
}

const ownHref = profileUrl(data.ownAccount.handle);
assert.ok(html.includes(`<a href="${ownHref}" target="_blank" rel="${SOURCE_LINK_REL}">Bizi X'te takip edin</a>`));
assert.equal(accounts.length, 41);

assert.equal(isAllowedSourceHost("x.com"), false, "x.com ana bilgisayarı açık kalmamalı");
for (const account of accounts) {
  const href = profileUrl(account.handle);
  assert.equal(isXDirectoryProfileUrl(href), true, href);
  assert.equal(isXDirectoryProfileUrl(`${href}/status/1`), false, href);
  assert.equal(isAllowedSourceUrl(href), false, `${href} profil kökü haber kaynağı olmamalı`);
}
assert.equal(isXDirectoryProfileUrl("https://x.com/NotOnTheList"), false);

for (const file of ["sitemap.xml", "public/sitemap.xml", "sitemaps/sitemap-core.xml", "public/sitemaps/sitemap-core.xml"]) {
  const xml = fs.readFileSync(path.join(root, file), "utf8");
  assert.ok(xml.includes("<loc>https://www.futbolradar.com/x-hesaplari.html</loc>"), `${file} sayfayı listelemiyor`);
}
assert.equal(
  fs.readFileSync(path.join(root, "sitemap.xml"), "utf8"),
  fs.readFileSync(path.join(root, "public/sitemap.xml"), "utf8")
);

const search = fs.readFileSync(path.join(root, "search-index.json"), "utf8");
assert.ok(search.includes('"href":"x-hesaplari.html"'));
assert.ok(fs.readFileSync(path.join(root, "scripts/generate-static-seo-pages.mjs"), "utf8").includes('"x-hesaplari.html"'));
assert.ok(html.includes('href="./x-hesaplari.html"'), "alt bilgi sayfaya bağlanmalı; aksi halde sitemap kaydı yetim kalır");

console.log("test-x-accounts-page: doğrulanmış liste, künye bağlantıları ve site haritası tamam");
