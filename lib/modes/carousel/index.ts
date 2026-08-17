import { MODE_DESCRIPTORS } from "../descriptors";
import { assertModeConsistent, type ModeDefinition } from "../types";
import { estimateCarousel } from "./cost";
import { runCarouselCompose } from "./compose";
import { runCarouselCopy } from "./copy";
import { runKonsept } from "./konsept";
import { runCarouselPlanner } from "./planner";
import { runCarouselQc } from "./qc";
import { runCarouselVisual } from "./visual";

export const carouselMode: ModeDefinition = assertModeConsistent({
  descriptor: MODE_DESCRIPTORS.carousel,
  payloadKind: "carousel",
  agents: {
    konsept: runKonsept,
    plan: runCarouselPlanner,
    copy: runCarouselCopy,
    visual: runCarouselVisual,
    compose: runCarouselCompose,
    qc: runCarouselQc,
  },
  estimate: estimateCarousel,
});
