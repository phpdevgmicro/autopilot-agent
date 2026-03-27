"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  runDetailSchema,
  runEventSchema,
  scenarioWorkspaceStateSchema,
  startRunResponseSchema,
  type RunDetail,
  type RunEvent,
  type ScenarioManifest,
  type ScenarioWorkspaceState,
} from "@cua-sample/replay-schema";

import {
  createManualLog,
  createManualTranscript,
  createRunnerIssue,
  createRunnerUnavailableIssue,
  defaultRunModel,
  deriveRunFailureIssue,
  formatRunnerIssueMessage,
  parseRunnerIssue,
} from "./helpers";
import type { LogEntry, PendingAction, RunnerIssue, TranscriptEntry } from "./types";

const emptyScreenshots: NonNullable<RunDetail["browser"]>["screenshots"] = [];

class RunnerApiError extends Error {
  readonly issue: RunnerIssue;
  readonly status: number;

  constructor(issue: RunnerIssue, status: number) {
    super(issue.error);
    this.name = "RunnerApiError";
    this.issue = issue;
    this.status = status;
  }
}

function createFallbackIssue(message: string, hint?: string) {
  return createRunnerIssue("runner_request_failed", message, hint);
}

function toRunnerIssue(
  error: unknown,
  fallbackMessage: string,
  fallbackHint?: string,
) {
  if (error instanceof RunnerApiError) return error.issue;
  if (error instanceof Error)
    return createFallbackIssue(error.message, fallbackHint);
  return createFallbackIssue(fallbackMessage, fallbackHint);
}

export type UseRunLifecycleOptions = {
  runnerBaseUrl: string;
  runnerOnline: boolean;
  selectedScenario: ScenarioManifest | null;
  prompt: string;
  startUrl: string;
  initialRunnerIssue: RunnerIssue | null;
};

