import vm from "node:vm";
import util from "node:util";

import OpenAI from "openai";

import { type BrowserSession } from "@cua-sample/browser-runtime";

import { RunnerCoreError } from "./errors.js";
import { maskCredentials } from "./credential-mask.js";
import { getPrompt, isPromptStoreSynced } from "./prompt-store.js";
import type { RunExecutionContext } from "./scenario-runtime.js";

type ComputerAction = {
  [key: string]: unknown;
  type: string;
};

type ComputerCallItem = {
  actions?: ComputerAction[];
  call_id?: string;
  pending_safety_checks?: SafetyCheck[];
  type: "computer_call";
};

type FunctionCallItem = {
  arguments?: string;
  call_id?: string;
  name?: string;
  type: "function_call";
};

type MessageItem = {
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  role?: string;
  type: "message";
};

type ReasoningItem = {
  id?: string;
  summary?: Array<{
    text?: string;
    type?: string;
  }>;
  type: "reasoning";
};

type ResponseOutputItem =
  | ComputerCallItem
  | FunctionCallItem
  | MessageItem
  | ReasoningItem
  | { [key: string]: unknown; type: string };

type ResponsesApiResponse = {
  error?: { message?: string } | null;
  id: string;
  output?: ResponseOutputItem[];
  status?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
    total_tokens?: number;
  } | null;
};

type ResponsesLoopMode = "auto" | "fallback" | "live";

type ResponsesClient = {
  create: (
    request: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ResponsesApiResponse>;
};

type SafetyCheck = {
  code?: string;
  message?: string;
};

type ToolOutput =
  | {
      text: string;
      type: "input_text";
    }
  | {
      detail: "original";
      image_url: string;
      type: "input_image";
    };

type ResponsesLoopContext = {
  context: RunExecutionContext;
  instructions: string;
  maxResponseTurns: number;
  prompt?: string;
  session: BrowserSession;
};

type ResponsesLoopResult = {
  finalAssistantMessage?: string;
  notes: string[];
};

const defaultInterActionDelayMs = Number(process.env.CUA_INTER_ACTION_DELAY_MS ?? "120");
const toolExecutionTimeoutMs = Number(process.env.CUA_TOOL_TIMEOUT_MS ?? "20000");
const defaultReasoningEffort = (process.env.CUA_REASONING_EFFORT ?? "low") as "low" | "medium" | "high";
const webhookUrl = process.env.CUA_WEBHOOK_URL?.trim() || null;

// ── Dynamic Turn Budget ─────────────────────────────────────────────
// Instead of a fixed turn limit, the agent starts with a soft budget
// and auto-extends in batches when still making progress.
const TURN_EXTENSION_BATCH = Number(process.env.CUA_TURN_EXTENSION_BATCH ?? "10");
const INITIAL_TURN_BUDGET = Number(process.env.CUA_INITIAL_TURN_BUDGET ?? "15");

/**
 * Estimate an initial turn budget based on task complexity heuristics.
 * Simple lookups get fewer turns, multi-step workflows get more.
 */
function estimateInitialBudget(prompt: string, hardCeiling: number): number {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).length;

  // Complexity signals
  const complexKeywords = [
    "login", "sign in", "fill", "form", "submit", "checkout",
    "multiple", "steps", "navigate", "download", "upload",
    "create account", "register", "book", "schedule", "pay",
    "and then", "after that", "next", "finally",
  ];
  const matchedKeywords = complexKeywords.filter(k => lower.includes(k)).length;

  let budget: number;
  if (matchedKeywords >= 3 || wordCount > 80) {
    budget = Math.min(35, hardCeiling);   // Complex task
  } else if (matchedKeywords >= 1 || wordCount > 30) {
    budget = Math.min(20, hardCeiling);   // Medium task
  } else {
    budget = Math.min(INITIAL_TURN_BUDGET, hardCeiling); // Simple task
  }

  return budget;
}

/**
 * Retry wrapper with exponential backoff for transient API errors.
 * Retries on 429 (rate limit), 500, 502, 503, and network errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1_000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const isRetryable =
        error instanceof Error &&
        (/429|500|502|503|rate.limit|timeout|ECONNRESET|ECONNREFUSED|fetch failed/i.test(
          error.message,
        ));
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/**
 * POST task result to the configured webhook URL (n8n, etc.).
 * Fire-and-forget — errors are silently ignored.
 */
async function notifyWebhook(payload: Record<string, unknown>) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Webhook delivery is best-effort
  }
}

