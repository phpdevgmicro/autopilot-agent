import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, resolve, join } from "node:path";
import { homedir } from "node:os";

import Fastify, { type FastifyReply } from "fastify";

import {
  runDetailSchema,
  runnerErrorResponseSchema,
  scenarioWorkspaceStateSchema,
  scenariosResponseSchema,
  startRunRequestSchema,
  startRunResponseSchema,
  type RunEvent,
} from "@cua-sample/replay-schema";
import {
  RunnerCoreError,
  RunnerManager,
  toRunnerErrorResponse,
  getPromptSyncStatus,
  syncPrompts,
} from "@cua-sample/runner-core";
import { listScenarios } from "@cua-sample/scenario-kit";

type CreateServerOptions = {
  dataRoot?: string;
  manager?: RunnerManager;
  stepDelayMs?: number;
};

const defaultDataRoot = fileURLToPath(new URL("../../../data", import.meta.url));

function writeSseEvent(reply: FastifyReply, payload: unknown) {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createServer(options: CreateServerOptions = {}) {
  const resolvedDataRoot = resolve(options.dataRoot ?? defaultDataRoot);
  const managerOptions = {
    dataRoot: resolvedDataRoot,
    ...(options.stepDelayMs === undefined
      ? {}
      : { stepDelayMs: options.stepDelayMs }),
  };
  const manager = options.manager ?? new RunnerManager(managerOptions);
  const app = Fastify({ logger: false });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "content-type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    return payload;
  });

  app.options("*", async (_request, reply) => {
    reply.code(204);
    return null;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RunnerCoreError) {
      reply.code(error.statusCode).send(
        runnerErrorResponseSchema.parse(toRunnerErrorResponse(error)),
      );
      return;
    }

    if (error instanceof Error && "issues" in error) {
      reply.code(400).send(
        runnerErrorResponseSchema.parse({
          code: "invalid_request",
          error: error.message,
          hint:
            "Review the request payload against the published replay-schema contracts.",
        }),
      );
      return;
    }

    reply.code(500).send(
      runnerErrorResponseSchema.parse({
        code: "internal_runner_error",
        error: "Internal runner error",
        hint: "Check the runner logs for the full stack trace.",
      }),
    );
  });

  const startedAt = Date.now();

  app.get("/api/health", async () => {
    const heartbeat = manager.getHeartbeat();
    const mem = process.memoryUsage();
    return {
      status: "ok",
      service: "runner",
      uptimeMs: Date.now() - startedAt,
      activeRunId: heartbeat.activeRunId,
      lastEventAt: heartbeat.lastEventAt,
      runStatus: heartbeat.runStatus,
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      promptSync: getPromptSyncStatus(),
    };
  });

  app.get("/api/prompts/status", async () => getPromptSyncStatus());

  app.post("/api/prompts/sync", async (_request, reply) => {
    try {
      await syncPrompts();
      return getPromptSyncStatus();
    } catch (err) {
      reply.code(503);
      return {
        error: "Prompt sync failed",
        message: err instanceof Error ? err.message : String(err),
        hint: "Check the Google Sheet and n8n webhook.",
      };
    }
  });

  app.get("/api/scenarios", async () =>
    scenariosResponseSchema.parse(listScenarios()),
  );

  app.post("/api/scenarios/:id/reset", async (request) =>
    scenarioWorkspaceStateSchema.parse(
      await manager.resetScenario(
        (request.params as { id: string }).id,
      ),
    ),
  );

  app.post("/api/runs", async (request, reply) => {
    const input = startRunRequestSchema.parse(request.body);
    const detail = await manager.startRun(input);

    reply.code(202);

    return startRunResponseSchema.parse({
      eventStreamUrl: detail.eventStreamUrl,
      replayUrl: detail.replayUrl,
      runId: detail.run.id,
      status: detail.run.status,
    });
  });

  app.get("/api/runs/:id", async (request) =>
    runDetailSchema.parse(
      await manager.getRunDetail((request.params as { id: string }).id),
    ),
  );

  app.post("/api/runs/:id/stop", async (request) =>
    runDetailSchema.parse(
      await manager.stopRun((request.params as { id: string }).id),
    ),
  );

  app.get("/api/runs/:id/replay", async (request) =>
    manager.getReplayBundle((request.params as { id: string }).id),
  );

  app.get("/api/runs/:id/artifacts/screenshots/:name", async (request, reply) => {
    const params = request.params as { id: string; name: string };
    const screenshotPath = resolve(
      resolvedDataRoot,
      "runs",
      params.id,
      "screenshots",
      basename(params.name),
    );

    try {
      const payload = await readFile(screenshotPath);

      reply.header("Content-Type", "image/png");
      return payload;
    } catch {
      reply.code(404);
      return runnerErrorResponseSchema.parse({
        code: "artifact_not_found",
        error: "Screenshot artifact not found",
        hint: "Refresh the run detail and choose a screenshot that still exists on disk.",
      });
    }
  });

  app.get("/api/runs/:id/events", async (request, reply) => {
    const runId = (request.params as { id: string }).id;
    const detail = await manager.getRunDetail(runId);

    reply.raw.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });

    for (const event of detail.events) {
      writeSseEvent(reply, event);
    }

    const unsubscribe = manager.subscribe(runId, (event: RunEvent) => {
      writeSseEvent(reply, event);
    });

    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });

    return reply.hijack();
  });

  // ── Browser Profile Management ──────────────────────────
  const profileDir = process.env.CUA_BROWSER_PROFILE_DIR
    ?? join(homedir(), ".autopilot-agent", "browser-profile");

  app.get("/api/browser/profile-status", async () => {
    let exists = false;
    try {
      const s = await stat(profileDir);
      exists = s.isDirectory();
    } catch { /* doesn't exist */ }

    return {
      persist: process.env.CUA_BROWSER_PERSIST !== "false",
      profileDir,
      profileExists: exists,
    };
  });

  // Track active remote-login browser on VM
  let remoteLoginCtx: Awaited<ReturnType<typeof import("playwright").chromium.launchPersistentContext>> | null = null;

  app.post("/api/browser/connect-profile", async (_request, reply) => {
    if (process.env.CUA_BROWSER_PERSIST === "false") {
      reply.code(400);
      return {
        error: "Browser persistence is disabled",
        hint: "Set CUA_BROWSER_PERSIST=true in .env to enable persistent profiles.",
      };
    }

    const { chromium } = await import("playwright");
    const { mkdir, unlink } = await import("node:fs/promises");

    try {
      await mkdir(profileDir, { recursive: true });
    } catch (err: unknown) {
      reply.code(500);
      return {
        error: "Failed to create profile directory",
        hint: `Permission denied. Ensure the runner can write to ${profileDir}. Error: ${String(err)}`,
      };
    }

    // Clear stale lock files from crashed sessions
    for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { await unlink(join(profileDir, f)); } catch { /* fine */ }
    }

    // Detect headless VM: Linux without a DISPLAY env var
    const isHeadlessVM = process.platform === "linux" && !process.env.DISPLAY;

    if (isHeadlessVM) {
      // ── VM mode: headless + remote debugging on port 9222 ──
      try {
        if (remoteLoginCtx) {
          try { await remoteLoginCtx.close(); } catch { /* ok */ }
          remoteLoginCtx = null;
        }

        remoteLoginCtx = await chromium.launchPersistentContext(profileDir, {
          headless: true,
          args: [
            "--remote-debugging-port=9222",
            "--remote-debugging-address=0.0.0.0",
            "--window-size=1280,900",
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--no-sandbox",
          ],
          ignoreDefaultArgs: ["--enable-automation"],
          viewport: { width: 1280, height: 900 },
        });

        const page = remoteLoginCtx.pages()[0] ?? await remoteLoginCtx.newPage();
        await page.goto("https://accounts.google.com");
        console.log("[connect-profile] VM mode: browser on port 9222. SSH tunnel to access.");

        return {
          status: "launched",
          mode: "remote",
          message: "Browser launched on port 9222. SSH tunnel and open http://localhost:9222 to log in.",
          instructions: [
            "Run: ssh -L 9222:localhost:9222 user@vm-ip",
            "Open: http://localhost:9222",
            "Click page → Log in to Google",
            "Click 'Done' to save profile",
          ],
          profileDir,
        };
      } catch (err: unknown) {
        reply.code(500);
        return { error: "Failed to launch remote browser", hint: String(err) };
      }
    } else {
      // ── Local mode: open headed browser window ──
      try {
        chromium.launchPersistentContext(profileDir, {
          headless: false,
          args: [
            "--window-size=1280,900",
            "--disable-blink-features=AutomationControlled",
          ],
          ignoreDefaultArgs: ["--enable-automation"],
          viewport: { width: 1280, height: 900 },
          ...(process.env.CUA_BROWSER_CHANNEL ? { channel: process.env.CUA_BROWSER_CHANNEL } : {}),
        }).then(async (context) => {
          const page = context.pages()[0] ?? await context.newPage();
          await page.goto("https://accounts.google.com");
        }).catch((err) => {
          console.error("Failed to launch profile window:", err.message);
        });

        return {
          status: "launched",
          mode: "local",
          message: "Browser window opened. Log in to Google, then close the browser.",
          profileDir,
        };
      } catch (err: unknown) {
        reply.code(500);
        return { error: "Failed to launch browser", hint: String(err) };
      }
    }
  });

  // Close remote login browser and save profile (VM only)
  app.post("/api/browser/finish-profile-login", async () => {
    if (remoteLoginCtx) {
      try { await remoteLoginCtx.close(); } catch { /* ok */ }
      remoteLoginCtx = null;
      return { status: "saved", message: "Profile saved. Restart app to use." };
    }
    return { status: "no_session" };
  });

  return app;
}
