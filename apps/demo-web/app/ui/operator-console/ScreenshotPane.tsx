"use client";

import type {
  BrowserScreenshotArtifact,
  BrowserState,
  RunDetail,
} from "@cua-sample/replay-schema";

import { humanizeToken } from "./helpers";

type ScreenshotPaneProps = {
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

export function ScreenshotPane({
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

  return (
    <div className="browserSurface">
      <div className="stageChrome">
        <div className="stageUrl">{selectedScreenshot?.pageUrl ?? stageUrl}</div>
        {screenshotCount > 0 ? (
          <div className="stageFrameCount">
            {viewingLiveFrame && selectedRun?.run.status === "running"
              ? "● Live"
              : `Frame ${selectedScreenshotIndex + 1} / ${screenshotCount}`}
          </div>
        ) : null}
      </div>

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
              <h3>
                {selectedRun
                  ? selectedRun.run.status === "running"
                    ? "Agent is working..."
                    : "No frames captured"
                  : "Ready"}
              </h3>
              <p>{emptyReviewMessage}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