/**
 * Strip markdown formatting so text looks clean in Google Sheets.
 * Removes: **bold**, *italic*, ## headings, `code`, [links](url)
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")   // **bold** → bold
    .replace(/\*(.+?)\*/g, "$1")       // *italic* → italic
    .replace(/^#{1,6}\s+/gm, "")       // ## Heading → Heading
    .replace(/`([^`]+)`/g, "$1")       // `code` → code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // [text](url) → text
    .replace(/^[\-\*]\s+/gm, "• ")     // - item → • item
    .trim();
}

/**
 * Structured activity log entry for tracking what the agent did.
 */
type ActivityLogEntry = {
  turn: number;
  timestamp: string;
  action: string;
  detail?: string | undefined;
  url?: string | undefined;
  pageTitle?: string | undefined;
};

/**
 * Generate an AI-powered walkthrough summary of the task.
 * Uses the same OpenAI API key already configured for the agent.
 */
async function generateAiWalkthrough(
  activityLog: ActivityLogEntry[],
  taskPrompt: string,
  agentConclusion: string,
  model: string,
  totalInputTokens: number,
  totalOutputTokens: number,
  turnsUsed: number,
  maxTurns: number,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || activityLog.length === 0) return null;

  // Build a concise activity summary for the LLM (max 30 entries to save tokens)
  const trimmedLog = activityLog.length > 30
    ? [...activityLog.slice(0, 15), { turn: 0, timestamp: "", action: `... ${activityLog.length - 30} more actions ...` }, ...activityLog.slice(-15)]
    : activityLog;

  const logText = trimmedLog.map((entry) => {
    const parts = [`Turn ${entry.turn}: ${entry.action}`];
    if (entry.detail) parts.push(`  Detail: ${entry.detail.slice(0, 200)}`);
    if (entry.url) parts.push(`  URL: ${entry.url}`);
    if (entry.pageTitle) parts.push(`  Page: ${entry.pageTitle}`);
    return parts.join("\n");
  }).join("\n");

  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Agent";

  // Google Sheet is the single source of truth — no hardcoded fallbacks
  if (!isPromptStoreSynced()) {
    console.warn(`  ⚠️  ${appName} — Prompt store not synced, skipping summary generation`);
    return null;
  }

  const summaryPrompt = getPrompt("walkthrough_summary_prompt", {
    appName,
    taskPrompt,
    logText,
    agentConclusion,
    turnsUsed: String(turnsUsed),
    maxTurns: String(maxTurns),
    totalInputTokens: String(totalInputTokens),
    totalOutputTokens: String(totalOutputTokens),
  });

  if (!summaryPrompt) {
    console.warn(`  ⚠️  ${appName} — Missing 'walkthrough_summary_prompt' in Sheet, skipping summary`);
    return null;
  }

  // Auto-append task context so the summary model always has the data,
  // even if the Sheet prompt doesn't include {{variable}} placeholders
  const autoContext = [
    "",
    "--- TASK DATA (auto-injected) ---",
    `Task: ${taskPrompt}`,
    `Agent conclusion: ${agentConclusion}`,
    `Turns: ${turnsUsed}/${maxTurns}`,
    `Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`,
    "",
    "Activity log:",
    logText,
  ].join("\n");

  // Only append if the prompt doesn't already contain these via {{variables}}
  const hasVariables = summaryPrompt.includes(taskPrompt) && summaryPrompt.includes(logText);
  const finalPrompt = hasVariables ? summaryPrompt : summaryPrompt + autoContext;

  try {
    const openai = new OpenAI({ apiKey });
    const summaryModel = process.env.CUA_SUMMARY_MODEL || "gpt-4o-mini";
    console.log(``);
    console.log(`  📝 ${appName} — Writing mission summary...`);
    console.log(`     🧠 Model: ${summaryModel} | Log entries: ${activityLog.length}`);
    const response = await openai.chat.completions.create({
      model: summaryModel,
      messages: [{ role: "user", content: finalPrompt }],
      max_completion_tokens: 800,
    });
    const summary = response.choices?.[0]?.message?.content ?? null;
    if (summary) {
      console.log(`  ✅ ${appName} — Summary generated (${summary.length} chars)`);
    } else {
      console.warn(`  ⚠️  ${appName} — Summary model returned empty response`);
    }
    console.log(``);
    return summary;
  } catch (err) {
    console.error(`  ❌ ${appName} — Summary generation failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log(``);
    return null;
  }
}

class OpenAIResponsesClient implements ResponsesClient {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    // Injecting a 2-minute explicit connection timeout so dead API sockets abort immediately prompting `withRetry` instead of indefinitely hijacking the workflow.
    this.client = new OpenAI({ apiKey, timeout: 120_000 });
  }

  async create(request: Record<string, unknown>, signal: AbortSignal) {
    return (await this.client.responses.create(request, {
      signal,
    })) as ResponsesApiResponse;
  }
}

function assertActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error("Run aborted.");
  }
}

async function delay(ms: number, signal: AbortSignal) {
  if (ms <= 0) {
    return;
  }

  if (signal.aborted) {
    throw new Error("Run aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Run aborted."));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeImageDataUrl(value: string) {
  return value.startsWith("data:image/")
    ? value
    : `data:image/png;base64,${value}`;
}

function normalizePlaywrightKey(key: string) {
  const normalized = key.trim();
  const lookup = normalized.toUpperCase();

  switch (lookup) {
    case "CTRL":
    case "CONTROL":
      return "Control";
    case "CMD":
    case "COMMAND":
    case "META":
      return "Meta";
    case "ALT":
    case "OPTION":
      return "Alt";
    case "SHIFT":
      return "Shift";
    case "ENTER":
    case "RETURN":
      return "Enter";
    case "ESC":
    case "ESCAPE":
      return "Escape";
    case "SPACE":
      return "Space";
    case "TAB":
      return "Tab";
    case "BACKSPACE":
      return "Backspace";
    case "DELETE":
      return "Delete";
    case "HOME":
      return "Home";
    case "END":
      return "End";
    case "PGUP":
    case "PAGEUP":
      return "PageUp";
    case "PGDN":
    case "PAGEDOWN":
      return "PageDown";
    case "UP":
    case "ARROWUP":
      return "ArrowUp";
    case "DOWN":
    case "ARROWDOWN":
      return "ArrowDown";
    case "LEFT":
    case "ARROWLEFT":
      return "ArrowLeft";
    case "RIGHT":
    case "ARROWRIGHT":
      return "ArrowRight";
    default:
      return normalized.length === 1
        ? normalized
        : normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  }
}

async function capturePageImageDataUrl(session: BrowserSession) {
  const payload = await session.page.screenshot({
    type: "png",
  });

  return `data:image/png;base64,${payload.toString("base64")}`;
}

function parseResponsesLoopMode(env: NodeJS.ProcessEnv = process.env): ResponsesLoopMode {
  const raw = env.CUA_RESPONSES_MODE?.trim().toLowerCase();

  if (raw === "live" || raw === "fallback" || raw === "auto") {
    return raw;
  }

  return "auto";
}

function isTestEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "test" || env.VITEST === "true";
}

export function createDefaultResponsesClient(): ResponsesClient | null {
  const mode = parseResponsesLoopMode();
  const apiKey = process.env.OPENAI_API_KEY;

  if (mode === "fallback") {
    return null;
  }

  if (!apiKey) {
    if (mode === "live") {
      throw new RunnerCoreError(
        "CUA_RESPONSES_MODE=live requires OPENAI_API_KEY to be set.",
        {
          code: "missing_api_key",
          hint:
            "Set OPENAI_API_KEY before starting a live CUA run, or switch CUA_RESPONSES_MODE back to auto.",
          statusCode: 400,
        },
      );
    }

    return null;
  }

  if (mode === "auto" && isTestEnvironment()) {
    return null;
  }

  return new OpenAIResponsesClient(apiKey);
}

function describeUsage(response: ResponsesApiResponse) {
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens ?? 0;

  return `${inputTokens} in · ${outputTokens} out · ${reasoningTokens} reasoning`;
}

function summarizeActions(actions: ComputerAction[]) {
  return actions.map((action) => action.type).join(" -> ") || "no actions";
}

