import type {
  BrowserScreenshotArtifact,
  RunEvent,
} from "@cua-sample/replay-schema";

import { formatClock, humanizeToken } from "./formatters";
import type { ActivityItem, LogEntry, TranscriptEntry } from "./types";

/* ── Private helpers ── */

function formatUrlLabel(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;

    return `${url.hostname}${path}${url.search}`;
  } catch {
    return value;
  }
}

function parseToolPayload(detail: string | undefined) {
  if (!detail) {
    return null;
  }

  const match = detail.match(/^([a-z_]+)\s+(\{[\s\S]+\})$/i);

  if (!match) {
    return null;
  }

  try {
    const label = match[1];
    const payloadText = match[2];

    if (!label || !payloadText) {
      return null;
    }

    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const code =
      typeof payload.code === "string" && label === "exec_js"
        ? payload.code
        : undefined;
    const detailPayload = { ...payload };

    if (code) {
      delete detailPayload.code;
    }

    return {
      ...(code ? { code } : {}),
      ...(Object.keys(detailPayload).length > 0
        ? { detail: JSON.stringify(detailPayload, null, 2) }
        : {}),
      label,
      payload: detailPayload,
    };
  } catch {
    return null;
  }
}

function describeToolCall(label: string, payload: Record<string, unknown>) {
  switch (label) {
    case "exec_js":
      return "Run browser script";
    default:
      return Object.keys(payload).length > 0
        ? humanizeToken(label)
        : "Tool requested";
  }
}

function summarizeToolCall(label: string, payload: Record<string, unknown>) {
  switch (label) {
    case "exec_js":
      return "Model is using the browser runtime directly.";
    default:
      return Object.keys(payload).length > 0
        ? JSON.stringify(payload)
        : "Model requested a workspace helper tool.";
  }
}

function formatCoordinate(xValue: unknown, yValue: unknown) {
  const x = Number(xValue);
  const y = Number(yValue);

  return Number.isFinite(x) && Number.isFinite(y)
    ? ` @ ${Math.round(x)},${Math.round(y)}`
    : "";
}

function summarizeComputerAction(action: Record<string, unknown>) {
  const type = typeof action.type === "string" ? action.type : "action";

  switch (type) {
    case "click":
      return `Click${formatCoordinate(action.x, action.y)}`;
    case "double_click":
      return `Double-click${formatCoordinate(action.x, action.y)}`;
    case "drag":
      return "Drag";
    case "move":
      return `Move pointer${formatCoordinate(action.x, action.y)}`;
    case "scroll": {
      const deltaY = Number(action.delta_y ?? action.deltaY ?? action.scroll_y);

      if (!Number.isFinite(deltaY) || deltaY === 0) {
        return "Scroll";
      }

      return `Scroll ${Math.abs(Math.round(deltaY))} px ${
        deltaY > 0 ? "down" : "up"
      }`;
    }
    case "type": {
      const text = typeof action.text === "string" ? action.text : "";
      const preview =
        text.length > 28 ? `${text.slice(0, 25).trimEnd()}...` : text;

      return preview ? `Type "${preview}"` : "Type text";
    }
    case "keypress": {
      const keys = Array.isArray(action.keys)
        ? action.keys.map((key) => String(key))
        : typeof action.key === "string"
          ? [action.key]
          : [];

      return keys.length > 0 ? `Press ${keys.join(" + ")}` : "Press key";
    }
    case "wait": {
      const durationMs = Number(action.ms ?? action.duration_ms ?? 1_000);

      if (!Number.isFinite(durationMs)) {
        return "Wait";
      }

      return durationMs >= 1_000
        ? `Wait ${(durationMs / 1_000).toFixed(1)} s`
        : `Wait ${Math.round(durationMs)} ms`;
    }
    case "screenshot":
      return "Capture screenshot";
    default:
      return humanizeToken(type);
  }
}

function parseActionBatchDetail(detail: string | undefined) {
  if (!detail) {
    return null;
  }

  const separator = detail.indexOf(" :: ");
  const payloadText = separator >= 0 ? detail.slice(separator + 4) : detail;

  try {
    const payload = JSON.parse(payloadText) as unknown;

    if (!Array.isArray(payload)) {
      return null;
    }

    const actions = payload.filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object",
    );

    return {
      detail: JSON.stringify(actions, null, 2),
      preview:
        actions.map((action) => summarizeComputerAction(action)).join(" • ") ||
        "No browser actions",
    };
  } catch {
    return null;
  }
}

function findRelatedScreenshot(
  detail: string | undefined,
  screenshots: BrowserScreenshotArtifact[],
) {
  if (!detail) {
    return null;
  }

  return screenshots.find((screenshot) => screenshot.url === detail) ?? null;
}

function formatScreenshotSummary(screenshot: BrowserScreenshotArtifact) {
  const page = screenshot.pageTitle?.trim() || formatUrlLabel(screenshot.pageUrl);

  return `${page} · ${formatClock(screenshot.capturedAt)}`;
}

function withOptionalDetail(detail: string | undefined) {
  return detail ? { detail } : {};
}

/* ── Public mappers ── */

