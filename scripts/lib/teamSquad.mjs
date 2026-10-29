// Takım profili "Kadro" bölümü: data/players.json'daki kayıtlardan, mevkiye
// göre gruplu ve TEKİLLEŞTİRİLMİŞ oyuncu listesi kurar. Veri uydurmaz:
// mevki yoksa oyuncu "Diğer" grubunda, mevki etiketi olmadan listelenir.

export const SQUAD_GROUPS = [
  { key: "goalkeeper", label: "Kaleciler" },
  { key: "defender", label: "Defans" },
  { key: "midfielder", label: "Orta saha" },
  { key: "forward", label: "Hücum" },
  { key: "other", label: "Diğer" }
];

const GROUP_ALIAS = { winger: "forward", attacker: "forward" };

// Sağlayıcıdan gelen İngilizce genel mevkiler Türkçe gösterilir.
const POSITION_TR = {
  Goalkeeper: "Kaleci",
  Defender: "Defans",
  Midfielder: "Orta saha",
  Attacker: "Forvet",
  "Sag kanat": "Sağ kanat"
};

export function squadGroupKey(player) {
  const raw = String(player?.positionGroup || "").toLowerCase();
  const key = GROUP_ALIAS[raw] || raw;
  return SQUAD_GROUPS.some((group) => group.key === key) ? key : "other";
}

export function positionLabelTr(position) {
  const text = String(position || "").trim();
  return POSITION_TR[text] || text;
}

function nameScore(player) {
  const name = String(player?.name || "");
  // "B. Gezek" gibi kısaltılmış adlar, aynı profile giden tam addan sonra gelir.
  return (/^\p{L}\.\s/u.test(name) ? 0 : 1000) + name.length;
}

/**
 * @param {Array<object>} squad  aynı kulübe ait oyuncu kayıtları
 * @param {(id: string) => string} hrefFor  kanonik profil bağlantısı
 * @returns {Array<{key:string,label:string,players:Array<{name:string,href:string,position:string}>}>}
 */
export function buildSquadGroups(squad, hrefFor) {
  const byHref = new Map();
  for (const player of squad || []) {
    if (!player?.id || !player?.name) continue;
    const href = hrefFor(player.id);
    if (!href) continue;
    const current = byHref.get(href);
    if (!current || nameScore(player) > nameScore(current)) byHref.set(href, player);
  }
  const groups = SQUAD_GROUPS.map((group) => ({ ...group, players: [] }));
  const index = new Map(groups.map((group) => [group.key, group]));
  for (const [href, player] of byHref) {
    index.get(squadGroupKey(player)).players.push({ name: player.name, href, position: positionLabelTr(player.position) });
  }
  for (const group of groups) group.players.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  return groups.filter((group) => group.players.length);
}

export function squadSectionHtml(groups, escapeHtml) {
  if (!groups.length) return "<p>Bu takım için güncel oyuncu kaydı bulunmuyor.</p>";
  return groups
    .map((group) => `<h3 class="evergreen-squad-group">${escapeHtml(group.label)} <small>(${group.players.length})</small></h3><ul class="evergreen-player-list">${group.players
      .map((player) => `<li><a href="${escapeHtml(player.href)}"><strong>${escapeHtml(player.name)}</strong>${player.position ? `<span>${escapeHtml(player.position)}</span>` : ""}</a></li>`)
      .join("")}</ul>`)
    .join("");
}
