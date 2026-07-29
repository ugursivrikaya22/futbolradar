# Supabase — bulut bellek ve veritabanı katmanı

FutbolRadar'ın verisi hâlâ depodaki JSON dosyalarında yaşıyor. Supabase o
verinin **aynası** ve sitenin ürettiği analiz çıktısının **kalıcı belleği**.

## Neden resmî istemci kullanılmıyor?

`@supabase/supabase-js` bu depoya eklenemez:

- `package.json` **bağımlılıksız** — tek bir `dependency` yok.
- `vercel.json` içinde `"installCommand": ""` — dağıtımda `npm install`
  **hiç çalışmıyor**.

Resmî istemciyi bağımlılık olarak eklemek, üretimde var olmayan bir modülü
`require` etmek olurdu: yerelde çalışır, canlıda ilk istekte patlardı.

Supabase'in veri katmanı zaten sıradan bir HTTP arayüzü (PostgREST).
`services/supabase/restClient.js` onunla `fetch` üzerinden konuşuyor —
bağımlılıksız ve deponun mevcut sağlayıcı deseniyle aynı biçimde.

Sarmalayıcı kasıtlı olarak **dar**: sorgu kurucu, gerçek zamanlı abonelik,
depolama ve auth yok. Kullanılmayan yüzey, bakımı yapılmayan yüzeydir.

## İki anahtar, iki dünya

| Anahtar | Nereye gider | Sızarsa |
| --- | --- | --- |
| **anon** | Tarayıcıya verilebilir | Katlanılabilir — RLS onu okumaya kilitler |
| **service_role** | **Yalnızca sunucu** | **Felaket** — RLS'i baypas eder, veritabanının tamamına yazar |

Servis anahtarı için **üç katmanlı koruma** var ve üçü de gerekli:

1. `config.js` ve `serverClient.js` tarayıcı ortamı görürse **açıkça patlar**.
   Sessizce anon'a düşmek daha nazik olurdu ama tehlikeli: yanlış yapılandırma
   görünmez kalırdı.
2. Yalnızca `api/` ve `scripts/` bu modülleri `require` eder. `app.js` etmez.
3. `scripts/test-supabase-layer.mjs` yayımlanan çıktının tamamını (`app.js`,
   tüm HTML, `public/`) tarar ve ne anahtar **adının** ne de JWT biçiminde bir
   **değerin** geçmediğini doğrular.

Birincisi kazayı, ikincisi alışkanlığı, üçüncüsü ikisinin de kaçırdığını
yakalar.

## Ortam değişkenleri

Kod hiçbir anahtarı içermez; hepsi ortamdan okunur. Birden fazla ad tanınır
çünkü Supabase panosu, Vercel entegrasyonu ve yerel `.env` farklı adlar
öneriyor.

| Amaç | Kabul edilen adlar (ilk dolu olan kullanılır) |
| --- | --- |
| Proje adresi | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_URL`, `VITE_SUPABASE_URL` |
| Anon anahtar | `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY` |
| Servis anahtarı | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SECRET_KEY` |

Servis anahtarı için `NEXT_PUBLIC_`/`PUBLIC_`/`VITE_` ön ekli adlar **bilerek
kabul edilmiyor**: o ön ekler değeri istemci paketine gömmek için vardır.
Böyle adlandırılmış bir servis anahtarı varsa sağlık ucu ve yönetim paneli
bunu **uyarı olarak** yazar.

## Şema

`supabase/migrations/` altında beş göç, sırayla çalıştırılır:

| Dosya | Ne kurar |
| --- | --- |
| `0001_extensions.sql` | `pgcrypto`, `pgvector` (varsa), ortak `set_updated_at()` |
| `0002_core_entities.sql` | `teams`, `players`, `matches`, `transfers` |
| `0003_analysis_layer.sql` | `match_reports`, `analysis_rules`, `radar_scores`, `data_coverage_logs`, `analysis_jobs`, `stuck_matches` görünümü |
| `0004_ai_memory.sql` | `ai_memory_documents`, `ai_memory_chunks`, vektör sütunu ve `match_memory_chunks()` |
| `0005_row_level_security.sql` | Her tabloda RLS + politikalar + `rls_status()` |

### Şema, kuralları veritabanı seviyesinde zorlar

Uygulama katmanı bu kuralları zaten uyguluyor — ama uygulama tek giriş yolu
değil. Elle atılan bir SQL, bozuk bir senkron ya da ileride yazılacak başka
bir istemci de yazabilir. Bu yüzden kritik kurallar `CHECK` kısıtı olarak da
duruyor:

- `matches_score_is_complete_or_absent` — skor ya tam gelir ya hiç.
  "2-?" diye bir sonuç yoktur.
- `transfers_confirmed_needs_source` — kaynağı olmayan transfer `confirmed`
  olamaz.
