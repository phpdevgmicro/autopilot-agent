"use client";

import { useEffect, useRef, useState } from "react";

import type { BrowserScreenshotArtifact, RunDetail } from "@cua-sample/replay-schema";

export function useScreenshots(
  screenshots: BrowserScreenshotArtifact[],
  runId: string | undefined,
) {
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<string | null>(null);
  const [followLatestScreenshot, setFollowLatestScreenshot] = useState(true);

  const latestScreenshot = screenshots.at(-1) ?? null;

  // Reset on new run
  useEffect(() => {
    setSelectedScreenshotId(null);
    setFollowLatestScreenshot(true);
  }, [runId]);

  // Follow latest screenshot
  useEffect(() => {
    if (screenshots.length === 0) {
      setSelectedScreenshotId(null);
      return;
    }

    const latestId = screenshots.at(-1)?.id ?? null;

    setSelectedScreenshotId((current) => {
      if (!current || followLatestScreenshot) return latestId;
      return screenshots.some((s) => s.id === current) ? current : latestId;
    });
  }, [followLatestScreenshot, latestScreenshot?.id, screenshots]);

  const selectedScreenshot =
    screenshots.find((s) => s.id === selectedScreenshotId) ??
    latestScreenshot ??
    null;

  const selectedScreenshotIndex = selectedScreenshot
    ? screenshots.findIndex((s) => s.id === selectedScreenshot.id)
    : -1;

  const viewingLiveFrame =
    selectedScreenshotIndex >= 0 &&
    selectedScreenshotIndex === screenshots.length - 1;

  const handleSelectScreenshot = (screenshotId: string) => {
    const nextIndex = screenshots.findIndex((s) => s.id === screenshotId);
    if (nextIndex < 0) return;
    setSelectedScreenshotId(screenshotId);
    setFollowLatestScreenshot(nextIndex === screenshots.length - 1);
  };

  const handleJumpToLatestScreenshot = () => {
    if (!latestScreenshot) return;
    setSelectedScreenshotId(latestScreenshot.id);
    setFollowLatestScreenshot(true);
  };

  const handleScrubberChange = (value: string) => {
    const nextIndex = Number(value);
    const nextScreenshot = screenshots[nextIndex];
    if (!nextScreenshot) return;
    setSelectedScreenshotId(nextScreenshot.id);
    setFollowLatestScreenshot(nextIndex === screenshots.length - 1);
  };

  return {
    followLatestScreenshot,
    handleJumpToLatestScreenshot,
    handleScrubberChange,
    handleSelectScreenshot,
    latestScreenshot,
    selectedScreenshot,
    selectedScreenshotIndex,
    viewingLiveFrame,
  };
}
