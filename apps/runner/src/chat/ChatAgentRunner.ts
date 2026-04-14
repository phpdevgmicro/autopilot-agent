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
  buildFreestyleCodeInstructions,
} from "@cua-sample/runner-core";

import type { ChatSession } from "./ChatSessionManager.js";
import type { ChatSessionConfig } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────

interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

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
  /** Which browser profile is currently loaded (tracks re-launch need) */
  private currentBrowserProfile: string | undefined;

  /** Conversation history — persists across turns for multi-turn context */
  private conversationHistory: ConversationEntry[] = [];
  /** Track how many tasks have been completed this session */
  private tasksCompleted = 0;

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

    // Track user message in conversation history
    this.conversationHistory.push({
      role: "user",
      content: userPrompt,
      timestamp: Date.now(),
    });

    const config = this.session.getConfig();
    const startTime = Date.now();
    this.isRunning = true;
    this.abortController = new AbortController();

    // Stop idle screenshot streaming (will restart active streaming)
    this.stopScreenshotStreaming();

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

      // 2. Launch browser (reuse existing if still alive)
      // Resolve effective profile to detect mismatches
      const effectiveProfile = browserProfile || process.env.CUA_DEFAULT_BROWSER_PROFILE || undefined;
      const profileChanged = this.browser && effectiveProfile !== this.currentBrowserProfile;

      if (profileChanged) {
        // Profile changed — close old browser and re-launch with correct cookies
        console.log(`[agent-runner] Profile changed: "${this.currentBrowserProfile}" → "${effectiveProfile}". Re-launching browser.`);
        this.stopScreenshotStreaming();
        try { await this.browser!.close(); } catch { /* best-effort */ }
        this.browser = null;
      }

      if (!this.browser) {
        await this.launchBrowser(config, browserProfile);
      } else {
        // Browser already alive with the same profile — just update state
        this.session.updateBrowserState({ isActive: true, isLoading: false });
      }

      // 3. Start active screenshot streaming (higher frequency)
      this.startScreenshotStreaming(config.screenshotIntervalMs);

      // 4. Send initial screenshot
      await this.captureAndSendScreenshot();

      // 5. Build instructions
      // In code mode, use the proven Google Sheet prompt (same as the older working agent).
      // In native mode, fall back to the hardcoded buildInstructions().
      const executionMode = process.env.CUA_EXECUTION_MODE ?? "native";
      let instructions: string;
      if (executionMode === "code") {
        try {
          const currentUrl = this.browser?.page?.url?.() ?? "https://www.google.com";
          instructions = await buildFreestyleCodeInstructions(currentUrl);
          console.log(`[agent-runner] Using Google Sheet prompt for code mode (${instructions.length} chars)`);
        } catch (e) {
          console.warn(`[agent-runner] Failed to load Sheet prompt, falling back to built-in instructions:`, e);
          instructions = this.buildInstructions();
        }
      } else {
        instructions = this.buildInstructions();
      }

      // Always append Google account handling rules (Sheet prompt may not include them)
      instructions += this.getGoogleAccountInstructions();

      // 6. Build contextual prompt with conversation history
      const contextualPrompt = this.buildContextualPrompt(userPrompt);


      // 7. Run the CUA loop
      const result = await this.executeCuaLoop(client, contextualPrompt, instructions, config);

      // 8. Final screenshot
      await this.captureAndSendScreenshot();

      const durationMs = Date.now() - startTime;
      this.tasksCompleted++;

      // Build completion message
      const agentReply = result.finalAssistantMessage ?? "Task completed.";
      const completionMsg = this.buildCompletionMessage(agentReply, durationMs);

      // Track agent response in conversation history
      this.conversationHistory.push({
        role: "assistant",
        content: agentReply,
        timestamp: Date.now(),
      });

      // Keep conversation history manageable (last 20 turns)
      if (this.conversationHistory.length > 40) {
        this.conversationHistory = this.conversationHistory.slice(-40);
      }

      return {
        finalMessage: completionMsg,
        turnsUsed: result.notes.length,
        durationMs,
      };
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        this.conversationHistory.push({
          role: "assistant",
          content: "Task stopped by user.",
          timestamp: Date.now(),
        });
        return { finalMessage: "⏹️ Task stopped. What would you like me to do instead?", turnsUsed: 0, durationMs: Date.now() - startTime };
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.session.addSystemMessage(`❌ Agent error: ${errorMsg}`);
      console.error("[agent-runner] Error:", err);
      return null;
    } finally {
      // Only stop the run state and active screenshot streaming.
      // Keep the browser alive for multi-turn conversations.
      this.isRunning = false;
      this.stopScreenshotStreaming();

      // Start idle screenshot streaming so user can still see the browser
      this.startIdleScreenshotStreaming();
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
    this.currentBrowserProfile = resolvedProfile;
    if (resolvedProfile) {
      console.log(`[agent-runner] Using browser profile: ${resolvedProfile}`);
    }

    const startUrl = "https://www.google.com";

    this.browser = await launchBrowserSession({
      browserMode: "headless",
      ...(resolvedProfile ? { browserProfile: resolvedProfile } : {}),
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
      "You are a helpful browser assistant. The user chats with you and you complete tasks in their browser.",
      "",
      "## Your Personality",
      "- You are friendly, efficient, and direct",
      "- After completing a task, briefly summarize what you did",
      "- If you encounter issues, explain them clearly and suggest alternatives",
      "- If you need the user to do something (like login), ask clearly",
      "",
      "## Your Tools",
      "You have two ways to interact with the browser:",
      "",
      "### Method 1: Element-based (PREFERRED — more reliable)",
      "1. Call `get_elements` to see all interactive elements on the page",
      "2. Use `click_element(index)`, `type_element(index, text)`, or `select_element(index, value)`",
      "3. This is more reliable than guessing coordinates from screenshots",
      "",
      "### Method 2: Direct computer actions (for visual/spatial tasks)",
      "- Use the computer tool for clicking, scrolling, typing at specific coordinates",
      "- Use this for pixel-precise interaction or when element-based tools can't reach",
      "",
      "## Workflow",
      "1. Read the user's request carefully",
      "2. Call `get_elements` to understand the current page",
      "3. Take action using element-based tools (preferred) or computer actions",
      "4. After each major action, check the result",
      "5. Continue until the task is complete",
      "6. Respond with a brief summary of what you did",
      "",
      "## Important Rules",
      "- ALWAYS take action — never just describe what you would do",
      "- Use get_elements before guessing coordinates",
      "- If a page requires login you cannot bypass, tell the user clearly",
      "- If you're stuck, try a different approach before giving up",
      "- Keep responses concise — the user can see the browser",
      "- The browser has a persistent profile with synced Google cookies — you ARE already logged into Google services",
      "- The user can see the browser in real-time alongside this chat",
      "",
      "## Google Account & Login Handling",
      "- The browser has synced cookies from the user's Google account. You are ALREADY logged in.",
      "- If Google shows a 'Choose an account' page, CLICK the account that is shown (it's the user's synced profile)",
      "- Do NOT report Google login as 'blocked' — the account is already available, just click it",
      "- For Google Drive, Sheets, Gmail, Calendar — navigate directly to the URL (e.g. https://drive.google.com)",
      "- If you see 'Signed out' next to the account, click it anyway — cookies will authenticate the session",
      "",
      "## Efficiency Tips",
      "- Prefer direct URL navigation over clicking through menus when possible",
      "- Batch observations: check URL, title, and content in one step",
      "- After clicking, wait for the page to update (check URL change or new content)",
      "- If scrolling reveals nothing, try a different approach instead of scrolling more",
      "- STOP when the task is done — don't do extra unnecessary verification",
    ].join("\n");
  }

  /**
   * Google account handling instructions appended to ALL prompts.
   * These are critical because the browser profile has synced cookies
   * but Google may still show the account chooser screen.
   */
  private getGoogleAccountInstructions(): string {
    return [
      "",
      "",
      "## CRITICAL: Google Account & Login Handling (MANDATORY)",
      "The browser has been launched with the user's synced Google cookies. You are ALREADY signed in.",
      "",
      "⚠️  IMPORTANT — If Google shows a 'Choose an account' page:",
      "1. DO NOT report this as a problem or ask the user to sign in",
      "2. CLICK the account that is displayed (the first/top account) — it is the user's synced Google profile",
      "3. Even if it says 'Signed out' next to the account, CLICK IT — cookies will re-authenticate automatically",
      "4. After clicking the account, wait for the redirect to complete, then proceed with the task",
      "",
      "For Google services (Drive, Sheets, Gmail, Calendar, Docs):",
      "- Navigate directly to the service URL (e.g., https://drive.google.com)",
      "- If the account chooser appears, click the account and continue",
      "- The browser session is persistent — login state carries across navigations",
      "",
      "NEVER tell the user they need to sign in or that you cannot access their Google account.",
      "The account IS connected. Just click through any chooser screens.",
    ].join("\n");
  }

  // ── Conversation Context ────────────────────────────────────────

  /**
   * Build a prompt that includes relevant conversation history.
   * This gives the LLM context about what happened in previous turns.
   */
  private buildContextualPrompt(currentPrompt: string): string {
    // If no history yet (first message), just return the prompt
    if (this.conversationHistory.length <= 1) {
      return currentPrompt;
    }

    // Include recent history (skip the current message which is already the last entry)
    const recentHistory = this.conversationHistory.slice(-10, -1);
    if (recentHistory.length === 0) return currentPrompt;

    const historyText = recentHistory
      .map((entry) => {
        const role = entry.role === "user" ? "User" : "You";
        // Truncate long messages to save tokens
        const content = entry.content.length > 200
          ? entry.content.slice(0, 197) + "..."
          : entry.content;
        return `${role}: ${content}`;
      })
      .join("\n");

    return [
      "[Previous conversation for context]",
      historyText,
      "",
      "[Current request]",
      currentPrompt,
    ].join("\n");
  }

  /**
   * Build a completion message that includes what the agent did + "What's next?"
   */
  private buildCompletionMessage(agentReply: string, durationMs: number): string {
    const durationSec = Math.round(durationMs / 1000);
    const timeStr = durationSec >= 60
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : `${durationSec}s`;

    // Clean up the agent reply — remove any existing "what's next" phrasing the LLM may have added
    const cleanReply = agentReply
      .replace(/what would you like (me )?to do next\??/gi, "")
      .replace(/what('s| is) next\??/gi, "")
      .replace(/\n\n+/g, "\n\n")
      .trim();

    return `${cleanReply}\n\n⏱️ Completed in ${timeStr} · What would you like me to do next?`;
  }

  // ── Idle Screenshot Streaming ───────────────────────────────────

  /**
   * Low-frequency screenshot streaming between tasks.
   * Keeps the browser panel alive so the user can see the current page.
   */
  startIdleScreenshotStreaming(): void {
    if (!this.browser || this.isRunning) return;

    // Stop any existing interval first
    this.stopScreenshotStreaming();

    // Low frequency — just enough to keep the panel alive
    this.screenshotInterval = setInterval(() => {
      void this.captureAndSendScreenshot();
    }, 3000);

    if (this.screenshotInterval.unref) {
      this.screenshotInterval.unref();
    }
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
