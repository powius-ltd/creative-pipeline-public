import type { AspectSpec } from "../../config/aspect";
import type { GenerationProvider } from "../../providers/generation";

export interface GenerateClipInput {
  prompt: string;
  durationSec: number;
  aspect: AspectSpec;
  /**
   * Karakter/stil çapası. Verilmişse i2i (`editImage`, "reference" varyantı,
   * `carousel/visual.ts`'teki yıldız topolojisiyle AYNI desen) — verilmemişse
   * düz t2i.
   */
  refUrl?: string;
}

export interface GeneratedClip {
  videoUrl: string;
  keyframeUrl: string;
}

/**
 * t2i/i2i → i2v İKİ HOP.
 *
 * Önceden `real-video/footage.ts` doğrudan `generateVideo(prompt, {durationSec})`
 * çağırıyordu ama varsayılan model image-to-video
 * (`FAL_VIDEO_MODEL=kling-video/.../image-to-video`) ve `imageUrl` verilmeden
 * çağrılınca her sahne patlıyordu (`fal.ts` yalnızca verilirse `image_url`
 * ekliyor). Önce bir kare üretip o kareyi image-to-video'ya vermek ZORUNLU —
 * ve bu, ai-video'nun karakter tutarlılığı ihtiyacıyla (çapaya referans veren
 * i2i, sonra o kareden video) BİREBİR aynı iki hop. O yüzden tek yerde
 * toplandı: iki ayrı yerde yazılsaydı biri düzelir biri unutulurdu.
 */
export async function generateClip(
  provider: GenerationProvider,
  input: GenerateClipInput,
): Promise<GeneratedClip> {
  const { prompt, durationSec, aspect, refUrl } = input;

  const keyframe = refUrl
    ? await provider.editImage(prompt, {
        imageUrls: [refUrl],
        variant: "reference",
        aspectRatio: aspect.id,
      })
    : await provider.generateImage(prompt, {
        width: aspect.still.width,
        height: aspect.still.height,
      });

  const video = await provider.generateVideo(prompt, {
    imageUrl: keyframe.url,
    durationSec,
  });

  return { videoUrl: video.url, keyframeUrl: keyframe.url };
}
