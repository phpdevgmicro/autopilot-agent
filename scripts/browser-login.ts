/**
 * One-time login helper for the AutoPilot Agent browser profile.
 *
 * Opens a visible Chromium window using the agent's persistent profile.
 * Log into Google (or any service), then close the browser.
 * All future agent runs will use that login.
 *
 * Usage:  npx tsx scripts/browser-login.ts
 */

import { chromium } from "playwright";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

const profileDir = process.env.CUA_BROWSER_PROFILE_DIR
  ?? join(homedir(), ".autopilot-agent", "browser-profile");

async function main() {
  console.log("──────────────────────────────────────────────");
  console.log("  AutoPilot Agent — Browser Login Helper");
  console.log("──────────────────────────────────────────────");
  console.log(`  Profile: ${profileDir}`);
  console.log("");
  console.log("  A Chromium window will open.");
  console.log("  → Log into your Google account (or any service)");
  console.log("  → Close the browser when done");
  console.log("  → All future agent runs will use this login");
  console.log("──────────────────────────────────────────────");
  console.log("");

  await mkdir(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      "--window-size=1280,900",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://accounts.google.com");

  console.log("✅ Browser opened → Log into Google now");
  console.log("   Close the browser window when finished.\n");

  // Wait for browser to be closed by the user
  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
  });

  console.log("✅ Login saved! Future agent runs will use this profile.\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
