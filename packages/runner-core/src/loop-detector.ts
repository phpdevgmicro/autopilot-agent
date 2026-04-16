/**
 * Loop Detector — Ported from browser-use's agent loop detection
 *
 * Detects when the agent is stuck in repetitive patterns:
 * - Same action repeated 3+ times
 * - Same page state (screenshot hash) 3+ times
 * - A-B-A-B alternating loops
 * - Same URL visited 4+ times with no progress
 *
 * When stuck, provides recovery hints to inject into the conversation.
 */

import * as crypto from "crypto";

// ── Types ────────────────────────────────────────────────────────────

export interface LoopState {
  stuck: boolean;
  reason?: string;
  recoveryHint?: string;
  stuckCount: number;
}

interface ActionRecord {
  action: string;
  url: string;
  timestamp: number;
}

// ── Loop Detector ────────────────────────────────────────────────────

export class LoopDetector {
  private actionHistory: ActionRecord[] = [];
  private screenshotHashes: string[] = [];
  private urlVisits: Map<string, number> = new Map();
  private stuckCount = 0;
  private readonly windowSize: number;

  constructor(windowSize = 20) {
    this.windowSize = windowSize;
  }

  /**
   * Record an action the agent just performed.
   */
  recordAction(action: string, url: string): void {
    this.actionHistory.push({
      action,
      url,
      timestamp: Date.now(),
    });

    // Track URL visits
    const host = this.extractHost(url);
    this.urlVisits.set(host, (this.urlVisits.get(host) ?? 0) + 1);

    // Keep history bounded
    if (this.actionHistory.length > this.windowSize * 2) {
      this.actionHistory = this.actionHistory.slice(-this.windowSize);
    }
  }

  /**
   * Record a screenshot hash for page-state comparison.
   * Uses a fast hash of the base64 screenshot data.
   */
  recordScreenshot(screenshotBase64: string): void {
    const hash = crypto
      .createHash("md5")
      .update(screenshotBase64.slice(0, 5000)) // Hash first 5KB for speed
      .digest("hex");

    this.screenshotHashes.push(hash);

    if (this.screenshotHashes.length > this.windowSize) {
      this.screenshotHashes = this.screenshotHashes.slice(-this.windowSize);
    }
  }

  /**
   * Check if the agent appears stuck in a loop.
   */
  isStuck(): LoopState {
    // Pattern 1: Same action repeated 3+ times in a row
    const lastActions = this.getLastNActions(3);
    if (lastActions.length === 3 && lastActions.every((a) => a === lastActions[0])) {
      this.stuckCount++;
      return {
        stuck: true,
        reason: `Repeated action "${lastActions[0]!.slice(0, 60)}" 3 times in a row`,
        recoveryHint: this.getRecoveryHint("repeated_action"),
        stuckCount: this.stuckCount,
      };
    }

    // Pattern 2: Same screenshot hash 3+ times (page not changing)
    const lastHashes = this.screenshotHashes.slice(-3);
    if (
      lastHashes.length === 3 &&
      lastHashes.every((h) => h === lastHashes[0])
    ) {
      this.stuckCount++;
      return {
        stuck: true,
        reason: "Page appears unchanged for 3 consecutive turns",
        recoveryHint: this.getRecoveryHint("unchanged_page"),
        stuckCount: this.stuckCount,
      };
    }

    // Pattern 3: A-B-A-B alternation (two-state loop)
    const last4Actions = this.getLastNActions(4);
    if (
      last4Actions.length === 4 &&
      last4Actions[0] === last4Actions[2] &&
      last4Actions[1] === last4Actions[3] &&
      last4Actions[0] !== last4Actions[1]
    ) {
      this.stuckCount++;
      return {
        stuck: true,
        reason: `Alternating between "${last4Actions[0]!.slice(0, 40)}" and "${last4Actions[1]!.slice(0, 40)}"`,
        recoveryHint: this.getRecoveryHint("alternating"),
        stuckCount: this.stuckCount,
      };
    }

    // Pattern 4: Clicking the same coordinates 3+ times
    const lastCoordActions = this.actionHistory.slice(-3);
    if (lastCoordActions.length === 3) {
      const allSameCoords = lastCoordActions.every((a) => {
        const coordMatch = a.action.match(/click.*\((\d+),\s*(\d+)\)/);
        const firstMatch = lastCoordActions[0]!.action.match(/click.*\((\d+),\s*(\d+)\)/);
        return coordMatch && firstMatch && coordMatch[1] === firstMatch[1] && coordMatch[2] === firstMatch[2];
      });
      if (allSameCoords) {
        this.stuckCount++;
        return {
          stuck: true,
          reason: "Clicking the same coordinates 3 times — the click may not be working",
          recoveryHint: this.getRecoveryHint("same_coords"),
          stuckCount: this.stuckCount,
        };
      }
    }

    // Not stuck
    return { stuck: false, stuckCount: this.stuckCount };
  }

  /**
   * Reset the detector (e.g., after manual takeover or page navigation).
   */
  reset(): void {
    this.actionHistory = [];
    this.screenshotHashes = [];
    this.urlVisits.clear();
    this.stuckCount = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private getLastNActions(n: number): string[] {
    return this.actionHistory.slice(-n).map((a) => a.action);
  }

  private extractHost(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private getRecoveryHint(pattern: string): string {
    const hints: Record<string, string[]> = {
      repeated_action: [
        "Try a completely different approach. The current action isn't achieving results.",
        "Use get_elements to see all interactive elements and try a different one.",
        "Consider scrolling the page — the target may not be in the viewport.",
        "The element may be behind a modal or overlay. Check if there's a close button.",
      ],
      unchanged_page: [
        "The page isn't responding to your actions. Try clicking a different element.",
        "The page may have finished loading. Check if the task is already complete.",
        "Try using get_elements to discover available interactive elements.",
        "Consider navigating to a different URL if this page is unresponsive.",
      ],
      alternating: [
        "You're toggling between two states. Determine which state is correct and proceed differently.",
        "A modal or popup may be opening and closing. Look for a different path forward.",
        "Try reading the page content to understand what's happening on screen.",
      ],
      same_coords: [
        "Your clicks at these coordinates aren't having effect. Use get_elements to find the actual element.",
        "The element may have moved or be covered by another element. Try scrolling first.",
        "Use click_element with the element index instead of coordinate-based clicking.",
      ],
    };

    const options = hints[pattern] ?? hints.repeated_action!;
    return options[this.stuckCount % options.length]!;
  }
}
