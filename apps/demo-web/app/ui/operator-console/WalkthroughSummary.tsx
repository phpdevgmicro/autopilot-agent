"use client";

import { useState } from "react";
import type { RunDetail, RunEvent, BrowserScreenshotArtifact } from "@cua-sample/replay-schema";
import { formatClock } from "./helpers";

type WalkthroughSummaryProps = {
  runEvents: RunEvent[];
  runnerBaseUrl: string;
  screenshots: BrowserScreenshotArtifact[];
  selectedRun: RunDetail | null;
};

/* ────────────────────────────────────────────────── Helpers */

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function shortTime(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return ""; }
}

function getStatusInfo(status: string, outcome?: string) {
  switch (status) {
    case "completed":
      return {
        badge: outcome === "failure" ? "⚠️ Partial" : "✅ Completed",
        cls: outcome === "failure" ? "walkthroughBadgeWarn" : "walkthroughBadgeSuccess",
      };
    case "failed":
      return { badge: "❌ Failed", cls: "walkthroughBadgeError" };
    case "cancelled":
      return { badge: "⏹️ Cancelled", cls: "walkthroughBadgeWarn" };
    default:
      return { badge: "⏳ Unknown", cls: "walkthroughBadgeWarn" };
  }
}

/** Build the narrative: what did the agent actually DO between each screenshot? */
type NarrativeStep = {
  screenshot: BrowserScreenshotArtifact;
  index: number;
  actions: string[];       // Plain-English descriptions of actions
  pageUrl: string;
  pageTitle: string;
};

function buildNarrative(
  screenshots: BrowserScreenshotArtifact[],
  events: RunEvent[],
): NarrativeStep[] {
  if (screenshots.length === 0) return [];

  // Build a list of meaningful events (excluding internal plumbing)
  const meaningful: { time: string; desc: string }[] = [];
  let lastUrl = "";

  for (const ev of events) {
    switch (ev.type) {
      case "browser_navigated":
        if (ev.detail && ev.detail !== lastUrl) {
          lastUrl = ev.detail;
          try {
            const u = new URL(ev.detail);
            meaningful.push({ time: ev.createdAt, desc: `Navigated to ${u.hostname}${u.pathname === "/" ? "" : u.pathname}` });
          } catch {
            meaningful.push({ time: ev.createdAt, desc: `Navigated to ${ev.detail}` });
          }
        }
        break;

      case "computer_actions_executed":
        if (ev.detail) {
          const sep = ev.detail.indexOf(" :: ");
          const payload = sep >= 0 ? ev.detail.slice(sep + 4) : ev.detail;
          try {
            const actions = JSON.parse(payload) as Array<Record<string, unknown>>;
            for (const a of actions) {
              const t = String(a.type ?? "");
              switch (t) {
                case "click":
                  meaningful.push({ time: ev.createdAt, desc: "Clicked on the page" });
                  break;
                case "double_click":
                  meaningful.push({ time: ev.createdAt, desc: "Double-clicked on the page" });
                  break;
                case "type":
                  meaningful.push({
                    time: ev.createdAt,
                    desc: `Typed "${String(a.text ?? "").slice(0, 60)}"`,
                  });
                  break;
                case "scroll":
                  meaningful.push({
                    time: ev.createdAt,
                    desc: `Scrolled ${Number(a.delta_y ?? a.scroll_y ?? 0) > 0 ? "down" : "up"} the page`,
                  });
                  break;
                case "keypress":
                  meaningful.push({
                    time: ev.createdAt,
                    desc: `Pressed ${Array.isArray(a.keys) ? a.keys.join(" + ") : String(a.key ?? "key")}`,
                  });
                  break;
                case "wait":
                  meaningful.push({ time: ev.createdAt, desc: "Waited for the page to load" });
                  break;
                // skip "screenshot" type — it's just internal
              }
            }
          } catch { /* skip */ }
        }
        break;

      case "run_progress":
        // Only include meaningful progress, not internal noise
        if (ev.message && !ev.message.includes("output_recorded") && !ev.message.includes("Calling computer")) {
          if (ev.message.includes("Model returned a final response")) {
            // Skip — we show the conclusion separately
          } else if (ev.message.includes("Reasoning")) {
            meaningful.push({ time: ev.createdAt, desc: "Agent is thinking..." });
          } else {
            meaningful.push({ time: ev.createdAt, desc: ev.message });
          }
        }
        break;

      case "function_call_completed":
        if (ev.message) {
          meaningful.push({ time: ev.createdAt, desc: ev.message });
        }
        break;
    }
  }

  // Now pair screenshots with actions that happened BEFORE each screenshot
  const steps: NarrativeStep[] = [];
  let actionIndex = 0;

  for (let i = 0; i < screenshots.length; i++) {
    const ss = screenshots[i]!;
    const ssTime = new Date(ss.capturedAt).getTime();
    const actions: string[] = [];

    // Collect all events that happened before this screenshot
    while (actionIndex < meaningful.length) {
      const evTime = new Date(meaningful[actionIndex]!.time).getTime();
      if (evTime <= ssTime) {
        actions.push(meaningful[actionIndex]!.desc);
        actionIndex++;
      } else {
        break;
      }
    }

    // Deduplicate consecutive identical actions
    const deduped: string[] = [];
    for (const a of actions) {
      if (deduped.length === 0 || deduped[deduped.length - 1] !== a) {
        deduped.push(a);
      }
    }

    steps.push({
      screenshot: ss,
      index: i,
      actions: deduped,
      pageUrl: ss.pageUrl,
      pageTitle: ss.pageTitle ?? "",
    });
  }

  // Collect any remaining actions after the last screenshot
  if (steps.length > 0 && actionIndex < meaningful.length) {
    const lastStep = steps[steps.length - 1]!;
    while (actionIndex < meaningful.length) {
      lastStep.actions.push(meaningful[actionIndex]!.desc);
      actionIndex++;
    }
  }

  return steps;
}

