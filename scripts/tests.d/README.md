# `npm test` zinciri

`npm test` → `scripts/run-tests.mjs` → bu dizindeki `*.list` dosyaları (ada göre sıralı,
satır başına bir komut, `#` yorum). İlk başarısız komutta durur (eski `&&` zinciriyle aynı).

**Yeni test eklemek:** `scripts/tests.d/<konu>.list` dosyası oluşturun (ör. `55-haber-slug.list`)
ve içine komutu yazın:

```
node scripts/test-benim-testim.mjs
```

`package.json`'ın `test` satırına ve `00-base.list`'e DOKUNMAYIN: ortak satıra dokunan her PR
diğerleriyle çakışıyordu. `test-test-runner.mjs` `package.json`'da uzun satırın geri gelmesini,
listede var olmayan dosyayı ve tekrarlanan komutu reddeder.

```bash
npm test                              # hepsi
npm test -- --only=staleness          # komutu metin içerenler
node scripts/run-tests.mjs --list     # ne koşar?
```
