import { NextResponse } from "next/server";
import { readRun } from "@/lib/orchestrator/runStore";
import { completeStage } from "@/lib/orchestrator/stateMachine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body = await request.json().catch(() => ({}));
  const projectSlug = body.projectSlug as string | undefined;
  const verdict = body.verdict as "approved" | "rejected" | undefined;
  const notes = body.notes as string | undefined;
  const flaggedScenes = (body.flaggedScenes as string[] | undefined) ?? [];

  if (!projectSlug || !verdict) {
    return NextResponse.json(
      { error: "projectSlug ve verdict gerekli." },
      { status: 400 },
    );
  }

  const state = await readRun(projectSlug, runId);
  if (!state) {
    return NextResponse.json({ error: "Run bulunamadı." }, { status: 404 });
  }
  if (state.stage !== "qc" || state.status !== "awaiting_operator") {
    return NextResponse.json(
      {
        error: `Run 'qc' aşamasında operatör bekliyor değil (stage: ${state.stage}, status: ${state.status}).`,
      },
      { status: 400 },
    );
  }

  const run = await completeStage(
    state,
    "qc",
    { qc: { verdict, notes, flaggedScenes } },
    `Claude Code operatörü (gemini CLI analiziyle) QC verdict'i verdi: ${verdict}.`,
    body.cost,
  );
  return NextResponse.json({ run });
}
