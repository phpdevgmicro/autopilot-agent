"use client";

import { useState, useEffect } from "react";
import { formatClock, formatRunnerIssueMessage, scenarioTargetDisplay } from "./helpers";
import { ActivityFeed } from "./ActivityFeed";
import { RunControls, RunActionButtons } from "./RunControls";
import { ConsoleTopbar, RunSummary } from "./RunSummary";
import { ScreenshotPane } from "./ScreenshotPane";
import { WalkthroughSummary } from "./WalkthroughSummary";
import type { OperatorConsoleProps } from "./types";
import { useRunStream } from "./useRunStream";

type StageTab = "browser" | "activity" | "walkthrough";

export function OperatorConsole({
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios,
}: OperatorConsoleProps) {
  const [activeTab, setActiveTab] = useState<StageTab>("browser");

  const {
    activityFeedLabel,
    activityFeedRef,
    activityItems,
    controlsLocked,
    currentIssue,
    followActivityFeed,
    handleActivityFeedScroll,
    handleJumpToLatestActivity,
    handleJumpToLatestScreenshot,
    handleOpenReplay,
    handleResetWorkspace,
    handleScrubberChange,
    handleSelectScreenshot,
    handleStartRun,
    handleStopRun,
    matchingWorkspaceState,
    pendingAction,
    prompt,
    runEvents,
    runnerOnline,
    screenshots,
    selectedBrowser,
    selectedRun,
    selectedScenario,
    selectedScreenshot,
    selectedScreenshotIndex,
    setPrompt,
    setStartUrl,
    setStreamLogs,
    startUrl,
    streamLogs,
    viewingLiveFrame,
  } = useRunStream({
    initialRunnerIssue,
    runnerBaseUrl,
    scenarios,
  });

  const selectedScenarioTitle = selectedScenario?.title ?? "Autonomous Agent";
  const stageUrl =
    selectedBrowser?.currentUrl ??
    (selectedRun
      ? scenarioTargetDisplay(selectedScenario)
      : "Awaiting agent launch");
  const startDisabled =
    !runnerOnline ||
    !selectedScenario ||
    pendingAction !== null ||
    controlsLocked ||
    prompt.trim().length === 0;
  const stopDisabled =
    !selectedRun ||
    selectedRun.run.status !== "running" ||
    pendingAction !== null;
  const resetDisabled =
    !runnerOnline || !selectedScenario || pendingAction === "start";
  const replayDisabled = !selectedRun;
  const issueMessage = currentIssue ? formatRunnerIssueMessage(currentIssue) : null;
  const stageHeadline = selectedRun
    ? selectedRun.run.status === "running"
      ? "Agent active"
      : selectedRun.run.status === "completed"
        ? "Task completed"
        : selectedRun.run.status === "cancelled"
          ? "Task cancelled"
          : currentIssue?.title ?? "Task failed"
    : matchingWorkspaceState
      ? "Workspace reset"
      : currentIssue
        ? currentIssue.title
        : runnerOnline
          ? "Ready"
          : "Runner offline";
  const stageSupportCopy = selectedRun
    ? selectedRun.run.status === "failed"
      ? issueMessage
      : null
    : matchingWorkspaceState
      ? `Workspace reset at ${formatClock(matchingWorkspaceState.resetAt)}.`
      : currentIssue
        ? issueMessage
        : runnerOnline
        ? "Enter a URL and instructions, then start the agent."
        : issueMessage;
  const topbarSubtitle = selectedRun
    ? `Running ${selectedScenarioTitle}`
    : "Autonomous browser agent — give it a URL and instructions.";
  const emptyReviewMessage = selectedRun
    ? selectedRun.run.status === "running"
      ? "The agent is active. The first captured frame will appear here shortly."
      : selectedRun.run.status === "failed"
        ? issueMessage ?? "The agent failed before a screenshot was captured."
        : "The agent finished without a captured browser frame."
    : currentIssue
      ? issueMessage ?? currentIssue.error
      : runnerOnline
        ? "Start the agent to begin reviewing captured frames."
        : issueMessage ?? "Runner is unavailable.";
  const emptyTimelineMessage = selectedRun
    ? selectedRun.run.status === "failed"
      ? issueMessage ?? "The agent ended before any captures were saved."
      : "Captured frames will appear here as the agent progresses."
    : currentIssue
      ? issueMessage ?? currentIssue.error
      : runnerOnline
        ? "Captured frames will appear here once the agent starts."
        : issueMessage ?? "Runner is unavailable.";

  const isRunFinished = selectedRun && (
    selectedRun.run.status === "completed" ||
    selectedRun.run.status === "failed" ||
    selectedRun.run.status === "cancelled"
  );

  // Auto-switch to walkthrough tab when run finishes
  useEffect(() => {
    if (isRunFinished) {
      setActiveTab("walkthrough");
    }
  }, [isRunFinished]);

  // Reset to browser tab when run is cleared (Reset button)
  useEffect(() => {
    if (!selectedRun) {
      setActiveTab("browser");
    }
  }, [selectedRun]);

  return (
    <main className="consoleShell">
      <section className="consoleFrame">
        <ConsoleTopbar
          runnerOnline={runnerOnline}
          topbarSubtitle={topbarSubtitle}
        />

        <section className="benchTop">
          <section className="controlColumn">
            <RunControls
              controlsLocked={controlsLocked}
              onPromptChange={setPrompt}
              onResetWorkspace={handleResetWorkspace}
              onStartRun={handleStartRun}
              onStartUrlChange={setStartUrl}
              onStopRun={handleStopRun}
              pendingAction={pendingAction}
              prompt={prompt}
              resetDisabled={resetDisabled}
              runnerBaseUrl={runnerBaseUrl}
              showActionButtons={false}
              startDisabled={startDisabled}
              startUrl={startUrl}
              stopDisabled={stopDisabled}
            />
          </section>

          <section className="stageColumn">
            <div className="stageControlBar">
              <RunSummary
                stageHeadline={stageHeadline}
                stageSupportCopy={stageSupportCopy}
              />
              <div className="stageToolbarRight">
                <div className="stageTabs">
                  {/* Tab 1: Browser — live screenshot */}
                  <button
                    className={`stageTab ${activeTab === "browser" ? "active" : ""}`}
                    onClick={() => setActiveTab("browser")}
                    type="button"
                  >
                    🖥️ Browser
                    {screenshots.length > 0 ? (
                      <span className="stageTabBadge">{screenshots.length}</span>
                    ) : null}
                  </button>

                  {/* Tab 2: Activity — event stream */}
                  <button
                    className={`stageTab ${activeTab === "activity" ? "active" : ""}`}
                    onClick={() => setActiveTab("activity")}
                    type="button"
                  >
                    ⚡ Activity
                    {activityItems.length > 0 ? (
                      <span className="stageTabBadge">{activityItems.length}</span>
                    ) : null}
                  </button>

                  {/* Tab 3: Walkthrough — post-run report */}
                  <button
                    className={`stageTab ${activeTab === "walkthrough" ? "active" : ""} ${isRunFinished ? "stageTabReady" : ""}`}
                    disabled={!isRunFinished}
                    onClick={() => setActiveTab("walkthrough")}
                    type="button"
                  >
                    📋 Walkthrough
                    {isRunFinished ? (
                      <span className="stageTabBadge stageTabBadgeGreen">✓</span>
                    ) : null}
                  </button>
                </div>
                <RunActionButtons
                  onResetWorkspace={handleResetWorkspace}
                  onStartRun={handleStartRun}
                  onStopRun={handleStopRun}
                  pendingAction={pendingAction}
                  resetDisabled={resetDisabled}
                  startDisabled={startDisabled}
                  stopDisabled={stopDisabled}
                />
              </div>
            </div>

            {/* ── Tab Content ────────────────────────── */}
            {activeTab === "browser" ? (
              <ScreenshotPane
                emptyReviewMessage={emptyReviewMessage}
                emptyTimelineMessage={emptyTimelineMessage}
                onJumpToLatestScreenshot={handleJumpToLatestScreenshot}
                onOpenReplay={handleOpenReplay}
                onScrubberChange={handleScrubberChange}
                onSelectScreenshot={handleSelectScreenshot}
                replayDisabled={replayDisabled}
                runnerBaseUrl={runnerBaseUrl}
                screenshots={screenshots}
                selectedBrowser={selectedBrowser}
                selectedRun={selectedRun}
                selectedScenarioTitle={selectedScenarioTitle}
                selectedScreenshot={selectedScreenshot}
                selectedScreenshotIndex={selectedScreenshotIndex}
                stageUrl={stageUrl}
                viewingLiveFrame={viewingLiveFrame}
              />
            ) : activeTab === "activity" ? (
              <div className="stageActivityPanel">
                <ActivityFeed
                  activityFeedLabel={activityFeedLabel}
                  activityFeedRef={activityFeedRef}
                  activityItems={activityItems}
                  followActivityFeed={followActivityFeed}
                  onActivityFeedScroll={handleActivityFeedScroll}
                  onJumpToLatestActivity={handleJumpToLatestActivity}
                  onSelectScreenshot={(screenshotId) => {
                    handleSelectScreenshot(screenshotId);
                    setActiveTab("browser");
                  }}
                  onStreamLogsChange={setStreamLogs}
                  screenshots={screenshots}
                  streamLogs={streamLogs}
                />
              </div>
            ) : activeTab === "walkthrough" && isRunFinished ? (
              <WalkthroughSummary
                runEvents={runEvents}
                runnerBaseUrl={runnerBaseUrl}
                screenshots={screenshots}
                selectedRun={selectedRun}
              />
            ) : null}
          </section>
        </section>
      </section>
    </main>
  );
}