export function useRunLifecycle({
  runnerBaseUrl,
  runnerOnline,
  selectedScenario,
  prompt,
  startUrl,
  initialRunnerIssue,
}: UseRunLifecycleOptions) {
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [workspaceState, setWorkspaceState] =
    useState<ScenarioWorkspaceState | null>(null);
  const [manualLogs, setManualLogs] = useState<LogEntry[]>([]);
  const [manualTranscript, setManualTranscript] = useState<TranscriptEntry[]>([]);
  const [actionIssue, setActionIssue] = useState<RunnerIssue | null>(null);
  const [streamLogs, setStreamLogs] = useState(true);

  const eventSourceRef = useRef<EventSource | null>(null);

  const selectedRun =
    activeRun && selectedScenario && activeRun.run.scenarioId === selectedScenario.id
      ? activeRun
      : null;
  const selectedBrowser = selectedRun?.browser ?? null;
  const screenshots = selectedBrowser?.screenshots ?? emptyScreenshots;
  const controlsLocked = selectedRun?.run.status === "running";
  const matchingWorkspaceState =
    workspaceState && workspaceState.scenarioId === selectedScenario?.id
      ? workspaceState
      : null;
  const runIssue = deriveRunFailureIssue(selectedRun);
  const currentIssue = runIssue ?? actionIssue ?? initialRunnerIssue;

  function appendManualLog(entry: LogEntry) {
    setManualLogs((current) => [...current.slice(-5), entry]);
  }

  function appendManualTranscript(entry: TranscriptEntry) {
    setManualTranscript((current) => [...current.slice(-3), entry]);
  }

  function closeEventStream() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  async function requestJson<T>(
    url: string,
    parser: { parse: (value: unknown) => T },
    init: RequestInit | undefined,
    fallbackIssue: RunnerIssue,
  ) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new RunnerApiError(
        createRunnerUnavailableIssue(
          error instanceof Error ? error.message : undefined,
        ),
        0,
      );
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new RunnerApiError(
        parseRunnerIssue(payload) ?? fallbackIssue,
        response.status,
      );
    }
    return parser.parse(await response.json());
  }

  const fetchRunDetail = useCallback(
    async (runId: string) =>
      requestJson(
        `${runnerBaseUrl}/api/runs/${runId}`,
        runDetailSchema,
        undefined,
        createFallbackIssue(
          `Run detail request failed for ${runId}.`,
          "Refresh the page or start a new run.",
        ),
      ),
    [runnerBaseUrl],
  );

  const refreshRunDetail = useCallback(
    (runId: string) => {
      void fetchRunDetail(runId)
        .then((detail) => {
          setActiveRun(detail);
          setRunEvents(detail.events);
        })
        .catch(() => undefined);
    },
    [fetchRunDetail],
  );

  // Cleanup on unmount
  useEffect(() => () => closeEventStream(), []);

  // SSE stream
  useEffect(() => {
    if (!selectedRun || selectedRun.run.status !== "running" || !streamLogs) {
      closeEventStream();
      return;
    }

    const source = new EventSource(
      `${runnerBaseUrl}${selectedRun.eventStreamUrl}`,
    );
    eventSourceRef.current = source;

    source.onmessage = (messageEvent) => {
      try {
        const event = runEventSchema.parse(JSON.parse(messageEvent.data));

        setRunEvents((current) =>
          current.some((existing) => existing.id === event.id)
            ? current
            : [...current, event],
        );

        if (
          event.type === "browser_session_started" ||
          event.type === "browser_navigated" ||
          event.type === "screenshot_captured"
        ) {
          refreshRunDetail(event.runId);
        }

        if (
          event.type === "run_completed" ||
          event.type === "run_failed" ||
          event.type === "run_cancelled"
        ) {
          void fetchRunDetail(event.runId)
            .then((detail) => {
              setActiveRun(detail);
              setRunEvents(detail.events);
            })
            .catch(() => undefined)
            .finally(() => {
              if (eventSourceRef.current === source) {
                source.close();
                eventSourceRef.current = null;
              }
            });
        }
      } catch {
        appendManualLog(
          createManualLog(
            "event.stream.parse_error",
            "Runner emitted an invalid SSE payload.",
            "error",
          ),
        );
      }
    };

    source.onerror = () => {
      if (eventSourceRef.current === source) {
        source.close();
        eventSourceRef.current = null;
      }
    };

    return () => {
      if (eventSourceRef.current === source) {
        source.close();
        eventSourceRef.current = null;
      }
    };
  }, [fetchRunDetail, refreshRunDetail, runnerBaseUrl, selectedRun, streamLogs]);

  const handleScenarioChange = (scenarioId: string, nextScenario: ScenarioManifest | null) => {
    setManualLogs([]);
    setManualTranscript([]);
    setWorkspaceState(null);
    setActionIssue(null);

    if (!nextScenario) return;
    if (!selectedRun || selectedRun.run.status !== "running") {
      setActiveRun(null);
      setRunEvents([]);
    }
  };

  const handleOpenReplay = () => {
    if (!selectedRun) {
      appendManualLog(
        createManualLog(
          "replay.unavailable",
          "No run has been started for the selected scenario yet.",
          "warn",
        ),
      );
      return;
    }
    window.open(`${runnerBaseUrl}${selectedRun.replayUrl}`, "_blank");
  };

  const handleStartRun = async () => {
    if (!runnerOnline || !selectedScenario || prompt.trim().length === 0) return;

    setPendingAction("start");
    setManualLogs([]);
    setManualTranscript([]);
    setRunEvents([]);
    setActionIssue(null);
    closeEventStream();

    try {
      const started = await requestJson(
        `${runnerBaseUrl}/api/runs`,
        startRunResponseSchema,
        {
          body: JSON.stringify({
            model: defaultRunModel,
            prompt,
            scenarioId: selectedScenario.id,
            startUrl: startUrl.trim() || undefined,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
        createFallbackIssue(
          "Run start failed.",
          "Check the runner logs and confirm the scenario request is valid.",
        ),
      );
      const detail = await fetchRunDetail(started.runId);
      setActiveRun(detail);
      setRunEvents(detail.events);
      setWorkspaceState(null);
      appendManualTranscript(
        createManualTranscript(
          "control",
          "operator",
          `Run ${started.runId} started for ${selectedScenario.title}.`,
        ),
      );
    } catch (error) {
      const issue = toRunnerIssue(
        error,
        "Failed to start run.",
        "Check the runner and scenario configuration, then try again.",
      );
      setActionIssue(issue);
      appendManualLog(
        createManualLog("run.start_failed", formatRunnerIssueMessage(issue), "error"),
      );
      appendManualTranscript(
        createManualTranscript("control", "runner", formatRunnerIssueMessage(issue)),
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleStopRun = async () => {
    if (!selectedRun) return;
    setPendingAction("stop");

    try {
      const detail = await requestJson(
        `${runnerBaseUrl}/api/runs/${selectedRun.run.id}/stop`,
        runDetailSchema,
        { method: "POST" },
        createFallbackIssue(
          "Run stop failed.",
          "Refresh the run detail and try stopping the run again.",
        ),
      );
      setActiveRun(detail);
      setRunEvents(detail.events);
      setActionIssue(null);
      appendManualTranscript(
        createManualTranscript(
          "control",
          "operator",
          `Run ${detail.run.id} stopped by operator request.`,
        ),
      );
    } catch (error) {
      const issue = toRunnerIssue(
        error,
        "Failed to stop run.",
        "Refresh the run detail and try stopping the run again.",
      );
      setActionIssue(issue);
      appendManualLog(
        createManualLog("run.stop_failed", formatRunnerIssueMessage(issue), "error"),
      );
    } finally {
      closeEventStream();
      setPendingAction(null);
    }
  };

  const handleResetWorkspace = async () => {
    if (!runnerOnline || !selectedScenario) return;
    setPendingAction("reset");

    try {
      const state = await requestJson(
        `${runnerBaseUrl}/api/scenarios/${selectedScenario.id}/reset`,
        scenarioWorkspaceStateSchema,
        { method: "POST" },
        createFallbackIssue(
          "Workspace reset failed.",
          "Check the runner logs and try the reset again.",
        ),
      );

      setWorkspaceState(state);
      setActionIssue(null);
      appendManualLog(
        createManualLog(
          "scenario.workspace.reset",
          `Workspace reset at ${state.workspacePath}`,
          "ok",
        ),
      );
      appendManualTranscript(
        createManualTranscript(
          "control",
          "runner",
          `Scenario workspace reset to template baseline at ${state.workspacePath}.`,
        ),
      );

      if (state.cancelledRunId) {
        const cancelledDetail = await fetchRunDetail(state.cancelledRunId);
        setActiveRun(cancelledDetail);
        setRunEvents(cancelledDetail.events);
      } else if (!selectedRun || selectedRun.run.status !== "running") {
        setActiveRun(null);
        setRunEvents([]);
        setManualLogs([]);
        setManualTranscript([]);
      }
    } catch (error) {
      const issue = toRunnerIssue(
        error,
        "Failed to reset workspace.",
        "Check the runner logs and try the reset again.",
      );
      setActionIssue(issue);
      appendManualLog(
        createManualLog(
          "scenario.reset_failed",
          formatRunnerIssueMessage(issue),
          "error",
        ),
      );
    } finally {
      closeEventStream();
      setPendingAction(null);
    }
  };

  return {
    controlsLocked,
    currentIssue,
    handleOpenReplay,
    handleResetWorkspace,
    handleScenarioChange,
    handleStartRun,
    handleStopRun,
    manualLogs,
    manualTranscript,
    matchingWorkspaceState,
    pendingAction,
    runEvents,
    screenshots,
    selectedBrowser,
    selectedRun,
    setStreamLogs,
    streamLogs,
  };
}
