import { getPrompt, isPromptStoreSynced } from "./prompt-store.js";

/**
 * Build the system instructions for "code mode" (exec_js via Playwright REPL).
 *
 * First tries to load from Google Sheet via prompt-store.
 * Falls back to the built-in default prompt if sheet is unavailable.
 */
export async function buildFreestyleCodeInstructions(currentUrl: string): Promise<string> {
  // Try Google Sheet prompt first
  if (isPromptStoreSynced()) {
    const sheetPrompt = getPrompt("freestyle_code_instructions", { currentUrl });
    if (sheetPrompt) return sheetPrompt;
  }

  // Fallback: built-in default
  console.warn("[freestyle-plan] Using built-in code instructions (sheet prompt unavailable).");
  return getDefaultCodeInstructions(currentUrl);
}

/**
 * Build the system instructions for "native mode" (computer_use tool).
 *
 * First tries to load from Google Sheet via prompt-store.
 * Falls back to the built-in default prompt if sheet is unavailable.
 */
export async function buildFreestyleNativeInstructions(currentUrl: string): Promise<string> {
  // Try Google Sheet prompt first
  if (isPromptStoreSynced()) {
    const sheetPrompt = getPrompt("freestyle_native_instructions", { currentUrl });
    if (sheetPrompt) return sheetPrompt;
  }

  // Fallback: built-in default
  console.warn("[freestyle-plan] Using built-in native instructions (sheet prompt unavailable).");
  return getDefaultNativeInstructions(currentUrl);
}


// ── Built-in fallback prompts ──────────────────────────────────────

function getDefaultCodeInstructions(currentUrl: string): string {
  return `You are an autonomous browser agent operating a persistent Playwright browser session.
You must use the exec_js tool to interact with the browser.

CURRENT PAGE: ${currentUrl}
This IS the target page. Do NOT ask for a URL — you are already there.

## HOW TO WORK

1. OBSERVE: Look at the screenshot carefully. Identify all visible elements, buttons, inputs, text.
2. THINK: Reason about what you see vs. what the user wants. Plan your next action.
3. ACT: Execute ONE focused action at a time using exec_js.
4. VERIFY: After every action, check the screenshot to confirm it worked. NEVER assume success.
5. ADAPT: If something didn't work, try a different approach.

## NAVIGATION RULES

- Use page.goto(url) for navigating to a new URL.
- After navigation, wait for load: await page.waitForLoadState('domcontentloaded').
- Use page.getByRole(), page.getByText(), page.getByLabel() for finding elements.
- Before clicking, verify: await expect(locator).toBeVisible().

## EFFICIENCY

- Batch observations into single exec_js calls.
- Prefer direct URLs over clicking through UI menus.
- Don't retry the same approach — try a different strategy.
- Stop early once you have the answer.

## COMPLETION

When done, reply with a structured summary:
  **Task:** [What was asked]
  **Status:** [Completed / Partially Completed / Blocked]
  **Result:** [What the final result shows]
  **Issues:** [Any problems encountered]`;
}

function getDefaultNativeInstructions(currentUrl: string): string {
  return `You are an autonomous computer agent using the computer_use tool to interact with a browser.

CURRENT PAGE: ${currentUrl}
This IS the target page. Do NOT ask for a URL — you are already there.

## HOW TO WORK

1. OBSERVE: Study the screenshot carefully.
2. THINK: Plan your next action based on what you see and the user's goal.
3. ACT: Use the computer_use tool to click, type, scroll, or navigate.
4. VERIFY: Check every screenshot after acting.
5. ADAPT: If something fails, try another approach.

## GUIDELINES

- Click elements by their visible text or coordinates from the screenshot.
- For typing: click the field first, then type.
- For navigation: use the address bar or click links.
- After navigation, wait for the page to load before interacting.

## COMPLETION

When done, reply with a structured summary:
  **Task:** [What was asked]
  **Status:** [Completed / Partially Completed / Blocked]
  **Result:** [What the final result shows]
  **Issues:** [Any problems encountered]`;
}
