# GTA VI metin etiketleri

Dökümdeki satırlarda `~...~` biçiminde etiketler var. Oyun bunları zamanlama, renk, tuş simgesi ya da sayı yerine
kullanır. `extract.py gta6` etiketlerin çoğunu çevirmen görmeden temizler; çevirmenin elinde yalnızca **yer tutucular**
kalır. Bu dosyadaki kurallar diğer rehberlerden önce gelir; `validate.py` bunları her satırda kontrol eder.

## Çevirmenin koruması gerekenler: yer tutucular

| Etiket | Dökümde | Anlamı |
|---|---:|---|
| `~1~`, `~2~` | 1.260 | Oyunun yerine sayı ya da isim koyduğu boşluk |
| `~1b~`, `~1$~`, `~1m~` | ~520 | Biçimli yer tutucu (konum, para, mesafe) |
| `~BLIP_*~` | 11.929 | Harita simgesi |
| `~INPUT_*~`, `~INPUTGROUP_*~`, `~ACTION_*~` | ~1.900 | Kumanda tuşu simgesi; `\|PromptId=...`, `\|UrgentPulse` ekleri dahil |

Kural: **her yer tutucu çeviride aynen ve aynı sayıda bulunur.** İçi çevrilmez, değiştirilmez; yer tutucu
eklenmez, silinmez. Cümledeki yeri Türkçe söz dizimine göre değişebilir.

- Yer tutucuya Türkçe ek eklenmez; cümle eke gerek bırakmayacak şekilde kurulur.
  Kötü: `~1~'i bul`. İyi: `Hedef: ~1~`.
- Tuş simgesi fiilin önüne gelebilir: `Hold ~INPUT_AIM~ to aim` → `Nişan almak için ~INPUT_AIM~ basılı tut`.

## extract.py'nin temizledikleri

Bunlar ekranda yazı olarak görünmez; çevirmen hiç görmez.

| Etiket | Dökümde | Ne yapılır |
|---|---:|---|
| `~sl:0:2.41~`, `~sl:0.66~` | ~49.000 | Oyun her parçayı ekranda ayrı gösterir, bu yüzden her parça **ayrı bir satır** olur (`id#0`, `id#1`…). Parçalar sırasıyla gelir; bir önceki parça bağlam olarak okunur |
| `~lr:...~` | 49 | Parça içi zamanlama; boşlukla değiştirilir |
| `~n~` | 16.812 | Yeni satır; boşlukla değiştirilir |
| `~b~`, `~o~`, `~s~`, `~m~`, `~c~`, `~e~`, `~f~`, `~d~`, `~t~`, `~rp~`, `~COLOR_*~`, `<b>` | ~14.000 | Renk ve biçim; silinir, araları kalır |
| `~case_lower~ ... ~case_end~` | 184 | Silinir, aradaki yazı kalır |
| `~tone~ [laughs] ~tone~`, `[grunts]` | ~4.400 | Ses notu; tamamen silinir |

Örnek: dökümdeki `~sl:0:2.41~That's the hotel over there. Triple homicide...~sl:0.66~They never found the ear.`
çevirmene iki satır olarak gelir:

```
C0000_C06E8024#0  That's the hotel over there. Triple homicide...
C0000_C06E8024#1  They never found the ear.
```

## validate.py'nin kontrol ettikleri

Hata (teslim edilemez):

1. Satırın çevirisi yok, ya da cümle sayısı tutmuyor.
2. Bir cümlenin çevirisi boş.
3. Yer tutucular İngilizcedekiyle birebir aynı değil.
4. Sözlükteki "aynen kalır" isimlerinden biri çeviride kaybolmuş.

Uyarı (bakılması gerekir):

1. Arayüz ya da eşya metni İngilizcenin 1,3 katından uzun.
2. İki kelimeden uzun bir cümle İngilizce bırakılmış.
