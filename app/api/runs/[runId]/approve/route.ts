import { NextResponse } from "next/server";
import { approveRun } from "@/lib/orchestrator/stateMachine";

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

  try {
    const run = await approveRun(projectSlug, runId);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
