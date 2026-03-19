"use client";

import { appName, appSubtitle } from "./helpers";

type RunSummaryProps = {
  runnerOnline: boolean;
  topbarSubtitle: string;
};

type StageSummaryProps = {
  stageHeadline: string;
  stageSupportCopy: string | null;
};

export function ConsoleTopbar({
  runnerOnline,
}: RunSummaryProps) {
  return (
    <header className="consoleTopbar">
      <div className="brandBlock">
        <div className="brandMark">
          <span>🤖</span>
        </div>
        <div className="brandCopy">
          <h1>{appName}</h1>
          <p>{appSubtitle}</p>
        </div>
      </div>
      <div className="statusCluster">
        <div className={`statusPill ${runnerOnline ? "ok" : "error"}`}>
          <span className="statusDot" />
          {runnerOnline ? "Engine Online" : "Engine Offline"}
        </div>
      </div>
    </header>
  );
}

export function RunSummary({
  stageHeadline,
  stageSupportCopy,
}: StageSummaryProps) {
  return (
    <div className="stageReviewMeta">
      <div className="stageStatusStrip">
        <span className="stageStatusItem">{stageHeadline}</span>
      </div>
      {stageSupportCopy ? <p className="stageNow">{stageSupportCopy}</p> : null}
    </div>
  );
}
