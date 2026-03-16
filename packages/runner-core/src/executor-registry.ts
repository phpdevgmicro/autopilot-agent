import { type RunDetail } from "@cua-sample/replay-schema";

import { createUnsupportedScenarioError, type RunExecutor } from "./scenario-runtime.js";
import { createFreestyleExecutor } from "./scenarios/freestyle.js";

export function createDefaultRunExecutor(detail: RunDetail): RunExecutor {
  switch (detail.scenario.id) {
    case "freestyle-browser-agent":
      return createFreestyleExecutor(detail.run.mode);
    default:
      throw createUnsupportedScenarioError(detail.scenario.id);
  }
}
