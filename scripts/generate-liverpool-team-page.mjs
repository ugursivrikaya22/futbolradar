#!/usr/bin/env node
/**
 * Liverpool sarmalayıcı — asıl üretim scripts/generate-rich-team-pages.mjs.
 * Eski testler `loadData` / `buildPage` / `faqEntries` / `OUTPUT` bekler.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDataLiverpool as loadData,
  buildPage as buildRich,
  faqEntries,
  generateOne,
  OUTPUT,
  trDate
} from "./generate-rich-team-pages.mjs";
import { RICH_TEAM_PAGES } from "./lib/richTeamPages.mjs";

const ENTRY = RICH_TEAM_PAGES["40"];

export { loadData, faqEntries, OUTPUT, trDate };

export function buildPage(data) {
  return buildRich(data, ENTRY);
}

function main() {
  generateOne("40");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
