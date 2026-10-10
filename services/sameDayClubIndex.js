/**
 * AYNI GÜN + KULÜP ADI KELİMESİ DİZİNİ — yalnızca hız, karar `sameClub`'da.
 *
 * `curatedMatches` (services/providers/mockProvider.js) anahtarı tutmayan
 * her takvim kaydı için "aynı gün, aynı kulüp çifti, farklı yazım" adayı
 * arıyordu ve bunu birleşik listenin TAMAMINI gezerek yapıyordu: her adayın
 * gününü yeniden hesaplıyor (Intl saat dilimi çevrimi) ve dört kez `sameClub`
 * (düzenli ifade kurarak) çalıştırıyordu. Takvimde günde 1.000+ fikstür
 * olduğu için bu milyonlarca karşılaştırmaydı: /api/matches önizlemede
 * 17-40 sn sürüyor, tarayıcı denetimindeki her sayfa istemcinin isteği
 * düşene kadar bekliyordu.
 *
 * Dizin AYNI adayları AYNI sırada verir (scripts/test-same-day-club-index.mjs
 * bunu gerçek takvim üzerinde kaba kuvvet taramayla karşılaştırır):
 *   - Gün, kaydın ilk eklendiği andaki günüdür. `curatedMatches` bir kaydı
 *     güncellerken kickoff/date alanlarına dokunmuyor; gün değişmiyor.
 *   - `sameClub(a, b)` doğruysa kısa adın HER kelimesi uzun adda kelime
 *     olarak geçer (eşitlik ya da kelime sınırlı içerme). Yani eşleşebilecek
 *     bir adayın ev sahibi adı, aranan kaydın ev sahibi ya da deplasman
 *     adıyla en az bir kelime paylaşır. Paylaşmayan aday zaten eşleşemezdi.
 *   - Adaylar ilk eklenme sırasıyla döner; "ilk eşleşen kazanır" korunur.
 */

function createSameDayClubIndex({ dayOf, normalize }) {
  const byDayToken = new Map();
  const known = new Set();
  let insertion = 0;
  const tokensOf = (value) => new Set(normalize(value).split(/\s+/).filter(Boolean));

  /** Anahtarı ilk görüldüğü kayıtla dizine ekler; tekrar eklemez. */
  function remember(key, match) {
    if (known.has(key)) return;
    known.add(key);
    const day = dayOf(match);
    let tokens = byDayToken.get(day);
    if (!tokens) { tokens = new Map(); byDayToken.set(day, tokens); }
    const entry = { key, order: insertion++ };
    for (const token of tokensOf(match && match.homeTeam)) {
      const list = tokens.get(token);
      if (list) list.push(entry);
      else tokens.set(token, [entry]);
    }
  }

  /** O gün, `match` ile eşleşebilecek adayların anahtarları, eklenme sırasıyla. */
  function candidates(day, match) {
    const tokens = byDayToken.get(day);
    if (!tokens) return [];
    const found = new Map();
    for (const token of new Set([...tokensOf(match && match.homeTeam), ...tokensOf(match && match.awayTeam)])) {
      for (const entry of tokens.get(token) || []) found.set(entry.order, entry.key);
    }
    return [...found.entries()].sort((left, right) => left[0] - right[0]).map(([, key]) => key);
  }

  return { remember, candidates };
}

module.exports = { createSameDayClubIndex };
