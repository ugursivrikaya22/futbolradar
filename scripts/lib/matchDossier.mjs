/**
 * KALICI MAÇ DOSYASI — `data/match-editorials/<slug>.json` içinde
 * `kind: "dossier"` taşıyan kayıtların doğrulayıcısı ve çizicisi.
 *
 * İlk kullanım: Türkiye - Belçika (12 Kasım 2026, UEFA Uluslar Ligi). Yapı
 * millî maçlar için genel tutuldu; bölümler veri yoksa HİÇ basılmaz ya da
 * "Güncelleniyor" der. Kurallar:
 *   • Her olgu `sources` anahtarına bağlı; bağlantı beyaz listede olmalı
 *     (services/sourceLinks.js) ve `rel="nofollow noopener noreferrer"` taşır.
 *   • Sayılar elle yazılmaz, kaynaklı satırlardan HESAPLANIR: ikili rekabet
 *     toplamı, grup puan durumu ve Uluslar Ligi gol dağılımı.
 *   • `column` (köşe yazısı yuvası) gövdesi boşken bölüm basılmaz. Görüş
 *     yalnızca bu yuvada, yazarı açıkça etiketlenerek yer alır.
 *   • `editorOnly` alanı ASLA sayfaya basılmaz (editör notları).
 *   • `postMatch.summary` boşken "Maç sonrası: Güncelleniyor" basılır;
 *     üretici maç bitince bu alanı kaynaklı özetle doldurabilir.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../../services/sourceLinks.js");

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const UPDATING = "Güncelleniyor";
const BANNED = /wikipedia|thesportsdb|transfermarkt|fbref/i;

const sourceKeys = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean);

function parseScore(score) {
  const [a, b] = String(score || "").split("-").map((n) => Number(n));
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Invalid dossier score: ${score}`);
  return [a, b];
}

/** Kaynak anahtarlarını ve skorları doğrular; hatada derleme durur. */
export function validateMatchDossier(data) {
  for (const [key, s] of Object.entries(data.sources || {})) {
    if (!s || !s.url || !s.name) throw new Error(`Incomplete dossier source: ${key}`);
    if (!isAllowedSourceUrl(s.url) || BANNED.test(s.url)) throw new Error(`Invalid editorial source: ${s.url}`);
  }
  const need = (value, where) => {
    const keys = sourceKeys(value);
    if (!keys.length) throw new Error(`Missing dossier source at ${where}`);
    for (const key of keys) if (!data.sources[key]) throw new Error(`Missing editorial source: ${key}`);
  };
  for (const list of ["facts", "atmosphere", "scenarios", "numbers", "status"]) {
    for (const [i, fact] of (data[list] || []).entries()) need(fact.source, `${list}[${i}]`);
  }
  for (const side of ["home", "away"]) {
    const squad = data.squads && data.squads[side];
    if (squad) { need(squad.source, `squads.${side}`); if (squad.clubSource) need(squad.clubSource, `squads.${side}.club`); }
    for (const [i, m] of ((data.recent && data.recent[side] && data.recent[side].matches) || []).entries()) { need(m.source, `recent.${side}[${i}]`); parseScore(m.score); }
  }
  for (const [i, l] of (data.lastLineups || []).entries()) need(l.source, `lastLineups[${i}]`);
  if (data.h2h) { need(data.h2h.source, "h2h"); data.h2h.rows.forEach((r) => parseScore(r.score)); }
  if (data.group) { need(data.group.source, "group"); data.group.results.forEach((r) => parseScore(r.score)); }
  if (data.probableLineups && data.probableLineups.source) need(data.probableLineups.source, "probableLineups");
  if (data.column && data.column.body && data.column.body.length && data.column.author !== "FutbolRadar") throw new Error("Dossier column author must be FutbolRadar");
  return data;
}

