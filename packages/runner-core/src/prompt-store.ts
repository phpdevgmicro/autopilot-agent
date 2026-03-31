/**
 * Prompt Store — Fetches agent prompts from a Google Sheet via n8n webhook.
 *
 * The store syncs prompts once at agent load (startup). If the fetch fails,
 * an error is thrown and the agent refuses to start — no fallback to hardcoded
 * prompts. This ensures the operator always controls prompts from the sheet.
 *
 * Environment variable:
 *   CUA_PROMPTS_WEBHOOK_URL — The n8n webhook URL that serves prompts
 *
 * Expected response format from n8n:
 * {
 *   "prompts": {
 *     "freestyle_code_instructions": { "text": "...", "variables": "..." },
 *     "freestyle_native_instructions": { "text": "...", "variables": "..." },
 *     "walkthrough_summary_prompt": { "text": "...", "variables": "..." }
 *   },
 *   "count": 3,
 *   "fetchedAt": "2026-03-31T17:00:00.000Z"
 * }
 */

type PromptEntry = {
  text: string;
  variables: string;
  description?: string | undefined;
};

type PromptStoreData = {
  prompts: Record<string, PromptEntry>;
  count: number;
  fetchedAt: string;
};

let cachedPrompts: PromptStoreData | null = null;
let syncError: string | null = null;

function getWebhookUrl(): string {
  return process.env.CUA_PROMPTS_WEBHOOK_URL ?? "";
}

/**
 * Sync prompts from the Google Sheet via n8n webhook.
 * Must be called once at agent startup before any runs.
 * Throws if the fetch fails.
 */
export async function syncPrompts(): Promise<void> {
  const url = getWebhookUrl();

  if (!url) {
    syncError = "CUA_PROMPTS_WEBHOOK_URL is not configured in .env";
    console.error(`[prompt-store] ❌ ${syncError}`);
    throw new Error(syncError);
  }

  console.log(`[prompt-store] 🔄 Syncing prompts from: ${url}`);

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const raw = await response.text();
      let data: PromptStoreData;

      try {
        let parsed = JSON.parse(raw) as Record<string, unknown>;

        // n8n's "Respond to Webhook" node wraps output in an array: [{...}]
        // Unwrap it if it's a single-item array containing our prompts object
        if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "object") {
          parsed = parsed[0] as Record<string, unknown>;
        }

        if (parsed.prompts && typeof parsed.prompts === "object") {
          // ✅ Expected format: { prompts: { key: { text, ... } }, count, fetchedAt }
          data = parsed as unknown as PromptStoreData;
        } else if (parsed.prompt_key && parsed.prompt_text) {
          // 🔄 Single row returned directly (n8n firstEntryJson quirk)
          const prompts: Record<string, PromptEntry> = {};
          prompts[String(parsed.prompt_key)] = {
            text: String(parsed.prompt_text),
            variables: String(parsed.variables ?? ""),
            description: String(parsed.description ?? ""),
          };
          data = { prompts, count: 1, fetchedAt: new Date().toISOString() };
        } else if (Array.isArray(parsed)) {
          // 🔄 Array of rows returned (n8n allEntries mode)
          const prompts: Record<string, PromptEntry> = {};
          for (const row of parsed) {
            const r = row as Record<string, unknown>;
            if (r.prompt_key && typeof r.prompt_key === "string") {
              prompts[r.prompt_key.trim()] = {
                text: String(r.prompt_text ?? ""),
                variables: String(r.variables ?? ""),
                description: String(r.description ?? ""),
              };
            }
          }
          data = { prompts, count: Object.keys(prompts).length, fetchedAt: new Date().toISOString() };
        } else if (parsed.webhookUrl || parsed.executionMode) {
          // ⚠️ n8n returned the raw webhook echo — the workflow chain didn't execute
          // This happens intermittently when n8n's webhook registry is stale. Retry.
          console.warn(
            `[prompt-store] ⚠️ Attempt ${attempt}/${maxAttempts}: n8n returned raw webhook echo (responseMode issue). Retrying...`,
          );
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            continue;
          }
          throw new Error(
            "n8n webhook is returning raw data instead of processed prompts. " +
            "Open n8n → 'Agent Prompt Sync' workflow → Deactivate → Reactivate to fix.",
          );
        } else {
          throw new Error(
            `Unexpected response format. Keys: ${Object.keys(parsed).join(", ")}`,
          );
        }
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          throw new Error(`Invalid JSON from webhook: ${raw.slice(0, 200)}`);
        }
        throw parseErr;
      }

      const count = Object.keys(data.prompts).length;
      if (count === 0) {
        throw new Error(
          "No prompts found in the Google Sheet. Add rows with prompt_key and prompt_text columns.",
        );
      }

      cachedPrompts = data;
      syncError = null;

      console.log(
        `[prompt-store] ✅ Synced ${count} prompt(s) at ${data.fetchedAt ?? new Date().toISOString()}`,
      );

      for (const key of Object.keys(data.prompts)) {
        const textLen = data.prompts[key]?.text.length ?? 0;
        console.log(`  → ${key}: ${textLen} chars`);
      }

      return; // Success — exit the retry loop
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Unknown error fetching prompts";

      if (attempt < maxAttempts) {
        console.warn(
          `[prompt-store] ⚠️ Attempt ${attempt}/${maxAttempts} failed: ${msg}. Retrying...`,
        );
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }

      syncError = `Prompt sync failed: ${msg}`;
      cachedPrompts = null;
      console.error(`[prompt-store] ❌ ${syncError}`);
      throw new Error(syncError);
    }
  }
}

/**
 * Get the sync status.
 */
export function getPromptSyncStatus(): {
  synced: boolean;
  error: string | null;
  count: number;
  fetchedAt: string | null;
} {
  return {
    synced: cachedPrompts !== null,
    error: syncError,
    count: cachedPrompts
      ? Object.keys(cachedPrompts.prompts).length
      : 0,
    fetchedAt: cachedPrompts?.fetchedAt ?? null,
  };
}

/**
 * Get a prompt by key, with variable substitution.
 *
 * @param key — The prompt_key from the Google Sheet (e.g., "freestyle_code_instructions")
 * @param variables — Key-value map for variable substitution (e.g., { currentUrl: "https://..." })
 * @returns The prompt text with variables replaced, or null if not found
 * @throws If prompts haven't been synced yet
 */
export function getPrompt(
  key: string,
  variables?: Record<string, string>,
): string | null {
  if (!cachedPrompts) {
    throw new Error(
      `[prompt-store] Prompts not synced. Call syncPrompts() at startup. Error: ${syncError ?? "not initialized"}`,
    );
  }

  const entry = cachedPrompts.prompts[key];
  if (!entry || !entry.text) {
    return null;
  }

  let text = entry.text;

  // Replace {{variableName}} placeholders
  if (variables) {
    for (const [varName, varValue] of Object.entries(variables)) {
      text = text.replace(
        new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
        varValue,
      );
    }
  }

  return text;
}

/**
 * Check if prompts are synced. Returns true if available.
 */
export function isPromptStoreSynced(): boolean {
  return cachedPrompts !== null;
}

/**
 * Get the raw prompt data. Used for debugging or exporting.
 */
export function getAllPrompts(): Record<string, PromptEntry> | null {
  return cachedPrompts?.prompts ?? null;
}
