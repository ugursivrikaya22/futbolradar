// Keep the published URL when a verified current record exists, even if its
// canonical record is missing or no longer passes the publication gate.
export function englishProfilePlayers(players, urls, view) {
  const pages = new Map();
  for (const player of players) {
    if (!view(player).verified) continue;
    const pathname = urls.enPlayerPagePath(player.id);
    if (!pages.has(pathname) || urls.resolveId(player.id) === player.id) {
      pages.set(pathname, player);
    }
  }
  return [...pages.values()];
}

/**
 * Yayından düşen oyuncunun İngilizce sayfası SİLİNMEZ. Saatlik yenileme
 * yalnızca o anki veri dilimini görür; bir oyuncu geçici olarak düşünce
 * sayfasını silmek /en/player/:slug yönlendirmesini ve üretim kapısını
 * (tests/emir11-poll-client.test.cjs) kırıyordu. Güncel veride olmayan
 * mevcut sayfalar korunur; döndürülen liste yalnızca rapor içindir.
 */
export function retainedEnglishPages(existingFiles, expectedFiles) {
  const expected = new Set(expectedFiles);
  return existingFiles.filter((file) => file.endsWith(".html") && !expected.has(file)).sort();
}

export function stripHreflangAlternates(html) {
  return html.replace(/[ \t]*<link rel="alternate" hreflang="[^"]*"[^>]*>\r?\n?/g, "");
}
