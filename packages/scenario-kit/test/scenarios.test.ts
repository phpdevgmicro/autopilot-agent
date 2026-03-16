import { describe, expect, it } from "vitest";

import { getScenarioById, listScenarios } from "../src/scenarios.js";

describe("scenario registry", () => {
  it("loads the freestyle scenario", () => {
    const scenarios = listScenarios();

    expect(scenarios).toHaveLength(1);
    expect(new Set(scenarios.map((scenario) => scenario.labId))).toEqual(
      new Set(["freestyle"]),
    );
  });

  it("freestyle scenario has expected defaults", () => {
    const scenario = getScenarioById("freestyle-browser-agent");

    expect(scenario).toBeDefined();
    expect(scenario!.labId).toBe("freestyle");
    expect(scenario!.category).toBe("general");
    expect(scenario!.defaultMode).toBe("native");
    expect(scenario!.verification).toHaveLength(0);
    expect(scenario!.startTarget.kind).toBe("remote_url");
  });
});
