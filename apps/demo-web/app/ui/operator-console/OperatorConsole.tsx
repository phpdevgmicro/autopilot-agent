"use client";

import { useState, useEffect } from "react";
import { formatClock, formatRunnerIssueMessage, scenarioTargetDisplay } from "./helpers";
import { IconMonitor, IconActivity, IconBarChart, IconCheckCircle } from "./Icons";
import { RunControls, RunActionButtons } from "./RunControls";
import { ConsoleTopbar } from "./RunSummary";
import { ScreenshotPane } from "./ScreenshotPane";
import { WalkthroughSummary } from "./WalkthroughSummary";
import { NotificationToast } from "./NotificationToast";
import type { OperatorConsoleProps } from "./types";
import { useRunStream } from "./useRunStream";
import { LogsTab } from "./LogsTab";

type StageTab = "browser" | "summary" | "logs";

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
    healthStatus,
    activeNotifications,
    dismissNotification,
    retryConnection,
  } = useRunStream({
    initialRunnerIssue,
    runnerBaseUrl,
    scenarios,
  });

  // Health monitoring
  const healthBadgeClass =
    healthStatus === "healthy" ? "healthBadgeHealthy" :
    healthStatus === "degraded" ? "healthBadgeDegraded" :
    healthStatus === "connecting" ? "healthBadgeConnecting" :
    "healthBadgeDead";
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
      ? "Agent deployed"
      : selectedRun.run.status === "completed"
        ? "Mission complete"
        : selectedRun.run.status === "cancelled"
          ? "Mission cancelled"
          : currentIssue?.title ?? "Mission failed"
    : matchingWorkspaceState
      ? "Workspace cleared"
      : currentIssue
        ? currentIssue.title
        : runnerOnline
          ? "Standing by"
          : healthStatus === "connecting"
            ? "Starting up…"
            : "Engine offline";
  const stageSupportCopy = selectedRun
    ? selectedRun.run.status === "failed"
      ? issueMessage
      : null
    : matchingWorkspaceState
      ? `Workspace cleared at ${formatClock(matchingWorkspaceState.resetAt)}.`
      : currentIssue
        ? issueMessage
        : runnerOnline
        ? "Define a target and mission objective, then deploy the agent."
        : healthStatus === "connecting"
          ? "Connecting to the runner…"
          : issueMessage;

  const emptyReviewMessage = selectedRun
    ? selectedRun.run.status === "running"
      ? "Agent is active — the first captured frame will appear here shortly."
      : selectedRun.run.status === "failed"
        ? issueMessage ?? "The mission failed before any frames were captured."
        : "The agent completed without capturing browser frames."
    : currentIssue
      ? issueMessage ?? currentIssue.error
      : runnerOnline
        ? "Configure your target and objective to begin."
        : issueMessage ?? "Engine is unavailable.";
  const emptyReviewHeading = selectedRun
    ? selectedRun.run.status === "running"
      ? "Agent Active"
      : selectedRun.run.status === "failed"
        ? "Mission Failed"
        : "Complete"
    : runnerOnline
      ? "Ready to Deploy"
      : "Offline";
  const emptyTimelineMessage = selectedRun
    ? selectedRun.run.status === "failed"
      ? issueMessage ?? "Mission ended before any frames were captured."
      : "Frames will appear here as the mission progresses."
    : currentIssue
      ? issueMessage ?? currentIssue.error
      : runnerOnline
        ? "Frames will appear here once the agent deploys."
        : issueMessage ?? "Engine is unavailable.";

  const isRunFinished = selectedRun && (
    selectedRun.run.status === "completed" ||
    selectedRun.run.status === "failed" ||
    selectedRun.run.status === "cancelled"
  );

  // Auto-switch to summary tab when run finishes
  useEffect(() => {
    if (isRunFinished) {
      setActiveTab("summary");
    }
  }, [isRunFinished]);

  // Reset to browser tab when run is cleared (Reset button)
  useEffect(() => {
    if (!selectedRun || matchingWorkspaceState) {
      setActiveTab("browser");
    }
  }, [selectedRun, matchingWorkspaceState]);

  return (
    <main className="consoleShell">
      {/* Health notification toasts */}
      <NotificationToast
        notifications={activeNotifications}
        onDismiss={dismissNotification}
      />

      <section className="consoleFrame">
        <div className="topbarWithHealth">
          <ConsoleTopbar
            runnerBaseUrl={runnerBaseUrl}
            runnerOnline={runnerOnline}
            stageHeadline={stageHeadline}
          />
          <div className={`healthBadge ${healthBadgeClass}`}>
            <span className="healthBadgeDot" />
            <span className="healthBadgeLabel">
              {healthStatus === "healthy" ? "Online" : healthStatus === "connecting" ? "Connecting…" : healthStatus === "degraded" ? "Degraded" : "Offline"}
            </span>
            {healthStatus === "dead" ? (
              <button
                className="healthRetryBtn"
                onClick={retryConnection}
                type="button"
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>

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
              <div className="stageTabs">
                  {/* Tab 1: Browser — live screenshot */}
                  <button
                    className={`stageTab ${activeTab === "browser" ? "active" : ""}`}
                    onClick={() => setActiveTab("browser")}
                    type="button"
                  >
                    <IconMonitor size={14} /> Browser
                    {screenshots.length > 0 ? (
                      <span className="stageTabBadge">{screenshots.length}</span>
                    ) : null}
                  </button>

                  {/* Tab 2: Mission Log — terminal execution log */}
                  <button
                    className={`stageTab ${activeTab === "logs" ? "active" : ""}`}
                    onClick={() => setActiveTab("logs")}
                    type="button"
                  >
                    <IconActivity size={14} /> Mission Log
                    {runEvents.length > 0 ? (
                      <span className="stageTabBadge">{runEvents.length}</span>
                    ) : null}
                  </button>

                  {/* Tab 3: Summary — post-run AI report */}
                  <button
                    className={`stageTab ${activeTab === "summary" ? "active" : ""} ${isRunFinished ? "stageTabReady" : ""}`}
                    disabled={!isRunFinished}
                    onClick={() => setActiveTab("summary")}
                    type="button"
                  >
                    <IconBarChart size={14} /> Summary
                    {isRunFinished ? (
                      <span className="stageTabBadge stageTabBadgeGreen"><IconCheckCircle size={10} /></span>
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

            {/* ── Tab Content ────────────────────────── */}
            {activeTab === "browser" ? (
              <ScreenshotPane
                emptyReviewHeading={emptyReviewHeading}
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
            ) : activeTab === "summary" && isRunFinished ? (
              <WalkthroughSummary
                runEvents={runEvents}
                runnerBaseUrl={runnerBaseUrl}
                screenshots={screenshots}
                selectedRun={selectedRun}
              />
            ) : activeTab === "logs" ? (
              <LogsTab
                runEvents={runEvents}
                streamLogs={streamLogs}
                onStreamLogsChange={setStreamLogs}
              />
            ) : null}
          </section>
        </section>
      </section>
    </main>
  );
}
