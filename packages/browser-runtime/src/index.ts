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

  // Realistic user-agent — use a RECENT Chrome version (Cloudflare flags old versions)
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

  // Browser channel: use CUA_BROWSER_CHANNEL="chrome" for native Chrome (better anti-bot, but cookies are NOT portable across OS).
  // Leave unset to use Playwright's bundled Chromium (cross-platform portable cookies).
  const browserChannel = process.env.CUA_BROWSER_CHANNEL || undefined;

  // ── Stealth Chromium flags ────────────────────────────────────────
  // These remove automation indicators that Cloudflare/bot-detection services check.
  const stealthArgs = [
    `--window-size=${viewport.width},${viewport.height}`,
    // Core stealth: remove automation-controlled signals
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    // Performance flags
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=IsolateOrigins,site-per-process",
    // GPU stability (prevent screenshot crashes)
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    // Anti-bot: mimic a real Chrome install
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",
    "--disable-extensions",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-sandbox",
    "--password-store=basic",
    "--use-mock-keychain",
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
      ...(browserChannel ? { channel: browserChannel } : {}),
    });
    page = context.pages()[0] ?? await context.newPage();
  } else {
    // Ephemeral context — clean Chromium each time (original behavior)
    browser = await chromium.launch({
      args: stealthArgs,
      headless: options.browserMode === "headless",
      ...(browserChannel ? { channel: browserChannel } : {}),
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

  // ── Comprehensive Stealth Script ──────────────────────────────────
  // Cloudflare Turnstile checks ~15 browser properties to detect bots.
  // This patches ALL of them to match a real Chrome browser.
  // NOTE: Passed as a string because this runs in the BROWSER context,
  //       not Node.js — TypeScript would error on browser-only globals.
  await context.addInitScript(`
    // 1. navigator.webdriver — the most basic check
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. window.chrome — Cloudflare checks for the chrome runtime object
    if (!window.chrome) {
      window.chrome = {
        runtime: {
          onMessage: { addListener: function(){}, removeListener: function(){} },
          sendMessage: function(){},
          connect: function(){},
        },
        csi: function(){ return {}; },
        loadTimes: function(){ return {}; },
      };
    }

    // 3. navigator.plugins — real browsers have plugins, headless has none
    Object.defineProperty(navigator, 'plugins', {
      get: function() {
        var plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        var arr = Object.create(PluginArray.prototype);
        for (var i = 0; i < plugins.length; i++) {
          var p = Object.create(Plugin.prototype);
          Object.defineProperties(p, {
            name: { value: plugins[i].name },
            filename: { value: plugins[i].filename },
            description: { value: plugins[i].description },
            length: { value: 0 },
          });
          arr[i] = p;
        }
        Object.defineProperty(arr, 'length', { value: plugins.length });
        return arr;
      },
    });

    // 4. navigator.languages — headless often has empty or wrong languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

    // 5. Permissions API — Cloudflare checks notification permission behavior
    if (navigator.permissions) {
      var origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(parameters) {
        if (parameters.name === 'notifications') {
          return Promise.resolve({
            state: Notification.permission,
            name: 'notifications',
            onchange: null,
            addEventListener: function(){},
            removeEventListener: function(){},
            dispatchEvent: function(){ return true; },
          });
        }
        return origQuery(parameters);
      };
    }

    // 6. navigator.connection — real Chrome has NetworkInformation
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g', rtt: 50, downlink: 10, saveData: false,
          onchange: null,
          addEventListener: function(){}, removeEventListener: function(){},
          dispatchEvent: function(){ return true; },
        }),
      });
    }

    // 7. navigator.hardwareConcurrency — match a real machine
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

    // 8. navigator.deviceMemory — match a real machine
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // 9. WebGL — Cloudflare checks renderer and vendor strings
    var origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 0x9245) return 'Google Inc. (NVIDIA)';
      if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return origGetParam.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      var origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 0x9245) return 'Google Inc. (NVIDIA)';
        if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return origGetParam2.call(this, param);
      };
    }

    // 10. iframe contentWindow — Cloudflare probes iframes for automation
    try {
      var origCW = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      if (origCW && origCW.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            var result = origCW.get.call(this);
            if (result) {
              try {
                Object.defineProperty(result, 'chrome', {
                  value: window.chrome, writable: false, configurable: true,
                });
              } catch(e) {}
            }
            return result;
          },
        });
      }
    } catch(e) {}
  `);

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
