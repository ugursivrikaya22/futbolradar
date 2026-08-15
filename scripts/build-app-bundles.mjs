#!/usr/bin/env node
/**
 * SAYFA TÜRÜNE GÖRE app.js DEMETLERİ.
 *
 * `app.js` tek bir IIFE içinde 11.7 bin satır ve 476 KB. Sitenin 3.701
 * sayfası onu yüklüyordu — ama çoğu sayfa içindekilerin neredeyse hiçbirini
 * kullanmıyor. Kancalar sayıldığında tablo şu:
 *
 *   oyuncular/ (678) ve mac/ (306) → app.js'ten YALNIZCA tema düğmesi.
 *   karsilastirma/ (2.642)         → tema + oyuncu kıyaslama.
 *
 * Yani 984 sayfa 476 KB indirip bir düğme için kullanıyordu.
 *
 * ── NEDEN DERLEME ZAMANINDA, ELLE DEĞİL ──────────────────────────────────
 * Kaynak TEK dosya olarak kalıyor: `app.js` hâlâ tek doğruluk kaynağı ve
 * elle bakımı bölünmüyor. Demetler ondan TÜRETİLİYOR. Böylece bir düzeltme
 * iki yerde ayrı ayrı yapılmak zorunda kalmıyor — bu depoda daha önce
 * adresleri iki yerde kurmanın bedeli ödendi (bkz. match-special-pages.json).
 *
 * ── BAĞIMLILIK GRAFİĞİ BİLEREK GENİŞ ─────────────────────────────────────
 * Bir bildirimin gövdesinde başka bir bildirimin adı GEÇİYORSA bağımlılık
 * sayılıyor — yorumda ya da dizede geçse bile. Bu FAZLA dahil eder, eksik
 * dahil etmez. Yanlış yön önemli: fazlası birkaç KB, eksiği çalışma anında
 * ReferenceError ve boş sayfa demek.
 *
 * Bu yüzden güvenli: app.js'te `eval`, `new Function`, `window[...]` ya da
 * hesaplanmış kimlik erişimi YOK (denetlendi); statik analiz eksiksiz.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SRC = path.join(root, "app.js");
const source = fs.readFileSync(SRC, "utf8");
const lines = source.split("\n");

/** Üst düzey bildirimler: IIFE gövdesinde iki boşluk girintili function/var. */
const decls = [];
for (let i = 0; i < lines.length; i += 1) {
  const m = /^ {2}(?:function (\w+)|var (\w+)\s*=)/.exec(lines[i]);
  if (m) decls.push({ name: m[1] || m[2], start: i });
}
if (!decls.length) {
  console.error("app.js içinde üst düzey bildirim bulunamadı — biçim değişmiş olabilir.");
  process.exit(1);
}
for (let i = 0; i < decls.length; i += 1) {
  decls[i].end = i + 1 < decls.length ? decls[i + 1].start : lines.length;
  decls[i].text = lines.slice(decls[i].start, decls[i].end).join("\n");
}

// Sondaki önyükleme bloğu demetlerde YENİDEN üretiliyor; kaynaktakini alma.
const last = decls[decls.length - 1];
const tailStart = lines.findIndex((l, i) => i > last.start && /^\s*if \(document\.readyState === "loading"\)/.test(l));
if (tailStart !== -1) last.text = lines.slice(last.start, tailStart).join("\n");

const prologue = lines.slice(0, decls[0].start).join("\n");
const byName = new Map(decls.map((d) => [d.name, d]));

/** Kaba ama BİLEREK geniş çağrı grafiği. */
const names = [...byName.keys()];
for (const d of decls) {
  d.deps = new Set();
  for (const n of names) {
    if (n === d.name) continue;
    if (new RegExp(`\\b${n}\\b`).test(d.text)) d.deps.add(n);
  }
}

function reachable(roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name) || !byName.has(name)) continue;
    seen.add(name);
    for (const dep of byName.get(name).deps) if (!seen.has(dep)) stack.push(dep);
  }
  return seen;
}

/**
 * DEMET TANIMLARI.
 *
 * Kökler sayfaların GERÇEK kancalarından çıkarıldı (hangi
 * `data-api-target` / öznitelik var), tahminle değil.
 */
const BUNDLES = [
  {
    file: "app-lite.js",
    // Yalnızca tema düğmesi. oyuncular/ ve mac/ sayfalarında app.js'in
    // aradığı başka hiçbir kanca yok.
    roots: ["initThemeToggle"],
    boot: ["initThemeToggle();"]
  },
  {
    file: "app-compare.js",
    roots: ["initThemeToggle", "initPlayerCompare", "initPlayerCompareTray"],
    boot: [
      "initThemeToggle();",
      'initPlayerCompare(document.querySelector(\'[data-api-target="player-compare"]\'));'
    ]
  }
];

const results = [];
for (const bundle of BUNDLES) {
  const missing = bundle.roots.filter((r) => !byName.has(r));
  if (missing.length) {
    console.error(`${bundle.file}: kök bulunamadı → ${missing.join(", ")}`);
    process.exit(1);
  }

  const keep = reachable(bundle.roots);
  const body = decls.filter((d) => keep.has(d.name)).map((d) => d.text).join("\n");

  const code = `${prologue}
${body}

  function bootstrap() {
    ${bundle.boot.join("\n    ")}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
`;

  // SÖZDİZİMİ KAPISI: ayrıştırılamayan demet yayına çıkmamalı.
  try {
    new Function(code);
  } catch (error) {
    console.error(`${bundle.file}: sözdizimi hatası — ${error.message}`);
    process.exit(1);
  }

  const target = path.join(root, bundle.file);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== code) fs.writeFileSync(target, code, "utf8");

  const publicDir = path.join(root, "public");
  if (fs.existsSync(publicDir)) fs.writeFileSync(path.join(publicDir, bundle.file), code, "utf8");

  results.push({ file: bundle.file, decls: keep.size, bytes: Buffer.byteLength(code) });
}

const full = Buffer.byteLength(source);
console.log(`app.js: ${(full / 1024).toFixed(0)} KB · ${decls.length} bildirim`);
for (const r of results) {
  console.log(`  ${r.file.padEnd(16)} ${(r.bytes / 1024).toFixed(0).padStart(4)} KB · ${String(r.decls).padStart(3)} bildirim · %${(100 * r.bytes / full).toFixed(0)} boyut`);
}