/** Human-readable description of a single computer action for micro-execution events */
function describeComputerAction(action: ComputerAction): string {
  const x = Number(action.x ?? 0);
  const y = Number(action.y ?? 0);
  const coord = Number.isFinite(x) && Number.isFinite(y) ? ` @ ${Math.round(x)},${Math.round(y)}` : "";

  switch (action.type) {
    case "click":
      return `Click${coord}`;
    case "double_click":
      return `Double-click${coord}`;
    case "drag":
      return "Drag";
    case "move":
      return `Move pointer${coord}`;
    case "scroll": {
      const deltaY = Number(action.delta_y ?? action.deltaY ?? action.scroll_y ?? 0);
      return deltaY !== 0 ? `Scroll ${Math.abs(Math.round(deltaY))}px ${deltaY > 0 ? "down" : "up"}` : "Scroll";
    }
    case "type": {
      const text = String(action.text ?? "");
      const preview = text.length > 28 ? `${text.slice(0, 25).trimEnd()}...` : text;
      return preview ? `Type "${preview}"` : "Type text";
    }
    case "keypress": {
      const keys = Array.isArray(action.keys) ? action.keys.map(String) : [String(action.key ?? "")];
      return keys.length > 0 ? `Press ${keys.join(" + ")}` : "Press key";
    }
    case "wait":
      return "Wait";
    case "screenshot":
      return "Capture screenshot";
    default:
      return action.type;
  }
}

function formatActionBatchDetail(actions: ComputerAction[]) {
  const payload = JSON.stringify(actions);

  if (payload.length <= 2_000) {
    return `${summarizeActions(actions)} :: ${payload}`;
  }

  return `${summarizeActions(actions)} :: ${payload.slice(0, 1_997)}...`;
}

function extractAssistantMessageText(response: ResponsesApiResponse) {
  return (response.output ?? [])
    .filter((item): item is MessageItem => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
}

function getFunctionCallItems(response: ResponsesApiResponse) {
  return (response.output ?? []).filter(
    (item): item is FunctionCallItem => item.type === "function_call",
  );
}

function isFunctionCallItem(item: ResponseOutputItem): item is FunctionCallItem {
  return item.type === "function_call";
}

function isComputerCallItem(item: ResponseOutputItem): item is ComputerCallItem {
  return item.type === "computer_call";
}

/** Extract the model's reasoning summary text from response output items */
function extractReasoningSummary(response: ResponsesApiResponse): string | null {
  const reasoningItems = (response.output ?? []).filter(
    (item): item is ReasoningItem => item.type === "reasoning",
  );

  if (reasoningItems.length === 0) return null;

  const summaryTexts = reasoningItems
    .flatMap((item) => item.summary ?? [])
    .filter((part) => part.type === "summary_text" && part.text)
    .map((part) => part.text!.trim())
    .filter(Boolean);

  return summaryTexts.length > 0 ? summaryTexts.join(" ") : null;
}

/** Try to extract a readable code snippet from function call arguments JSON */
function tryExtractCodeSnippet(argsStr: string): string | null {
  try {
    const parsed = JSON.parse(argsStr) as Record<string, unknown>;
    if (typeof parsed.code === "string") {
      const code = parsed.code.trim();
      // Show first 3 lines or 200 chars, whichever is shorter
      const lines = code.split("\n").slice(0, 3);
      const preview = lines.join("\n");
      return preview.length > 200 ? `${preview.slice(0, 197)}...` : preview;
    }
  } catch {
    // Not valid JSON, return null
  }
  return null;
}

async function emitModelTurnEvent(
  context: RunExecutionContext,
  response: ResponsesApiResponse,
  turn: number,
) {
  await context.emitEvent({
    detail: `${response.id} · ${describeUsage(response)}`,
    level: "ok",
    message: `Responses API turn ${turn} completed.`,
    type: "run_progress",
  });

  // Emit reasoning summary (model's thought process)
  const reasoningSummary = extractReasoningSummary(response);
  if (reasoningSummary) {
    await context.emitEvent({
      detail: reasoningSummary,
      level: "ok",
      message: `🧠 Model reasoning (turn ${turn})`,
      type: "run_progress",
    });
  }

  // Emit intermediate assistant text messages
  const intermediateText = extractAssistantMessageText(response);
  if (intermediateText && intermediateText.length > 0) {
    await context.emitEvent({
      detail: intermediateText.length > 500 ? `${intermediateText.slice(0, 497)}...` : intermediateText,
      level: "ok",
      message: `💬 Model response text (turn ${turn})`,
      type: "run_progress",
    });
  }

  // Emit output item details (function calls, computer calls)
  for (const item of response.output ?? []) {
    if (item.type === "function_call") {
      const fc = item as FunctionCallItem;
      const argsPreview = fc.arguments ? maskCredentials(fc.arguments.slice(0, 300)) : "";
      const codeSnippet = tryExtractCodeSnippet(argsPreview);
      await context.emitEvent({
        detail: codeSnippet || argsPreview || "(no arguments)",
        level: "pending",
        message: `🔧 Tool call: ${fc.name ?? "function"}`,
        type: "run_progress",
      });
    } else if (item.type === "computer_call") {
      const cc = item as ComputerCallItem;
      const actionSummary = (cc.actions ?? []).map(a => describeComputerAction(a)).join(" → ");
      await context.emitEvent({
        detail: actionSummary || "(no actions)",
        level: "pending",
        message: `🖱️ Browser plan (turn ${turn})`,
        type: "run_progress",
      });
    }
  }
}

function buildCodeToolDefinitions() {
  return [
    {
      type: "function",
      name: "exec_js",
      description:
        "Execute provided interactive JavaScript in a persistent Playwright REPL context.",
      strict: true,
      parameters: {
        additionalProperties: false,
        properties: {
          code: {
            description: [
              "JavaScript to execute in an async Playwright REPL.",
              "Persist state across calls with globalThis.",
              "Available globals: console.log, display(base64Image), Buffer, browser, context, page.",
              "Use console.log() to read values back. Keep output minimal — avoid logging large payloads.",
              "Use display(base64) to send screenshots/images back. Do NOT write images to disk.",
              "Prefer locator-based waits (waitForSelector, waitForLoadState) over fixed delays.",
              "Do not assume any packages or globals beyond those listed above.",
            ].join("\n"),
            type: "string",
          },
        },
        required: ["code"],
        type: "object",
      },
    },
  ];
}

function buildAgentToolDefinitions() {
  return [
    {
      type: "function",
      name: "read_page_content",
      description: [
        "Extract structured text content from the current web page DOM.",
        "Returns headings, paragraphs, links, buttons, and key data visible on the page.",
        "Use this instead of trying to read text from screenshots — much more accurate.",
        "Call this when you need to: read prices, extract lists/tables, verify text content, find specific data.",
      ].join("\n"),
      strict: true,
      parameters: {
        additionalProperties: false,
        properties: {
          selector: {
            description: "Optional CSS selector to scope extraction to a specific part of the page. Use 'body' or omit for full page.",
            type: "string",
          },
        },
        required: ["selector"],
        type: "object",
      },
    },
    {
      type: "function",
      name: "get_form_fields",
      description: [
        "List all visible form fields on the current page with their labels, types, and current values.",
        "Returns input, select, textarea elements with associated labels.",
        "Use this before filling forms to know exactly which fields exist and what values they expect.",
      ].join("\n"),
      strict: true,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
    },
    {
      type: "function",
      name: "agent_notepad",
      description: [
        "Save or read notes during task execution. Use this to remember data across turns.",
        "action=save: store a key-value pair. action=read: retrieve a value by key. action=list: list all saved keys.",
        "Example: save extracted prices, remember form values, track progress on multi-step tasks.",
      ].join("\n"),
      strict: true,
      parameters: {
        additionalProperties: false,
        properties: {
          action: {
            description: "Operation: save, read, or list",
            type: "string",
            enum: ["save", "read", "list"],
          },
          key: {
            description: "Key name for save/read operations",
            type: "string",
          },
          value: {
            description: "Value to store (for save action only)",
            type: "string",
          },
        },
        required: ["action", "key", "value"],
        type: "object",
      },
    },
  ];
}

function buildComputerToolDefinitions() {
  return [
    {
      type: "computer",
    },
    ...buildAgentToolDefinitions(),
  ];
}

async function withExecutionTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    throw new Error("Run aborted.");
  }

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`Tool execution exceeded ${timeoutMs}ms.`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Run aborted."));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function executeJavaScriptToolCall(
  input: ResponsesLoopContext,
  functionCall: FunctionCallItem,
  ctx: vm.Context,
) {
  const parsed = JSON.parse(functionCall.arguments ?? "{}") as {
    code?: string;
  };
  const code = parsed.code ?? "";
  const toolOutputs: ToolOutput[] = [];

  const sandbox = ctx as vm.Context & {
    __setToolOutputs?: (outputs: ToolOutput[]) => void;
  };
  sandbox.__setToolOutputs?.(toolOutputs);

  if (code.trim().length === 0) {
    return [
      {
        text: "No code was provided to exec_js.",
        type: "input_text" as const,
      },
    ];
  }

  const wrappedCode = `
(async () => {
${code}
})();
`;

  try {
    const execution = new vm.Script(wrappedCode, {
      filename: "exec_js.js",
    }).runInContext(ctx);
    await withExecutionTimeout(
      Promise.resolve(execution).then(() => undefined),
      toolExecutionTimeoutMs,
      input.context.signal,
    );
  } catch (error) {
    const formatted =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    toolOutputs.push({
      text: formatted.trim(),
      type: "input_text",
    });
  }

  if (toolOutputs.length === 0) {
    toolOutputs.push({
      text: "exec_js completed with no console output.",
      type: "input_text",
    });
  }

  await input.context.syncBrowserState(input.session);
  await input.context.captureScreenshot(
    input.session,
    `responses-code-turn-${Date.now()}`,
  );

  return toolOutputs;
}

