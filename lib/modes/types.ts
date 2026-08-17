import type { ModeDescriptor } from "./descriptors";
import type {
  AgentResult,
  CostLine,
  RunPayload,
  RunState,
  StageId,
} from "../orchestrator/types";

export type AgentFn = (state: RunState) => Promise<AgentResult>;

export interface ModeDefinition {
  descriptor: ModeDescriptor;
  /** Run oluşturulurken payload'ın hangi şekilde başlayacağı. */
  payloadKind: RunPayload["kind"];
  agents: Record<StageId, AgentFn>;
  estimate(state: RunState): Record<StageId, CostLine[]>;
}

/**
 * StageId artık serbest string olduğu için tip sistemi descriptor'daki aşama
 * listesiyle agents map'inin anahtarlarını eşleştiremez. Bu yüzden modül
 * yüklenirken bir kez doğruluyoruz — uyuşmazlık sessizce "ajan yok" hatasına
 * dönüşmesin, hemen ve açıkça patlasın.
 */
export function assertModeConsistent(mode: ModeDefinition): ModeDefinition {
  const declared = mode.descriptor.stages.map((s) => s.id);
  const implemented = Object.keys(mode.agents);

  const missing = declared.filter((s) => !implemented.includes(s));
  const extra = implemented.filter((s) => !declared.includes(s));

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Mod '${mode.descriptor.id}' tutarsız — ` +
        (missing.length ? `ajanı olmayan aşama: ${missing.join(", ")}. ` : "") +
        (extra.length ? `descriptor'da olmayan ajan: ${extra.join(", ")}.` : ""),
    );
  }
  return mode;
}
