"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ActionButtonsProps } from "./types";
import { IconPlay, IconStop, IconRefresh, IconLoader, IconTarget } from "./Icons";
import { ProfileLoginModal } from "./ProfileLoginModal";

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
  const [showLoginModal, setShowLoginModal] = useState(false);
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

  const launchAndOpenModal = async (clear: boolean) => {
    setAction(clear ? "switching" : "connecting");
    setMenuOpen(false);
    try {
      if (clear) await fetch(`${runnerBaseUrl}/api/browser/clear-profile`, { method: "POST" });
      const res = await fetch(`${runnerBaseUrl}/api/browser/connect-profile`, { method: "POST" });
      const data = await res.json();
      if (data.mode === "embedded" || data.mode === "remote") {
        setShowLoginModal(true);
      } else if (data.message) {
        showMessage(data.message);
      }
    } catch {
      showMessage(clear ? "Failed to switch profile." : "Failed to launch browser.");
    }
    setAction("idle");
  };

  const handleConnect = () => void launchAndOpenModal(false);
  const handleSwitch = () => void launchAndOpenModal(true);

  const handleLocalLogin = () => {
    const cmd = `npx tsx scripts/google-login.ts ${runnerBaseUrl}`;
    // Copy command to clipboard if possible
    navigator.clipboard?.writeText(cmd).catch(() => {});
    showMessage(`Run in terminal: ${cmd}`);
  };

  const handleFinishLogin = async () => {
    setAction("finishing");
    setMenuOpen(false);
    try {
      const res = await fetch(`${runnerBaseUrl}/api/browser/finish-profile-login`, { method: "POST" });
      const data = await res.json();
      showMessage(data.message ?? "Profile session saved.");
    } catch {
      showMessage("Failed to finish login session.");
    }
    setTimeout(() => {
      setAction("idle");
      void checkStatus();
    }, 2000);
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
              <button className="profileDropdownItem" onClick={() => void handleConnect()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                  <polyline points="10 17 15 12 10 7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                Embedded Browser Login
              </button>
              <button className="profileDropdownItem" onClick={() => { setMenuOpen(false); handleLocalLogin(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                Local Browser Login
              </button>
              <div className="profileDropdownHint">
                💡 Local: run <code>npx tsx scripts/google-login.ts</code>
              </div>
            </>
          ) : (
            <>
              <button className="profileDropdownItem profileDropdownItemSwitch" onClick={() => void handleSwitch()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8"/>
                  <line x1="4" y1="20" x2="21" y2="3"/>
                  <polyline points="21 16 21 21 16 21"/>
                  <line x1="15" y1="15" x2="21" y2="21"/>
                  <line x1="4" y1="4" x2="9" y2="9"/>
                </svg>
                Switch Account
              </button>
              <button className="profileDropdownItem profileDropdownItemFinish" onClick={() => void handleFinishLogin()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Finish Login Session
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

      <ProfileLoginModal
        runnerBaseUrl={runnerBaseUrl}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onProfileSaved={() => void checkStatus()}
      />
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
