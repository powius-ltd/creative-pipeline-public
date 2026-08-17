"use client";

import { Player } from "@remotion/player";
import { useEffect, useState } from "react";
import { CreativeRunComposition, timelineDurationInFrames } from "@/remotion/CreativeRunComposition";
import { runToTimeline } from "@/lib/orchestrator/toTimeline";
import { costTotal } from "@/lib/cost/totals";
import { getDescriptor, stageLabel, stageOrder } from "@/lib/modes/descriptors";
import { CarouselPreview } from "./CarouselPreview";
import { RealVideoPreview } from "./RealVideoPreview";
import type { CostLine, RunState, StageId } from "@/lib/orchestrator/types";

function usd(n: number): string {
  return `$${n.toFixed(3)}`;
}

function CostCell({ lines }: { lines: CostLine[] | undefined }) {
  if (!lines || lines.length === 0) {
    return <span className="text-neutral-600">—</span>;
  }
  return (
    <span title={lines.map((l) => `${l.vendor}: ${l.detail}`).join("\n")}>
      {usd(costTotal(lines))}
    </span>
  );
}

function CostTable({ run, costStages }: { run: RunState; costStages: StageId[] }) {
  const cost = run.cost;
  if (!cost) return null;
  const estTotal = Object.values(cost.estimated).reduce((s, l) => s + costTotal(l), 0);
  const actTotal = Object.values(cost.actual).reduce((s, l) => s + costTotal(l), 0);

  return (
    <div className="rounded border border-neutral-800 p-3 text-xs">
      <p className="mb-2 font-medium">Maliyet (Claude token dahil)</p>
      <table className="w-full">
        <thead>
          <tr className="text-neutral-500">
            <th className="text-left font-normal">Aşama</th>
            <th className="text-right font-normal">Tahmini</th>
            <th className="text-right font-normal">Gerçek</th>
          </tr>
        </thead>
        <tbody>
          {costStages.map((stage) => (
            <tr key={stage} className="border-t border-neutral-900">
              <td className="py-1">{stageLabel(run.mode, stage)}</td>
              <td className="py-1 text-right font-mono text-neutral-400">
                <CostCell lines={cost.estimated[stage]} />
              </td>
              <td className="py-1 text-right font-mono">
                <CostCell lines={cost.actual[stage]} />
              </td>
            </tr>
          ))}
          <tr className="border-t border-neutral-700 font-medium">
            <td className="py-1">Toplam</td>
            <td className="py-1 text-right font-mono text-neutral-300">{usd(estTotal)}</td>
            <td className="py-1 text-right font-mono">{usd(actTotal)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-neutral-600">
        LLM aşamalarının &quot;gerçek&quot; sütunu claude CLI&apos;nin bildirdiği
        tutardır. Görsel fiyatları tahminidir (lib/cost/prices.ts). Hücrenin üstüne
        gelince kalem dökümü görünür.
      </p>
    </div>
  );
}

/** Hücre kodu: <segment>-<açı>, UTM/creative-key sözleşmesine göre üretilir. */
function hucreKodu(run: RunState): string | null {
  if (!run.brief) return null;
  return `${run.brief.segment}-${run.brief.aci}`;
}

function utmQuery(run: RunState): string | null {
  const hucre = hucreKodu(run);
  if (!hucre) return null;
  const campaign = `${hucre}-${run.runId}`;
  return `utm_source=${run.platform}&utm_medium=organic&utm_campaign=${campaign}`;
}

function MetricsForm({
  runId,
  projectSlug,
}: {
  runId: string;
  projectSlug: string;
}) {
  const [values, setValues] = useState({ izlenme: "", kaydetme: "", profilTik: "", trial: "" });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const metrics: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim() !== "") metrics[k] = Number(v);
    }
    const res = await fetch(`/api/runs/${runId}/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug, metrics }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Hata oluştu.");
      return;
    }
    setSaved(true);
  }

  if (saved) {
    return <p className="text-xs text-emerald-400">Metrik kaydedildi (brand-memory).</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      {(Object.keys(values) as (keyof typeof values)[]).map((key) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-neutral-500">{key}</span>
          <input
            type="number"
            value={values[key]}
            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            className="w-20 rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
          />
        </label>
      ))}
      <button
        onClick={submit}
        disabled={busy}
        className="rounded bg-neutral-700 px-3 py-1.5 text-white disabled:opacity-50"
      >
        {busy ? "…" : "Kaydet"}
      </button>
      {error ? <span className="text-red-400">{error}</span> : null}
    </div>
  );
}

export function RunView({
  projectSlug,
  runId,
  initialRun,
}: {
  projectSlug: string;
  runId: string;
  initialRun: RunState;
}) {
  const [run, setRun] = useState<RunState>(initialRun);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const qcRejected = run.qc.verdict === "rejected";

  const descriptor = getDescriptor(run.mode);
  const stages = stageOrder(run.mode);

  const isSettled =
    run.status === "published" || run.status === "awaiting_publish";

  useEffect(() => {
    if (isSettled) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/runs/${runId}/state?project=${projectSlug}`);
      if (res.ok) {
        const { run: fresh } = await res.json();
        setRun(fresh);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [runId, projectSlug, isSettled]);

  async function callAction(path: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setActionError(null);
    const res = await fetch(`/api/runs/${runId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug, ...extra }),
    });
    setBusy(false);
    const body = await res.json();
    if (!res.ok) {
      setActionError(body.error ?? "Hata oluştu.");
      return;
    }
    setRun(body.run);
  }

  const currentIndex = stages.indexOf(run.stage);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">{run.topic}</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {descriptor.label} · {run.auto ? "Toggle: otomatik" : "Toggle: onaylı"} ·
          durum: <span className="font-mono">{run.status}</span>
        </p>
      </div>

      {descriptor.frozen ? (
        <div className="rounded border border-neutral-700 bg-neutral-900/60 p-3 text-sm text-neutral-400">
          <span className="font-medium text-neutral-300">Bu mod dondurulmuş.</span>{" "}
          {descriptor.frozenReason}
          <p className="mt-1 text-xs text-neutral-500">
            Mevcut run açılmaya ve ilerlemeye devam eder; yeni run başlatılamaz.
          </p>
        </div>
      ) : null}

      <ol className="flex flex-wrap gap-2">
        {stages.map((stage, i) => {
          const done = i < currentIndex;
          const current = i === currentIndex;
          return (
            <li
              key={stage}
              className={`rounded-full border px-3 py-1 text-xs ${
                current
                  ? "border-white text-white"
                  : done
                    ? "border-neutral-600 text-neutral-400"
                    : "border-neutral-800 text-neutral-600"
              }`}
            >
              {stageLabel(run.mode, stage)}
            </li>
          );
        })}
      </ol>

      {run.error ? (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Hata: {run.error}
        </div>
      ) : null}

      {run.status === "awaiting_operator" && run.operatorTask ? (
        <div className="rounded border border-sky-800 bg-sky-950/30 p-3 text-sm text-sky-200">
          <p className="font-medium">
            Claude Code operatörü bekleniyor (
            {stageLabel(run.mode, run.operatorTask.stage)})
          </p>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-sky-300">
            {run.operatorTask.instructions}
          </pre>
        </div>
      ) : null}

      <div className="flex gap-3">
        {run.status === "awaiting_approval" ? (
          <button
            onClick={() => callAction("approve")}
            disabled={busy}
            className="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {busy ? "İşleniyor…" : `Onayla → ${stageLabel(run.mode, run.stage)}`}
          </button>
        ) : null}
        {run.status === "error" ? (
          <button
            onClick={() => callAction("advance")}
            disabled={busy}
            className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "İşleniyor…" : "Yeniden dene"}
          </button>
        ) : null}
        {run.status === "awaiting_publish" ? (
          qcRejected ? (
            // QC reddettiğinde tek tıkla yayın yok: önce reddi görüp bilinçli
            // olarak üzerine geçmek gerekiyor.
            <button
              onClick={() =>
                confirmPublish
                  ? callAction("publish", { force: true })
                  : setConfirmPublish(true)
              }
              disabled={busy}
              className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy
                ? "İşleniyor…"
                : confirmPublish
                  ? "Emin misin? QC reddine rağmen yayınla"
                  : "QC reddetti — yine de yayınla"}
            </button>
          ) : (
            <button
              onClick={() => callAction("publish")}
              disabled={busy}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "İşleniyor…" : "Yayınla (insan onayı)"}
            </button>
          )
        ) : null}
      </div>
      {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}

      {run.status === "published" ? (
        <div className="rounded border border-neutral-800 p-3 text-xs">
          <p className="font-medium text-neutral-300">Sonuç — UTM &amp; metrik girişi</p>
          {utmQuery(run) ? (
            <p className="mt-2 font-mono text-neutral-400 break-all">
              {utmQuery(run)}
            </p>
          ) : (
            <p className="mt-2 text-neutral-600">
              Bu run&apos;da konsept brief&apos;i yok — hücre kodu üretilemedi.
            </p>
          )}
          <p className="mt-1 text-neutral-600">
            Bu sorgu dizesini landing linkine ekle. 48 saat sonra metrikleri gir:
          </p>
          <div className="mt-2">
            <MetricsForm runId={runId} projectSlug={projectSlug} />
          </div>
        </div>
      ) : null}

      {run.brief ? (
        <div className="rounded border border-neutral-800 p-3 text-sm">
          <p className="font-medium">
            Konsept — {run.brief.segment} × {run.brief.aci}{" "}
            <span className="text-neutral-500">
              (funnel {run.brief.funnelKatmani}, {run.brief.icerikTipi}/{run.brief.hookAmaci})
            </span>
          </p>
          <p className="mt-2 text-neutral-300">
            Seçilen hook: &ldquo;{run.brief.secilenHook}&rdquo;
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Gerekçe: {run.brief.hucreGerekcesi}
          </p>
          <p className="mt-2 text-xs text-amber-300/90 whitespace-pre-wrap">
            Kreatif Muhalif: {run.brief.muhalifNotu}
          </p>
          <p className="mt-2 text-[11px] text-neutral-600">
            3 saniye testi insanda kalır — &quot;seçilen hook&quot;un ilk 3 kelimesinden
            sonra devam etmek istiyor musun? Diğer hook önerileri aşağıdaki &quot;Varyant
            fikirleri&quot;nde.
          </p>
        </div>
      ) : null}

      {run.qc.verdict !== "pending" ? (
        <div className="rounded border border-neutral-800 p-3 text-sm">
          <span className="font-medium">QC: {run.qc.verdict}</span>
          {run.qc.notes ? <p className="mt-1 text-neutral-400">{run.qc.notes}</p> : null}
          {run.qc.flaggedScenes && run.qc.flaggedScenes.length > 0 ? (
            <p className="mt-1 font-mono text-xs text-amber-400">
              İşaretlenen: {run.qc.flaggedScenes.join(", ")}
            </p>
          ) : null}
          {run.qc.mercekler ? (
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              {(["dikkat", "duygu", "marka"] as const).map((k) => (
                <div key={k} className="rounded border border-neutral-900 p-2">
                  <dt className="text-neutral-500">
                    {k} — {run.qc.mercekler![k].puan}/5
                  </dt>
                  <dd className="mt-1 text-neutral-400">{run.qc.mercekler![k].not}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}

      <CostTable run={run} costStages={descriptor.costStages} />

      <Preview run={run} projectSlug={projectSlug} />

      <details className="rounded border border-neutral-800 p-3 text-xs">
        <summary className="cursor-pointer text-neutral-400">
          Varyant fikirleri ({run.variants.length})
        </summary>
        <ul className="mt-2 flex flex-col gap-2">
          {run.variants.map((v) => (
            <li
              key={v.id}
              className={v.id === run.chosenVariantId ? "text-white" : "text-neutral-500"}
            >
              [{v.id === run.chosenVariantId ? "ÜRETİLDİ" : "rezerv"}] {v.label} —
              &ldquo;{v.hook}&rdquo; / CTA: {v.cta}
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded border border-neutral-800 p-3 text-xs">
        <summary className="cursor-pointer text-neutral-400">Geçmiş</summary>
        <ul className="mt-2 flex flex-col gap-1 font-mono">
          {run.history
            .slice()
            .reverse()
            .map((h, i) => (
              <li key={i} className="text-neutral-500">
                [{h.at.slice(11, 19)}] {h.stage} / {h.action}
                {h.note ? ` — ${h.note}` : ""}
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}

/** Önizleme modun çıktı tipine göre çatallanır. */
function Preview({ run, projectSlug }: { run: RunState; projectSlug: string }) {
  const output = getDescriptor(run.mode).output;

  if (output === "carousel") {
    return <CarouselPreview run={run} projectSlug={projectSlug} />;
  }
  if (output === "real-video") {
    return <RealVideoPreview run={run} projectSlug={projectSlug} />;
  }

  const timeline = runToTimeline(run);
  if (timeline.scenes.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Önizleme için henüz sahne yok — brief aşaması tamamlanınca burada görünür.
      </p>
    );
  }

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-lg border border-neutral-800">
      <Player
        component={CreativeRunComposition}
        inputProps={{ timeline }}
        durationInFrames={timelineDurationInFrames(timeline)}
        fps={timeline.fps}
        compositionWidth={1080}
        compositionHeight={1920}
        style={{ width: "100%" }}
        controls
        loop
      />
    </div>
  );
}
