/**
 * Chat Agent Runner
 *
 * Launches a browser session and runs the OpenAI Responses API loop,
 * piping all events (thinking, screenshots, agent messages) back
 * through the ChatSession → WebSocket → Frontend.
 *
 * This is the bridge between:
 *   - ChatSession (WebSocket plumbing)
 *   - browser-runtime (Playwright browser)
 *   - runner-core responses-loop (OpenAI CUA loop)
 *
 * Designed for future extraction: all external I/O goes through
 * typed interfaces, not concrete implementations.
 */

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  launchBrowserSession,
  type BrowserSession,
  createDefaultResponsesClient,
  runResponsesNativeComputerLoop,
  runResponsesCodeLoop,
} from "@cua-sample/runner-core";

import type { ChatSession } from "./ChatSessionManager.js";
import type { ChatSessionConfig } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────

interface AgentRunResult {
  finalMessage: string;
  turnsUsed: number;
  durationMs: number;
}

// ── Agent Runner ────────────────────────────────────────────────────

export class ChatAgentRunner {
  private session: ChatSession;
  private browser: BrowserSession | null = null;
  private abortController: AbortController | null = null;
  private isRunning = false;
  private screenshotDir: string;
  private screenshotInterval: ReturnType<typeof setInterval> | null = null;

  constructor(session: ChatSession) {
    this.session = session;
    this.screenshotDir = join(tmpdir(), "cua-chat-agent", session.id, "screenshots");
  }

  // ── Public API ──────────────────────────────────────────────────

