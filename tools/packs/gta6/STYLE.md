# GTA VI Türkçe çeviri üslubu

Bu dosya, GTA VI metnini çeviren her kişi ve ajan için ortak kural setidir. Terimler `GLOSSARY.md`'de, etiketler
`TAGS.md`'de. Bu üç dosya çelişirse sıra şöyle: aşağıdaki değişmez kural > `TAGS.md` > `GLOSSARY.md` > bu dosyanın
geri kalanı.

## Değişmez kural: küfür ve hakaret sansürlenmez

**Çevirilerde küfür ve hakaret asla sansürlenmez ya da yumuşatılmaz; aynı sertlikte karşılık verilir.**

- Irkçı, cinsiyetçi ve aşağılayıcı hakaretler de bu kurala dahildir.
- Sert bir kelime daha hafif bir kelimeyle ("pislik", "korkak", "kanka" gibi) karşılanmaz; harflerle gizlenmez
  (`s*ktir`), atlanmaz.
- Sözlükte karşılığı olmayan bir küfür ya da hakaret, bağlama göre aynı sertlikte bir Türkçe karşılıkla çevrilir.
- Sertleştirme de yapılmaz: İngilizcede olmayan bir küfür eklenmez.
- Sözlükte bu kurala aykırı bir eşleme görürsen onu kullanma, issue'da bildir.

## Hedef

Türkçe altyazıyı TV'de oyunun üstünde okuyan biri, profesyonel bir altyazı çevirmeninin elinden çıkmış gibi doğal,
konuşma dilinde bir metin görmeli. Çeviri İngilizceyi kelime kelime izlemez, cümlenin anlamını ve tonunu taşır.

## Bağlam

- Satırlar tablo içinde sırasıyla gelir. Bir tablo genelde bir sahne, bir telefon konuşması ya da bir NPC'nin söz
  havuzudur.
- Çevirmeden önce tablonun tamamını, en azından çevrilen satırın öncesini ve sonrasını oku.
- Konuşmacı bilgisi yok. Kimin konuştuğunu komşu satırlardan çıkar. Emin değilsen hitabı ve cinsiyeti nötr bırakan bir
  yapı seç (Türkçede bu kolay; "o" cinsiyetsizdir).
- Ortam diyaloğu tablolarında (polis telsizi, yaya laf atmaları) satırlar birbirine bağlı değildir. Her satırı tek başına
  çevir, ama aynı tablodaki tonu koru.

## Hitap

- Varsayılan "sen". Arkadaş, aile, düşman, çete, sokak: hep "sen".
- "Siz" yalnızca resmî hitapta: polis halka konuşurken, görevli ve memurlarda, yabancı bir yetişkine saygıyla.
- Bir sahnede bir kez seçilen hitap o sahne boyunca değişmez.

## Küfür ve argo

- Küfür aynı şiddette kalır (yukarıdaki değişmez kural). Sık geçen karşılıklar `GLOSSARY.md`'de.
- Argo, argoyla karşılanır. "Ahbap", "dostum", "kardeş" gibi hitaplar için sözlüğe bak.

## Arayüz metinleri

- Kısa tut. Arayüz metni İngilizcesinin 1,3 katını geçmesin; `validate.py` geçeni işaretler.
- Büyük harfle yazılmış oyun mesajları büyük harfle kalır (WASTED = ÖLDÜN, BUSTED = YAKALANDIN).
- Görev hedefleri emir kipindedir: "Arabaya bin.", "Polislerden kurtul."
- Menü başlıkları ve düğmeler İngilizcedeki gibi baş harfi büyük kalır.

## İsimler

- Karakter, yer, marka, radyo, şirket ve kurum isimleri aynen kalır (liste `GLOSSARY.md` → "Aynen kalanlar").
- Lakaplar anlamlıysa çevrilir, isim gibi kullanılıyorsa kalır. Emin değilsen aynen bırak ve `notes` alanına yaz.
- Türkçe ekler kesme işaretiyle eklenir: Lucia'yı, Vice City'de, Jason'ın.

## Özel satırlar

- `In Spanish: ...` ile başlayan satırlarda karakter İspanyolca konuşuyor, altyazı İngilizce veriliyor. Önek
  "İspanyolca:" olur, gerisi Türkçeye çevrilir. `Unknown Language:` öneki "Bilinmeyen dil:" olur.
- `[laughs]` gibi ses notları `extract.py` tarafından silinir; çevirmenin önüne gelmez.
- Ünlemler ve sesler Türkçe karşılığını alır ya da ses olarak kalır: Ugh → Öf, Huh → Ha?, Hmm → Hmm.
- Polis telsiz kodları (10-29, 442) ve sayılar aynen kalır.
- Bir satır yalnızca isimden ya da yer tutucudan oluşuyorsa aynen kalır.

## Noktalama

- Üç nokta, ?!, tırnak ve uzun çizgi İngilizcedeki gibi kalır.
- Türkçe yazım kurallarına uyulur: "de/da" ve "ki" ayrımı, büyük İ/ı.

## Örnek çiftler

Bu çiftler GTA V Türkçe paketinden alındı ve beklenen tonu gösterir.

| İngilizce | Türkçe |
|---|---|
| Dude! | Ahbap! |
| What the fuck? | Bu da ne amına koyayım? |
| Holy shit! | Ha siktir! |
| Fuck off! | Siktir git! |
| Lose the cops. | Polislerden kurtul. |
| Get in the car. | Arabaya bin. |
| Wasted | ÖLDÜN |
