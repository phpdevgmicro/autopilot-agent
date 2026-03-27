"use client";

import { useCallback, useEffect, useState } from "react";

import {
  scenariosResponseSchema,
  type ExecutionMode,
  type ScenarioManifest,
} from "@cua-sample/replay-schema";

import { defaultMaxResponseTurns } from "./constants";
import type { RunnerIssue } from "./issues";

export type UseScenariosOptions = {
  initialRunnerIssue: RunnerIssue | null;
  runnerBaseUrl: string;
  scenarios: ScenarioManifest[];
};

export function useScenarios({
  initialRunnerIssue,
  runnerBaseUrl,
  scenarios: initialScenarios,
}: UseScenariosOptions) {
  const [liveScenarios, setLiveScenarios] =
    useState<ScenarioManifest[]>(initialScenarios);
  const [liveRunnerIssue, setLiveRunnerIssue] =
    useState<RunnerIssue | null>(initialRunnerIssue);

  const scenarios = liveScenarios;
  const initialScenario = scenarios[0] ?? null;

  const [selectedScenarioId, setSelectedScenarioId] = useState(
    initialScenario?.id ?? "",
  );
  const [mode, setMode] = useState<ExecutionMode>(
    initialScenario?.defaultMode ?? "code",
  );
  const [prompt, setPrompt] = useState("");
  const [startUrl, setStartUrl] = useState("");

  const runnerOnline = !liveRunnerIssue && scenarios.length > 0;

  const selectedScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? initialScenario;

  // Health poll: retry fetching scenarios when the runner is offline
  useEffect(() => {
    if (runnerOnline) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${runnerBaseUrl}/api/scenarios`);
        if (!response.ok) return;

        const data = scenariosResponseSchema.parse(await response.json());
        if (data.length > 0) {
          setLiveScenarios(data);
          setLiveRunnerIssue(null);
          const first = data[0];
          if (first) {
            setSelectedScenarioId(first.id);
            setMode(first.defaultMode);
          }
        }
      } catch {
        // Runner still not available
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [runnerOnline, runnerBaseUrl]);

  const selectScenario = useCallback(
    (scenarioId: string) => {
      const next = scenarios.find((s) => s.id === scenarioId) ?? null;
      setSelectedScenarioId(scenarioId);
      if (next) {
        setMode(next.defaultMode);
        setPrompt(next.defaultPrompt);
      }
    },
    [scenarios],
  );

  return {
    defaultMaxResponseTurns,
    mode,
    prompt,
    runnerOnline,
    scenarios,
    selectScenario,
    selectedScenario,
    selectedScenarioId,
    setMode,
    setPrompt,
    setStartUrl,
    startUrl,
  };
}
