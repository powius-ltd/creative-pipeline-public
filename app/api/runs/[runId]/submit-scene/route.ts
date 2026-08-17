import { NextResponse } from "next/server";
import { sceneDir } from "@/lib/modes/ai-video/sahne";
import { measureClipsIn, type SubmittedClip } from "@/lib/modes/real-video/footage";
import { readRun } from "@/lib/orchestrator/runStore";
import { completeStage } from "@/lib/orchestrator/stateMachine";

/**
 * Operatör (Claude Code, Higgsfield MCP) 'sahne' aşamasının klip üretimini
 * dışarıda yaptığında sonucu buraya bildirir. `submit-footage/route.ts`'in
 * birebir aynı deseni — tek fark hedef aşama ve klasör.
 *
 * Gövde: { projectSlug, clips: [{ sceneId, file, inSec?, outSec? }] }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body = await request.json().catch(() => ({}));
  const projectSlug = body.projectSlug as string | undefined;
  const clips = body.clips as SubmittedClip[] | undefined;

  if (!projectSlug || !Array.isArray(clips) || clips.length === 0) {
    return NextResponse.json(
      { error: "projectSlug ve en az bir clip gerekli." },
      { status: 400 },
    );
  }

  const state = await readRun(projectSlug, runId);
  if (!state) {
    return NextResponse.json({ error: "Run bulunamadı." }, { status: 404 });
  }
  if (state.stage !== "sahne" || state.status !== "awaiting_operator") {
    return NextResponse.json(
      {
        error: `Run 'sahne' aşamasında operatör bekliyor değil (stage: ${state.stage}, status: ${state.status}).`,
      },
      { status: 400 },
    );
  }
  if (state.payload.kind !== "ai-video") {
    return NextResponse.json(
      { error: `Bu route ai-video yükü bekliyor ama run '${state.payload.kind}' modunda.` },
      { status: 400 },
    );
  }

  let measured;
  try {
    measured = await measureClipsIn(sceneDir(state), state.payload.scenes, clips);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  if (measured.footage.length === 0) {
    return NextResponse.json(
      {
        error:
          "Hiçbir klip ölçülemedi — dosyalar assets/scenes/ altında mı?\n" +
          measured.warnings.join("\n"),
      },
      { status: 400 },
    );
  }

  const run = await completeStage(
    state,
    "sahne",
    { payload: { ...state.payload, footage: measured.footage } },
    `Operatör ${measured.footage.length} sahne için klip bildirdi (ffprobe ile ölçüldü).` +
      (measured.warnings.length > 0
        ? `\nUYARILAR:\n  - ${measured.warnings.join("\n  - ")}`
        : ""),
    body.cost,
  );

  return NextResponse.json({ run, warnings: measured.warnings });
}