/** Grup puan durumu, kaynaklı sonuç listesinden hesaplanır. */
export function dossierStandings(results) {
  const table = new Map();
  const row = (team) => table.get(team) || table.set(team, { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }).get(team);
  for (const r of results) {
    const [h, a] = parseScore(r.score);
    const home = row(r.home), away = row(r.away);
    home.played++; away.played++; home.gf += h; home.ga += a; away.gf += a; away.ga += h;
    if (h > a) { home.won++; away.lost++; home.points += 3; }
    else if (h < a) { away.won++; home.lost++; away.points += 3; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }
  return [...table.values()].sort((x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

/** İkili rekabet toplamı (ev sahibi takım açısından). */
export function dossierH2hTotals(rows, team) {
  return rows.reduce((t, r) => {
    const [h, a] = parseScore(r.score);
    const gf = r.home === team ? h : a, ga = r.home === team ? a : h;
    return { played: t.played + 1, won: t.won + Number(gf > ga), drawn: t.drawn + Number(gf === ga), lost: t.lost + Number(gf < ga), gf: t.gf + gf, ga: t.ga + ga };
  }, { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 });
}

const trDate = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  return y && m && d ? `${d} ${months[m - 1]} ${y}` : esc(iso);
};

export function matchDossierHtml(data, { columns = [] } = {}) {
  if (!data) return "";
  const homeTeam = data.teams.home, awayTeam = data.teams.away;
  const link = (key) => {
    const s = data.sources[key];
    return `<a href="${esc(s.url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(s.name)}</a>`;
  };
  const cite = (value) => `<small class="muted-copy">Kaynak: ${sourceKeys(value).map(link).join(" · ")}</small>`;
  const facts = (list) => (list || []).map((f) => `<h3>${esc(f.heading)}</h3><p>${esc(f.text)} ${cite(f.source)}</p>`).join("\n");
  const section = (id, title, body) => body ? `<section class="msp-section" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title" class="msp-section-title">${esc(title)}</h2>\n${body}\n</section>` : "";

  const out = [];
  out.push(section("mac-dosyasi", `${homeTeam} - ${awayTeam}: maç bilgileri`,
    `<p class="muted-copy">Maç öncesi bilgi dosyası · ${esc(data.updatedAt)} · Saatler TSİ (Europe/Istanbul). Her bilgi resmî kaynağına bağlıdır.</p>\n${facts(data.facts)}`));

  // Kadrolar
  const squadHtml = (side) => {
    const squad = data.squads && data.squads[side];
    if (!squad) return "";
    const count = squad.groups.reduce((n, g) => n + g.players.length, 0);
    const players = (g) => g.players.map((p) => {
      const caps = Number.isInteger(p.caps) ? ` · ${p.caps} maç / ${p.goals} gol` : (side === "home" ? " · —" : "");
      return `<li><strong>${esc(p.name)}</strong> — ${esc(p.club || UPDATING)}${caps}</li>`;
    }).join("");
    return `<details class="card"><summary><strong>${esc(squad.label)}</strong> (${count})</summary>
${squad.groups.map((g) => `<h4>${esc(g.position)}</h4><ul>${players(g)}</ul>`).join("\n")}
<p class="muted-copy">${esc(squad.note || "")} ${cite([squad.source, squad.clubSource].filter(Boolean))}</p></details>`;
  };
  out.push(section("kadrolar", "Kadrolar", [squadHtml("home"), squadHtml("away")].filter(Boolean).join("\n")));

  out.push(section("son-durum", "Son durum", facts(data.status)));

  const xi = data.probableLineups;
  const xiOk = xi && xi.source && ((xi.home && xi.home.players && xi.home.players.length) || (xi.away && xi.away.players && xi.away.players.length));
  const xiSide = (side) => {
    const block = xi && xi[side];
    if (!block || !block.players || !block.players.length) return "";
    return `<h3>${esc(block.label || (side === "home" ? homeTeam : awayTeam))}</h3><p>${esc(block.players.join(", "))}</p>`;
  };
  const xiBody = xiOk
    ? `<p class="muted-copy">Muhtemel 11 (basın iddiası). TFF veya UEFA resmî ilk 11'i yayımlayana kadar kesin değildir. ${cite(xi.source)}</p>
${[xiSide("home"), xiSide("away")].filter(Boolean).join("\n")}`
    : `<p><strong>Muhtemel 11'ler:</strong> ${UPDATING}</p><p class="muted-copy">${xi && xi.pendingNote ? esc(xi.pendingNote) : "TFF veya UEFA resmî ilk 11'i henüz yayımlamadı. İzinli basında, 11 Kasım basın toplantısı sonrasına ait saat damgalı tam bir muhtemel 11 listesi bulunamadı; bu yüzden kadro uydurulmadı."}</p>`;
  out.push(section("muhtemel-11", "Muhtemel 11'ler", xiBody));

  // Son 5 maç
  const recentHtml = (side) => {
    const block = data.recent && data.recent[side];
    if (!block || !block.matches.length) return "";
    const team = side === "home" ? homeTeam : awayTeam;
    const sum = block.matches.reduce((t, m) => {
      const [h, a] = parseScore(m.score);
      const gf = m.home === team ? h : a, ga = m.home === team ? a : h;
      return { w: t.w + Number(gf > ga), d: t.d + Number(gf === ga), l: t.l + Number(gf < ga), gf: t.gf + gf, ga: t.ga + ga };
    }, { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    return `<h3>${esc(block.label)}</h3>
<p>${sum.w} galibiyet, ${sum.d} beraberlik, ${sum.l} yenilgi; ${sum.gf} gol atıp ${sum.ga} gol yedi.</p>
<ul>${block.matches.map((m) => `<li><strong>${trDate(m.date)}</strong> · ${esc(m.competition)}: ${esc(m.home)} ${esc(m.score)} ${esc(m.away)}${m.goals && m.goals.length ? `<br><small>Goller: ${esc(m.goals.join(", "))}</small>` : ""}<br>${cite(m.source)}</li>`).join("\n")}</ul>`;
  };
  out.push(section("son-5-mac", "Form: son 5 resmî maç", [recentHtml("home"), recentHtml("away")].filter(Boolean).join("\n")));

  // Oyuncu performansı: Uluslar Ligi gol dağılımı (maç kayıtlarından hesaplanır)
  const nlScorers = (side) => {
    const counts = new Map();
    for (const m of (data.recent && data.recent[side] && data.recent[side].matches) || []) {
      if (!/Uluslar Ligi/.test(m.competition)) continue;
      for (const name of m.teamGoals || []) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"));
  };
  const scorerLine = (side) => {
    const team = side === "home" ? homeTeam : awayTeam;
    const rows = nlScorers(side);
    const keys = ((data.recent && data.recent[side] && data.recent[side].matches) || []).filter((m) => /Uluslar Ligi/.test(m.competition)).map((m) => m.source);
    return rows.length ? `<li><strong>${esc(team)}</strong>: ${rows.map(([n, c]) => `${esc(n)} ${c}`).join(", ")} ${cite(keys)}</li>` : "";
  };
  const scorerItems = `${scorerLine("home")}${scorerLine("away")}`;
  const perf = [scorerItems ? `<p>Bu sezonki Uluslar Ligi maçlarında gol atan oyuncular (resmî maç kayıtlarından sayıldı):</p><ul>${scorerItems}</ul>` : "", facts(data.numbers)].filter(Boolean).join("\n");
  out.push(section("oyuncu-performansi", "Oyuncu performansı ve öne çıkan sayılar", perf));

  // Son resmî ilk 11'ler (taktik: yalnızca resmî kayıt)
  const lineups = (data.lastLineups || []).map((l) => `<h3>${esc(l.label)}</h3><p>${esc(l.players.join(", "))}</p><p class="muted-copy">Diziliş: resmî maç kaydında belirtilmedi. ${cite(l.source)}</p>`).join("\n");
  out.push(section("son-ilk-11", "Son resmî maçtaki ilk 11'ler", lineups ? `<p class="muted-copy">Yorum yok; yalnızca federasyonların resmî maç kayıtlarındaki ilk 11'ler.</p>\n${lineups}` : ""));

  // İkili rekabet
  if (data.h2h && data.h2h.rows.length) {
    const t = dossierH2hTotals(data.h2h.rows, homeTeam);
    out.push(section("ikili-rekabet", `${homeTeam} - ${awayTeam}: ikili rekabet`,
      `<p>A millî takımlar ${t.played} kez karşılaştı: ${esc(homeTeam)} ${t.won} galibiyet, ${t.drawn} beraberlik, ${t.lost} yenilgi; gol averajı ${t.gf}-${t.ga}. ${cite(data.h2h.source)}</p>
<ul>${data.h2h.rows.map((r) => `<li>${trDate(r.date)} · ${esc(r.competition)}: ${esc(r.home)} ${esc(r.score)} ${esc(r.away)}</li>`).join("")}</ul>`));
  }

  // Grup puan durumu + senaryolar
  if (data.group && data.group.results.length) {
    const rows = dossierStandings(data.group.results);
    const avg = (r) => (r.gf - r.ga > 0 ? `+${r.gf - r.ga}` : String(r.gf - r.ga));
    out.push(section("grup-durumu", `${data.group.label}: puan durumu ve senaryolar`,
      `<p class="muted-copy">${esc(data.groupNote || "4. hafta sonrası; resmî sonuçlardan hesaplandı.")} ${cite(data.group.source)}</p>
<div class="table-scroll"><table class="standings-table msp-standings"><thead><tr><th scope="col">#</th><th scope="col">Takım</th><th scope="col">O</th><th scope="col">G</th><th scope="col">B</th><th scope="col">M</th><th scope="col">Av</th><th scope="col">P</th></tr></thead><tbody>
${rows.map((r, i) => `<tr${r.team === homeTeam || r.team === awayTeam ? ' class="is-highlight"' : ""}><td>${i + 1}</td><td>${esc(r.team)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${avg(r)}</td><td>${r.points}</td></tr>`).join("\n")}
</tbody></table></div>
${facts(data.scenarios)}`));
  }

  out.push(section("mac-oncesi-atmosfer", "Maç öncesi: stat, bilet ve tribün", facts(data.atmosphere)));

  // Köşe: kullanıcının kendi yazısı (yuva) + bu maça bağlı yayımlanmış yazılar.
  const column = data.column || {};
  const columnBody = Array.isArray(column.body) ? column.body.filter(Boolean) : [];
  const columnBlock = columnBody.length && column.title
    ? `<article class="card"><p class="muted-copy">Köşe yazısı · görüş · Yazar: ${esc(column.author)}${column.publishedAt ? ` · ${esc(column.publishedAt)}` : ""}</p><h3>${esc(column.title)}</h3>${columnBody.map((p) => `<p>${esc(p)}</p>`).join("")}</article>`
    : "";
  const columnLinks = columns.length ? `<ul>${columns.map((c) => `<li><a href="${esc(c.href)}">${esc(c.title)}</a></li>`).join("")}</ul>` : "";
  out.push(section("kose", "Köşe", [columnBlock, columnLinks].filter(Boolean).join("\n")));

  // Maç sonrası yuvası
  const post = data.postMatch || {};
  const postBody = post.summary && sourceKeys(post.sources).length
    ? `<p>${esc(post.summary)} ${cite(post.sources)}</p>`
    : `<p><strong>Maç sonrası:</strong> ${UPDATING}</p>`;
  out.push(section("mac-sonrasi", "Maç sonrası", postBody));

  return out.filter(Boolean).join("\n");
}
