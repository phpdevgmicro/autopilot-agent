"use client";

import { useState } from "react";
import type { RunDetail, RunEvent, BrowserScreenshotArtifact } from "@cua-sample/replay-schema";
import { appName, formatClock } from "./helpers";

type WalkthroughSummaryProps = {
  runEvents: RunEvent[];
  runnerBaseUrl: string;
  screenshots: BrowserScreenshotArtifact[];
  selectedRun: RunDetail | null;
};

/* ── Helpers ── */

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function getStatusConfig(status: string, outcome?: string) {
  switch (status) {
    case "completed":
      return outcome === "failure"
        ? { icon: "⚠️", label: "Partial", cls: "summaryBadgeWarn", color: "#f59e0b" }
        : { icon: "✅", label: "Completed", cls: "summaryBadgeSuccess", color: "#22c55e" };
    case "failed":
      return { icon: "❌", label: "Failed", cls: "summaryBadgeError", color: "#ef4444" };
    case "cancelled":
      return { icon: "⏹️", label: "Cancelled", cls: "summaryBadgeWarn", color: "#f59e0b" };
    default:
      return { icon: "⏳", label: "Unknown", cls: "summaryBadgeWarn", color: "#f59e0b" };
  }
}

/** Extract key metrics from events */
function extractMetrics(events: RunEvent[]) {
  let navigations = 0;
  let clicks = 0;
  let typedInputs = 0;
  let totalTurns = 0;
  const visitedUrls = new Set<string>();

  for (const ev of events) {
    if (ev.type === "browser_navigated" && ev.detail) {
      navigations++;
      try { visitedUrls.add(new URL(ev.detail).hostname); } catch { /* skip */ }
    }
    if (ev.type === "computer_actions_executed" && ev.detail) {
      const sep = ev.detail.indexOf(" :: ");
      const payload = sep >= 0 ? ev.detail.slice(sep + 4) : ev.detail;
      try {
        const actions = JSON.parse(payload) as Array<Record<string, unknown>>;
        for (const a of actions) {
          if (a.type === "click" || a.type === "double_click") clicks++;
          if (a.type === "type") typedInputs++;
        }
      } catch { /* skip */ }
    }
    if (ev.message?.includes("Responses API turn")) {
      const m = ev.message.match(/turn (\d+)/);
      if (m) totalTurns = Math.max(totalTurns, Number(m[1]));
    }
  }

  // Get token info from the token summary event
  let tokenInfo = "";
  for (const ev of events) {
    if (ev.message === "Token usage summary for this run." && ev.detail) {
      tokenInfo = ev.detail;
    }
  }

  return { navigations, clicks, typedInputs, totalTurns, visitedUrls, tokenInfo };
}

/* ── Component ── */

