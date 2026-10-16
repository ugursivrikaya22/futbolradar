#!/usr/bin/env node
/**
 * TAHMİN LİGİ — GERÇEK POSTGRESQL TESTLERİ (migration 0010).
 *
 * Kilitleme, puanlama, RLS ve yetkiler JS'te taklit edilmez; gerçek PostgreSQL'de
 * koşulur. PostgreSQL yoksa test ATLANIR ("skipped" yazar); `REQUIRE_PG=1` ile
 * atlama hata sayılır (CI'da PostgreSQL kuruluysa bunu verin).
 *
 *   service postgresql start && node scripts/test-prediction-league-db.mjs
 *
 * Her koşu kendi geçici veritabanını açar ve siler.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const scoring = require("../services/predictionLeague/scoring.js");
const root = process.cwd();
const DB = `fr_league_test_${process.pid}`;

function run(args, input) {
  const base = process.getuid && process.getuid() === 0 ? ["runuser", "-u", "postgres", "--", "psql"] : ["psql"];
  const result = spawnSync(base[0], [...base.slice(1), "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", input, env: { ...process.env, PGHOST: process.env.PGHOST || "/var/run/postgresql", PGUSER: process.env.PGUSER || "postgres" } });
  return result;
}

const probe = run(["-d", "postgres", "-c", "select 1"]);
if (probe.status !== 0) {
  const message = "prediction-league-db: PostgreSQL erişilemiyor, test atlandı (skipped).";
  if (process.env.REQUIRE_PG === "1") { console.error(message); process.exit(1); }
  console.log(message);
  process.exit(0);
}

console.log("prediction-league-db");
const sql = (query, db = DB) => {
  const result = run(["-d", db, "-c", query]);
  if (result.status !== 0) throw new Error((result.stderr || "").trim().split("\n").find((line) => /ERROR/.test(line)) || result.stderr);
  return result.stdout.trim();
};
const fails = (query, pattern) => {
  try { sql(query); } catch (error) {
    assert.match(error.message, pattern, `${query} → ${error.message}`);
    return;
  }
  assert.fail(`hata bekleniyordu: ${query}`);
};
const rows = (query) => sql(query).split("\n").filter(Boolean).map((line) => line.split("|"));

try {
  run(["-d", "postgres", "-c", `drop database if exists ${DB}`]);
  assert.equal(run(["-d", "postgres", "-c", `create database ${DB}`]).status, 0);
  // Supabase rolleri düz PostgreSQL'de yok: oluştur (küme genelinde; varsa dokunma).
  run(["-d", "postgres", "-c", "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$"]);
  const migration = path.join(root, "supabase/migrations/0010_prediction_league.sql");
  const applied = run(["-d", DB, "-f", migration]);
  assert.equal(applied.status, 0, applied.stderr);
  // Migration ikinci kez uygulanabilir (idempotent).
  assert.equal(run(["-d", DB, "-f", migration]).status, 0, "migration idempotent olmalı");
  run(["-d", DB, "-c", "grant usage on schema public to anon, authenticated, service_role"]);
  console.log("  ok  migration uygulanıyor ve tekrar uygulanabiliyor");

  const hash = (n) => `h${String(n).padStart(63, "0")}`;
  const register = (nick, key, n, ip = "null") => sql(`select league_register('${nick}','${key}','rec${n}','${hash(n)}',${ip === "null" ? "null" : `'${ip}'`})`);
  const fixture = (id, kickoffSql, status = "SCHEDULED", extra = "") => sql(`insert into league_fixtures(fixture_id,season,round,home_team,away_team,kickoff,status${extra ? ",home_goals,away_goals" : ""}) values ('${id}','2026-27',8,'A','B',${kickoffSql},'${status}'${extra ? `,${extra}` : ""}) on conflict (fixture_id) do update set kickoff=excluded.kickoff, status=excluded.status`);
  const submit = (n, id, h, a) => sql(`select league_submit_prediction('${hash(n)}','${id}',${h},${a})`);

  // ── Hesaplar ─────────────────────────────────────────────────────────
  const ids = [1, 2, 3, 4].map((n) => register(`Oyuncu${n}`, `oyuncu${n}`, n));
  fails(`select league_register('Oyuncu1x','oyuncu1','r','${hash(90)}',null)`, /nickname_taken/);
  fails(`insert into league_players(nickname,nickname_key,recovery_hash) values ('Kötü Rumuz!','kotu','x')`, /league_players_nickname_format/);
  fails(`insert into league_players(nickname,nickname_key,recovery_hash) values ('abc','ABC','x')`, /league_players_key_format/);
  for (let n = 1; n <= 3; n += 1) register(`IpHesap${n}`, `iphesap${n}`, 100 + n, "iphash1");
  fails(`select league_register('IpHesap4','iphesap4','r','${hash(104)}','iphash1')`, /ip_limit/);
  assert.match(sql(`select league_login('oyuncu1','rec1','${hash(50)}')`), /^[0-9a-f-]{36}$/);
  fails(`select league_login('oyuncu1','yanlis','${hash(51)}')`, /unauthorized/);
  fails(`select league_login('yokboyle','rec1','${hash(52)}')`, /unauthorized/);
  const oturum = register("Oturum", "oturum", 70);
  for (let i = 0; i < 6; i += 1) sql(`select league_login('oturum','rec70','${hash(60 + i)}')`);
  assert.equal(sql(`select count(*) from league_sessions where player_id='${oturum}'`), "5", "en çok 5 oturum");
  assert.equal(sql(`select count(*) from league_sessions where secret_hash='${hash(70)}'`), "0", "en eski oturum düştü");
  sql(`select league_logout('${hash(65)}')`);
  fails(`select league_submit_prediction('${hash(65)}','x',1,0)`, /unauthorized/);
  console.log("  ok  kayıt, taklit anahtarı, IP sınırı, giriş (yanlış kod/olmayan rumuz aynı hata), oturum üst sınırı, çıkış");

  // ── Tahmin: tek satır, değişiklik, kilit ─────────────────────────────
  fixture("100", "now() + interval '2 hours'");
  submit(1, "100", 2, 1);
  submit(1, "100", 3, 1);
  assert.equal(sql(`select count(*) from league_predictions where player_id='${ids[0]}' and fixture_id='100'`), "1", "tek aktif tahmin");
  assert.equal(sql(`select home_goals||'-'||away_goals||'/'||change_count from league_predictions where player_id='${ids[0]}'`), "3-1/1");
  fails(`select league_submit_prediction('${hash(1)}','100',21,0)`, /invalid_score/);
  fails(`select league_submit_prediction('${hash(1)}','nope',1,0)`, /fixture_not_found|violates foreign key/);
  for (let i = 0; i < 9; i += 1) submit(1, "100", i % 5, (i + 1) % 5);
  fails(`select league_submit_prediction('${hash(1)}','100',9,9)`, /too_many_changes/);
  // Kilit: başlama saati geçti → API fonksiyonu, doğrudan UPDATE, INSERT ve DELETE reddedilir.
  submit(2, "100", 0, 0);
  sql("update league_fixtures set kickoff = now() - interval '1 second' where fixture_id='100'");
  fails(`select league_submit_prediction('${hash(2)}','100',5,5)`, /prediction_locked/);
  fails(`update league_predictions set home_goals = 9 where player_id='${ids[1]}' and fixture_id='100'`, /prediction_locked/);
  fails(`insert into league_predictions(player_id,fixture_id,home_goals,away_goals) values ('${ids[2]}','100',1,1)`, /prediction_locked/);
  fails(`delete from league_predictions where player_id='${ids[1]}' and fixture_id='100'`, /prediction_locked/);
  assert.equal(sql(`select home_goals||'-'||away_goals from league_predictions where player_id='${ids[1]}' and fixture_id='100'`), "0-0", "kilitli tahmin değişmedi");
  // Durum kilidi: kickoff gelecekte ama maç LIVE/ertelendi ise de kilitli.
  fixture("101", "now() + interval '3 hours'");
  submit(3, "101", 1, 0);
  for (const status of ["LIVE", "POSTPONED", "CANCELLED", "FINISHED", "INTERRUPTED", "ABANDONED"]) {
    sql(`update league_fixtures set status='${status}' where fixture_id='101'`);
    fails(`select league_submit_prediction('${hash(3)}','101',4,4)`, /prediction_locked/);
  }
  sql(`update league_fixtures set status='SCHEDULED' where fixture_id='101'`);
  submit(3, "101", 2, 2); // yeniden planlanan maç tekrar açılır
  // Puan/sonuç alanlarını istemci yazamaz.
  fails(`update league_predictions set points = 5, outcome = 'exact' where player_id='${ids[2]}'`, /settlement_only/);
  fails(`insert into league_predictions(player_id,fixture_id,home_goals,away_goals,points,outcome) values ('${ids[3]}','101',1,1,5,'exact')`, /settlement_only/);
  fails(`update league_predictions set player_id='${ids[0]}' where player_id='${ids[2]}'`, /immutable_key/);
  fails(`insert into league_predictions(player_id,fixture_id,home_goals,away_goals,points,outcome) values ('${ids[3]}','101',1,1,2,'exact')`, /settlement_only|check/);
  console.log("  ok  kilit veritabanında: API, doğrudan UPDATE/INSERT/DELETE, durum kilidi; puan alanları yalnızca puanlamada");

  // ── Puanlama ─────────────────────────────────────────────────────────
  fixture("200", "now() + interval '1 hour'");
  const preds = [[1, 2, 1], [2, 3, 0], [3, 0, 1], [4, 1, 1]];
  for (const [n, h, a] of preds) submit(n, "200", h, a);
  sql("update league_fixtures set kickoff = now() - interval '2 hours' where fixture_id='200'");
  // Maç sonuçsuzken puanlama hiçbir şey yazmaz.
  assert.match(sql("select league_settle_fixture('200')"), /"mode": "reset"|"mode":"reset"/);
  assert.equal(sql("select count(*) from league_scores"), "0");
  sql("update league_fixtures set status='FINISHED', home_goals=2, away_goals=1 where fixture_id='200'");
  sql("select league_settle_fixture('200')");
  const pointsOf = () => rows("select p.nickname, x.points, x.outcome from league_predictions x join league_players p on p.id=x.player_id where x.fixture_id='200' order by p.nickname").map(([n, pts, o]) => `${n}:${pts}:${o}`).join(",");
  assert.equal(pointsOf(), "Oyuncu1:5:exact,Oyuncu2:2:outcome,Oyuncu3:0:miss,Oyuncu4:0:miss");
  const totals = () => rows("select p.nickname, s.period_type, s.period_key, s.points, s.exact, s.outcome, s.predicted from league_scores s join league_players p on p.id=s.player_id order by 1,2").map((r) => r.join(":")).join("\n");
  const before = totals();
  sql("select league_settle_fixture('200')");
  assert.equal(totals(), before, "puanlama idempotent");
  const invariant = () => assert.equal(sql(`
    select count(*) from (
      select s.player_id, s.period_type, s.period_key, s.points, s.exact, s.outcome, s.predicted,
             coalesce(sum(x.points),0) sp, count(*) filter (where x.outcome='exact') se, count(*) filter (where x.outcome='outcome') so,
             count(*) filter (where x.outcome in ('exact','outcome','miss')) spr
        from league_scores s
        left join league_predictions x on x.player_id=s.player_id and x.outcome is not null
        left join league_fixtures f on f.fixture_id=x.fixture_id
         and league_period_key(s.period_type, f.kickoff, f.season) = s.period_key
       group by 1,2,3,4,5,6,7
    ) t where points<>sp or exact<>se or outcome<>so or predicted<>spr`), "0", "toplamlar tahminlerle tutarlı olmalı");
  invariant();
  assert.equal(sql("select count(distinct period_type) from league_scores"), "3", "hafta, ay, sezon satırları");

  // Sağlayıcı skoru düzeltti: 2-1 → 1-1. Farklar toplamlara yansır.
  sql("update league_fixtures set home_goals=1, away_goals=1 where fixture_id='200'");
  sql("select league_settle_fixture('200')");
  assert.equal(pointsOf(), "Oyuncu1:0:miss,Oyuncu2:0:miss,Oyuncu3:0:miss,Oyuncu4:5:exact");
  invariant();
  // Bitmiş maç sonradan iptal edildi: puan geri alınır, 'void' olur.
  sql("update league_fixtures set status='CANCELLED', home_goals=null, away_goals=null where fixture_id='200'");
  sql("select league_settle_fixture('200')");
  assert.equal(sql("select string_agg(distinct coalesce(outcome,'null')||':'||coalesce(points::text,'null'), ',') from league_predictions where fixture_id='200'"), "void:null");
  assert.equal(sql("select coalesce(sum(points),0)||'/'||coalesce(sum(predicted),0) from league_scores"), "0/0", "iptal edilen maç toplamlarda yok");
  invariant();
  // Yeniden planlandı ve oynandı: normal puanlama geri gelir.
  sql("update league_fixtures set status='FINISHED', home_goals=2, away_goals=1 where fixture_id='200'");
  sql("select league_settle_fixture('200')");
  assert.equal(pointsOf(), "Oyuncu1:5:exact,Oyuncu2:2:outcome,Oyuncu3:0:miss,Oyuncu4:0:miss");
  invariant();
  // Ertelenen maç: puan verilmez.
  fixture("201", "now() + interval '1 hour'");
  submit(1, "201", 1, 0);
  sql("update league_fixtures set status='POSTPONED' where fixture_id='201'");
  sql("select league_settle_fixture('201')");
  assert.equal(sql("select outcome||':'||coalesce(points::text,'null') from league_predictions where fixture_id='201'"), "void:null");
  assert.equal(sql(`select points from league_scores where player_id='${ids[0]}' and period_type='season'`), "5");
  console.log("  ok  puanlama: 5/2/0, idempotent, skor düzeltmesi, iptal geri alma, erteleme puansız, toplamlar tutarlı");

  // ── SQL ve JS aynı sonucu veriyor ────────────────────────────────────
  const cases = [];
  for (let i = 0; i < 80; i += 1) cases.push({ p: [Math.floor(Math.random() * 6), Math.floor(Math.random() * 6)], r: [Math.floor(Math.random() * 6), Math.floor(Math.random() * 6)] });
  cases.push({ p: [0, 0], r: [0, 0] }, { p: [20, 0], r: [20, 0] }, { p: [1, 1], r: [2, 2] });
  sql("insert into league_players(nickname,nickname_key,recovery_hash) values ('Esdeger','esdeger','x') on conflict do nothing");
  const eqId = sql("select id from league_players where nickname_key='esdeger'");
  cases.forEach((c, i) => {
    sql(`insert into league_fixtures(fixture_id,season,home_team,away_team,kickoff) values ('e${i}','2026-27','A','B', now() + interval '1 hour')`);
    sql(`insert into league_predictions(player_id,fixture_id,home_goals,away_goals) values ('${eqId}','e${i}',${c.p[0]},${c.p[1]})`);
    sql(`update league_fixtures set kickoff = now() - interval '3 hours', status='FINISHED', home_goals=${c.r[0]}, away_goals=${c.r[1]} where fixture_id='e${i}'`);
    sql(`select league_settle_fixture('e${i}')`);
  });
  const got = rows(`select fixture_id, outcome, points from league_predictions where player_id='${eqId}'`);
  for (const [fixtureId, outcome, points] of got) {
    const c = cases[Number(fixtureId.slice(1))];
    const expected = scoring.scorePrediction({ home: c.p[0], away: c.p[1] }, { status: "FINISHED", home: c.r[0], away: c.r[1] });
    assert.deepEqual([outcome, Number(points)], [expected.outcome, expected.points], `${fixtureId}: ${JSON.stringify(c)}`);
  }
  // Dönem anahtarları: SQL = JS (hafta sınırı, yıl sonu, İstanbul saati).
  for (const iso of ["2026-10-18T23:59:00+03:00", "2026-10-19T00:00:00+03:00", "2026-12-31T22:00:00+03:00", "2027-01-04T10:00:00+03:00", "2026-10-31T22:30:00Z", "2027-07-01T00:30:00+03:00"]) {
    const season = scoring.seasonOf(Date.parse(iso));
    const [week, month] = sql(`select league_period_key('week','${iso}'::timestamptz,'${season}') || '|' || league_period_key('month','${iso}'::timestamptz,'${season}')`).split("|");
    const js = scoring.periodKeys(Date.parse(iso));
    assert.deepEqual([week, month], [js.week, js.month], iso);
  }
  console.log(`  ok  ${cases.length} rastgele sonuçta SQL puanlaması = JS puanlaması; hafta/ay anahtarları eşit`);

  // ── Sıralama ─────────────────────────────────────────────────────────
  sql(`delete from league_players where id='${eqId}'`); // eşdeğerlik denemesinin oyuncusu sıralamayı bozmasın
  const board = rows("select rank, nickname, points, exact, outcome, predicted from league_leaderboard('season','2026-27',50) where nickname like 'Oyuncu%'");
  assert.deepEqual(board.map((r) => r.slice(0, 2).join(":")), ["1:Oyuncu1", "2:Oyuncu2", "3:Oyuncu3", "3:Oyuncu4"], "puan, sonra doğru skor; eşitlik aynı sırayı alır");
  assert.equal(Number(board[0][2]), 5);
  assert.equal(sql("select count(*) from league_leaderboard('season','2026-27',3)"), "3", "limit uygulanır");
  assert.equal(sql("select count(*) from league_leaderboard('season','2099-00',50)"), "0");
  assert.deepEqual(rows("select column_name from information_schema.columns where table_name='league_leaderboard'"), [], "sıralama bir fonksiyon, tablo değil");
  const names = rows("select * from pg_get_function_result('league_leaderboard(text,text,integer)'::regprocedure)")[0][0];
  assert.ok(!/id|ip|hash|recovery/i.test(names.replace(/\brank\b/g, "")), `sıralama çıktısı yalnızca rumuz+puan: ${names}`);
  const mine = JSON.parse(sql(`select league_me('${hash(2)}','2026-W99','2026-10','2026-27')`));
  assert.equal(mine.periods.season.points, 2);
  assert.equal(mine.periods.week.rank, null, "puanı olmayan dönemde sıra yok");
  assert.equal(mine.periods.season.rank, Number(board.find((r) => r[1] === "Oyuncu2")[0]), "kendi sıram = sıralamadaki sıram");
  assert.ok(mine.predictions.length >= 2 && mine.predictions.every((p) => "fixtureId" in p));
  fails(`select league_me('${hash(999)}','a','b','c')`, /unauthorized/);
  // Berabere puan aynı sırayı alır (1,1,3 biçimi).
  sql("update league_scores set points=7, exact=1, predicted=2 where period_type='season' and player_id in (select id from league_players where nickname in ('Oyuncu1','Oyuncu2'))");
  assert.deepEqual(rows("select rank, nickname from league_leaderboard('season','2026-27',50) where nickname in ('Oyuncu1','Oyuncu2') order by 2").map((r) => r[0]), ["1", "1"]);
  sql(`update league_players set banned_at=now() where nickname='Oyuncu1'`);
  assert.equal(sql("select count(*) from league_leaderboard('season','2026-27',50) where nickname='Oyuncu1'"), "0", "yasaklı oyuncu sıralamada yok");
  fails(`select league_submit_prediction('${hash(1)}','101',1,1)`, /unauthorized/);
  console.log("  ok  sıralama: indeksli, beraberlikte aynı sıra, yasaklı elenir, kendi sıram eşleşir, kişisel alan yok");

  // ── Rozetler ─────────────────────────────────────────────────────────
  sql("insert into league_players(nickname,nickname_key,recovery_hash) values ('Seri','seri','x')");
  const seri = sql("select id from league_players where nickname_key='seri'");
  for (let i = 0; i < 6; i += 1) {
    sql(`insert into league_fixtures(fixture_id,season,home_team,away_team,kickoff) values ('s${i}','2026-27','A','B', now() + interval '1 hour')`);
    sql(`insert into league_predictions(player_id,fixture_id,home_goals,away_goals) values ('${seri}','s${i}',1,0)`);
    sql(`update league_fixtures set kickoff = now() - interval '${10 - i} hours', status='FINISHED', home_goals=${i === 3 ? 0 : 2}, away_goals=${i === 3 ? 2 : 0} where fixture_id='s${i}'`);
    sql(`select league_settle_fixture('s${i}')`);
  }
  assert.equal(sql(`select string_agg(badge, ',' order by badge) from league_badges where player_id='${seri}'`), "ilk-puan", "5'li seri henüz yok (4. maçta kırıldı)");
  for (let i = 6; i < 11; i += 1) {
    sql(`insert into league_fixtures(fixture_id,season,home_team,away_team,kickoff) values ('s${i}','2026-27','A','B', now() + interval '1 hour')`);
    sql(`insert into league_predictions(player_id,fixture_id,home_goals,away_goals) values ('${seri}','s${i}',2,0)`);
    sql(`update league_fixtures set kickoff = now() - interval '${10 - i} minutes', status='FINISHED', home_goals=2, away_goals=0 where fixture_id='s${i}'`);
    sql(`select league_settle_fixture('s${i}')`);
  }
  assert.equal(sql(`select string_agg(badge, ',' order by badge) from league_badges where player_id='${seri}'`), "ilk-puan,nisanci,sadik-10,seri-5");
  console.log("  ok  rozetler: ilk puan, nişancı (3 doğru skor), 5'li seri (kırılan seri sayılmaz), sadık (10 tahmin)");

  // ── RLS ve yetkiler ──────────────────────────────────────────────────
  const tables = ["league_fixtures", "league_players", "league_sessions", "league_predictions", "league_scores", "league_badges"];
  for (const table of tables) {
    assert.equal(sql(`select relrowsecurity from pg_class where relname='${table}'`), "t", `${table}: RLS açık`);
    assert.equal(sql(`select count(*) from pg_policies where tablename='${table}'`), "0", `${table}: politika yok`);
    for (const role of ["anon", "authenticated"]) {
      fails(`set role ${role}; select * from ${table} limit 1`, /permission denied/);
      fails(`set role ${role}; delete from ${table}`, /permission denied/);
    }
  }
  fails("set role anon; insert into league_players(nickname,nickname_key,recovery_hash) values ('Hack','hack','x')", /permission denied/);
  fails("set role anon; update league_predictions set home_goals=9", /permission denied/);
  for (const fn of ["league_register('a','a','a','a','a')", "league_submit_prediction('a','1',1,1)", "league_settle_fixture('100')", "league_leaderboard('week','x',5)", "league_me('a','a','a','a')", "league_login('a','a','a')", "league_logout('a')"]) {
    for (const role of ["anon", "authenticated"]) fails(`set role ${role}; select ${fn}`, /permission denied for function/);
  }
  // Tablo yetkisi verilse bile RLS (politikasız) satır göstermez: ikinci savunma hattı.
  sql(`grant select on ${tables.join(", ")} to anon`);
  for (const table of tables) assert.equal(sql(`set role anon; select count(*) from ${table}`).split("\n").pop(), "0", `${table}: yetki verilse de RLS 0 satır`);
  sql(`revoke select on ${tables.join(", ")} from anon`);
  // service_role fonksiyonları çağırabilir.
  assert.equal(sql("set role service_role; select count(*) from league_leaderboard('week','x',5)").split("\n").pop(), "0");
  assert.match(sql("set role service_role; select league_settle_fixture('100')").split("\n").pop(), /fixtureId/);
  console.log("  ok  RLS açık/politikasız; anon & authenticated hiçbir tablo ya da fonksiyona erişemez; service_role çağırabilir");

  // ── Hesap silinince tahminler gider (KVKK) ───────────────────────────
  sql(`delete from league_players where id='${ids[1]}'`);
  assert.equal(sql(`select count(*) from league_predictions where player_id='${ids[1]}'`), "0", "silinen hesabın tahminleri (kilitli olanlar dahil) cascade ile silinir");
  console.log("  ok  hesap silinince kişinin tüm verisi cascade ile gider");
} finally {
  run(["-d", "postgres", "-c", `drop database if exists ${DB}`]);
}
console.log("prediction-league-db: tamam");
