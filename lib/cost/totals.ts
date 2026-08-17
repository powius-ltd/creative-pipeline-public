import type { CostLine, RunState } from "../orchestrator/types";

/**
 * Saf toplama yardımcıları — RunView (istemci) bunları import ediyor, o yüzden
 * bu dosya sunucuya özel hiçbir şey (mod kayıt defteri, node: modülleri) import
 * ETMEMELİ. Aşama bazlı hesaplama lib/cost/estimate.ts'te (sunucu tarafı).
 */
export function costTotal(lines: CostLine[] | undefined): number {
  return (lines ?? []).reduce((sum, l) => sum + l.usd, 0);
}

export function runTotals(state: RunState): { estimated: number; actual: number } {
  const cost = state.cost;
  if (!cost) return { estimated: 0, actual: 0 };
  return {
    estimated: Object.values(cost.estimated).reduce((s, l) => s + costTotal(l), 0),
    actual: Object.values(cost.actual).reduce((s, l) => s + costTotal(l), 0),
  };
}
