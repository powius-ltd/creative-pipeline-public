import { getMode } from "../modes";
import { claudeCostUsd } from "./prices";
import type {
  ActualCostReport,
  CostLine,
  RunState,
  StageId,
} from "../orchestrator/types";

export { costTotal, runTotals } from "./totals";

/**
 * Tahmin çerçevesi. Aşama adları moda özel olduğu için hesabın kendisi modun
 * cost.ts'inde; burada yalnızca yönlendirme ve "gerçek maliyet" mantığı var.
 */
export function estimateRun(state: RunState): Record<StageId, CostLine[]> {
  return getMode(state.mode).estimate(state);
}

/**
 * Bir aşama tamamlandığında gerçek maliyeti hesaplar.
 *
 * Öncelik sırası:
 *   1. Ajanın/operatörün bildirdiği gerçek maliyet (claude CLI zarfındaki
 *      total_cost_usd, ya da submit-* route'una gelen cost gövdesi)
 *   2. Yoksa modun o aşama için verdiği tahmin
 */
export function actualForStage(
  state: RunState,
  stage: StageId,
  report?: ActualCostReport,
): CostLine[] {
  if (report) {
    const lines: CostLine[] = [];
    if (typeof report.costUsd === "number") {
      lines.push({
        vendor: report.vendor ?? "higgsfield",
        detail: report.detail ?? "operatör bildirdi",
        usd: report.costUsd,
      });
    }
    // claude CLI zarfı hem total_cost_usd hem token sayısı veriyor; ikisini birden
    // toplamamak için token satırı yalnızca ayrı bir maliyet bildirilmediğinde eklenir.
    if (
      typeof report.costUsd !== "number" &&
      (report.claudeInputTokens || report.claudeOutputTokens)
    ) {
      const ci = report.claudeInputTokens ?? 0;
      const co = report.claudeOutputTokens ?? 0;
      lines.push({
        vendor: "claude",
        detail: `gerçek ${Math.round(ci / 1000)}K/${Math.round(co / 1000)}K token`,
        usd: claudeCostUsd(ci, co),
      });
    }
    if (lines.length > 0) return lines;
  }

  return getMode(state.mode).estimate(state)[stage] ?? [];
}
