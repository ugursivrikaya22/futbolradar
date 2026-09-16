/**
 * MAÇ ÖNCESİ ANALİZ BÖLÜMLERİNİN TEK İŞARETLEME KAYNAĞI.
 *
 * scripts/generate-match-pages.mjs tüketir; her işlev ya tam bir bölüm
 * HTML'i ya da BOŞ DİZE döndürür. Boş dize = o bölüm için doğrulanmış veri
 * yok demektir ve sayfaya hiçbir yer tutucu basılmaz — eksik verinin tek
 * istisnası, kullanıcıya nedenini söyleyen açık ve dürüst mesajlardır
 * (ör. "Kadrolar açıklandığında burada"). Uydurma değer üretilmez: skor
 * tahmini, hava durumu ve yayıncı gibi doğrulanmış kaynağı olmayan alanlar
 * hiç çizilmez.
 *
 * Veri kaynakları (hepsi derleme anında, istemci çağrısı yok):
 *   - data/match-analyses.json  → kadrolar, olasılık, form, eşleşmeler
 *   - data/fixture-calendar.json → sağlayıcı tahmini, ikili rekabet, hakem
 *   - data/league-standings.json → mini puan tablosu
 *   - data/squad-statuses.json  → sakat/cezalı bildirimleri
 *   - data/players.json         → oyuncu kartları (foto, yaş, mevki...)
 *
 * Tek istemci-tarafı istisna: maç istatistikleri bölümü (madde 9) kapalı
 * bir kabuk olarak basılır; site.js maç başladıktan sonra /api/match-detail
 * ile doldurur. Maç öncesi istatistik diye bir şey yoktur — kabuk bunu
 * açıkça söyler.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const probabilityService = require("../../services/fixtureProbabilityService.js");

const STATUS_LABELS = {
  injured: "Sakat",
  suspended: "Cezalı",
  doubtful: "Şüpheli",
  out: "Yok",
  unavailable: "Yok"
};

const STATUS_CLASSES = {
  injured: "is-injured",
  suspended: "is-suspended",
  doubtful: "is-doubtful"
};

/**
 * Aynı oyuncunun iki yazımı ("E. Yigit" / "Enes Yigit") tek kayda iner:
 * soyad + ilk adın baş harfi. Yalnız eksik listesi tekilleştirmesinde
 * kullanılır — kaba bir anahtar olduğu için başka yerde kimlik yerine
 * geçmez.
 */
function absenceNameKey(value) {
  const tokens = String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return "";
  const last = tokens[tokens.length - 1];
  const firstInitial = tokens[0][0] || "";
  return `${firstInitial}:${last}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

/** "21.08" — kısa TSİ tarihi; geçersiz girdi boş döner, uydurulmaz. */
function shortDay(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul" }).format(parsed);
}

function yearOf(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return String(parsed.getUTCFullYear());
}

function initialsOf(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase("tr-TR"))
    .join("");
}

/**
 * Kadro kaydı eşleme: muhtemel 11 oyuncuları site kimliğiyle (id), resmî 11
 * oyuncuları sağlayıcı kimliğiyle ya da adla bulunur. Bulunamayan oyuncu
 * uydurulmaz — kart yalnızca dizilişteki adıyla çizilir.
 */
export function findPlayerRecord(players, { id, providerId, name }) {
  const list = Array.isArray(players) ? players : [];
  if (id) {
    const byId = list.find((player) => player.id === id);
    if (byId) return byId;
  }
  if (providerId) {
    const byProvider = list.find((player) => String(player.providerId || "") === String(providerId));
    if (byProvider) return byProvider;
  }
  if (name) {
    const wanted = normalizeName(name);
    const byName = list.find((player) => normalizeName(player.name) === wanted || normalizeName(player.fullName) === wanted);
    if (byName) return byName;
  }
  return null;
}

/**
 * Saha üzerindeki sıralar. Resmî 11'de sağlayıcının grid koordinatı
 * ("satır:sütun") varsa o kullanılır; yoksa mevki harfi (G/D/M/F), muhtemel
 * 11'de ise slot grubu (GK/DEF/MID/WING/FWD) sıraları belirler. Diziliş
 * dizgisi ("4-2-3-1") yalnızca etikette gösterilir — koordinat uydurmak
 * için ayrıştırılmaz.
 */
export function pitchRows(playersArr) {
  const list = Array.isArray(playersArr) ? playersArr.filter(Boolean) : [];
  if (!list.length) return [];

  const hasGrid = list.every((player) => /^\d+:\d+$/.test(String(player.grid || "")));
  if (hasGrid) {
    const byRow = new Map();
    for (const player of list) {
      const [row, col] = player.grid.split(":").map(Number);
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push({ ...player, _col: col });
    }
    return [...byRow.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, rowPlayers]) => rowPlayers.sort((left, right) => left._col - right._col));
  }

  const groupOf = (player) => {
    const slot = String(player.slot || "").toUpperCase();
    if (slot) {
      if (slot === "GK") return 0;
      if (slot === "DEF") return 1;
      if (slot === "MID") return 2;
      if (slot === "WING") return 3;
      return 4;
    }
    const pos = String(player.position || "").toUpperCase();
    if (pos.startsWith("G") || pos.includes("KALECI")) return 0;
    if (pos.startsWith("D") || pos.includes("DEF") || pos.includes("STOPER") || pos.includes("BEK")) return 1;
    if (pos.startsWith("M") || pos.includes("ORTA")) return 2;
    return 4;
  };

  const groups = new Map();
  for (const player of list) {
    const group = groupOf(player);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(player);
  }
  return [...groups.entries()].sort((left, right) => left[0] - right[0]).map(([, rowPlayers]) => rowPlayers);
}

function pitchChip(player, players, base) {
  const record = findPlayerRecord(players, { id: player.id, providerId: player.providerId, name: player.name });
  const number = player.number ?? (record && record.number) ?? null;
  const label = number != null && String(number).trim() !== "" ? String(number) : initialsOf(player.name);
  const oop = player.outOfPosition ? ' <i class="lineup-oop-flag" title="Alışılmış mevkisi dışında">!</i>' : "";
  const inner = `<b class="pitch-chip-badge">${escapeHtml(label)}</b><span class="pitch-chip-name">${escapeHtml(player.name)}</span>${oop}`;
  if (record) {
    return `<a class="pitch-chip" href="${base}oyuncular/${escapeHtml(record.id)}.html">${inner}</a>`;
  }
  return `<span class="pitch-chip">${inner}</span>`;
}

function pitchHtml(teamName, formation, playersArr, players, base) {
  const rows = pitchRows(playersArr);
  if (!rows.length) return "";

  const rowCount = rows.length;
  const chips = rows.map((rowPlayers, rowIndex) => {
    // Kaleci en altta (yüksek top yüzdesi), hücum en üstte.
    const top = rowCount === 1 ? 50 : 88 - (rowIndex * (76 / (rowCount - 1)));
    return rowPlayers.map((player, colIndex) => {
      const left = ((colIndex + 1) / (rowPlayers.length + 1)) * 100;
      return `<div class="pitch-spot" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%">${pitchChip(player, players, base)}</div>`;
    }).join("");
  }).join("");

  return `<figure class="lineup-pitch" role="img" aria-label="${escapeHtml(teamName)} dizilişi${formation ? ` (${escapeHtml(formation)})` : ""}">
      <div class="lineup-pitch-surface">${chips}</div>
      <figcaption class="lineup-pitch-caption"><b>${escapeHtml(teamName)}</b>${formation ? `<span>${escapeHtml(formation)}</span>` : ""}</figcaption>
    </figure>`;
}

