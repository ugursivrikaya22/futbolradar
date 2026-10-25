/**
 * SÜPER LOTO — VERİ, İSTATİSTİK VE KÖŞE YAZISI ÇEKİRDEĞİ.
 *
 * Kaynak: data/super-loto-draws.json
 * ({ source, fetchedAt, draws: [{ drawNumber, date, numbers, sourceUrl, prizes: [{ tier, winners, amountTRY }] }] }). Bu dosyaya YALNIZCA resmî Milli Piyango
 * kaynağından gerçekten çekilmiş çekilişler girer (scripts/fetch-super-loto.mjs).
 * Buradaki hiçbir fonksiyon sayı, tarih ya da ikramiye uydurmaz: köşe yazısı
 * şablonla, yalnızca arşivdeki gerçek çekilişlerden hesaplanan istatistiklerle
 * kurulur. Arşiv karşılaştırma için yetersizse ilgili cümle hiç yazılmaz.
 */
import fs from "node:fs";
import path from "node:path";

export const MIN_NUMBER = 1;
export const MAX_NUMBER = 60;
export const PICK = 6;

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "2026-10-22" → "22 Ekim 2026" (takvim tarihi; saat dilimi kaydırması yok). */
export function trDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Geçerli bir çekiliş mi? 6 farklı tam sayı (1–60) ve ISO tarih şart. */
export function isValidDraw(draw) {
  if (!draw || !/^\d{4}-\d{2}-\d{2}$/.test(String(draw.date || ""))) return false;
  const nums = draw.numbers;
  if (!Array.isArray(nums) || nums.length !== PICK) return false;
  if (!nums.every((n) => Number.isInteger(n) && n >= MIN_NUMBER && n <= MAX_NUMBER)) return false;
  return new Set(nums).size === PICK;
}

/** Yeniden eskiye sıralı, tarihe göre tekilleştirilmiş, geçerli çekilişler. */
export function normalizeDraws(draws) {
  const byDate = new Map();
  for (const draw of Array.isArray(draws) ? draws : []) {
    if (!isValidDraw(draw)) continue;
    byDate.set(draw.date, { ...draw, numbers: [...draw.numbers].sort((a, b) => a - b) });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function readSuperLoto(root) {
  const file = path.join(root, "data", "super-loto-draws.json");
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { data = {}; }
  return { ...data, draws: normalizeDraws(data.draws) };
}

const pad = (n) => String(n).padStart(2, "0");
export const formatNumbers = (nums) => nums.map(pad).join(" - ");

/** Tek çekilişin yapısal özellikleri. */
export function drawShape(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = sorted.filter((n) => n % 2 === 1).length;
  const low = sorted.filter((n) => n <= MAX_NUMBER / 2).length;
  const consecutive = [];
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i] - sorted[i - 1] === 1) consecutive.push([sorted[i - 1], sorted[i]]);
  return { sorted, sum, odd, even: PICK - odd, low, high: PICK - low, consecutive, min: sorted[0], max: sorted[sorted.length - 1] };
}

