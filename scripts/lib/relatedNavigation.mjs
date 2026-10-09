/**
 * İLGİLİ GEZİNME KARTLARI — maç sayfası ("Bu maçla ilgili") ve köşe yazısı
 * sayfası (yazı sonu) için ortak, saf kurallar.
 *
 * Bu dosya HİÇBİR VERİ OKUMAZ ve ağ isteği atmaz: aday kartlar üreticide
 * (scripts/generate-match-seo-pages.mjs, scripts/generate-column-pages.mjs)
 * mevcut veriden kurulur, burada yalnızca süzülür ve basılır. Böylece
 * kurallar tek yerde ve scripts/test-related-navigation.mjs ile sınanır.
 *
 * KURALLAR (ürün kararı, gevşetilmez):
 *   • En fazla 3 kart. Boş kutu, "yakında" kartı, uydurma bağlantı yok —
 *     aday yoksa blok hiç basılmaz.
 *   • Hedefler birbirinden farklı; sayfa kendine asla bağlanmaz.
 *   • Hedef dosyası diskte yoksa kart düşer (çağıran `exists` verir).
 *   • Metin açık yazılır ("Galatasaray'ın sonraki maçları"); "sıralama
 *     değişti" gibi doğrulanmamış iddia, "son dakika/yeni" etiketi yok.
 *   • Kartlar tıklamada önceden yüklenmez (prefetch yok).
 */

export const MAX_RELATED_CARDS = 3;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Bağlantıyı karşılaştırılabilir kök-göreli dosya yoluna indirger:
 * `../../en/team/x.html` → `en/team/x.html`, `../takimlar/galatasaray` →
 * `takimlar/galatasaray.html`, `/kose-yazilari/a.html#b` → `kose-yazilari/a.html`.
 * Sorgu dizgisi KORUNUR (takim-detay.html?team=A ile ?team=B ayrı hedeftir).
 */
export function targetKey(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  const [beforeHash] = raw.split("#");
  const [pathPart, query] = beforeHash.split("?");
  let clean = pathPart.replace(/^(\.\.\/|\.\/)+/, "").replace(/^\/+/, "");
  if (!clean) clean = "index.html";
  if (!/\.[a-z0-9]+$/i.test(clean)) clean = `${clean}.html`;
  return query ? `${clean}?${query}` : clean;
}

/** Dosya yolu (sorgusuz) — diskte var mı denetimi için. */
export function targetFile(href) {
  return targetKey(href).split("?")[0];
}

/**
 * Aday listesinden yayınlanacak kartları seçer.
 *
 * Sıra korunur (çağıran önceliği belirler), boş/geçersiz adaylar, kendine
 * bağlantı, yinelenen hedef ve diskte olmayan hedef düşer; en fazla `max`.
 */
