import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScenarioManifest } from "@cua-sample/replay-schema";

import { createRunnerUnavailableIssue } from "./helpers";
import { OperatorConsole } from "./OperatorConsole";

const scenario: ScenarioManifest = {
  category: "general",
  defaultMode: "native",
  defaultPrompt:
    "Navigate to the target URL and describe what you see on the page.",
  description:
    "Give the agent any URL and free-text instructions. It autonomously navigates, interacts, and completes the task on any website.",
  id: "freestyle-browser-agent",
  labId: "freestyle",
  startTarget: {
    kind: "remote_url",
    label: "user-specified target URL",
    url: "about:blank",
  },
  supportsCodeEdits: false,
  tags: ["hero", "general"],
  title: "Autonomous Agent",
  verification: [],
  workspaceTemplatePath: "/tmp/freestyle-lab-template",
};

class MockEventSource {
  close() {}

  onerror: ((event: Event) => void) | null = null;

  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(url: string) {
    void url;
  }
}

describe("OperatorConsole", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("explains how to recover when the runner is offline", () => {
    render(
      <OperatorConsole
        initialRunnerIssue={createRunnerUnavailableIssue("Connection refused")}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[]}
      />,
    );

    expect(screen.getByText("Runner unavailable")).toBeTruthy();
    expect(
      screen.getAllByText(
        /The operator console could not reach the runner\. Connection refused/,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /Start `pnpm dev` or `OPENAI_API_KEY=... pnpm dev:runner`/,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Runner Offline")).toBeTruthy();
  });

  it("surfaces structured runner guidance when a run cannot start", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue({
      json: async () => ({
        code: "missing_api_key",
        error: "OPENAI_API_KEY is not configured in the runner.",
        hint: "Set OPENAI_API_KEY and restart the runner.",
      }),
      ok: false,
      status: 400,
    } as Response);

    render(
      <OperatorConsole
        initialRunnerIssue={null}
        runnerBaseUrl="http://127.0.0.1:4001"
        scenarios={[scenario]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Run" }));

    await waitFor(() => {
      expect(screen.getByText("Runner missing API key")).toBeTruthy();
    });
    expect(
      screen.getAllByText(
        /OPENAI_API_KEY is not configured in the runner\. Set OPENAI_API_KEY and restart the runner\./,
      ).length,
    ).toBeGreaterThan(0);
  });
});
