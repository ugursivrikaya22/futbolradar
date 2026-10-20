/**
 * Takım armaları: api-sports CDN adresi yerine depodaki küçük WebP
 * (`assets/logos/<id>.webp`, 64 px). Yerel dosya yoksa uzak adres aynen
 * kalır. Yerel dosya yüklenemezse `data-remote` ile uzak adrese bir kez döner.
 */
const fs = require("node:fs");
const path = require("node:path");

const REMOTE_RE = /^https?:\/\/media\.api-sports\.io\/football\/teams\/(\d+)\.png$/;
const LOGO_DIR = path.join(__dirname, "..", "assets", "logos");
const LOCAL_FALLBACK_JS = "if(this.dataset.remote){this.src=this.dataset.remote;this.removeAttribute('data-remote');return;}";
const cache = new Map();

function logoId(url) {
  const match = REMOTE_RE.exec(String(url || "").trim());
  return match ? match[1] : null;
}

function hasLocalLogo(id) {
  if (!cache.has(id)) cache.set(id, fs.existsSync(path.join(LOGO_DIR, `${id}.webp`)));
  return cache.get(id);
}

/** Yerel WebP varsa kök-mutlak yolunu, yoksa verilen adresi döndürür. */
function localTeamLogo(url) {
  const id = logoId(url);
  return id && hasLocalLogo(id) ? `/assets/logos/${id}.webp` : url;
}

/** `<img>` için src + data-remote öznitelikleri (kaçışlı değer bekler). */
function teamLogoAttrs(url, escape = (value) => String(value)) {
  const local = localTeamLogo(url);
  return local !== url
    ? `src="${escape(local)}" data-remote="${escape(url)}"`
    : `src="${escape(url)}"`;
}

module.exports = { LOCAL_FALLBACK_JS, REMOTE_RE, hasLocalLogo, localTeamLogo, logoId, teamLogoAttrs };
