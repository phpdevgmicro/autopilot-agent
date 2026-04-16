"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage as ChatMessageType, ApprovalRequest, ConnectionStatus } from "./types";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";

interface ChatPanelProps {
  messages: ChatMessageType[];
  pendingApproval: ApprovalRequest | null;
  connectionStatus: ConnectionStatus;
  isAgentBusy: boolean;
  onSendMessage: (content: string) => void;
  onApprovalResponse: (requestId: string, action: "approve" | "reject") => void;
  onStop: () => void;
  isFullWidth?: boolean;
}

const QUICK_ACTIONS = [
  { label: "Open Google Drive", icon: "📁", prompt: "Open Google Drive and list my recent files" },
  { label: "Search the web", icon: "🔍", prompt: "Search Google for the latest tech news" },
  { label: "Open Gmail", icon: "📧", prompt: "Open Gmail and check my latest emails" },
  { label: "Take a screenshot", icon: "📸", prompt: "Navigate to google.com and take a screenshot" },
];

export function ChatPanel({
  messages,
  pendingApproval,
  connectionStatus,
  isAgentBusy,
  onSendMessage,
  onApprovalResponse,
  onStop,
  isFullWidth = false,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isConnected = connectionStatus === "connected";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className={`chatPanel ${isFullWidth ? "chatPanelFullWidth" : ""}`} id="chat-panel">
      {/* Messages */}
      <div className="chatMessages" ref={scrollRef} id="chat-messages">
        {messages.length === 0 && (
          <div className="chatWelcome">
            {/* Welcome Hero */}
            <div className="chatWelcomeHero">
              <div className="chatWelcomeIconWrap">
                <div className="chatWelcomeGlow" />
                <svg className="chatWelcomeIcon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" />
                  <path d="M20 14h2" />
                  <path d="M15 13v2" />
                  <path d="M9 13v2" />
                </svg>
              </div>
              <h3 className="chatWelcomeTitle">
                {isConnected ? "What can I help you with?" : "Connecting to agent…"}
              </h3>
              <p className="chatWelcomeSubtitle">
                I can navigate websites, fill forms, click buttons, and complete tasks in a real browser — just tell me what to do.
              </p>
            </div>

            {/* Quick Actions */}
            {isConnected && (
              <div className="chatQuickActions">
                <span className="chatQuickLabel">Try one of these</span>
                <div className={`chatQuickGrid ${isFullWidth ? "chatQuickGridWide" : ""}`}>
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      className="chatQuickBtn"
                      onClick={() => onSendMessage(action.prompt)}
                      type="button"
                    >
                      <span className="chatQuickBtnIcon">{action.icon}</span>
                      <span className="chatQuickBtnLabel">{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Connection Warning */}
            {!isConnected && (
              <div className="chatConnectionWarning">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 5v3M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>Waiting for runner at localhost:4001…</span>
              </div>
            )}
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
            <div className="chatApprovalIcon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="chatApprovalBody">
              <div className="chatApprovalMessage">{pendingApproval.message}</div>
              <div className="chatApprovalActions">
                <button
                  className="chatApprovalBtn chatApprovalApprove"
                  onClick={() => onApprovalResponse(pendingApproval.requestId, "approve")}
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Approve
                </button>
                <button
                  className="chatApprovalBtn chatApprovalReject"
                  onClick={() => onApprovalResponse(pendingApproval.requestId, "reject")}
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={onSendMessage}
        onStop={onStop}
        disabled={!isConnected}
        isAgentRunning={isAgentBusy}
      />
    </div>
  );
}
