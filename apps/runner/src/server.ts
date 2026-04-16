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
import { registerWebSocket } from "./ws/WebSocketServer.js";

type CreateServerOptions = {
  dataRoot?: string;
  manager?: RunnerManager;
  stepDelayMs?: number;
};

const defaultDataRoot = fileURLToPath(new URL("../../../data", import.meta.url));

function writeSseEvent(reply: FastifyReply, payload: unknown) {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function createServer(options: CreateServerOptions = {}) {
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
  // ── Browser Profile Management ──────────────────────────
  const baseProfileDir = process.env.CUA_BROWSER_PROFILE_DIR
    ?? join(homedir(), ".autopilot-agent", "browser-profile");
  
  const getProfileDir = (name?: string) => join(baseProfileDir, name || "default");

  app.get("/api/browser/profiles", async () => {
    try {
      const { readdir, readFile, stat: fsStat } = await import("node:fs/promises");
      const entries = await readdir(baseProfileDir, { withFileTypes: true });
      const ignoreDirs = new Set(["Default", "Crashpad", "Safe Browsing", "component_crx_cache", "GrShaderCache", "GraphiteDawnCache", "ShaderCache", "segmentation_platform"]);
      const profileDirs = entries
        .filter(e => e.isDirectory() && !ignoreDirs.has(e.name));

      // Build enriched profile info
      const profiles = await Promise.all(profileDirs.map(async (e) => {
        const pDir = join(baseProfileDir, e.name);
        const cookieFile = join(pDir, "imported-cookies.json");
        let hasCookies = false;
        let cookieCount = 0;
        let source = "";
        let syncedAt = "";

        try {
          const raw = await readFile(cookieFile, "utf-8");
          const data = JSON.parse(raw);
          hasCookies = Array.isArray(data.cookies) && data.cookies.length > 0;
          cookieCount = data.cookies?.length ?? 0;
          source = data.source ?? "";
          syncedAt = data.importedAt ?? "";
        } catch { /* no cookie file */ }

        // Check profile dir modification time as fallback
        let lastModified = "";
        try {
          const s = await fsStat(pDir);
          lastModified = s.mtime.toISOString();
        } catch { /* ignore */ }

        return {
          name: e.name,
          hasCookies,
          cookieCount,
          source,
          syncedAt,
          lastModified,
        };
      }));

      // Always include "default" even if no directory exists
      if (!profiles.some(p => p.name === "default")) {
        profiles.unshift({ name: "default", hasCookies: false, cookieCount: 0, source: "", syncedAt: "", lastModified: "" });
      }

      return { profiles };
    } catch {
      return { profiles: [{ name: "default", hasCookies: false, cookieCount: 0, source: "", syncedAt: "", lastModified: "" }] };
    }
  });

  app.get("/api/browser/profile-status", async (request) => {
    const query = request.query as { profileName?: string };
    const pName = query.profileName || "default";
    const pDir = getProfileDir(pName);
    let exists = false;
    let hasCookies = false;
    let cookieCount = 0;
    try {
      const s = await stat(pDir);
      exists = s.isDirectory();
      // Check for synced cookies
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(join(pDir, "imported-cookies.json"), "utf-8");
      const data = JSON.parse(raw);
      hasCookies = Array.isArray(data.cookies) && data.cookies.length > 0;
      cookieCount = data.cookies?.length ?? 0;
    } catch { /* doesn't exist */ }

    return {
      persist: process.env.CUA_BROWSER_PERSIST !== "false",
      profileDir: pDir,
      profileExists: exists,
      hasCookies,
      cookieCount,
    };
  });

  // Clear browser profile
  app.post("/api/browser/clear-profile", async (request, reply) => {
    const { profileName } = (request.body as { profileName?: string }) || {};
    const pDir = getProfileDir(profileName);

    if (process.env.CUA_BROWSER_PERSIST === "false") {
      reply.code(400);
      return {
        error: "Browser persistence is disabled",
      };
    }

    const { rm } = await import("node:fs/promises");

    try {
      await rm(pDir, { recursive: true, force: true });
      return { status: "cleared", message: `Browser profile '${profileName || "default"}' cleared.` };
    } catch (err: unknown) {
      reply.code(500);
      return { error: "Failed to clear profile", hint: String(err) };
    }
  });

  // ── Import cookies from local browser login ───────────
  app.post("/api/browser/import-cookies", async (request, reply) => {
    if (process.env.CUA_BROWSER_PERSIST === "false") {
      reply.code(400);
      return { error: "Browser persistence is disabled" };
    }

    const { cookies, source, profileName, userAgent } = request.body as {
      cookies: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: string;
      }>;
      localStorage?: Record<string, string>;
      source?: string;
      userAgent?: string;
      profileName?: string;
    };

    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      reply.code(400);
      return { error: "No cookies provided" };
    }

    const { mkdir, writeFile } = await import("node:fs/promises");
    const { chromium } = await import("playwright");
    
    const pDir = getProfileDir(profileName);

    try {
      await mkdir(pDir, { recursive: true });

      // ── CRITICAL: Clean lock files before launch ──
      // If a previous session crashed, lock files persist and block the launch (exit code 21).
      const locks = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
      for (const lock of locks) {
        try {
          const lPath = require("path").join(pDir, lock);
          await require("node:fs/promises").unlink(lPath);
        } catch { /* ignore if not present */ }
      }

      // ── CRITICAL: Use the SAME Chrome binary as the agent ──────────
      // Each Chrome installation generates a unique `os_crypt` encryption
      // key in `Local State`. If we use Playwright Chromium here but the
      // agent uses native Chrome (channel: "chrome"), the keys differ and
      // cookies become unreadable across engines.
      // cookies become unreadable across engines.
      const importChannel = process.env.CUA_BROWSER_CHANNEL || undefined;

      const ctx = await chromium.launchPersistentContext(pDir, {
        headless: true,
        args: [
          "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox",
          // MUST match agent's launch args — on Linux, this makes cookie storage
          // plaintext instead of keychain-encrypted, ensuring the agent can read them.
          "--password-store=basic",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        ...(importChannel ? { channel: importChannel } : {}),
      });

      // Add cookies to the browser context
      await ctx.addCookies(cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        expires: c.expires ?? -1,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: (c.sameSite as "Strict" | "Lax" | "None") ?? "Lax",
      })));

      // ── DO NOT navigate to Google in headless mode ─────────────────
      // Navigating to myaccount.google.com triggers Google's bot detection
      // which invalidates the freshly-injected cookies server-side.
      // The cookies work fine when the agent opens Google in headed mode.

      // Close context — cookies are now persisted in the profile directory
      await ctx.close();
      const title = "skipped (headless verification disabled)";

      // Also save cookies as a backup JSON file
      const backupPath = join(pDir, "imported-cookies.json");
      await writeFile(backupPath, JSON.stringify({ cookies, source, userAgent, importedAt: new Date().toISOString() }, null, 2));

      const imported = cookies.length;
      const googleCookies = cookies.filter(c => c.domain.includes("google")).length;

      console.log(`[import-cookies] Imported ${imported} cookies (${googleCookies} Google) from ${source || "unknown"}`);
      console.log(`[import-cookies] Verification page: "${title}"`);

      return {
        status: "imported",
        message: `Successfully imported ${imported} cookies (${googleCookies} Google cookies).`,
        imported,
        googleCookies,
        pageTitle: title,
      };
    } catch (err: unknown) {
      reply.code(500);
      return { error: "Failed to import cookies", hint: String(err) };
    }
  });

  // ── Remote Login Flow ─────────────────────────────────────
  // For VM/server deployments: users log into Google DIRECTLY in the
  // agent's browser profile. This is the only reliable method because
  // Google invalidates cookies transferred between browser sessions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let remoteLoginCtx: any = null;

  app.post("/api/browser/login-start", async (request, reply) => {
    if (remoteLoginCtx) {
      // Close existing session first
      try { await remoteLoginCtx.close(); } catch { /* ignore */ }
      remoteLoginCtx = null;
    }

    const { profile, url } = request.body as { profile?: string; url?: string };
    const profileName = profile || process.env.CUA_DEFAULT_BROWSER_PROFILE || "default";
    const baseDir = process.env.CUA_BROWSER_PROFILE_DIR || join(homedir(), ".autopilot-agent", "browser-profile");
    const pDir = join(baseDir, profileName);
    const loginChannel = process.env.CUA_BROWSER_CHANNEL || undefined;

    try {
      await mkdir(pDir, { recursive: true });

      // Launch with the EXACT same config as the agent — same channel, same
      // password-store, same profile directory. This ensures cookies saved
      // during login are immediately usable by the agent.
      remoteLoginCtx = await chromium.launchPersistentContext(pDir, {
        headless: true,
        args: [
          "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox",
          "--password-store=basic",
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        viewport: { width: 1280, height: 800 },
        ...(loginChannel ? { channel: loginChannel } : {}),
      });

      const page = remoteLoginCtx.pages()[0] ?? await remoteLoginCtx.newPage();
      const loginUrl = url || "https://accounts.google.com/signin";
      await page.goto(loginUrl, { timeout: 20_000 }).catch(() => {});

      console.log(`[remote-login] 🔐 Login session started for profile "${profileName}" → ${loginUrl}`);
      return { status: "started", profile: profileName, url: loginUrl };
    } catch (err: unknown) {
      remoteLoginCtx = null;
      reply.code(500);
      return { error: "Failed to start login session", hint: String(err) };
    }
  });

  app.post("/api/browser/login-close", async (_request, reply) => {
    if (!remoteLoginCtx) { reply.code(404); return { error: "No active login session" }; }

    try {
      // Grab current page info before closing
      const page = remoteLoginCtx.pages()[0];
      const title = page ? await page.title().catch(() => "unknown") : "unknown";
      const url = page ? page.url() : "unknown";

      // Close context — this flushes cookies to the profile's SQLite DB
      await remoteLoginCtx.close();
      remoteLoginCtx = null;

      console.log(`[remote-login] ✅ Login session closed. Last page: "${title}" (${url})`);
      return { status: "closed", pageTitle: title, lastUrl: url };
    } catch (err: unknown) {
      remoteLoginCtx = null;
      reply.code(500);
      return { error: "Failed to close login session", hint: String(err) };
    }
  });

  app.get("/api/browser/login-screenshot", async (_request, reply) => {
    if (!remoteLoginCtx) { reply.code(404); return { error: "No active login session" }; }
    const page = remoteLoginCtx.pages()[0];
    if (!page) { reply.code(404); return { error: "No page" }; }
    const buf = await page.screenshot({ type: "jpeg", quality: 75 });
    reply.header("Content-Type", "image/jpeg").header("Cache-Control", "no-store");
    return buf;
  });

  app.post("/api/browser/login-click", async (request, reply) => {
    if (!remoteLoginCtx) { reply.code(404); return { error: "No active login session" }; }
    const { x, y } = request.body as { x: number; y: number };
    const page = remoteLoginCtx.pages()[0];
    if (!page) { reply.code(404); return { error: "No page" }; }
    // Move, click, and wait a beat for focus to settle
    await page.mouse.click(x, y);
    await new Promise(r => setTimeout(r, 150));
    return { ok: true };
  });

  app.post("/api/browser/login-type", async (request, reply) => {
    if (!remoteLoginCtx) { reply.code(404); return { error: "No active login session" }; }
    const { text } = request.body as { text: string };
    const page = remoteLoginCtx.pages()[0];
    if (!page) { reply.code(404); return { error: "No page" }; }
    // Use fill() on the focused element if possible (more reliable for input fields)
    // Falls back to keyboard.type() if fill doesn't work
    try {
      const focused = page.locator(":focus");
      const count = await focused.count();
      if (count > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tag = await focused.evaluate((el: any) => el.tagName.toLowerCase());
        if (tag === "input" || tag === "textarea") {
          await focused.fill(text);
          return { ok: true, method: "fill" };
        }
      }
    } catch { /* fallback to type */ }
    await page.keyboard.type(text, { delay: 30 });
    return { ok: true, method: "type" };
  });

  app.post("/api/browser/login-keypress", async (request, reply) => {
    if (!remoteLoginCtx) { reply.code(404); return { error: "No active login session" }; }
    const { key } = request.body as { key: string };
    const page = remoteLoginCtx.pages()[0];
    if (!page) { reply.code(404); return { error: "No page" }; }
    await page.keyboard.press(key);
    return { ok: true };
  });

  // Register WebSocket routes for the chat agent
  await registerWebSocket(app);

  return app;
}
