import { NextResponse } from "next/server";
import { readRun } from "@/lib/orchestrator/runStore";
import { completeStage } from "@/lib/orchestrator/stateMachine";
import type { SlideAsset } from "@/lib/orchestrator/types";

/**
 * Operatör (Claude Code) görsel aşamasının işini dışarıda yaptığında sonucu buraya
 * bildirir. Gövde moda göre değişir:
 *   full-ai-video → assets:      { <sceneId>: { image, video } }
 *   carousel      → slideAssets: { <slideId>: { baseUrl, basePath } }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body = await request.json().catch(() => ({}));
  const projectSlug = body.projectSlug as string | undefined;
  const assets = body.assets as
    | Record<string, { image: string; video: string }>
    | undefined;
  const slideAssets = body.slideAssets as Record<string, SlideAsset> | undefined;

  if (!projectSlug || (!assets && !slideAssets)) {
    return NextResponse.json(
      { error: "projectSlug ve assets (veya carousel için slideAssets) gerekli." },
      { status: 400 },
    );
  }

  const state = await readRun(projectSlug, runId);
  if (!state) {
    return NextResponse.json({ error: "Run bulunamadı." }, { status: 404 });
  }
  if (state.stage !== "visual" || state.status !== "awaiting_operator") {
    return NextResponse.json(
      {
        error: `Run 'visual' aşamasında operatör bekliyor değil (stage: ${state.stage}, status: ${state.status}).`,
      },
      { status: 400 },
    );
  }

  const merged = {
    ...state.assets,
    ...(assets ? { visual: { ...state.assets.visual, ...assets } } : {}),
    ...(slideAssets
      ? { slideAssets: { ...(state.assets.slideAssets ?? {}), ...slideAssets } }
      : {}),
  };
  const count = Object.keys(assets ?? slideAssets ?? {}).length;

  const run = await completeStage(
    state,
    "visual",
    { assets: merged },
    `Claude Code operatörü ${count} öğe için görsel üretti.`,
    body.cost,
  );
  return NextResponse.json({ run });
}
