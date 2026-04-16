/**
 * Storage State Persistence
 *
 * Replaces the fragile imported-cookies.json hack with Playwright's
 * native storageState API. Captures cookies + localStorage + origins
 * in a portable JSON that works across browsers and machines.
 *
 * Auto-saves on shutdown, auto-loads on startup.
 * Supports local ↔ VM transfer via export/import.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext } from "playwright";

// ── Types ────────────────────────────────────────────────────────────

export interface StorageStateInfo {
  path: string;
  exists: boolean;
  ageHours?: number;
  cookieCount?: number;
  originCount?: number;
}

// ── Constants ────────────────────────────────────────────────────────

const STORAGE_STATE_FILE = "storage-state.json";
const STALE_THRESHOLD_HOURS = 168; // 7 days
const WARNING_THRESHOLD_HOURS = 48; // 2 days

// ── Save ─────────────────────────────────────────────────────────────

/**
 * Save the current browser context's storage state to disk.
 * Captures cookies, localStorage, and origin data.
 */
export async function saveStorageState(
  context: BrowserContext,
  profileDir: string,
): Promise<string> {
  await mkdir(profileDir, { recursive: true });
  const statePath = join(profileDir, STORAGE_STATE_FILE);

  try {
    const state = await context.storageState();

    // Add metadata for freshness tracking
    const stateWithMeta = {
      ...state,
      _meta: {
        savedAt: new Date().toISOString(),
        cookieCount: state.cookies.length,
        originCount: state.origins.length,
        googleCookies: state.cookies.filter(c => c.domain.includes("google")).length,
      },
    };

    await writeFile(statePath, JSON.stringify(stateWithMeta, null, 2), "utf-8");

    console.log(
      `[storage-state] 💾 Saved: ${state.cookies.length} cookies, ` +
      `${state.origins.length} origins ` +
      `(${stateWithMeta._meta.googleCookies} Google)`
    );

    return statePath;
  } catch (err) {
    console.warn(`[storage-state] ⚠️ Failed to save:`, err);
    throw err;
  }
}

// ── Load ─────────────────────────────────────────────────────────────

/**
 * Check if a storage state file exists and return info about it.
 * Returns the path if it exists and is not stale.
 */
export async function getStorageStateInfo(profileDir: string): Promise<StorageStateInfo> {
  const statePath = join(profileDir, STORAGE_STATE_FILE);

  if (!existsSync(statePath)) {
    return { path: statePath, exists: false };
  }

  try {
    const fileStat = await stat(statePath);
    const ageHours = (Date.now() - fileStat.mtimeMs) / (1000 * 60 * 60);

    // Parse to get cookie/origin counts
    const raw = await readFile(statePath, "utf-8");
    const state = JSON.parse(raw);
    const cookieCount = state.cookies?.length ?? 0;
    const originCount = state.origins?.length ?? 0;

    if (ageHours > STALE_THRESHOLD_HOURS) {
      console.warn(
        `[storage-state] ⚠️ State is ${Math.round(ageHours)}h old (>${STALE_THRESHOLD_HOURS}h) — ` +
        `Google may require re-authentication. Consider re-exporting.`
      );
    } else if (ageHours > WARNING_THRESHOLD_HOURS) {
      console.warn(
        `[storage-state] ⏱️ State is ${Math.round(ageHours)}h old — still valid but refresh soon.`
      );
    }

    return {
      path: statePath,
      exists: true,
      ageHours: Math.round(ageHours * 10) / 10,
      cookieCount,
      originCount,
    };
  } catch (err) {
    console.warn(`[storage-state] ⚠️ Failed to read state info:`, err);
    return { path: statePath, exists: false };
  }
}

/**
 * Load storage state path if it exists and is valid.
 * Returns the path to pass to Playwright's storageState option,
 * or undefined if no valid state exists.
 */
export async function loadStorageStatePath(profileDir: string): Promise<string | undefined> {
  const info = await getStorageStateInfo(profileDir);

  if (!info.exists) {
    console.log(`[storage-state] ℹ️ No saved state found at ${info.path}`);
    return undefined;
  }

  console.log(
    `[storage-state] 📂 Loading state: ${info.cookieCount} cookies, ` +
    `${info.originCount} origins (${info.ageHours}h old)`
  );

  return info.path;
}

// ── Export/Import for Local ↔ VM Transfer ─────────────────────────────

/**
 * Export storage state as a self-contained JSON string.
 * Used for transferring sessions between machines (local → VM).
 */
export async function exportStorageStateContent(
  context: BrowserContext,
): Promise<string> {
  const state = await context.storageState();
  return JSON.stringify({
    ...state,
    _meta: {
      exportedAt: new Date().toISOString(),
      cookieCount: state.cookies.length,
      originCount: state.origins.length,
    },
  }, null, 2);
}

/**
 * Import storage state from a JSON string.
 * Saves to the profile directory for subsequent auto-load.
 */
export async function importStorageState(
  profileDir: string,
  stateJson: string,
): Promise<string> {
  await mkdir(profileDir, { recursive: true });
  const statePath = join(profileDir, STORAGE_STATE_FILE);

  // Validate JSON structure
  const parsed = JSON.parse(stateJson);
  if (!Array.isArray(parsed.cookies)) {
    throw new Error("[storage-state] Invalid state: missing 'cookies' array");
  }

  // Add import metadata
  parsed._meta = {
    ...parsed._meta,
    importedAt: new Date().toISOString(),
  };

  await writeFile(statePath, JSON.stringify(parsed, null, 2), "utf-8");

  console.log(
    `[storage-state] 📥 Imported: ${parsed.cookies.length} cookies, ` +
    `${parsed.origins?.length ?? 0} origins`
  );

  return statePath;
}