export function WalkthroughSummary({ runEvents, runnerBaseUrl, screenshots, selectedRun }: WalkthroughSummaryProps) {
  const [expandedScreenshot, setExpandedScreenshot] = useState<number | null>(null);

  if (!selectedRun) return null;

  const { run } = selectedRun;
  const isFinished = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
  if (!isFinished) return null;

  const statusConfig = getStatusConfig(run.status, run.summary?.outcome);
  const duration = run.durationMs ? formatDuration(run.durationMs) : null;
  const metrics = extractMetrics(runEvents);

  // Extract AI walkthrough and agent conclusion
  let agentConclusion = "";
  let aiSummary = "";
  for (const ev of runEvents) {
    if (ev.type === "run_progress" && ev.message === "Model returned a final response." && ev.detail) {
      agentConclusion = ev.detail;
    }
    if (ev.type === "ai_walkthrough_generated" && ev.detail) {
      aiSummary = ev.detail;
    }
  }

  const isGeneratingAi = isFinished && !aiSummary && run.status === "completed" && run.durationMs !== undefined;
  const notes = run.summary?.notes ?? [];

  /** Render markdown-like AI content */
  function renderAiContent(text: string) {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("## ")) {
        return <h4 key={i} className="summaryAiHeading">{line.slice(3)}</h4>;
      }
      if (/^\d+\.\s/.test(line)) {
        return <p key={i} className="summaryAiStep">{line}</p>;
      }
      if (line.startsWith("- ")) {
        return <p key={i} className="summaryAiBullet">{line}</p>;
      }
      if (line.trim() === "") return null;
      return <p key={i} className="summaryAiText">{line}</p>;
    });
  }

  return (
    <div className="summaryScroll">
      <div className="summaryContainer">

        {/* ── Status Card ── */}
        <div className="summaryStatusCard" style={{ borderColor: statusConfig.color }}>
          <div className="summaryStatusTop">
            <span className={`summaryStatusBadge ${statusConfig.cls}`}>
              {statusConfig.icon} {statusConfig.label}
            </span>
            {duration ? <span className="summaryDuration">{duration}</span> : null}
          </div>
          <div className="summaryPrompt">
            <span className="summaryPromptLabel">Task</span>
            <p className="summaryPromptText">{run.prompt}</p>
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div className="summaryStatsRow">
          <div className="summaryStat">
            <span className="summaryStatValue">{metrics.totalTurns || "–"}</span>
            <span className="summaryStatLabel">Turns</span>
          </div>
          <div className="summaryStat">
            <span className="summaryStatValue">{screenshots.length}</span>
            <span className="summaryStatLabel">Screenshots</span>
          </div>
          <div className="summaryStat">
            <span className="summaryStatValue">{metrics.navigations}</span>
            <span className="summaryStatLabel">Navigations</span>
          </div>
          <div className="summaryStat">
            <span className="summaryStatValue">{metrics.clicks}</span>
            <span className="summaryStatLabel">Clicks</span>
          </div>
          <div className="summaryStat">
            <span className="summaryStatValue">{metrics.typedInputs}</span>
            <span className="summaryStatLabel">Typed</span>
          </div>
          <div className="summaryStat">
            <span className="summaryStatValue">{metrics.visitedUrls.size}</span>
            <span className="summaryStatLabel">Sites</span>
          </div>
        </div>

        {/* ── AI Summary (Primary Content) ── */}
        {aiSummary ? (
          <div className="summaryAiCard">
            <div className="summaryAiHeader">
              <span className="summaryAiIcon">🤖</span>
              <span className="summaryAiTitle">{appName}</span>
            </div>
            <div className="summaryAiBody">
              {renderAiContent(aiSummary)}
            </div>
          </div>
        ) : isGeneratingAi ? (
          <div className="summaryAiCard summaryAiCardLoading">
            <div className="summaryAiHeader">
              <span className="summaryAiIcon">🤖</span>
              <span className="summaryAiTitle">{appName}</span>
            </div>
            <div className="summaryAiBody">
              <p className="summaryAiPulse">Analyzing agent activity and generating summary...</p>
            </div>
          </div>
        ) : null}

        {/* ── Agent's Own Conclusion ── */}
        {agentConclusion ? (
          <div className="summarySectionCard">
            <h3 className="summarySectionTitle">💡 Agent Conclusion</h3>
            <p className="summarySectionText">{agentConclusion}</p>
          </div>
        ) : null}

        {/* ── Screenshots Gallery ── */}
        {screenshots.length > 0 ? (
          <div className="summarySectionCard">
            <h3 className="summarySectionTitle">📸 Captured Frames ({screenshots.length})</h3>
            <div className="summaryGallery">
              {screenshots.map((ss, i) => (
                <button
                  key={ss.id}
                  className={`summaryGalleryThumb ${expandedScreenshot === i ? "summaryGalleryThumbActive" : ""}`}
                  onClick={() => setExpandedScreenshot(expandedScreenshot === i ? null : i)}
                  type="button"
                  title={ss.pageTitle || `Frame ${i + 1}`}
                >
                  <img
                    alt={ss.label}
                    className="summaryGalleryImg"
                    src={`${runnerBaseUrl}${ss.url}`}
                    loading="lazy"
                  />
                  <span className="summaryGalleryIndex">{i + 1}</span>
                </button>
              ))}
            </div>
            {expandedScreenshot !== null && screenshots[expandedScreenshot] ? (
              <div className="summaryGalleryExpanded">
                <div className="summaryGalleryExpandedMeta">
                  <span>Frame {expandedScreenshot + 1}</span>
                  {screenshots[expandedScreenshot]!.pageTitle ? (
                    <span className="summaryGalleryExpandedTitle">
                      {screenshots[expandedScreenshot]!.pageTitle}
                    </span>
                  ) : null}
                </div>
                <img
                  alt={screenshots[expandedScreenshot]!.label}
                  className="summaryGalleryExpandedImg"
                  src={`${runnerBaseUrl}${screenshots[expandedScreenshot]!.url}`}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Errors ── */}
        {run.status === "failed" && notes.length > 0 ? (
          <div className="summarySectionCard summaryErrorCard">
            <h3 className="summarySectionTitle">⚠️ Error Details</h3>
            {notes.map((note, i) => (
              <p key={i} className="summaryErrorText">{note}</p>
            ))}
          </div>
        ) : null}

        {/* ── Footer ── */}
        <div className="summaryFooter">
          <span>Started {formatClock(run.startedAt)}</span>
          {run.completedAt ? <span>Finished {formatClock(run.completedAt)}</span> : null}
          {metrics.tokenInfo ? <span>{metrics.tokenInfo}</span> : null}
          <span>Model: {run.model}</span>
        </div>
      </div>
    </div>
  );
}
