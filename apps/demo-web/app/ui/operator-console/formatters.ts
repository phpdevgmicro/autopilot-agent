import type {
  RunEventLevel,
  ScenarioManifest,
} from "@cua-sample/replay-schema";

import type { ActivityItem, LogEntry, TranscriptEntry } from "./types";

export function formatClock(value: string) {
  const date = new Date(value);

  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function humanizeToken(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function scenarioTargetDisplay(scenario: ScenarioManifest | null) {
  if (!scenario) {
    return "Runner unavailable";
  }

  return scenario.startTarget.kind === "remote_url"
    ? scenario.startTarget.url
    : scenario.startTarget.path;
}

export function createManualLog(
  event: string,
  detail: string,
  level: RunEventLevel,
): LogEntry {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    detail,
    event,
    key: `manual-${event}-${now}`,
    level,
    time: formatClock(now),
  };
}

export function createManualTranscript(
  lane: TranscriptEntry["lane"],
  speaker: string,
  body: string,
): TranscriptEntry {
  const now = new Date().toISOString();

  return {
    body,
    createdAt: now,
    key: `manual-${speaker}-${now}`,
    lane,
    speaker,
    time: formatClock(now),
  };
}

export function activityFamilyLabel(family: ActivityItem["family"]) {
  switch (family) {
    case "action":
      return "Act";
    case "observe":
      return "Observe";
    case "operator":
      return "Operator";
    case "snapshot":
      return "Snapshot";
    case "tool":
      return "Tool";
    case "verify":
      return "Verify";
    default:
      return "System";
  }
}
