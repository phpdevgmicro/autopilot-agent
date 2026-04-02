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
              <div className="scopeContainer">
                {/* Outer scope ring */}
                <svg className="scopeRing" viewBox="0 0 120 120" fill="none">
                  {/* Rotating outer ring with tick marks */}
                  <circle cx="60" cy="60" r="54" stroke="rgba(96, 165, 250, 0.15)" strokeWidth="1" />
                  <circle cx="60" cy="60" r="44" stroke="rgba(96, 165, 250, 0.1)" strokeWidth="0.5" strokeDasharray="4 8" />
                  {/* Crosshair lines */}
                  <line x1="60" y1="6" x2="60" y2="30" stroke="rgba(96, 165, 250, 0.3)" strokeWidth="1" />
                  <line x1="60" y1="90" x2="60" y2="114" stroke="rgba(96, 165, 250, 0.3)" strokeWidth="1" />
                  <line x1="6" y1="60" x2="30" y2="60" stroke="rgba(96, 165, 250, 0.3)" strokeWidth="1" />
                  <line x1="90" y1="60" x2="114" y2="60" stroke="rgba(96, 165, 250, 0.3)" strokeWidth="1" />
                  {/* Tick marks at 45° angles */}
                  <line x1="18" y1="18" x2="26" y2="26" stroke="rgba(96, 165, 250, 0.15)" strokeWidth="0.8" />
                  <line x1="94" y1="18" x2="102" y2="26" stroke="rgba(96, 165, 250, 0.15)" strokeWidth="0.8" />
                  <line x1="18" y1="94" x2="26" y2="102" stroke="rgba(96, 165, 250, 0.15)" strokeWidth="0.8" />
                  <line x1="94" y1="94" x2="102" y2="102" stroke="rgba(96, 165, 250, 0.15)" strokeWidth="0.8" />
                  {/* Small center square */}
                  <rect x="55" y="55" width="10" height="10" stroke="rgba(96, 165, 250, 0.4)" strokeWidth="1" fill="none" />
                </svg>
                {/* Pulsing center dot */}
                <div className="scopeCenterDot" />
                {/* Rotating scanner line */}
                <div className="scopeScanner" />
              </div>
              <h3>{emptyReviewHeading}</h3>
              <p>{emptyReviewMessage}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
