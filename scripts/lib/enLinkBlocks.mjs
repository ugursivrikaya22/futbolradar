/**
 * İNGİLİZCE SAYFALARA BAĞLANTI BLOĞU EKLEME.
 *
 * Bir İngilizce üretici, yazdığı sayfalara giden bağlantıyı başka bir
 * üreticinin sayfasına (istatistik merkezi, takım sayfası) KENDİSİ ekler.
 * Bağlantıyı hedef sayfanın üreticisine yazdırmak iki kümeyi ayrı yerde
 * hesaplatırdı: biri bir sayfayı atladığında öteki ona bağlantı vermeye
 * devam eder, kırık bağlantı denetimi de yayını durdururdu. Burada bağlantı
 * yalnızca GERÇEKTEN yazılmış sayfalar için üretilir.
 *
 * Blok işaretlidir ve her koşuda baştan yazılır; `html` boşsa eski blok
 * kaldırılır (sayfa artık üretilmiyorsa bağlantı da kalmaz).
 */
import fs from "node:fs";
import path from "node:path";

export function integrateLinkBlock(root, file, id, html) {
  const marker = new RegExp(`<!-- ${id}:start -->[\\s\\S]*?<!-- ${id}:end -->`, "g");
  let changed = 0;
  for (const base of [root, path.join(root, "public")]) {
    const target = path.join(base, file);
    if (!fs.existsSync(target)) continue;
    const before = fs.readFileSync(target, "utf8");
    const clean = before.replace(marker, "");
    const next = html ? clean.replace("</main>", `<!-- ${id}:start -->${html}<!-- ${id}:end --></main>`) : clean;
    if (next !== before) {
      fs.writeFileSync(target, next, "utf8");
      changed += 1;
    }
  }
  return changed;
}
