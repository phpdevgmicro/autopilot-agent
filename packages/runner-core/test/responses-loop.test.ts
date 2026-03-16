import { afterEach, describe, expect, it } from "vitest";

import { RunnerCoreError } from "../src/errors.js";
import {
  createDefaultResponsesClient,
  runResponsesCodeLoop,
  runResponsesNativeComputerLoop,
} from "../src/responses-loop.js";

const originalEnv = {
  CUA_RESPONSES_MODE: process.env.CUA_RESPONSES_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  VITEST: process.env.VITEST,
};

function restoreEnvVariable(name: keyof typeof originalEnv) {
  const value = originalEnv[name];

  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

afterEach(() => {
  restoreEnvVariable("CUA_RESPONSES_MODE");
  restoreEnvVariable("OPENAI_API_KEY");
  restoreEnvVariable("VITEST");
});

function createMockSession() {
  return {
    browser: {},
    context: {},
    mode: "headless" as const,
    page: {
      keyboard: {
        press: async () => undefined,
        type: async () => undefined,
      },
      mouse: {
        click: async () => undefined,
        dblclick: async () => undefined,
        down: async () => undefined,
        move: async () => undefined,
        up: async () => undefined,
        wheel: async () => undefined,
      },
      screenshot: async () => Buffer.from("png"),
      title: async () => "Mock Lab",
      url: () => "http://127.0.0.1:3102",
    },
  };
}

function createMockExecutionContext() {
  const events: Array<{ detail?: string; message: string; type: string }> = [];
  const screenshotArtifact = {
    capturedAt: new Date().toISOString(),
    id: "screenshot-1",
    label: "turn-1",
    mimeType: "image/png" as const,
    pageTitle: "Mock Lab",
    pageUrl: "http://127.0.0.1:3102",
    path: "/tmp/mock-lab.png",
    url: "/artifacts/mock-lab.png",
  };

  return {
    context: {
      captureScreenshot: async () => screenshotArtifact,
      completeRun: async () => undefined,
      detail: {
        scenario: {
          supportsCodeEdits: false,
        },
        run: {
          model: "gpt-5.4",
          prompt: "Finish the browser task and report success.",
        },
      },
      emitEvent: async (input: { detail?: string; message: string; type: string }) => {
        events.push(input);
      },
      screenshotDirectory: "/tmp",
      signal: new AbortController().signal,
      stepDelayMs: 0,
      syncBrowserState: async () => undefined,
    },
    events,
  };
}

describe("createDefaultResponsesClient", () => {
  it("returns null in test mode even when an API key exists", () => {
    process.env.CUA_RESPONSES_MODE = "auto";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.VITEST = "true";

    expect(createDefaultResponsesClient()).toBeNull();
  });

  it("throws a structured missing-api-key error when live mode is forced", () => {
    process.env.CUA_RESPONSES_MODE = "live";
    delete process.env.OPENAI_API_KEY;
    process.env.VITEST = "false";

    try {
      createDefaultResponsesClient();
      throw new Error("Expected createDefaultResponsesClient() to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerCoreError);
      expect(error).toMatchObject({
        code: "missing_api_key",
        hint: expect.stringContaining("Set OPENAI_API_KEY"),
        message: "CUA_RESPONSES_MODE=live requires OPENAI_API_KEY to be set.",
      });
    }
  });
});

describe("runResponsesCodeLoop", () => {
  it("executes the public exec_js tool path and returns the final assistant message", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      async create(request: Record<string, unknown>) {
        requests.push(request);

        if (requests.length === 1) {
          return {
            id: "resp_code_1",
            output: [
              {
                arguments: JSON.stringify({
                  code: 'console.log("Board updated.");',
                }),
                call_id: "call_exec",
                name: "exec_js",
                type: "function_call" as const,
              },
            ],
          };
        }

        return {
          id: "resp_code_2",
          output: [
            {
              content: [
                {
                  text: "Board matches the requested final state.",
                  type: "output_text",
                },
              ],
              role: "assistant",
              type: "message" as const,
            },
          ],
        };
      },
    };
    const { context, events } = createMockExecutionContext();

    const result = await runResponsesCodeLoop(
      {
        context: context as never,
        instructions: "Use exec_js to update the live board, then summarize.",
        maxResponseTurns: 8,
        session: createMockSession() as never,
      },
      client,
    );

    expect(
      (requests[0]?.tools as Array<{ name?: string }>).map((tool) => tool.name),
    ).toEqual(["exec_js"]);
    expect(result.finalAssistantMessage).toBe(
      "Board matches the requested final state.",
    );
    expect(
      events.some((event) => event.type === "function_call_completed"),
    ).toBe(true);
  });
});

describe("runResponsesNativeComputerLoop", () => {
  it("continues the native loop by returning computer_call_output to the model", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      async create(request: Record<string, unknown>) {
        requests.push(request);

        if (requests.length === 1) {
          return {
            id: "resp_native_1",
            output: [
              {
                actions: [{ type: "screenshot" }],
                call_id: "call_1",
                type: "computer_call" as const,
              },
            ],
          };
        }

        return {
          id: "resp_native_2",
          output: [
            {
              content: [
                {
                  text: "Completed the browser task.",
                  type: "output_text",
                },
              ],
              role: "assistant",
              type: "message" as const,
            },
          ],
        };
      },
    };
    const { context, events } = createMockExecutionContext();

    const result = await runResponsesNativeComputerLoop(
      {
        context: context as never,
        instructions: "Use the computer tool until the task is complete.",
        maxResponseTurns: 8,
        session: createMockSession() as never,
      },
      client,
    );

    expect(requests).toHaveLength(2);
    expect(
      (requests[0]?.tools as Array<{ name?: string; type: string }>).map((tool) =>
        tool.type === "computer" ? "computer" : tool.name,
      ),
    ).toEqual(["computer"]);
    expect(requests[1]?.previous_response_id).toBe("resp_native_1");
    expect(requests[1]?.input).toEqual([
      {
        call_id: "call_1",
        output: {
          image_url: expect.stringContaining("data:image/png;base64,"),
          type: "computer_screenshot",
        },
        type: "computer_call_output",
      },
    ]);
    expect(result.finalAssistantMessage).toBe("Completed the browser task.");
    expect(
      events.some((event) => event.type === "computer_call_output_recorded"),
    ).toBe(true);
  });

  it("throws a stable error when the API asks for a safety acknowledgement", async () => {
    const client = {
      async create() {
        return {
          id: "resp_safety",
          output: [
            {
              actions: [{ type: "screenshot" }],
              call_id: "call_safety",
              pending_safety_checks: [
                {
                  code: "requires_ack",
                  message: "Approve the action before continuing.",
                },
              ],
              type: "computer_call" as const,
            },
          ],
        };
      },
    };
    const { context } = createMockExecutionContext();

    await expect(
      runResponsesNativeComputerLoop(
        {
          context: context as never,
          instructions: "Use the computer tool until the task is complete.",
          maxResponseTurns: 4,
          session: createMockSession() as never,
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "unsupported_safety_acknowledgement",
      hint: expect.stringContaining("does not implement operator approval"),
      message: expect.stringContaining("Pending computer use safety checks"),
      name: "RunnerCoreError",
    });
  });
});
