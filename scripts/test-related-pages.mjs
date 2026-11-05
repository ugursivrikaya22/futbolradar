#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveTeamSlug,
  teamRelatedLinks,
  relatedPagesBlock,
  injectRelatedBlock,
  START,
  END
} from "./lib/relatedPages.mjs";

console.log("related-pages");

{
  const slugs = new Set(["galatasaray", "basaksehir", "gaziantep-fk"]);
  assert.equal(resolveTeamSlug({ id: "galatasaray", name: "Galatasaray" }, slugs), "galatasaray");
  assert.equal(resolveTeamSlug({ id: "564", name: "Başakşehir" }, slugs), "basaksehir");
  assert.equal(resolveTeamSlug({ id: "3573", name: "Gaziantep FK" }, slugs), "gaziantep-fk");
  console.log("  ok  slug eşlemesi");
}

{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "fr-rel-"));
  fs.mkdirSync(path.join(sandbox, "takimlar", "galatasaray"), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "takimlar", "galatasaray.html"), "<html></html>");
  fs.writeFileSync(path.join(sandbox, "takimlar", "galatasaray", "kadro.html"), "<html></html>");
  fs.writeFileSync(path.join(sandbox, "galatasaray-puan-durumu.html"), "<html></html>");
  fs.mkdirSync(path.join(sandbox, "haber"), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "haber", "galatasaray-ornek.html"), "<html></html>");
  const links = teamRelatedLinks(sandbox, "galatasaray", "Galatasaray");
  assert.ok(links.some((l) => l.href === "/takimlar/galatasaray/kadro"));
  assert.ok(links.some((l) => l.href === "/galatasaray-puan-durumu"));
  assert.ok(links.some((l) => l.href.startsWith("/haber/")));
  assert.ok(!links.some((l) => l.href.includes("yok")));
  const block = relatedPagesBlock(links, { currentPath: "takimlar/galatasaray" });
  assert.ok(block.includes(START) && block.includes("İlgili sayfalar"));
  assert.ok(!block.includes('href="/takimlar/galatasaray"'), "kendi sayfasına link olmamalı");
  const html = injectRelatedBlock("<html><body><footer data-shared-layout=\"footer\">x</footer></body></html>", block);
  assert.ok(html.includes(START) && html.includes("data-shared-layout=\"footer\""));
  const again = injectRelatedBlock(html, block);
  assert.equal(again, html, "idempotent");
  console.log("  ok  bağlantı üretimi + enjeksiyon idempotent");
}

// Canlı depo: galatasaray sayfası enjekte edilebilmeli (dosya var)
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = path.join(root, "takimlar", "galatasaray.html");
  assert.ok(fs.existsSync(file));
  const links = teamRelatedLinks(root, "galatasaray", "Galatasaray");
  assert.ok(links.length >= 5, `galatasaray ilgili bağlantı az: ${links.length}`);
  console.log(`  ok  depoda Galatasaray için ${links.length} ilgili bağlantı`);
}

console.log("related-pages OK");