export function pickRelatedCards(candidates, { self = [], exists = null, max = MAX_RELATED_CARDS } = {}) {
  const selfKeys = new Set((Array.isArray(self) ? self : [self]).map(targetKey).filter(Boolean));
  const seen = new Set();
  const picked = [];
  for (const card of Array.isArray(candidates) ? candidates : []) {
    if (picked.length >= max) break;
    if (!card || !card.href || !card.title || !card.kicker || !card.type) continue;
    const key = targetKey(card.href);
    if (!key || selfKeys.has(key) || seen.has(key)) continue;
    if (typeof exists === "function" && !exists(targetFile(card.href))) continue;
    seen.add(key);
    picked.push(card);
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/* METİN                                                                */
/* ------------------------------------------------------------------ */

/**
 * TÜRKÇE TAMLAYAN EKİ YALNIZCA BİLİNEN ADLARA.
 *
 * Ek kuralı ünlü uyumuna ve okunuşa bağlı; "Çorum FK" ("Fe-Ka") ya da
 * "Gençlerbirliği S.K." gibi kısaltmalı adlarda kural tabanlı ek yanlış
 * Türkçe üretir. Bu yüzden ek yalnızca doğrulanmış adlara yazılır, diğer
 * takımlar eksiz kalıp kullanır ("Sonraki maç · Kasımpaşa").
 */
const TR_GENITIVE = Object.freeze({
  galatasaray: "Galatasaray'ın",
  fenerbahce: "Fenerbahçe'nin",
  besiktas: "Beşiktaş'ın",
  trabzonspor: "Trabzonspor'un"
});

function foldKey(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function trGenitive(teamName) {
  return TR_GENITIVE[foldKey(teamName)] || null;
}

export const RELATED_TEXT = Object.freeze({
  tr: {
    matchHeading: "Bu maçla ilgili",
    columnHeading: "İlgili içerikler",
    teamFixtures: (team) => {
      const gen = trGenitive(team);
      return { kicker: "Fikstür", title: gen ? `${gen} sonraki maçları` : `${team} fikstürü` };
    },
    leagueStandings: (league) => ({ kicker: "Puan durumu", title: `${league} puan durumu` }),
    preview: (title) => ({ kicker: "Maç önü analizi", title }),
    previewColumn: (title) => ({ kicker: "Maç önü köşe yazısı", title }),
    leagueMatches: (league) => ({ kicker: "Aynı ligdeki diğer maçlar", title: `${league}: bugün ve yaklaşan maçlar` }),
    sameDayMatch: (league, home, away) => ({ kicker: `Aynı gün · ${league}`, title: `${home} - ${away}` }),
    teamPage: (team) => ({ kicker: "Takım sayfası", title: team }),
    matchReport: (home, away, score) => ({ kicker: "Maç raporu", title: `${home} ${score || "-"} ${away} maç raporu` }),
    reviewColumn: (title) => ({ kicker: "Maç sonu köşe yazısı", title }),
    nextMatch: (team, home, away) => {
      const gen = trGenitive(team);
      return { kicker: gen ? `${gen} sonraki maçı` : `Sonraki maç · ${team}`, title: `${home} - ${away}` };
    },
    columnMatch: (title) => ({ kicker: "Yazının konusu olan maç", title }),
    competition: (name) => ({ kicker: "Turnuva sayfası", title: name }),
    relatedColumn: (title) => ({ kicker: "Aynı konuda köşe yazısı", title })
  },
  en: {
    matchHeading: "Related to this match",
    columnHeading: "Related",
    teamFixtures: (team) => ({ kicker: "Fixtures", title: `${team} fixtures and results` }),
    leagueStandings: (league) => ({ kicker: "Standings", title: `${league} standings` }),
    preview: (title) => ({ kicker: "Match preview", title }),
    previewColumn: (title) => ({ kicker: "Pre-match column", title }),
    leagueMatches: (league) => ({ kicker: "More matches in this league", title: `${league}: today and upcoming` }),
    sameDayMatch: (league, home, away) => ({ kicker: `Same day · ${league}`, title: `${home} vs ${away}` }),
    teamPage: (team) => ({ kicker: "Team page", title: team }),
    matchReport: (home, away, score) => ({ kicker: "Match report", title: `${home} ${score || "-"} ${away} match report` }),
    reviewColumn: (title) => ({ kicker: "Post-match column", title }),
    nextMatch: (team, home, away) => ({ kicker: `${team}'s next match`, title: `${home} vs ${away}` }),
    columnMatch: (title) => ({ kicker: "The match in this column", title }),
    competition: (name) => ({ kicker: "Competition page", title: name }),
    relatedColumn: (title) => ({ kicker: "Related column", title })
  }
});

export function relatedText(locale) {
  return RELATED_TEXT[locale === "en" ? "en" : "tr"];
}

/* ------------------------------------------------------------------ */
/* MAÇ SAYFASI — DURUMA GÖRE ADAY SIRASI                               */
/* ------------------------------------------------------------------ */

/**
 * Bir sayfa durumundan istemcide hangi durumlara geçilebilir? Sunucu yalnızca
 * ulaşılabilecek durumların kart setlerini basar; istemci (match-center.js)
 * durum değişince bunlar arasından seçer — ek istek atmadan.
 */
export function reachableStates(state) {
  if (state === "pre") return ["pre", "live", "post"];
  if (state === "live") return ["live", "post"];
  if (state === "pending") return ["post"];
  return [state];
}

/** Kart setinin anahtarı: "pending" bitmiş maç gibi davranır. */
export function setKeyFor(state) {
  return state === "pending" ? "post" : state;
}

/**
 * Duruma göre aday sırası. Her `slots` alanı ya kart ya kart dizisi ya da
 * null'dır; sıradaki ilk geçerli 3 kart yayınlanır. Yedekler AYNI TÜRDEN
 * (ör. diğer takımın fikstürü) — listede olmayan bir tür eklenmez.
 *
 *   maç öncesi : takım fikstürü, lig puan durumu, bu maçın yayımlanmış ön analizi
 *   canlı      : aynı ligdeki diğer maçlar, lig puan durumu, takım sayfası
 *   maç sonu   : bu maçın yayımlanmış değerlendirmesi, takımın sonraki maçı, lig puan durumu
 */
export function orderedCandidates(setKey, slots) {
  const s = slots || {};
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const [fixturesA, fixturesB] = list(s.teamFixtures);
  const [teamA, teamB] = list(s.teamPages);
  const [nextA, nextB] = list(s.nextMatches);
  const [reviewA, ...reviewRest] = list(s.reviews);
  const [previewA, ...previewRest] = list(s.previews);
  const [otherA, ...otherRest] = list(s.leagueMatches);
  if (setKey === "pre") return [fixturesA, s.standings, previewA, fixturesB, ...previewRest];
  if (setKey === "live") return [otherA, s.standings, teamA, teamB, ...otherRest];
  // Sonraki maçın sayfası henüz yoksa takımın fikstür sayfası aynı ihtiyacı karşılar.
  if (setKey === "post") return [reviewA, nextA, s.standings, ...reviewRest, nextB, fixturesA, fixturesB];
  if (setKey === "postponed" || setKey === "cancelled") return [fixturesA, s.standings, fixturesB];
  return [];
}

/**
 * Sayfanın ulaşabileceği her durum için seçilmiş kart setleri.
 * @returns {{ state: string, sets: Array<{ key: string, cards: object[] }> }}
 */
export function buildMatchRelatedSets(state, slotsByKey, options = {}) {
  const keys = [...new Set(reachableStates(state).map(setKeyFor))];
  const sets = keys.map((key) => ({
    key,
    cards: pickRelatedCards(orderedCandidates(key, slotsByKey(key)), options)
  }));
  return { state: setKeyFor(state), sets };
}

function cardHtml(card, position) {
  return `<a class="match-related-card rel-nav-card" href="${escapeHtml(card.href)}" data-related-card data-related-target="${escapeHtml(card.type)}" data-related-position="${position}">` +
    `<span>${escapeHtml(card.kicker)}</span><strong>${escapeHtml(card.title)}</strong>` +
    `${card.note ? `<p>${escapeHtml(card.note)}</p>` : ""}</a>`;
}

/**
 * "Bu maçla ilgili" bloğu. Geçerli durumun seti görünür, diğerleri `hidden`
 * basılır ve istemci durum değişince değiştirir. Hiçbir sette kart yoksa
 * blok hiç basılmaz; geçerli set boşsa blok gizli doğar.
 */
export function matchRelatedHtml(result, locale) {
  const text = relatedText(locale);
  const sets = (result && result.sets || []).filter((set) => set.cards.length);
  if (!sets.length) return "";
  const current = sets.find((set) => set.key === result.state);
  const groups = sets.map((set) => `<div class="msp-related-grid rel-nav-grid" data-related-set="${escapeHtml(set.key)}"${set === current ? "" : " hidden"}>${set.cards.map((card, index) => cardHtml(card, index + 1)).join("")}</div>`).join("");
  return `<section class="msp-section rel-nav" id="${locale === "en" ? "related-to-this-match" : "bu-macla-ilgili"}" data-related-nav data-related-source="match" data-related-slot="match_top" aria-labelledby="rel-nav-title"${current ? "" : " hidden"}>` +
    `<h2 id="rel-nav-title" class="msp-section-title">${escapeHtml(text.matchHeading)}</h2>${groups}</section>`;
}

/* ------------------------------------------------------------------ */
/* KÖŞE YAZISI — İLGİLİ KARTLAR                                         */
/* ------------------------------------------------------------------ */

/** Konu eşleştirmesinde ayırt edici olmayan etiketler. */
const GENERIC_TAGS = new Set([
  "super lig", "kose yazisi", "futbol analizi", "mac yorumu", "turk futbolu",
  "super lig gundemi", "taraftar", "avrupa", "transfer", "opinion"
].map((tag) => foldKey(tag)));

export function topicTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map(foldKey).filter((tag) => tag && !GENERIC_TAGS.has(tag)))];
}

