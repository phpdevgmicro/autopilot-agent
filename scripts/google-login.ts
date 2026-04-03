#!/usr/bin/env npx tsx
/**
 * Google Profile Login — Local Browser Method
 *
 * Opens a real Chrome on your local machine, lets you login to Google
 * naturally, then syncs cookies to the remote VM runner.
 *
 * Usage:
 *   npx tsx scripts/google-login.ts [runner-url]
 *
 * Examples:
 *   npx tsx scripts/google-login.ts                          # defaults to http://localhost:3100
 *   npx tsx scripts/google-login.ts https://your-vm:3100     # target a remote runner
 */

import { chromium } from "playwright";
import * as readline from "readline";

const RUNNER_URL = process.argv[2] || process.env.CUA_RUNNER_URL || "http://localhost:3100";

async function main() {
  console.log("");
  console.log("┌─────────────────────────────────────────────────┐");
  console.log("│  🔐 Google Profile Login — Local Browser Mode   │");
  console.log("├─────────────────────────────────────────────────┤");
  console.log(`│  Runner URL: ${RUNNER_URL.padEnd(34)}│`);
  console.log("│                                                 │");
  console.log("│  1. A Chrome window will open                   │");
  console.log("│  2. Login to your Google account                │");
  console.log("│  3. Come back here and press Enter              │");
  console.log("└─────────────────────────────────────────────────┘");
  console.log("");

  // Launch a real headed Chrome browser
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--window-size=1280,900",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    ...(process.env.CUA_BROWSER_CHANNEL ? { channel: process.env.CUA_BROWSER_CHANNEL as "chrome" } : {}),
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();
  await page.goto("https://accounts.google.com");

  console.log("✅ Chrome is open — login to your Google account now.");
  console.log("");
  console.log("📌 After you've logged in successfully, come back here and press ENTER.");
  console.log("");

  // Wait for user to press Enter
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question("Press ENTER when login is complete...", () => {
      rl.close();
      resolve();
    });
  });

  console.log("");
  console.log("📦 Extracting cookies...");

  // Extract all cookies from the browser
  const cookies = await context.cookies();

  // Also grab localStorage for google domains
  let localStorage: Record<string, string> = {};
  try {
    localStorage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) items[key] = window.localStorage.getItem(key) || "";
      }
      return items;
    });
  } catch {
    // localStorage access might fail on some pages
  }

  const currentUrl = page.url();
  const pageTitle = await page.title();

  console.log(`  🍪 Extracted ${cookies.length} cookies`);
  console.log(`  📄 Current page: ${pageTitle}`);
  console.log(`  🌐 URL: ${currentUrl}`);
  console.log("");

  // Close browser
  await browser.close();
  console.log("🔒 Browser closed.");
  console.log("");

  // Send cookies to runner
  console.log(`📡 Sending cookies to runner at ${RUNNER_URL}...`);
  try {
    const res = await fetch(`${RUNNER_URL}/api/browser/import-cookies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookies,
        localStorage,
        source: "local-browser",
        timestamp: new Date().toISOString(),
      }),
    });

    const data = await res.json() as { status?: string; message?: string; error?: string };
    if (res.ok) {
      console.log("");
      console.log("┌─────────────────────────────────────────────────┐");
      console.log("│  ✅ Success! Cookies synced to VM runner.       │");
      console.log("│  The agent now has your Google session.         │");
      console.log("└─────────────────────────────────────────────────┘");
      console.log("");
    } else {
      console.error("❌ Failed:", data.error || data.message || "Unknown error");
    }
  } catch (err) {
    console.error(`❌ Could not connect to runner at ${RUNNER_URL}`);
    console.error(`   Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("");
    console.error("   Make sure the runner is running and accessible.");
    console.error(`   Try: curl ${RUNNER_URL}/api/health`);
  }
}

main().catch(console.error);
