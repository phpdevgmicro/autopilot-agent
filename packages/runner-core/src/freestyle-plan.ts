import { getPrompt, isPromptStoreSynced } from "./prompt-store.js";

/**
 * Build the system instructions for the browser agent.
 *
 * Both "code" and "native" modes use the same prompt from the Google Sheet.
 * No hardcoded fallbacks — the Sheet is the single source of truth.
 *
 * @throws If prompts haven't been synced from the Google Sheet
 */
export async function buildFreestyleCodeInstructions(currentUrl: string): Promise<string> {
  if (!isPromptStoreSynced()) {
    throw new Error(
      "[freestyle-plan] Prompt sync required. The agent cannot start without prompts from the Google Sheet. " +
      "Ensure CUA_PROMPTS_WEBHOOK_URL is set and the n8n 'Agent Prompt Sync' workflow is active."
    );
  }

  const sheetPrompt = getPrompt("freestyle_code_instructions", { currentUrl });
  if (!sheetPrompt) {
    throw new Error(
      "[freestyle-plan] Missing 'freestyle_code_instructions' prompt in Google Sheet. " +
      "Add the code prompt to the 'Code Prompt' tab."
    );
  }

  return sheetPrompt;
}

/**
 * Build the system instructions for "native mode" (computer_use tool).
 *
 * Uses the SAME prompt as code mode from the Google Sheet.
 * This ensures consistent agent behavior across both execution modes.
 */
export async function buildFreestyleNativeInstructions(currentUrl: string): Promise<string> {
  return buildFreestyleCodeInstructions(currentUrl);
}
