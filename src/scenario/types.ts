export interface Selector {
  css: string;
  xpath?: string;
  strategy: "data-testid" | "id" | "aria-label" | "role-name" | "text" | "css-path";
}

export type StepAction = "goto" | "click" | "fill" | "select" | "check" | "hover" | "scroll" | "press" | "wait" | "assert" | "record" | "measure";
export type CapturePreference = "always" | "failure" | "off";

export interface StepMeta {
  id?: string;
  name?: string;
  phase?: string;
  note?: string;
  capture?: CapturePreference;
  selectorKey?: string;
}

export interface GotoStep {
  action: "goto";
  url: string;
}

export interface ElementStep {
  action: "click" | "hover" | "check";
  selector?: Selector;
}

export interface FillStep {
  action: "fill";
  selector?: Selector;
  value: string;
}

export interface SelectStep {
  action: "select";
  selector?: Selector;
  value: string;
}

export interface PressStep {
  action: "press";
  key: string;
}

export interface ScrollStep {
  action: "scroll";
  selector?: Selector;
  direction?: "up" | "down";
  amount?: number;
}

export interface WaitStep {
  action: "wait";
  ms?: number;
  selector?: Selector;
}

export interface AssertStep {
  action: "assert";
  type: "visible" | "hidden" | "text" | "title" | "url" | "value";
  selector?: Selector;
  expected?: string;
}

export interface RecordStep {
  action: "record";
  mode: "start" | "stop";
  id?: string;
}

export interface MeasureStep {
  action: "measure";
  selector?: Selector;
  event?: "animationend" | "transitionend";
  label?: string;
  ms?: number;
}

export type Step =
  | (StepMeta & GotoStep)
  | (StepMeta & ElementStep)
  | (StepMeta & FillStep)
  | (StepMeta & SelectStep)
  | (StepMeta & PressStep)
  | (StepMeta & ScrollStep)
  | (StepMeta & WaitStep)
  | (StepMeta & AssertStep)
  | (StepMeta & RecordStep)
  | (StepMeta & MeasureStep);

export interface ScenarioJourney {
  actor?: string;
  goal?: string;
  phases?: string[];
  tags?: string[];
}

export interface Scenario {
  name: string;
  baseUrl: string;
  selectors?: Record<string, Selector>;
  steps: Step[];
  journey?: ScenarioJourney;
  metadata?: {
    recordedAt: string;
    recordedWith: string;
    template?: string;
  };
}

export interface BrowserTarget {
  browserName: string;
  browserVersion: string;
}

export interface RunConfig {
  selenoidUrl: string;
  scenario: Scenario;
  browsers: BrowserTarget[];
  timeout?: number;
}

export interface ScreencastFrame {
  timestampMs: number;
  data: Buffer;
}

export interface MeasureResult {
  label?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface TimingReport {
  id: string;
  js: { startMs: number; endMs: number; durationMs: number };
  cdp: { firstFrameMs: number; lastFrameMs: number; frameCount: number };
  selenoid?: { firstChangeMs: number; lastChangeMs: number };
  lag: { renderMs: number; renderEndMs: number; vncMs?: number };
  videoPath?: string;
  cdpFramesDir?: string;
}

export interface RunArtifacts {
  screenshotPath?: string;
  pageUrl?: string;
  pageTitle?: string;
  measureResult?: MeasureResult;
  timingReport?: TimingReport;
  videoPath?: string;
}

export interface StepResult {
  step: Step;
  index: number;
  status: "passed" | "failed" | "skipped";
  duration: number;
  error?: string;
  artifacts?: RunArtifacts;
}

export interface RunResult {
  browser: BrowserTarget;
  scenario: string;
  status: "passed" | "failed";
  steps: StepResult[];
  duration: number;
  startedAt: string;
  finishedAt: string;
  artifactsDir?: string;
  timingReports?: TimingReport[];
}

export interface RunOptions {
  artifactsDir?: string;
  capture?: CapturePreference | "all";
  concurrency?: number;
  requestTimeoutMs?: number;
  enableVideo?: boolean;
}
