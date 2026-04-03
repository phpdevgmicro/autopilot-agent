"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ActionButtonsProps } from "./types";
import { IconPlay, IconStop, IconRefresh, IconLoader, IconTarget } from "./Icons";
import { IconPlay, IconStop, IconRefresh, IconLoader, IconTarget } from "./Icons";

const optimizeWebhookUrl = process.env.NEXT_PUBLIC_OPTIMIZE_WEBHOOK_URL || "";

type RunControlsProps = ActionButtonsProps & {
  controlsLocked: boolean;
  onPromptChange: (value: string) => void;
  onStartUrlChange: (value: string) => void;
  prompt: string;
  runnerBaseUrl?: string;
  showActionButtons?: boolean;
  startUrl: string;
};

export function ConnectProfileButton({ runnerBaseUrl }: { runnerBaseUrl: string }) {
  const [status, setStatus] = useState<"loading" | "connected" | "not-connected" | "disabled">("loading");
  const [action, setAction] = useState<"idle" | "connecting" | "switching" | "finishing">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${runnerBaseUrl}/api/browser/profile-status`);
      const data = await res.json();
      if (!data.persist) {
        setStatus("disabled");
      } else {
        setStatus(data.profileExists ? "connected" : "not-connected");
      }
    } catch {
      setStatus("not-connected");
    }
  }, [runnerBaseUrl]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [menuOpen]);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 6000);
  };

  const handleClearProfile = async () => {
    setAction("switching");
    setMenuOpen(false);
    try {
      await fetch(`${runnerBaseUrl}/api/browser/clear-profile`, { method: "POST" });
      showMessage("Profile cleared from server.");
    } catch {
      showMessage("Failed to clear profile.");
    }
    setAction("idle");
    void checkStatus();
  };

  if (status === "loading" || status === "disabled") return null;

  const busy = action !== "idle";
  const dotColor = status === "connected" ? "#22c55e" : "#ef4444";
  const label =
    action === "connecting" ? "Connecting…" :
    action === "switching" ? "Switching…" :
    action === "finishing" ? "Saving…" :
    status === "connected" ? "Google Profile Linked" : "No Profile Session";

  return (
    <div className="profileDropdownWrapper" ref={menuRef}>
      <button
        className={`profilePillBtn ${status === "connected" ? "profilePillConnected" : "profilePillDisconnected"} ${busy ? "profilePillBusy" : ""}`}
        onClick={() => !busy && setMenuOpen((v) => !v)}
        type="button"
        disabled={busy}
      >
        <span className="profilePillDot" style={{ background: dotColor }} />
        <span className="profilePillLabel">{label}</span>
        <svg className={`profilePillChevron ${menuOpen ? "profilePillChevronOpen" : ""}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {menuOpen && (
        <div className="profileDropdownMenu">
          <div className="profileDropdownHeader">
            <span className="profileDropdownDot" style={{ background: dotColor }} />
            <span>{status === "connected" ? "Profile Active" : "No Profile"}</span>
          </div>

          {status !== "connected" ? (
            <>
              <div className="profileDropdownHint" style={{ padding: "12px", textAlign: "center", borderTop: "none" }}>
                <span style={{ fontSize: "16px", display: "block", marginBottom: "8px" }}>🧩</span>
                <b>Account Not Linked</b><br/><br/>
                Click the <b>Agent John Wick</b> Chrome Extension in your browser toolbar to sync your active session.
              </div>
            </>
          ) : (
            <>
              <button className="profileDropdownItem profileDropdownItemSwitch" onClick={() => void handleClearProfile()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                   <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line>
                </svg>
                Disconnect & Clear Profile
              </button>
            </>
          )}
        </div>
      )}

      {message && (
        <div className="profileToast">
          <span>{message}</span>
          <button className="profileToastClose" onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

    </div>
  );
}

export function RunActionButtons({
  onResetWorkspace,
  onStartRun,
  onStopRun,
  pendingAction,
  resetDisabled,
  startDisabled,
  stopDisabled,
}: ActionButtonsProps) {
  return (
    <div className="stageToolbarActions">
      <button
        className="actionBtnPrimary"
        disabled={startDisabled}
        onClick={() => void onStartRun()}
        type="button"
        title="Deploy the agent"
      >
        {pendingAction === "start" ? <IconLoader size={16} /> : <IconPlay size={16} />}
      </button>
      <button
        className="actionBtnDanger"
        disabled={stopDisabled}
        onClick={() => void onStopRun()}
        type="button"
        title="Abort mission"
      >
        {pendingAction === "stop" ? <IconLoader size={16} /> : <IconStop size={16} />}
      </button>
      <button
        className="actionBtnNeutral"
        disabled={resetDisabled}
        onClick={() => void onResetWorkspace()}
        type="button"
        title="Reset workspace"
      >
        {pendingAction === "reset" ? <IconLoader size={16} /> : <IconRefresh size={16} />}
      </button>
    </div>
  );
}

export function RunControls({
  controlsLocked,
  onPromptChange,
  onStartUrlChange,
  prompt,
  runnerBaseUrl = "http://127.0.0.1:4001",
  showActionButtons = true,
  startUrl,
  ...actionButtons
}: RunControlsProps) {
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  const canOptimize = !controlsLocked && !optimizing && prompt.trim().length > 0 && optimizeWebhookUrl.length > 0;

  const handleOptimize = async () => {
    if (!canOptimize) return;
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const res = await fetch(optimizeWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, startUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const optimized = data.optimizedPrompt || data.prompt || "";
      if (optimized) {
        onPromptChange(optimized);
      } else {
        throw new Error("No optimized prompt returned");
      }
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : "Optimization failed");
      setTimeout(() => setOptimizeError(null), 4000);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <aside className="controlsPanel">
      <div className="controlsHeader">
        <h2>Mission Control</h2>
      </div>

      <div className="controlsGrid">
        <div className="railField urlField">
          <label htmlFor="start-url">URL</label>
          <input
            disabled={controlsLocked}
            id="start-url"
            onChange={(event) => onStartUrlChange(event.target.value)}
            placeholder="https://target-website.com"
            type="url"
            value={startUrl}
          />
        </div>

        <div className="railField promptField">
          <div className="promptLabelRow">
            <label htmlFor="run-prompt">Mission Objective</label>
            {optimizeWebhookUrl ? (
              <button
                className={`optimizeBtn ${optimizing ? "optimizeBtnLoading" : ""}`}
                disabled={!canOptimize}
                onClick={() => void handleOptimize()}
                title="Smart optimize — AI rewrites your prompt for better agent performance"
                type="button"
              >
                <span className="optimizeBtnIcon">✨</span>
                {optimizing ? <span className="optimizeBtnText">Optimizing...</span> : <span className="optimizeBtnText">Optimize</span>}
              </button>
            ) : null}
          </div>
          <textarea
            disabled={controlsLocked || optimizing}
            id="run-prompt"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Navigate to the target URL and describe what you see on the page."
            rows={6}
            value={prompt}
          />
          {optimizeError ? (
            <span className="optimizeError">{optimizeError}</span>
          ) : null}
        </div>
      </div>

      {/* ConnectProfileButton intentionally removed to save vertical space */}

      {showActionButtons ? <RunActionButtons {...actionButtons} /> : null}
    </aside>
  );
}
