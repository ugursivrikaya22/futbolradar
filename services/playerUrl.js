/**
 * OYUNCU ADRESİ — TEK ÇÖZÜCÜ.
 *
 * Oyuncu sayfasının adresi iki biçimden biri:
 *
 *   /futbolcu/victor-osimhen          — tam adı bilinen oyuncu (kanonik)
 *   /oyuncular/a-ablak-gaziantep-fk   — tam adı henüz bilinmeyen oyuncu
 *
 * Hangisinin geçerli olduğu `data/player-url-slugs.json` tablosunda yazılı
 * (bkz. scripts/generate-player-url-slugs.mjs). Adres ÜRETEN her yüzey —
 * profil sayfası, arama dizini, lig liderleri, maç kadrosu, kıyas sayfası,
 * istemci kartları — bu modülü çağırmak zorunda. İkinci bir yerde
 * "oyuncular/" + id birleştirmek, o yüzeyi eski adreste bırakır ve
 * kullanıcıyı gereksiz bir yönlendirmeden geçirir.
 *
 * KOPYA KAYIT KENDİ ADRESİNE SAHİP DEĞİLDİR. Aynı gerçek oyuncunun iki
 * kaydı varsa (kadro senkronu elle kürasyonlu kaydın yanına yazıyor) adres
 * kanonik kaydındır; kopya kaydın kimliği kanonik kaydın adresine çözülür.
 * Aksi hâlde aynı oyuncu iki ayrı URL'de yayımlanır — kopya içerik.
 *
 * TAM ADI OLMAYAN OYUNCU ADRES DEĞİŞTİRMEZ. Bir sayfa en fazla bir kez
 * taşınır: kısaltmalı bir ara adrese geçip sonra tam ada geçmek, aynı
 * sayfayı iki kez taşımak ve iki kez sıralama riski almak demektir.
 */

const LEGACY_DIR = "oyuncular";
const CANONICAL_DIR = "futbolcu";

/**
 * Tabloyu aranabilir hâle getirir.
 *
 * @param {{entries?: any[], aliases?: any[]}} table `data/player-url-slugs.json`
 */
