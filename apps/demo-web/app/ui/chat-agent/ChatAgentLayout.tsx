"use client";

import { useState, useEffect } from "react";
import { useWebSocket } from "./useWebSocket";
import { ChatPanel } from "./ChatPanel";
import { BrowserViewport } from "./BrowserViewport";
import { ConnectProfileButton } from "./ConnectProfileButton";

const RUNNER_BASE_URL =
  process.env.NEXT_PUBLIC_RUNNER_BASE_URL ?? "http://127.0.0.1:4001";

const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? "Agent John Wicks";

export function ChatAgentLayout() {
  const {
    status,
    messages,
    browserState,
    pendingApproval,
    isAgentBusy,
    sendMessage,
    sendRaw,
    respondToApproval,
    toggleTakeover,
    stopTask,
  } = useWebSocket();

  const [selectedProfile, setSelectedProfile] = useState<string>("");

  useEffect(() => {
    const saved = localStorage.getItem("cua_selected_profile");
    if (saved) setSelectedProfile(saved);
  }, []);

  const handleProfileChange = (p: string) => {
    setSelectedProfile(p);
    localStorage.setItem("cua_selected_profile", p);
  };

  // Show browser panel when there's an active screenshot
  const hasBrowserContent = browserState.screenshot !== null;
  const isConnected = status === "connected";

  return (
    <div className="chatAgentShell">
      {/* Top bar */}
      <header className="chatAgentTopbar">
        <div className="chatAgentBrand">
          <div className="brandMark" style={{ display: "flex", alignItems: "center" }}>
            <img
              src="https://www.ibridgedigital.com/assets/img/iblogo.png"
              alt="IB Logo"
              style={{ height: "24px", objectFit: "contain" }}
            />
          </div>
          <div className="chatAgentBrandText">
            <h1>{APP_NAME}</h1>
          </div>
        </div>

        <div className="chatAgentTopbarRight">
          {/* Connection status pill */}
          <div className={`chatAgentStatusPill ${isConnected ? "chatAgentStatusOnline" : ""}`}>
            <span className={`chatAgentStatusDot ${isConnected ? "chatAgentStatusDotOn" : status === "connecting" ? "chatAgentStatusDotConnecting" : "chatAgentStatusDotOff"}`} />
            <span>
              {status === "connecting" ? "Connecting" : isConnected ? "Online" : "Reconnecting"}
            </span>
          </div>

          {/* Busy indicator */}
          {isAgentBusy && (
            <div className="chatAgentBusyPill">
              <span className="chatAgentBusyDot" />
              <span>Working…</span>
            </div>
          )}

          <ConnectProfileButton
            runnerBaseUrl={RUNNER_BASE_URL}
            selectedProfile={selectedProfile}
            onProfileChange={handleProfileChange}
            isAgentBusy={isAgentBusy}
            sendWsMessage={sendRaw}
          />
        </div>
      </header>

      {/* Main content area */}
      <main className="chatAgentMain">
        <div className={`chatAgentSplitPane ${hasBrowserContent ? "chatAgentSplitPaneActive" : "chatAgentSplitPaneChatOnly"}`}>
          {/* Chat */}
          <ChatPanel
            messages={messages}
            pendingApproval={pendingApproval}
            connectionStatus={status}
            isAgentBusy={isAgentBusy}
            onSendMessage={sendMessage}
            onApprovalResponse={respondToApproval}
            onStop={() => stopTask()}
            isFullWidth={!hasBrowserContent}
          />

          {/* Browser - only show when there's content */}
          {hasBrowserContent && (
            <BrowserViewport
              browserState={browserState}
              isTakeoverActive={browserState.isTakeoverActive}
              onToggleTakeover={toggleTakeover}
            />
          )}
        </div>
      </main>
    </div>
  );
}
