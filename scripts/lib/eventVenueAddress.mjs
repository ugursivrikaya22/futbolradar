/**
 * SPORTSEVENT KONUM ADRESİ — yalnızca doğrulanmış kayıttan.
 *
 * Google etkinlik işaretlemesinde `location.address` bekliyor. Maç kaydında
 * yalnızca stat adı var ("Tupras Stadium", "Samsun 19 Mayis Stadyumu");
 * şehir yok. Şehir, ev sahibinin depodaki doğrulanmış iç saha kaydından
 * (data/super-lig-fixtures.json → teams: stat + şehir) alınır, AMA yalnızca
 * maçın statı o kayıtla örtüşüyorsa. Tarafsız saha, eski stat adı ya da
 * eşleşmeyen yazım → adres yazılmaz (boş nesne döner). Şehir tahmin edilmez.
 */
import { teamVenue } from "./teamRichResults.mjs";

// Stat adlarında ayırt edici olmayan kelimeler.
const GENERIC = new Set(["stadyumu", "stadyum", "stadium", "stadi", "stad", "arena", "sehir", "belediye", "buyuksehir", "the"]);

function tokens(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !GENERIC.has(word));
}

/** İki stat adı aynı yeri mi gösteriyor? Küçük küme büyükte tamamen varsa ya da Jaccard ≥ 0,5. */
export function sameVenue(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const word of small) if (large.has(word)) shared += 1;
  if (shared === small.size) return true;
  const union = new Set([...a, ...b]).size;
  return shared / union >= 0.5;
}

/**
 * `{ address: PostalAddress }` ya da `{}` — doğrudan Place düğümüne yayılır.
 * @param {{fixtureTeams: Array}} sources loadTeamSources(root) çıktısı
 */
export function venueAddressFor(sources, homeTeam, venue) {
  if (!sources || !venue || !homeTeam) return {};
  const { venue: homeVenue, city } = teamVenue(sources, homeTeam);
  if (!homeVenue || !city || !sameVenue(homeVenue, venue)) return {};
  return { address: { "@type": "PostalAddress", addressLocality: city, addressCountry: "TR" } };
}
