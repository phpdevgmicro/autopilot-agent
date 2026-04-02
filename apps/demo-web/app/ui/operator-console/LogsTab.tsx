"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RunEvent } from "@cua-sample/replay-schema";
import { maskCredentials } from "./credential-mask";

type LogsTabProps = {
  runEvents: RunEvent[];
  streamLogs: boolean;
  onStreamLogsChange: (value: boolean) => void;
};

type LogCategory = "system" | "think" | "action" | "api" | "snap" | "result" | "error";

/** Map event types to styled badge config */
function getLogBadge(ev: RunEvent): { label: string; category: LogCategory } {
  const type = ev.type;
  const msg = ev.message || "";

  // Reasoning / thinking
  if (msg.includes("🧠") || msg.includes("Model reasoning")) {
    return { label: "THINK", category: "think" };
  }

  // Model text response
  if (msg.includes("💬") || msg.includes("Model response text")) {
    return { label: "MODEL", category: "think" };
  }

  // Tool calls
  if (msg.includes("🔧") || msg.includes("Tool call") || type === "function_call_requested") {
    return { label: "EXEC", category: "action" };
  }

  // Browser plan / actions
  if (msg.includes("🖱️") || msg.includes("Browser plan") || type === "computer_call_requested") {
    return { label: "ACTION", category: "action" };
  }

  // Per-action execution
  if (msg.startsWith("Executing:")) {
    return { label: "⤷ DO", category: "action" };
  }

  // Sending to model
  if (msg.includes("Sending request to model")) {
    return { label: "API →", category: "api" };
  }

  // API turn completed
  if (msg.includes("Responses API turn")) {
    return { label: "API ←", category: "result" };
  }

  // Screenshots
  if (type === "screenshot_captured" || type === "computer_call_output_recorded") {
    return { label: "SNAP", category: "snap" };
  }

  // Browser actions executed
  if (type === "computer_actions_executed") {
    return { label: "DONE", category: "result" };
  }

  // Function call completed
  if (type === "function_call_completed") {
    return { label: "RESULT", category: "result" };
  }

  // System lifecycle
  if (type === "run_started") return { label: "START", category: "system" };
  if (type === "workspace_prepared") return { label: "WORKSPACE", category: "system" };
  if (type === "lab_started" || type === "browser_session_started") return { label: "INIT", category: "system" };
  if (type === "browser_navigated") return { label: "NAV", category: "snap" };
  if (type === "run_completed") return { label: "✓ DONE", category: "result" };
  if (type === "run_failed") return { label: "✗ FAIL", category: "error" };
  if (type === "run_cancelled") return { label: "⊘ ABORT", category: "error" };
  if (type === "ai_walkthrough_generated") return { label: "SUMMARY", category: "think" };
  if (type === "verification_completed") return { label: "VERIFY", category: "result" };

  // Progress events
  if (type === "run_progress") {
    if (ev.level === "warn") return { label: "WARN", category: "error" };
    if (ev.level === "error") return { label: "ERROR", category: "error" };
    return { label: "INFO", category: "system" };
  }

  return { label: ev.type.toUpperCase().replace(/_/g, " ").slice(0, 10), category: "system" };
}

function formatTime(isoStr: string) {
  const d = new Date(isoStr);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Clean message: strip emojis from the beginning */
function cleanMessage(msg: string): string {
  return msg.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, "").trim();
}

function formatDetail(detail: string): string {
  const clean = detail.replace(/\r?\n/g, "\n");
  if (clean.length > 600) {
    return clean.slice(0, 597) + "…";
  }
  return clean;
}

/** Check if a detail contains code-like content */
function isCodeBlock(detail: string): boolean {
  return (
    detail.includes("await ") ||
    detail.includes("page.") ||
    detail.includes("console.log") ||
    detail.includes("document.") ||
    detail.includes("const ") ||
    detail.includes("async ") ||
    (detail.includes("{") && detail.includes("}"))
  );
}

