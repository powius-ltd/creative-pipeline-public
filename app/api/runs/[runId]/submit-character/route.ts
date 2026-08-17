import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { characterDir } from "@/lib/modes/ai-video/karakter";
import { readRun } from "@/lib/orchestrator/runStore";
import { completeStage } from "@/lib/orchestrator/stateMachine";
import { toRelative } from "@/lib/providers/download";

/**
 * Operatör (Claude Code, Higgsfield MCP) karakter çapasını ürettiğinde sonucu
 * buraya bildirir.
 *
 * Gövde: { projectSlug, file, url? }
 *   "file" yalnızca DOSYA ADI — `characterDir(state)` altına atılmış olmalı.
 *   "url" OPSİYONEL: verilirse sonraki 'sahne' aşaması i2i referansı için onu
 *   kullanır (fal'a yerel dosya yüklenemez); verilmezse sahne üretimi de
 *   operatöre düşer — bu, sessizce yanlış bir referansla üretmekten iyi.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body = await request.json().catch(() => ({}));
  const projectSlug = body.projectSlug as string | undefined;
  const file = body.file as string | undefined;
  const url = (body.url as string | undefined) ?? "";

  if (!projectSlug || !file) {
    return NextResponse.json({ error: "projectSlug ve file gerekli." }, { status: 400 });
  }

  const state = await readRun(projectSlug, runId);
  if (!state) {
    return NextResponse.json({ error: "Run bulunamadı." }, { status: 404 });
  }
  if (state.stage !== "karakter" || state.status !== "awaiting_operator") {
    return NextResponse.json(
      {
        error: `Run 'karakter' aşamasında operatör bekliyor değil (stage: ${state.stage}, status: ${state.status}).`,
      },
      { status: 400 },
    );
  }

  // Yalnızca dosya adı kabul ediliyor — submit-footage'daki traversal
  // korumasıyla aynı gerekçe.
  const dir = characterDir(state);
  const base = path.basename(file);
  const abs = path.join(dir, base);
  const stat = await fsp.stat(abs).catch(() => null);
  if (!stat?.isFile()) {
    return NextResponse.json(
      { error: `Dosya bulunamadı: ${base} (beklenen konum: ${dir})` },
      { status: 400 },
    );
  }

  const run = await completeStage(
    state,
    "karakter",
    { assets: { ...state.assets, characterRef: { url, path: toRelative(abs) } } },
    `Operatör karakter çapasını bildirdi (${base})` +
      (url ? "." : " — url verilmedi, sahne üretimi de operatöre düşebilir."),
    body.cost,
  );
  return NextResponse.json({ run });
}