/**
 * Aynı konudaki başka yayımlanmış yazıları puanlar. Öncelik: aynı maç
 * ilişkisi > ortak takım > ortak etiket. Eşik altı (tek bir ortak etiket)
 * yazı önerilmez. Eşitlikte tarihçe en yakın yazı önce gelir.
 */
export function rankRelatedColumns(current, others) {
  const currentTags = new Set(topicTags(current.tags));
  const currentTeams = new Set((current.teams || []).map(foldKey));
  const currentTime = Date.parse(current.date) || 0;
  return (Array.isArray(others) ? others : [])
    .filter((other) => other && other.path && other.path !== current.path && other.id !== current.id)
    .map((other) => {
      let score = 0;
      if (current.matchSlug && other.matchSlug && current.matchSlug === other.matchSlug) score += 10;
      for (const team of (other.teams || []).map(foldKey)) if (currentTeams.has(team)) score += 4;
      for (const tag of topicTags(other.tags)) if (currentTags.has(tag)) score += 1;
      return { other, score, distance: Math.abs((Date.parse(other.date) || 0) - currentTime) };
    })
    .filter((row) => row.score >= 2)
    .sort((left, right) => right.score - left.score || left.distance - right.distance)
    .map((row) => row.other);
}

export function columnRelatedHtml(cards, locale) {
  const text = relatedText(locale);
  if (!Array.isArray(cards) || !cards.length) return "";
  return `<section class="column-related rel-nav" data-related-nav data-related-source="column" data-related-slot="column_end" aria-labelledby="column-related-title">` +
    `<h2 id="column-related-title">${escapeHtml(text.columnHeading)}</h2>` +
    `<div class="msp-related-grid rel-nav-grid">${cards.map((card, index) => cardHtml(card, index + 1)).join("")}</div></section>`;
}