// ── Agent Tool Handlers ────────────────────────────────────────────

async function executeReadPageContent(
  session: BrowserSession,
  args: { selector?: string },
): Promise<ToolOutput[]> {
  const selector = args.selector?.trim() || "body";
  try {
    // JS runs inside the browser via Playwright — use string-based evaluate
    // to avoid Node.js TS config errors about DOM types (document, window, etc.)
    const content = await session.page.evaluate(`
      (() => {
        const sel = ${JSON.stringify(selector)};
        const el = document.querySelector(sel) || document.body;
        const results = [];

        results.push("PAGE: " + document.title);
        results.push("URL: " + window.location.href);
        results.push("");

        el.querySelectorAll("h1,h2,h3,h4").forEach(h => {
          const txt = h.innerText && h.innerText.trim();
          if (txt) results.push("[" + h.tagName + "] " + txt);
        });

        const textNodes = [];
        el.querySelectorAll("p, li, td, th, span, label, a").forEach(n => {
          const txt = n.innerText && n.innerText.trim();
          if (txt && txt.length > 2 && txt.length < 500) {
            const tag = n.tagName.toLowerCase();
            const href = n.href;
            const prefix = (tag === "a" && href) ? "[LINK: " + href + "]" : "[" + tag + "]";
            textNodes.push(prefix + " " + txt);
          }
        });

        const seen = new Set();
        for (const t of textNodes) {
          if (!seen.has(t) && seen.size < 80) {
            seen.add(t);
            results.push(t);
          }
        }

        el.querySelectorAll("table").forEach((table, ti) => {
          if (ti > 2) return;
          results.push("\\n[TABLE " + (ti + 1) + "]");
          table.querySelectorAll("tr").forEach((row, ri) => {
            if (ri > 15) return;
            const cells = Array.from(row.querySelectorAll("td,th")).map(c => (c.innerText || "").trim());
            results.push(cells.join(" | "));
          });
        });

        return results.join("\\n").slice(0, 4000);
      })()
    `) as string;

    return [{ text: content || "(empty page content)", type: "input_text" }];
  } catch (err) {
    return [{ text: `Error reading page: ${err instanceof Error ? err.message : String(err)}`, type: "input_text" }];
  }
}

async function executeGetFormFields(
  session: BrowserSession,
): Promise<ToolOutput[]> {
  try {
    const fields = await session.page.evaluate(`
      (() => {
        const results = [];
        const inputs = document.querySelectorAll("input:not([type=hidden]), select, textarea");
        inputs.forEach((el, i) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;

          const tag = el.tagName.toLowerCase();
          const type = el.type || tag;
          const name = el.name || el.id || ("field_" + i);
          const value = el.value || "";
          const placeholder = el.placeholder || "";
          const required = el.required ? " [REQUIRED]" : "";
          const disabled = el.disabled ? " [DISABLED]" : "";

          let label = "";
          if (el.id) {
            const labelEl = document.querySelector('label[for="' + el.id + '"]');
            if (labelEl) label = (labelEl.innerText || "").trim();
          }
          if (!label) {
            const parentLabel = el.closest("label");
            if (parentLabel) label = (parentLabel.innerText || "").trim();
          }
          if (!label && el.getAttribute("aria-label")) {
            label = el.getAttribute("aria-label") || "";
          }

          let options = "";
          if (tag === "select") {
            const opts = Array.from(el.options || []).slice(0, 10).map(o => (o.text || "").trim()).filter(Boolean);
            options = " Options: [" + opts.join(", ") + "]";
          }

          results.push(
            (i + 1) + ". [" + type + '] name="' + name + '" label="' + label + '" value="' + value + '" placeholder="' + placeholder + '"' + required + disabled + options + " @ (" + Math.round(rect.x) + "," + Math.round(rect.y) + ")"
          );
        });

        return results.length > 0
          ? "Found " + results.length + " form fields:\\n" + results.join("\\n")
          : "No visible form fields found on this page.";
      })()
    `) as string;

    return [{ text: fields, type: "input_text" }];
  } catch (err) {
    return [{ text: `Error reading form fields: ${err instanceof Error ? err.message : String(err)}`, type: "input_text" }];
  }
}

