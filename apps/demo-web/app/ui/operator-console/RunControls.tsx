"use client";

import { useState, useEffect, useCallback } from "react";
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

export function ConnectProfileButton({ runnerBaseUrl }: { runnerBaseUrl: string }) {
  const [status, setStatus] = useState<"loading" | "connected" | "not-connected" | "disabled">("loading");
  const [launching, setLaunching] = useState(false);

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

  const handleConnect = async () => {
    setLaunching(true);
    try {
      await fetch(`${runnerBaseUrl}/api/browser/connect-profile`, { method: "POST" });
    } catch { /* ignore */ }
    setTimeout(() => {
      setLaunching(false);
      void checkStatus();
    }, 3000);
  };

  if (status === "loading" || status === "disabled") return null;

  return (
    <div className="topbarStatusPill" style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '6px 14px', borderRadius: '16px', gap: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
      <span className={`profileDot ${status === "connected" ? "profileDotGreen" : "profileDotRed"}`} style={{ width: '8px', height: '8px', borderRadius: '50%', background: status === "connected" ? '#22c55e' : '#ef4444' }} />
      <span>{status === "connected" ? "Google Profile Linked" : "No Profile Session"}</span>
      {status !== "connected" ? (
        <button
          onClick={() => void handleConnect()}
          disabled={launching}
          style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer', marginLeft: '4px' }}
        >
          {launching ? "Connecting" : "Connect"}
        </button>
      ) : null}
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
