#!/usr/bin/env node
/**
 * "SIK KULLANILAN SAYFALAR" ŞERİDİ — ziyaretçiyi sitede tutan iç bağlantılar.
 *
 * Canlı skor, bugünün maçları, maç sonuçları, puan durumu ve dört büyük
 * takımın sayfaları birbirine yeterince bağlanmıyordu (SEO denetimi,
 * "iç bağlantı boşlukları"): bir okuyucu bir yüzeyden diğerine ana sayfaya
 * dönmeden geçemiyordu. Burada sabit, küçük bir bağlantı kümesi sayfanın
 * altına (ortak altlığın hemen üstüne) düz HTML olarak yazılır.
 *
 *  • JavaScript yok, açılır pencere yok, veri isteği yok: yalnızca <a>.
 *  • Kendi sayfasına bağlantı verilmez; var olmayan sayfaya bağlantı verilmez.
 *  • İşaretli blok: yeniden çalıştırmak aynı çıktıyı üretir (idempotent).
 *
 * Son-işlem zincirinde (scripts/lib/postprocessChain.mjs) çalışır; yani saatlik
 * üretim sayfaları yeniden yazsa da şerit geri gelir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LINKS = [
  { file: "canli-skor.html", label: "Canlı Skor" },
  { file: "bugunun-maclari.html", label: "Bugünün Maçları" },
  { file: "mac-sonuclari.html", label: "Maç Sonuçları" },
  { file: "super-lig-puan-durumu.html", label: "Süper Lig Puan Durumu" },
  { file: "galatasaray-maclari.html", label: "Galatasaray" },
  { file: "fenerbahce-maclari.html", label: "Fenerbahçe" },
  { file: "besiktas-maclari.html", label: "Beşiktaş" },
  { file: "trabzonspor-maclari.html", label: "Trabzonspor" },
  { file: "analizler.html", label: "Maç Analizleri" },
  { file: "kose-yazilari.html", label: "Köşe Yazıları" },
  // Uzantısız adres: `.html` biçimi 301 ile buna yönleniyor (vercel.json).
  { file: "tahmin-ligi.html", href: "./tahmin-ligi", label: "Tahmin Ligi" }
];

/** Şeridin yazıldığı sayfalar. */
export const QUICK_LINK_PAGES = [
  "canli-skor.html",
  "bugunun-maclari.html",
  "mac-sonuclari.html",
  "super-lig-puan-durumu.html",
  "galatasaray-maclari.html",
  "fenerbahce-maclari.html",
  "besiktas-maclari.html",
  "trabzonspor-maclari.html",
  "analizler.html",
  "kose-yazilari.html"
];

const START = "<!-- quick-links:start -->";
const END = "<!-- quick-links:end -->";

export function quickLinksBlock(page, exists = (file) => fs.existsSync(path.join(root, file))) {
  const items = LINKS
    .filter((link) => link.file !== page && exists(link.file))
    .map((link) => `<a href="${link.href || `./${link.file}`}">${link.label}</a>`);
  if (!items.length) return "";
  return `${START}\n<nav class="container quick-links" aria-label="Sık kullanılan sayfalar" data-quick-links><h2 class="quick-links__title">Sık kullanılan sayfalar</h2><div class="quick-links__list">${items.join("")}</div></nav>\n${END}\n`;
}

export function injectQuickLinks(html, page, exists) {
  const stripped = html.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`, "g"), "");
  const block = quickLinksBlock(page, exists);
  if (!block) return stripped;
  const footer = /<footer\b[^>]*data-shared-layout="footer"/.exec(stripped) || /<footer\b/.exec(stripped);
  if (!footer) return stripped;
  return stripped.slice(0, footer.index) + block + stripped.slice(footer.index);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let changed = 0;
  for (const page of QUICK_LINK_PAGES) {
    const file = path.join(root, page);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const after = injectQuickLinks(before, page);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed += 1;
    }
  }
  console.log(`inject-quick-links: ${QUICK_LINK_PAGES.length} sayfa, ${changed} güncellendi`);
}