function createPlayerUrlResolver(table) {
  const slugById = new Map();
  const fullNameById = new Map();
  const canonicalByAlias = new Map();

  for (const entry of (table && table.entries) || []) {
    if (!entry || !entry.id || !entry.slug) continue;
    slugById.set(entry.id, entry.slug);
    if (entry.fullName) fullNameById.set(entry.id, entry.fullName);
  }
  for (const alias of (table && table.aliases) || []) {
    if (alias && alias.id && alias.canonicalId) canonicalByAlias.set(alias.id, alias.canonicalId);
  }

  /** Kimliği, adresi olan kayda çözer (kopya kayıt → kanonik kayıt). */
  function resolveId(playerId) {
    const id = String(playerId || "");
    return canonicalByAlias.get(id) || id;
  }

  /** Bu kayıt tam isimli adrese taşındı mı? */
  function hasCanonicalSlug(playerId) {
    return slugById.has(resolveId(playerId));
  }

  /**
   * Sayfanın site köküne göre yolu (uzantılı).
   * "futbolcu/victor-osimhen.html" ya da "oyuncular/<id>.html"
   */
  function playerPagePath(playerId) {
    const id = resolveId(playerId);
    const slug = slugById.get(id);
    return slug ? `${CANONICAL_DIR}/${slug}.html` : `${LEGACY_DIR}/${id}.html`;
  }

  /**
   * Bağlantı adresi.
   *
   * @param {string|object} player kimlik ya da kayıt
   * @param {string} [basePrefix] üreten sayfadan köke giden yol ("../", "./")
   */
  function playerHref(player, basePrefix = "./") {
    const id = typeof player === "string" ? player : (player && player.id);
    // Görev 5, 4. aşama: bağlantı artık 301 kaynağı olan `futbolcu/x.html`
    // yerine doğrudan kanonik (uzantısız) adrese verilir. Dosya yolu için
    // `playerPagePath` kullanılmaya devam eder.
    return playerCanonicalHref(player, basePrefix);
  }

  /**
   * KANONİK BAĞLANTI ADRESİ (uzantısız).
   *
   * `playerHref` dosya yolunu (`futbolcu/x.html`) döndürür; o adres
   * vercel.json'da `/futbolcu/:slug.html → /futbolcu/:slug` ile 301'lenir.
   * Bu fonksiyon doğrudan son adresi verir (`playerCanonicalUrl` ile aynı
   * kural). Taşınmamış oyuncunun `oyuncular/<id>.html` adresi 301'li
   * olmadığı için olduğu gibi kalır. Üreticiler sonraki aşamalarda buna
   * geçecek; `playerHref` şimdilik değişmiyor (çıktı farkı yaratmamak için).
   */
  function playerCanonicalHref(player, basePrefix = "./") {
    const id = typeof player === "string" ? player : (player && player.id);
    if (!id) return null;
    const pagePath = playerPagePath(id);
    return `${basePrefix}${pagePath.startsWith(`${CANONICAL_DIR}/`) ? pagePath.replace(/\.html$/, "") : pagePath}`;
  }

  /**
   * SAYFADA GÖRÜNEN AD.
   *
   * Adres `/futbolcu/victor-osimhen` iken sayfanın "V. Osimhen" demesi
   * tutarsız: adresi tam ada taşıyıp başlığı kısaltmalı bırakmak, aramadan
   * gelen okuyucuya iki ayrı ad gösterir. Tam ad biliniyorsa başlık, H1 ve
   * bölüm başlıkları da onu kullanır — aynı, kaynaklı addan.
   */
  function playerDisplayName(player) {
    const id = typeof player === "string" ? player : (player && player.id);
    const fallback = typeof player === "string" ? null : (player && player.name);
    return fullNameById.get(resolveId(id)) || fallback || null;
  }

  /**
   * Sayfa dosyasının slug'ı — dizinsiz, uzantısız.
   *
   * İngilizce sayfalar `en/player/<slug>.html` biçiminde ve aynı slug'ı
   * kullanıyor; TR ile EN'in ayrı slug mantıkları olsaydı hreflang çifti
   * ve kanonik adres birbirinden kopardı.
   */
  function slugFor(playerId) {
    return playerPagePath(playerId).replace(/^.*\//, "").replace(/\.html$/, "");
  }

  /** İngilizce sayfanın köke göre yolu. */
  function enPlayerPagePath(playerId) {
    return `en/player/${slugFor(playerId)}.html`;
  }

  /** Site haritası ve canonical için mutlak adres. */
  function playerCanonicalUrl(playerId, domain = "https://www.futbolradar.com") {
    // TEMİZ ADRES: taşınan sayfanın kanonik hâli uzantısızdır
    // (`/futbolcu/victor-osimhen`). Eski dizindeki sayfalar `.html`
    // uzantısını korur — o adresler zaten indekslenmiş hâlleriyle kalıyor.
    const pagePath = playerPagePath(playerId);
    return pagePath.startsWith(`${CANONICAL_DIR}/`)
      ? `${domain}/${pagePath.replace(/\.html$/, "")}`
      : `${domain}/${pagePath}`;
  }

/**
   * VERİYE GÖMÜLÜ ESKİ YOLU GÜNCEL ADRESE ÇEVİRİR.
   *
   * Bazı veri dosyaları (ör. data/match-specials.json) oyuncu profilinin
   * yolunu kimlik yerine DİZGE olarak saklıyor. Adres taşındığında o
   * dizgeler bayatlıyor ve veri dosyasını her taşımada elle güncellemek
   * gerekiyordu. Bunun yerine yol, kullanıldığı anda yeniden çözülür:
   * dosyada ne yazdığı değil, oyuncunun bugün nerede olduğu geçerlidir.
   *
   * Tanınmayan bir yol olduğu gibi döner — bu modül yol uydurmaz.
   */
  function refreshPagePath(storedPath) {
    const raw = String(storedPath || "");
    const match = /^(?:\.\/)?(oyuncular|futbolcu|en\/player)\/([a-z0-9-]+)\.html$/.exec(raw);
    if (!match) return raw;

    const [, dir, id] = match;
    return dir === "en/player" ? enPlayerPagePath(id) : playerPagePath(id);
  }

  /** Taşınan kayıtlar: eski yol → yeni yol (301 kaynağı). */
  function movedPaths() {
    const moved = [];
    for (const [id, slug] of slugById) {
      moved.push({ from: `${LEGACY_DIR}/${id}.html`, to: `${CANONICAL_DIR}/${slug}.html`, id, slug });
    }
    for (const [aliasId, canonicalId] of canonicalByAlias) {
      const slug = slugById.get(canonicalId);
      if (!slug) continue;
      moved.push({ from: `${LEGACY_DIR}/${aliasId}.html`, to: `${CANONICAL_DIR}/${slug}.html`, id: aliasId, slug });
    }
    return moved.sort((left, right) => left.from.localeCompare(right.from));
  }

  return {
    CANONICAL_DIR,
    LEGACY_DIR,
    enPlayerPagePath,
    hasCanonicalSlug,
    movedPaths,
    playerCanonicalUrl,
    playerDisplayName,
    playerCanonicalHref,
    playerHref,
    playerPagePath,
    refreshPagePath,
    resolveId,
    slugFor,
    slugById,
    size: slugById.size
  };
}

module.exports = { CANONICAL_DIR, LEGACY_DIR, createPlayerUrlResolver };