function executeAgentNotepad(
  notepad: Map<string, string>,
  args: { action: string; key?: string; value?: string },
): ToolOutput[] {
  switch (args.action) {
    case "save": {
      const key = args.key ?? "default";
      const value = args.value ?? "";
      notepad.set(key, value);
      return [{ text: `Saved "${key}": "${value.slice(0, 200)}"`, type: "input_text" }];
    }
    case "read": {
      const key = args.key ?? "default";
      const val = notepad.get(key);
      return [{ text: val ? `${key}: ${val}` : `Key "${key}" not found in notepad.`, type: "input_text" }];
    }
    case "list": {
      const keys = Array.from(notepad.keys());
      return [{ text: keys.length > 0 ? `Notepad keys: ${keys.join(", ")}` : "Notepad is empty.", type: "input_text" }];
    }
    default:
      return [{ text: `Unknown notepad action: ${args.action}. Use save, read, or list.`, type: "input_text" }];
  }
}

async function executeFunctionToolCall(
  input: ResponsesLoopContext,
  functionCall: FunctionCallItem,
  options: {
    vmContext?: vm.Context;
    notepad?: Map<string, string>;
  } = {},
) {
  const toolName = functionCall.name ?? "<unknown>";

  await input.context.emitEvent({
    detail: `${toolName} ${functionCall.arguments ?? "{}"}`,
    level: "pending",
    message: "Function tool call received from the model.",
    type: "function_call_requested",
  });

  let output: ToolOutput[];

  switch (toolName) {
    case "exec_js":
      output = await executeJavaScriptToolCall(
        input,
        functionCall,
        options.vmContext ??
          (() => {
            throw new Error("exec_js requires a vmContext.");
          })(),
      );
      break;

    case "read_page_content": {
      const args = JSON.parse(functionCall.arguments ?? "{}") as { selector?: string };
      output = await executeReadPageContent(input.session, args);
      break;
    }

    case "get_form_fields":
      output = await executeGetFormFields(input.session);
      break;

    case "agent_notepad": {
      const args = JSON.parse(functionCall.arguments ?? "{}") as { action: string; key?: string; value?: string };
      output = executeAgentNotepad(options.notepad ?? new Map(), args);
      break;
    }

    default:
      throw new Error(
        `Unexpected function call: ${functionCall.name ?? "<unknown>"}.`,
      );
  }

  await input.context.emitEvent({
    detail: toolName,
    level: "ok",
    message: "Function tool call completed.",
    type: "function_call_completed",
  });

  return output;
}

/** Emoji icon for each action type */
function actionEmoji(actionType: string): string {
  switch (actionType) {
    case "click":        return "🖱️";
    case "double_click": return "🖱️🖱️";
    case "type":         return "⌨️";
    case "keypress":     return "⌨️";
    case "scroll":       return "📜";
    case "drag":         return "✋";
    case "move":         return "↗️";
    case "wait":         return "⏳";
    case "screenshot":   return "📸";
    default:             return "▶️";
  }
}

async function executeComputerAction(
  input: ResponsesLoopContext,
  action: ComputerAction,
) {
  const { page } = input.session;
  const buttonValue = action.button;
  const button =
    buttonValue === "right" || buttonValue === 2 || buttonValue === 3
      ? "right"
      : buttonValue === "middle" || buttonValue === "wheel"
        ? "middle"
        : "left";
  const x = Number(action.x ?? 0);
  const y = Number(action.y ?? 0);

  // ── Per-action micro-event ──
  const emoji = actionEmoji(action.type);
  const desc = describeComputerAction(action);
  await input.context.emitEvent({
    detail: desc,
    level: "ok",
    message: `${emoji} ${desc}`,
    type: "run_progress",
  });

  switch (action.type) {
    case "click": {
      await page.mouse.click(x, y, { button });
      break;
    }
    case "double_click": {
      await page.mouse.dblclick(x, y, { button });
      break;
    }
    case "drag": {
      const path = Array.isArray(action.path)
        ? action.path
            .map((point) =>
              point &&
              typeof point === "object" &&
              "x" in point &&
              "y" in point
                ? {
                    x: Number((point as { x: unknown }).x),
                    y: Number((point as { y: unknown }).y),
                  }
                : null,
            )
            .filter(
              (
                point,
              ): point is {
                x: number;
                y: number;
              } => point !== null,
            )
        : [];

      if (path.length < 2) {
        throw new Error("drag action did not include a valid path.");
      }

      const startPoint = path[0];

      if (!startPoint) {
        throw new Error("drag action did not include a valid start point.");
      }

      await page.mouse.move(startPoint.x, startPoint.y);
      await page.mouse.down();

      for (const point of path.slice(1)) {
        await page.mouse.move(point.x, point.y);
      }

      await page.mouse.up();
      break;
    }
    case "move": {
      await page.mouse.move(x, y);
      break;
    }
    case "scroll": {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        await page.mouse.move(x, y);
      }
      await page.mouse.wheel(
        Number(action.delta_x ?? action.deltaX ?? 0),
        Number(action.delta_y ?? action.deltaY ?? action.scroll_y ?? 0),
      );
      break;
    }
    case "type": {
      const text = String(action.text ?? "");
      await page.keyboard.type(text);
      break;
    }
    case "keypress": {
      const keys = Array.isArray(action.keys)
        ? action.keys.map((key) => normalizePlaywrightKey(String(key))).filter(Boolean)
        : [normalizePlaywrightKey(String(action.key ?? ""))].filter(Boolean);

      if (keys.length === 0) {
        throw new Error("keypress action did not include a key value.");
      }

      await page.keyboard.press(keys.join("+"));
      break;
    }
    case "wait": {
      const durationMs = Number(action.ms ?? action.duration_ms ?? 1_000);
      await delay(Math.max(0, durationMs), input.context.signal);
      break;
    }
    case "screenshot": {
      break;
    }
    default: {
      throw new Error(`Unsupported computer action: ${action.type}`);
    }
  }

  if (action.type !== "wait" && action.type !== "screenshot") {
    await delay(defaultInterActionDelayMs, input.context.signal);
  }
}

