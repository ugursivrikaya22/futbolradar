/**
 * KÖŞE YAZISI HABER KAPISI TESTLERİ
 *
 * Söz: doğrulanmamış habere köşe yazısı yazılmaz ve yayımlanmaz.
 * Kapı services/columnNewsGate.js içinde; burada üç yüzeyden sınanıyor:
 * kapının kendisi, yayın süzgeci (publishedColumns) ve taslak betiği.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { checkColumnNewsBasis, NEWS_REQUIRED_FROM } = require("../services/columnNewsGate.js");
const { publishedColumns } = require("../services/columnService.js");

const OFFICIAL = {
  id: "resmi-haber", slug: "resmi-haber", status: "verified",
  title: "Kulüp resmen açıkladı", summary: "Kulüp yeni transferi resmî sitesinde duyurdu.",
  sources: [{ name: "Kulüp", url: "https://www.trabzonspor.org.tr/news/ornek" }]
};
const CLAIM = {
  id: "iddia-haber", slug: "iddia-haber", status: "verified",
  title: "Bomba iddia: transfer kulisi", summary: "Basında iddia edildi, kulüp doğrulamadı.",
  sources: [{ name: "Gazete", url: "https://www.hurriyet.com.tr/ornek" }]
};
const ARCHIVED = { ...OFFICIAL, id: "arsiv-haber", slug: "arsiv-haber", status: "archived" };
const NEWS = [OFFICIAL, CLAIM, ARCHIVED];

function column(overrides = {}) {
  return {
    id: "ornek", title: "Örnek", author: "Yazar", date: "2026-11-27T10:00:00+03:00",
    category: "transfer-yorumu", status: "published", excerpt: "Özet.", body: ["Gövde."],
    ...overrides
  };
}

// 1) Doğrulanmış resmî habere bağlı transfer yorumu geçer.
assert.equal(checkColumnNewsBasis(column({ newsRef: "resmi-haber" }), NEWS).ok, true);

// 2) newsRef'siz yeni transfer yorumu geçmez.
const missing = checkColumnNewsBasis(column(), NEWS);
assert.equal(missing.ok, false);
assert.match(missing.reason, /newsRef/);

// 3) İddia düzeyindeki haber dayanak olamaz.
const claim = checkColumnNewsBasis(column({ newsRef: "iddia-haber" }), NEWS);
assert.equal(claim.ok, false);
assert.equal(claim.newsStatus, "claim");

// 4) Arşivlenmiş / olmayan haber dayanak olamaz.
assert.equal(checkColumnNewsBasis(column({ newsRef: "arsiv-haber" }), NEWS).ok, false);
assert.equal(checkColumnNewsBasis(column({ newsRef: "yok" }), NEWS).ok, false);

// 5) Başka kategoride newsRef verilmişse yine denetlenir; verilmemişse uygulanmaz.
assert.equal(checkColumnNewsBasis(column({ category: "mac-yorumu" }), NEWS).ok, true);
assert.equal(checkColumnNewsBasis(column({ category: "mac-yorumu", newsRef: "iddia-haber" }), NEWS).ok, false);

// 6) Kapıdan önceki transfer yorumları geriye dönük düşmez.
assert.equal(checkColumnNewsBasis(column({ date: "2026-11-10T10:00:00+03:00" }), NEWS).ok, true);
assert.ok(Date.parse(NEWS_REQUIRED_FROM) > Date.parse("2026-11-11T21:20:00+03:00"));

// 7) publishedColumns kapıyı uygular: iddiaya bağlı yazı yayına çıkmaz.
{
  const store = { columns: [
    column({ id: "iyi", newsRef: "resmi-haber" }),
    column({ id: "kotu", newsRef: "iddia-haber" }),
    column({ id: "bagsiz" })
  ] };
  const { columns, rejected } = publishedColumns(store, { news: NEWS });
  assert.deepEqual(columns.map((c) => c.id), ["iyi"]);
  assert.deepEqual(rejected.map((r) => r.id).sort(), ["bagsiz", "kotu"]);
}

// 8) Gerçek veri: yayındaki her haber bağlı yazı kapıdan geçiyor ve Salah yazısı resmî habere bağlı.
{
  const store = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
  const { rejected } = publishedColumns(store);
  assert.deepEqual(rejected, [], `kapıdan düşen yayın: ${JSON.stringify(rejected)}`);
  const salah = store.columns.find((c) => c.id === "mohamed-salah-trabzonspor-saglik-kontrolu-kose-yazisi");
  assert.ok(salah && salah.newsRef, "Salah yazısı haber dayanağına bağlı olmalı");
  assert.equal(checkColumnNewsBasis(salah).newsStatus, "official");
}

// 9) Taslak betiği: haberi olmayan / iddia haberine bağlı transfer yorumu taslağı açılmaz.
{
  const run = (extra) => spawnSync(process.execPath, [
    "scripts/create-column-draft.mjs", "--title=Kapi Testi Taslak", "--author=Test",
    "--category=transfer-yorumu", "--dry-run", ...extra
  ], { cwd: root, encoding: "utf8" });
  const noRef = run([]);
  assert.notEqual(noRef.status, 0, "newsRef'siz transfer taslağı reddedilmeli");
  assert.match(noRef.stderr, /haber kapısı/);
  const claimRef = run(["--news=trabzonspor-salah-83cf497f"]);
  assert.notEqual(claimRef.status, 0, "iddia haberine bağlı taslak reddedilmeli");
  const ok = run(["--news=mohamed-salah-trabzonspor-transferi-resmen-aciklandi"]);
  assert.equal(ok.status, 0, ok.stderr);
}

console.log("Haber kapısı testleri geçti.");