function substitutesHtml(title, subs, players, base, starters) {
  // Resmî yedekler nesne ({providerId, name, number}), muhtemel yedek
  // adayları düz ad dizgisi olarak gelir — ikisi de kabul edilir. İlk 11'de
  // zaten duran bir ad (kaynakta çift kayıt varsa sızabiliyor) yedek
  // listesine giremez.
  const starterKeys = new Set((Array.isArray(starters) ? starters : [])
    .map((player) => absenceNameKey(player && player.name))
    .filter(Boolean));
  const list = (Array.isArray(subs) ? subs : [])
    .map((entry) => (typeof entry === "string" ? { name: entry } : entry))
    .filter((entry) => entry && entry.name && !starterKeys.has(absenceNameKey(entry.name)))
    .slice(0, 12);
  if (!list.length) return "";
  const items = list.map((player) => {
    const record = findPlayerRecord(players, { providerId: player.providerId, id: player.id, name: player.name });
    const name = record
      ? `<a href="${base}oyuncular/${escapeHtml(record.id)}.html">${escapeHtml(player.name)}</a>`
      : escapeHtml(player.name);
    const number = player.number != null ? `<b>${escapeHtml(player.number)}</b>` : "";
    return `<li>${number}${name}</li>`;
  }).join("");
  return `<div class="lineup-bench"><span>${escapeHtml(title)}</span><ul>${items}</ul></div>`;
}

/**
 * 1) KADROLAR VE SAHA DİZİLİMİ.
 * Resmî 11 yayımlandıysa o çizilir (yedekler dahil); yoksa muhtemel 11.
 * İkisi de yoksa dürüst bir bekleme kartı.
 */
export function lineupsSection(analysis, players, base) {
  if (!analysis) return "";
  const official = analysis.officialLineupStatus === "available" ? analysis.officialLineups : null;
  const probable = analysis.probableLineups || {};

  const renderSide = (side) => {
    if (official && official[side] && Array.isArray(official[side].startingXI) && official[side].startingXI.length) {
      const teamName = side === "home" ? analysis.homeContext?.teamName : analysis.awayContext?.teamName;
      return {
        badge: '<span class="lineup-status-badge is-official">Resmî İlk 11</span>',
        pitch: pitchHtml(teamName || "", official[side].formation, official[side].startingXI, players, base),
        bench: substitutesHtml("Yedekler", official[side].substitutes, players, base, official[side].startingXI)
      };
    }
    const lineup = probable[side];
    if (lineup && lineup.predictionStatus === "available" && Array.isArray(lineup.starters) && lineup.starters.length) {
      const benchPlayers = lineup.benchStrength && Array.isArray(lineup.benchStrength.players) ? lineup.benchStrength.players : [];
      return {
        badge: '<span class="lineup-status-badge is-probable">Muhtemel İlk 11</span>',
        pitch: pitchHtml(lineup.teamName || "", lineup.formation, lineup.starters, players, base),
        bench: substitutesHtml("Yedek adayları", benchPlayers, players, base, lineup.starters)
      };
    }
    return null;
  };

  const home = renderSide("home");
  const away = renderSide("away");
  if (!home && !away) {
    return `<section class="match-lineups" aria-label="Maç kadroları"><h2 class="match-section-title">Kadrolar ve Diziliş</h2>
      <article class="card data-empty"><strong>Kadrolar hazırlanıyor</strong><span>Muhtemel 11'ler doğrulanmış kadro verisiyle, resmî 11'ler kulüpler açıkladığında otomatik yayımlanır.</span></article>
    </section>`;
  }

  const note = official
    ? ""
    : '<p class="muted-copy match-lineups-note">Muhtemel 11, doğrulanmış kadro ve uygunluk verisinden üretilen bir tahmindir; resmî 11 açıklandığında bu bölüm otomatik güncellenir.</p>';

  const sideHtml = (side) => side
    ? `<div class="match-lineup-side">${side.badge}${side.pitch}${side.bench}</div>`
    : '<div class="match-lineup-side"><article class="card data-empty"><strong>Kadro bekleniyor</strong><span>Bu takım için doğrulanmış diziliş verisi henüz yok.</span></article></div>';

  return `<section class="match-lineups" aria-label="Maç kadroları"><h2 class="match-section-title">Kadrolar ve Diziliş</h2>
      <div class="match-lineups-grid">${sideHtml(home)}${sideHtml(away)}</div>${note}
    </section>`;
}

