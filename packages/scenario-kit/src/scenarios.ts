import { fileURLToPath } from "node:url";

import {
  scenarioManifestSchema,
  type ScenarioCategory,
  type ScenarioManifest,
} from "@cua-sample/replay-schema";

import { freestyleDefaultPrompt } from "./freestyle.js";

const templatePath = (labDirectory: string) =>
  fileURLToPath(new URL(`../../../labs/${labDirectory}`, import.meta.url));

const scenarioCatalog = scenarioManifestSchema.array().parse([
  {
    id: "freestyle-browser-agent",
    labId: "freestyle",
    category: "general",
    title: "Autonomous Agent",
    description:
      "Give the agent any URL and free-text instructions. It autonomously navigates, interacts, and completes the task on any website.",
    defaultPrompt: freestyleDefaultPrompt,
    workspaceTemplatePath: templatePath("freestyle-lab-template"),
    startTarget: {
      kind: "remote_url",
      label: "user-specified target URL",
      url: "about:blank",
    },
    defaultMode: "native",
    supportsCodeEdits: false,
    verification: [],
    tags: ["hero", "general"],
  },
]);

export const heroScenarioIds = scenarioCatalog
  .filter((scenario) => scenario.tags.includes("hero"))
  .map((scenario) => scenario.id);

export function listScenarios(): ScenarioManifest[] {
  return scenarioCatalog.map((scenario) => ({
    ...scenario,
    verification: scenario.verification.map((check) => ({ ...check })),
    tags: [...scenario.tags],
  }));
}

export function getScenarioById(id: string): ScenarioManifest | undefined {
  return listScenarios().find((scenario) => scenario.id === id);
}

export function getScenarioCategories(): ScenarioCategory[] {
  const categories = new Set<ScenarioCategory>();

  for (const scenario of listScenarios()) {
    categories.add(scenario.category);
  }

  return [...categories];
}