/** Detect and emit navigation events when the page URL changes */
async function emitNavigationIfChanged(
  input: ResponsesLoopContext,
  urlBefore: string,
) {
  try {
    const urlAfter = input.session.page.url();
    if (urlAfter && urlAfter !== urlBefore && urlAfter !== "about:blank") {
      const fromHost = new URL(urlBefore).hostname;
      const toHost = new URL(urlAfter).hostname;
      const crossSite = fromHost !== toHost;
      await input.context.emitEvent({
        detail: `${urlBefore} → ${urlAfter}`,
        level: "ok",
        message: crossSite
          ? `🔗 Navigation: ${fromHost} → ${toHost}`
          : `🔗 Navigated to ${urlAfter.length > 80 ? urlAfter.slice(0, 77) + "..." : urlAfter}`,
        type: "run_progress",
      });
    }
  } catch {
    // Page may have closed — ignore
  }
}

/** Emit page context (URL + title) before a model call */
async function emitPageContext(
  input: ResponsesLoopContext,
  turn: number,
) {
  try {
    const url = input.session.page.url();
    const title = await input.session.page.title().catch(() => "Untitled");
    await input.context.emitEvent({
      detail: `${title} — ${url}`,
      level: "ok",
      message: `📍 Page context (turn ${turn}): ${title}`,
      type: "run_progress",
    });
  } catch {
    // Page may not be ready
  }
}

async function buildComputerCallOutput(
  input: ResponsesLoopContext,
  computerCall: ComputerCallItem,
  artifactLabel: string,
) {
  const pendingSafetyChecks = computerCall.pending_safety_checks ?? [];

  if (pendingSafetyChecks.length > 0) {
    const detail = pendingSafetyChecks
      .map((check) => check.message ?? check.code ?? "Unknown safety check")
      .join(" | ");

    await input.context.emitEvent({
      detail,
      level: "warn",
      message:
        "Computer use safety acknowledgement is required before the run can continue.",
      type: "run_progress",
    });

    throw new RunnerCoreError(
      "Pending computer use safety checks require explicit operator acknowledgement, which is not implemented in this harness yet.",
      {
        code: "unsupported_safety_acknowledgement",
        hint:
          "This sample app does not implement operator approval for pending safety checks yet. Retry with a task that does not trigger a safety acknowledgement.",
        statusCode: 400,
      },
    );
  }

  await input.context.syncBrowserState(input.session);
  const screenshotArtifact = await input.context.captureScreenshot(
    input.session,
    artifactLabel,
  );
  const screenshotDataUrl = await capturePageImageDataUrl(input.session);

  await input.context.emitEvent({
    detail: screenshotArtifact.url,
    level: "ok",
    message: "Computer-call output recorded with the updated screenshot.",
    type: "computer_call_output_recorded",
  });

  return {
    type: "computer_call_output",
    call_id: computerCall.call_id,
    output: {
      image_url: screenshotDataUrl,
      type: "computer_screenshot",
    },
  };
}

function ensureResponseSucceeded(response: ResponsesApiResponse) {
  if (response.error?.message) {
    throw new Error(response.error.message);
  }

  if (response.status === "failed") {
    throw new Error("Responses API request failed.");
  }
}

