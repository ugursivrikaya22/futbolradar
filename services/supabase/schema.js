/**
 * VERİ KATMANI SÖZLEŞMESİ — TABLO VE SÜTUN ADLARI TEK YERDE.
 *
 * NEDEN AYRI BİR DOSYA: PostgREST, olmayan bir sütuna yazmaya çalışan
 * isteği `400` ile geri çevirir ve gövdede tek satır hata verir. Yazma
 * toplu yapıldığında bu, "300 satırın hepsi sessizce kayboldu"ya
 * dönüşür — kod doğru görünür, kütükte tek satır hata vardır, veri
 * yoktur. Bu depoda tam olarak bu sınıftan bir hata bir kez üretime
 * çıktı (değişkenle çağrılan `require`, canlıda sessiz boş dönüş).
 *
 * Bu yüzden hangi tabloya hangi sütunların yazıldığı KODDA yazılı ve
 * `scripts/test-supabase-layer.mjs` bunu göç dosyasıyla karşılaştırıyor:
 * kodun yazdığı her sütun SQL'de gerçekten var mı. Uyuşmazlık, canlıda
 * değil testte patlıyor.
 *
 * `conflict` alanı, tekrar çalıştırılabilir alım için gereken benzersiz
 * anahtardır (PostgREST `on_conflict` parametresi). Alım günde birkaç
 * kez çalışıyor; her çalıştırma yeni satır yazsaydı depo şişer, sayımlar
 * bozulurdu.
 */

const TABLES = {
  dataSources: {
    name: "data_sources",
    conflict: "id",
    columns: ["id", "name", "kind", "trust", "base_url", "active", "note"]
  },
  teams: {
    name: "teams",
    conflict: "id",
    columns: [
      "id", "name", "short_name", "league", "country", "founded",
      "venue", "logo_url", "provider_ids", "source_id"
    ]
  },
  players: {
    name: "players",
    conflict: "id",
    columns: [
      "id", "name", "team_id", "position", "birth_date", "nationality",
      "height_cm", "weight_kg", "preferred_foot", "market_value_eur",
      "contract_until", "photo_url", "provider_ids", "source_id"
    ]
  },
  playerStats: {
    name: "player_stats",
    conflict: "player_id,season,competition",
    columns: [
      "player_id", "season", "competition", "appearances", "minutes",
      "goals", "assists", "shots", "shots_on_target", "key_passes",
      "duels", "duels_won", "yellow_cards", "red_cards", "xg", "xa",
      "rating", "source_id"
    ]
  },
  matches: {
    name: "matches",
    conflict: "id",
    columns: [
      "id", "provider_fixture_id", "competition_id", "competition", "season",
      "stage", "kickoff", "venue", "city", "referee", "home_team_id",
      "away_team_id", "home_team_name", "away_team_name", "status",
      "provider_status", "home_score", "away_score", "ht_home_score",
      "ht_away_score", "winner", "source_id"
    ]
  },
  matchStats: {
    name: "match_stats",
    conflict: "match_id,team_name",
    columns: [
      "match_id", "team_id", "team_name", "possession", "shots",
      "shots_on_target", "corners", "fouls", "offsides", "passes",
      "pass_accuracy", "xg", "source_id"
    ]
  },
  transfers: {
    name: "transfers",
    conflict: "id",
    columns: [
      "id", "player_id", "player_name", "from_team", "to_team", "league",
      "position", "transfer_type", "fee_eur", "fee_label", "status",
      "confidence", "announced_on", "season", "source_id", "source_name",
      "source_url", "last_verified_at", "note"
    ]
  },
  analysisReports: {
    name: "analysis_reports",
    conflict: "id",
    columns: [
      "id", "match_id", "kind", "subject_id", "locale", "model_version",
      "headline", "lead", "body", "coverage_grade", "generated_at", "source_id"
    ]
  },
  ingestionRuns: {
    name: "ingestion_runs",
    conflict: "id",
    columns: [
      "id", "entity", "source_id", "status", "started_at", "finished_at",
      "rows_read", "rows_written", "rows_skipped", "error", "detail"
    ]
  },
  ingestionLogs: {
    name: "ingestion_logs",
    conflict: "id",
    columns: ["run_id", "level", "entity", "entity_id", "message", "detail"]
  },
  polls: {
    name: "polls",
    conflict: "id",
    columns: [
      "id", "kind", "question_tr", "question_en", "subtitle_tr",
      "subtitle_en", "starts_at", "ends_at"
    ]
  },
  pollOptions: {
    name: "poll_options",
    conflict: "poll_id,option_id",
    columns: ["poll_id", "option_id", "label_tr", "label_en", "team_id", "sort_order"]
  },
  userInteractions: {
    name: "user_interactions",
    conflict: "id",
    columns: ["occurred_at", "kind", "subject_type", "subject_id", "locale", "session_key", "meta"]
  },
  // Maç tahmini deposu — bkz. supabase/migrations/0004_fixture_predictions.sql.
  // `source` sütunu arayüzdeki başlığın tek kaynağıdır; kolon listesi
  // göçle birebir eşleşmezse toplu yazmanın TAMAMI 400 ile düşer.
  fixturePredictions: {
    name: "fixture_predictions",
    conflict: "fixture_id",
    columns: [
      "fixture_id", "provider_fixture_id", "competition_id", "league_id",
      "season", "kickoff", "home_team", "away_team", "home_team_id",
      "away_team_id", "source", "home_probability", "draw_probability",
      "away_probability", "predicted_winner", "advice", "under_over",
      "predicted_goals", "comparison", "confidence", "model_version",
      "frozen", "refresh_stage", "provider_updated_at", "calculated_at",
      "expires_at", "raw_provider_data", "source_id"
    ]
  },
  // Canlı skor veri hattı gecikme kütüğü — bkz. services/liveEventLatency.js
  // başlığındaki mimari notu. `event_key` üzerinden upsert edilir: satır
  // önce sunucu zaman damgalarıyla yazılır, istemci ekrana bastığında aynı
  // satır `client_rendered_at` ile güncellenir (iki ayrı yazma, aynı satır).
  liveEventLatency: {
    name: "live_event_latency",
    conflict: "event_key",
    columns: [
      "match_id", "event_key", "event_kind", "team_side", "player_name",
      "provider_elapsed_minute", "provider_time_estimated", "first_seen_at",
      "db_written_at", "api_response_at", "client_rendered_at"
    ]
  }
};

/**
 * ALINABİLİR VARLIKLAR — `scripts/supabase-ingest.mjs` bu adları kabul eder.
 * Sıra ÖNEMLİ: yabancı anahtarlar yüzünden takımlar oyunculardan, maçlar
 * takımlardan, analizler maçlardan önce yazılmalı.
 */
const INGEST_ORDER = ["sources", "teams", "players", "matches", "predictions", "transfers", "reports", "polls"];

module.exports = { TABLES, INGEST_ORDER };
