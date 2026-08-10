/**
 * PUAN TABLOSU ARİTMETİĞİ — TEK TANIM.
 *
 * Tablo sağlayıcıdan satır satır kopyalanıyor ve hiçbir yerde tutarlılığı
 * sınanmıyordu. Sağlayıcı bir maçı iki kez sayarsa ya da bir alanı eksik
 * gönderirse tablo sessizce yanlış yayımlanır: O ≠ G+B+M olan, averajı
 * gollerine uymayan ya da puanı galibiyet sayısıyla çelişen bir satır
 * okuyucuya doğru veriymiş gibi görünür.
 *
 * Kural burada duruyor çünkü İKİ tüketicisi var: `scripts/qa.mjs` her
 * derlemede üretim verisini bu kuralla sınıyor, `scripts/test-opening-week.mjs`
 * ise kuralın bozuk satırı gerçekten yakaladığını doğruluyor. Kural iki
 * yerde ayrı ayrı yazılsaydı, kapının kendisi test edilemezdi.
 *
 * Denetlenen kimlikler:
 *   O  = G + B + M
 *   AV = AG - YG
 *   P  = 3·G + B            (varsa `pointDeduction` düşülür)
 *   Sıra numaraları tekil.
 *   Sezon etiketi tüm satırlarda aynı.
 *
 * SEZON ÖNCESİ SIRALAMA DENETLENMEZ: hiç maç oynanmamışken tüm satırlar
 * sıfırdır ve sağlayıcının verdiği sıra alfabetiktir. O durumda sıralamayı
 * puana göre sınamak olmayan bir hatayı raporlamak olurdu — arayüz zaten
 * sezon başlamadan tabloyu basmıyor.
 *
 * @param {Array} rows data/teams.json satırları
 * @returns {string[]} ihlal açıklamaları; boş dizi = tablo tutarlı
 */
function checkStandings(rows) {
  const violations = [];
  const list = Array.isArray(rows) ? rows : [];

  if (!list.length) {
    return ["puan tablosu boş"];
  }

  const seenRanks = new Map();
  let playedTotal = 0;

  for (const row of list) {
    const label = row.name || row.id || "bilinmeyen takım";
    const played = Number(row.played || 0);
    const won = Number(row.won || 0);
    const drawn = Number(row.drawn || 0);
    const lost = Number(row.lost || 0);
    const goalsFor = Number(row.goalsFor || 0);
    const goalsAgainst = Number(row.goalsAgainst || 0);
    const goalDifference = Number(row.goalDifference || 0);
    const points = Number(row.points || 0);
    const deduction = Number(row.pointDeduction || 0);

    for (const [field, value] of Object.entries({ played, won, drawn, lost, goalsFor, goalsAgainst, points })) {
      if (!Number.isInteger(value) || value < 0) {
        violations.push(`${label}: ${field} negatif ya da tam sayı değil (${value})`);
      }
    }

    if (played !== won + drawn + lost) {
      violations.push(`${label}: O(${played}) ≠ G(${won})+B(${drawn})+M(${lost})`);
    }
    if (goalDifference !== goalsFor - goalsAgainst) {
      violations.push(`${label}: AV(${goalDifference}) ≠ AG(${goalsFor})-YG(${goalsAgainst})`);
    }
    if (points !== won * 3 + drawn - deduction) {
      violations.push(`${label}: P(${points}) ≠ 3·G(${won})+B(${drawn})-ceza(${deduction})`);
    }

    if (row.rank != null) {
      const rank = Number(row.rank);
      if (!Number.isInteger(rank) || rank <= 0) {
        violations.push(`${label}: geçersiz sıra (${row.rank})`);
      } else if (seenRanks.has(rank)) {
        violations.push(`sıra ${rank} iki takımda birden: ${seenRanks.get(rank)} / ${label}`);
      } else {
        seenRanks.set(rank, label);
      }
    }

    playedTotal += played;
  }

  // Lig başladıysa sıralama puana/averaja uymalı.
  if (playedTotal > 0) {
    const ordered = list
      .filter((row) => row.rank != null)
      .slice()
      .sort((left, right) => Number(left.rank) - Number(right.rank));

    for (let index = 1; index < ordered.length; index += 1) {
      const above = ordered[index - 1];
      const below = ordered[index];
      const better = Number(above.points || 0) > Number(below.points || 0) ||
        (Number(above.points || 0) === Number(below.points || 0) &&
          Number(above.goalDifference || 0) >= Number(below.goalDifference || 0));
      if (!better) {
        violations.push(`sıralama puan/averajla çelişiyor: ${above.name}(${above.points}p) sırası ${below.name}(${below.points}p) üstünde`);
      }
    }
  }

  const seasons = new Set(list.map((row) => row.standingsSeason).filter(Boolean));
  if (seasons.size > 1) {
    violations.push(`puan tablosunda birden fazla sezon etiketi: ${[...seasons].join(", ")}`);
  }

  return violations;
}

module.exports = { checkStandings };
