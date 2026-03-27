import {
  runnerErrorResponseSchema,
  type RunDetail,
} from "@cua-sample/replay-schema";

import { runnerUnavailableHint } from "./constants";
import { humanizeToken } from "./formatters";

export type RunnerIssue = {
  code: string;
  error: string;
  hint?: string;
  title: string;
};

function titleForIssueCode(code: string) {
  switch (code) {
    case "runner_unavailable":
      return "Runner unavailable";
    case "missing_api_key":
      return "Runner missing API key";
    case "live_mode_unavailable":
      return "Live mode unavailable";
    case "unsupported_safety_acknowledgement":
      return "Safety acknowledgement unavailable";
    case "run_already_active":
      return "Run already active";
    case "invalid_request":
      return "Invalid request";
    default:
      return humanizeToken(code);
  }
}

export function formatRunnerIssueMessage(issue: RunnerIssue) {
  return issue.hint ? `${issue.error} ${issue.hint}` : issue.error;
}

export function createRunnerIssue(
  code: string,
  error: string,
  hint?: string,
): RunnerIssue {
  return {
    code,
    error,
    ...(hint ? { hint } : {}),
    title: titleForIssueCode(code),
  };
}

export function parseRunnerIssue(value: unknown) {
  const parsed = runnerErrorResponseSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  return createRunnerIssue(parsed.data.code, parsed.data.error, parsed.data.hint);
}

export function createRunnerUnavailableIssue(detail?: string) {
  return createRunnerIssue(
    "runner_unavailable",
    detail
      ? `The operator console could not reach the runner. ${detail}`
      : "The operator console could not reach the runner.",
    runnerUnavailableHint,
  );
}

export function deriveRunFailureIssue(runDetail: RunDetail | null) {
  if (!runDetail || runDetail.run.status !== "failed") {
    return null;
  }

  const notes = runDetail.run.summary?.notes ?? [];
  const message = notes[0] ?? "Run failed during execution.";
  const code = notes.find((note) => note.startsWith("Error code: "))?.slice(12);
  const hint = notes.find((note) => note.startsWith("Hint: "))?.slice(6);

  return createRunnerIssue(code ?? "run_failed", message, hint);
}
