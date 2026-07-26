/**
 * ÇÖZÜLMÜŞ LİG KİMLİĞİNİN OKUNMASI
 *
 * Bu modülün bağımlılığı yok ve olmamalı: hem services/leagueResolver.js
 * (yazan taraf) hem services/providers/apiFootballProvider.js (okuyan taraf)
 * kullanıyor. Okuma mantığı resolver'da kalsaydı sağlayıcı → resolver →
 * sağlayıcı döngüsü oluşurdu.
 *
 * Önbelleği yalnızca CI/yerel senkron YAZAR. Çalışma anında (Vercel) dosya
 * sistemi salt okunur ve burada zaten yalnızca okuma yapılıyor: depoya
 * commit edilmiş kimlik, /api/* uç noktalarının da env değişkeni olmadan
 * doğru ligi kullanmasını sağlıyor.
 *
 * Lig kimliği bir kimlik bilgisi DEĞİLDİR; bu dosyanın commit edilmesi
 * bilinçli bir tercih. İçine bir gün gerçek bir sır düşerse qa.mjs
 * (checkLeagueCacheHasNoSecret) derlemeyi durdurur.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Anahtar biçimindeki bir değer kimlik sayılmaz. */
const KEY_SHAPED = /^[a-f0-9]{32}$/i;

let memo = null;

function cachePath() {
  return path.join(process.cwd(), "data", "api-football-league.json");
}

/**
 * @returns {{leagueId: string, leagueName: string|null, country: string|null}|null}
 */
function readCachedLeague(options = {}) {
  const file = options.cachePath || cachePath();

  // Süreç içinde bir kez okunur; her istekte diske gitmek gereksiz.
  // options.cachePath verildiğinde (testler) bellek atlanır.
  if (!options.cachePath && memo !== null) return memo || null;

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    parsed = null;
  }

  const leagueId = parsed && parsed.leagueId ? String(parsed.leagueId) : "";
  const usable = Boolean(leagueId) && !KEY_SHAPED.test(leagueId);
  const value = usable
    ? { leagueId, leagueName: parsed.leagueName || null, country: parsed.country || null }
    : null;

  if (!options.cachePath) memo = value || false;
  return value;
}

/** Testler ve uzun ömürlü süreçler için belleği sıfırlar. */
function resetLeagueCacheMemo() {
  memo = null;
}

module.exports = { readCachedLeague, resetLeagueCacheMemo, KEY_SHAPED };