/* ────────────────────────────────────────────────── Component */

export function WalkthroughSummary({ runEvents, runnerBaseUrl, screenshots, selectedRun }: WalkthroughSummaryProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (!selectedRun) return null;

  const { run } = selectedRun;
  const isFinished = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
  if (!isFinished) return null;

  const statusInfo = getStatusInfo(run.status, run.summary?.outcome);
  const duration = run.durationMs ? formatDuration(run.durationMs) : null;
  const summary = run.summary;

  // Extract agent conclusion (final model response)
  let agentConclusion = "";
  for (const ev of runEvents) {
    if (ev.type === "run_progress" && ev.message === "Model returned a final response." && ev.detail) {
      agentConclusion = ev.detail;
    }
  }

  // Build the narrative timeline
  const narrative = buildNarrative(screenshots, runEvents);

  // Failure notes
  const notes = run.summary?.notes ?? [];

  return (
    <div className="walkthroughScroll">
      <section className="walkthroughCard">
        {/* ── Header ──────────────────────────────── */}
        <div className="walkthroughHeader">
          <div className="walkthroughHeaderLeft">
            <span className={`walkthroughBadge ${statusInfo.cls}`}>
              {statusInfo.badge}
            </span>
            <h2 className="walkthroughTitle">Agent Walkthrough</h2>
          </div>
          <div className="walkthroughMeta">
            {duration ? <span className="walkthroughDuration">⏱️ {duration}</span> : null}
            {summary ? (
              <span className="walkthroughStats">
                {summary.screenshotCount} frames captured
              </span>
            ) : null}
          </div>
        </div>

        {/* ── Result Summary ──────────────────────── */}
        {agentConclusion ? (
          <div className="walkthroughSection">
            <h3>💡 Result</h3>
            <p className="walkthroughConclusion">{agentConclusion}</p>
          </div>
        ) : null}

        {/* ── Narrative Timeline ──────────────────── */}
        {narrative.length > 0 ? (
          <div className="walkthroughSection">
            <h3>📖 What the Agent Did</h3>
            <div className="walkthroughNarrative">
              {narrative.map((step) => (
                <div key={step.screenshot.id} className="walkthroughStep">
                  {/* Step connector line */}
                  <div className="walkthroughStepConnector">
                    <div className="walkthroughStepDot">
                      {step.index === 0
                        ? "🟢"
                        : step.index === narrative.length - 1
                          ? "🏁"
                          : <span className="walkthroughStepNum">{step.index + 1}</span>}
                    </div>
                    {step.index < narrative.length - 1 ? (
                      <div className="walkthroughStepLine" />
                    ) : null}
                  </div>

                  {/* Step content */}
                  <div className="walkthroughStepContent">
                    <div className="walkthroughStepHeader">
                      <span className="walkthroughStepLabel">
                        {step.index === 0 ? "Started" : step.index === narrative.length - 1 ? "Finished" : `Step ${step.index}`}
                      </span>
                      <span className="walkthroughStepTime">{shortTime(step.screenshot.capturedAt)}</span>
                      {step.pageTitle ? (
                        <span className="walkthroughStepPage">
                          {step.pageTitle.length > 35 ? step.pageTitle.slice(0, 32) + "..." : step.pageTitle}
                        </span>
                      ) : null}
                    </div>

                    {/* Actions list */}
                    {step.actions.length > 0 ? (
                      <ul className="walkthroughStepActions">
                        {step.actions.map((action, ai) => (
                          <li key={ai}>{action}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="walkthroughStepNoAction">Screenshot captured</p>
                    )}

                    {/* Screenshot thumbnail — click to expand */}
                    <button
                      className={`walkthroughStepThumb ${expandedStep === step.index ? "walkthroughStepThumbActive" : ""}`}
                      onClick={() => setExpandedStep(expandedStep === step.index ? null : step.index)}
                      type="button"
                    >
                      <img
                        alt={step.screenshot.label}
                        className="walkthroughStepImg"
                        src={`${runnerBaseUrl}${step.screenshot.url}`}
                        loading="lazy"
                      />
                      <span className="walkthroughStepThumbHint">
                        {expandedStep === step.index ? "Click to collapse" : "Click to expand"}
                      </span>
                    </button>

                    {/* Expanded full screenshot */}
                    {expandedStep === step.index ? (
                      <div className="walkthroughStepExpanded">
                        <img
                          alt={step.screenshot.label}
                          className="walkthroughStepExpandedImg"
                          src={`${runnerBaseUrl}${step.screenshot.url}`}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Errors ──────────────────────────────── */}
        {run.status === "failed" && notes.length > 0 ? (
          <div className="walkthroughSection walkthroughError">
            <h3>⚠️ Error Details</h3>
            {notes.map((note, i) => (
              <p key={i} className="walkthroughNote">{note}</p>
            ))}
          </div>
        ) : null}

        {/* ── Footer ──────────────────────────────── */}
        <div className="walkthroughFooter">
          <span className="walkthroughTime">
            Started {formatClock(run.startedAt)}
            {run.completedAt ? ` · Finished ${formatClock(run.completedAt)}` : ""}
          </span>
        </div>
      </section>
    </div>
  );
}
