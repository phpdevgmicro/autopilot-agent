"use client";

import type { ChatMessage as ChatMessageType } from "./types";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isThinking = message.role === "thinking";
  const isSystem = message.role === "system";

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
        ) : (
          <div className="chatMessageContent">{message.content}</div>
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
