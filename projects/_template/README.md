# _template

Bu klasör versiyonlanan tek proje klasörü — gerçek projeler burada değil, dashboard'daki
"Yeni Proje" formuyla (`POST /api/projects`) oluşturulur. O uç nokta `lib/orchestrator/runStore.ts`
içindeki `createProjectFromTemplate` fonksiyonuyla, tam olarak bu template'teki dosyaların
üreteceği izole yapıyı programatik olarak kurar:

```
projects/<slug>/
  config.json          # marka adı, platform, varsayılan mod, varsayılan toggle
  brand-memory/
    memory.json         # ton, geçmiş, rezerv varyantlar, performans
  runs/
    <runId>/
      state.json         # o run'ın tüm durumu (mod + payload dahil)
      assets/            # çıktılar — şekli moda göre değişir
```

## Mod başına asset düzeni

```
full-ai-video:                    carousel:
  assets/                           assets/
    voice/<sceneId>.mp3               slides/<slideId>-base.png   # üretilen ham görsel
    visual/<sceneId>.json             slides/<slideId>.png        # dizgi sonrası nihai
    timeline.json                     caption.txt                 # caption + hashtag'ler
```

`state.json` içindeki `payload` alanı moda göre diskriminasyonlu bir union:
video modunda `{ kind: "video", scenes }`, carousel'de
`{ kind: "carousel", theme, slides, caption, hashtags }`.

`config.example.json` config şemasının referansıdır — yeni bir alan eklemek istersen
önce burayı, sonra `runStore.ts`'deki `createProjectFromTemplate`'i güncelle.

Yeni bir MOD eklemek için `lib/modes/descriptors.ts` (aşama listesi + etiketler) ve
`lib/modes/<mod>/index.ts` (ajanlar + maliyet) yazılır; çekirdek durum makinesine
dokunmak gerekmez.
