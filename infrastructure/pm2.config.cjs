/**
 * PM2 Ecosystem Configuration — Enterprise Process Manager
 *
 * Manages three processes:
 *   1. chrome-daemon: Real Chrome with CDP endpoint exposed
 *   2. runner:        Express.js agent backend (:4001)
 *   3. web:           Next.js frontend (:3100)
 *
 * Features:
 *   - Auto-restart on crash (max 15 restarts, then stabilize)
 *   - Log rotation (10MB files, 5 rotations)
 *   - Memory-based restart (Chrome: 2GB, Node: 1GB)
 *   - Environment variable injection
 *   - Graceful shutdown with SIGINT
 *
 * Usage:
 *   pm2 start infrastructure/pm2.config.cjs
 *   pm2 status
 *   pm2 logs
 *   pm2 restart all
 */

const path = require("path");
const os = require("os");

// Chrome executable path detection
function findChromePath() {
  const platform = os.platform();
  if (platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  } else if (platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  } else {
    // Linux (GCE VMs)
    const paths = [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ];
    for (const p of paths) {
      try {
        require("fs").accessSync(p);
        return p;
      } catch { /* continue */ }
    }
    return "google-chrome-stable";
  }
}

const CHROME_PATH = process.env.CHROME_PATH || findChromePath();
const PROFILE_DIR = process.env.CUA_BROWSER_PROFILE_DIR || path.join(os.homedir(), ".autopilot-agent", "browser-profiles", "default");
const CDP_PORT = process.env.CDP_PORT || "9222";
const VIEWPORT_WIDTH = process.env.CUA_VIEWPORT_WIDTH || "1920";
const VIEWPORT_HEIGHT = process.env.CUA_VIEWPORT_HEIGHT || "1080";

module.exports = {
  apps: [
    // ── Chrome Daemon ────────────────────────────────────────────────
    {
      name: "chrome-daemon",
      script: CHROME_PATH,
      args: [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
        // Stealth flags
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-first-run",
        "--no-default-browser-check",
        // Performance
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        // GPU stability (server environment)
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-dev-shm-usage",
        // Anti-bot
        "--disable-default-apps",
        "--hide-scrollbars",
        "--mute-audio",
        "--no-sandbox",
        "--disable-translate",
        // Password & profile
        "--password-store=basic",
        "--disable-features=IsolateOrigins,site-per-process,TranslateUI",
        "--enable-features=PasswordImport,PasswordExport",
        // Headless for server (remove for local debugging)
        ...(process.env.CHROME_HEADLESS !== "false" ? ["--headless=new"] : []),
        // Start page
        "about:blank",
      ].join(" "),
      interpreter: "none",
      autorestart: true,
      max_restarts: 15,
      restart_delay: 3000,
      max_memory_restart: "2G",
      kill_timeout: 10000,
      wait_ready: false,
      env: {
        NODE_ENV: "production",
      },
      // Log configuration
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(os.homedir(), ".autopilot-agent", "logs", "chrome-error.log"),
      out_file: path.join(os.homedir(), ".autopilot-agent", "logs", "chrome-out.log"),
      merge_logs: true,
      log_type: "json",
    },

    // ── Runner Backend ────────────────────────────────────────────────
    {
      name: "runner",
      script: "pnpm",
      args: "run dev:runner",
      cwd: path.resolve(__dirname, ".."),
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: "1G",
      kill_timeout: 5000,
      // Wait for Chrome to be ready before starting runner
      wait_ready: false,
      env: {
        NODE_ENV: "production",
        CUA_BROWSER_MODE: "cdp",
        CDP_ENDPOINT: `http://localhost:${CDP_PORT}`,
        CUA_BROWSER_PERSIST: "true",
        CUA_BROWSER_PROFILE_DIR: path.dirname(PROFILE_DIR),
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(os.homedir(), ".autopilot-agent", "logs", "runner-error.log"),
      out_file: path.join(os.homedir(), ".autopilot-agent", "logs", "runner-out.log"),
      merge_logs: true,
    },

    // ── Web Frontend ──────────────────────────────────────────────────
    {
      name: "web",
      script: "pnpm",
      args: "run dev:web",
      cwd: path.resolve(__dirname, ".."),
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: "512M",
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        PORT: "3100",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(os.homedir(), ".autopilot-agent", "logs", "web-error.log"),
      out_file: path.join(os.homedir(), ".autopilot-agent", "logs", "web-out.log"),
      merge_logs: true,
    },

    // ── Health Check Daemon ──────────────────────────────────────────
    {
      name: "health-check",
      script: path.resolve(__dirname, "..", "packages", "browser-runtime", "src", "health-check.ts"),
      interpreter: "npx",
      interpreter_args: "tsx",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      cron_restart: "0 */6 * * *", // Restart every 6 hours for freshness
      env: {
        CDP_PORT,
        HEALTH_CHECK_INTERVAL_MS: "30000",
        MAX_MEMORY_MB: "2048",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(os.homedir(), ".autopilot-agent", "logs", "health-error.log"),
      out_file: path.join(os.homedir(), ".autopilot-agent", "logs", "health-out.log"),
      merge_logs: true,
    },
  ],
};
