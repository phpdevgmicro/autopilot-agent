import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { type BrowserMode, type BrowserViewport, type StartTarget } from "@cua-sample/replay-schema";

export const defaultViewport: BrowserViewport = {
  height: Number(process.env.CUA_VIEWPORT_HEIGHT ?? "900"),
  width: Number(process.env.CUA_VIEWPORT_WIDTH ?? "1440"),
};

/**
 * Persistent profile directory for the agent browser.
 * Login to Google once → stays logged in for all future runs.
 * Override with CUA_BROWSER_PROFILE_DIR env var.
 */
const defaultProfileDir = join(homedir(), ".autopilot-agent", "browser-profile");

export type BrowserStartTarget = {
  targetLabel: string;
  url: string;
};

export type BrowserSessionState = {
  currentUrl: string;
  pageTitle?: string;
};

export type BrowserScreenshot = BrowserSessionState & {
  capturedAt: string;
  id: string;
  label: string;
  mimeType: "image/png";
  path: string;
};

export type BrowserSession = {
  browser: Browser | null;
  captureScreenshot: (label: string) => Promise<BrowserScreenshot>;
  close: () => Promise<void>;
  context: BrowserContext;
  mode: BrowserMode;
  page: Page;
  readState: () => Promise<BrowserSessionState>;
  targetLabel: string;
  viewport: BrowserViewport;
};

type LaunchBrowserSessionOptions = {
  browserMode: BrowserMode;
  now?: () => Date;
  screenshotDir: string;
  startTarget: StartTarget;
  workspacePath: string;
};

function sanitizeLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "capture";
}

export function resolveBrowserStartTarget(
  startTarget: StartTarget,
  workspacePath: string,
): BrowserStartTarget {
  if (startTarget.kind === "remote_url") {
    return {
      targetLabel: startTarget.label ?? startTarget.url,
      url: startTarget.url,
    };
  }

  const absolutePath = join(workspacePath, startTarget.path);

  return {
    targetLabel: startTarget.label ?? startTarget.path,
    url: pathToFileURL(absolutePath).href,
  };
}

export async function launchBrowserSession(
  options: LaunchBrowserSessionOptions,
): Promise<BrowserSession> {
  const now = options.now ?? (() => new Date());
  const viewport = defaultViewport;
  const resolvedTarget = resolveBrowserStartTarget(
    options.startTarget,
    options.workspacePath,
  );

  const profileDir = process.env.CUA_BROWSER_PROFILE_DIR ?? defaultProfileDir;
  const usePersistentProfile = process.env.CUA_BROWSER_PERSIST !== "false";
  const locale = process.env.CUA_BROWSER_LOCALE ?? "en-US";

  // Download directory — inside the workspace so agent can reference downloaded files
  const downloadDir = join(options.workspacePath, "downloads");
  await mkdir(downloadDir, { recursive: true });

  // Realistic user-agent to avoid bot detection (Google /sorry/index, etc.)
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  // Common Chromium flags for anti-bot stealth + GPU stability
  const stealthArgs = [
    `--window-size=${viewport.width},${viewport.height}`,
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=IsolateOrigins,site-per-process",
    // Prevent GPU process crashes which cause "Protocol error (Page.captureScreenshot)"
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
  ];

  let browser: Browser | null = null;
  let context: BrowserContext;
  let page: Page;

  if (usePersistentProfile) {
    // Persistent context — keeps cookies, login, profile data across runs
    await mkdir(profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(profileDir, {
      args: stealthArgs,
      headless: options.browserMode === "headless",
      viewport,
      locale,
      userAgent,
      ignoreDefaultArgs: ["--enable-automation"],
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
      channel: "chrome",
    });
    page = context.pages()[0] ?? await context.newPage();
  } else {
    // Ephemeral context — clean Chromium each time (original behavior)
    browser = await chromium.launch({
      args: stealthArgs,
      headless: options.browserMode === "headless",
      channel: "chrome",
    });
    context = await browser.newContext({
      viewport,
      locale,
      userAgent,
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    page = await context.newPage();
  }

  // Remove navigator.webdriver flag to avoid bot detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  let screenshotCount = 0;

  await page.goto(resolvedTarget.url, {
    waitUntil: "load",
  });

  return {
    browser,
    async captureScreenshot(label) {
      screenshotCount += 1;
      await mkdir(options.screenshotDir, { recursive: true });

      const path = join(
        options.screenshotDir,
        `${String(screenshotCount).padStart(3, "0")}-${sanitizeLabel(label)}.png`,
      );
      // Retry screenshot up to 3 times — Chromium GPU process can crash transiently
      let lastScreenshotError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await page.screenshot({ path });
          lastScreenshotError = null;
          break;
        } catch (err) {
          lastScreenshotError = err;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
      if (lastScreenshotError) {
        throw lastScreenshotError;
      }

      let pageTitle = "";
      try {
        pageTitle = await page.title();
      } catch {
        // page.title() may throw if a navigation destroyed the execution context
      }

      return {
        capturedAt: now().toISOString(),
        currentUrl: page.url(),
        id: `screenshot-${screenshotCount}`,
        label,
        mimeType: "image/png",
        path,
        ...(pageTitle ? { pageTitle } : {}),
      };
    },
    async close() {
      await context.close();
      if (browser) {
        await browser.close();
      }
    },
    context,
    mode: options.browserMode,
    page,
    async readState() {
      let pageTitle = "";
      try {
        pageTitle = await page.title();
      } catch {
        // page.title() may throw if a navigation destroyed the execution context
      }

      return {
        currentUrl: page.url(),
        ...(pageTitle ? { pageTitle } : {}),
      };
    },
    targetLabel: resolvedTarget.targetLabel,
    viewport,
  };
}