export async function runResponsesCodeLoop(
  input: ResponsesLoopContext,
  client: ResponsesClient,
): Promise<ResponsesLoopResult> {
  const jsOutputRef: { current: ToolOutput[] } = { current: [] };
  const sandbox = {
    Buffer,
    browser: input.session.browser,
    console: {
      log: (...values: unknown[]) => {
        jsOutputRef.current.push({
          text: util.formatWithOptions(
            { getters: false, maxStringLength: 2_000, showHidden: false },
            ...values,
          ),
          type: "input_text",
        });
      },
    },
    context: input.session.context,
    display: (base64Image: string) => {
      jsOutputRef.current.push({
        detail: "original",
        image_url: normalizeImageDataUrl(base64Image),
        type: "input_image",
      });
    },
    page: input.session.page,
    __setToolOutputs(outputs: ToolOutput[]) {
      jsOutputRef.current = outputs;
    },
  };
  const vmContext = vm.createContext(sandbox);
  let previousResponseId: string | undefined;
  let nextInput: unknown = input.prompt ?? input.context.detail.run.prompt;
  let finalAssistantMessage: string | undefined;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const activityLog: ActivityLogEntry[] = [];
  const startTime = Date.now();

  // ── Dynamic turn budget ──────────────────────────────────────────
  const hardCeiling = input.maxResponseTurns; // absolute max from env
  let currentBudget = estimateInitialBudget(
    input.prompt ?? input.context.detail.run.prompt,
    hardCeiling,
  );
  let extensionsGranted = 0;

  await input.context.emitEvent({
    detail: `Initial budget: ${currentBudget} turns (hard ceiling: ${hardCeiling})`,
    level: "ok",
    message: `⚡ Dynamic turn budget: starting with ${currentBudget} turns`,
    type: "run_progress",
  });

  for (let turn = 1; turn <= currentBudget; turn += 1) {
    assertActive(input.context.signal);

    // Emit page context before model call
    await emitPageContext(input, turn);

    // Micro-event: signal that we're waiting for the model
    await input.context.emitEvent({
      detail: `Turn ${turn}/${currentBudget} · Awaiting model response... (ceiling: ${hardCeiling})`,
      level: "pending",
      message: `Sending request to model (turn ${turn})...`,
      type: "run_progress",
    });

    const response = await withRetry(() =>
      client.create(
        {
          instructions: input.instructions,
          input: nextInput,
          model: input.context.detail.run.model,
          parallel_tool_calls: false,
          previous_response_id: previousResponseId,
          reasoning: { effort: defaultReasoningEffort, summary: "concise" },
          tools: buildCodeToolDefinitions(),
        },
        input.context.signal,
      ),
    );
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;
    ensureResponseSucceeded(response);
    await emitModelTurnEvent(input.context, response, turn);

    previousResponseId = response.id;
    const functionCalls = getFunctionCallItems(response);

    if (functionCalls.length === 0) {
      finalAssistantMessage = extractAssistantMessageText(response) || undefined;
      activityLog.push({
        turn,
        timestamp: new Date().toISOString(),
        action: "Agent produced final response",
        detail: finalAssistantMessage?.slice(0, 300),
      });
      break;
    }

    const toolOutputs = [];

    for (const functionCall of functionCalls) {
      activityLog.push({
        turn,
        timestamp: new Date().toISOString(),
        action: `Called function: ${functionCall.name ?? "exec_js"}`,
        detail: maskCredentials((functionCall.arguments ?? "").slice(0, 200)),
        url: input.session.page.url(),
        pageTitle: await input.session.page.title().catch(() => undefined),
      });

      if (!functionCall.call_id) {
        throw new Error("Unexpected function call returned from the model.");
      }

      const output = await executeFunctionToolCall(input, functionCall, {
        vmContext,
      });

      toolOutputs.push({
        call_id: functionCall.call_id,
        output,
        type: "function_call_output",
      });
    }

    nextInput = toolOutputs;

    // ── Auto-extend budget if agent is still working and approaching limit ──
    if (turn >= currentBudget && currentBudget < hardCeiling) {
      const extension = Math.min(TURN_EXTENSION_BATCH, hardCeiling - currentBudget);
      if (extension > 0) {
        currentBudget += extension;
        extensionsGranted += 1;
        await input.context.emitEvent({
          detail: `Extended by +${extension} turns → new budget: ${currentBudget}/${hardCeiling} (extension #${extensionsGranted})`,
          level: "ok",
          message: `🔄 Auto-extended turn budget (+${extension})`,
          type: "run_progress",
        });
      }
    }
  }

  const turnsUsed = activityLog.length > 0 ? activityLog[activityLog.length - 1]!.turn : 0;

  if (!finalAssistantMessage) {
    finalAssistantMessage = `Task partially completed — used all ${currentBudget} turns (hard ceiling: ${hardCeiling}, extensions: ${extensionsGranted}). The agent was still working when the turn budget was exhausted.`;
    await input.context.emitEvent({
      detail: finalAssistantMessage,
      level: "warn",
      message: `Hard ceiling (${hardCeiling}) reached after ${extensionsGranted} extensions. Returning partial result.`,
      type: "run_progress",
    });
  } else {
    await input.context.emitEvent({
      detail: finalAssistantMessage,
      level: "ok",
      message: "Model returned a final response.",
      type: "run_progress",
    });
  }

  await input.context.emitEvent({
    detail: `${totalInputTokens} in · ${totalOutputTokens} out · ${turnsUsed} turns used (budget: ${currentBudget}, ceiling: ${hardCeiling})`,
    level: "ok",
    message: "Token usage summary for this run.",
    type: "run_progress",
  });

  // Generate AI walkthrough summary FIRST (before webhook)
  await input.context.emitEvent({
    detail: `Analyzing task activity and preparing a summary...`,
    level: "ok",
    message: "\ud83d\udcdd Writing mission summary...",
    type: "run_progress",
  });

  const aiWalkthrough = await generateAiWalkthrough(
    activityLog,
    input.context.detail.run.prompt,
    finalAssistantMessage,
    input.context.detail.run.model,
    totalInputTokens,
    totalOutputTokens,
    activityLog.length,
    input.maxResponseTurns,
  );

  // Always emit walkthrough event so the UI never stays stuck on "generating summary..."
  const walkthroughText = aiWalkthrough || finalAssistantMessage;
  await input.context.emitEvent({
    detail: walkthroughText,
    level: "ok",
    message: aiWalkthrough
      ? "AI-generated task walkthrough."
      : "AI summary unavailable — showing agent conclusion.",
    type: "ai_walkthrough_generated",
  });

  // Send webhook WITH walkthrough (after it's generated)
  // Only send fields that the n8n "CUA Task Logger" maps to Google Sheet columns:
  // Summary | Task Prompt | Timestamp | Status | Duration (s)
  await notifyWebhook({
    status: finalAssistantMessage.startsWith("Task partially") ? "partial" : "success",
    taskPrompt: maskCredentials(input.context.detail.run.prompt),
    aiWalkthrough: aiWalkthrough ? stripMarkdown(aiWalkthrough) : maskCredentials(finalAssistantMessage),
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  });

  return {
    finalAssistantMessage,
    notes: [
      "Executed the scenario through a live Responses API code loop.",
      `Model final response: ${finalAssistantMessage}`,
    ],
  };
}