export function mapRunEventToActivity(
  event: RunEvent,
  screenshots: BrowserScreenshotArtifact[],
): ActivityItem {
  const parsedPayload = parseToolPayload(event.detail);
  const parsedActionBatch = parseActionBatchDetail(event.detail);
  const relatedScreenshot = findRelatedScreenshot(event.detail, screenshots);

  switch (event.type) {
    case "run_started":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run started",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "workspace_prepared":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Workspace ready",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "lab_started":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Lab runtime started",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "browser_session_started":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "observe",
        headline: "Browser session started",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "browser_navigated":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "observe",
        headline: "Navigation",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ? formatUrlLabel(event.detail) : event.message,
        time: formatClock(event.createdAt),
      };
    case "function_call_requested":
      return {
        createdAt: event.createdAt,
        ...(parsedPayload?.code ? { code: parsedPayload.code } : {}),
        ...(parsedPayload?.detail
          ? { detail: parsedPayload.detail }
          : event.detail
            ? { detail: event.detail }
            : {}),
        family: "tool",
        headline: parsedPayload
          ? describeToolCall(parsedPayload.label, parsedPayload.payload)
          : "Tool requested",
        key: `activity-${event.id}`,
        level: event.level,
        summary: parsedPayload
          ? summarizeToolCall(parsedPayload.label, parsedPayload.payload)
          : event.message,
        time: formatClock(event.createdAt),
      };
    case "function_call_completed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "tool",
        headline: event.detail
          ? `${humanizeToken(event.detail)} complete`
          : "Tool completed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.message,
        time: formatClock(event.createdAt),
      };
    case "computer_call_requested":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(parsedActionBatch?.detail ?? event.detail),
        family: "action",
        headline: "Browser action batch queued",
        key: `activity-${event.id}`,
        level: event.level,
        summary: parsedActionBatch?.preview ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "computer_actions_executed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(parsedActionBatch?.detail ?? event.detail),
        family: "action",
        headline: "Browser action batch executed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: parsedActionBatch?.preview ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "computer_call_output_recorded":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(
          relatedScreenshot
            ? JSON.stringify(
                {
                  capturedAt: relatedScreenshot.capturedAt,
                  label: relatedScreenshot.label,
                  pageTitle: relatedScreenshot.pageTitle,
                  pageUrl: relatedScreenshot.pageUrl,
                },
                null,
                2,
              )
            : event.detail,
        ),
        family: "snapshot",
        headline: "Browser frame captured",
        key: `activity-${event.id}`,
        level: event.level,
        ...(relatedScreenshot ? { screenshotId: relatedScreenshot.id } : {}),
        summary: relatedScreenshot
          ? formatScreenshotSummary(relatedScreenshot)
          : event.message,
        time: formatClock(event.createdAt),
      };
    case "screenshot_captured":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(
          relatedScreenshot
            ? JSON.stringify(
                {
                  capturedAt: relatedScreenshot.capturedAt,
                  label: relatedScreenshot.label,
                  pageTitle: relatedScreenshot.pageTitle,
                  pageUrl: relatedScreenshot.pageUrl,
                },
                null,
                2,
              )
            : event.detail,
        ),
        family: "snapshot",
        headline: relatedScreenshot
          ? `Captured ${humanizeToken(relatedScreenshot.label)}`
          : "Screenshot captured",
        key: `activity-${event.id}`,
        level: event.level,
        ...(relatedScreenshot ? { screenshotId: relatedScreenshot.id } : {}),
        summary: relatedScreenshot
          ? formatScreenshotSummary(relatedScreenshot)
          : event.message,
        time: formatClock(event.createdAt),
      };
    case "verification_completed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "verify",
        headline: "Verification completed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "run_completed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run completed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.message,
        time: formatClock(event.createdAt),
      };
    case "run_failed":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run failed",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "run_cancelled":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: "Run cancelled",
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    case "run_progress":
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family:
          event.message === "Model returned a final response."
            ? "verify"
            : "system",
        headline: event.message.replace(/\.$/, ""),
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
    default:
      return {
        createdAt: event.createdAt,
        ...withOptionalDetail(event.detail),
        family: "system",
        headline: humanizeToken(event.type),
        key: `activity-${event.id}`,
        level: event.level,
        summary: event.detail ?? event.message,
        time: formatClock(event.createdAt),
      };
  }
}

export function mapManualLogToActivity(entry: LogEntry): ActivityItem {
  return {
    createdAt: entry.createdAt,
    detail: entry.detail,
    family: "system",
    headline: humanizeToken(entry.event),
    key: `activity-${entry.key}`,
    level: entry.level,
    summary: entry.detail,
    time: entry.time,
  };
}

export function mapManualTranscriptToActivity(entry: TranscriptEntry): ActivityItem {
  return {
    createdAt: entry.createdAt,
    detail: entry.speaker,
    family: entry.lane === "verification" ? "verify" : "operator",
    headline: humanizeToken(entry.speaker),
    key: `activity-${entry.key}`,
    level: entry.lane === "verification" ? "ok" : "pending",
    summary: entry.body,
    time: entry.time,
  };
}
