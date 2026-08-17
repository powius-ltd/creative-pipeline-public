import path from "node:path";
import fs from "node:fs/promises";
import { isMock } from "../../config/mock";
import { OperatorRequiredError } from "../../orchestrator/operatorError";
import { runAssetsDir } from "../../orchestrator/paths";
import { downloadTo, toRelative } from "../../providers/download";
import {
  getGenerationProvider,
  hasGenerationProvider,
  type GeneratedImage,
} from "../../providers/generation";
import { PRICES } from "../../cost/prices";
import { carouselAspect } from "./channels";
import type { AgentResult, RunState, Slide, SlideAsset } from "../../orchestrator/types";
import { carouselPayload } from "../../orchestrator/types";

function buildOperatorInstructions(state: RunState, slides: Slide[]): string {
  const aspect = carouselAspect(state);
  const lines = slides
    .map((s) => `  - ${s.id} (${s.role}, ${s.textMode}): "${s.visualPrompt.slice(0, 120)}…"`)
    .join("\n");
  return (
    `FAL_KEY yok — carousel görselleri programatik üretilemiyor. Claude Code operatörü ` +
    `bu slide'ları Higgsfield MCP araçlarıyla üretmeli:\n${lines}\n` +
    `Slide boyutu ${aspect.still.width}×${aspect.still.height} (${aspect.id}).\n` +
    `Sonra POST /api/runs/${state.runId}/submit-visual ` +
    `{ projectSlug: "${state.projectSlug}", slideAssets: { <slideId>: { baseUrl, basePath } } } ` +
    `ile sonucu bildir.`
  );
}

/**
 * İki geçişli üretim:
 *
 *   GEÇİŞ 1 — İMGE (ucuz, tek model ailesi → tutarlı)
 *     slide-1     : t2i, stil çapası
 *     slide-2..N  : i2i (kontext), referans = çapa
 *
 *   GEÇİŞ 2 — TİPOGRAFİ (yalnızca textMode === "baked")
 *     üretilen görselin ÜSTÜNE gpt-image-2/edit ile yazı yazılır
 *
 * gpt-image-2 yeni görsel üretmiyor, mevcut görseli düzenliyor — bu yüzden pahalı
 * modeli yalnızca yazı yazdığı yerde kullanıyoruz ve stil sıçraması oluşmuyor.
 */
export async function runCarouselVisual(state: RunState): Promise<AgentResult> {
  const payload = carouselPayload(state);
  const slides = payload.slides;
  if (slides.length === 0) {
    throw new Error("Görsel üretilemez: plan aşaması slide üretmemiş.");
  }

  const aspect = carouselAspect(state);
  const dir = path.join(runAssetsDir(state.projectSlug, state.runId), "slides");
  await fs.mkdir(dir, { recursive: true });

  if (isMock("visual")) {
    // Mock'ta gerçek görsel yok; basePath boş bırakılıyor ve dizgi aşaması tüm
    // slide'ları (baked dahil) Remotion'la çiziyor. Böylece para harcamadan
    // uçtan uca gerçek PNG çıktısı alınıp hat doğrulanabiliyor.
    const slideAssets: Record<string, SlideAsset> = {};
    for (const s of slides) {
      slideAssets[s.id] = { baseUrl: "", basePath: "" };
    }
    return {
      patch: { assets: { ...state.assets, slideAssets } },
      note: `[MOCK] ${slides.length} slide için görsel atlandı — dizgi aşaması degrade arka planla çizecek.`,
    };
  }

  if (!hasGenerationProvider()) {
    throw new OperatorRequiredError(buildOperatorInstructions(state, slides));
  }

  const provider = await getGenerationProvider();
  const slideAssets: Record<string, SlideAsset> = { ...(state.assets.slideAssets ?? {}) };
  let anchorUrl: string | null = null;
  let refCalls = 0;
  let typoCalls = 0;

  for (const slide of slides) {
    // --- GEÇİŞ 1: imge ---
    const imagePrompt = `${slide.visualPrompt}\n\nGörselin içinde hiçbir yazı, harf veya rakam olmasın.`;

    // Açık tip: anchorUrl aşağıda generated.url'den atandığı için TS aksi halde
    // döngüsel çıkarım yapıp implicit any'ye düşüyor.
    const generated: GeneratedImage = anchorUrl
      ? await provider.editImage(imagePrompt, {
          imageUrls: [anchorUrl],
          variant: "reference",
          aspectRatio: aspect.id,
        })
      : await provider.generateImage(imagePrompt, {
          width: aspect.still.width,
          height: aspect.still.height,
        });

    if (anchorUrl) refCalls++;
    // İlk slide çapa olur; sonrakiler hep ona referans verir, zincirin kaymasını önler.
    if (!anchorUrl) anchorUrl = generated.url;

    let finalUrl = generated.url;

    // --- GEÇİŞ 2: tipografi (yalnızca baked) ---
    if (slide.textMode === "baked") {
      const typoPrompt = [
        "Bu görselin kompozisyonunu, rengini ve içeriğini KORUYARAK üstüne şu metni yerleştir:",
        `Başlık: ${slide.headline}`,
        slide.body ? `Alt metin: ${slide.body}` : "",
        payload.theme ? `Tipografi yönü: ${payload.theme.typography}` : "",
        "Metni okunaklı, doğru yazımla ve kompozisyondaki boşluğa yerleştir.",
        "Görselin kendisini yeniden üretme — yalnızca tipografi ekle.",
      ]
        .filter(Boolean)
        .join("\n");

      const typo = await provider.editImage(typoPrompt, {
        imageUrls: [generated.url],
        variant: "typography",
      });
      finalUrl = typo.url;
      typoCalls++;
    }

    // Zincirleme için URL, dizgi/QC/servis için yerel dosya — ikisi de saklanıyor.
    const basePath = await downloadTo(finalUrl, path.join(dir, `${slide.id}-base.png`));
    slideAssets[slide.id] = {
      baseUrl: finalUrl,
      basePath: toRelative(basePath),
      // baked slide'ın görseli zaten nihai; overlay'inki dizgi aşamasında tamamlanacak.
      ...(slide.textMode === "baked" ? { finalPath: toRelative(basePath) } : {}),
    };
  }

  const imageUsd =
    PRICES.falImageEach + refCalls * PRICES.falImageRefEach + typoCalls * PRICES.gptImageEditEach;

  return {
    patch: { assets: { ...state.assets, slideAssets } },
    note:
      `${slides.length} slide üretildi (1 çapa + ${refCalls} referanslı), ` +
      `${typoCalls} tanesine tipografi işlendi.`,
    cost: {
      vendor: "fal",
      // DİKKAT: bu ölçülmüş değil, PRICES sabitlerinden HESAPLANMIŞ bir tahmin.
      // fal çağrı başına fiyat döndürmüyor. Çağrı sayıları burada yazılı; gerçek
      // fiyatı öğrenmek için fal faturasını bu sayılara bölüp prices.ts'i güncelle.
      detail:
        `TAHMİNİ · 1 t2i + ${refCalls} kontext + ${typoCalls} gpt-image-2/edit ` +
        `(fal faturasıyla doğrula, prices.ts)`,
      costUsd: imageUsd,
    },
  };
}