  async run(userPrompt: string, browserProfile?: string): Promise<AgentRunResult | null> {
    if (this.isRunning) {
      this.session.addSystemMessage("⚠️ An agent task is already running. Stop it first.");
      return null;
    }

    const config = this.session.getConfig();
    const startTime = Date.now();
    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      // 1. Create OpenAI client
      const client = createDefaultResponsesClient();
      if (!client) {
        this.session.addSystemMessage(
          "❌ Cannot start agent: OPENAI_API_KEY is not set. " +
          "Please set it in your .env file and restart the runner."
        );
        return null;
      }

      // 2. Launch browser
      await this.launchBrowser(config, browserProfile);

      // 3. Start screenshot streaming
      this.startScreenshotStreaming(config.screenshotIntervalMs);

      // 4. Send initial screenshot
      await this.captureAndSendScreenshot();

      // 5. Build instructions
      const instructions = this.buildInstructions();

      // 6. Run the CUA loop
      const result = await this.executeCuaLoop(client, userPrompt, instructions, config);

      // 7. Final screenshot
      await this.captureAndSendScreenshot();

      const durationMs = Date.now() - startTime;

      return {
        finalMessage: result.finalAssistantMessage ?? "Task completed.",
        turnsUsed: result.notes.length,
        durationMs,
      };
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        return { finalMessage: "Task stopped by user.", turnsUsed: 0, durationMs: Date.now() - startTime };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.session.addSystemMessage(`❌ Agent error: ${errorMsg}`);
      console.error("[agent-runner] Error:", err);
      return null;
    } finally {
      this.cleanup();
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async cleanup(): Promise<void> {
    this.isRunning = false;
    this.stopScreenshotStreaming();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Best-effort cleanup
      }
      this.browser = null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getBrowser(): BrowserSession | null {
    return this.browser;
  }

  // ── Browser Launch ──────────────────────────────────────────────

  private async launchBrowser(config: ChatSessionConfig, browserProfile?: string): Promise<void> {
    await mkdir(this.screenshotDir, { recursive: true });

    this.session.updateBrowserState({ isActive: true, isLoading: true });

    // Resolve profile: explicit param → env var → undefined (default)
    const resolvedProfile = browserProfile || process.env.CUA_DEFAULT_BROWSER_PROFILE || undefined;
    if (resolvedProfile) {
      console.log(`[agent-runner] Using browser profile: ${resolvedProfile}`);
    }

    const startUrl = "https://www.google.com";

    this.browser = await launchBrowserSession({
      browserMode: "headless",
      browserProfile: resolvedProfile,
      screenshotDir: this.screenshotDir,
      startTarget: { kind: "remote_url", url: startUrl, label: "Google" },
      workspacePath: this.screenshotDir,
    });

    this.session.updateBrowserState({
      isActive: true,
      isLoading: false,
      currentUrl: startUrl,
      currentTitle: "Google",
    });

    this.session.addSystemMessage("🌐 Browser launched and ready.");
  }

  // ── CUA Loop Execution ──────────────────────────────────────────

  private async executeCuaLoop(
    client: ReturnType<typeof createDefaultResponsesClient> & object,
    prompt: string,
    instructions: string,
    config: ChatSessionConfig,
  ) {
    if (!this.browser) throw new Error("Browser not launched");

    const maxTurns = Number(process.env.CUA_MAX_RESPONSE_TURNS ?? "50");
    const executionMode = (process.env.CUA_EXECUTION_MODE ?? "native") as "code" | "native";

    // Build a minimal RunExecutionContext adapter
    // This bridges the existing responses-loop to our ChatSession
    const context = this.buildExecutionContext(maxTurns);

    const loopInput = {
      context,
      instructions,
      maxResponseTurns: maxTurns,
      prompt,
      session: this.browser,
    };

    if (executionMode === "code") {
      return runResponsesCodeLoop(loopInput, client);
    }
    return runResponsesNativeComputerLoop(loopInput, client);
  }

  /**
   * Build a RunExecutionContext that adapts the responses-loop events
   * to our ChatSession WebSocket stream.
   */
  private buildExecutionContext(maxTurns: number) {
    const session = this.session;
    const signal = this.abortController!.signal;
    const config = session.getConfig();
    const self = this;

    // Build a RunExecutionContext-compatible adapter.
    // We cast to `any` because the responses-loop only accesses a subset
    // of RunDetail fields at runtime, but the Zod schema is very strict.
    const runId = randomUUID();

    return {
      captureScreenshot: async (browserSession: BrowserSession, label: string) => {
        const screenshot = await browserSession.captureScreenshot(label);
        await self.captureAndSendScreenshot();

        return {
          capturedAt: screenshot.capturedAt,
          id: screenshot.id,
          label: screenshot.label,
          mimeType: screenshot.mimeType as "image/png",
          pageTitle: screenshot.pageTitle ?? "",
          pageUrl: screenshot.currentUrl,
          path: screenshot.path,
          url: `/screenshots/${screenshot.id}`,
        };
      },

      completeRun: async () => {
        // No-op — completion handled by the runner
      },

      detail: {
        run: {
          id: runId,
          browserMode: "headless" as const,
          browserProfile: undefined,
          labId: "freestyle" as const,
          maxResponseTurns: maxTurns,
          mode: (process.env.CUA_EXECUTION_MODE ?? "native") as "code" | "native",
          model: config.model,
          prompt: "",
          scenarioId: "chat-agent",
          startUrl: "https://www.google.com",
          startedAt: new Date().toISOString(),
          status: "running" as const,
          verificationEnabled: false,
        },
        events: [],
        eventStreamUrl: "",
        replayUrl: "",
        scenario: {
          id: "chat-agent",
          labId: "freestyle" as const,
          category: "general" as const,
          title: "Chat Agent",
          description: "Interactive chat-driven browser agent",
          defaultPrompt: "",
          workspaceTemplatePath: ".",
          startTarget: { kind: "remote_url" as const, url: "https://google.com", label: "Google" },
          defaultMode: "native" as const,
          supportsCodeEdits: false,
          verification: [],
          tags: ["chat"],
        },
        workspacePath: self.screenshotDir,
      },

      emitEvent: async (input: { detail?: string; level: string; message: string; type: string }) => {
        const msg = input.message;
        const detail = input.detail ?? "";

        // Forward thinking/progress messages
        if (input.type === "run_progress" || input.type === "function_call_requested") {
          session.emitThinking(`${msg}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
        }

        // Update browser state on navigation
        if (input.type === "browser_navigated" && self.browser) {
          try {
            const state = await self.browser.readState();
            session.updateBrowserState({
              currentUrl: state.currentUrl,
              currentTitle: state.pageTitle ?? "",
            });
          } catch {
            // Ignore state read errors
          }
        }

        // Capture screenshot on key events
        if (
          input.type === "screenshot_captured" ||
          input.type === "computer_call_output_recorded"
        ) {
          await self.captureAndSendScreenshot();
        }
      },

      screenshotDirectory: self.screenshotDir,
      signal,
      stepDelayMs: Number(process.env.CUA_STEP_DELAY_MS ?? "650"),

      syncBrowserState: async (browserSession: BrowserSession) => {
        try {
          const state = await browserSession.readState();
          session.updateBrowserState({
            currentUrl: state.currentUrl,
            currentTitle: state.pageTitle ?? "",
          });
        } catch {
          // Ignore errors
        }
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // ── Instructions ────────────────────────────────────────────────

  private buildInstructions(): string {
    return [
      "You are a helpful browser agent. The user will give you tasks to complete in a web browser.",
      "You can see the browser through screenshots and interact with it using computer actions.",
      "",
      "Guidelines:",
      "- Navigate to websites, fill forms, click buttons, extract information",
      "- Always wait for pages to load before interacting",
      "- Be thorough but efficient — minimize unnecessary clicks",
      "- If you encounter a login page, ask the user for credentials",
      "- Report your progress clearly as you work",
      "- When done, provide a clear summary of what you accomplished",
    ].join("\n");
  }

  // ── Screenshot Streaming ────────────────────────────────────────

  private startScreenshotStreaming(intervalMs: number): void {
    this.screenshotInterval = setInterval(() => {
      void this.captureAndSendScreenshot();
    }, intervalMs);

    // Don't keep the process alive
    if (this.screenshotInterval.unref) {
      this.screenshotInterval.unref();
    }
  }

  private stopScreenshotStreaming(): void {
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = null;
    }
  }

  private async captureAndSendScreenshot(): Promise<void> {
    if (!this.browser || !this.session.isConnected()) return;

    try {
      const page = this.browser.page;
      const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
      const base64 = buffer.toString("base64");
      const data = `data:image/jpeg;base64,${base64}`;

      let title = "";
      try { title = await page.title(); } catch { /* ignore */ }
      const url = page.url();

      this.session.sendScreenshot(data, url, title);

      // Also update browser state
      this.session.updateBrowserState({
        currentUrl: url,
        currentTitle: title,
        lastScreenshot: data,
      });
    } catch {
      // Screenshot may fail during navigation — ignore
    }
  }
}
