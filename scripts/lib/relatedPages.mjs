/**
 * İLGİLİ SAYFALAR — yalnızca depoda VAR olan dosyalara contextual iç bağlantı.
 *
 * Yeni metin/uydurma içerik YOK: etiketler dosya adından / takım adından gelir.
 * Orphan denetimini güçlendirmek ve takım ↔ haber ↔ köşe ↔ istatistik ↔ arşiv
 * ağını sıkılaştırmak için son-işlem enjektörü kullanır.
 */
import fs from "node:fs";
import path from "node:path";

export const START = "<!-- related-pages:start -->";
export const END = "<!-- related-pages:end -->";

function norm(s) {
  const tr = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u" };
  let out = String(s || "");
  for (const [a, b] of Object.entries(tr)) out = out.split(a).join(b);
  return out.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function resolveTeamSlug(team, slugs) {
  if (!team) return null;
  if (slugs.has(String(team.id))) return String(team.id);
  const n = norm(team.name);
  if (slugs.has(n)) return n;
  for (const slug of slugs) {
    const sn = norm(slug);
    if (!sn) continue;
    if (n.includes(sn) || sn.includes(n)) return slug;
  }
  return null;
}

export function loadTeamSlugMap(root) {
  const dir = path.join(root, "takimlar");
  const slugs = new Set(
    fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((n) => n.endsWith(".html")).map((n) => n.replace(/\.html$/, ""))
      : []
  );
  let teams = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
    teams = Array.isArray(raw) ? raw : [];
  } catch {
    teams = [];
  }
  /** @type {{ slug: string, name: string }[]} */
  const mapped = [];
  for (const team of teams) {
    const slug = resolveTeamSlug(team, slugs);
    if (slug) mapped.push({ slug, name: team.name || slug });
  }
  // Takım JSON'da yoksa bile diskteki slug'ı ekle (ör. stuttgart).
  for (const slug of slugs) {
    if (!mapped.some((t) => t.slug === slug)) mapped.push({ slug, name: slug });
  }
  return mapped;
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function hrefFor(rel) {
  // Uzantısız kanonik tercihi (vercel.json birçok .html'i 301'liyor).
  return `/${rel.replace(/\.html$/, "")}`;
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'", "&#39;": "'", "&apos;": "'" };

/**
 * Bağlantı etiketi: hedef sayfanın KENDİ başlığı (`<title>`).
 *
 * Eskiden etiket dosya adından türetiliyordu ("Köşe: divan kursusunden cikan
 * mesaj ..."): slug ASCII olduğu için Türkçe karakterler okura düşüyordu.
 * Sayfa başlığı zaten yayımlanmış metindir — yeni içerik uydurmaz, yalnızca
 * doğru yazımı kullanır. Başlık okunamazsa eski slug etiketine düşer.
 */
export function pageTitleLabel(root, rel, fallback) {
  try {
    const head = fs.readFileSync(path.join(root, rel), "utf8").slice(0, 4096);
    const m = /<title>([^<]*)<\/title>/i.exec(head);
    if (m) {
      let t = m[1].replace(/&(?:amp|lt|gt|quot|apos|#0?39);/g, (e) => ENTITIES[e] || e).replace(/\s*\|\s*FutbolRadar\s*$/i, "").trim();
      if (t.length > 110) t = `${t.slice(0, 107).trimEnd()}…`;
      if (t) return t;
    }
  } catch {
    /* başlık okunamadı → slug etiketi */
  }
  return fallback;
}

/** Bir takım için yalnızca var olan companion bağlantılar. */
export function teamRelatedLinks(root, slug, name) {
  /** @type {{ href: string, label: string }[]} */
  const links = [];
  const add = (rel, label) => {
    if (exists(root, rel)) links.push({ href: hrefFor(rel), label });
  };
  add(`takimlar/${slug}.html`, `${name} takım profili`);
  add(`takimlar/${slug}/kadro.html`, `${name} kadro`);
  add(`takimlar/${slug}/istatistikler.html`, `${name} istatistikler`);
  add(`takimlar/${slug}/fikstur.html`, `${name} fikstür`);
  add(`takimlar/${slug}/mac-sonuclari.html`, `${name} maç sonuçları`);
  add(`${slug}-puan-durumu.html`, `${name} puan durumu`);
  add(`${slug}-maclari.html`, `${name} maçları`);
  add(`${slug}-oyuncu-radari.html`, `${name} oyuncu radarı`);
  add(`arsiv/kadro-2026-2027-${slug}.html`, `${name} arşiv kadro`);
  // Haber / köşe: slug geçen en fazla 2'şer dosya (sıralı, uydurma yok).
  const newsDir = path.join(root, "haber");
  if (fs.existsSync(newsDir)) {
    const news = fs.readdirSync(newsDir).filter((n) => n.endsWith(".html") && n.includes(slug)).sort().slice(0, 2);
    for (const n of news) links.push({ href: hrefFor(`haber/${n}`), label: `Haber: ${pageTitleLabel(root, `haber/${n}`, n.replace(/\.html$/, "").replace(/-/g, " "))}` });
  }
  const colDir = path.join(root, "kose-yazilari");
  if (fs.existsSync(colDir)) {
    const cols = fs.readdirSync(colDir).filter((n) => n.endsWith(".html") && n.includes(slug)).sort().slice(0, 2);
    for (const n of cols) links.push({ href: hrefFor(`kose-yazilari/${n}`), label: `Köşe: ${pageTitleLabel(root, `kose-yazilari/${n}`, n.replace(/\.html$/, "").replace(/-/g, " "))}` });
  }
  add("istatistik-merkezi.html", "İstatistik merkezi");
  add("arsiv.html", "Arşiv");
  add("super-lig-transferleri-2026-2027.html", "Süper Lig transferleri");
  add("transfer-donemi-2026-27.html", "Transfer dönemi");
  add("gol-kralligi.html", "Gol krallığı");
  add("kose-yazilari.html", "Köşe yazıları");
  // Kendine link yok: çağıran sayfa filtreler.
  return links;
}

export function hubRelatedLinks(root, teams) {
  const links = [];
  const add = (rel, label) => {
    if (exists(root, rel)) links.push({ href: hrefFor(rel), label });
  };
  for (const t of teams.slice(0, 18)) {
    add(`takimlar/${t.slug}.html`, t.name);
  }
  add("istatistik-merkezi.html", "İstatistik merkezi");
  add("arsiv.html", "Arşiv");
  add("super-lig-transferleri-2026-2027.html", "Süper Lig transferleri");
  add("gol-kralligi.html", "Gol krallığı");
  add("kose-yazilari.html", "Köşe yazıları");
  add("canli-skor.html", "Canlı skor");
  add("super-lig-puan-durumu.html", "Süper Lig puan durumu");
  return links;
}

export function relatedPagesBlock(links, { currentPath = "", title = "İlgili sayfalar" } = {}) {
  const current = currentPath.replace(/\.html$/, "").replace(/^\//, "");
  const items = links.filter((l) => l.href.replace(/^\//, "") !== current);
  // Tekilleştir
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    unique.push(item);
  }
  if (!unique.length) return "";
  const lis = unique
    .slice(0, 16)
    .map((l) => `<li><a href="${l.href}">${escapeHtml(l.label)}</a></li>`)
    .join("");
  return `${START}\n<section class="related-pages container" data-related-pages aria-label="${escapeHtml(title)}"><h2 class="related-pages__title">${escapeHtml(title)}</h2><ul class="related-pages__list">${lis}</ul></section>\n${END}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function injectRelatedBlock(html, block) {
  const stripped = String(html || "").replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`, "g"), "");
  if (!block) return stripped;
  const footer = /<footer\b[^>]*data-shared-layout="footer"/.exec(stripped) || /<footer\b/.exec(stripped);
  if (!footer) return stripped;
  return stripped.slice(0, footer.index) + block + stripped.slice(footer.index);
}
