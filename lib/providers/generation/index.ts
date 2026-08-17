/**
 * `url` alanı bilinçli olarak "path" değil: bu modeller barındırılan bir URL döner.
 * Yerel dosya gerektiğinde (Remotion dizgisi, QC'nin görseli okuması, tarayıcıya
 * servis) lib/providers/download.ts ile indirilir. Zincirleme /edit çağrıları ise
 * URL'in kendisini referans olarak ister — bu yüzden ikisi de saklanır.
 */
export interface GeneratedImage {
  url: string;
}

/**
 * "reference"  → flux-pro/kontext: TEKİL image_url + aspect_ratio (image_size yok).
 *                Slide'lar arası stil tutarlılığı için — çapa görseli referans verilir.
 * "typography" → gpt-image-2/edit: image_urls DİZİSİ + image_size:"auto".
 *                Mevcut görselin ÜSTÜNE yazı yazmak için; yeni görsel üretmediği
 *                için stil sıçraması olmaz.
 * İki endpoint'in parametre şekilleri farklı, o yüzden tek metotta varyantla ayrılıyor.
 */
export type EditVariant = "reference" | "typography";

export interface GenerationProvider {
  name: string;
  generateImage(
    prompt: string,
    opts?: { width?: number; height?: number },
  ): Promise<GeneratedImage>;
  editImage(
    prompt: string,
    opts: {
      imageUrls: string[];
      variant: EditVariant;
      aspectRatio?: string;
    },
  ): Promise<GeneratedImage>;
  generateVideo(
    prompt: string,
    opts?: { imageUrl?: string; durationSec?: number },
  ): Promise<{ url: string }>;
}

// Seam only — real HTTP calls live in ./higgsfield.ts and ./fal.ts.
// Ajanlar MOCK_MODE açıkken sağlayıcıya hiç uğramadan kısa devre yapar.

/**
 * `higgsfield.ts` HÂLÂ İSKELET — üç metodu da throw ediyor (bkz. dosyanın kendi
 * başlığı). `HIGGSFIELD_API_KEY` set edildiği an burada `true` yapılmalı; o güne
 * kadar tercih sırasını buraya SABİTLİYORUZ. Aksi hâlde bir kullanıcı yalnızca
 * `HIGGSFIELD_API_KEY` girip `FAL_KEY`i boş bıraktığında `getGenerationProvider`
 * higgsfield'ı seçer ve TÜM üretim (carousel görselleri dahil) throw etmeye
 * başlar — anahtar koymak sistemi bozan bir hataydı, şimdi koyamıyor.
 */
const HIGGSFIELD_IMPLEMENTED = false;

/**
 * `!hasGenerationProvider()` iki yerde elle tekrarlanan
 * `!HIGGSFIELD_API_KEY && !FAL_KEY` koşulunun TEK yetkili yanıtı olsun diye var
 * (carousel/visual.ts, real-video/footage.ts). Aynı soruyu iki yerde yanıtlamak,
 * higgsfield gerçekten bağlandığında birinin unutulması demekti.
 */
export function hasGenerationProvider(): boolean {
  if (HIGGSFIELD_IMPLEMENTED && process.env.HIGGSFIELD_API_KEY) return true;
  return Boolean(process.env.FAL_KEY);
}

export async function getGenerationProvider(): Promise<GenerationProvider> {
  if (HIGGSFIELD_IMPLEMENTED && process.env.HIGGSFIELD_API_KEY) {
    const { higgsfieldProvider } = await import("./higgsfield");
    return higgsfieldProvider;
  }
  const { falProvider } = await import("./fal");
  return falProvider;
}
