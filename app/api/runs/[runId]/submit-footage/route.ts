import { NextResponse } from "next/server";
import { measureSubmittedClips, type SubmittedClip } from "@/lib/modes/real-video/footage";
import { readRun } from "@/lib/orchestrator/runStore";
import { completeStage } from "@/lib/orchestrator/stateMachine";

/**
 * Operatör materyal seçimini bitirdiğinde buraya bildirir.
 *
 * Gövde:
 *   { projectSlug, clips: [{ sceneId, file, inSec?, outSec? }], cost? }
 *
 * "file" yalnızca DOSYA ADI — klasör yolu değil. Ölçüm (süre/çözünürlük/fps/
 * rotasyon) burada ffprobe ile YAPILIYOR, operatörden istenmiyor: bunlar
 * gözlenebilir gerçekler ve tahmin edilirse çizelge sessizce kayar.
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
  // Bayat bir POST'un ilerlemiş bir run'ı bozmasını engelleyen kapı —
  // submit-qc/route.ts:27 ile aynı desen.
  if (state.stage !== "footage" || state.status !== "awaiting_operator") {
    return NextResponse.json(
      {
        error: `Run 'footage' aşamasında operatör bekliyor değil (stage: ${state.stage}, status: ${state.status}).`,
      },
      { status: 400 },
    );
  }
  if (state.payload.kind !== "real-video") {
    return NextResponse.json(
      { error: `Bu route real-video yükü bekliyor ama run '${state.payload.kind}' modunda.` },
      { status: 400 },
    );
  }

  let measured;
  try {
    measured = await measureSubmittedClips(state, clips);
  } catch (err) {
    // ffprobe patlarsa OperatorRequiredError gelir; run'ı ilerletmiyoruz.
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  if (measured.footage.length === 0) {
    return NextResponse.json(
      {
        error:
          "Hiçbir klip ölçülemedi — dosyalar assets/footage/ altında mı?\n" +
          measured.warnings.join("\n"),
      },
      { status: 400 },
    );
  }

  // `completeStage` sığ Object.assign yapıyor, o yüzden iç içe alanları BURADA
  // birleştiriyoruz (submit-visual/route.ts:44-50 ile aynı gerekçe).
  const run = await completeStage(
    state,
    "footage",
    {
      payload: { ...state.payload, footage: measured.footage },
      assets: { ...state.assets, footage: { ...(state.assets.footage ?? {}), ...measured.files } },
    },
    `Operatör ${measured.footage.length} klip bildirdi (ffprobe ile ölçüldü).` +
      (measured.warnings.length > 0
        ? `\nUYARILAR:\n  - ${measured.warnings.join("\n  - ")}`
        : ""),
    body.cost,
  );

  return NextResponse.json({ run, warnings: measured.warnings });
}
