import Link from "next/link";
import { listProjects } from "@/lib/orchestrator/runStore";
import { NewProjectForm } from "@/components/dashboard/NewProjectForm";

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Kreatif Üretim Pipeline</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Her proje kendi izole brand-memory ve run geçmişiyle çalışır.
      </p>

      <div className="mt-8">
        <NewProjectForm />
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Projeler
        </h2>
        {projects.length === 0 ? (
          <p className="text-sm text-neutral-500">Henüz proje yok.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/projects/${p.slug}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-800 px-4 py-3 hover:border-neutral-600"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-neutral-500">
                    {p.platform} · {p.defaultAuto ? "varsayılan: otomatik" : "varsayılan: onaylı"}
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
