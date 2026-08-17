import { fal } from "@fal-ai/client";
import type { EditVariant, GeneratedImage, GenerationProvider } from "./index";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const credentials = process.env.FAL_KEY;
  if (!credentials) {
    throw new Error("FAL_KEY tanımlı değil (.env.local).");
  }
  fal.config({ credentials });
  configured = true;
}

// İmge üretimi ucuz modelde, tipografi pahalı modelde — gpt-image-2 yalnızca
// yazı yazdığı yerde devrede. Bkz. lib/modes/carousel/visual.ts.
const IMAGE_MODEL = process.env.FAL_IMAGE_MODEL ?? "fal-ai/flux/dev";
const IMAGE_REF_MODEL = process.env.FAL_IMAGE_REF_MODEL ?? "fal-ai/flux-pro/kontext";
const TYPOGRAPHY_MODEL =
  process.env.FAL_TYPOGRAPHY_MODEL ?? "openai/gpt-image-2/edit";
const VIDEO_MODEL =
  process.env.FAL_VIDEO_MODEL ?? "fal-ai/kling-video/v1.6/standard/image-to-video";

function firstImageUrl(data: unknown, model: string): string {
  const images = (data as { images?: { url?: string }[] })?.images;
  const url = images?.[0]?.url;
  if (!url) throw new Error(`${model} boş sonuç döndürdü.`);
  return url;
}

/**
 * İki edit endpoint'inin şemaları uyuşmuyor, o yüzden girdiyi burada ayırıyoruz:
 *   kontext          → image_url (TEKİL string) + aspect_ratio, image_size YOK
 *   gpt-image-2/edit → image_urls (DİZİ, max 16) + image_size ("auto" girdiden çıkarır)
 */
function buildEditInput(
  prompt: string,
  opts: { imageUrls: string[]; variant: EditVariant; aspectRatio?: string },
): { model: string; input: Record<string, unknown> } {
  if (opts.variant === "typography") {
    return {
      model: TYPOGRAPHY_MODEL,
      input: {
        prompt,
        image_urls: opts.imageUrls.slice(0, 16),
        image_size: "auto",
        output_format: "png",
        quality: "high",
      },
    };
  }

  return {
    model: IMAGE_REF_MODEL,
    input: {
      prompt,
      image_url: opts.imageUrls[0],
      output_format: "png",
      ...(opts.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
    },
  };
}

export const falProvider: GenerationProvider = {
  name: "fal",

  async generateImage(prompt, opts): Promise<GeneratedImage> {
    ensureConfigured();
    const result = await fal.subscribe(IMAGE_MODEL, {
      input: {
        prompt,
        output_format: "png",
        ...(opts?.width && opts?.height
          ? { image_size: { width: opts.width, height: opts.height } }
          : {}),
      },
      logs: false,
    });
    return { url: firstImageUrl(result.data, IMAGE_MODEL) };
  },

  async editImage(prompt, opts): Promise<GeneratedImage> {
    ensureConfigured();
    if (opts.imageUrls.length === 0) {
      throw new Error("editImage en az bir referans görsel ister.");
    }
    const { model, input } = buildEditInput(prompt, opts);
    const result = await fal.subscribe(model, { input, logs: false });
    return { url: firstImageUrl(result.data, model) };
  },

  async generateVideo(prompt, opts) {
    ensureConfigured();
    const result = await fal.subscribe(VIDEO_MODEL, {
      input: {
        prompt,
        ...(opts?.imageUrl ? { image_url: opts.imageUrl } : {}),
        duration: String(opts?.durationSec ?? 5),
      },
      logs: false,
    });
    const url = (result.data as { video?: { url: string } })?.video?.url;
    if (!url) throw new Error("fal.ai video üretimi boş sonuç döndürdü.");
    return { url };
  },
};
