#!/usr/bin/env npx tsx
/**
 * Google Profile Login — PERSISTENT Profile Method
 *
 * Opens a real Chrome window using the EXACT SAME persistent profile
 * directory that the agent uses. You log in once → cookies are saved
 * directly in the profile → the agent loads them on next launch.
 *
 * This avoids cookie portability issues that occur when copying cookies
 * between browser instances (Google invalidates transferred cookies).
 *
 * Usage:
 *   npx tsx scripts/google-login-persistent.ts [profile-name]
 *
 * Examples:
 *   npx tsx scripts/google-login-persistent.ts phpdevgmicro@gmail.com
 *   npx tsx scripts/google-login-persistent.ts                          # uses "default"
 */

import { chromium } from "playwright";
import * as readline from "readline";
import { join } from "path";
import { homedir } from "os";

const profileName = process.argv[2] || "default";
const baseDir = process.env.CUA_BROWSER_PROFILE_DIR || join(homedir(), ".autopilot-agent", "browser-profile");
const profileDir = join(baseDir, profileName);
const browserChannel = process.env.CUA_BROWSER_CHANNEL || undefined;

async function main() {
  console.log("");
  console.log("┌─────────────────────────────────────────────────────┐");
  console.log("│  🔐 Google Login — Direct Persistent Profile Mode   │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Profile: ${profileName.padEnd(41)}│`);
  console.log(`│  Dir:     ${profileDir.slice(0, 41).padEnd(41)}│`);
  console.log(`│  Channel: ${(browserChannel || "chromium (default)").padEnd(41)}│`);
  console.log("│                                                     │");
  console.log("│  1. Chrome opens with the agent's profile           │");
  console.log("│  2. Log into your Google account normally           │");
  console.log("│  3. Verify you're logged in (check Gmail, etc.)     │");
  console.log("│  4. Come back here and press Enter                  │");
  console.log("│                                                     │");
  console.log("│  ⚡ Cookies are saved DIRECTLY — no transfer needed │");
  console.log("└─────────────────────────────────────────────────────┘");
  console.log("");

  // Launch persistent context — same profile dir as the agent
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      "--window-size=1280,900",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { width: 1280, height: 900 },
    ...(browserChannel ? { channel: browserChannel } : {}),
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://accounts.google.com");

  console.log("✅ Chrome is open with the agent's profile.");
  console.log("");
  console.log("📌 Log into your Google account in the Chrome window.");
  console.log("   After login, navigate to https://myaccount.google.com");
  console.log("   to confirm you see your account info (not 'Sign in').");
  console.log("");

  // Wait for user to press Enter
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question("Press ENTER when login is complete...", () => {
      rl.close();
      resolve();
    });
  });

  // Verify by checking cookies
  const cookies = await context.cookies(["https://accounts.google.com", "https://www.google.com"]);
  const authCookies = cookies.filter(c =>
    ["SID", "HSID", "SSID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PSIDCC"].includes(c.name)
  );

  const pageTitle = await page.title().catch(() => "unknown");
  const pageUrl = page.url();

  console.log("");
  console.log(`  📄 Current page: ${pageTitle}`);
  console.log(`  🌐 URL: ${pageUrl}`);
  console.log(`  🍪 Total cookies: ${cookies.length}`);
  console.log(`  🔐 Auth cookies found: ${authCookies.length}`);
  authCookies.forEach(c => console.log(`     ✓ ${c.name} (${c.domain})`));
  console.log("");

  // Close context — cookies are automatically saved to the profile dir
  await context.close();

  if (authCookies.length >= 3) {
    console.log("┌─────────────────────────────────────────────────────┐");
    console.log("│  ✅ Login successful! Profile saved.                │");
    console.log("│                                                     │");
    console.log("│  Cookies are stored directly in the agent's profile │");
    console.log("│  directory. Next time the agent launches, it will   │");
    console.log("│  use this authenticated session automatically.      │");
    console.log("│                                                     │");
    console.log("│  Just start the app and send a task!                │");
    console.log("└─────────────────────────────────────────────────────┘");
  } else {
    console.log("┌─────────────────────────────────────────────────────┐");
    console.log("│  ⚠️  Warning: Few auth cookies found.               │");
    console.log("│  Make sure you completed the login process fully.  │");
    console.log("│  Run this script again if needed.                  │");
    console.log("└─────────────────────────────────────────────────────┘");
  }
  console.log("");
}

main().catch(console.error);
