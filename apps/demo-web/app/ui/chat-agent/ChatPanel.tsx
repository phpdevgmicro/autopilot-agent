"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage as ChatMessageType, ApprovalRequest, ConnectionStatus } from "./types";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";

interface ChatPanelProps {
  messages: ChatMessageType[];
  pendingApproval: ApprovalRequest | null;
  connectionStatus: ConnectionStatus;
  onSendMessage: (content: string) => void;
  onApprovalResponse: (requestId: string, action: "approve" | "reject") => void;
  onStop: () => void;
}

export function ChatPanel({
  messages,
  pendingApproval,
  connectionStatus,
  onSendMessage,
  onApprovalResponse,
  onStop,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isConnected = connectionStatus === "connected";
  const hasThinkingMessage = messages.some((m) => m.role === "thinking");

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="chatPanel" id="chat-panel">
      {/* Header */}
      <div className="chatPanelHeader">
        <div className="chatPanelHeaderLeft">
          <span className="chatPanelLogo">🤖</span>
          <div className="chatPanelTitle">
            <h2>Agent</h2>
            <div className="chatPanelStatus">
              <span
                className={`chatStatusDot ${isConnected ? "chatStatusDotOnline" : "chatStatusDotOffline"}`}
              />
              <span className="chatStatusText">
                {connectionStatus === "connecting"
                  ? "Connecting…"
                  : isConnected
                    ? "Online"
                    : "Offline"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="chatMessages" ref={scrollRef} id="chat-messages">
        {messages.length === 0 && isConnected && (
          <div className="chatEmptyState">
            <div className="chatEmptyIcon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
                <path d="M16 20C16 17.7909 17.7909 16 20 16H28C30.2091 16 32 17.7909 32 20V26C32 28.2091 30.2091 30 28 30H23L18 34V30H20C17.7909 30 16 28.2091 16 26V20Z" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
              </svg>
            </div>
            <p className="chatEmptyTitle">What can I help you with?</p>
            <p className="chatEmptyDesc">
              Tell me what to do in the browser — I&apos;ll navigate, click, type, and complete tasks for you.
            </p>
          </div>
        )}

        {messages
          .filter((m) => !(m.role === "thinking" && messages.some((next) => next.role === "agent" && next.timestamp > m.timestamp)))
          .map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

        {/* Approval gate */}
        {pendingApproval && (
          <div className="chatApprovalGate" id="approval-gate">
            <div className="chatApprovalMessage">{pendingApproval.message}</div>
            <div className="chatApprovalActions">
              <button
                className="chatApprovalBtn chatApprovalApprove"
                onClick={() => onApprovalResponse(pendingApproval.requestId, "approve")}
                type="button"
              >
                ✓ Approve
              </button>
              <button
                className="chatApprovalBtn chatApprovalReject"
                onClick={() => onApprovalResponse(pendingApproval.requestId, "reject")}
                type="button"
              >
                ✕ Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={onSendMessage}
        onStop={onStop}
        disabled={!isConnected}
        isAgentRunning={hasThinkingMessage}
      />
    </div>
  );
}
