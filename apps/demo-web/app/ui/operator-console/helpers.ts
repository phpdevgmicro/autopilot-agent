/**
 * Barrel re-export — all public helpers from focused modules.
 *
 * Consumer code (OperatorConsole, tests, etc.) can continue to
 * `import { ... } from "./helpers"` without any changes.
 */

export {
  appName,
  appSubtitle,
  browserHelpText,
  defaultMaxResponseTurns,
  defaultRunModel,
  engineHelpText,
  runnerUnavailableHint,
  turnBudgetHelpText,
  verificationHelpText,
} from "./constants";

export {
  createRunnerIssue,
  createRunnerUnavailableIssue,
  deriveRunFailureIssue,
  formatRunnerIssueMessage,
  parseRunnerIssue,
} from "./issues";

export type { RunnerIssue } from "./issues";

export {
  activityFamilyLabel,
  createManualLog,
  createManualTranscript,
  formatClock,
  humanizeToken,
  scenarioTargetDisplay,
} from "./formatters";

export {
  mapManualLogToActivity,
  mapManualTranscriptToActivity,
  mapRunEventToActivity,
} from "./activity-mappers";
