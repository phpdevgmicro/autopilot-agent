import { launchBrowserSession } from "@cua-sample/browser-runtime";
import { type ExecutionMode } from "@cua-sample/replay-schema";

import {
  buildFreestyleCodeInstructions,
  buildFreestyleNativeInstructions,
} from "../freestyle-plan.js";
import {
  createDefaultResponsesClient,
  runResponsesCodeLoop,
  runResponsesNativeComputerLoop,
} from "../responses-loop.js";
import {
  assertActive,
  createLiveResponsesUnavailableError,
  maybeHoldHeadfulBrowserOpen,
  type RunExecutionContext,
  type RunExecutor,
} from "../scenario-runtime.js";

const liveOnlyMessage =
  "Freestyle agent requires the live Responses API. Set OPENAI_API_KEY in the runner environment.";

class FreestyleCodeExecutor implements RunExecutor {
  async execute(context: RunExecutionContext) {
    const client = createDefaultResponsesClient();

    if (!client) {
      await context.emitEvent({
        detail: context.detail.run.prompt,
        level: "error",
        message: liveOnlyMessage,
        type: "run_failed",
      });
      throw createLiveResponsesUnavailableError(liveOnlyMessage);
    }

    const startUrl = (context.detail.run.startUrl && context.detail.run.startUrl.trim()) || "https://www.google.com";

    await context.emitEvent({
      detail: `model=${context.detail.run.model} url=${startUrl}`,
      level: "ok",
      message: "Freestyle agent starting (code mode).",
      type: "run_progress",
    });

    const session = await launchBrowserSession({
      browserMode: context.detail.run.browserMode,
      screenshotDir: context.screenshotDirectory,
      startTarget: {
        kind: "remote_url",
        label: "freestyle-target",
        url: startUrl,
      },
      workspacePath: context.detail.workspacePath,
    });

    try {
      assertActive(context.signal);
      await context.syncBrowserState(session);

      await context.emitEvent({
        detail: startUrl,
        level: "ok",
        message: "Browser session launched and navigated to target URL.",
        type: "browser_session_started",
      });

      await context.captureScreenshot(session, "freestyle-initial");

      const result = await runResponsesCodeLoop(
        {
          context,
          instructions: buildFreestyleCodeInstructions(session.page.url()),
          maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
          prompt: context.detail.run.prompt,
          session,
        },
        client,
      );

      await context.captureScreenshot(session, "freestyle-final");

      await context.emitEvent({
        detail: result.finalAssistantMessage ?? "Task completed.",
        level: "ok",
        message: "Agent completed the task.",
        type: "run_progress",
      });

      await maybeHoldHeadfulBrowserOpen(context);
      await context.completeRun({
        notes: result.notes,
        outcome: "success",
        verificationPassed: false,
      });
    } finally {
      await session.close();
    }
  }
}

class FreestyleNativeExecutor implements RunExecutor {
  async execute(context: RunExecutionContext) {
    const client = createDefaultResponsesClient();

    if (!client) {
      await context.emitEvent({
        detail: context.detail.run.prompt,
        level: "error",
        message: liveOnlyMessage,
        type: "run_failed",
      });
      throw createLiveResponsesUnavailableError(liveOnlyMessage);
    }

    const startUrl = (context.detail.run.startUrl && context.detail.run.startUrl.trim()) || "https://www.google.com";

    await context.emitEvent({
      detail: `model=${context.detail.run.model} url=${startUrl}`,
      level: "ok",
      message: "Freestyle agent starting (native mode).",
      type: "run_progress",
    });

    const session = await launchBrowserSession({
      browserMode: context.detail.run.browserMode,
      screenshotDir: context.screenshotDirectory,
      startTarget: {
        kind: "remote_url",
        label: "freestyle-target",
        url: startUrl,
      },
      workspacePath: context.detail.workspacePath,
    });

    try {
      assertActive(context.signal);
      await context.syncBrowserState(session);

      await context.emitEvent({
        detail: startUrl,
        level: "ok",
        message: "Browser session launched and navigated to target URL.",
        type: "browser_session_started",
      });

      await context.captureScreenshot(session, "freestyle-initial");

      const result = await runResponsesNativeComputerLoop(
        {
          context,
          instructions: buildFreestyleNativeInstructions(session.page.url()),
          maxResponseTurns: context.detail.run.maxResponseTurns ?? 24,
          prompt: context.detail.run.prompt,
          session,
        },
        client,
      );

      await context.captureScreenshot(session, "freestyle-final");

      await context.emitEvent({
        detail: result.finalAssistantMessage ?? "Task completed.",
        level: "ok",
        message: "Agent completed the task.",
        type: "run_progress",
      });

      await maybeHoldHeadfulBrowserOpen(context);
      await context.completeRun({
        notes: result.notes,
        outcome: "success",
        verificationPassed: false,
      });
    } finally {
      await session.close();
    }
  }
}

export function createFreestyleExecutor(mode: ExecutionMode): RunExecutor {
  return mode === "code" ? new FreestyleCodeExecutor() : new FreestyleNativeExecutor();
}
