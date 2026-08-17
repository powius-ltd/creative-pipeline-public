import { NextResponse } from "next/server";
import { readRun } from "@/lib/orchestrator/runStore";
import { advanceRun } from "@/lib/orchestrator/stateMachine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body = await request.json().catch(() => ({}));
  const projectSlug = body.projectSlug as string | undefined;
  if (!projectSlug) {
    return NextResponse.json({ error: "projectSlug gerekli." }, { status: 400 });
  }

  const state = await readRun(projectSlug, runId);
  if (!state) {
    return NextResponse.json({ error: "Run bulunamadı." }, { status: 404 });
  }

  const run = await advanceRun(state);
  return NextResponse.json({ run });
}
