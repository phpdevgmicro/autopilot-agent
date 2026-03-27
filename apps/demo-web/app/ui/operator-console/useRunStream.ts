"use client";

/**
 * Orchestrator hook — composes the four focused hooks into the single
 * return shape that OperatorConsole.tsx already expects.
 *
 * Consumer code continues to `import { useRunStream } from "./useRunStream"`.
 */

import { useScenarios } from "./useScenarios";
import { useRunLifecycle } from "./useRunLifecycle";
import { useScreenshots } from "./useScreenshots";
import { useActivityFeed } from "./useActivityFeed";

import type { RunnerIssue } from "./types";
import type { ScenarioManifest } from "@cua-sample/replay-schema";

type UseRunStreamOptions = {
  initialRunnerIssue: RunnerIssue | null;
  runnerBaseUrl: string;
  scenarios: ScenarioManifest[];
};

export function useRunStream({
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios: initialScenarios,
}: UseRunStreamOptions) {
  /* ── 1. Scenario management ── */
  const scenarioHook = useScenarios({
    initialRunnerIssue,
    runnerBaseUrl,
    scenarios: initialScenarios,
  });

  /* ── 2. Run lifecycle (start, stop, reset, SSE) ── */
  const lifecycleHook = useRunLifecycle({
    initialRunnerIssue,
    prompt: scenarioHook.prompt,
    runnerBaseUrl,
    runnerOnline: scenarioHook.runnerOnline,
    selectedScenario: scenarioHook.selectedScenario,
    startUrl: scenarioHook.startUrl,
  });

  /* ── 3. Screenshot selection & scrubber ── */
  const screenshotHook = useScreenshots(
    lifecycleHook.screenshots,
    lifecycleHook.selectedRun?.run.id,
  );

  /* ── 4. Activity feed derivation & scroll ── */
  const activityHook = useActivityFeed(
    lifecycleHook.runEvents,
    lifecycleHook.screenshots,
    lifecycleHook.manualLogs,
    lifecycleHook.manualTranscript,
    lifecycleHook.streamLogs,
    lifecycleHook.selectedRun?.run.status,
  );

  /* ── Scenario change handler (bridges scenario + lifecycle) ── */
  const handleScenarioChange = (scenarioId: string) => {
    if (lifecycleHook.controlsLocked) return;
    scenarioHook.selectScenario(scenarioId);
    const next =
      initialScenarios.find((s) => s.id === scenarioId) ?? null;
    lifecycleHook.handleScenarioChange(scenarioId, next);
  };

  /* ── Return the same shape OperatorConsole expects ── */
  return {
    // Activity feed
    activityFeedLabel: activityHook.activityFeedLabel,
    activityFeedRef: activityHook.activityFeedRef,
    activityItems: activityHook.activityItems,
    followActivityFeed: activityHook.followActivityFeed,
    handleActivityFeedScroll: activityHook.handleActivityFeedScroll,
    handleJumpToLatestActivity: activityHook.handleJumpToLatestActivity,

    // Run controls
    controlsLocked: lifecycleHook.controlsLocked,
    currentIssue: lifecycleHook.currentIssue,
    handleOpenReplay: lifecycleHook.handleOpenReplay,
    handleResetWorkspace: lifecycleHook.handleResetWorkspace,
    handleStartRun: lifecycleHook.handleStartRun,
    handleStopRun: lifecycleHook.handleStopRun,
    matchingWorkspaceState: lifecycleHook.matchingWorkspaceState,
    pendingAction: lifecycleHook.pendingAction,
    runEvents: lifecycleHook.runEvents,
    selectedBrowser: lifecycleHook.selectedBrowser,
    selectedRun: lifecycleHook.selectedRun,

    // Screenshots
    followLatestScreenshot: screenshotHook.followLatestScreenshot,
    handleJumpToLatestScreenshot: screenshotHook.handleJumpToLatestScreenshot,
    handleScrubberChange: screenshotHook.handleScrubberChange,
    handleSelectScreenshot: screenshotHook.handleSelectScreenshot,
    latestScreenshot: screenshotHook.latestScreenshot,
    screenshots: lifecycleHook.screenshots,
    selectedScreenshot: screenshotHook.selectedScreenshot,
    selectedScreenshotIndex: screenshotHook.selectedScreenshotIndex,
    viewingLiveFrame: screenshotHook.viewingLiveFrame,

    // Scenario state
    prompt: scenarioHook.prompt,
    runnerOnline: scenarioHook.runnerOnline,
    selectedScenario: scenarioHook.selectedScenario,
    setPrompt: scenarioHook.setPrompt,
    setStartUrl: scenarioHook.setStartUrl,
    startUrl: scenarioHook.startUrl,

    // Stream
    setStreamLogs: lifecycleHook.setStreamLogs,
    streamLogs: lifecycleHook.streamLogs,
  };
}
