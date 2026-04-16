/**
 * Real Chrome Detection & CDP Connection
 *
 * Detects the system-installed Chrome, lists available profiles,
 * and launches + connects via CDP. This gives the agent a REAL
 * browser identity (cookies, passwords, extensions, fingerprint)
 * instead of Playwright's Chromium fork.
 *
 * Pattern inspired by browser-use's `Browser.from_system_chrome()`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { BrowserViewport } from "@cua-sample/replay-schema";

// ── Types ────────────────────────────────────────────────────────────

export interface SystemChromeInfo {
  executablePath: string;
  userDataDir: string;
}

export interface ChromeProfile {
  directory: string;
  name: string;
  email?: string;
}

export interface RealChromeSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  chromeProcess: ChildProcess | null;
  mode: "real-chrome";
}

// ── Chrome Detection ─────────────────────────────────────────────────

const WINDOWS_CHROME_PATHS = [
  join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
  join(homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
];

const LINUX_CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];

const MACOS_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * Auto-detect the system-installed Chrome executable and user data directory.
 * Throws if Chrome is not found.
 */
export function detectSystemChrome(): SystemChromeInfo {
  const os = platform();

  let candidatePaths: string[];
  let userDataDir: string;

  if (os === "win32") {
    candidatePaths = WINDOWS_CHROME_PATHS;
    userDataDir = join(homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
  } else if (os === "darwin") {
    candidatePaths = MACOS_CHROME_PATHS;
    userDataDir = join(homedir(), "Library", "Application Support", "Google", "Chrome");
  } else {
    candidatePaths = LINUX_CHROME_PATHS;
    // Try google-chrome first, then chromium
    userDataDir = existsSync(join(homedir(), ".config", "google-chrome"))
      ? join(homedir(), ".config", "google-chrome")
      : join(homedir(), ".config", "chromium");
  }

  const executablePath = candidatePaths.find(p => existsSync(p));
  if (!executablePath) {
    throw new Error(
      `[real-chrome] Chrome not found. Searched:\n${candidatePaths.map(p => `  - ${p}`).join("\n")}\n` +
      `Install Google Chrome or set CUA_CHROME_EXECUTABLE env var.`
    );
  }

  // Allow env override
  const finalExe = process.env.CUA_CHROME_EXECUTABLE || executablePath;
  const finalDataDir = process.env.CUA_CHROME_USER_DATA_DIR || userDataDir;

  console.log(`[real-chrome] 🔍 Detected Chrome: ${finalExe}`);
  console.log(`[real-chrome] 📂 User data dir: ${finalDataDir}`);

  return { executablePath: finalExe, userDataDir: finalDataDir };
}

// ── Profile Listing ──────────────────────────────────────────────────

/**
 * List all Chrome profiles by parsing Chrome's "Local State" JSON.
 * Returns profile directory names and human-readable names.
 */
export function listChromeProfiles(userDataDir?: string): ChromeProfile[] {
  const dataDir = userDataDir || detectSystemChrome().userDataDir;
  const localStatePath = join(dataDir, "Local State");

  try {
    const data = JSON.parse(readFileSync(localStatePath, "utf-8"));
    const infoCache = data?.profile?.info_cache;
    if (!infoCache || typeof infoCache !== "object") {
      return [{ directory: "Default", name: "Default" }];
    }

    return Object.entries(infoCache).map(([dir, info]: [string, unknown]) => {
      const profileInfo = info as Record<string, unknown>;
      const profile: ChromeProfile = {
        directory: dir,
        name: (profileInfo.name as string) || dir,
      };
      const email = profileInfo.user_name as string | undefined;
      if (email) profile.email = email;
      return profile;
    });
  } catch {
    // No Local State file — return default
    return [{ directory: "Default", name: "Default" }];
  }
}

// ── Chrome Launch + CDP Connect ──────────────────────────────────────

/**
 * Launch real Chrome with remote debugging and connect Playwright via CDP.
 *
 * If Chrome is already running on the debug port, connects to it directly
 * without spawning a new process.
 */
export async function launchRealChrome(opts: {
  profileDirectory?: string;
  viewport: BrowserViewport;
  headless?: boolean;
  debugPort?: number;
}): Promise<RealChromeSession> {
  const debugPort = opts.debugPort || Number(process.env.CUA_CHROME_DEBUG_PORT ?? "9222");
  const chrome = detectSystemChrome();
  const profileDir = opts.profileDirectory || process.env.CUA_CHROME_PROFILE || "Default";

  let chromeProcess: ChildProcess | null = null;

  // Check if Chrome is already running on the debug port
  const cdpUrl = `http://127.0.0.1:${debugPort}`;
  let alreadyRunning = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${cdpUrl}/json/version`, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      alreadyRunning = true;
      const info = await resp.json() as Record<string, string>;
      console.log(`[real-chrome] 🔌 Chrome already running on :${debugPort} (${info["Browser"] || "unknown version"})`);
    }
  } catch {
    // Not running — we'll launch it
  }

  if (!alreadyRunning) {
    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${chrome.userDataDir}`,
      `--profile-directory=${profileDir}`,
      `--window-size=${opts.viewport.width},${opts.viewport.height}`,
      // Anti-detection: remove automation signals
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--disable-translate",
      // Performance
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      // Suppress popups
      "--disable-default-apps",
      "--password-store=basic",
    ];

    if (opts.headless) {
      args.push("--headless=new");
    }

    console.log(`[real-chrome] 🚀 Launching Chrome (profile: ${profileDir})...`);
    chromeProcess = spawn(chrome.executablePath, args, {
      detached: true,
      stdio: "ignore",
    });
    chromeProcess.unref();

    // Wait for Chrome to be ready (up to 15s)
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);
        const resp = await fetch(`${cdpUrl}/json/version`, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          ready = true;
          break;
        }
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!ready) {
      chromeProcess.kill();
      throw new Error(`[real-chrome] Chrome failed to start on port ${debugPort} within 15s`);
    }

    console.log(`[real-chrome] ✅ Chrome is ready on :${debugPort}`);
  }

  // Connect Playwright via CDP
  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  const context = contexts[0];

  if (!context) {
    throw new Error("[real-chrome] No browser context available after CDP connection");
  }

  // Get existing page or create new one
  const pages = context.pages();
  const existingPage = pages.length > 0 ? pages[0] : undefined;
  const page = existingPage ?? await context.newPage();

  console.log(`[real-chrome] 🔗 Connected via CDP — ${pages.length} existing tab(s)`);

  return {
    browser,
    context,
    page,
    chromeProcess,
    mode: "real-chrome",
  };
}
