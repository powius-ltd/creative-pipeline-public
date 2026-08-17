import fs from "node:fs/promises";
import path from "node:path";
import { runAssetsDir } from "../../orchestrator/paths";
import { toRelative } from "../../providers/download";
import { carouselAspect } from "./channels";
import type { AgentResult, RunState, SlideAsset } from "../../orchestrator/types";
import { carouselPayload } from "../../orchestrator/types";

/**
 * Dizgi aşaması:
 *   - textMode "overlay" slide'lar: metin Remotion ile görselin üstüne basılır
 *   - textMode "baked"   slide'lar: yazı zaten görselin içinde, olduğu gibi geçer
 *   - caption.txt yazılır
 *
 * Mock modda hiç görsel üretilmemiş olur (basePath boş); o durumda TÜM slide'lar
 * Remotion'la degrade arka plan üzerine çizilir — para harcamadan gerçek PNG çıktısı.
 */

/**
 * Görsel data URI olarak geçiyor: renderStill bundle'ı headless Chrome'a http://
 * üzerinden servis ediyor, oradan projects/ altındaki yerel bir mutlak yola
 * erişilemiyor. staticFile() ise asset'in public/ altında olmasını isterdi.
 */
async function toDataUri(relPath: string): Promise<string | null> {
  if (!relPath) return null;
  try {
    const buf = await fs.readFile(path.resolve(process.cwd(), relPath));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function accentFrom(palette: string | undefined): string {
  const hex = palette?.match(/#[0-9a-fA-F]{6}/)?.[0];
  return hex ?? "#1f2937";
}

export async function runCarouselCompose(state: RunState): Promise<AgentResult> {
  const payload = carouselPayload(state);
  const slides = payload.slides;
  if (slides.length === 0) {
    throw new Error("Dizgi yapılamaz: slide yok.");
  }

  // Tembel import: still.ts @remotion/renderer'ı çekiyor ve renderer platforma özel
  // native binary'leri koşullu require ediyor. Statik import edilirse
  // app/page.tsx → runStore → estimate → modes → compose → renderer zinciri oluşup
  // derleyici bu platformda kurulu olmayan compositor paketlerini çözmeye kalkıyor.
  const { renderSlideStill } = await import("../../render/still");

  const dir = path.join(runAssetsDir(state.projectSlug, state.runId), "slides");
  await fs.mkdir(dir, { recursive: true });

  const slideAssets: Record<string, SlideAsset> = { ...(state.assets.slideAssets ?? {}) };
  const accent = accentFrom(payload.theme?.palette);
  const aspect = carouselAspect(state);
  let rendered = 0;

  for (const slide of slides) {
    const asset = slideAssets[slide.id] ?? { baseUrl: "", basePath: "" };
    const hasImage = Boolean(asset.basePath);

    // Yazı görselin içinde ve görsel gerçekten varsa dizgiye gerek yok.
    if (slide.textMode === "baked" && hasImage) {
      slideAssets[slide.id] = { ...asset, finalPath: asset.finalPath ?? asset.basePath };
      continue;
    }

    const outPath = path.join(dir, `${slide.id}.png`);
    await renderSlideStill(
      {
        headline: slide.headline,
        body: slide.body,
        role: slide.role,
        index: slide.index,
        total: slides.length,
        imageDataUri: await toDataUri(asset.basePath),
        accent,
        width: aspect.still.width,
        height: aspect.still.height,
      },
      outPath,
    );
    slideAssets[slide.id] = { ...asset, finalPath: toRelative(outPath) };
    rendered++;
  }

  const captionPath = path.join(
    runAssetsDir(state.projectSlug, state.runId),
    "caption.txt",
  );
  const captionBody = [
    payload.caption,
    "",
    payload.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
  ].join("\n");
  await fs.writeFile(captionPath, captionBody, "utf-8");

  return {
    patch: {
      assets: {
        ...state.assets,
        slideAssets,
        captionFile: toRelative(captionPath),
      },
    },
    note: `${rendered} slide dizildi, ${slides.length - rendered} slide zaten nihaiydi. caption.txt yazıldı.`,
    cost: { vendor: "compute", detail: "Remotion lokal still render", costUsd: 0 },
  };
}