function playerCardHtml(entry, players, base) {
  const record = findPlayerRecord(players, { id: entry.id, providerId: entry.providerId, name: entry.name });
  const name = entry.name || (record && record.name) || "";
  if (!name) return "";

  const photo = record && record.photo && record.photoStatus === "verified"
    ? `<img class="match-player-photo" src="${escapeHtml(record.photo)}" alt="" loading="lazy" decoding="async" width="64" height="64" />`
    : `<span class="match-player-photo is-placeholder" aria-hidden="true">${escapeHtml(initialsOf(name))}</span>`;

  const facts = [];
  const position = (record && (record.position || record.primaryPosition)) || entry.position || null;
  if (position) facts.push(`<span>${escapeHtml(position)}</span>`);
  const age = record && (record.computedAge || record.age);
  if (age) facts.push(`<span>${escapeHtml(age)} yaş</span>`);
  if (record && record.height) facts.push(`<span>${escapeHtml(record.height)}</span>`);
  if (record && record.preferredFoot) facts.push(`<span>${escapeHtml(record.preferredFoot)} ayak</span>`);
  if (record && record.marketValue) facts.push(`<span>${escapeHtml(record.marketValue)}</span>`);

  // Sezon istatistiği yalnızca gerçekten OYNANMIŞ maç varsa basılır:
  // sağlayıcının hiç veri göndermediği oyuncuda "0 gol" yazmak, ölçülmemiş
  // bir iddiayı ölçülmüş gibi göstermek olurdu.
  const stats = record && record.stats && Number(record.stats.appearances) > 0
    ? `<div class="match-player-stats"><span>Maç <b>${escapeHtml(record.stats.appearances)}</b></span><span>Gol <b>${escapeHtml(record.stats.goals ?? 0)}</b></span><span>Asist <b>${escapeHtml(record.stats.assists ?? 0)}</b></span><span>Dk <b>${escapeHtml(record.stats.minutesPlayed ?? record.stats.minutes ?? 0)}</b></span></div>`
    : "";

  const heading = record
    ? `<a href="${base}oyuncular/${escapeHtml(record.id)}.html">${escapeHtml(name)}</a>`
    : escapeHtml(name);

  return `<article class="match-player-card">${photo}<div class="match-player-card-body"><strong>${heading}</strong><div class="match-player-facts">${facts.join("") || '<span class="muted-copy">Profil verisi doğrulanınca genişler</span>'}</div>${stats}</div></article>`;
}

/**
 * 2) OYUNCU KARTLARI — sahadaki 11'lerin kaydırmalı kart şeridi.
 * Alan alan dürüst: foto yalnızca doğrulanmışsa, boy/ayak/piyasa yalnızca
 * kayıtta gerçekten varsa basılır.
 */
export function playerCardsSection(analysis, players, base) {
  if (!analysis) return "";
  const official = analysis.officialLineupStatus === "available" ? analysis.officialLineups : null;
  const probable = analysis.probableLineups || {};

  const sideEntries = (side) => {
    if (official && official[side] && Array.isArray(official[side].startingXI) && official[side].startingXI.length) {
      return official[side].startingXI;
    }
    const lineup = probable[side];
    if (lineup && lineup.predictionStatus === "available" && Array.isArray(lineup.starters)) {
      return lineup.starters;
    }
    return [];
  };

  const rails = ["home", "away"].map((side) => {
    const entries = sideEntries(side);
    if (!entries.length) return "";
    const teamName = side === "home" ? analysis.homeContext?.teamName : analysis.awayContext?.teamName;
    const cards = entries.map((entry) => playerCardHtml(entry, players, base)).filter(Boolean).join("");
    if (!cards) return "";
    return `<div class="match-player-rail-block"><h3>${escapeHtml(teamName || "")}</h3><div class="match-player-rail">${cards}</div></div>`;
  }).filter(Boolean);

  if (!rails.length) return "";

  return `<section class="match-player-cards" aria-label="Oyuncu kartları"><h2 class="match-section-title">Oyuncu Kartları</h2>${rails.join("")}</section>`;
}

const ADVANTAGE_LABELS = { home: "Ev sahibi önde", away: "Deplasman önde", balanced: "Dengeli" };

