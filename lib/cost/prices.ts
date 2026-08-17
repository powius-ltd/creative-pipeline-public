// Tek fiyat kaynağı. Fiyatlar değişir — güncel tutmak için burayı düzenle.
// Kaynaklar (2026-07 itibarıyla):
//   Claude Opus 4.8 (orkestrasyon/operatör): $5/1M girdi, $25/1M çıktı — resmi Anthropic fiyatı
//   ElevenLabs multilingual_v2: ~$0.10 / 1000 karakter (Flash/Turbo ~$0.05)
//   fal görsel (Flux dev): ~$0.03/görsel; video (Kling): ~$0.07/saniye
//   Higgsfield: kredi tabanlı, $ karşılığı tahmini (operatör modunda)
//   Gemini QC: kullanıcının kendi OAuth CLI'sı — doğrudan API maliyeti yok

export const PRICES = {
  // Claude — $/1M token
  claudeInputPerM: 5,
  claudeOutputPerM: 25,

  // ElevenLabs ses — $/1000 karakter (multilingual_v2)
  elevenLabsPerKChar: 0.1,
  // ElevenLabs Music — $/saniye (tahmini; hesap planına göre değişir)
  elevenLabsMusicPerSec: 0.01,

  // fal — görsel başına $ ve video saniyesi başına $
  falImageEach: 0.03,
  falVideoPerSec: 0.07,
  // flux-pro/kontext (referanslı üretim) — flux/dev'den pahalı, tahmini
  falImageRefEach: 0.04,
  // gpt-image-2/edit — fal fiyatı "1 unit" olarak opak dönüyor; bu değer TAHMİN.
  // İlk gerçek carousel run'ından sonra fal faturasına bakıp buraya yazılmalı.
  gptImageEditEach: 0.19,

  // Higgsfield — sahne başına $ (kredi tabanlı, tahmini)
  higgsfieldPerScene: 0.3,

  // Gemini QC — CLI/OAuth, doğrudan maliyet yok
  geminiPerRun: 0,

  // Gemini CLI çağrısı — abonelik üzerinden, doğrudan $ maliyeti YOK.
  // 0 yazmak "bedava" demek değil: token tüketimi CLI'nin JSON zarfındaki
  // `stats`inden okunup satırın `detail`ine yazılıyor ki tüketim görünür kalsın.
  geminiCliCall: 0,

  // Remotion render — para değil ZAMAN maliyeti (lokal GPU). Satır 0$ ama
  // `detail`e tahmini süre yazılıyor, çünkü asıl kıt kaynak burada dakikalar.
  // Ölçüm: 1080x1920 30fps, concurrency=4 → ~30 kare/sn (basit kompozisyon).
  renderFramesPerSec: 30,

  // claude CLI ajan çağrısı — ÖLÇÜLMÜŞ değerler (sonnet, bağlam kısma flag'leriyle).
  // Sıcak/soğuk farkı büyük ve prompt cache'ten geliyor:
  //   sıcak (cache_read)     : planner $0.06 · copywriter $0.04 · vision QC $0.13
  //   soğuk (cache_creation) : planner $0.22 · copywriter $0.28 · vision QC $0.33
  // Cache CLI çağrıları arasında yaşıyor, bu yüzden tüm ajanlar aynı sistem
  // promptunu paylaşıyor (bkz. lib/agents/claude-cli.ts). Ama CLI her
  // GÜNCELLENDİĞİNDE sistem promptu değişip cache soyu sıfırlanıyor — yani soğuk
  // fiyat düzenli olarak geri geliyor. Tahminler bu yüzden iki ucun ortasında.
  // Gerçek maliyet her çağrının JSON zarfından okunup 'actual'a yazılıyor.
  claudeCliCall: 0.12,
  claudeCliVisionCall: 0.25,
};

// Operatör (Claude Code) her aşamada token yakar. Aşağıdakiler kaba tahmindir;
// gerçek değer submit sırasında operatör tarafından bildirilebilir.
export const CLAUDE_STAGE_TOKENS = {
  // Senaryo asistı (brief) — insan+Claude sohbeti; kaba tahmin
  brief: { in: 4000, out: 3000 },
  // Görsel aşaması orkestrasyon sabiti (MCP çağrıları dışında)
  visualBase: { in: 2000, out: 1200 },
  // Görsel — sahne başına MCP orkestrasyon maliyeti
  visualPerScene: { in: 1500, out: 800 },
  // Final QC — videoyu değerlendirme + gemini çıktısını yorumlama
  qc: { in: 5000, out: 2000 },
};

// Sahne verisi henüz yokken (run yeni oluşturulduğunda) kullanılan varsayımlar.
export const SCENE_DEFAULTS = {
  count: 4,
  charsPerScene: 140,
  durationSec: 5,
};

export function claudeCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICES.claudeInputPerM +
    (outputTokens / 1_000_000) * PRICES.claudeOutputPerM
  );
}
