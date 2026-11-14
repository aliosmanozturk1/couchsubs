# couchsubs-packs

Telefon uygulamasının (couchsubs-android) yeni ve güncellenen oyun paketlerini indirdiği Cloudflare Worker. Paketler
ücretsizdir; hesap, giriş ya da anahtar yoktur. Dosyalar R2'de durur. Uygulama, kendi içinde gelen paketlerin üstüne
buradaki daha yeni sürümleri koyar; masaüstü uygulamaları paketleri kendi içinde taşımaya devam eder.

| Yol | Ne verir | Önbellek |
|---|---|---|
| `GET /v1/packs` | `{"packs":[{id,title,version,sha256,size,entries}]}` (R2'deki `index.json`) | `public, max-age=3600` |
| `GET /v1/packs/:id` | `packs/<id>.json.gz`, `x-pack-sha256` ve `etag` başlıklarıyla; `If-None-Match` eşleşirse `304` | `public, max-age=86400` |

Kötüye kullanıma karşı IP başına (`CF-Connecting-IP`) saatte 60 paket indirme; aşılırsa `429` ve `retry-after`.
Sınır Worker örneği başına bellektedir (kaba kesme içindir); daha sıkı gerekirse Cloudflare'in Rate Limiting kuralı
eklenir. Uygulama indirdiği dosyayı listedeki SHA-256 ile doğrular, haftada bir yeniler.

## Kurulum (sahibin hesabıyla; 2026-11-15'te yapıldı)

Yayın adresi: `https://couchsubs-packs.enmera.workers.dev` (R2 kovası `couchsubs-packs`, liste sürümü 1).

```sh
cd server/packs
npm install
npx wrangler r2 bucket create couchsubs-packs

# Paketleri ve listeyi yükle (sürüm: artan bir sayı; uygulama sürümü değişen paketi yeniden indirir)
node scripts/build-index.mjs ../../core/Sources/CouchSubsCore/Resources/packs 1 > index.json
for f in ../../core/Sources/CouchSubsCore/Resources/packs/*.json.gz; do
  id=$(basename "$f" .json.gz)
  npx wrangler r2 object put "couchsubs-packs/packs/$id.json.gz" --file "$f" --content-type application/gzip --remote
done
npx wrangler r2 object put couchsubs-packs/index.json --file index.json --content-type application/json --remote
npx wrangler deploy
```

wrangler'ın `r2 object put` komutu özel metadata (`sha256`) yazamıyor; bu yüzden `x-pack-sha256` başlığı şimdilik
gelmez. Uygulamalar indirdiği dosyayı listedeki (`index.json`) SHA-256 ile doğrular, başlığa bakmaz.

Uygulamalardaki adres: Android `couchsubs-android/secrets.properties` içindeki `packs.url`; iPhone/iPad
`couchsubs-ios/Config/App.xcconfig` `PACKS_API_BASE_URL`; Mac `mac/project.yml` `PACKS_API_BASE_URL`; Windows yayın
derlemesinde `-p:CouchSubsPacksUrl` (`.github/workflows/windows.yml`).

## Test

```sh
npm install
npm test          # vitest: liste, indirme, 304, geçersiz kimlik, IP sınırı
npm run typecheck
```
