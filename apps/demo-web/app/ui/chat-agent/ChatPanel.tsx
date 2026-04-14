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
    <div className="chatPanel" id="chat-panel">
      {/* Header */}
      <div className="chatPanelHeader">
        <div className="chatPanelHeaderLeft">
          <div className="chatPanelAgentAvatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
          </div>
          <div className="chatPanelTitle">
            <h2>Agent</h2>
            <div className="chatPanelStatus">
              <span
                className={`chatStatusDot ${isConnected ? "chatStatusDotOnline" : connectionStatus === "connecting" ? "chatStatusDotConnecting" : "chatStatusDotOffline"}`}
              />
              <span className="chatStatusText">
                {connectionStatus === "connecting"
                  ? "Connecting…"
                  : isConnected
                    ? "Online"
                    : "Reconnecting…"}
              </span>
            </div>
          </div>
        </div>
        {isAgentBusy && (
          <div className="chatPanelBusyIndicator">
            <span className="chatBusyDot" />
            <span>Working…</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="chatMessages" ref={scrollRef} id="chat-messages">
        {messages.length === 0 && (
          <div className="chatWelcome">
            {/* Welcome Hero */}
            <div className="chatWelcomeHero">
              <div className="chatWelcomeIconWrap">
                <div className="chatWelcomeGlow" />
                <svg className="chatWelcomeIcon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" />
                  <path d="M20 14h2" />
                  <path d="M15 13v2" />
                  <path d="M9 13v2" />
                </svg>
              </div>
              <h3 className="chatWelcomeTitle">
                {isConnected ? "Ready to help!" : "Connecting to agent…"}
              </h3>
              <p className="chatWelcomeSubtitle">
                Tell me what to do — I&apos;ll navigate websites, fill forms, click buttons, and complete tasks in the browser.
              </p>
            </div>

            {/* Quick Actions */}
            {isConnected && (
              <div className="chatQuickActions">
                <span className="chatQuickLabel">Quick start</span>
                <div className="chatQuickGrid">
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

            {/* Capabilities */}
            <div className="chatCapabilities">
              <div className="chatCapability">
                <span className="chatCapIcon">🌐</span>
                <span>Navigate any website</span>
              </div>
              <div className="chatCapability">
                <span className="chatCapIcon">🔐</span>
                <span>Uses your synced Google profile</span>
              </div>
              <div className="chatCapability">
                <span className="chatCapIcon">⚡</span>
                <span>Executes tasks autonomously</span>
              </div>
            </div>

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
        isAgentRunning={isAgentBusy}
      />
    </div>
  );
}
