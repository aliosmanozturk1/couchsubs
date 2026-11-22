# Ajanla tablo çevirme akışı

Bu dosya, GTA VI metnini çeviren bir ajanın (ör. Claude Code) adımlarını anlatır. Görevi bir insan da aynı adımlarla
yapabilir. Amaç, farklı kişilerin farklı ajanlarla çevirdiği tabloların aynı üslupta çıkması.

## Başlamadan önce

1. Şu dosyaları oku: `TAGS.md`, `GLOSSARY.md`, `STYLE.md`. Çelişki olursa öncelik bu sırayla.
2. Dökümü kendi bilgisayarına indir: [psviethoa/gta6-text-en](https://github.com/psviethoa/gta6-text-en) (döküm:
   CyberLeek). Döküm ve çeviriler depoya **girmez**; hiçbir commit'e ya da PR'a eklenmez.
3. Koordinasyon issue'sundaki listeden üzerinde kimsenin çalışmadığı bir tablo seç ve adını yazarak al.

## Model ayarı

Herkes aynı ayarla çalışır, yoksa üslup tutmaz.

- Model ve effort: koordinasyon issue'sunda yazan (öneri: `claude-opus-5-5`, effort `medium`).
- Sözlükte ya da bu rehberlerde olmayan bilgi için web'e bakma. Emin olmadığın satırı `notes` alanına yaz.

## Adımlar

1. **Tabloyu çıkar.**

   ```sh
   python3 -I tools/packs/extract.py gta6 <döküm klasörü> work/C0100.rows.jsonl --table C0100
   ```

   Her satırda `id`, `scene`, `category`, `text` ve `sents` (cümleler) bulunur.
2. **Tabloyu baştan sona oku.** Çevirmeye başlamadan önce sahnenin ne olduğunu, kimlerin konuştuğunu ve tonu çıkar.
   Bunu iki üç cümleyle `work/C0100.scene.md`'ye yaz. Büyük tablo parça parça çevrilirken her parçada bu not bağlam
   olarak kullanılır.
3. **Sırayla çevir.** Satırları dosyadaki sırayla çevir. Büyük tablolarda 150 satırlık parçalarla çalış ve her
   parçanın başında önceki 30 satırın İngilizcesini ve Türkçesini bağlam olarak tut.
4. **Çıktıyı yaz.** `work/C0100.tr.jsonl` dosyasına, satır başına bir JSON:

   ```json
   {"id": "C0100_ADB26A09", "tr": ["Şimdi o kıç benim!"], "notes": ""}
   ```

   - `id` satırdaki `id`'dir, aynen kopyalanır.
   - `tr`, satırın `sents` listesindeki her cümle için bir Türkçe cümledir; sayı ve sıra aynı kalır. Oyun bir cümleyi
     tek başına gösterebildiği için her cümle kendi başına okunabilmeli.
   - Her satır için bir kayıt yazılır; satır atlanmaz, birleştirilmez.
   - `notes` boş kalabilir. Emin olmadığın bir isim, belirsiz bir hitap ya da bir sözlük önerisi varsa buraya yaz.
5. **Doğrula.**

   ```sh
   python3 -I tools/packs/validate.py work/C0100.rows.jsonl work/C0100.tr.jsonl
   ```

   `ERROR` veren satırları düzelt; script hatasız geçene kadar tekrarla. `WARN` satırlarına bak, gerekiyorsa düzelt.
6. **Teslim et.** Koordinasyon issue'sunda yazan teslim kanalını kullan. `.tr.jsonl` public bir depoya konmaz.

Paketi derleyen kişi teslim edilen dosyaları birleştirir, ardından:

```sh
python3 -I tools/packs/validate.py all.rows.jsonl all.tr.jsonl --write gta-6.lines.json
python3 tools/packs/build.py gta-6.lines.json gta-6.json.gz gta-6 "Grand Theft Auto VI" "<kaynak>" <paket klasörü>
```

## Yapma

- Yer tutucuları değiştirme, ekleme ya da silme (`TAGS.md`).
- Cümleleri birleştirme ya da bölme.
- Sözlükteki "aynen kalan" isimleri çevirme.
- Bir tabloyu yarım bırakıp teslim etme. Bitiremeyeceksen issue'da tabloyu bırak.
- Sözlüğü kendi başına değiştirme. Önerini `notes`'a ya da issue'ya yaz; sözlük tek yerden güncellenir.

## Sözlük değişikliği

Yeni bir terime (ör. bir çete adının Türkçesi) karar verilmesi gerekirse koordinasyon issue'sunda önerilir. Karar
`glossary/gta6.json`'a yazılır, ardından `python3 -I tools/packs/gta6glossary_md.py` ile `GLOSSARY.md` yeniden
üretilir.
