"use client";

import { useState, useEffect, useCallback } from "react";
import type { ActionButtonsProps } from "./types";

type RunControlsProps = ActionButtonsProps & {
  controlsLocked: boolean;
  onPromptChange: (value: string) => void;
  onStartUrlChange: (value: string) => void;
  prompt: string;
  runnerBaseUrl?: string;
  showActionButtons?: boolean;
  startUrl: string;
};

function ConnectProfileButton({ runnerBaseUrl }: { runnerBaseUrl: string }) {
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
    // Give a moment for profile to be created, then re-check
    setTimeout(() => {
      setLaunching(false);
      void checkStatus();
    }, 3000);
  };

  if (status === "loading" || status === "disabled") return null;

  return (
    <div className="profileConnect">
      <div className="profileStatus">
        <span className={`profileDot ${status === "connected" ? "profileDotGreen" : "profileDotRed"}`} />
        <span className="profileLabel">
          {status === "connected" ? "Profile connected" : "No profile"}
        </span>
      </div>
      <button
        className="profileButton"
        disabled={launching}
        onClick={() => void handleConnect()}
        type="button"
      >
        {launching ? "Opening browser..." : status === "connected" ? "🔄 Re-login" : "🔗 Connect Google"}
      </button>
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
        className="primaryButton"
        disabled={startDisabled}
        onClick={() => void onStartRun()}
        type="button"
      >
        {pendingAction === "start" ? "Launching..." : "Launch Agent"}
      </button>
      <button
        className="secondaryButton"
        disabled={stopDisabled}
        onClick={() => void onStopRun()}
        type="button"
      >
        {pendingAction === "stop" ? "Stopping..." : "Abort"}
      </button>
      <button
        className="secondaryButton"
        disabled={resetDisabled}
        onClick={() => void onResetWorkspace()}
        type="button"
      >
        {pendingAction === "reset" ? "Resetting..." : "Reset"}
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
  return (
    <aside className="controlsPanel">
      <div className="controlsHeader">
        <h2>Mission Control</h2>
      </div>

      <div className="controlsGrid">
        <div className="railField urlField">
          <label htmlFor="start-url">Target URL <span style={{fontWeight: 400, opacity: 0.5}}>(optional)</span></label>
          <input
            disabled={controlsLocked}
            id="start-url"
            onChange={(event) => onStartUrlChange(event.target.value)}
            placeholder="https://example.com"
            type="url"
            value={startUrl}
          />
        </div>

        <div className="railField promptField">
          <label htmlFor="run-prompt">Instructions</label>
          <textarea
            disabled={controlsLocked}
            id="run-prompt"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Describe what the agent should accomplish..."
            rows={6}
            value={prompt}
          />
        </div>
      </div>

      {!controlsLocked ? (
        <ConnectProfileButton runnerBaseUrl={runnerBaseUrl} />
      ) : null}

      {showActionButtons ? <RunActionButtons {...actionButtons} /> : null}
    </aside>
  );
}

