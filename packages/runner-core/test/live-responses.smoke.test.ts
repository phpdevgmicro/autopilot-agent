import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { RunnerManager } from "../src/index.js";

const tempRoots: string[] = [];

beforeAll(() => {
  process.env.CUA_RESPONSES_MODE = "live";

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY must be set to run packages/runner-core/test/live-responses.smoke.test.ts",
    );
  }
});

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

async function createLiveManager(stepDelayMs = 10) {
  const dataRoot = await mkdtemp(join(tmpdir(), "cua-sample-live-smoke-"));
  tempRoots.push(dataRoot);

  return new RunnerManager({
    dataRoot,
    stepDelayMs,
  });
}

async function waitForTerminalRun(
  manager: RunnerManager,
  runId: string,
  timeoutMs = 120_000,
) {
  const finalStatuses = new Set(["completed", "failed", "cancelled"]);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await manager.getRunDetail(runId);

    if (finalStatuses.has(detail.run.status)) {
      return detail;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for run ${runId} to reach a terminal status.`);
}

function assertNativeHarnessSmoke(detail: Awaited<ReturnType<RunnerManager["getRunDetail"]>>) {
  expect(["completed", "failed"]).toContain(detail.run.status);
  expect(
    detail.events.some(
      (event) =>
        event.type === "computer_call_requested" ||
        event.type === "function_call_requested",
    ),
  ).toBe(true);
  expect(detail.run.summary?.screenshotCount).toBeGreaterThanOrEqual(1);
}

describe("live Responses smoke", () => {
  it(
    "completes the freestyle code path against the live Responses API",
    async () => {
      const manager = await createLiveManager();
      const detail = await manager.startRun({
        browserMode: "headless",
        mode: "code",
        prompt: "Navigate to https://example.com and tell me the page title.",
        scenarioId: "freestyle-browser-agent",
        startUrl: "https://example.com",
      });

      const completed = await waitForTerminalRun(manager, detail.run.id);

      expect(completed.run.status).toBe("completed");
    },
    130_000,
  );
});

describe("live native hero smoke", () => {
  it(
    "exercises the freestyle native path against the live Responses API",
    async () => {
      const manager = await createLiveManager();
      const detail = await manager.startRun({
        browserMode: "headless",
        maxResponseTurns: 16,
        mode: "native",
        prompt: "Navigate to https://example.com and tell me the page title.",
        scenarioId: "freestyle-browser-agent",
        startUrl: "https://example.com",
      });

      const completed = await waitForTerminalRun(manager, detail.run.id, 180_000);

      assertNativeHarnessSmoke(completed);
    },
    190_000,
  );
});
