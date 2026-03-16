"use client";

import { formatClock, formatRunnerIssueMessage, scenarioTargetDisplay } from "./helpers";
import { ActivityFeed } from "./ActivityFeed";
import { RunControls, RunActionButtons } from "./RunControls";
import { ConsoleTopbar, RunSummary } from "./RunSummary";
import { ScreenshotPane } from "./ScreenshotPane";
import type { OperatorConsoleProps } from "./types";
import { useRunStream } from "./useRunStream";

export function OperatorConsole({
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios,
}: OperatorConsoleProps) {
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
              showActionButtons={false}
              startDisabled={startDisabled}
              startUrl={startUrl}
              stopDisabled={stopDisabled}
            />

            <ActivityFeed
              activityFeedLabel={activityFeedLabel}
              activityFeedRef={activityFeedRef}
              activityItems={activityItems}
              followActivityFeed={followActivityFeed}
              onActivityFeedScroll={handleActivityFeedScroll}
              onJumpToLatestActivity={handleJumpToLatestActivity}
              onSelectScreenshot={handleSelectScreenshot}
              onStreamLogsChange={setStreamLogs}
              screenshots={screenshots}
              streamLogs={streamLogs}
            />
          </section>

          <section className="stageColumn">
            <div className="stageControlBar">
              <RunSummary
                stageHeadline={stageHeadline}
                stageSupportCopy={stageSupportCopy}
              />
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
          </section>
        </section>
      </section>
    </main>
  );
}
