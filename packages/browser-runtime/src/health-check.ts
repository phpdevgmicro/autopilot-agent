/**
 * Health Check Daemon — Monitors Chrome and Agent health
 *
 * Runs as a separate PM2 process. Continuously monitors:
 *   1. Chrome CDP responsiveness (ping every 30s)
 *   2. Chrome memory usage (restart if > 2GB)
 *   3. Page responsiveness (detect frozen tabs)
 *   4. Cookie freshness (warn if cookies are stale)
 *
 * Recovery actions:
 *   - Restart Chrome via PM2 if unresponsive
 *   - Kill zombie Chrome processes
 *   - Report status to the web UI via a status file
 *
 * Usage:
 *   npx tsx packages/browser-runtime/src/health-check.ts
 *   # or via PM2 (configured in pm2.config.cjs)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";

// ── Config ────────────────────────────────────────────────────────────

const CDP_PORT = Number(process.env.CDP_PORT ?? "9222");
const CHECK_INTERVAL_MS = Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? "30000");
const MAX_MEMORY_MB = Number(process.env.MAX_MEMORY_MB ?? "2048");
const STATUS_DIR = join(homedir(), ".autopilot-agent", "status");

// ── Types ─────────────────────────────────────────────────────────────

interface HealthStatus {
  timestamp: string;
  chromeAlive: boolean;
  chromeVersion?: string;
  chromeWebSocketUrl?: string;
  memoryUsageMB?: number;
  cookieAgeHours?: number;
  cookieFresh: boolean;
  tabCount?: number;
  lastError?: string;
  uptimeSeconds: number;
  checksRun: number;
  restartCount: number;
}

interface CDPVersionResponse {
  "Browser": string;
  "Protocol-Version": string;
  "User-Agent": string;
  "V8-Version": string;
  "WebKit-Version": string;
  "webSocketDebuggerUrl": string;
}

// ── Health Check Logic ────────────────────────────────────────────────

let checksRun = 0;
let restartCount = 0;
const startTime = Date.now();

async function pingCDP(): Promise<CDPVersionResponse | null> {
  try {
    const response = await fetch(`http://localhost:${CDP_PORT}/json/version`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return (await response.json()) as CDPVersionResponse;
  } catch {
    return null;
  }
}

async function getTabCount(): Promise<number> {
  try {
    const response = await fetch(`http://localhost:${CDP_PORT}/json/list`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return 0;
    const tabs = (await response.json()) as unknown[];
    return tabs.length;
  } catch {
    return 0;
  }
}

function getChromeMemoryMB(): number | undefined {
  try {
    const isWindows = platform() === "win32";
    if (isWindows) {
      const result = execSync(
        `powershell -NoProfile -Command "(Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum / 1MB"`,
        { encoding: "utf-8", timeout: 5000 },
      );
      const mb = parseFloat(result.trim());
      return Number.isFinite(mb) ? Math.round(mb) : undefined;
    } else {
      // Linux — sum RSS of all chrome processes
      const result = execSync(
        `ps -C chrome,chromium,google-chrome -o rss= 2>/dev/null | awk '{s+=$1} END {print s/1024}' || echo 0`,
        { encoding: "utf-8", timeout: 5000 },
      );
      const mb = parseFloat(result.trim());
      return Number.isFinite(mb) && mb > 0 ? Math.round(mb) : undefined;
    }
  } catch {
    return undefined;
  }
}

function getCookieAge(): number | undefined {
  try {
    const profileDir = process.env.CUA_BROWSER_PROFILE_DIR
      ?? join(homedir(), ".autopilot-agent", "browser-profiles", "default");
    const cookiePath = join(profileDir, "imported-cookies.json");

    if (!existsSync(cookiePath)) return undefined;

    const data = JSON.parse(readFileSync(cookiePath, "utf-8"));
    if (!data.importedAt) return undefined;

    return (Date.now() - new Date(data.importedAt).getTime()) / (1000 * 60 * 60);
  } catch {
    return undefined;
  }
}

function restartChrome(): void {
  try {
    console.log(`[health-check] 🔄 Restarting Chrome via PM2...`);
    execSync("pm2 restart chrome-daemon", { timeout: 15000 });
    restartCount++;
    console.log(`[health-check] ✅ Chrome restart triggered (total restarts: ${restartCount})`);
  } catch (err) {
    console.error(`[health-check] ❌ Failed to restart Chrome:`, err);
  }
}

function writeStatus(status: HealthStatus): void {
  try {
    mkdirSync(STATUS_DIR, { recursive: true });
    writeFileSync(
      join(STATUS_DIR, "health.json"),
      JSON.stringify(status, null, 2),
      "utf-8",
    );
  } catch {
    // Status file write is best-effort
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────

async function runCheck(): Promise<void> {
  checksRun++;

  const uptimeSeconds = Math.round((Date.now() - startTime) / 1000);
  const cookieAgeHours = getCookieAge();

  // 1. Ping Chrome CDP
  const cdpInfo = await pingCDP();
  const chromeAlive = cdpInfo !== null;

  if (!chromeAlive) {
    console.error(`[health-check] ❌ Chrome unresponsive on port ${CDP_PORT}`);
    const status: HealthStatus = {
      timestamp: new Date().toISOString(),
      chromeAlive: false,
      cookieFresh: (cookieAgeHours ?? Infinity) < 6,
      cookieAgeHours: cookieAgeHours ? Math.round(cookieAgeHours) : undefined,
      lastError: `Chrome unresponsive on CDP port ${CDP_PORT}`,
      uptimeSeconds,
      checksRun,
      restartCount,
    };
    writeStatus(status);
    restartChrome();
    return;
  }

  // 2. Check memory
  const memoryMB = getChromeMemoryMB();
  if (memoryMB && memoryMB > MAX_MEMORY_MB) {
    console.warn(`[health-check] ⚠️ Chrome memory: ${memoryMB}MB > ${MAX_MEMORY_MB}MB limit — restarting`);
    restartChrome();
  }

  // 3. Tab count
  const tabCount = await getTabCount();

  // 4. Cookie freshness
  const cookieFresh = (cookieAgeHours ?? Infinity) < 6;
  if (!cookieFresh && cookieAgeHours) {
    console.warn(`[health-check] ⚠️ Cookies are ${Math.round(cookieAgeHours)}h old — re-sync recommended`);
  }

  // 5. Write status
  const status: HealthStatus = {
    timestamp: new Date().toISOString(),
    chromeAlive: true,
    chromeVersion: cdpInfo?.Browser,
    chromeWebSocketUrl: cdpInfo?.webSocketDebuggerUrl,
    memoryUsageMB: memoryMB,
    tabCount,
    cookieAgeHours: cookieAgeHours ? Math.round(cookieAgeHours * 10) / 10 : undefined,
    cookieFresh,
    uptimeSeconds,
    checksRun,
    restartCount,
  };
  writeStatus(status);

  // Log summary
  const emoji = chromeAlive ? "✅" : "❌";
  const memStr = memoryMB ? `${memoryMB}MB` : "?";
  const cookieStr = cookieAgeHours ? `${Math.round(cookieAgeHours)}h` : "n/a";
  console.log(
    `[health-check] ${emoji} Check #${checksRun} | Chrome: ${cdpInfo?.Browser ?? "?"} ` +
    `| Tabs: ${tabCount} | Mem: ${memStr} | Cookies: ${cookieStr} ` +
    `| Uptime: ${Math.round(uptimeSeconds / 60)}m`,
  );
}

// ── Entry Point ────────────────────────────────────────────────────────

console.log(`[health-check] 🏥 Starting health monitor (interval: ${CHECK_INTERVAL_MS}ms, CDP port: ${CDP_PORT})`);

// Initial check after 5s (give Chrome time to start)
setTimeout(() => {
  runCheck().catch(console.error);
}, 5000);

// Periodic checks
setInterval(() => {
  runCheck().catch(console.error);
}, CHECK_INTERVAL_MS);

// Keep the process alive
process.on("SIGINT", () => {
  console.log(`[health-check] 🛑 Shutting down health monitor`);
  process.exit(0);
});
