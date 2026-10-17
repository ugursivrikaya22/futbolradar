#!/usr/bin/env node
/**
 * GİZLİLİK SAYFASI — "Favoriler ve yerel depolama" bildirimi.
 *
 * Favori takım/maç ve bildirim tercihleri yalnızca tarayıcıda (localStorage) durur; bu
 * özelliklerin sunucuya yazdığı bir şey yoktur. Okuyucunun bunu, sıfırlama yolunu ve
 * bildirimlerin izin istemediğini gizlilik sayfasında okuyabilmesi gerekir. Sayfa
 * `generate-static-seo-pages` çıktısıdır; saatlik üretim onu yeniden yazdığı için
 * metin işaretli blok olarak son-işlem zincirinde eklenir (idempotent).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- privacy-favorites:start -->";
const END = "<!-- privacy-favorites:end -->";

export const PRIVACY_BLOCK = `${START}
      <section class="container privacy-favorites" aria-labelledby="privacy-favorites-title">
        <h2 id="privacy-favorites-title">Favoriler ve yerel depolama</h2>
        <p>Favori takımların, yıldızladığın maçlar ve maç bildirimi tercihlerin yalnızca tarayıcının yerel depolama alanında (localStorage) saklanır. Sunucuya, veritabanına ya da üçüncü taraflara gönderilmez; üyelik gerekmez. Bu özellikler için sunucumuzda kişisel veri işlenmez.</p>
        <p>Saklanan bilgi yalnızca takım ve maç kimlikleri ile görünen adlardır; seni tanımlamaz. İstediğin an <a href="./takip-ettiklerim">Takip Ettiklerim</a> sayfasındaki "Tüm favorilerimi sıfırla" düğmesiyle ya da tarayıcı verilerini temizleyerek silebilirsin.</p>
        <p>Maç bildirimleri site açıkken ekranda gösterilir ve tarayıcı bildirim izni istemez. Ayrı olan "Favori Takımın" bildirim paneli ise tarayıcı izni ve abonelik gerektirir; yalnızca sen açarsan çalışır ve aynı panelden kapatılır.</p>
      </section>
${END}
`;

export function injectPrivacyNotice(html) {
  const stripped = html.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`, "g"), "");
  const anchor = /<section class="source-strip"/.exec(stripped);
  if (!anchor) return stripped;
  // Satır başına yazılır: anchor'un girintisi bozulmaz ve yeniden çalıştırmak aynı çıktıyı verir.
  const lineStart = stripped.lastIndexOf("\n", anchor.index) + 1;
  return stripped.slice(0, lineStart) + PRIVACY_BLOCK + stripped.slice(lineStart);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let changed = 0;
  for (const base of [root, path.join(root, "public")]) {
    const file = path.join(base, "gizlilik.html");
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const after = injectPrivacyNotice(before);
    if (after !== before) { fs.writeFileSync(file, after); changed += 1; }
  }
  console.log(`inject-privacy-notice: ${changed} dosya güncellendi`);
}
