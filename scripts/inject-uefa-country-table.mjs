#!/usr/bin/env node
/**
 * UEFA ülke puanı tablosunu uefa-ulke-puani-siralamasi.html içindeki işaretli
 * bloğa yeniden yazar. Son-işlem zincirinde çalışır (saatlik + tam derleme);
 * yalnızca data/uefa-country-coefficients.json okur, hiçbir API çağrısı yapmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readUefaCoefficients, renderUefaCountryBlock, UEFA_BLOCK_START, UEFA_BLOCK_END } from "./lib/uefaCountryTable.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "uefa-ulke-puani-siralamasi.html";
const block = renderUefaCountryBlock(readUefaCoefficients(root));
const re = new RegExp(`${UEFA_BLOCK_START}[\\s\\S]*?${UEFA_BLOCK_END}`);
let changed = 0;
for (const dir of [root, path.join(root, "public")]) {
  const target = path.join(dir, FILE);
  if (!fs.existsSync(target)) continue;
  const html = fs.readFileSync(target, "utf8");
  if (!re.test(html)) continue;
  const next = html.replace(re, block);
  if (next !== html) { fs.writeFileSync(target, next, "utf8"); changed++; }
}
console.log(`[uefa-country-table] ${changed} dosya güncellendi`);
