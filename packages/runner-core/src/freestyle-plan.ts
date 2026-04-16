import { getPrompt, isPromptStoreSynced } from "./prompt-store.js";

/**
 * Build the system instructions for the browser agent.
 *
 * Both "code" and "native" modes use the same prompt from the Google Sheet.
 * No hardcoded fallbacks — the Sheet is the single source of truth.
 *
 * @throws If prompts haven't been synced from the Google Sheet
 */
export async function buildFreestyleCodeInstructions(currentUrl: string): Promise<string | null> {
  if (!isPromptStoreSynced()) {
    console.log(`[freestyle-plan] ℹ️ Prompt store not synced — using built-in instructions`);
    return null;
  }

  // Auto-inject all available context variables.
  // The Sheet author can use any of these with {{variableName}} syntax.
  // Variables not used in the template are silently ignored.
  const contextVariables: Record<string, string> = {
    currentUrl,
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Agent",
    browserMode: process.env.CUA_BROWSER_MODE ?? "headless",
    executionMode: process.env.CUA_EXECUTION_MODE ?? "code",
    model: process.env.CUA_DEFAULT_MODEL!,
    maxTurns: `dynamic (ceiling: ${process.env.CUA_MAX_RESPONSE_TURNS ?? "100"})`,
    timestamp: new Date().toISOString(),
  };

  const sheetPrompt = getPrompt("freestyle_code_instructions", contextVariables);
  if (!sheetPrompt) {
    throw new Error(
      "[freestyle-plan] Missing 'freestyle_code_instructions' prompt in Google Sheet. " +
      "Add the code prompt to the 'Code Prompt' tab."
    );
  }

  // Always append runtime context so the agent knows where it is,
  // even if the Sheet prompt doesn't include {{currentUrl}}
  const runtimeContext = [
    "",
    "--- RUNTIME CONTEXT (auto-injected) ---",
    `Current URL: ${currentUrl}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Mode: ${process.env.CUA_EXECUTION_MODE ?? "code"}`,
    `Turn budget: dynamic (hard ceiling: ${process.env.CUA_MAX_RESPONSE_TURNS ?? "100"})`,
  ].join("\n");

  const agentLabel = process.env.NEXT_PUBLIC_APP_NAME ?? "Agent";
  console.log(`  🎯 ${agentLabel} — Mission briefing loaded`);
  console.log(`     📍 Target: ${currentUrl}`);
  console.log(`     ⚙️  Mode: ${process.env.CUA_EXECUTION_MODE ?? "code"} | Turns: dynamic (ceiling: ${process.env.CUA_MAX_RESPONSE_TURNS ?? "100"})`);
  console.log(`     📝 Instructions: ${sheetPrompt.length} chars from Sheet`);
  console.log(``);

  return sheetPrompt + runtimeContext;
}

/**
 * Build the system instructions for "native mode" (computer_use tool).
 *
 * Uses the SAME prompt as code mode from the Google Sheet.
 * This ensures consistent agent behavior across both execution modes.
 */
export async function buildFreestyleNativeInstructions(currentUrl: string): Promise<string | null> {
  return buildFreestyleCodeInstructions(currentUrl);
}
