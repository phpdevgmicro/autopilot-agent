import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { RunEvent } from "@cua-sample/replay-schema";

import { RunnerManager } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) =>
      rm(root, { force: true, recursive: true }),
    );
  }
});

async function createManager(stepDelayMs = 10) {
  const root = await mkdtemp(join(tmpdir(), "cua-sample-runner-core-"));
  tempRoots.push(root);

  return {
    dataRoot: root,
    manager: new RunnerManager({
      dataRoot: root,
      stepDelayMs,
    }),
  };
}

describe("RunnerManager", () => {
  it("fails the freestyle native executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      mode: "native",
      prompt: "Navigate to https://example.com and describe the page.",
      scenarioId: "freestyle-browser-agent",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.message.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("fails the freestyle code executor honestly when live Responses is unavailable", async () => {
    const { manager } = await createManager(5);

    const detail = await manager.startRun({
      browserMode: "headless",
      maxResponseTurns: 18,
      mode: "code",
      prompt: "Navigate to https://example.com and describe the page.",
      scenarioId: "freestyle-browser-agent",
    });

    const failed = await manager.waitForRunStatus(detail.run.id, "failed");

    expect(failed.run.status).toBe("failed");
    expect(
      failed.events.some(
        (event: RunEvent) =>
          event.type === "run_failed" &&
          event.message.includes("live Responses API"),
      ),
    ).toBe(true);
  });

  it("cancels a running run", async () => {
    const { manager } = await createManager(40);

    const detail = await manager.startRun({
      browserMode: "headless",
      mode: "native",
      prompt: "Navigate to https://example.com and describe the page.",
      scenarioId: "freestyle-browser-agent",
    });

    const cancelled = await manager.stopRun(detail.run.id, "Stop button pressed.");

    expect(cancelled.run.status).toBe("cancelled");
    expect(
      cancelled.events.some((event: RunEvent) => event.type === "run_cancelled"),
    ).toBe(true);
  });

  it("resets a scenario workspace and cancels the active run for that scenario", async () => {
    const { manager } = await createManager(50);

    const detail = await manager.startRun({
      browserMode: "headful",
      mode: "native",
      prompt: "Navigate to https://example.com and describe the page.",
      scenarioId: "freestyle-browser-agent",
    });

    const state = await manager.resetScenario("freestyle-browser-agent");
    const cancelled = await manager.getRunDetail(detail.run.id);

    expect(cancelled.run.status).toBe("cancelled");
    expect(state.cancelledRunId).toBe(detail.run.id);
    expect(existsSync(state.workspacePath)).toBe(true);
    expect(existsSync(join(state.workspacePath, "README.md"))).toBe(true);
  });
});
