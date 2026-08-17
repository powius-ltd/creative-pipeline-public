import { addReservedVariants } from "../brand-memory/store";
import { actualForStage } from "../cost/estimate";
import { stageOrder } from "../modes/descriptors";
import { getMode } from "../modes";
import { writeKunye } from "./kunye";
import { OperatorRequiredError } from "./operatorError";
import { readRun, writeRun } from "./runStore";
import type { ActualCostReport, ModeId, RunState, StageId } from "./types";

function nextStage(mode: ModeId, stage: StageId): StageId {
  const order = stageOrder(mode);
  const i = order.indexOf(stage);
  if (i === -1 || i === order.length - 1) return stage;
  return order[i + 1];
}

/**
 * Shared tail of a stage transition: apply the patch for `completedStage`, log it,
 * move the stage pointer forward, and branch on auto/ready_to_publish. Used both
 * by advanceRun (agent did the work) and the submit-visual/submit-qc routes (a
 * Claude Code operator did the work outside the agent function).
 */
export async function completeStage(
  state: RunState,
  completedStage: StageId,
  patch: Partial<RunState>,
  note: string,
  costReport?: ActualCostReport,
): Promise<RunState> {
  const introducedVariants = (patch.variants?.length ?? 0) > 0;

  Object.assign(state, patch);
  state.error = undefined;
  state.operatorTask = undefined;

  if (!state.cost) state.cost = { estimated: {}, actual: {} };
  // Tahminleri her aşamadan sonra tazeliyoruz: aşama yeni yapı bilgisi (sahne/slide
  // sayısı, textMode dağılımı) ürettiyse tahmin ancak böyle gerçeğe yaklaşır.
  state.cost.estimated = getMode(state.mode).estimate(state);
  state.cost.actual[completedStage] = actualForStage(state, completedStage, costReport);

  // Varyantlar modun hangi aşamasında üretilirse üretilsin (video modunda 'brief',
  // carousel'de 'copy') rezerve alınsın diye aşama adına değil patch'e bakıyoruz.
  if (introducedVariants) {
    await addReservedVariants(
      state.projectSlug,
      state.runId,
      state.variants,
      state.chosenVariantId,
    );
  }

  state.history.push({
    at: new Date().toISOString(),
    stage: completedStage,
    action: "agent_completed",
    note,
  });

  const upcoming = nextStage(state.mode, completedStage);
  state.stage = upcoming;

  if (upcoming === "ready_to_publish") {
    state.status = "awaiting_publish";
    return writeRun(state);
  }

  if (state.auto) {
    state.status = "running";
    await writeRun(state);
    return advanceRun(state);
  }

  state.status = "awaiting_approval";
  return writeRun(state);
}

/**
 * Runs the agent for `state.stage`.
 * - On success, hands off to completeStage to move the stage pointer forward.
 * - On OperatorRequiredError (MCP-only tool, or a CLI that isn't available/logged in),
 *   parks the run in 'awaiting_operator' with instructions for a Claude Code session
 *   to act on, then submit via the stage's submit-* route.
 * - On any other error, parks the run in 'error' for a manual retry.
 */
export async function advanceRun(state: RunState): Promise<RunState> {
  if (state.stage === "ready_to_publish" || state.stage === "published") {
    return state;
  }

  const agent = getMode(state.mode).agents[state.stage];
  if (!agent) {
    throw new Error(
      `Bilinmeyen aşama için ajan yok: ${state.mode}/${state.stage}`,
    );
  }

  const currentStage = state.stage;
  let result;
  try {
    result = await agent(state);
  } catch (err) {
    if (err instanceof OperatorRequiredError) {
      state.status = "awaiting_operator";
      state.operatorTask = { stage: currentStage, instructions: err.instructions };
      state.error = undefined;
      state.history.push({
        at: new Date().toISOString(),
        stage: currentStage,
        action: "operator_required",
        note: err.instructions,
      });
      return writeRun(state);
    }
    state.status = "error";
    state.error = err instanceof Error ? err.message : String(err);
    state.history.push({
      at: new Date().toISOString(),
      stage: currentStage,
      action: "agent_error",
      note: state.error,
    });
    return writeRun(state);
  }

  return completeStage(state, currentStage, result.patch, result.note, result.cost);
}

export async function approveRun(
  projectSlug: string,
  runId: string,
): Promise<RunState> {
  const state = await readRun(projectSlug, runId);
  if (!state) throw new Error("Run bulunamadı.");
  if (state.status !== "awaiting_approval") {
    throw new Error(
      `Run onay bekliyor değil (status: ${state.status}) — sadece 'awaiting_approval' durumundaki run'lar onaylanabilir.`,
    );
  }
  return advanceRun(state);
}

/**
 * QC reddettiyse yayın VARSAYILAN OLARAK engellenir — reddedilmiş bir işin
 * "yayına hazır" görünmesi yanlış. Ama kalıcı bir çıkmaz da olmamalı: insan
 * bilinçli olarak `force` ile üzerine geçebilir ve bu karar geçmişe yazılır.
 */
export async function publishRun(
  projectSlug: string,
  runId: string,
  opts: { force?: boolean } = {},
): Promise<RunState> {
  const state = await readRun(projectSlug, runId);
  if (!state) throw new Error("Run bulunamadı.");
  if (state.stage !== "ready_to_publish" || state.status !== "awaiting_publish") {
    throw new Error("Run henüz yayına hazır değil.");
  }

  const rejected = state.qc.verdict === "rejected";
  if (rejected && !opts.force) {
    throw new Error(
      `QC bu run'ı reddetti, yayın engellendi. ${state.qc.notes ?? ""}`.trim() +
        " Yine de yayınlamak istiyorsan onayı tekrarla.",
    );
  }

  state.stage = "published";
  state.status = "published";
  state.history.push({
    at: new Date().toISOString(),
    stage: "published",
    action: rejected ? "published_over_qc_rejection" : "published",
    note: rejected
      ? "QC REDDİNE RAĞMEN insan kararıyla yayınlandı."
      : "İnsan onayıyla yayınlandı (harici yayın adımı bu pipeline'ın dışında).",
  });
  const published = await writeRun(state);
  // Künye burada üretilir: reklam adına / utm_campaign'e girilecek creative key'in
  // yayın anında elde olması gerekiyor — atıf geriye dönük kurulamaz. Yazılamazsa
  // yayın geri alınmaz; künye bir görünüm, kayıt değil.
  await writeKunye(projectSlug, runId).catch(() => {});
  return published;
}
