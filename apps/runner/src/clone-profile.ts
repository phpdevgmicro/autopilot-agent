/**
 * Chrome Profile Cloner
 *
 * Detects installed Chrome profiles and clones them to the agent's
 * working profile directory. This copies EVERYTHING:
 *   - Cookies (SQLite DB)
 *   - localStorage / sessionStorage (LevelDB)
 *   - IndexedDB
 *   - Login Data (passwords, encrypted)
 *   - Preferences / Secure Preferences
 *   - Accounts metadata
 *
 * The clone strips caches, extensions, and lock files to keep it lean
 * and portable. Essential session data is typically ~30-50MB per profile.
 *
 * IMPORTANT: Chrome must be CLOSED before cloning. The SQLite databases
 * are locked while Chrome is running.
 */

import { readFile, readdir, mkdir, cp, rm, stat, writeFile, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────

export interface ChromeProfileInfo {
  /** Chrome internal directory name (e.g., "Default", "Profile 1") */
  directory: string;
  /** User's display name */
  displayName: string;
  /** Google email (if signed in) */
  email: string;
  /** Profile avatar/icon index */
  avatarIndex: number;
  /** Whether the profile is signed into Google */
  isSignedIn: boolean;
}

export interface CloneResult {
  success: boolean;
  profileName: string;
  targetDir: string;
  filesCopied: number;
  sizeBytes: number;
  skippedDirs: string[];
  error?: string;
}

// ── Constants ──────────────────────────────────────────────────────

/**
 * Directories to SKIP during cloning — these are caches that waste space
 * and don't contain session data. The browser regenerates them automatically.
 */
const SKIP_DIRS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "Service Worker",
  "File System",
  "blob_storage",
  "JumpListIconsMostVisited",
  "JumpListIconsRecentClosed",
  // Extension-related (not needed for session auth)
  "Extensions",
  "Extension Rules",
  "Extension Scripts",
  "Extension State",
  "Local Extension Settings",
  "Managed Extension Settings",
  "component_crx_cache",
  // Other non-essential
  "BudgetDatabase",
  "Download Service",
  "Feature Engagement Tracker",
  "GCM Store",
  "Platform Notifications",
  "Site Characteristics Database",
  "Segmentation Platform",
  "optimization_guide_model_store",
  "optimization_guide_hint_cache_store",
  "AutofillAiModelCache",
  "Collaboration",
  "DataSharing",
  "commerce_subscription_db",
  "chrome_cart_db",
  "discounts_db",
  "discount_infos_db",
]);

/**
 * Files/patterns that should be stripped (lock files, crash data, etc.)
 */
const STRIP_FILES = [
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
  "LOCK",
  ".lock",
];

// ── Chrome Detection ───────────────────────────────────────────────

/**
 * Get the Chrome User Data directory based on the OS.
 */
function getChromeUserDataDir(): string {
  const platform = process.platform;
  if (platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Google", "Chrome", "User Data");
  } else if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome");
  } else {
    // Linux
    return join(homedir(), ".config", "google-chrome");
  }
}

/**
 * Check if Chrome is currently running.
 */
export function isChromeRunning(): boolean {
  try {
    if (process.platform === "win32") {
      const result = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', {
        encoding: "utf-8",
        timeout: 5000,
      });
      return result.includes("chrome.exe");
    } else {
      const result = execSync("pgrep -x chrome || pgrep -x google-chrome || true", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return result.trim().length > 0;
    }
  } catch {
    return false;
  }
}

/**
 * List all Chrome profiles installed on the system.
 */