- `transfers_rumour_is_not_confirmed` — söylenti kesinleşmiş sayılamaz.
- `players_provider_id_numeric` — `mock-...` yer tutucu kimlikler girmez.
- `radar_scores_zero_coverage_has_no_score` — kapsamı sıfır olan puan olamaz.
- `match_reports_status_known` — durum **zorunlu** ve kapalı kümeden.

Son madde, "hiçbir maç faydalı bir durum olmadan takılı kalmasın" sözünün şema
karşılığı: durumsuz bir rapor artık **var olamaz**.

### pgvector isteğe bağlı

Uzantı kurulamazsa göç durmaz: vektör sütunu ve `match_memory_chunks()`
atlanır, bellek katmanı metin saklamaya devam eder. Anlamsal arama çalışmaz
ama yazma ve okuma çalışır. Yarım kurulu bir veritabanı, kurulmamış olandan
daha zararlıdır; bu yüzden her adım kendi ön koşulunu kontrol eder.

Fonksiyon, uzantı yoksa **hiç oluşturulmaz** — var olup boş dönen bir arama,
"sonuç yok" ile "arama çalışmıyor" arasındaki farkı gizlerdi.

## Satır düzeyi güvenlik

| Tablo grubu | anon | service_role |
| --- | --- | --- |
| `teams`, `players`, `matches`, `transfers`, `match_reports`, `analysis_rules`, `radar_scores` | okur | tam yetki |
| `data_coverage_logs`, `analysis_jobs`, `ai_memory_*` | **erişim yok** | tam yetki |

İkinci gruba anon erişimi **bilerek** yok: `data_coverage_logs` "neyi
ölçemiyoruz" listesidir ve bir saldırgan için zafiyet haritasıdır;
`analysis_jobs` koşu takvimini açık eder; AI belleği henüz yayımlanmamış metin
içerebilir.

Hiçbir tabloya anon için `insert/update/delete` politikası yazılmadı. RLS
altında politikası olmayan işlem **reddedilir** — yani anon anahtar sızsa bile
tek satır yazılamaz.

## Kullanım

```bash
# Kuru koşu: ne yazılacağını gösterir, hiçbir şey yazmaz
node scripts/sync-supabase.mjs

# Gerçekten yazar
node scripts/sync-supabase.mjs --apply

# Yalnızca belirli adımlar
node scripts/sync-supabase.mjs --apply --only=matches,reports,radar
```

Senkron **tek yönlü**: depo → Supabase. Ters yön bilerek yok, çünkü o an
"hangisi doğru?" sorusu ortaya çıkar ve iki kaynak sessizce ayrışır.

Yalnızca **kapıdan geçen** veri yazılır: transferler
`services/transferService.js`, raporlar `services/matchReportService.js`
üzerinden. Kapıda elenen kaydı buluta yazmak, kuralı arka kapıdan delmek
olurdu.

## Sağlık

```
/api/supabase-health          # yalnızca yapılandırma, ağa çıkmaz
/api/supabase-health?probe=1  # bağlantı + tablo + RLS durumu
```

Kendi dosyası **yok ve olamaz**: `api/` dizini Vercel Hobby planının 12
fonksiyon sınırında. Uç, `api/[...route].js` üzerinden servis ediliyor.

`?probe=1` verilmedikçe ağa çıkılmaz — her sağlık isteğinin veritabanına
gitmesi gereksiz yük olurdu.

Rapor üç ayrı soruyu ayırır, çünkü üçü farklı sebeplerle bozulur:

1. **Yapılandırma** — değişkenler tanımlı mı, doğru isimde mi, biçimi sağlam mı?
2. **Bağlantı** — adres ve anahtarla gerçekten konuşabiliyor muyuz?
3. **Şema** — tablolar kurulu mu, RLS açık mı, kaç satır var?

"Anahtar tanımlı" ile "anahtar çalışıyor" farklı şeyler: doğru biçimde ama
süresi dolmuş, yanlış projeye ait ya da yetkisi alınmış bir anahtar da tanımlı
görünür.

## Yönetim paneli

`yonetim-paneli.html` içindeki **Supabase durumu** bölümü yapılandırmayı
gösterir. Derleme zamanında **ağa çıkmaz**: derleme bir dış servisin o anki
durumuna bağlı olmamalı. Canlı durum için sağlık ucu kullanılır.

Panel `noindex` taşır ve site haritasına girmez.

## Supabase kapalıyken

Her şey çalışır. Anahtar yoksa:

- Depolar `{ skipped: true }` döner.
- Senkron ne yapılacağını yazar ve `0` ile çıkar.
- Sağlık ucu `mode: "not-configured"` der.
- Panel "Bulut katmanı: Kapalı" yazar.

Bu bir arıza değil — geliştirme ve CI ortamlarında anahtar yok ve olmaması
beklenen durum.