function duelCardHtml(duel, base) {
  const playerHtml = (player) => {
    const link = player.id ? `<a href="${base}oyuncular/${escapeHtml(player.id)}.html">${escapeHtml(player.name)}</a>` : escapeHtml(player.name);
    const metrics = [
      player.overall != null ? `Genel ${escapeHtml(player.overall)}` : null,
      player.form != null ? `Form ${escapeHtml(player.form)}` : null
    ].filter(Boolean).join(" · ");
    return `<div class="match-duel-player"><strong>${link}</strong>${metrics ? `<span>${metrics}</span>` : ""}</div>`;
  };

  return `<article class="match-duel-card">
      <header><span>${escapeHtml(duel.title)}</span><b class="match-duel-advantage is-${escapeHtml(duel.advantage)}">${escapeHtml(ADVANTAGE_LABELS[duel.advantage] || "Dengeli")}</b></header>
      <div class="match-duel-players">${playerHtml(duel.homePlayer)}<i aria-hidden="true">vs</i>${playerHtml(duel.awayPlayer)}</div>
      <p>${escapeHtml(duel.summary)}</p>
    </article>`;
}

/**
 * 3) AI MAÇ ANALİZİ — güçlü/zayıf yönler, kritik eşleşmeler, eksikliği
 * hissedilecek oyuncular. Tüm metin hesaplanmış bileşenlerden şablonla
 * kurulur; serbest metin/uydurma yorum yok.
 */
export function aiAnalysisSection(analysis, radar, homeName, awayName, base) {
  if (!analysis) return "";
  const matchup = analysis.matchup || {};
  const duels = Array.isArray(analysis.keyDuels) ? analysis.keyDuels : [];
  const advantages = Array.isArray(matchup.advantages) ? matchup.advantages : [];

  const strengthsCard = (teamName, teamRadar) => {
    if (!teamRadar) return "";
    const positives = Array.isArray(teamRadar.positives) && teamRadar.positives.length ? teamRadar.positives : ["Yeterli olumlu bileşen oluşmadı"];
    const negatives = Array.isArray(teamRadar.negatives) && teamRadar.negatives.length ? teamRadar.negatives : ["Belirgin olumsuz bileşen yok"];
    return `<article class="match-ai-team card"><h3>${escapeHtml(teamName)}</h3>
        <div class="match-ai-lists"><div><span>Güçlü yönler</span><ul>${positives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        <div><span>Zayıf yönler</span><ul>${negatives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div>
      </article>`;
  };

  const advantageChips = advantages.length
    ? `<div class="match-ai-advantages">${advantages.map((item) => `<span class="match-ai-chip is-${escapeHtml(item.advantage)}">${escapeHtml(item.label)}: ${escapeHtml(ADVANTAGE_LABELS[item.advantage] || "Dengeli")}</span>`).join("")}</div>`
    : "";

  const missing = [];
  for (const side of ["home", "away"]) {
    const lineup = analysis.probableLineups && analysis.probableLineups[side];
    const teamName = side === "home" ? homeName : awayName;
    for (const player of (lineup && Array.isArray(lineup.missingKeyPlayers) ? lineup.missingKeyPlayers : [])) {
      const name = typeof player === "string" ? player : player && player.name;
      if (name) missing.push(`<span class="match-ai-chip is-missing">${escapeHtml(teamName)}: ${escapeHtml(name)}</span>`);
    }
  }
  const missingHtml = missing.length
    ? `<div class="match-ai-missing"><span>Eksikliği hissedilebilecek oyuncular</span><div class="match-ai-advantages">${missing.join("")}</div></div>`
    : "";

  const duelsHtml = duels.length
    ? `<h3 class="match-ai-subtitle">Kritik eşleşmeler</h3><div class="match-duel-grid">${duels.map((duel) => duelCardHtml(duel, base)).join("")}</div>`
    : "";

  return `<section class="match-ai-analysis" aria-label="AI maç analizi"><h2 class="match-section-title">AI Maç Analizi</h2>
      ${matchup.summary ? `<p class="match-ai-summary">${escapeHtml(matchup.summary)}</p>` : ""}
      ${advantageChips}
      <div class="match-ai-grid">${strengthsCard(homeName, radar && radar.home)}${strengthsCard(awayName, radar && radar.away)}</div>
      ${duelsHtml}
      ${missingHtml}
    </section>`;
}

function parseProviderPercent(calendarRec) {
  const percent = calendarRec && calendarRec.prediction && calendarRec.prediction.predictions && calendarRec.prediction.predictions.percent;
  if (!percent) return null;
  const home = Number.parseInt(percent.home, 10);
  const draw = Number.parseInt(percent.draw, 10);
  const away = Number.parseInt(percent.away, 10);
  if (![home, draw, away].every(Number.isFinite)) return null;
  const sum = home + draw + away;
  if (sum < 95 || sum > 105) return null;
  return { home, draw, away };
}

/**
 * Zincirin çözdüğü dış kaynak satırı. Çözülmüş kayıt yoksa takvimdeki ham
 * sağlayıcı yükü okunur — depo henüz yazılmamışken mevcut sağlayıcı
 * tahmininin ekrandan düşmemesi için.
 */
function externalProbabilityRow(probability, calendarRec) {
  const record = probability && probability.probabilities && probabilityService.isDisplayable(probability)
    ? probability
    : probabilityService.normalizeProviderPrediction(calendarRec && calendarRec.prediction);
  if (!record || !probabilityService.isDisplayable(record)) return null;
  const display = probabilityService.displayFor(record.source, "tr");
  if (!display) return null;
  return {
    source: record.source,
    icon: display.icon,
    title: display.title,
    home: record.probabilities.home,
    draw: record.probabilities.draw,
    away: record.probabilities.away,
    dataBasis: record.dataBasis || null,
    basisNote: probabilityService.dataBasisNote(record, "tr")
  };
}