export async function listChromeProfiles(): Promise<ChromeProfileInfo[]> {
  const userDataDir = getChromeUserDataDir();
  const localStatePath = join(userDataDir, "Local State");

  if (!existsSync(localStatePath)) {
    console.warn(`[clone-profile] Chrome Local State not found at: ${localStatePath}`);
    return [];
  }

  try {
    const raw = await readFile(localStatePath, "utf-8");
    const localState = JSON.parse(raw);
    const profileCache = localState?.profile?.info_cache;

    if (!profileCache || typeof profileCache !== "object") {
      return [];
    }

    const profiles: ChromeProfileInfo[] = [];

    for (const [dirName, info] of Object.entries(profileCache)) {
      const profileInfo = info as Record<string, unknown>;
      profiles.push({
        directory: dirName,
        displayName: (profileInfo.gaia_name as string) || (profileInfo.name as string) || dirName,
        email: (profileInfo.user_name as string) || "",
        avatarIndex: (profileInfo.avatar_icon as number) || 0,
        isSignedIn: !!(profileInfo.user_name),
      });
    }

    return profiles.sort((a, b) => {
      // Signed-in profiles first
      if (a.isSignedIn && !b.isSignedIn) return -1;
      if (!a.isSignedIn && b.isSignedIn) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  } catch (err) {
    console.error("[clone-profile] Failed to read Chrome profiles:", err);
    return [];
  }
}

// ── Profile Cloning ────────────────────────────────────────────────

/**
 * Clone a Chrome profile to the agent's working directory.
 *
 * @param chromeProfileDir - Chrome internal directory name (e.g., "Default", "Profile 1")
 * @param targetProfileName - Name for the cloned profile (defaults to email or directory name)
 * @param agentProfileBase - Base directory for agent profiles
 */
export async function cloneChromeProfile(
  chromeProfileDir: string,
  targetProfileName?: string,
  agentProfileBase?: string,
): Promise<CloneResult> {
  const userDataDir = getChromeUserDataDir();
  const sourceDir = join(userDataDir, chromeProfileDir);
  const baseDir = agentProfileBase || process.env.CUA_BROWSER_PROFILE_DIR || join(homedir(), ".autopilot-agent", "browser-profile");

  // Determine target profile name
  let profileName = targetProfileName;
  if (!profileName) {
    // Try to read email from the source profile
    try {
      const prefsPath = join(sourceDir, "Preferences");
      if (existsSync(prefsPath)) {
        const prefs = JSON.parse(await readFile(prefsPath, "utf-8"));
        profileName = prefs?.account_info?.[0]?.email
          || prefs?.profile?.gaia_info_from_profile_key?.email
          || chromeProfileDir;
      }
    } catch {
      profileName = chromeProfileDir;
    }
  }

  const targetDir = join(baseDir, profileName!);

  console.log(`[clone-profile] 🔄 Cloning Chrome profile "${chromeProfileDir}" → "${targetDir}"`);
  console.log(`[clone-profile]    Source: ${sourceDir}`);

  // Validate source exists
  if (!existsSync(sourceDir)) {
    return {
      success: false,
      profileName: profileName!,
      targetDir,
      filesCopied: 0,
      sizeBytes: 0,
      skippedDirs: [],
      error: `Source profile directory not found: ${sourceDir}`,
    };
  }

  // Clean the target directory if it exists
  try {
    if (existsSync(targetDir)) {
      await rm(targetDir, { recursive: true, force: true });
      console.log(`[clone-profile]    Cleaned existing target directory`);
    }
    await mkdir(targetDir, { recursive: true });
  } catch (err) {
    return {
      success: false,
      profileName: profileName!,
      targetDir,
      filesCopied: 0,
      sizeBytes: 0,
      skippedDirs: [],
      error: `Failed to prepare target directory: ${err}`,
    };
  }

  // Copy profile contents, skipping large cache directories
  const skippedDirs: string[] = [];
  let filesCopied = 0;
  let totalSize = 0;

  try {
    const entries = await readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);

      // Skip cache directories
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
        skippedDirs.push(entry.name);
        continue;
      }

      // Skip lock files
      if (STRIP_FILES.includes(entry.name)) {
        continue;
      }

      try {
        if (entry.isDirectory()) {
          await cp(sourcePath, targetPath, { recursive: true, force: true });
        } else {
          await cp(sourcePath, targetPath, { force: true });
          const s = await stat(targetPath).catch(() => null);
          if (s) {
            totalSize += s.size;
            filesCopied++;
          }
        }
      } catch (err) {
        // Some files may be locked by Chrome — skip them gracefully
        console.warn(`[clone-profile]    ⚠️ Could not copy "${entry.name}": ${err}`);
      }
    }

    // Count files in copied directories
    try {
      const countResult = execSync(
        process.platform === "win32"
          ? `(Get-ChildItem -Path "${targetDir}" -Recurse -File | Measure-Object).Count`
          : `find "${targetDir}" -type f | wc -l`,
        { encoding: "utf-8", timeout: 10000, shell: process.platform === "win32" ? "powershell.exe" : undefined }
      );
      const totalFiles = parseInt(countResult.trim(), 10);
      if (!isNaN(totalFiles)) filesCopied = totalFiles;
    } catch {
      // Count is just informational
    }

    // Calculate total size
    try {
      const sizeResult = execSync(
        process.platform === "win32"
          ? `(Get-ChildItem -Path "${targetDir}" -Recurse -File | Measure-Object -Property Length -Sum).Sum`
          : `du -sb "${targetDir}" | cut -f1`,
        { encoding: "utf-8", timeout: 10000, shell: process.platform === "win32" ? "powershell.exe" : undefined }
      );
      const bytes = parseInt(sizeResult.trim(), 10);
      if (!isNaN(bytes)) totalSize = bytes;
    } catch {
      // Size is just informational
    }

    // Clean lock files in the target (they can exist inside subdirectories too)
    await cleanLockFiles(targetDir);

    // Write a marker file so we know this is a cloned profile
    await writeFile(join(targetDir, ".clone-metadata.json"), JSON.stringify({
      clonedAt: new Date().toISOString(),
      sourceProfile: chromeProfileDir,
      sourceDir,
      targetProfileName: profileName,
      platform: process.platform,
      filesCopied,
      sizeBytes: totalSize,
      skippedDirs,
    }, null, 2));

    console.log(`[clone-profile] ✅ Clone complete: ${filesCopied} files, ${Math.round(totalSize / 1024 / 1024)}MB`);
    console.log(`[clone-profile]    Skipped ${skippedDirs.length} cache directories`);

    return {
      success: true,
      profileName: profileName!,
      targetDir,
      filesCopied,
      sizeBytes: totalSize,
      skippedDirs,
    };
  } catch (err) {
    return {
      success: false,
      profileName: profileName!,
      targetDir,
      filesCopied,
      sizeBytes: totalSize,
      skippedDirs,
      error: `Clone failed: ${err}`,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Recursively remove lock files from a directory.
 */
async function cleanLockFiles(dir: string): Promise<void> {
  for (const lockName of STRIP_FILES) {
    const lockPath = join(dir, lockName);
    try {
      await unlink(lockPath);
    } catch {
      // Not present — fine
    }
  }

  // Also check common subdirectories
  const subDirs = ["Default", "Network"];
  for (const sub of subDirs) {
    const subDir = join(dir, sub);
    if (existsSync(subDir)) {
      for (const lockName of STRIP_FILES) {
        const lockPath = join(subDir, lockName);
        try {
          await unlink(lockPath);
        } catch {
          // Not present — fine
        }
      }
    }
  }
}