export function LogsTab({ runEvents, streamLogs, onStreamLogsChange }: LogsTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<"all" | "actions" | "thinking" | "errors">("all");
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<number>>(new Set());

  const toggleBlock = useCallback((idx: number) => {
    setCollapsedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    if (streamLogs && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamLogs]);

  useEffect(() => {
    scrollToBottom();
  }, [runEvents, scrollToBottom]);

  // Filter events
  const filteredEvents = runEvents.filter((ev) => {
    if (filter === "all") return true;
    if (filter === "errors") return ev.level === "error" || ev.level === "warn";
    if (filter === "thinking") {
      const msg = ev.message || "";
      return msg.includes("🧠") || msg.includes("💬") || msg.includes("Model reasoning") || msg.includes("Model response");
    }
    if (filter === "actions") {
      return (
        ev.type === "computer_call_requested" ||
        ev.type === "computer_actions_executed" ||
        ev.type === "function_call_requested" ||
        ev.type === "function_call_completed" ||
        (ev.message || "").includes("Tool call") ||
        (ev.message || "").includes("Browser plan") ||
        (ev.message || "").includes("Executing:")
      );
    }
    return true;
  });

  return (
    <div className="termContainer">
      {/* Terminal chrome */}
      <div className="termChrome">
        <div className="termDots">
          <span className="termDot termDotRed" />
          <span className="termDot termDotYellow" />
          <span className="termDot termDotGreen" />
        </div>
        <span className="termTitle">agent-john-wicks — execution log</span>
        <div className="termControls">
          <div className="termFilters">
            {(["all", "thinking", "actions", "errors"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`termFilterBtn ${filter === f ? "termFilterActive" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "thinking" ? "🧠 Think" : f === "actions" ? "⚡ Actions" : "⚠️ Errors"}
              </button>
            ))}
          </div>
          <label className="termTailToggle">
            <input
              type="checkbox"
              checked={streamLogs}
              onChange={(e) => onStreamLogsChange(e.target.checked)}
            />
            <span className={`termTailDot ${streamLogs ? "termTailDotLive" : ""}`} />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Terminal body */}
      <div ref={scrollRef} className="termBody">
        {filteredEvents.length === 0 ? (
          <div className="termEmpty">
            <div className="termEmptyScope">
              <svg viewBox="0 0 60 60" fill="none" width="40" height="40">
                <circle cx="30" cy="30" r="22" stroke="rgba(96,165,250,0.2)" strokeWidth="1" />
                <line x1="30" y1="4" x2="30" y2="18" stroke="rgba(96,165,250,0.3)" strokeWidth="1" />
                <line x1="30" y1="42" x2="30" y2="56" stroke="rgba(96,165,250,0.3)" strokeWidth="1" />
                <line x1="4" y1="30" x2="18" y2="30" stroke="rgba(96,165,250,0.3)" strokeWidth="1" />
                <line x1="42" y1="30" x2="56" y2="30" stroke="rgba(96,165,250,0.3)" strokeWidth="1" />
                <circle cx="30" cy="30" r="3" fill="rgba(96,165,250,0.5)" />
              </svg>
            </div>
            <span className="termPrompt">$</span>
            <span className="termCursor">_</span>
            <div className="termEmptyText">Waiting for agent execution...</div>
          </div>
        ) : (
          filteredEvents.map((ev, i) => {
            const { label, category } = getLogBadge(ev);
            const detail = ev.detail ? maskCredentials(formatDetail(ev.detail)) : null;
            const msg = maskCredentials(cleanMessage(ev.message || ev.type));
            const hasCode = detail ? isCodeBlock(detail) : false;
            const isMultiline = detail ? detail.includes("\n") : false;
            const showBlock = detail && (isMultiline || hasCode);
            const isCollapsed = collapsedBlocks.has(i);

            return (
              <div key={`${ev.id}-${i}`} className={`termEntry termEntry--${category}`}>
                <div className="termEntryHeader">
                  <span className="termLineNum">{String(i + 1).padStart(3, " ")}</span>
                  <span className="termTimestamp">{formatTime(ev.createdAt)}</span>
                  <span className={`termBadge termBadge--${category}`}>{label}</span>
                  <span className="termMsg">{msg}</span>
                </div>
                {detail && !showBlock && (
                  <div className="termDetailRow">
                    <span className="termDetailDash">—</span>
                    <span className="termDetailText">{detail}</span>
                  </div>
                )}
                {showBlock && (
                  <div className="termBlockWrap">
                    <button
                      type="button"
                      className="termBlockToggle"
                      onClick={() => toggleBlock(i)}
                    >
                      <span className={`termBlockChevron ${isCollapsed ? "" : "termBlockChevronOpen"}`}>▶</span>
                      {hasCode ? "code" : "output"}
                    </button>
                    {!isCollapsed && (
                      <pre className={`termBlock ${hasCode ? "termBlockCode" : ""}`}>
                        {detail}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Live cursor at bottom */}
        {streamLogs && filteredEvents.length > 0 && (
          <div className="termEntry termLineCursor">
            <div className="termEntryHeader">
              <span className="termLineNum">{String(filteredEvents.length + 1).padStart(3, " ")}</span>
              <span className="termTimestamp">{formatTime(new Date().toISOString())}</span>
              <span className="termPrompt">$</span>
              <span className="termCursor">_</span>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="termStatusBar">
        <span>{filteredEvents.length} events</span>
        <span>{filter !== "all" ? `filter: ${filter}` : "showing all"}</span>
        <span className={streamLogs ? "termStatusLive" : ""}>{streamLogs ? "● LIVE" : "○ PAUSED"}</span>
      </div>
    </div>
  );
}
