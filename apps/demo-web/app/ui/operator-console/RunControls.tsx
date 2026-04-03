"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ActionButtonsProps } from "./types";
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

type ConnectProfileProps = {
  runnerBaseUrl: string;
  selectedProfile?: string;
  onProfileChange?: (p: string) => void;
};

export function ConnectProfileButton({ runnerBaseUrl, selectedProfile, onProfileChange }: ConnectProfileProps) {
  const [status, setStatus] = useState<"loading" | "connected" | "not-connected" | "disabled">("loading");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [action, setAction] = useState<"idle" | "switching" | "clearing">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const checkStatus = useCallback(async () => {
    try {
      // Check if persistence is enabled by checking one of the profiles (or fallback)
      const res = await fetch(`${runnerBaseUrl}/api/browser/profile-status?profileName=${selectedProfile || "default"}`);
      const data = await res.json();
      if (!data.persist) {
        setStatus("disabled");
        return;
      }
      
      const profilesRes = await fetch(`${runnerBaseUrl}/api/browser/profiles`);
      const profilesData = await profilesRes.json();
      setProfiles(profilesData.profiles || ["default"]);
      
      if (!selectedProfile && profilesData.profiles?.length > 0) {
        let defaultOrFirst = profilesData.profiles.includes("default") ? "default" : profilesData.profiles[0];
        // prefer a non-default profile if available
        if (profilesData.profiles.length > 1) {
          defaultOrFirst = profilesData.profiles.find((p: string) => p !== "default") || defaultOrFirst;
        }
        onProfileChange?.(defaultOrFirst);
      }
      
      // Assume "connected" if the currently selected profile is NOT "default", OR if it exists.
      // Wait, we just trust the profile list.
      if (profilesData.profiles?.includes(selectedProfile || "default")) {
        setStatus((selectedProfile && selectedProfile !== "default") ? "connected" : "not-connected");
      } else {
         setStatus("not-connected");
      }
    } catch {
      setStatus("not-connected");
    }
  }, [runnerBaseUrl, selectedProfile, onProfileChange]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus, menuOpen]);

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
    setAction("clearing");
    setMenuOpen(false);
    try {
      await fetch(`${runnerBaseUrl}/api/browser/clear-profile`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileName: selectedProfile })
      });
      showMessage("Profile cleared from server.");
      onProfileChange?.("default");
    } catch {
      showMessage("Failed to clear profile.");
    }
    setAction("idle");
    void checkStatus();
  };

  if (status === "loading" || status === "disabled") return null;

  const busy = action !== "idle";
  const dotColor = status === "connected" ? "#22c55e" : "#ef4444";
  
  // Show the actual email on the pill (truncate if too long)
  const profileDisplayName = selectedProfile && selectedProfile !== "default"
    ? selectedProfile.replace(/@gmail\.com$/, "")
    : null;
  
  const label =
    action === "switching" ? "Switching…" :
    action === "clearing" ? "Clearing…" :
    status === "connected" && profileDisplayName ? profileDisplayName : 
    status === "connected" ? "Profile Linked" : "No Profile";

  return (
    <div className="profileDropdownWrapper" ref={menuRef}>
      <button
        className={`profilePillBtn ${status === "connected" ? "profilePillConnected" : "profilePillDisconnected"} ${busy ? "profilePillBusy" : ""}`}
        onClick={() => !busy && setMenuOpen((v) => !v)}
        type="button"
        disabled={busy}
      >
        <span className="profilePillDot" style={{ background: dotColor }} />
        <span className="profilePillLabel">{status === "connected" ? label : "Select Profile"}</span>
        <svg className={`profilePillChevron ${menuOpen ? "profilePillChevronOpen" : ""}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {menuOpen && (
        <div className="profileDropdownMenu">
          <div className="profileDropdownHeader">
            <span className="profileDropdownDot" style={{ background: dotColor }} />
            <span>Select Active Profile</span>
          </div>

          <div style={{ padding: "8px" }}>
            {profiles.map(p => (
              <button 
                key={p}
                className={`profileDropdownItem ${selectedProfile === p ? 'active' : ''}`}
                onClick={() => {
                  onProfileChange?.(p);
                  setMenuOpen(false);
                }}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: "8px", opacity: selectedProfile === p ? 1 : 0.7 }}
              >
                <span style={{ width: "16px", flexShrink: 0, textAlign: "center" }}>
                  {selectedProfile === p ? '✓' : ''}
                </span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p === "default" ? "Guest (No Account)" : p}
                </span>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <a 
              href="/agent-john-wick-extension.zip" 
              download
              title="Download Extension"
              className="profileDropdownItem"
              style={{ flex: 1, justifyContent: "center", color: "#60a5fa", gap: "6px", fontSize: "0.8rem", padding: "10px", textDecoration: "none" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Extension
            </a>
            {status === "connected" && (
              <button 
                className="profileDropdownItem"
                onClick={() => void handleClearProfile()} 
                title="Disconnect selected profile"
                style={{ flex: 1, justifyContent: "center", color: "#f87171", borderLeft: "1px solid rgba(255,255,255,0.06)", gap: "6px", fontSize: "0.8rem", padding: "10px", background: "transparent" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line>
                </svg>
                Disconnect
              </button>
            )}
          </div>
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
