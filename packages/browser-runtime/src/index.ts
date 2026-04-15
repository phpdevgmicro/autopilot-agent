import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import path from "node:path";
import { homedir, platform } from "node:os";
import { pathToFileURL } from "node:url";

import { loadCredentials, upsertCredential } from "./credential-vault.js";

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
  browserProfile?: string;
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

/**
 * Clean stale Chrome lock files and kill orphaned processes for a profile dir.
 * Chrome enforces single-instance per --user-data-dir. If a previous session
 * crashed or wasn't cleanly closed, lock files remain and block future launches
 * with exit code 21. This function cleans those locks proactively.
 */
function cleanProfileLocks(profileDir: string): void {
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  for (const lockFile of lockFiles) {
    const lockPath = join(profileDir, lockFile);
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
        console.log(`[browser-runtime] 🧹 Removed stale lock: ${lockFile}`);
      }
    } catch {
      // Lock file may be held by OS — ignore, launch will handle it
    }
  }

  // Kill any orphaned Chrome processes using this specific profile directory
  try {
    const isWindows = platform() === "win32";
    if (isWindows) {
      // PowerShell approach: find Chrome PIDs with matching --user-data-dir
      // (WMIC is deprecated on Windows 11+)
      const profileDirNormalized = profileDir.replace(/\//g, "\\");
      const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='chrome.exe'\\" | Select-Object ProcessId,CommandLine | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"`;
      const result = execSync(psCmd, { encoding: "utf-8", timeout: 10000 });
      const lines = result.split("\n").filter(l => l.includes(profileDirNormalized));
      for (const line of lines) {
        const pid = line.trim().split("|")[0]?.trim();
        if (pid && /^\d+$/.test(pid)) {
          try {
            execSync(`taskkill /PID ${pid} /F`, { timeout: 3000 });
            console.log(`[browser-runtime] 🧹 Killed orphaned chrome PID ${pid}`);
          } catch {
            // Process may already be gone
          }
        }
      }
    } else {
      // macOS/Linux: use pgrep + grep
      try {
        const result = execSync(
          `pgrep -f "${profileDir}" || true`,
          { encoding: "utf-8", timeout: 5000 }
        );
        const pids = result.trim().split("\n").filter(p => /^\d+$/.test(p.trim()));
        for (const pid of pids) {
          try {
            execSync(`kill -9 ${pid.trim()}`, { timeout: 3000 });
            console.log(`[browser-runtime] 🧹 Killed orphaned chrome PID ${pid.trim()}`);
          } catch {
            // Process may already be gone
          }
        }
      } catch {
        // pgrep not available or no matches
      }
    }
  } catch {
    // Non-critical — launch will fail with a clear error if profile is still locked
  }
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

  const baseProfileDir = process.env.CUA_BROWSER_PROFILE_DIR ?? defaultProfileDir;
  const profileDir = join(baseProfileDir, options.browserProfile || "default");
  
  console.log(`[browser-runtime] 🔑 browserProfile option: "${options.browserProfile || "(none)"}"`);
  console.log(`[browser-runtime] 📂 Resolved profile dir: ${profileDir}`);
  
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
  // Split into shared (always) and mode-specific (persistent vs ephemeral).
  const sharedStealthArgs = [
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
    // GPU stability (prevent screenshot crashes)
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    // Anti-bot basics
    "--disable-default-apps",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-sandbox",
    // Suppress popups that obstruct the agent (NOT password bubble — that's mode-specific)
    "--disable-translate",
  ];

  // Persistent profile: Google profile is the single source of truth for passwords.
  // Chrome's native password manager + Google Sync handles save/fill automatically.
  // The encrypted vault (credential-vault.ts) is a fallback for non-Google setups.
  const persistentArgs = [
    ...sharedStealthArgs,
    "--disable-component-extensions-with-background-pages",
    // NO --disable-extensions: allow Chrome's built-in password manager extension
    // NO --password-store=basic: let Chrome use the real OS credential store
    // NO --use-mock-keychain: let Chrome use the real keychain
    // NO --disable-save-password-bubble: let Chrome offer to save passwords
    "--disable-features=IsolateOrigins,site-per-process,TranslateUI",
    // Enable sync-related features for Google password sync
    "--enable-features=PasswordImport,PasswordExport",
  ];

  // Ephemeral profile: full lockdown — no extensions, no password store, no sync
  const ephemeralArgs = [
    ...sharedStealthArgs,
    "--disable-save-password-bubble",
    "--disable-component-extensions-with-background-pages",
    "--disable-extensions",
    "--password-store=basic",
    "--use-mock-keychain",
    "--disable-features=IsolateOrigins,site-per-process,TranslateUI,PasswordManager",
  ];

  let browser: Browser | null = null;
  let context!: BrowserContext;
  let page!: Page;

  if (usePersistentProfile) {
    // Persistent context — keeps cookies, login, profile data across runs
    await mkdir(profileDir, { recursive: true });

    // ── Chrome Password Manager & Google Sync Preferences ────────────
    // Configure Chrome to use Google's password manager as the single source
    // of truth. When logged into Google, passwords sync automatically.
    // Chrome silently auto-saves new passwords without showing a bubble.
    const prefsDir = path.join(profileDir, "Default");
    const prefsPath = path.join(prefsDir, "Preferences");
    try {
      await mkdir(prefsDir, { recursive: true });
      let prefs: Record<string, unknown> = {};
      try {
        const existing = await readFile(prefsPath, "utf-8");
        prefs = JSON.parse(existing);
      } catch {
        // No existing prefs file — start fresh
      }

      // ── Password Manager: enable everything ──
      const profile = (prefs["profile"] as Record<string, unknown>) ?? {};
      profile["password_manager_enabled"] = true;
      prefs["profile"] = profile;
      prefs["credentials_enable_service"] = true;
      prefs["credentials_enable_autofill"] = true;

      const passwordManager = (prefs["password_manager"] as Record<string, unknown>) ?? {};
      passwordManager["saving_enabled"] = true;
      // Auto-sign-in: skip the "Choose an account" prompt on sites with saved creds
      passwordManager["auto_signin_enabled"] = true;
      prefs["password_manager"] = passwordManager;

      // ── Autofill: enable form autofill ──
      const autofill = (prefs["autofill"] as Record<string, unknown>) ?? {};
      autofill["enabled"] = true;
      autofill["profile_enabled"] = true;
      prefs["autofill"] = autofill;

      // ── Google Sync: enable password sync when signed into Google ──
      // This makes the Google account the single source of truth.
      // Passwords saved in Chrome sync to Google Password Manager.
      const syncPrefs = (prefs["sync"] as Record<string, unknown>) ?? {};
      syncPrefs["requested"] = true;
      syncPrefs["keep_everything_synced"] = false;
      // Only sync passwords and autofill — don't pollute with bookmarks etc.
      const selectedTypes = (syncPrefs["selected_types"] as Record<string, unknown>) ?? {};
      selectedTypes["passwords"] = true;
      selectedTypes["autofill"] = true;
      selectedTypes["preferences"] = true;
      selectedTypes["bookmarks"] = false;
      selectedTypes["extensions"] = false;
      selectedTypes["apps"] = false;
      selectedTypes["themes"] = false;
      selectedTypes["typed_urls"] = false;
      syncPrefs["selected_types"] = selectedTypes;
      prefs["sync"] = syncPrefs;

      // ── Suppress noisy Chrome prompts ──
      prefs["browser"] = {
        ...(prefs["browser"] as Record<string, unknown> ?? {}),
        default_browser_infobar_last_declined: new Date().toISOString(),
        check_default_browser: false,
      };

      await writeFile(prefsPath, JSON.stringify(prefs, null, 2), "utf-8");
      console.log(`[browser-runtime] 🔑 Chrome password manager & Google Sync preferences configured`);
    } catch {
      // Non-critical — agent works without prefs, just won't auto-save via Google
    }

    // ── Launch with auto-recovery from profile lock (exit code 21) ────
    // Chrome enforces single-instance per --user-data-dir. If a previous
    // session crashed, lock files persist and block the launch. We clean
    // those proactively and retry if the first attempt fails.
    const MAX_LAUNCH_ATTEMPTS = 3;
    let lastLaunchError: unknown;

    for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
      // Clean stale locks before each attempt
      cleanProfileLocks(profileDir);

      try {
        context = await chromium.launchPersistentContext(profileDir, {
          args: persistentArgs,
          headless: options.browserMode === "headless",
          viewport,
          locale,
          userAgent,
          ignoreDefaultArgs: ["--enable-automation"],
          acceptDownloads: true,
          permissions: ["clipboard-read", "clipboard-write"],
          ...(browserChannel ? { channel: browserChannel } : {}),
        });
        lastLaunchError = null;
        break; // Success
      } catch (err) {
        lastLaunchError = err;
        const errMsg = String(err);
        const isProfileLocked = errMsg.includes("exitCode=21") || errMsg.includes("Target page, context or browser has been closed");

        if (isProfileLocked && attempt < MAX_LAUNCH_ATTEMPTS) {
          console.log(`[browser-runtime] ⚠️ Profile locked (attempt ${attempt}/${MAX_LAUNCH_ATTEMPTS}), cleaning and retrying in 2s...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }
    if (lastLaunchError) throw lastLaunchError;

    page = context.pages()[0] ?? await context.newPage();
  } else {
    // Ephemeral context — clean Chromium each time (original behavior)
    browser = await chromium.launch({
      args: ephemeralArgs,
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

  // ── Cookie Popup Auto-Dismiss ─────────────────────────────────────
  // Automatically detects and dismisses cookie consent banners so the
  // agent never wastes turns clicking "Accept All" buttons.
  // Uses a MutationObserver to catch dynamically injected banners.
  await context.addInitScript(`
    (function() {
      // Common "Accept" button text patterns (case-insensitive)
      var acceptPatterns = [
        /^accept\\s*(all|cookies)?$/i,
        /^allow\\s*(all|cookies)?$/i,
        /^agree/i,
        /^got\\s*it/i,
        /^ok$/i,
        /^i\\s*agree/i,
        /^continue$/i,
        /^consent$/i,
        /^acknowledge/i,
      ];

      // Common selectors for cookie banners
      var bannerSelectors = [
        '[id*="cookie" i][id*="banner" i]',
        '[id*="cookie" i][id*="consent" i]',
        '[id*="cookie" i][id*="notice" i]',
        '[id*="cookie" i][id*="popup" i]',
        '[id*="cookie" i][id*="bar" i]',
        '[id*="gdpr" i]',
        '[class*="cookie-banner" i]',
        '[class*="cookie-consent" i]',
        '[class*="cookie-notice" i]',
        '[class*="consent-banner" i]',
        '[class*="CookieConsent" i]',
        '#onetrust-banner-sdk',
        '#CybotCookiebotDialog',
        '.cc-banner',
        '.cc-window',
        '#truste-consent-track',
        '[aria-label*="cookie" i]',
        '[data-testid*="cookie" i]',
      ];

      function tryDismiss() {
        // Strategy 1: Click known accept buttons
        var buttons = document.querySelectorAll('button, a[role="button"], [type="submit"], [class*="accept" i], [class*="agree" i], [id*="accept" i]');
        for (var i = 0; i < buttons.length; i++) {
          var btn = buttons[i];
          var text = (btn.innerText || btn.textContent || '').trim();
          if (text.length > 0 && text.length < 30) {
            for (var j = 0; j < acceptPatterns.length; j++) {
              if (acceptPatterns[j].test(text)) {
                // Check if button is visible
                var rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  btn.click();
                  return true;
                }
              }
            }
          }
        }

        // Strategy 2: Remove known banner elements
        for (var k = 0; k < bannerSelectors.length; k++) {
          var banner = document.querySelector(bannerSelectors[k]);
          if (banner) {
            var bRect = banner.getBoundingClientRect();
            // Only remove if it's a significant overlay (not a tiny element)
            if (bRect.height > 50) {
              banner.remove();
              // Also remove any overlay backdrop
              var overlays = document.querySelectorAll('[class*="overlay" i][class*="cookie" i], [class*="backdrop" i][class*="cookie" i]');
              overlays.forEach(function(o) { o.remove(); });
              return true;
            }
          }
        }
        return false;
      }

      // Run after page loads
      function scheduleCheck() {
        setTimeout(function() { tryDismiss(); }, 1000);
        setTimeout(function() { tryDismiss(); }, 2500);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleCheck);
      } else {
        scheduleCheck();
      }

      // Watch for dynamically injected banners (common with consent managers)
      try {
        var observer = new MutationObserver(function(mutations) {
          for (var m = 0; m < mutations.length; m++) {
            var added = mutations[m].addedNodes;
            for (var n = 0; n < added.length; n++) {
              var node = added[n];
              if (node.nodeType === 1) {
                var id = (node.id || '').toLowerCase();
                var cls = (node.className || '').toString().toLowerCase();
                if (id.includes('cookie') || id.includes('consent') || id.includes('gdpr') ||
                    cls.includes('cookie') || cls.includes('consent') || cls.includes('gdpr')) {
                  setTimeout(function() { tryDismiss(); }, 500);
                  return;
                }
              }
            }
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        // Stop watching after 10 seconds to avoid performance impact
        setTimeout(function() { observer.disconnect(); }, 10000);
      } catch(e) {}
    })();
  `);

  // ── Credential System (Google-first, vault fallback) ──────────────
  // PRIMARY: Chrome's native password manager (Google Sync) handles
  //          save/fill automatically when the user is signed into Google.
  //          This is the "single source of truth" — like Google Save Password.
  //
  // FALLBACK: If Chrome native didn't auto-fill (no Google profile, or Chromium
  //           without sync), the encrypted vault kicks in as a safety net.
  //           The vault uses AES-256-GCM encryption (see credential-vault.ts).
  if (usePersistentProfile) {
    // Load vault credentials as a fallback for sites Chrome didn't auto-fill.
    // This covers: Chromium (no Google Sync), first-time logins, edge cases.
    const vaultCredentials = await loadCredentials(profileDir);

    if (vaultCredentials.length > 0) {
      console.log(`[browser-runtime] 🔐 Vault fallback: ${vaultCredentials.length} credential(s) available`);

      // Inject fallback auto-fill — only fills if Chrome's native autofill hasn't already
      const credMap = JSON.stringify(
        vaultCredentials.map(c => ({
          d: c.domain,
          u: c.username,
          p: c.password,
        }))
      );

      await context.addInitScript(`
        (function() {
          var creds = ${credMap};
          var hostname = window.location.hostname;

          // Find matching credential for current domain
          var match = null;
          for (var i = 0; i < creds.length; i++) {
            if (hostname.includes(creds[i].d) || hostname === creds[i].d) {
              match = creds[i];
              break;
            }
          }
          if (!match) return;

          function tryAutoFill() {
            var userField = document.querySelector(
              'input[type="email"], input[name*="email" i], input[name*="user" i], ' +
              'input[name*="login" i], input[id*="email" i], input[id*="user" i], ' +
              'input[autocomplete="email"], input[autocomplete="username"]'
            );
            var passField = document.querySelector(
              'input[type="password"], input[name*="pass" i], input[id*="pass" i]'
            );

            if (userField && passField) {
              // SKIP if Chrome's native autofill already filled the fields
              if (userField.value && passField.value) {
                console.log('[autofill] ⏭️ Chrome native already filled — skipping vault fallback');
                return true;
              }

              // Vault fallback: fill using native setter for React/Vue compatibility
              var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              ).set;

              if (!userField.value) {
                nativeInputValueSetter.call(userField, match.u);
                userField.dispatchEvent(new Event('input', { bubbles: true }));
                userField.dispatchEvent(new Event('change', { bubbles: true }));
              }

              if (!passField.value) {
                nativeInputValueSetter.call(passField, match.p);
                passField.dispatchEvent(new Event('input', { bubbles: true }));
                passField.dispatchEvent(new Event('change', { bubbles: true }));
              }

              console.log('[autofill] 🔐 Vault fallback filled credentials for ' + hostname);
              return true;
            }
            return false;
          }

          // Delay vault fallback to give Chrome's native autofill time to act first
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
              setTimeout(tryAutoFill, 1500);
              setTimeout(tryAutoFill, 3000);
            });
          } else {
            setTimeout(tryAutoFill, 1000);
            setTimeout(tryAutoFill, 2500);
          }
        })();
      `);
    }

    // Expose save_credentials as a vault fallback for the agent.
    // Primary: Chrome saves to Google Password Manager automatically.
    // Fallback: Agent can explicitly save to the encrypted vault.
    context.exposeFunction("__saveCredentials", async (domain: string, username: string, password: string) => {
      return upsertCredential(profileDir, domain, username, password);
    });
  }

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
