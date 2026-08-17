import Link from "next/link";
import { notFound } from "next/navigation";
import { readRun } from "@/lib/orchestrator/runStore";
import { RunView } from "@/components/dashboard/RunView";

export default async function RunPage({
  params,
}: {
  params: Promise<{ slug: string; runId: string }>;
}) {
  const { slug, runId } = await params;
  const run = await readRun(slug, runId);
  if (!run) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href={`/projects/${slug}`}
        className="text-xs text-neutral-500 hover:underline"
      >
        ← {slug}
      </Link>
      <div className="mt-4">
        <RunView projectSlug={slug} runId={runId} initialRun={run} />
      </div>
    </main>
  );
}
