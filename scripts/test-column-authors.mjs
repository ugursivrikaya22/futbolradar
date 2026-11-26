/**
 * KÖŞE YAZISI YAZAR ALTYAPISI
 *
 * Sözler: kişi yazar kayıtlı ve biyografili olmadan yayımlanmaz; Article
 * şemasında `author` dolu gelir (kayıtlıysa Person + biyografi + sameAs);
 * yazar sayfası biyografiyi gösterir; hiçbir kişi uydurulmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { authorPageHtml, columnPageHtml, groupAuthors } from "./generate-column-pages.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { resolveAuthor, validateAuthorForPublish, validateAuthors, loadAuthors } = require("../services/authorService.js");
const { presentColumn, publishedColumns } = require("../services/columnService.js");

const ANA = {
  id: "ayse-ornek", type: "Person", name: "Ayşe Örnek", slug: "ayse-ornek", jobTitle: "Spor yazarı",
  bio: "Örnek biyografi: test amacıyla uydurulmuş, yayımlanmayan bir kayıttır ve yalnızca bu testte kullanılır.",
  sameAs: ["https://example.org/ayse", "http://guvenli-degil.example/x"], aliases: ["A. Örnek"]
};

function entry(overrides = {}) {
  return {
    id: "yazar-testi", title: "Yazar testi", author: "FutbolRadar", date: "2026-11-20T10:00:00+03:00",
    category: "mac-yorumu", status: "published", excerpt: "Özet.", body: ["Gövde."], ...overrides
  };
}

// 1) Gerçek kayıt dosyası tutarlı ve hiçbir kişi içermiyor (uydurma yok).
{
  assert.deepEqual(validateAuthors(), []);
  const real = loadAuthors();
  assert.ok(real.some((a) => a.id === "futbolradar" && a.type === "Organization"));
  assert.ok(real.every((a) => a.type === "Organization" || (a.bio && a.bio.length >= 40)), "kişi yazar biyografili olmalı");
}

// 2) Kayıt doğrulaması: kişi yazar biyografisiz / tekrarlı slug reddedilir.
{
  assert.ok(validateAuthors([{ ...ANA, bio: "kısa" }]).some((e) => /biyografi/.test(e)));
  assert.ok(validateAuthors([ANA, { ...ANA, id: "baska" }]).some((e) => /slug tekrar/.test(e)));
  assert.ok(validateAuthors([{ ...ANA, sameAs: ["http://x.example"] }]).some((e) => /sameAs/.test(e)));
  assert.deepEqual(validateAuthors([{ ...ANA, sameAs: ["https://example.org/ayse"] }]), []);
}

// 3) Çözümleme: kimlik, ad (Türkçe karakter/büyük-küçük harf farkı), takma ad.
{
  const list = [ANA];
  assert.equal(resolveAuthor({ authorId: "ayse-ornek" }, list).name, "Ayşe Örnek");
  assert.equal(resolveAuthor({ author: "AYSE ORNEK" }, list).registered, true);
  assert.equal(resolveAuthor({ author: "A. Örnek" }, list).slug, "ayse-ornek");
  assert.equal(resolveAuthor({ author: "A. Örnek" }, list).sameAs.length, 1, "yalnızca https sameAs kalır");
  const unknown = resolveAuthor({ author: "Kayıtsız Kişi" }, list);
  assert.equal(unknown.registered, false);
  assert.equal(unknown.type, "Person");
  assert.equal(resolveAuthor({ author: "FutbolRadar" }, []).type, "Organization");
  assert.equal(resolveAuthor({ author: "FutbolRadar" }, []).path, "yazarlar/futbolradar.html", "eski adres değişmez");
}

// 4) Yayın kapısı: kayıtsız kişi yazarın yazısı yayımlanmaz; FutbolRadar yayımlanır.
{
  assert.equal(validateAuthorForPublish(resolveAuthor({ author: "Kayıtsız Kişi" }, [])).ok, false);
  assert.equal(validateAuthorForPublish(resolveAuthor({ author: "Ayşe Örnek" }, [ANA])).ok, true);
  const { columns, rejected } = publishedColumns({ columns: [
    entry({ id: "kurum" }),
    entry({ id: "kisi", author: "Kayıtsız Kişi" })
  ] });
  assert.deepEqual(columns.map((c) => c.id), ["kurum"]);
  assert.match(rejected[0].errors[0], /yazar kayıtlı değil/);
}

// 5) Sayfa: kayıtlı kişi yazar → yazar kutusu, Article şemasında Person + biyografi + sameAs.
{
  const base = presentColumn(entry({ author: "Ayşe Örnek" }));
  const column = { ...base, authorProfile: resolveAuthor({ author: "Ayşe Örnek" }, [ANA]), authorPath: "yazarlar/ayse-ornek.html" };
  const html = columnPageHtml(column);
  assert.match(html, /<aside class="column-author-box"[^>]*>[\s\S]*Ayşe Örnek[\s\S]*Spor yazarı[\s\S]*Örnek biyografi/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"NewsArticle"[\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.author["@type"], "Person");
  assert.equal(ld.author.name, "Ayşe Örnek");
  assert.equal(ld.author.url, "https://www.futbolradar.com/yazarlar/ayse-ornek.html");
  assert.equal(ld.author.jobTitle, "Spor yazarı");
  assert.match(ld.author.description, /Örnek biyografi/);
  assert.deepEqual(ld.author.sameAs, ["https://example.org/ayse"]);

  const [group] = groupAuthors([column]);
  const page = authorPageHtml(group);
  assert.match(page, /<p class="column-author-bio">Örnek biyografi/);
  assert.match(page, /rel="me noopener noreferrer"/);
  const pageLd = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(pageLd.mainEntity["@type"], "Person");
  assert.equal(pageLd.mainEntity.name, "Ayşe Örnek");
}

// 6) Mevcut kurum yazarı: author alanı dolu, Organization; kutu biyografiyi gösterir.
{
  const html = columnPageHtml(presentColumn(entry()));
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"NewsArticle"[\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.author["@type"], "Organization");
  assert.equal(ld.author.name, "FutbolRadar");
  assert.ok(ld.author.url && ld.author.description);
  assert.match(html, /class="column-author-box"/);
}

// 7) Gerçek veri: yayımlanan hiçbir yazı yazar kapısına takılmıyor.
{
  const store = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
  const { rejected } = publishedColumns(store);
  assert.deepEqual(rejected.filter((r) => r.errors.some((e) => /yazar/.test(e))), []);
}

console.log("Yazar altyapısı testleri geçti.");
