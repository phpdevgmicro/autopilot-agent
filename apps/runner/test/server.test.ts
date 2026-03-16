import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  runDetailSchema,
  runnerErrorResponseSchema,
  scenarioWorkspaceStateSchema,
  scenariosResponseSchema,
  startRunResponseSchema,
} from "@cua-sample/replay-schema";

import { createServer } from "../src/server.js";

describe("runner server", () => {
  it("reports health", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: "ok",
        service: "runner",
      });
    } finally {
      await app.close();
    }
  });

  it("starts, retrieves, stops, and resets scenario workspaces", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "cua-sample-runner-server-"));
    const app = createServer({
      dataRoot,
      stepDelayMs: 50,
    });

    try {
      const startResponse = await app.inject({
        method: "POST",
        payload: {
          browserMode: "headless",
          maxResponseTurns: 17,
          mode: "native",
          prompt: "Navigate to https://example.com and describe the page.",
          scenarioId: "freestyle-browser-agent",
        },
        url: "/api/runs",
      });

      expect(startResponse.statusCode).toBe(202);
      const started = startRunResponseSchema.parse(startResponse.json());

      const runResponse = await app.inject({
        method: "GET",
        url: `/api/runs/${started.runId}`,
      });

      expect(runResponse.statusCode).toBe(200);
      const detail = runDetailSchema.parse(runResponse.json());

      expect(detail.run.id).toBe(started.runId);
      expect(detail.run.maxResponseTurns).toBe(17);
      expect(detail.run.status).toBe("running");
      expect(detail.run.verificationEnabled).toBe(false);

      const stopResponse = await app.inject({
        method: "POST",
        url: `/api/runs/${started.runId}/stop`,
      });

      expect(stopResponse.statusCode).toBe(200);
      expect(runDetailSchema.parse(stopResponse.json()).run.status).toBe(
        "cancelled",
      );

      const resetResponse = await app.inject({
        method: "POST",
        url: "/api/scenarios/freestyle-browser-agent/reset",
      });

      expect(resetResponse.statusCode).toBe(200);
      expect(
        scenarioWorkspaceStateSchema.parse(resetResponse.json()).scenarioId,
      ).toBe("freestyle-browser-agent");
    } finally {
      await app.close();
    }
  });

  it("serves the validated scenario registry", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/scenarios",
      });

      expect(response.statusCode).toBe(200);
      expect(scenariosResponseSchema.parse(response.json())).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("returns the structured error envelope for invalid requests", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "POST",
        payload: {
          scenarioId: "",
        },
        url: "/api/runs",
      });

      expect(response.statusCode).toBe(400);
      expect(runnerErrorResponseSchema.parse(response.json())).toMatchObject({
        code: "invalid_request",
        hint: expect.stringContaining("published replay-schema contracts"),
      });
    } finally {
      await app.close();
    }
  });

  it("returns the structured error envelope for missing runs", async () => {
    const app = createServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/runs/missing-run",
      });

      expect(response.statusCode).toBe(404);
      expect(runnerErrorResponseSchema.parse(response.json())).toMatchObject({
        code: "run_not_found",
        hint: expect.stringContaining("Start a new run"),
      });
    } finally {
      await app.close();
    }
  });
});
