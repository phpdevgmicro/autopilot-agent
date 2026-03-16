"use client";

import type { ActionButtonsProps } from "./types";

type RunControlsProps = ActionButtonsProps & {
  controlsLocked: boolean;
  onPromptChange: (value: string) => void;
  onStartUrlChange: (value: string) => void;
  prompt: string;
  showActionButtons?: boolean;
  startUrl: string;
};

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
        {pendingAction === "start" ? "Starting..." : "Start Run"}
      </button>
      <button
        className="secondaryButton"
        disabled={stopDisabled}
        onClick={() => void onStopRun()}
        type="button"
      >
        {pendingAction === "stop" ? "Stopping..." : "Stop"}
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
  showActionButtons = true,
  startUrl,
  ...actionButtons
}: RunControlsProps) {
  return (
    <aside className="panel controlsPanel">
      <div className="controlsHeader">
        <h2>Agent Controls</h2>
      </div>

      <div className="controlsGrid">
        <div className="railField urlField">
          <label htmlFor="start-url">Target URL <span style={{fontWeight: 400, opacity: 0.6}}>(optional)</span></label>
          <input
            disabled={controlsLocked}
            id="start-url"
            onChange={(event) => onStartUrlChange(event.target.value)}
            placeholder="https://example.com — leave empty to let agent navigate on its own"
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
            placeholder="Tell the agent what to do on the target website..."
            rows={6}
            value={prompt}
          />
        </div>
      </div>

      {showActionButtons ? <RunActionButtons {...actionButtons} /> : null}
    </aside>
  );
}
