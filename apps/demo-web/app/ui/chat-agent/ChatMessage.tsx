"use client";

import type { ChatMessage as ChatMessageType } from "./types";

interface ChatMessageProps {
  message: ChatMessageType;
}

/**
 * Format a timestamp to a human-readable time string.
 */
function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Check if this is a completion message (contains "What would you like me to do next?")
 */
function isCompletionMessage(content: string): boolean {
  return content.includes("What would you like me to do next?");
}

/**
 * Parse completion message into parts: body + footer
 */
function parseCompletionMessage(content: string): { body: string; footer: string } | null {
  const marker = "⏱️";
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return null;

  return {
    body: content.slice(0, idx).trim(),
    footer: content.slice(idx).trim(),
  };
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isThinking = message.role === "thinking";
  const isSystem = message.role === "system";
  const isCompletion = !isUser && !isThinking && !isSystem && isCompletionMessage(message.content);
  const completionParts = isCompletion ? parseCompletionMessage(message.content) : null;

  return (
    <div
      className={`chatMessage ${isUser ? "chatMessageUser" : ""} ${isThinking ? "chatMessageThinking" : ""} ${isSystem ? "chatMessageSystem" : ""}`}
      id={`msg-${message.id}`}
    >
      {!isUser && (
        <div className="chatMessageAvatar">
          {isThinking ? (
            <div className="chatAvatarThinking">
              <span className="chatAvatarDot" />
              <span className="chatAvatarDot" />
              <span className="chatAvatarDot" />
            </div>
          ) : isSystem ? (
            <span className="chatAvatarIcon">⚙️</span>
          ) : (
            <span className="chatAvatarIcon">🤖</span>
          )}
        </div>
      )}

      <div className={`chatBubble ${isUser ? "chatBubbleUser" : "chatBubbleAgent"}`}>
        {isThinking ? (
          <div className="chatThinkingContent">
            <span className="chatThinkingText">{message.content}</span>
            <span className="chatThinkingDots">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : completionParts ? (
          // Completion message with structured layout
          <div className="chatMessageContent">
            <div className="chatCompletionBody">{completionParts.body}</div>
            <div className="chatCompletionFooter">
              <span className="chatCompletionMeta">{completionParts.footer}</span>
            </div>
          </div>
        ) : (
          <div className="chatMessageContent">{message.content}</div>
        )}

        {/* Timestamp */}
        {!isThinking && (
          <div className="chatMessageTime">{formatTime(message.timestamp)}</div>
        )}
      </div>

      {isUser && (
        <div className="chatMessageAvatar chatMessageAvatarUser">
          <span className="chatAvatarIcon">👤</span>
        </div>
      )}
    </div>
  );
}
