#!/usr/bin/env node
/**
 * DİL DEĞİŞTİRİCİYİ hreflang EŞİNE BAĞLA (EMİR 1B, Görev 1 — locale yönlendirme).
 *
 * Dil kutusu (`data-lang-switch`) karşı dildeki sayfayı bulamayınca karşı
 * dilin ANA SAYFASINA düşüyor (scripts/lib/layout.mjs#languageSwitch). Lig puan
 * durumu sayfaları, anketler ve hafta numaralı maç sayfaları bu yüzden dil
 * değiştirirken ana sayfaya atıyordu — oysa sayfanın kendi hreflang'ı doğru
 * eşi biliyor. Burada tek kural uygulanır: dil kutusu hreflang eşiyle AYNI
 * sayfaya gider. hreflang eşi yoksa (eş gerçekten yok) kutu olduğu gibi kalır.
 *
 * Yalnızca bağlantı gerçekten FARKLI bir sayfaya gidiyorsa yazılır; doğru
 * olanlara dokunulmaz. Kök-mutlak yol kullanılır: `/en` eğik çizgisiz
 * sunulduğundan göreli yol orada güvenilir değildir. Idempotent.
 *
 *   node scripts/sync-lang-switch.mjs          # yazar
 *   node scripts/sync-lang-switch.mjs --check  # yalnızca sayar, yazmaz
 */
import fs from "node:fs";
import path from "node:path";
import { DOMAIN, createResolver, extractSeoLinks, htmlFiles, servingUrls, toRootPath } from "./lib-link-audit.mjs";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const resolver = createResolver(root);

const SWITCH = /(<a\b[^>]*\bdata-lang-switch="([a-z-]+)"[^>]*)(>)/gi;
const hrefOf = (tag) => (/\bhref="([^"]*)"/i.exec(tag) || [])[1];

let scanned = 0;
let changed = 0;
for (const full of htmlFiles(root)) {
  const html = fs.readFileSync(full, "utf8");
  if (!html.includes("data-lang-switch")) continue;
  scanned += 1;
  const rel = path.relative(root, full).split(path.sep).join("/");
  const { alternates } = extractSeoLinks(html);
  const pageUrl = servingUrls(rel, resolver)[0];

  const next = html.replace(SWITCH, (whole, open, lang, close) => {
    const alt = alternates.find((entry) => entry.lang.toLowerCase().startsWith(lang.toLowerCase()));
    const current = hrefOf(open);
    if (!alt || !current || !alt.href.startsWith(DOMAIN)) return whole;
    const altPath = alt.href.slice(DOMAIN.length) || "/";
    const altHit = resolver.resolve(altPath);
    if (altHit.status === "404") return whole; // karşılık yoksa fallback kalsın
    const currentTarget = toRootPath(current, pageUrl);
    const currentHit = currentTarget == null ? null : resolver.resolve(currentTarget);
    const same = currentHit && currentHit.status !== "404" && (currentHit.file || currentHit.final) === (altHit.file || altHit.final);
    // Aynı sayfaya gidiyor ama bir 301'den geçiyorsa (ör. `futbolcu/x.html` → `/futbolcu/x`)
    // yine yeniden yazılır: hreflang eşi son adresi biliyor, kullanıcı gereksiz sıçramasın.
    if (same && currentHit.status === "ok") return whole;
    return `${open.replace(/\bhref="[^"]*"/i, `href="${altPath}"`)}${close}`;
  });
  if (next !== html) {
    changed += 1;
    if (!checkOnly) fs.writeFileSync(full, next, "utf8");
  }
}
console.log(`lang-switch: ${scanned} sayfa tarandı, ${changed} sayfada dil kutusu hreflang eşine ${checkOnly ? "bağlanmalı" : "bağlandı"}.`);
if (checkOnly && changed) process.exitCode = 1;
