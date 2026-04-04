"use client";

import type {
  BrowserScreenshotArtifact,
  BrowserState,
  RunDetail,
} from "@cua-sample/replay-schema";

import { humanizeToken } from "./helpers";

type ScreenshotPaneProps = {
  emptyReviewHeading: string;
  emptyReviewMessage: string;
  emptyTimelineMessage: string;
  onJumpToLatestScreenshot: () => void;
  onOpenReplay: () => void;
  onScrubberChange: (value: string) => void;
  onSelectScreenshot: (screenshotId: string) => void;
  replayDisabled: boolean;
  runnerBaseUrl: string;
  screenshots: BrowserScreenshotArtifact[];
  selectedBrowser: BrowserState | null;
  selectedRun: RunDetail | null;
  selectedScenarioTitle: string;
  selectedScreenshot: BrowserScreenshotArtifact | null;
  selectedScreenshotIndex: number;
  stageUrl: string;
  viewingLiveFrame: boolean;
};

/** Lock icon SVG for HTTPS indicator */
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Globe icon for non-HTTPS */
function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function getDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function ScreenshotPane({
  emptyReviewHeading,
  emptyReviewMessage,
  runnerBaseUrl,
  screenshots,
  selectedRun,
  selectedScenarioTitle,
  selectedScreenshot,
  selectedScreenshotIndex,
  stageUrl,
  viewingLiveFrame,
}: ScreenshotPaneProps) {
  const screenshotCount = screenshots.length;
  const isRunning = selectedRun?.run.status === "running";
  const currentUrl = selectedScreenshot?.pageUrl ?? stageUrl;
  const hasScreenshots = screenshotCount > 0;
  const isActualUrl = currentUrl.startsWith("http") || currentUrl.startsWith("https");

  return (
    <div className="browserSurface">
      {/* Browser-style chrome header — always visible */}
      <div className="browserChrome">
        <div className="browserDots">
          <span className="browserDot browserDotRed" />
          <span className="browserDot browserDotYellow" />
          <span className="browserDot browserDotGreen" />
        </div>

        <div className="browserAddressBar">
          {isActualUrl ? (
            <>
              <span className={`browserSecurityIcon ${isHttps(currentUrl) ? "browserSecure" : ""}`}>
                {isHttps(currentUrl) ? <LockIcon /> : <GlobeIcon />}
              </span>
              <span className="browserUrlText">{getDisplayUrl(currentUrl)}</span>
            </>
          ) : (
            <span className="browserUrlPlaceholder">{currentUrl}</span>
          )}
        </div>

        <div className="browserFrameInfo">
          {hasScreenshots ? (
            viewingLiveFrame && isRunning
              ? <span className="browserLiveIndicator">● Live</span>
              : <span className="browserFrameCount">Frame {selectedScreenshotIndex + 1} / {screenshotCount}</span>
          ) : isRunning ? (
            <span className="browserLiveIndicator">● Connecting</span>
          ) : null}
        </div>
      </div>

      {/* Browser canvas */}
      <div className="browserCanvas">
        <div className={`stageMedia ${selectedScreenshot ? "hasCapture" : ""}`}>
          {selectedScreenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`Captured frame ${selectedScreenshotIndex + 1} for ${selectedScenarioTitle}`}
              className="stageScreenshot"
              src={`${runnerBaseUrl}${selectedScreenshot.url}`}
            />
          ) : (
            <div className="stagePlaceholder">
              <div className="browserEmptyState">
                {/* Browser window outline icon */}
                <div className="browserEmptyIcon">
                  <svg width="64" height="56" viewBox="0 0 64 56" fill="none">
                    {/* Browser window frame */}
                    <rect x="2" y="2" width="60" height="52" rx="6" stroke="rgba(96, 165, 250, 0.35)" strokeWidth="1.5" />
                    {/* Title bar area */}
                    <line x1="2" y1="14" x2="62" y2="14" stroke="rgba(96, 165, 250, 0.2)" strokeWidth="1" />
                    {/* Dots in title bar */}
                    <circle cx="12" cy="8" r="2" fill="rgba(239, 68, 68, 0.5)" />
                    <circle cx="20" cy="8" r="2" fill="rgba(234, 179, 8, 0.5)" />
                    <circle cx="28" cy="8" r="2" fill="rgba(34, 197, 94, 0.5)" />
                    {/* Address bar outline in title bar */}
                    <rect x="34" y="5" width="22" height="6" rx="3" stroke="rgba(96, 165, 250, 0.15)" strokeWidth="0.8" fill="none" />
                    {/* Content placeholder lines */}
                    <rect x="10" y="22" width="44" height="3" rx="1.5" fill="rgba(96, 165, 250, 0.08)" />
                    <rect x="10" y="30" width="32" height="3" rx="1.5" fill="rgba(96, 165, 250, 0.06)" />
                    <rect x="10" y="38" width="38" height="3" rx="1.5" fill="rgba(96, 165, 250, 0.05)" />
                  </svg>
                  {/* Glow behind icon */}
                  <div className="browserEmptyGlow" />
                </div>

                <h3 className="browserEmptyTitle">Agent Browser</h3>
                <p className="browserEmptyDesc">
                  The agent&apos;s live browser view will appear here during task execution.
                </p>

                {/* Feature chips */}
                <div className="browserFeatureChips">
                  <span className="browserChip">
                    <span className="browserChipIcon">🛡️</span> Stealth Mode
                  </span>
                  <span className="browserChip">
                    <span className="browserChipIcon">🍪</span> Cookie Auto-Dismiss
                  </span>
                  <span className="browserChip">
                    <span className="browserChipIcon">🔗</span> Nav Tracking
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
