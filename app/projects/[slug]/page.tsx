import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, listRuns } from "@/lib/orchestrator/runStore";
import { NewRunForm } from "@/components/dashboard/NewRunForm";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();

  const runs = await listRuns(slug);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-xs text-neutral-500 hover:underline">
        ← Projeler
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{project.name}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        {project.platform} · varsayılan toggle:{" "}
        {project.defaultAuto ? "otomatik" : "onaylı"}
      </p>

      <div className="mt-8">
        <NewRunForm
          projectSlug={slug}
          projectPlatform={project.platform}
          defaultMode={project.defaultMode ?? "carousel"}
          defaultAuto={project.defaultAuto}
        />
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Run&apos;lar
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-neutral-500">Henüz run yok.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((r) => (
              <li key={r.runId}>
                <Link
                  href={`/projects/${slug}/runs/${r.runId}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-800 px-4 py-3 hover:border-neutral-600"
                >
                  <span className="font-medium">{r.topic}</span>
                  <span className="text-xs text-neutral-500">
                    {r.stage} · {r.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
