"use client";

import type { ResponseTurnBudget } from "@cua-sample/replay-schema";

export const defaultRunModel =
  process.env.NEXT_PUBLIC_CUA_DEFAULT_MODEL ?? "gpt-5.4";
export const defaultMaxResponseTurns = Number(
  process.env.NEXT_PUBLIC_CUA_DEFAULT_MAX_RESPONSE_TURNS ?? "100",
) as ResponseTurnBudget;
export const appName =
  process.env.NEXT_PUBLIC_APP_NAME ?? "Agent John Wicks";
export const appSubtitle =
  process.env.NEXT_PUBLIC_APP_SUBTITLE ?? "Give a URL and instructions — the agent handles the rest.";
export const engineHelpText =
  "Native drives the browser runtime directly for clicks, drags, typing, and screenshots. Code uses a persistent Playwright REPL for scripted browser control.";
export const browserHelpText =
  "Headless runs the browser off-screen. Visible opens the browser window so you can watch the session live as it runs.";
export const turnBudgetHelpText =
  "Hard ceiling for turn budget. The agent auto-manages its turns — simple tasks use fewer, complex tasks auto-extend. This caps the maximum.";
export const verificationHelpText =
  "Runs the scenario's built-in checks after the model stops. Leave this off to treat the model's completed action loop as the success condition.";
export const runnerUnavailableHint =
  "Start `pnpm dev` or `OPENAI_API_KEY=... pnpm dev:runner`, then refresh the page.";