export async function runResponsesNativeComputerLoop(
  input: ResponsesLoopContext,
  client: ResponsesClient,
): Promise<ResponsesLoopResult> {
  const operatorPrompt = input.prompt ?? input.context.detail.run.prompt;
  let previousResponseId: string | undefined;
  let nextInput: unknown = [
    {
      content: [
        {
          text: operatorPrompt,
          type: "input_text",
        },
        {
          detail: "original",
          image_url: await capturePageImageDataUrl(input.session),
          type: "input_image",
        },
      ],
      role: "user",
    },
  ];
  let finalAssistantMessage: string | undefined;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastTurn = 0;
  const activityLog: ActivityLogEntry[] = [];
  const startTime = Date.now();
  const agentNotepad = new Map<string, string>();

  // ── Dynamic turn budget ──────────────────────────────────────────
  const hardCeiling = input.maxResponseTurns;
  let currentBudget = estimateInitialBudget(operatorPrompt, hardCeiling);
  let extensionsGranted = 0;

  await input.context.emitEvent({
    detail: `Initial budget: ${currentBudget} turns (hard ceiling: ${hardCeiling})`,
    level: "ok",
    message: `⚡ Dynamic turn budget: starting with ${currentBudget} turns`,
    type: "run_progress",
  });

  for (let turn = 1; turn <= currentBudget; turn += 1) {
    lastTurn = turn;
    assertActive(input.context.signal);

    // Emit page context before model call
    await emitPageContext(input, turn);

    // Micro-event: signal that we're waiting for the model
    await input.context.emitEvent({
      detail: `Turn ${turn}/${currentBudget} · Awaiting model response... (ceiling: ${hardCeiling})`,
      level: "pending",
      message: `Sending request to model (turn ${turn})...`,
      type: "run_progress",
    });

    const response = await withRetry(() =>
      client.create(
        {
          instructions: input.instructions,
          input: nextInput,
          model: input.context.detail.run.model,
          parallel_tool_calls: false,
          previous_response_id: previousResponseId,
          reasoning: { effort: defaultReasoningEffort },
          tools: buildComputerToolDefinitions(),
        },
        input.context.signal,
      ),
    );
    totalInputTokens += response.usage?.input_tokens ?? 0;
    totalOutputTokens += response.usage?.output_tokens ?? 0;
    ensureResponseSucceeded(response);
    await emitModelTurnEvent(input.context, response, turn);

    previousResponseId = response.id;
    const hasToolCalls = (response.output ?? []).some(
      (item) => item.type === "computer_call" || item.type === "function_call",
    );

    if (!hasToolCalls) {
      finalAssistantMessage = extractAssistantMessageText(response) || undefined;
      activityLog.push({
        turn,
        timestamp: new Date().toISOString(),
        action: "Agent produced final response",
        detail: finalAssistantMessage?.slice(0, 300),
      });
      break;
    }

    const toolOutputs = [];

    for (const outputItem of response.output ?? []) {
      if (isFunctionCallItem(outputItem)) {
        if (!outputItem.call_id) {
          throw new Error("Unexpected function call returned from the model.");
        }

        toolOutputs.push({
          call_id: outputItem.call_id,
          output: await executeFunctionToolCall(input, outputItem, { notepad: agentNotepad }),
          type: "function_call_output",
        });
        continue;
      }

      if (!isComputerCallItem(outputItem)) {
        continue;
      }

      const actions = outputItem.actions ?? [];

      // Log each action to the activity log
      for (const action of actions) {
        const actionType = String((action as Record<string, unknown>).type ?? "unknown");
        activityLog.push({
          turn,
          timestamp: new Date().toISOString(),
          action: `Browser action: ${actionType}`,
          detail: actionType === "type" ? `Typed: "${maskCredentials(String((action as Record<string, unknown>).text ?? "").slice(0, 100))}"` :
                  actionType === "click" ? `Clicked at (${(action as Record<string, unknown>).x}, ${(action as Record<string, unknown>).y})` :
                  actionType === "scroll" ? "Scrolled the page" :
                  actionType === "keypress" ? `Pressed ${String((action as Record<string, unknown>).key ?? "key")}` :
                  actionType === "wait" ? "Waited for page" :
                  actionType,
          url: input.session.page.url(),
          pageTitle: await input.session.page.title().catch(() => undefined),
        });
      }

      await input.context.emitEvent({
        detail: formatActionBatchDetail(actions),
        level: "pending",
        message: "Computer-call batch received from the model.",
        type: "computer_call_requested",
      });

      // Capture URL before actions for navigation detection
      const urlBeforeActions = input.session.page.url();

      for (let ai = 0; ai < actions.length; ai++) {
        const action = actions[ai]!;
        // executeComputerAction now emits per-action micro-events internally
        await executeComputerAction(input, action);
      }

      // Wait for the page to settle after actions (navigation, clicks, etc.)
      try {
        await input.session.page.waitForLoadState("domcontentloaded", { timeout: 5_000 });
      } catch {
        // Timeout is fine — some pages (SPAs, streams) never reach idle
      }

      // ── Navigation Detection ──
      await emitNavigationIfChanged(input, urlBeforeActions);

      await input.context.emitEvent({
        detail: formatActionBatchDetail(actions),
        level: "ok",
        message: "Browser actions executed against the active lab.",
        type: "computer_actions_executed",
      });

      toolOutputs.push(
        await buildComputerCallOutput(
          input,
          outputItem,
          `responses-native-turn-${turn}`,
        ),
      );
    }

    nextInput = toolOutputs;

    // ── Auto-extend budget if agent is still working and approaching limit ──
    if (turn >= currentBudget && currentBudget < hardCeiling) {
      const extension = Math.min(TURN_EXTENSION_BATCH, hardCeiling - currentBudget);
      if (extension > 0) {
        currentBudget += extension;
        extensionsGranted += 1;
        await input.context.emitEvent({
          detail: `Extended by +${extension} turns → new budget: ${currentBudget}/${hardCeiling} (extension #${extensionsGranted})`,
          level: "ok",
          message: `🔄 Auto-extended turn budget (+${extension})`,
          type: "run_progress",
        });
      }
    }
  }

  if (!finalAssistantMessage) {
    finalAssistantMessage = `Task partially completed — used all ${currentBudget} turns (hard ceiling: ${hardCeiling}, extensions: ${extensionsGranted}). The agent was still working when the turn budget was exhausted.`;
    await input.context.emitEvent({
      detail: finalAssistantMessage,
      level: "warn",
      message: `Hard ceiling (${hardCeiling}) reached after ${extensionsGranted} extensions. Returning partial result.`,
      type: "run_progress",
    });
  } else {
    await input.context.emitEvent({
      detail: finalAssistantMessage,
      level: "ok",
      message: "Model returned a final response.",
      type: "run_progress",
    });
  }

  await input.context.emitEvent({
    detail: `${totalInputTokens} in · ${totalOutputTokens} out · ${lastTurn} turns used (budget: ${currentBudget}, ceiling: ${hardCeiling})`,
    level: "ok",
    message: "Token usage summary for this run.",
    type: "run_progress",
  });

  // Generate AI walkthrough summary FIRST (before webhook)
  const aiWalkthrough = await generateAiWalkthrough(
    activityLog,
    input.context.detail.run.prompt,
    finalAssistantMessage,
    input.context.detail.run.model,
    totalInputTokens,
    totalOutputTokens,
    lastTurn,
    currentBudget,
  );

  // Always emit walkthrough event so the UI never stays stuck on "generating summary..."
  const nativeWalkthroughText = aiWalkthrough || finalAssistantMessage;
  await input.context.emitEvent({
    detail: nativeWalkthroughText,
    level: "ok",
    message: aiWalkthrough
      ? "AI-generated task walkthrough."
      : "AI summary unavailable — showing agent conclusion.",
    type: "ai_walkthrough_generated",
  });

  // Send webhook WITH walkthrough (after it's generated)
  await notifyWebhook({
    status: finalAssistantMessage.startsWith("Task partially") ? "partial" : "success",
    taskPrompt: maskCredentials(input.context.detail.run.prompt),
    aiWalkthrough: aiWalkthrough ? stripMarkdown(aiWalkthrough) : maskCredentials(finalAssistantMessage),
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  });

  return {
    finalAssistantMessage,
    notes: [
      "Executed the scenario through a live Responses API native computer-tool loop.",
      `Model final response: ${finalAssistantMessage}`,
    ],
  };
}