/**
 * 4) KAZANMA OLASILIĞI — site modelinin yüzdeleri + (varsa) sağlayıcının
 * kendi modeli, ikisi de açıkça etiketli. Skor tahmini bilinçli olarak YOK:
 * hiçbir doğrulanmış model skor çizgisi üretmiyor; uydurmak yasak.
 */
export function probabilitySection(analysis, calendarRec, homeName, awayName, probability) {
  if (!analysis || !analysis.prediction) return "";
  const prediction = analysis.prediction;
  if (prediction.predictionStatus === "unavailable") {
    return `<section class="match-probability" aria-label="Kazanma olasılığı"><h2 class="match-section-title">Kazanma Olasılığı</h2>
      <article class="card data-empty"><strong>Tahmin hazırlanıyor</strong><span>Olasılık okuması için yeterli doğrulanmış veri henüz oluşmadı.</span></article>
    </section>`;
  }

  const probabilities = prediction.probabilities || {};
  const homeWin = clampPercent(probabilities.homeWin);
  const draw = clampPercent(probabilities.draw);
  const awayWin = clampPercent(probabilities.awayWin);
  const top = Math.max(homeWin, draw, awayWin);

  const bar = `<div class="probability-bar">
      <div class="probability-bar-track" role="img" aria-label="Ev sahibi galibiyeti yüzde ${Math.round(homeWin)}, beraberlik yüzde ${Math.round(draw)}, deplasman galibiyeti yüzde ${Math.round(awayWin)}">
        <span class="home-share" style="width:${homeWin}%"></span><span class="draw-share" style="width:${draw}%"></span><span class="away-share" style="width:${awayWin}%"></span>
      </div>
      <div class="probability-bar-legend">
        <div class="${homeWin === top ? "is-primary" : ""}"><span>${escapeHtml(homeName)}</span><b>%${Math.round(homeWin)}</b></div>
        <div class="${draw === top && draw > homeWin ? "is-primary" : ""}"><span>Beraberlik</span><b>%${Math.round(draw)}</b></div>
        <div class="${awayWin === top && awayWin > draw && awayWin > homeWin ? "is-primary" : ""}"><span>${escapeHtml(awayName)}</span><b>%${Math.round(awayWin)}</b></div>
      </div>
    </div>`;

  const goalPotential = prediction.goalPotential && prediction.goalPotential.label
    ? `<span class="match-probability-chip">Gol potansiyeli: ${escapeHtml(prediction.goalPotential.label === "high" ? "Yüksek" : prediction.goalPotential.label === "low" ? "Düşük" : "Orta")}</span>`
    : "";
  const upsetRisk = prediction.upsetRisk && prediction.upsetRisk.label
    ? `<span class="match-probability-chip">Sürpriz riski: ${escapeHtml(prediction.upsetRisk.label === "high" ? "Yüksek" : prediction.upsetRisk.label === "low" ? "Düşük" : "Orta")}</span>`
    : "";
  const lowConfidence = prediction.predictionStatus === "low-confidence"
    ? '<span class="match-probability-chip is-warning">Düşük veri güveni — temkinli okuyun</span>'
    : "";

  // İKİNCİ SATIR: site modelinin yanında, ZİNCİRİN çözdüğü kaynak.
  // Başlık kaynağa göre değişir (Sağlayıcı Tahmini / Piyasa Olasılığı /
  // FutbolRadar Tahmini); piyasa oranından türeyen bir yüzdenin
  // "API-Football modeli" diye etiketlenmesi yanlış atıf olurdu.
  const external = externalProbabilityRow(probability, calendarRec);
  const providerRow = external
    ? `<div class="match-probability-provider" data-prediction-source="${escapeHtml(external.source)}"${external.dataBasis ? ` data-prediction-basis="${escapeHtml(external.dataBasis)}"` : ""}><span>${escapeHtml(external.icon)} ${escapeHtml(external.title)}</span><div class="probability-bar-track is-thin" role="img" aria-label="${escapeHtml(`${external.title}: ${homeName} yüzde ${external.home}, beraberlik yüzde ${external.draw}, ${awayName} yüzde ${external.away}`)}"><span class="home-share" style="width:${external.home}%"></span><span class="draw-share" style="width:${external.draw}%"></span><span class="away-share" style="width:${external.away}%"></span></div><b>%${external.home} · %${external.draw} · %${external.away}</b></div>${external.basisNote ? `<p class="match-probability-basis">${escapeHtml(external.basisNote)}</p>` : ""}`
    : "";

  return `<section class="match-probability" aria-label="Kazanma olasılığı"><h2 class="match-section-title">Kazanma Olasılığı</h2>
      <div class="card match-probability-card">
        ${bar}
        ${prediction.prediction && prediction.prediction.label ? `<p class="match-probability-label">${escapeHtml(prediction.prediction.label)}</p>` : ""}
        <div class="match-probability-chips">${goalPotential}${upsetRisk}${lowConfidence}</div>
        ${prediction.summary ? `<p class="muted-copy">${escapeHtml(prediction.summary)}</p>` : ""}
        ${providerRow}
        <p class="match-radar-disclaimer">Olasılıklar istatistiksel okumadır; kesin sonuç veya bahis önerisi değildir.</p>
      </div>
    </section>`;
}

