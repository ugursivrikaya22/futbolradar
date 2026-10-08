(function () {
  "use strict";

  var FOLLOW_STORAGE_KEY = "futbolradar:followed-matches:v1";
  var PREFERENCES_KEY = 'futbolradar:notification-preferences:v1';
  var preferences = { goal: true, red_card: true, kickoff: true, halftime: true, fulltime: true, sound: false };
  var audioContext = null;
  function eventAllowed(event) {
    var group = /^(goal|var|penalty_scored|score_update|score_correction)$/.test(event.type) ? 'goal' : event.type;
    return preferences[group] === true;
  }
  function loadPreferences() {
    try {
      var saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
      Object.keys(preferences).forEach(function (key) { if (typeof saved[key] === 'boolean') preferences[key] = saved[key]; });
    } catch (_) {}
  }
  var MAX_FOLLOWED_MATCHES = 20;
  var MAX_SEEN_EVENTS = 600;
  var TOAST_LIFETIME_MS = 7000;
  var EVENT_UI = {};

  var EN = document.documentElement.lang.toLowerCase().indexOf('en') === 0;
  function tr(a, b) { return EN ? b : a; }
  var EXPLANATION = tr('Bu maçın gol ve önemli gelişmeleri, site açıkken ekranın altında gösterilecek.', 'Goals and important events for this match will appear at the bottom while the site is open.');
  var enabled = false, polling = false, queue = [], baselines = new Map(), freshMatches = new Set();
  var moduleBase = new URL('.', document.currentScript.src);
  var identityAliases = {}, identitiesLoaded = false;
  var followed = new Map();
  var seenEvents = new Map();

  var reconnectTimer = null;
  var connectionState = "idle";
  var followPanel = null;
  var toastRoot = null;
  var domSyncFrame = null;

  function safeJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function safeHref(value) {
    var raw = String(value || "");
    if (!raw) return "./mac-detay.html";
    try {
      var url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return "./mac-detay.html";
      return url.pathname + url.search + url.hash;
    } catch (error) {
      return "./mac-detay.html";
    }
  }

  function normalizeRecord(record) {
    var id = cleanText(record && record.id);
    if (!id) return null;
    return {
      id: id,
      homeTeam: cleanText(record.homeTeam) || "Ev sahibi",
      awayTeam: cleanText(record.awayTeam) || "Deplasman",
      href: safeHref(record.href),
      aliases: Array.isArray(record.aliases) ? record.aliases.map(String).slice(0,8) : [],
      finishedAt: Number(record.finishedAt) || null,
      followedAt: Number(record.followedAt) || Date.now()
    };
  }

  function loadState() {
    loadPreferences();
    try {
      var storedMatches = safeJson(window.localStorage.getItem(FOLLOW_STORAGE_KEY), []);
      (Array.isArray(storedMatches) ? storedMatches : []).slice(0, MAX_FOLLOWED_MATCHES).forEach(function (record) {
        var normalized = normalizeRecord(typeof record === "string" ? { id: record } : record);
        if (normalized && (!normalized.finishedAt || Date.now() - normalized.finishedAt <= 86400000)) followed.set(normalized.id, normalized);
      });

    } catch (error) {
      // Storage can be disabled; the in-memory state remains usable.
    }
  }

  function persistState() {
    var records = Array.from(followed.values());
    try {
      window.localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(records));
    } catch (error) {
      // The current tab still works when persistent storage is unavailable.
    }

  }

  function subscriptionId(id) {
    id = String(id || '');
    if (followed.has(id)) return id;
    for (var record of followed.values()) if ((record.aliases || []).includes(id) || (identityAliases[id] && identityAliases[id] === identityAliases[record.id])) return record.id;
    return id;
  }
  function sharedId(m) {
    var candidates = [String(m.id || '')];
    if (m.providerIds && m.providerIds.apiFootball) candidates.push(String(m.providerIds.apiFootball));
    if (m.source === 'api-football' && m.providerId) candidates.push(String(m.providerId));
    for (var id of candidates) { var key = subscriptionId(id); if (followed.has(key)) return key; }
    return candidates[0];
  }
  function readNodeRecord(node) {
    if (!node) return null;
    var id = cleanText(node.getAttribute("data-follow-match") || node.getAttribute("data-match"));
    var root = node.matches && node.matches("[data-match]") ? node : node.closest("[data-match]");
    if (!id && root) id = cleanText(root.getAttribute("data-match"));
    if (!id) return null;

    var source = root || node;
    var home = cleanText(source.getAttribute("data-home-team"));
    var away = cleanText(source.getAttribute("data-away-team"));
    var names;

    if (!home || !away) {
      names = source.querySelectorAll(".fixture-row-name, .live-score-team-name, .md-side-name, .hmc-team-name");
      home = home || cleanText(names[0] && names[0].textContent);
      away = away || cleanText(names[1] && names[1].textContent);
    }

    if (!home || !away) {
      var inline = source.querySelector('.live-score-team-name-inline');
      var pair = inline ? cleanText(inline.textContent).split(' - ') : [];
      home = home || pair[0]; away = away || pair[1];
    }
    var link = source.querySelector(".fixture-card-action, .match-actions a, .detail-link");
    return normalizeRecord({
      id: id,
      homeTeam: home,
      awayTeam: away,
      href: source.getAttribute("data-match-href") || (link && link.getAttribute("href")) || "/mac-detay.html?id=" + encodeURIComponent(id)
    });
  }

  function createFollowButton(record) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "match-follow-button";
    button.setAttribute("data-follow-match", record.id);
    button.setAttribute("data-home-team", record.homeTeam);
    button.setAttribute("data-away-team", record.awayTeam);
    button.setAttribute("data-match-href", record.href);
    button.innerHTML = '<span class="match-follow-icon" aria-hidden="true">☆</span><span data-follow-label>Takibe Al</span>';
    return button;
  }

  function syncButton(button, record) {
    var active = followed.has(subscriptionId(record.id));
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute(
      "aria-label",
      record.homeTeam + " - " + record.awayTeam + (active ? " maçını takipten çıkar" : " maçını takibe al")
    );
    var label = button.querySelector("[data-follow-label]");
    var icon = button.querySelector(".match-follow-icon");
    if (label) label.textContent = active ? tr("Bildirimler açık", "Notifications on") : tr("Bildirimleri aç", "Enable notifications");
    if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="' + (active ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
    button.disabled = !enabled && !active;
    button.title = EXPLANATION;
    button.setAttribute('aria-label', record.homeTeam + ' - ' + record.awayTeam + ': ' + (active ? tr('Bildirimler açık; kapat', 'Notifications on; turn off') : tr('Bildirimleri aç', 'Enable notifications')));
    button.setAttribute('aria-description', EXPLANATION);
    var root = button.closest("[data-match]");
    if (root) root.classList.toggle("is-followed", active);
  }

  function enhanceMatchRoot(root) {
    var record = readNodeRecord(root);
    if (!record) return;
    var button = root.querySelector('.match-follow-button[data-follow-match="' + cssEscape(record.id) + '"]');

    if (!button) {
      button = createFollowButton(record);
      var detailTop = root.querySelector("[data-match-follow], .md-scoreboard-top, .msp-hero, .msp-scoreboard, .match-scoreboard, .match-analysis-hero");
      var fixtureAction = root.querySelector(".fixture-card-action");
      var matchActions = root.querySelector(".match-actions");
      if (detailTop) {
        detailTop.hidden = false;
        var detailActions = detailTop.querySelector(".md-scoreboard-actions");
        (detailActions || detailTop).appendChild(button);
      } else if (fixtureAction) {
        fixtureAction.parentNode.insertBefore(button, fixtureAction);
      } else if (matchActions) {
        matchActions.insertBefore(button, matchActions.firstChild);
      } else if (root.hasAttribute('data-match-center')) {
        root.querySelector('h1').after(button);
      } else {
        root.appendChild(button);
      }
    }
    syncButton(button, record);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function syncMatchControls(scope) {
    var root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll('[data-match-center]').forEach(function (node) {
      var params = new URLSearchParams(node.getAttribute('data-msp-query') || '');
      var id = node.getAttribute('data-match') || params.get('id') || params.get('fixtureId') || node.getAttribute('data-msp-slug');
      if (!id) return;
      node.setAttribute('data-match', id); node.setAttribute('data-home-team', node.getAttribute('data-msp-home') || ''); node.setAttribute('data-away-team', node.getAttribute('data-msp-away') || ''); node.setAttribute('data-match-href', location.href);
    });
    root.querySelectorAll('a.fixture-match-row[href]').forEach(function (link) {
      if (link.parentElement.hasAttribute('data-notification-fixture')) return;
      var url = new URL(link.href), id = url.pathname.match(/\/(?:mac|en\/match)\/([^/]+?)(?:\.html)?$/);
      if (!id) return;
      var wrapper = document.createElement('div');
      wrapper.setAttribute('data-notification-fixture', ''); wrapper.setAttribute('data-match', link.getAttribute('data-match') || decodeURIComponent(id[1]));
      wrapper.setAttribute('data-match-href', link.href);
      wrapper.setAttribute('data-home-team', cleanText(link.querySelector('.fixture-match-team-home > span:last-child')?.textContent));
      wrapper.setAttribute('data-away-team', cleanText(link.querySelector('.fixture-match-team-away > span:last-child')?.textContent));
      link.replaceWith(wrapper); wrapper.appendChild(link);
    });
    var selector = [
      '[data-notification-fixture]',
      '[data-card="today-radar-match"][data-match]',
      '[data-match-center][data-match]',
      '[data-notification-detail][data-match]',
      '.fixture-card[data-match]',
      '.live-score-card[data-match]',
      '.match-detail-card[data-match]',
      '[data-en-match-detail][data-match]',
      '[data-card="featured-match"][data-match]'
    ].join(",");
    if (root.matches && root.matches(selector)) enhanceMatchRoot(root);
    root.querySelectorAll(selector).forEach(enhanceMatchRoot);
    document.querySelectorAll(".match-follow-button[data-follow-match]").forEach(function (button) {
      var record = readNodeRecord(button);
      if (record) syncButton(button, record);
    });
  }

  function scheduleDomSync(scope) {
    if (document.hidden || domSyncFrame) return;
    domSyncFrame = window.requestAnimationFrame(function () {
      domSyncFrame = null;
      syncMatchControls(scope || document);
      // Shared page data owns the score; remembered alerts cannot repaint it.
    });
  }

  function setConnectionState(state) {
    connectionState = state;
    document.querySelectorAll("[data-follow-connection]").forEach(function (node) {
      node.setAttribute("data-state", state);
      node.setAttribute("title", feedLabel());
    });
    document.querySelectorAll('[data-follow-status]').forEach(function (node) { node.textContent = feedLabel(); });
  }
  function allSourcesFresh() {
    return followed.size > 0 && Array.from(followed.keys()).every(function (id) { var base = baselines.get(id); return base && base.fresh && Date.now() - base.sourceAt < 120000; });
  }
  function feedLabel() {
    if (!enabled) return tr('Bildirimler şu anda kullanılamıyor.', 'Notifications are currently unavailable.');
    if (!followed.size) return tr('Takip edilen maç yok.', 'No followed matches.');
    return connectionState === 'live' ? tr('Ortak verinin son güncellemeleri izleniyor.', 'Watching the latest shared data updates.') : tr('Güncel maç akışı doğrulanamadı. Gecikmiş olaylar gösterilmez.', 'Current match updates could not be verified. Delayed events are not shown.');
  }

  function injectHeaderPanel() {
    var menu = document.querySelector(".topbar-premium .nav-menu, .nav-menu");
    if (!menu || menu.querySelector("[data-follow-menu]")) return;
    var nav = menu.closest(".nav");

    var wrapper = document.createElement("div");
    wrapper.className = "follow-menu";
    wrapper.setAttribute("data-follow-menu", "");
    wrapper.innerHTML =
      '<button class="follow-menu-toggle" type="button" data-follow-panel-toggle aria-expanded="false" aria-controls="followed-matches-panel">' +
      '<span class="follow-menu-star" aria-hidden="true">🔔</span><span>' + tr('Takip:', 'Following:') + '</span><strong data-follow-count>0</strong>' +
      '<i data-follow-connection data-state="idle" aria-hidden="true"></i></button>' +
      '<div class="follow-panel" id="followed-matches-panel" data-follow-panel hidden></div>';
    var anchor = menu.querySelector(".nav-search-toggle-desktop, .theme-toggle");
    menu.insertBefore(wrapper, anchor || null);
    if (nav && !nav.querySelector("[data-follow-mobile-toggle]")) {
      var mobileToggle = document.createElement("button");
      mobileToggle.type = "button";
      mobileToggle.className = "follow-menu-mobile-toggle";
      mobileToggle.setAttribute("data-follow-mobile-toggle", "");
      mobileToggle.setAttribute("aria-label", tr("Takip edilen maçları aç", "Open followed matches"));
      mobileToggle.setAttribute("aria-expanded", "false");
      mobileToggle.setAttribute("aria-controls", "followed-matches-panel");
      mobileToggle.innerHTML = '<span aria-hidden="true">🔔</span><strong data-follow-count>0</strong><i data-follow-connection data-state="idle" aria-hidden="true"></i>';
      nav.insertBefore(mobileToggle, nav.querySelector(".nav-search-toggle-mobile"));
    }
    followPanel = wrapper.querySelector("[data-follow-panel]");
    renderFollowPanel();
  }

  function renderFollowPanel() {
    document.querySelectorAll("[data-follow-count]").forEach(function (node) {
      node.textContent = String(followed.size);
    });
    if (!followPanel) return;

    var rows = Array.from(followed.values()).map(function (record) {
      var row = document.createElement("div");
      row.className = "follow-panel-match";

      var link = document.createElement("a");
      link.className = "follow-panel-link";
      link.href = record.href;
      link.innerHTML = "<strong></strong><span>" + tr("Maça git", "Match details") + "</span>";
      link.querySelector("strong").textContent = record.homeTeam + " - " + record.awayTeam;

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "follow-panel-remove";
      remove.setAttribute("data-unfollow-match", record.id);
      remove.setAttribute("aria-label", record.homeTeam + " - " + record.awayTeam + tr(" bildirimlerini kapat", " turn off notifications"));
      remove.setAttribute("title", tr("Bildirimleri kapat", "Turn off notifications"));
      remove.textContent = "×";
      row.appendChild(link);
      row.appendChild(remove);
      return row;
    });

    followPanel.replaceChildren();
    var head = document.createElement("div");
    head.className = "follow-panel-head";
    head.innerHTML = '<strong>' + tr('Takip edilen maçlar', 'Followed matches') + '</strong><span>' + followed.size + '</span>';
    followPanel.appendChild(head);

    var list = document.createElement("div");
    list.className = "follow-panel-list";
    if (rows.length) {
      rows.forEach(function (row) { list.appendChild(row); });
    } else {
      var empty = document.createElement("p");
      empty.className = "follow-panel-empty";
      empty.textContent = tr("Takip edilen maç yok.", "No followed matches.");
      list.appendChild(empty);
    }
    followPanel.appendChild(list);

    var settings = document.createElement('fieldset');
    settings.className = 'follow-event-settings';
    var legend = document.createElement('legend'); legend.textContent = tr('Bildirim tercihleri', 'Notification preferences'); settings.appendChild(legend);
    var choices = { goal: tr('Gol, gol iptali ve skor düzeltmeleri', 'Goals, disallowed goals and score corrections'), red_card: tr('Kırmızı kart', 'Red card'), kickoff: tr('Maç başlangıcı', 'Kickoff'), halftime: tr('Devre arası', 'Half time'), fulltime: tr('Maç sonu', 'Full time'), sound: tr('Bildirim sesi', 'Notification sound') };
    Object.keys(choices).forEach(function (key) {
      var label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.checked = preferences[key]; input.setAttribute('data-notification-preference', key);
      input.addEventListener('change', function () {
        preferences[key] = input.checked;
        try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch (_) {}
        if (key === 'sound' && input.checked) {
          var Audio = window.AudioContext || window.webkitAudioContext;
          if (Audio) { audioContext = audioContext || new Audio(); audioContext.resume().catch(function () {}); }
        }
        queue = queue.filter(function (item) { return eventAllowed(item.event); });
        if (toastRoot) Array.from(toastRoot.children).forEach(function (toast) { if (!eventAllowed({type: toast.getAttribute('data-event-type')})) toast.remove(); });
      });
      label.append(input, document.createTextNode(choices[key])); settings.appendChild(label);
    });
    followPanel.appendChild(settings);
    var pushHelp = document.createElement('p'); pushHelp.className = 'follow-explanation';
    pushHelp.textContent = tr('Arka plan bildirimi mevcut değil. Site kapalıyken bildirim gönderilmez.', 'Background notifications are unavailable. No notifications are sent while the site is closed.');
    followPanel.appendChild(pushHelp);

    var help = document.createElement('p'); help.className = 'follow-explanation'; help.textContent = EXPLANATION; followPanel.appendChild(help);
    var state = document.createElement('p'); state.className = 'follow-feed-status'; state.setAttribute('data-follow-status', ''); state.textContent = feedLabel(); followPanel.appendChild(state);
    var clear = document.createElement('button'); clear.type = 'button'; clear.className = 'follow-clear'; clear.textContent = tr('Tümünü kapat', 'Turn all off');
    clear.addEventListener('click', function () { Array.from(followed.keys()).forEach(unfollow); }); followPanel.appendChild(clear);
  }

  function closePanel() {
    if (followPanel) followPanel.hidden = true;
    document.querySelectorAll("[data-follow-panel-toggle], [data-follow-mobile-toggle]").forEach(function (toggle) {
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  function togglePanel() {
    if (!followPanel) return;
    var open = followPanel.hidden;
    followPanel.hidden = !open;
    document.querySelectorAll("[data-follow-panel-toggle], [data-follow-mobile-toggle]").forEach(function (toggle) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function disconnect() { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; }
  function scheduleReconnect() { if (!polling && !reconnectTimer) reconnectTimer = setTimeout(connect, 0); }
  function restartConnection() { disconnect(); scheduleReconnect(); }
  async function readShared(file) {
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 10000);
    try {
      var response = await fetch(new URL('data/' + file, moduleBase), { cache: 'no-cache', signal: controller.signal });
      if (!response.ok) throw new Error('shared-cache-unavailable');
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  async function readLiveShared() {
    var controller=new AbortController(), timeout=setTimeout(function(){controller.abort();},10000);
    try {
      // One canonical CDN URL for all matches/users. Never add user, match or
      // cache-busting parameters; the existing provider cache coalesces misses.
      var response=await fetch(new URL('api/matches',moduleBase),{signal:controller.signal});
      if(!response.ok) return {matches:[]};
      var payload=await response.json();
      return {matches:payload.ok&&Array.isArray(payload.data)?payload.data:[]};
    } catch (_) { return {matches:[]}; }
    finally {clearTimeout(timeout);}
  }
  async function connect() {
    reconnectTimer = null;
    if (polling) return;
    polling = true;
    var featureChecked = false;
    try {
      var config = await readShared('match-notifications.json');
      enabled = config.enabled === true; featureChecked = true;
      if (!enabled) { queue = []; baselines.clear(); if (toastRoot) toastRoot.replaceChildren(); }
      if (enabled && followed.size && !document.hidden) {
        if (!identitiesLoaded) {
          var identityData = await readShared('match-notification-identities.json');
          identityAliases = identityData.aliases || {}; identitiesLoaded = true;
        }
        var sources = await Promise.all([readShared('matches.json'), readShared('fixture-calendar.json'), readShared('super-lig-fixtures.json')]);
        if(config.mode==='shared-api-cache') sources.push(await readLiveShared());
        var rows = new Map();
        sources.forEach(function (source) {
          var matches = Array.isArray(source) ? source : source.matches || (source.rounds || []).flatMap(function (r) { return r.matches || []; });
          matches.forEach(function (m) {
            var id = String(m.id || ''); if (!id) return;
            var stamp = Date.parse(m.fetchedAt || m.updatedAt || m.lastVerifiedAt || source.fetchedAt || source.lastVerifiedAt || '');
            var old = rows.get(id);
            if (!old || (stamp || 0) > (old.stamp || 0)) rows.set(id, { match: m, stamp: stamp });
          });
        });
        freshMatches.clear();
        rows.forEach(function (entry, id) {
          id = sharedId(entry.match);
          if (!followed.has(id)) return;
          var m = Object.assign({}, entry.match, {id: id}), now = Date.now(), record = followed.get(id);
          record.aliases = Array.from(new Set([].concat(record.aliases || [], String(entry.match.id), entry.match.providerIds && entry.match.providerIds.apiFootball ? String(entry.match.providerIds.apiFootball) : [], entry.match.source === 'api-football' && entry.match.providerId ? String(entry.match.providerId) : []))).slice(0,8);
          var known = baselines.get(id);
          if (known && known.sourceAt && (!Number.isFinite(entry.stamp) || known.sourceAt > entry.stamp)) return;
          if (window.FutbolRadarNotificationCore.isFinished(m)) {
            record.finishedAt = record.finishedAt || now;
            if (now - record.finishedAt > 86400000) { unfollow(id); return; }
          } else record.finishedAt = null;
          var fresh = Number.isFinite(entry.stamp) && now - entry.stamp < 120000 && entry.stamp <= now + 60000 && (!m.staleAfter || Date.parse(m.staleAfter) > now) && (!m.kickoff || !Number.isFinite(Date.parse(m.kickoff)) || Date.parse(m.kickoff) > now - 8 * 3600000);
          if (fresh) freshMatches.add(id);
          var previous = baselines.get(id);
          if (previous && previous.sourceAt && (!fresh || previous.sourceAt > entry.stamp)) return;
          var result = window.FutbolRadarNotificationCore.diff(previous, m, now);
          baselines.set(id, result.next);
          if (fresh && previous && previous.fresh) result.events.forEach(ingestEvent);
          result.next.fresh = fresh; result.next.sourceAt = entry.stamp;
        });
        persistState();
        setConnectionState(allSourcesFresh() ? 'live' : 'stale');
      } else setConnectionState(followed.size ? 'unavailable' : 'idle');
    } catch (error) { if (!featureChecked) enabled = false; baselines.clear(); queue = []; if (toastRoot) toastRoot.replaceChildren(); setConnectionState('unavailable'); }
    finally {
      polling = false; syncMatchControls(document);
      var active = !document.hidden && followed.size && (!baselines.size || Array.from(baselines.values()).some(function (m) {
        return /^(LIVE|IN_PLAY|1H|2H|ET|P|BT|HT|HALFTIME|PAUSED|INT|SUSP)$/.test(m.status) ||
          (Date.parse(m.kickoff) > Date.now() && Date.parse(m.kickoff) - Date.now() < 600000);
      }));
      reconnectTimer = setTimeout(connect, active ? 60000 : 300000);
    }
  }

  function eventKey(event) {
    var base = cleanText(event && event.matchId) + ":" + (cleanText(event && event.id) || [
      cleanText(event && event.matchId),
      cleanText(event && event.type),
      event && event.minute !== undefined ? event.minute : "na",
      cleanText(event && (event.playerId || event.playerName)) || "na"
    ].join(":"));
    if (!event || !event.correction) return base;
    return base + ":correction:" + JSON.stringify([event.type, event.minute, event.score, event.detail]);
  }

  function rememberEvent(event) {
    var key = eventKey(event);
    if (!key || seenEvents.has(key)) return false;
    seenEvents.set(key, Date.now());
    while (seenEvents.size > MAX_SEEN_EVENTS) seenEvents.delete(seenEvents.keys().next().value);
    try { localStorage.setItem('futbolradar:notification-seen:v2', JSON.stringify(Array.from(seenEvents))); } catch (_) {}
    return true;
  }

  function minuteLabel(event) {
    if (!event || event.minute === null || event.minute === undefined) return "";
    return String(event.minute) + (event.extraMinute ? "+" + event.extraMinute : "") + "'";
  }

  function scoreLabel(event) {
    if (!event || !event.score || event.score.home === undefined || event.score.away === undefined) return tr("Skor doğrulanamadı", "Score unavailable");
    return (event.homeTeam || "Ev sahibi") + " " + event.score.home + " - " + event.score.away + " " + (event.awayTeam || "Deplasman");
  }

  function toastBody(event) {
    var correction = event.previousScore && event.score ? tr('Önceki skor: ', 'Previous score: ') + event.previousScore.home + ' - ' + event.previousScore.away : '';
    return [[event.playerName, minuteLabel(event)].filter(Boolean).join(' '), correction, scoreLabel(event)].filter(Boolean);
  }
  function ensureToastRoot() {
    if (toastRoot && document.body.contains(toastRoot)) return toastRoot;
    toastRoot = document.createElement("div");
    toastRoot.className = "live-toast-region";
    toastRoot.setAttribute("aria-live", "polite");
    toastRoot.setAttribute("aria-atomic", "false");
    document.body.appendChild(toastRoot);
    return toastRoot;
  }

  function removeToast(toast) { if (toast) toast.remove(); drainQueue(); }
  function drainQueue() {
    if (!toastRoot) return;
    while (queue.length && toastRoot.children.length < 2) {
      var item = queue.shift();
      if (enabled && followed.has(String(item.event.matchId)) && Date.now() - item.at < 20000 && !document.hidden) showToast(item.event);
    }
  }
  function showToast(event) {
    var ui = EVENT_UI[event.type];
    if (!ui || document.hidden || !eventAllowed(event)) return;
    var root = ensureToastRoot();
    if (root.children.length >= 2) { queue.push({event: event, at: Date.now()}); queue = queue.slice(-4); return; }
    updateObstruction();

    var toast = document.createElement("article");
    toast.className = "live-event-toast";
    toast.setAttribute("data-event-type", event.type);
    toast.setAttribute("data-toast-match", event.matchId);
    toast.setAttribute("data-event-id", eventKey(event));
    toast.setAttribute("role", "status");

    var icon = document.createElement("span");
    icon.className = "live-event-toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ui.icon;

    var content = document.createElement("a");
    content.href = followed.get(String(event.matchId)).href;
    content.className = "live-event-toast-content";
    var match = document.createElement("span");
    match.className = "live-event-toast-match";
    match.textContent = (event.homeTeam || "Maç") + " - " + (event.awayTeam || "");
    var title = document.createElement("strong");
    var eventTitle = ui.title;
    title.textContent = (event.correction ? tr("GÜNCELLEME · ", "UPDATE · ") : "") + eventTitle + (event.teamName ? " — " + event.teamName : "");
    content.appendChild(match);
    content.appendChild(title);
    toastBody(event).forEach(function (line) {
      var text = document.createElement("span");
      text.className = "live-event-toast-line";
      text.textContent = line;
      content.appendChild(text);
    });

    var close = document.createElement("button");
    close.type = "button";
    close.className = "live-event-toast-close";
    close.setAttribute("aria-label", tr("Bildirimi kapat", "Dismiss notification"));
    close.textContent = "×";
    close.addEventListener("click", function () { removeToast(toast); });
    toast.appendChild(icon);
    toast.appendChild(content);
    toast.appendChild(close);
    root.appendChild(toast);
    if (preferences.sound && audioContext && audioContext.state === 'running') {
      var oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.connect(gain); gain.connect(audioContext.destination); gain.gain.setValueAtTime(0.06, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
      oscillator.frequency.value = 660; oscillator.start(); oscillator.stop(audioContext.currentTime + 0.15);
    }
    function expire() { if (!toast.isConnected) return; if (toast.contains(document.activeElement)) { window.setTimeout(expire, 1000); return; } removeToast(toast); }
    window.setTimeout(expire, TOAST_LIFETIME_MS);
  }

  function ingestEvent(event) {
    if (!enabled || !event || !followed.has(String(event.matchId || "")) || !EVENT_UI[event.type]) return false;
    if (!rememberEvent(event)) return false;


    document.dispatchEvent(new CustomEvent("futbolradar:live-event", { detail: event }));
    if (eventAllowed(event)) showToast(event);
    return true;
  }

  function follow(record) {
    var normalized = normalizeRecord(record);
    if (!enabled || !normalized) return false;
    if (followed.has(subscriptionId(normalized.id))) return true;
    if (!followed.has(normalized.id) && followed.size >= MAX_FOLLOWED_MATCHES) return false;
    baselines.delete(normalized.id);
    followed.set(normalized.id, Object.assign({}, followed.get(normalized.id) || {}, normalized));
    document.querySelectorAll('.match-follow-button').forEach(function (button) {
      if (button.getAttribute('data-follow-match') !== normalized.id) return;
      var help = button.parentElement.querySelector('.follow-selection-help');
      if (!help) { help = document.createElement('p'); help.className = 'follow-selection-help follow-explanation'; help.setAttribute('role', 'status'); button.after(help); }
      help.textContent = EXPLANATION;
    });
    persistState();
    renderFollowPanel();
    scheduleDomSync(document);
    restartConnection();
    document.dispatchEvent(new CustomEvent("futbolradar:follow-change", { detail: getState() }));
    return true;
  }

  function unfollow(id) {
    id = subscriptionId(cleanText(id));
    if (!followed.delete(id)) return false;
    baselines.delete(id);
    queue = queue.filter(function (item) { return String(item.event.matchId) !== id; });
    if (toastRoot) Array.from(toastRoot.children).forEach(function (toast) { if (toast.getAttribute('data-toast-match') === id) toast.remove(); });
    drainQueue();
    persistState();
    renderFollowPanel();
    scheduleDomSync(document);
    restartConnection();
    document.dispatchEvent(new CustomEvent("futbolradar:follow-change", { detail: getState() }));
    return true;
  }

  function getState() {
    return {
      matchIds: Array.from(followed.keys()),
      matches: Array.from(followed.values()).map(function (record) { return Object.assign({}, record); }),
      enabled: enabled,
      connectionState: connectionState
    };
  }

  function consumeShared(matches, stamp) {
    if (!enabled || document.hidden) return;
    (matches || []).forEach(function (m) {
      var id = sharedId(m); if (!followed.has(id)) return; m = Object.assign({}, m, {id: id});
      var now = Date.now(), time = Date.parse(m.fetchedAt || m.updatedAt || stamp || '');
      var previous = baselines.get(id);
      // The shared stream and static refresh can complete in either order.
      // Equal timestamps are duplicates; only newer evidence can correct a score.
      if (previous && Number.isFinite(previous.sourceAt) && (!Number.isFinite(time) || time <= previous.sourceAt)) return;
      if (!Number.isFinite(time) || now - time > 120000 || time > now + 60000) { freshMatches.delete(id); setConnectionState('stale'); return; }
      var record = followed.get(id);
      var completed = window.FutbolRadarNotificationCore.isFinished(m);
      if (completed && !record.finishedAt) { record.finishedAt = now; persistState(); }
      else if (!completed && record.finishedAt) { record.finishedAt = null; persistState(); }
      var result = window.FutbolRadarNotificationCore.diff(previous, m, now);
      if (previous && previous.fresh) result.events.forEach(ingestEvent);
      result.next.fresh = true; result.next.sourceAt = time; baselines.set(id, result.next); freshMatches.add(id);
      setConnectionState(freshMatches.size === followed.size ? 'live' : 'stale');
    });
  }
  function bindEvents() {
    document.addEventListener('futbolradar:score-snapshot', function (event) { var p = event.detail || {}; consumeShared(p.matches, p.timing && (p.timing.backend_receive_time || p.timing.serverReceivedAt)); });
    document.addEventListener('futbolradar:match-detail', function (event) { var m = event.detail; if (m) consumeShared([m]); syncMatchControls(document); });
    document.addEventListener("click", function (event) {
      var followButton = event.target.closest && event.target.closest(".match-follow-button[data-follow-match]");
      if (followButton) {
        event.preventDefault();
        var record = readNodeRecord(followButton);
        if (!record) return;
        if (followed.has(subscriptionId(record.id))) unfollow(subscriptionId(record.id)); else follow(record);
        return;
      }

      var remove = event.target.closest && event.target.closest("[data-unfollow-match]");
      if (remove) {
        event.preventDefault();
        unfollow(remove.getAttribute("data-unfollow-match"));
        return;
      }

      if (event.target.closest && event.target.closest("[data-follow-panel-toggle]")) {
        event.preventDefault();
        togglePanel();
        return;
      }

      if (event.target.closest && event.target.closest("[data-follow-mobile-toggle]")) {
        event.preventDefault();
        var nav = document.querySelector(".topbar-premium .nav");
        var navToggle = nav && nav.querySelector(".nav-toggle");
        if (nav) nav.classList.add("is-open");
        if (navToggle) {
          navToggle.setAttribute("aria-expanded", "true");
          navToggle.setAttribute("aria-label", tr("Menüyü kapat", "Close menu"));
        }
        if (followPanel) followPanel.hidden = false;
        document.querySelectorAll("[data-follow-panel-toggle], [data-follow-mobile-toggle]").forEach(function (toggle) {
          toggle.setAttribute("aria-expanded", "true");
        });
        return;
      }

      if (followPanel && event.target.closest && event.target.closest(".follow-panel-link")) closePanel();
      if (followPanel && !event.target.closest("[data-follow-menu]")) closePanel();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closePanel();
    });

    document.addEventListener("futbolradar:rendered", function (event) {
      scheduleDomSync(event.detail && event.detail.target);
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        scheduleDomSync(document);
        baselines.clear(); queue = []; if (toastRoot) toastRoot.replaceChildren();
        restartConnection();
      }
    });

    window.addEventListener("storage", function (event) {
      if (event.key === PREFERENCES_KEY) { loadPreferences(); queue = []; if (toastRoot) toastRoot.replaceChildren(); renderFollowPanel(); return; }
      if (event.key !== FOLLOW_STORAGE_KEY) return;
      queue = []; baselines.clear(); if (toastRoot) toastRoot.replaceChildren();
      followed.clear();
      loadState();
      renderFollowPanel();
      scheduleDomSync(document);
      restartConnection();
    });

    window.addEventListener("pagehide", disconnect);
  }

  function init() {
    loadState();
    try { seenEvents = new Map(safeJson(localStorage.getItem('futbolradar:notification-seen:v2'), [])); } catch (_) {}
    injectHeaderPanel();
    bindEvents();
    syncMatchControls(document);
    new MutationObserver(updateObstruction).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['hidden']});
    scheduleReconnect(true);
  }

  window.FutbolRadarFollow = {
    follow: follow,
    unfollow: unfollow,
    getState: getState,
    ingestEvent: ingestEvent,
    reconnect: restartConnection
  };

  function updateObstruction() {
    var bottom = 16;
    document.querySelectorAll('[data-cookie-banner], .cookie-banner, .cookie-consent, #cookie-banner, .mobile-bottom-nav, .bottom-nav, [data-bottom-nav], .fr-pwa-toast, .fr-pwa-panel').forEach(function (node) {
      var box = node.getBoundingClientRect();
      if (box.height && box.bottom >= innerHeight - 5 && getComputedStyle(node).position === 'fixed') bottom = Math.max(bottom, innerHeight - box.top + 12);
    });
    if (toastRoot) toastRoot.style.setProperty('--notification-obstruction', bottom + 'px');
  }
  var labels = {
    goal: ['GOL', 'GOAL'], var: ['GOL İPTALİ', 'GOAL DISALLOWED'], red_card: ['KIRMIZI KART', 'RED CARD'],
    penalty_awarded: ['PENALTI KARARI', 'PENALTY AWARDED'], penalty_scored: ['PENALTI GOLÜ', 'PENALTY SCORED'], penalty_missed: ['PENALTI KAÇTI', 'PENALTY MISSED'],
    kickoff: ['MAÇ BAŞLADI', 'KICKOFF'], halftime: ['DEVRE ARASI', 'HALF TIME'], fulltime: ['MAÇ BİTTİ', 'FULL TIME'],
    score_update: ['SKOR GÜNCELLENDİ', 'SCORE UPDATED'], score_correction: ['SKOR DÜZELTMESİ', 'SCORE CORRECTION']
  };
  EVENT_UI = Object.fromEntries(Object.keys(labels).map(function (key) { return [key, { icon: key === 'goal' ? '⚽' : '●', title: tr.apply(null, labels[key]) }]; }));
  var style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('match-notifications.css', moduleBase); document.head.appendChild(style);
  var core = document.createElement('script'); core.src = new URL('match-notifications-core.js', moduleBase);
  core.onload = function () { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init(); };
  document.head.appendChild(core);
  window.addEventListener('resize', updateObstruction);
})();
