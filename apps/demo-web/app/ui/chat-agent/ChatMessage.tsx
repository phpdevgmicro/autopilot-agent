"use client";

import { useState } from "react";
import type { ChatMessage as ChatMessageType } from "./types";

interface ChatMessageProps {
  message: ChatMessageType;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Detect if the message contains structured action steps.
 * Action messages typically include step-by-step descriptions of what the agent did.
 */
function parseActionSteps(content: string): { summary: string; steps: string[]; footer: string | null } | null {
  // Detect completion messages with structured action summaries
  const hasNextPrompt = content.includes("What would you like me to do next?");
  if (!hasNextPrompt) return null;

  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  const steps: string[] = [];
  const summaryLines: string[] = [];
  let footer: string | null = null;
  let inSteps = false;

  for (const line of lines) {
    // Detect numbered steps (1. 2. 3.) or bullet steps (- •)
    if (/^(\d+[\.\)]\s|[-•]\s)/.test(line)) {
      inSteps = true;
      steps.push(line.replace(/^(\d+[\.\)]\s|[-•]\s)/, "").trim());
    } else if (line.startsWith("⏱️") || line.startsWith("✅") || line.startsWith("📊")) {
      footer = line;
    } else if (line === "What would you like me to do next?") {
      // Skip, will be shown as a prompt
    } else if (!inSteps) {
      summaryLines.push(line);
    } else {
      // After steps started, treat rest as summary continuation
      summaryLines.push(line);
    }
  }

  if (steps.length === 0) {
    // No structured steps found, try splitting by sentences that describe actions
    const actionVerbs = /^(I |I've |I'll |Successfully |Navigated|Opened|Clicked|Filled|Searched|Found|Completed|Created|Updated|Typed|Scrolled|Submitted|Logged|Downloaded|Uploaded)/i;
    const allLines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    const actionLines: string[] = [];
    const otherLines: string[] = [];

    for (const line of allLines) {
      if (line === "What would you like me to do next?") continue;
      if (line.startsWith("⏱️")) {
        footer = line;
        continue;
      }
      if (actionVerbs.test(line)) {
        actionLines.push(line);
      } else {
        otherLines.push(line);
      }
    }

    if (actionLines.length >= 2) {
      return {
        summary: otherLines.join(" ").trim() || actionLines[0] || "Task completed",
        steps: actionLines,
        footer,
      };
    }

    return null;
  }

  return {
    summary: summaryLines.join(" ").trim() || "Task completed",
    steps,
    footer,
  };
}

/**
 * Check if this is a simple conversational message (short, no action steps)
 */
function isSimpleMessage(content: string): boolean {
  const lineCount = content.split("\n").filter((l) => l.trim()).length;
  return lineCount <= 3 && content.length < 300 && !content.includes("What would you like me to do next?");
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isThinking = message.role === "thinking";
  const isSystem = message.role === "system";
  const [stepsExpanded, setStepsExpanded] = useState(false);

  const actionData = !isUser && !isThinking && !isSystem ? parseActionSteps(message.content) : null;
  const isSimple = isSimpleMessage(message.content);

  return (
    <div
      className={`chatMsg ${isUser ? "chatMsgUser" : ""} ${isThinking ? "chatMsgThinking" : ""} ${isSystem ? "chatMsgSystem" : ""}`}
      id={`msg-${message.id}`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="chatMsgAvatar">
          {isThinking ? (
            <div className="chatMsgAvatarThinkingDots">
              <span /><span /><span />
            </div>
          ) : isSystem ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
            </svg>
          )}
        </div>
      )}

      {/* Message content */}
      <div className={`chatMsgBody ${isUser ? "chatMsgBodyUser" : "chatMsgBodyAgent"}`}>
        {isThinking ? (
          <div className="chatMsgThinkingContent">
            <span className="chatMsgThinkingText">{message.content}</span>
            <span className="chatMsgThinkingDots">
              <span /><span /><span />
            </span>
          </div>
        ) : actionData ? (
          /* Action Summary Card */
          <div className="chatActionCard">
            <div className="chatActionCardHeader">
              <div className="chatActionCardIcon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </div>
              <span className="chatActionCardTitle">{actionData.summary}</span>
            </div>

            {/* Collapsible Steps */}
            {actionData.steps.length > 0 && (
              <>
                <button
                  className="chatActionToggle"
                  onClick={() => setStepsExpanded((v) => !v)}
                  type="button"
                >
                  <svg
                    width="12" height="12" viewBox="0 0 12 12" fill="none"
                    className={`chatActionChevron ${stepsExpanded ? "chatActionChevronOpen" : ""}`}
                  >
                    <path d="M4 3L7 6L4 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{actionData.steps.length} action{actionData.steps.length > 1 ? "s" : ""} performed</span>
                </button>

                {stepsExpanded && (
                  <div className="chatActionSteps">
                    {actionData.steps.map((step, i) => (
                      <div key={i} className="chatActionStep">
                        <span className="chatActionStepDot" />
                        <span className="chatActionStepText">{step}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Footer with timing */}
            {actionData.footer && (
              <div className="chatActionFooter">
                <span>{actionData.footer}</span>
              </div>
            )}

            <div className="chatActionPrompt">
              What would you like me to do next?
            </div>
          </div>
        ) : (
          <div className="chatMsgText">{message.content}</div>
        )}

        {/* Timestamp */}
        {!isThinking && (
          <div className="chatMsgTime">{formatTime(message.timestamp)}</div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="chatMsgAvatar chatMsgAvatarUser">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}
    </div>
  );
}