/** Arşiv istatistikleri: sıklık, son görülme, ortalama toplam. `draws` yeniden eskiye. */
export function archiveStats(draws) {
  const frequency = new Map();
  const lastSeenIndex = new Map();
  draws.forEach((draw, index) => {
    for (const n of draw.numbers) {
      frequency.set(n, (frequency.get(n) || 0) + 1);
      if (!lastSeenIndex.has(n)) lastSeenIndex.set(n, index);
    }
  });
  const ranked = [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const sums = draws.map((d) => drawShape(d.numbers).sum);
  const avgSum = sums.length ? sums.reduce((a, b) => a + b, 0) / sums.length : 0;
  const neverSeen = [];
  for (let n = MIN_NUMBER; n <= MAX_NUMBER; n += 1) if (!frequency.has(n)) neverSeen.push(n);
  return { count: draws.length, frequency, ranked, lastSeenIndex, avgSum, neverSeen };
}

const prizeOf = (draw, category) => (Array.isArray(draw.prizes) ? draw.prizes.find((p) => String(p.tier || "").startsWith(category)) : null);

/**
 * Köşe yazısı: son çekilişi yorumlayan kısa paragraflar. Tamamen deterministik.
 * Döndürür: { title, paragraphs[] } ya da çekiliş yoksa null.
 */
export function buildCommentary(draws) {
  if (!draws.length) return null;
  const [latest, previous] = draws;
  const shape = drawShape(latest.numbers);
  const history = draws.slice(1);
  const paragraphs = [];

  paragraphs.push(`${trDate(latest.date)} Süper Loto çekilişinde kazanan numaralar ${formatNumbers(shape.sorted)} oldu. En küçük sayı ${shape.min}, en büyük sayı ${shape.max}; altı sayının toplamı ${shape.sum}.`);

  const balance = `Sayıların ${shape.odd} tanesi tek, ${shape.even} tanesi çift; ${shape.low} tanesi 1–30 aralığından, ${shape.high} tanesi 31–60 aralığından geldi.`;
  const consecutive = shape.consecutive.length
    ? ` Ardışık çift dikkat çekiyor: ${shape.consecutive.map(([a, b]) => `${a}-${b}`).join(", ")}.`
    : " Bu çekilişte ardışık sayı çifti çıkmadı.";
  paragraphs.push(balance + consecutive);

  if (previous) {
    const repeats = shape.sorted.filter((n) => previous.numbers.includes(n));
    paragraphs.push(repeats.length
      ? `Bir önceki çekilişle (${trDate(previous.date)}) ortak sayı${repeats.length > 1 ? "lar" : ""}: ${repeats.join(", ")}. Yani ${repeats.length} sayı art arda iki çekilişte de çıktı.`
      : `Bir önceki çekilişle (${trDate(previous.date)}) ortak sayı yok; altı sayının hepsi yeni.`);
  }

  if (history.length >= 2) {
    const past = archiveStats(history);
    const diff = shape.sum - past.avgSum;
    const direction = Math.abs(diff) < 1 ? "neredeyse tam ortalamada" : diff > 0 ? `ortalamanın ${Math.round(diff)} puan üstünde` : `ortalamanın ${Math.round(-diff)} puan altında`;
    paragraphs.push(`Arşivimizdeki önceki ${past.count} çekilişin ortalama toplamı ${past.avgSum.toFixed(1)}; bu haftanın toplamı ${shape.sum} ile ${direction}.`);
    const gaps = shape.sorted
      .map((n) => ({ n, gap: past.lastSeenIndex.has(n) ? past.lastSeenIndex.get(n) + 1 : null }))
      .filter((x) => x.gap === null || x.gap >= 5);
    const absent = gaps.filter((x) => x.gap === null).map((x) => x.n);
    const long = gaps.filter((x) => x.gap !== null).sort((a, b) => b.gap - a.gap);
    if (absent.length) paragraphs.push(`${absent.join(", ")} arşivimizdeki önceki ${past.count} çekilişin hiçbirinde çıkmamıştı; bu hafta ilk kez göründü${absent.length > 1 ? "ler" : ""}.`);
    if (long.length) paragraphs.push(`Uzun aradan dönenler: ${long.map((x) => `${x.n} (${x.gap} çekiliş sonra)`).join(", ")}.`);
  }

  if (draws.length >= 3) {
    const all = archiveStats(draws);
    const top = all.ranked.slice(0, 3).filter(([, c]) => c > 1);
    if (top.length) paragraphs.push(`Arşivdeki ${all.count} çekilişte en sık çıkan sayılar: ${top.map(([n, c]) => `${n} (${c} kez)`).join(", ")}.`);
  }

  const jackpot = prizeOf(latest, "6");
  if (jackpot && Number.isInteger(jackpot.winners)) {
    paragraphs.push(jackpot.winners === 0
      ? "Bu çekilişte 6 bilen çıkmadı; büyük ikramiye bir sonraki çekilişe devrediyor."
      : `Bu çekilişte ${jackpot.winners} kişi 6 sayıyı da bildi${Number.isFinite(jackpot.amountTRY) && jackpot.amountTRY > 0 ? `; kişi başı ikramiye ${jackpot.amountTRY.toLocaleString("tr-TR")} TL` : ""}.`);
  }

  paragraphs.push("Her çekiliş bağımsızdır: geçmiş sıklıklar bir sonraki çekilişi tahmin etmez. Bu yazı yalnızca resmî sonuçlardan hesaplanan istatistiklerdir.");
  return { title: `${trDate(latest.date)} Süper Loto yorumu: ${formatNumbers(shape.sorted)}`, paragraphs };
}
