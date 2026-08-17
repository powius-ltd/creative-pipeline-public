import { NextResponse } from "next/server";
import { readRun } from "@/lib/orchestrator/runStore";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const project = searchParams.get("project");
  if (!project) {
    return NextResponse.json({ error: "project query param gerekli." }, { status: 400 });
  }
  const run = await readRun(project, runId);
  if (!run) {
    return NextResponse.json({ error: "Run bulunamadı." }, { status: 404 });
  }
  return NextResponse.json({ run });
}
