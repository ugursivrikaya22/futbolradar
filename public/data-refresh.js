(function () {
  "use strict";
  var locale = document.documentElement.lang === "en" ? "en" : document.documentElement.lang === "tr" ? "tr" : null;
  if (!locale) return;
  var english = locale === "en";

  /**
   * DİLE BAĞLI METİNLER TEK YERDE.
   *
   * Tablo ve canlı katman iki dilde aynı; yalnızca okuyucuya görünen
   * metinler ve tarih biçimi değişiyor. Bunları çizim kodunun içine
   * dağıtmak, bir dilde düzeltilen bir ifadenin diğerinde eski kalması
   * demekti.
   */
  var TEXT = english ? {
    updated: "Last updated: ",
    waiting: "Last updated: Awaiting update.",
    liveNote: "Live matches are included provisionally.",
    badge: "LIVE",
    badgeTitle: "Includes a match in progress",
    dateLocale: "en-GB",
    timeZone: "Europe/Istanbul",
    timeSuffix: " TRT"
  } : {
    updated: "Son güncelleme: ",
    waiting: "Son güncelleme: Güncelleme bekleniyor.",
    liveNote: "Canlı maçlar geçici olarak dahil edildi.",
    badge: "CANLI",
    badgeTitle: "Devam eden maç dahil",
    dateLocale: "tr-TR",
    timeZone: "Europe/Istanbul",
    timeSuffix: " TSİ"
  };

  /**
   * İNGİLİZCE SAYFA ADRESİ → KATALOG KİMLİĞİ.
   *
   * Kaynağı `scripts/lib/standingsCatalog.mjs`teki `slugEn` alanları.
   * Elle yazılı olması, istemcinin derleme verisine bağımlı olmamasını
   * sağlıyor; `scripts/test-live-standings.mjs` bu haritayı katalogla
   * karşılaştırıyor, yani ayrışırsa test düşer.
   */
  var EN_LEAGUE_BY_SLUG = {
    "premier-league-standings": "premier-league",
    "champions-league-standings": "sampiyonlar-ligi",
    "la-liga-standings": "la-liga",
    "serie-a-standings": "serie-a",
    "bundesliga-standings": "bundesliga",
    "super-lig-standings": "super-lig",
    "ligue-1-standings": "ligue-1",
    "europa-league-standings": "avrupa-ligi",
    "conference-league-standings": "konferans-ligi"
  };

  var path = location.pathname.replace(/\.html$/, "").replace(/^\//, "");
  var league;
  var isStandingsPage;
  if (english) {
    var enSlug = path.replace(/^en\//, "");
    league = EN_LEAGUE_BY_SLUG[enSlug] || null;
    isStandingsPage = Boolean(league);
  } else {
    league = path.replace(/-puan-durumu$/, "");
    var leagueAliases = { "premier-lig": "premier-league" };
    league = leagueAliases[league] || league;
    isStandingsPage = /-puan-durumu$/.test(path);
  }
  var table = isStandingsPage ? document.querySelector(".evergreen-table tbody") : null;
  var panels = Array.from(document.querySelectorAll('.standings-tabs__panel[id^="standings-panel-"]'));
  // Takım sayfalarındaki ("/galatasaray-puan-durumu") kompakt tablo. Bu
  // yüzey bugüne kadar hiç tazelenmiyordu: derleme anındaki satırlarla
  // kalıyordu. Süper Lig tablosunu gösteriyor.
  // NİTELİK ELEMANIN KENDİSİNDE. Üretilen takım sayfasında
  // `data-api-target="standings"` ile `.table-body` AYNI div'de
  // (`galatasaray-puan-durumu.html`); alt seçici null dönüyordu ve dört takım
  // sayfası canlı katmanı hiç almıyordu. `data-highlight-team` koşulu,
  // merkezdeki `puan-durumu.html` yüzeyini app.js'in sahipliğinde bırakır.
  var teamBody = document.querySelector('.table-body[data-api-target="standings"][data-highlight-team], [data-api-target="standings"][data-highlight-team] .table-body');
  var leaderMetric = path === "gol-kralligi" ? "goals" : path === "asist-kralligi" ? "assists" : null;
  var leadersTable = leaderMetric ? document.querySelector(".evergreen-table tbody") : null;
  // Lider listeleri bu turda yalnızca Türkçe (yukarıdaki nota bakınız).
  var homeLeaders = english ? null : document.querySelector('[data-api-target="leaders-scorers"], [data-api-target="leaders-assists"]');
  if (leadersTable) table = null;
  if (!table && !panels.length && !teamBody && !leadersTable && !homeLeaders) return;

  // Takım bağlantıları derlemede üretilen haritadan okunur. Süper Lig dahil
  // her lig aynı sağlayıcı kimliğini kullanır. Harita gelmeden tablo
  // yeniden çizilirse statik bağlantılar silinirdi.
  var links = { byId: {}, byName: {} };
  var linkGate = fetch("/data/standings-team-links.json", { cache: "no-store" }).then(function (response) {
    return response.ok ? response.json() : null;
  }).catch(function () { return null; }).then(function (payload) {
    if (payload && payload.byId) links = payload;
  });
  function nameKey(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function teamHref(row) {
    var id = String((row && (row.providerId || row.id)) || "");
    var hit = (id && links.byId[id]) || links.byName[nameKey(row && (row.name || row.team))];
    if (!hit) return "";
    var path = english ? hit.en : hit.tr;
    return path ? String(path) : "";
  }
  function teamLabel(row) {
    var name = html(row.name || row.team);
    var href = teamHref(row);
    return href
      ? '<a class="standings-team-link" href="' + html(href) + '" style="display:inline-flex;align-items:center;min-height:32px">' + name + "</a>"
      : name;
  }

  function html(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function number(value) { return value == null ? "—" : html(value); }
  function stamp(target, value, live) {
    var element = target.querySelector("[data-resource-updated]");
    if (!element) {
      element = document.createElement("p");
      element.className = "data-stamp";
      element.setAttribute("data-resource-updated", "");
      target.appendChild(element);
    }
    var date = new Date(value || "");
    var text = Number.isFinite(date.getTime())
      ? TEXT.updated + '<time datetime="' + html(date.toISOString()) + '">' + html(date.toLocaleString(TEXT.dateLocale, { timeZone: TEXT.timeZone })) + TEXT.timeSuffix + "</time>"
      : TEXT.waiting;
    // CANLI MAÇ VARKEN TABLO RESMÎ DEĞİLDİR VE BUNU SÖYLER. Aksi hâlde
    // okuyucu, sürmekte olan maçın etkisini resmî sonuç sanar.
    element.innerHTML = text + (live ? ' <span class="standings-live-note">' + html(TEXT.liveNote) + "</span>" : "");
    var old = document.querySelector(".evergreen-freshness time");
    if (table && old && Number.isFinite(date.getTime())) { old.dateTime = date.toISOString(); old.textContent = element.textContent; }
  }
  var requests = Object.create(null);
  /**
   * @param {string} url
   * @param {boolean} [force] önbelleği atla. Maç bittiği anda resmî tabloyu
   *   yeniden sormak için gerekiyor: 60 saniyelik paylaşım penceresi,
   *   "geçici"den "resmî"ye geçişi bir dakika geciktiriyordu.
   */
  function json(url, force) {
    var previous = requests[url];
    if (!force && previous && Date.now() - previous.startedAt < 60000) return previous.promise;
    var promise = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then(function (r) {
      if (!r.ok) throw new Error("data-unavailable");
      return r.json();
    }).then(function (payload) {
      if (payload.ok === false) throw new Error("data-unavailable");
      return payload;
    });
    // Reusing a response never changes its source timestamp. Tab switches
    // and visibility events share the same request within the polling period.
    requests[url] = { startedAt: Date.now(), promise: promise };
    return promise;
  }

  // ————————————————————————————————————————————————————————————————
  // CANLI KATMAN
  //
  // Tablonun TEK SAHİBİ bu dosya. Resmî satırlar ve canlı maçlar ayrı
  // tutulur, çizim anında `live-standings-core.js` ile birleştirilir;
  // böylece iki ayrı yazıcı aynı DOM'a yazıp birbirini ezmez.
  // ————————————————————————————————————————————————————————————————
  var core = window.FutbolRadarLiveStandings || null;
  var liveMatches = [];
  var leagueState = Object.create(null);
  // Resmî tabloya girdiği DOĞRULANMIŞ maçlar (lig ayrımı gözetmeden).
  var settledIds = Object.create(null);

  function stateFor(id) {
    if (!leagueState[id]) leagueState[id] = { official: [], updatedAt: null, baselines: {}, settled: [], awaitingOfficial: [], settleTimer: null };
    return leagueState[id];
  }

  /**
   * Bir ligin gösterilecek satırları: resmî tablo + canlı maçların geçici
   * etkisi. Çekirdek yüklenemediyse resmî tablo olduğu gibi döner — canlı
   * katman bir EK; yokluğu sayfayı bozmaz.
   */
  function viewRows(id) {
    var state = stateFor(id);
    if (!core || !state.official.length) return { rows: state.official, live: false };

    var merged = core.applyLiveMatches(state.official, liveMatches, {
      leagueIds: leagueNamesOf(id),
      settledMatchIds: state.settled
    });

    // Uygulanan her maç için temel değer bir kez kaydedilir; resmî tablo
    // o maçı saymaya başladığında geçici etki bırakılır (bkz. çekirdekteki
    // settledMatchIds).
    merged.appliedMatchIds.forEach(function (entry) {
      if (!state.baselines[entry.id]) {
        var match = liveMatches.filter(function (item) { return String(item.id) === entry.id; })[0];
        var baseline = match && core.baselineFor(match, state.official);
        if (baseline) state.baselines[entry.id] = baseline;
      }
      // MAÇ BİTTİ: resmî tablo artık bu maçı sayabilir. Bir sonraki 60
      // saniyelik turu beklemek, biten bir maçı gereksiz yere "canlı"
      // göstermek demek; kısa bir gecikmeyle resmî tablo yeniden sorulur.
      if (entry.kind === "final" && state.awaitingOfficial.indexOf(entry.id) === -1) {
        state.awaitingOfficial.push(entry.id);
        scheduleSettlementCheck(id);
      }
    });

    return { rows: merged.rows, live: merged.appliedMatchIds.length > 0 };
  }

  // YEDEK SAĞLAYICI KİMLİK TAŞIMIYOR. `services/providers/footballProvider.js`
  // canlı maça yalnızca yarışmanın ADInı yazıyor (`league`); kimlik alanı yok.
  // Kupaların adı burada olmayınca Şampiyonlar Ligi maçı "başka lig" diye
  // eleniyor ve o sayfa hiç oynamıyordu. Her kimlik için bilinen adların
  // TAMAMI aday olarak veriliyor.
  var leagueNames = {
    "super-lig": ["Süper Lig", "Trendyol Süper Lig", "Super Lig"],
    "1-lig": ["Trendyol 1. Lig", "1. Lig", "TFF First League"],
    "premier-league": ["Premier League", "Premier Lig"],
    "la-liga": ["La Liga", "Primera Division", "LaLiga"],
    "serie-a": ["Serie A"],
    "bundesliga": ["Bundesliga"],
    "ligue-1": ["Ligue 1"],
    "sampiyonlar-ligi": ["UEFA Champions League", "Champions League", "Şampiyonlar Ligi"],
    "avrupa-ligi": ["UEFA Europa League", "Europa League", "Avrupa Ligi"],
    "konferans-ligi": ["UEFA Europa Conference League", "UEFA Conference League", "Conference League", "Konferans Ligi"]
  };
  function leagueNamesOf(id) { return [id].concat(leagueNames[id] || []); }

  function liveAttrs(row) {
    return row && row.live ? ' data-standings-live="true"' : "";
  }
  function liveBadge(row) {
    return row && row.live
      ? '<span class="standings-live-badge" title="' + html(TEXT.badgeTitle) + '">' + html(TEXT.badge) + "</span>"
      : "";
  }

  // ————————————————————————————————————————————————————————————————

  function standingCells(row) {
    return ["played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "goalDifference", "points"].map(function (key) { return "<td>" + number(row[key]) + "</td>"; }).join("");
  }
  function validStandings(rows) {
    return Array.isArray(rows) && rows.length > 0 && rows.every(function (row) {
      return (row.name || row.team) && Number.isFinite(row.points) && Number.isFinite(row.rank) &&
        row.played === row.won + row.drawn + row.lost && row.goalDifference === row.goalsFor - row.goalsAgainst;
    }) && new Set(rows.map(function (row) { return row.rank; })).size === rows.length;
  }

  function renderFullTable(view) {
    table.innerHTML = view.rows.map(function (row) {
      return "<tr" + liveAttrs(row) + "><td>" + number(row.rank) + '</td><th scope="row">' + teamLabel(row) + liveBadge(row) + "</th>" + standingCells(row) + "</tr>";
    }).join("");
  }

  function renderPanel(panel, id, view) {
    var body = panel.querySelector(".standings-tabs__body");
    if (!body) return;
    body.innerHTML = view.rows.slice(0, 5).map(function (row) {
      var name = html(row.name || row.team);
      var href = teamHref(row);
      var teamOpen = href ? '<a class="home-standing-team" href="' + html(href) + '">' : '<span class="home-standing-team">';
      var teamClose = href ? "</a>" : "</span>";
      var logo = row.logo && /^https:\/\//.test(row.logo) ? '<img class="home-standing-logo" src="' + html(row.logo) + '" alt="" width="22" height="22" loading="lazy">' : '<span class="home-standing-logo home-standing-logo-fallback" aria-hidden="true">' + name.charAt(0) + '</span>';
      return '<div class="home-standing-row" data-card="standing-row" data-team="' + html(row.id) + '"' + liveAttrs(row) + '><span class="home-standing-rank">' + number(row.rank) + '</span>' + teamOpen + logo + '<b>' + name + '</b>' + liveBadge(row) + teamClose +
        ["played", "won", "drawn", "lost"].map(function (key) { return '<span>' + number(row[key]) + '</span>'; }).join("") + '<span class="home-standing-gd">' + (row.goalDifference > 0 ? "+" : "") + number(row.goalDifference) + '</span><span class="home-standing-points">' + number(row.points) + '</span></div>';
    }).join("");
  }

  function renderTeamBody(view) {
    var highlight = teamBody.getAttribute("data-highlight-team") || "";
    teamBody.innerHTML = view.rows.map(function (row) {
      var featured = highlight && String(row.id) === highlight ? " is-featured-team" : "";
      return '<div class="table-row' + featured + '" data-card="standing-row" data-team="' + html(row.id) + '"' + liveAttrs(row) + '>' +
        "<span>" + number(row.rank) + "</span>" +
        "<b>" + html(row.name || row.team) + liveBadge(row) + "</b>" +
        "<span>" + number(row.played) + "</span>" +
        "<span>" + number(row.points) + "</span>" +
        "<span>" + (row.goalDifference > 0 ? "+" : "") + number(row.goalDifference) + "</span>" +
        "<span>" + number(row.momentum) + "</span>" +
        "</div>";
    }).join("");
  }

  function paintLeague(id) {
    var state = stateFor(id);
    if (!state.official.length) return;
    var view = viewRows(id);

    if (table && id === league) {
      renderFullTable(view);
      stamp(table.closest("section"), state.updatedAt, view.live);
    }
    if (teamBody && id === "super-lig") {
      renderTeamBody(view);
    }
    panels.forEach(function (panel) {
      if (panel.id.replace("standings-panel-", "") !== id) return;
      renderPanel(panel, id, view);
      stamp(panel, state.updatedAt, view.live);
    });
  }

  /**
   * Biten maçın resmî tabloya girip girmediğini kısa aralıklarla sorar.
   *
   * Sağlayıcı tabloyu maç bitiminde hemen güncellemiyor; bu yüzden tek bir
   * deneme yetmez. Deneme sayısı sınırlı: tablo hiç güncellenmezse geçici
   * etki zaten doğru olanı gösteriyor ve 60 saniyelik normal tur devam
   * ediyor — süresiz istek üretmenin anlamı yok.
   */
  var SETTLE_DELAY_MS = 5000;
  var SETTLE_ATTEMPTS = 6;
  function scheduleSettlementCheck(id) {
    var state = stateFor(id);
    if (state.settleTimer) return;
    var attempts = 0;
    state.settleTimer = window.setInterval(function () {
      attempts += 1;
      var pending = state.awaitingOfficial.filter(function (matchId) {
        return state.settled.indexOf(matchId) === -1;
      });
      if (!pending.length || attempts >= SETTLE_ATTEMPTS || document.hidden) {
        window.clearInterval(state.settleTimer);
        state.settleTimer = null;
        return;
      }
      refreshStanding(id, true);
    }, SETTLE_DELAY_MS);
  }

  function refreshStanding(id, force) {
    return json("/api/standings?league=" + encodeURIComponent(id), force).then(function (payload) {
      var rows = payload.data;
      if (!validStandings(rows)) throw new Error("invalid-standings");
      rows.sort(function (a, b) { return a.rank - b.rank; });
      var state = stateFor(id);
      state.official = rows;
      state.updatedAt = payload.updatedAt;
      // Resmî tablo tazelendi: hangi canlı maçın artık gerekmediğini burada
      // öğreniyoruz. Bu olmadan biten bir maç iki kez sayılırdı.
      if (core) {
        state.settled = core.settledMatchIds(state.baselines, rows);
        state.settled.forEach(function (matchId) { settledIds[String(matchId)] = true; });
      }
      paintLeague(id);
    });
  }

  function nameOf(row) {
    return row.slug && /^[a-z0-9-]+$/.test(row.slug) ? '<a href="./oyuncular/' + row.slug + '.html">' + html(row.name) + '</a>' : '<span>' + html(row.name) + '</span>';
  }
  function refreshLeaders() {
    return json("/data/league-leaders.json").then(function (payload) {
      var now = new Date();
      var season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      var current = String(payload.season).slice(0, 4) === String(season);
      ["goals", "assists"].forEach(function (metric) {
        var rows = current ? payload[metric === "goals" ? "topScorers" : "topAssists"] : [];
        if (!Array.isArray(rows)) throw new Error("invalid-leaders");
        var target = document.querySelector('[data-api-target="leaders-' + (metric === "goals" ? "scorers" : "assists") + '"]');
        if (target) {
          target.innerHTML = '<ol class="leaders-list">' + rows.slice(0, 5).map(function (row, index) {
            return '<li class="leaders-row" data-card="leader-player"><span class="leaders-rank">' + (index + 1) + '</span><span class="leaders-name"><strong>' + nameOf(row) + '</strong><span>' + html(row.team) + '</span></span><span class="leaders-value">' + number(row[metric]) + '<small>' + (metric === "goals" ? "Gol" : "Asist") + '</small></span></li>';
          }).join("") + '</ol>';
          stamp(target, payload.updatedAt || payload.generatedAt);
        }
        if (leadersTable && leaderMetric === metric) {
          leadersTable.innerHTML = rows.map(function (row, index) {
            var logo = row.teamLogo && /^https:\/\//.test(row.teamLogo) ? '<img class="home-standing-logo" src="' + html(row.teamLogo) + '" alt="" width="20" height="20">' : "";
            return '<tr><td>' + (index + 1) + '</td><th scope="row">' + nameOf(row) + '</th><td><span class="home-standing-team">' + logo + '<span>' + html(row.team) + '</span></span></td><td><strong>' + number(row[metric]) + '</strong></td><td>' + number(row.appearances) + '</td></tr>';
          }).join("");
          stamp(leadersTable.closest("section"), payload.updatedAt || payload.generatedAt);
        }
      });
    });
  }

  /** Sayfadaki tüm puan durumu yüzeylerinin lig kimlikleri. */
  function activeLeagueIds() {
    var ids = [];
    panels.forEach(function (panel) {
      var radio = document.getElementById(panel.id.replace("standings-panel-", "standings-tab-"));
      var visible = radio ? radio.checked : !panel.hidden;
      if (visible) ids.push(panel.id.replace("standings-panel-", ""));
    });
    if (table) ids.push(league);
    if (teamBody) ids.push("super-lig");
    return ids.filter(function (id, index) { return id && ids.indexOf(id) === index; });
  }

  function refresh() {
    return linkGate.then(function () {
    if (document.hidden) return;
    var jobs = activeLeagueIds().map(refreshStanding);
    // Lider listeleri (gol/asist) Türkçe etiketler basıyor; İngilizce
    // yüzeyde çalıştırmak "Gol"/"Asist" yazmak demekti. Bu tur yalnızca
    // puan durumunu iki dile açıyor.
    if (!english && (leadersTable || homeLeaders)) jobs.push(refreshLeaders());
    Promise.allSettled(jobs);
    });
  }

  // ————————————————————————————————————————————————————————————————
  // CANLI SKOR AKIŞI
  //
  // Sunucu tarafındaki tek yoklayıcı (services/liveScoreStream.js) bütün
  // abonelere aynı anlık görüntüyü basıyor; bu sayfa fazladan sağlayıcı
  // isteği üretmez. EventSource yoksa ya da bağlantı düşerse düşük
  // frekanslı yedek yoklamaya geçilir.
  // ————————————————————————————————————————————————————————————————
  var FALLBACK_POLL_MS = 30000;
  var stream = null;
  var fallbackTimer = null;
  // Akıştan düşmüş ama resmî tabloya henüz girmemiş maçlar.
  var retained = Object.create(null);

  function paintAll() {
    activeLeagueIds().forEach(paintLeague);
  }

  /**
   * AKIŞ YALNIZCA OYNANAN MAÇI TAŞIYOR.
   *
   * Sunucudaki hub paketi `isLiveMatch` ile süzüyor
   * (`services/liveScoreStream.js`): maç bitince FT olarak GELMİYOR, paketten
   * DÜŞÜYOR. Etkisini o anda bırakmak tabloyu geri götürürdü — resmî tablo o
   * maçı ancak bir sonraki senkronda sayıyor. Bu yüzden düşen maçın son
   * görülen hâli "bitmiş" olarak saklanıyor; resmî tablo onu saydığı an
   * (`settledIds`) bırakılıyor.
   */
  function acceptMatches(matches) {
    if (!Array.isArray(matches)) return;
    var incoming = Object.create(null);
    matches.forEach(function (match) {
      var id = match && match.id !== null && match.id !== undefined ? String(match.id) : "";
      if (id) incoming[id] = true;
    });
    liveMatches.forEach(function (match) {
      var id = match && match.id !== null && match.id !== undefined ? String(match.id) : "";
      if (!id || incoming[id] || retained[id] || settledIds[id]) return;
      var copy = {};
      Object.keys(match).forEach(function (key) { copy[key] = match[key]; });
      copy.status = "FT";
      copy.providerStatus = "FT";
      copy.live = false;
      retained[id] = copy;
    });
    var carried = Object.keys(retained).filter(function (id) {
      if (incoming[id] || settledIds[id]) { delete retained[id]; return false; }
      return true;
    }).map(function (id) { return retained[id]; });
    liveMatches = matches.concat(carried);
    paintAll();
  }

  function handleSnapshot(event) {
    var payload = null;
    try { payload = JSON.parse(event.data); } catch (error) { return; }
    acceptMatches((payload && payload.matches) || []);
  }

  function stopStream() {
    if (connectTimer) { window.clearTimeout(connectTimer); connectTimer = null; }
    if (stream) { stream.close(); stream = null; }
  }

  function scheduleFallback() {
    if (fallbackTimer) return;
    fallbackTimer = window.setInterval(function () {
      if (document.hidden) return;
      // 60 saniyelik paylaşım önbelleği olmadan: yedek yoklama 30 saniyede bir
      // koşuyor, önbellek her ikinci turu aynı yanıtla geçiştiriyordu.
      json("/api/matches?live=all", true).then(function (payload) {
        acceptMatches((payload && payload.data) || []);
      }).catch(function () { /* canlı katman yoksa resmî tablo durur */ });
    }, FALLBACK_POLL_MS);
  }

  /**
   * AKIŞ AÇMANIN BİR BEDELİ VAR.
   *
   * Uç nokta istemci başına dakikada 30 bağlantı kabul ediyor
   * (server/liveScoreStreamRoute.js). Katman her puan durumu yüzeyinde
   * KOŞULSUZ bağlanınca, sayfalar arasında hızlı gezinen bir okuyucu
   * (ve tıklanabilirlik denetimi) o sınırı aşıp 429 alıyordu: hem konsola
   * hata düşüyor hem de sunucuya, kimsenin okumadığı sayfalar için
   * bağlantı açılıyordu.
   *
   * Üç kural bunu kapatıyor:
   *
   *   1. OYALANMA ŞARTI. Sayfa en az DWELL_MS boyunca açık ve görünür
   *      kalmadan bağlanılmaz. İçinden geçilen sayfa hiç bağlantı açmaz —
   *      zaten canlı tabloyu göremeyecek kadar kısa duruluyor.
   *   2. TEK AKIŞ. Sayfada `app.js` varsa canlı skor akışını o zaten
   *      açıyor; ikinci bir bağlantı aynı paketi iki kez çekmek olurdu.
   *   3. HATADA YENİDEN DENEME YOK. Akış düşerse (429 dahil) yedek
   *      yoklamaya geçilir ve sayfa ömrü boyunca tekrar denenmez; aksi
   *      hâlde sınırı aşan istemci hata fırtınası üretir.
   */
  var DWELL_MS = 2500;
  var streamDisabled = false;
  var connectTimer = null;

  function appOwnsStream() {
    return Boolean(document.querySelector('script[src*="app.js"]'));
  }

  /**
   * SAHİBİ APP.JS OLAN SAYFADA PAKET ONDAN GELİR.
   *
   * `app.js` aldığı her anlık görüntüyü `futbolradar:score-snapshot` olarak
   * yayımlıyor. Bunu dinlemeyip yoklamaya düşmek, aynı veriyi ikinci kez
   * istemek ve tabloyu yarım dakika geriden göstermek olurdu. Paket
   * gelmiyorsa (app.js akışı hiç açmadıysa) yedek yoklama yine devreye
   * giriyor — sessizce durmuyor.
   */
  var APP_SNAPSHOT_GRACE_MS = 20000;
  var appSnapshotSeen = false;
  document.addEventListener("futbolradar:score-snapshot", function (event) {
    var packet = event && event.detail;
    if (!packet) return;
    appSnapshotSeen = true;
    if (fallbackTimer) { window.clearInterval(fallbackTimer); fallbackTimer = null; }
    acceptMatches(Array.isArray(packet.matches) ? packet.matches : []);
  });
  function awaitAppSnapshot() {
    window.setTimeout(function () {
      if (!appSnapshotSeen) scheduleFallback();
    }, APP_SNAPSHOT_GRACE_MS);
  }

  function openStream() {
    connectTimer = null;
    if (!core || stream || streamDisabled || document.hidden) return;
    if (appOwnsStream()) return awaitAppSnapshot();
    if (!window.EventSource) return scheduleFallback();
    stream = new EventSource("/api/live-score-stream");
    stream.addEventListener("snapshot", handleSnapshot);
    stream.addEventListener("stream-end", function () { stopStream(); connectStream(); });
    stream.onerror = function () {
      stopStream();
      streamDisabled = true;
      scheduleFallback();
    };
  }

  function connectStream() {
    if (!core || stream || streamDisabled || document.hidden || connectTimer) return;
    if (appOwnsStream()) return awaitAppSnapshot();
    if (!window.EventSource) return scheduleFallback();
    connectTimer = window.setTimeout(openStream, DWELL_MS);
  }

  document.querySelectorAll(".standings-tabs__radio").forEach(function (radio) {
    radio.addEventListener("change", refresh);
  });
  refresh();
  window.setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", function () {
    refresh();
    if (document.hidden) { stopStream(); return; }
    connectStream();
    // Sekme arkaplandayken yerleşme yoklaması duruyor; dönüşte yeniden
    // kurulmazsa biten maç "canlı" rozetiyle bir sonraki tura kadar kalırdı.
    Object.keys(leagueState).forEach(function (id) {
      if (leagueState[id].awaitingOfficial.length) scheduleSettlementCheck(id);
    });
  });
  connectStream();
}());