/**
 * 5) EKSİKLER — sakat, cezalı ve şüpheliler. Kaynak: API-Football sakatlık
 * bildirimleri + uygunluk satırları. Bildirim yoksa bunu açıkça söyler;
 * "eksik yok" İDDİA EDİLMEZ (bildirim yokluğu, eksik yokluğu kanıtı değildir).
 */
export function absencesSection(analysis, squadStatus, homeName, awayName) {
  if (!analysis) return "";
  const rows = squadStatus && Array.isArray(squadStatus.teams) ? squadStatus.teams : [];

  const sideHtml = (teamName, side) => {
    const statusRow = rows.find((item) => normalizeName(item.team || item.name) === normalizeName(teamName));
    const seen = new Set();
    const items = [];

    for (const absence of (statusRow && Array.isArray(statusRow.absences) ? statusRow.absences : [])) {
      const key = absenceNameKey(absence.playerName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const status = String(absence.status || "").toLowerCase();
      const label = STATUS_LABELS[status] || "Belirsiz";
      const cls = STATUS_CLASSES[status] || "";
      items.push(`<li><span>${escapeHtml(absence.playerName)}</span><b class="match-absence-badge ${cls}">${escapeHtml(label)}</b>${absence.reason && normalizeName(absence.reason) !== normalizeName(label) ? `<em>${escapeHtml(absence.reason)}</em>` : ""}</li>`);
    }

    const lineup = analysis.probableLineups && analysis.probableLineups[side];
    const availabilityRows = lineup && lineup.availability && Array.isArray(lineup.availability.rows) ? lineup.availability.rows : [];
    for (const row of availabilityRows) {
      const status = String(row.status || "").toLowerCase();
      // Yalnızca AÇIKÇA bildirilen durumlar listelenir. "unknown" = durum
      // bilinmiyor demektir; onu "şüpheli" diye basmak, bildirilmemiş bir
      // durumu futbol iddiasına çevirir ve tüm kadroyu eksik gösterirdi.
      if (!STATUS_LABELS[status] || !row.name) continue;
      const key = absenceNameKey(row.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(`<li><span>${escapeHtml(row.name)}</span><b class="match-absence-badge ${STATUS_CLASSES[status] || "is-doubtful"}">${escapeHtml(STATUS_LABELS[status])}</b>${row.note ? `<em>${escapeHtml(row.note)}</em>` : ""}</li>`);
    }

    const body = items.length
      ? `<ul class="match-absence-list">${items.join("")}</ul>`
      : '<p class="muted-copy">Bu maç için doğrulanmış eksik bildirimi yok.</p>';
    return `<article class="card"><span class="card-kicker">${escapeHtml(teamName)}</span>${body}</article>`;
  };

  return `<section class="match-absences" aria-label="Eksikler"><h2 class="match-section-title">Eksikler: Sakat, Cezalı ve Şüpheliler</h2>
      <div class="match-absences-grid">${sideHtml(homeName, "home")}${sideHtml(awayName, "away")}</div>
      <p class="muted-copy match-absences-source">Kaynak: API-Football sakatlık/ceza bildirimleri ve doğrulanmış kadro uygunluk kayıtları. Bildirim gelmemiş olması eksik olmadığını garanti etmez.</p>
    </section>`;
}

/**
 * 6) FORM — son 5 maç, atılan/yenilen gol. Örneklem küçükse bunu söyler.
 */
export function formSection(analysis, homeName, awayName) {
  if (!analysis) return "";

  const sideHtml = (teamName, context) => {
    const form = context && context.recentForm;
    if (!form || !form.sampleSize) {
      return `<article class="card"><span class="card-kicker">${escapeHtml(teamName)}</span><p class="muted-copy">Son maç formu için doğrulanmış sonuç kaydı henüz yok.</p></article>`;
    }

    const rows = (form.results || []).map((result) => {
      const state = result.outcome === "W" ? "win" : result.outcome === "L" ? "loss" : "draw";
      const letter = result.outcome === "W" ? "G" : result.outcome === "L" ? "M" : "B";
      return `<li><span class="form-dot ${state}">${letter}</span><b>${escapeHtml(result.goalsFor)}-${escapeHtml(result.goalsAgainst)}</b><span class="match-form-opponent">${escapeHtml(result.opponent)}</span><em>${escapeHtml(result.venue === "home" ? "E" : "D")}${result.kickoff ? ` · ${escapeHtml(shortDay(result.kickoff))}` : ""}${result.isFriendly ? " · Hazırlık" : ""}</em></li>`;
    }).join("");

    const limited = form.sampleSize < 5 ? `<span class="match-probability-chip is-warning">Sınırlı örneklem: ${escapeHtml(form.sampleSize)} maç</span>` : "";

    return `<article class="card"><span class="card-kicker">${escapeHtml(teamName)}</span>
        <ul class="match-form-list">${rows}</ul>
        <div class="match-form-totals"><span>Attığı gol <b>${escapeHtml(form.goalsFor)}</b></span><span>Yediği gol <b>${escapeHtml(form.goalsAgainst)}</b></span><span>Puan <b>${escapeHtml(form.points)}</b></span></div>
        ${limited}
      </article>`;
  };

  return `<section class="match-form-section" aria-label="Form durumu"><h2 class="match-section-title">Form: Son Maçlar</h2>
      <div class="match-absences-grid">${sideHtml(homeName, analysis.homeContext)}${sideHtml(awayName, analysis.awayContext)}</div>
    </section>`;
}

/**
 * 7) İKİLİ REKABET + MİNİ PUAN TABLOSU.
 * H2H girdileri çağıran tarafça gerçek kaynaklardan (maç arşivi + sağlayıcı
 * geçmişi) derlenip tekilleştirilir; burada yalnızca çizilir.
 */
/**
 * `standings` = services/standingsResolver.js çıktısı (ya da yalnızca satır
 * dizisi taşıyan eşdeğeri). Mini tablo HANGİ ligin tablosu olduğunu açıkça
 * yazar ve "tamamını aç" bağlantısı o ligin kendi sayfasına gider; başlığı
 * doğru ama tablosu başka lige ait bir kart üretilemez.
 */
export function h2hStandingsSection(h2hEntries, standings, homeName, awayName, standingsUpdatedAt) {
  const entries = Array.isArray(h2hEntries) ? h2hEntries : [];
  const resolved = Array.isArray(standings)
    ? { status: standings.length ? "ok" : "unavailable", table: standings, updatedAt: standingsUpdatedAt || null, league: null, fullHref: null }
    : (standings || {});
  const table = resolved.status === "unavailable" ? [] : (Array.isArray(resolved.table) ? resolved.table : []);
  const updatedAt = resolved.updatedAt || standingsUpdatedAt || null;
  const leagueName = resolved.league || resolved.competitionName || null;
  const fullHref = resolved.fullHref || "../puan-durumu.html";

  let h2hHtml = "";
  if (entries.length) {
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    for (const entry of entries) {
      if (entry.homeGoals === entry.awayGoals) draws += 1;
      else {
        const winner = entry.homeGoals > entry.awayGoals ? entry.homeTeam : entry.awayTeam;
        if (normalizeName(winner) === normalizeName(homeName)) homeWins += 1;
        else awayWins += 1;
      }
    }
    const rows = entries.map((entry) => `<li><em>${escapeHtml(shortDay(entry.date))}.${escapeHtml(yearOf(entry.date))}</em><span>${escapeHtml(entry.homeTeam)} <b>${escapeHtml(entry.homeGoals)}-${escapeHtml(entry.awayGoals)}</b> ${escapeHtml(entry.awayTeam)}</span>${entry.competition ? `<i>${escapeHtml(entry.competition)}</i>` : ""}</li>`).join("");
    h2hHtml = `<article class="card"><span class="card-kicker">İkili rekabet · son ${entries.length} maç</span>
        <div class="match-h2h-summary"><span>${escapeHtml(homeName)} <b>${homeWins}</b></span><span>Beraberlik <b>${draws}</b></span><span>${escapeHtml(awayName)} <b>${awayWins}</b></span></div>
        <ul class="match-h2h-list">${rows}</ul>
      </article>`;
  } else {
    h2hHtml = `<article class="card"><span class="card-kicker">İkili rekabet</span><p class="muted-copy">Bu eşleşme için doğrulanmış geçmiş karşılaşma kaydı henüz derlenmedi.</p></article>`;
  }

  let standingsHtml = "";
  const wanted = [homeName, awayName].map(normalizeName);
  const teamRows = table.filter((row) => wanted.includes(normalizeName(row.team || row.name)));
  if (teamRows.length) {
    const leader = table.find((row) => Number(row.rank) === 1);
    const shown = [...new Set([leader, ...teamRows].filter(Boolean))].sort((left, right) => Number(left.rank) - Number(right.rank));
    const rows = shown.map((row) => {
      const highlight = wanted.includes(normalizeName(row.team || row.name)) ? ' class="is-focus"' : "";
      return `<tr${highlight}><td>${escapeHtml(row.rank)}</td><td>${escapeHtml(row.team || row.name)}</td><td>${escapeHtml(row.played)}</td><td>${escapeHtml(row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference)}</td><td><b>${escapeHtml(row.points)}</b></td></tr>`;
    }).join("");
    standingsHtml = `<article class="card" data-standings-league="${escapeHtml(resolved.competitionId || "")}" data-standings-season="${escapeHtml(resolved.season || "")}" data-standings-state="ok"><span class="card-kicker">Puan durumu${leagueName ? ` · ${escapeHtml(leagueName)}` : ""}${updatedAt ? ` · ${escapeHtml(shortDay(updatedAt))}` : ""}</span>
        <table class="match-mini-standings"><thead><tr><th>#</th><th>Takım</th><th>O</th><th>AV</th><th>P</th></tr></thead><tbody>${rows}</tbody></table>
        <a class="detail-link" href="${escapeHtml(fullHref)}">Tam puan durumunu aç</a>
      </article>`;
  } else {
    // Yanlış ligin tablosunu göstermektense alanı dürüst bir notla bırak.
    const note = resolved.status === "unavailable"
      ? "Bu turnuva için güncel puan durumu verisi henüz mevcut değil."
      : "Sezon tablosu ilk sonuçlarla birlikte otomatik dolacak.";
    standingsHtml = `<article class="card" data-standings-league="${escapeHtml(resolved.competitionId || "")}" data-standings-season="${escapeHtml(resolved.season || "")}" data-standings-state="unavailable" data-standings-reason="${escapeHtml(resolved.reason || "no-data")}"><span class="card-kicker">Puan durumu${leagueName ? ` · ${escapeHtml(leagueName)}` : ""}</span><p class="muted-copy">${escapeHtml(note)}</p></article>`;
  }

  return `<section class="match-h2h-standings" aria-label="İkili rekabet ve puan durumu"><h2 class="match-section-title">İkili Rekabet ve Puan Durumu</h2>
      <div class="match-absences-grid">${h2hHtml}${standingsHtml}</div>
    </section>`;
}

/**
 * 8) MAÇ BİLGİLERİ — stadyum, tarih, saat, hafta, hakem. Yayıncı ve hava
 * durumu için doğrulanmış kaynağımız yok; satırları uydurmak yerine tek
 * dürüst notla açıklanır.
 */
export function matchInfoSection(match, calendarRec, venueFallback, cityFallback) {
  const rows = [];
  const venue = match.venue || venueFallback || null;
  if (venue) rows.push(["Stadyum", venue]);
  if (cityFallback) rows.push(["Şehir", cityFallback]);
  if (match.kickoff) {
    const parsed = new Date(match.kickoff);
    if (!Number.isNaN(parsed.getTime())) {
      rows.push(["Tarih", new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Istanbul" }).format(parsed)]);
      rows.push(["Saat", `${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(parsed)} TSİ`]);
    }
  } else if (match.dateRange) {
    rows.push(["Tarih", `${match.dateRange} (saat açıklanmadı)`]);
  }
  if (match.roundLabel) rows.push(["Hafta", match.roundLabel]);
  if (match.league) rows.push(["Yarışma", match.league]);
  const referee = (calendarRec && calendarRec.referee) || null;
  rows.push(["Hakem", referee || "Henüz açıklanmadı"]);

  if (!rows.length) return "";

  return `<section class="match-info" aria-label="Maç bilgileri"><h2 class="match-section-title">Maç Bilgileri</h2>
      <div class="card match-info-card"><dl class="match-info-grid">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <p class="muted-copy">Yayıncı ve hava durumu bilgisi, doğrulanmış bir kaynaktan alınabildiğinde bu karta eklenir.</p></div>
    </section>`;
}

/**
 * 9) MAÇ İSTATİSTİKLERİ — maç başlayana kadar KAPALI kabuk. site.js,
 * başlama vuruşundan sonra /api/match-detail'den GERÇEK istatistikleri
 * çeker; maç öncesinde hiçbir sayı gösterilmez çünkü henüz yoktur.
 */
export function liveStatsSection(match, providerFixtureId) {
  if (!providerFixtureId || !match.kickoff) return "";
  return `<section class="match-live-stats" aria-label="Maç istatistikleri" data-match-live-stats data-provider-fixture="${escapeHtml(providerFixtureId)}" data-kickoff="${escapeHtml(match.kickoff)}">
      <h2 class="match-section-title">Maç İstatistikleri</h2>
      <div class="card match-live-stats-shell" data-match-live-stats-body>
        <p class="muted-copy" data-match-live-stats-note>İstatistikler maç başladığında burada canlı olarak açılır: topa sahip olma, şut, isabetli şut, korner ve diğerleri.</p>
      </div>
    </section>`;
}

/**
 * Analiz kaydı olmayan (uzak turlardaki) sayfalar için tek dürüst kart —
 * altı ayrı "veri yok" kutusu yerine ne zaman geleceğini söyleyen tek not.
 */
export function analysisPendingNote() {
  return `<section class="match-analysis-pending" aria-label="Analiz durumu">
      <article class="card data-empty"><strong>Tam maç öncesi analiz hazırlanıyor</strong><span>Muhtemel 11'ler, kazanma olasılığı, form ve eksik listesi; maç haftası yaklaştığında (7 gün içinde) doğrulanmış verilerle otomatik yayımlanır. Bu sayfa her saat yenilenir.</span></article>
    </section>`;
}

/**
 * Sağlayıcı H2H ham fikstürleri + arşiv kayıtlarından tek tip, tekilleşmiş
 * ikili rekabet listesi. Yalnızca skoru belli, bitmiş maçlar alınır.
 */
export function buildH2hEntries({ archiveRecords, calendarRec, homeName, awayName, sameClub, limit = 5 }) {
  const entries = [];
  const isPair = (left, right) =>
    (sameClub(left, homeName) && sameClub(right, awayName)) ||
    (sameClub(left, awayName) && sameClub(right, homeName));

  for (const record of Array.isArray(archiveRecords) ? archiveRecords : []) {
    const match = record && record.match;
    if (!match || !match.homeTeam || !match.awayTeam) continue;
    if (!isPair(match.homeTeam, match.awayTeam)) continue;
    const score = match.score || {};
    if (score.home == null || score.away == null) continue;
    entries.push({
      date: match.kickoff || null,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeGoals: score.home,
      awayGoals: score.away,
      competition: match.competition || match.league || null
    });
  }

  const rawH2h = calendarRec && calendarRec.prediction && Array.isArray(calendarRec.prediction.h2h) ? calendarRec.prediction.h2h : [];
  for (const raw of rawH2h) {
    const home = raw && raw.teams && raw.teams.home && raw.teams.home.name;
    const away = raw && raw.teams && raw.teams.away && raw.teams.away.name;
    const goals = raw && raw.goals;
    const statusShort = raw && raw.fixture && raw.fixture.status && raw.fixture.status.short;
    if (!home || !away || !goals || goals.home == null || goals.away == null) continue;
    if (!["FT", "AET", "PEN"].includes(String(statusShort || ""))) continue;
    if (!isPair(home, away)) continue;
    entries.push({
      date: (raw.fixture && raw.fixture.date) || null,
      homeTeam: home,
      awayTeam: away,
      homeGoals: goals.home,
      awayGoals: goals.away,
      competition: (raw.league && raw.league.name) || null
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const entry of entries.sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))) {
    const key = `${String(entry.date || "").slice(0, 10)}|${normalizeName(entry.homeTeam)}|${normalizeName(entry.awayTeam)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped.slice(0, limit);
}
