#!/usr/bin/env node
/**
 * FIFA erkek dünya sıralamasını uefa-ulke-puani-siralamasi.html içindeki
 * işaretli bloğa yazar. Son-işlem zincirinde çalışır; yalnızca
 * data/fifa-men-world-ranking.json okur, API çağrısı yapmaz.
 * UEFA katsayı bloğuna dokunmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UEFA_BLOCK_END } from "./lib/uefaCountryTable.mjs";
import { readFifaMenRanking, renderFifaMenRankingBlock, FIFA_BLOCK_START, FIFA_BLOCK_END } from "./lib/fifaMenRankingTable.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "uefa-ulke-puani-siralamasi.html";
const block = renderFifaMenRankingBlock(readFifaMenRanking(root));
const re = new RegExp(`${FIFA_BLOCK_START}[\\s\\S]*?${FIFA_BLOCK_END}`);
let changed = 0;
for (const dir of [root, path.join(root, "public")]) {
  const target = path.join(dir, FILE);
  if (!fs.existsSync(target)) continue;
  const html = fs.readFileSync(target, "utf8");
  let next = html;
  if (re.test(html)) next = html.replace(re, block);
  else if (html.includes(UEFA_BLOCK_END)) next = html.replace(UEFA_BLOCK_END, `${UEFA_BLOCK_END}${block}`);
  if (next !== html) { fs.writeFileSync(target, next, "utf8"); changed++; }
}
console.log(`[fifa-men-ranking] ${changed} dosya güncellendi`);
