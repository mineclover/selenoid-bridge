import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScreencastFrame, TimingReport } from "../scenario/types.js";

const execFileAsync = promisify(execFile);

export async function saveCdpFrames(
  frames: ScreencastFrame[],
  outputDir: string,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Promise.all(
    frames.map((frame, i) => {
      const name = `${String(i + 1).padStart(4, "0")}-${frame.timestampMs}ms.jpg`;
      return writeFile(join(outputDir, name), frame.data);
    }),
  );
}

// Returns absolute timestamps in ms for each extracted frame.
// offset = session start time (Date.now()) so Selenoid video frames
// align with CDP/JS absolute timestamps.
export async function extractVideoFrames(
  videoPath: string,
  outputDir: string,
  sessionStartMs: number,
  fps = 10,
): Promise<number[]> {
  await mkdir(outputDir, { recursive: true });
  try {
    await execFileAsync("ffmpeg", [
      "-i", videoPath,
      "-vf", `fps=${fps}`,
      "-y",
      join(outputDir, "frame_%04d.png"),
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ffmpeg") || msg.includes("not found") || msg.includes("ENOENT")) {
      throw new Error("ffmpeg not found — install ffmpeg to enable Selenoid video frame extraction");
    }
    throw e;
  }
  const files = (await readdir(outputDir)).filter((f) => f.endsWith(".png")).sort();
  const intervalMs = 1000 / fps;
  return files.map((_, i) => Math.round(sessionStartMs + i * intervalMs));
}

export function buildTimingReport(
  id: string,
  jsStartMs: number,
  jsEndMs: number,
  cdpFrames: ScreencastFrame[],
  selenoidFrameTimestampsMs?: number[],
  videoPath?: string,
  cdpFramesDir?: string,
): TimingReport {
  const cdpFirst = cdpFrames[0]?.timestampMs ?? jsStartMs;
  const cdpLast = cdpFrames[cdpFrames.length - 1]?.timestampMs ?? jsEndMs;

  const report: TimingReport = {
    id,
    js:  { startMs: jsStartMs, endMs: jsEndMs, durationMs: jsEndMs - jsStartMs },
    cdp: { firstFrameMs: cdpFirst, lastFrameMs: cdpLast, frameCount: cdpFrames.length },
    lag: {
      renderMs:    cdpFirst - jsStartMs,
      renderEndMs: cdpLast  - jsEndMs,
    },
    videoPath,
    cdpFramesDir,
  };

  if (selenoidFrameTimestampsMs?.length) {
    report.selenoid = {
      firstChangeMs: selenoidFrameTimestampsMs[0],
      lastChangeMs:  selenoidFrameTimestampsMs[selenoidFrameTimestampsMs.length - 1],
    };
    report.lag.vncMs = selenoidFrameTimestampsMs[0] - cdpFirst;
  }

  return report;
}
