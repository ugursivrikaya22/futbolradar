/**
 * GOL/ASİST KRALLIĞI TABLOSU — LİG PARAMETRELİ.
 *
 * Eskiden `prerender-core-pages.mjs` içinde Süper Lig'e sabitlenmişti
 * (boş durum metni "Süper Lig ..." diye yazılıydı). Artık lig adı
 * `data/stats-leagues.json` kaydından gelir; Süper Lig çıktısı BAYT BAYT
 * aynıdır (bkz. scripts/test-competition-stats.mjs → "Süper Lig tablosu
 * değişmedi").
 *
 * Mobilde taşmaması için `evergreen-table-wrap`, takım logosu için de
 * `home-standing-logo*`/`home-standing-team` yeniden kullanılır — yeni bir
 * CSS sınıfı eklemek page.css'in tek sürüm damgasını gereksiz yere
 * değiştirirdi.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function teamInitials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || clean.charAt(0).toUpperCase();
}

function emptyStateCard(title, note) {
  return `<article class="card data-empty" data-card="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(note)}</span></article>`;
}

export function leaderLogoHtml(row) {
  const initials = escapeHtml(teamInitials(row.team));
  if (!row.teamLogo) {
    return `<span class="home-standing-logo home-standing-logo-fallback" aria-hidden="true">${initials}</span>`;
  }
  return `<span class="home-standing-logo-wrap"><img class="home-standing-logo" src="${escapeHtml(row.teamLogo)}" alt="" width="20" height="20" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="home-standing-logo-fallback" aria-hidden="true" style="display:none">${initials}</span></span>`;
}

function leaderNameHtml(row, playerHref) {
  const name = escapeHtml(row.name || "");
  return row.slug ? `<a href="${escapeHtml(playerHref(row.slug))}">${name}</a>` : `<span>${name}</span>`;
}

/**
 * @param rows        provider leader rows (data/league-leaders.json or the
 *                    competition-leaders store)
 * @param metric      "goals" | "assists"
 * @param metricLabel column header ("Gol" / "Asist")
 * @param options     { league: stats-leagues.json entry, playerHref(slug) }
 */
export function leagueLeaderTableHtml(rows, metric, metricLabel, options) {
  const leagueName = options.league.name.tr;
  if (!rows || !rows.length) {
    return emptyStateCard("Veri bekleniyor", `${leagueName} ${metricLabel.toLocaleLowerCase("tr-TR")} sıralaması, resmî lig maçları oynandıkça güncellenir.`);
  }
  const body = rows.map((row) => `<tr>
              <td>${escapeHtml(String(row.rank))}</td>
              <th scope="row">${leaderNameHtml(row, options.playerHref)}</th>
              <td><span class="home-standing-team">${leaderLogoHtml(row)}<span>${escapeHtml(row.team || "")}</span></span></td>
              <td><strong>${escapeHtml(String(row[metric] ?? 0))}</strong></td>
              <td>${row.appearances ? escapeHtml(String(row.appearances)) : "-"}</td>
            </tr>`).join("");

  return `<div class="evergreen-table-wrap"><table class="evergreen-table">
          <thead><tr><th scope="col">Sıra</th><th scope="col">Oyuncu</th><th scope="col">Takım</th><th scope="col">${escapeHtml(metricLabel)}</th><th scope="col">Maç</th></tr></thead>
          <tbody>${body}</tbody>
        </table></div>`;
}
