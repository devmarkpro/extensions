import { open } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { isSuperwhisperInstalled } from "./utils";
import { readdirSync, readFileSync, existsSync, statSync, rmSync } from "fs";
import { Mode } from "./select-mode";
import { getPreferenceValues } from "@raycast/api";
import { homedir } from "os";
import { join } from "path";

export type RecordingMeta = {
  rawResult?: string;
  llmResult?: string;
  duration?: number;
  modelName?: string;
  prompt?: string;
  modeName?: string;
  languageModelName?: string;
};

export type TranscriptVariant = "processed" | "unprocessed";

export type Recording = {
  directory: string;
  meta: RecordingMeta;
  timestamp: Date;
};

export type LatestRecording = {
  timestamp: Date;
  text: string;
};

export function useModes() {
  const prefs = getPreferenceValues<Preferences.SelectMode>();
  const modeDir = prefs.modeDir ?? join(homedir(), "Documents", "superwhisper", "modes");

  const {
    data: modes,
    isLoading,
    error,
  } = useCachedPromise(
    async (dir: string) => {
      const isInstalled = await isSuperwhisperInstalled();
      if (!isInstalled) {
        throw new Error("Superwhisper is not installed");
      }

      return readdirSync(dir)
        .filter((file) => file.indexOf(".json") !== -1)
        .map((file) => JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Mode);
    },
    [modeDir],
    {
      failureToastOptions: {
        title: `Failed to fetch modes`,
        message: "Check if Superwhisper is installed and mode directory is correct.",
        primaryAction: {
          title: "Install from superwhisper.com",
          onAction: async (toast) => {
            await open("https://superwhisper.com");
            await toast.hide();
          },
        },
      },
    },
  );

  return { modes, isLoading: (!modes && !error) || isLoading, error };
}

function parseRecordingMeta(path: string): RecordingMeta | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    const rawResult = typeof parsed.rawResult === "string" ? parsed.rawResult : undefined;
    const llmResult = typeof parsed.llmResult === "string" ? parsed.llmResult : undefined;
    const duration = typeof parsed.duration === "number" ? parsed.duration : undefined;
    const modelName = typeof parsed.modelName === "string" ? parsed.modelName : undefined;
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt : undefined;
    const modeName = typeof parsed.modeName === "string" ? parsed.modeName : undefined;
    const languageModelName = typeof parsed.languageModelName === "string" ? parsed.languageModelName : undefined;
    return {
      rawResult,
      llmResult,
      duration,
      modelName,
      prompt,
      modeName,
      languageModelName,
    };
  } catch {
    return undefined;
  }
}

export function formatDurationMs(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function getRecordingPrimaryText(meta: RecordingMeta): string {
  const llmResult = meta.llmResult?.trim();
  if (llmResult) {
    return llmResult;
  }
  return meta.rawResult?.trim() ?? "";
}

export function getRecordingTextByVariant(meta: RecordingMeta, variant: TranscriptVariant): string {
  if (variant === "processed") {
    return meta.llmResult?.trim() ?? "";
  }

  return meta.rawResult?.trim() ?? "";
}

export async function getRecordings(customRecordingsPath?: string): Promise<Recording[]> {
  const isInstalled = await isSuperwhisperInstalled();
  if (!isInstalled) {
    throw new Error("Superwhisper is not installed");
  }

  const recordingsPath = customRecordingsPath ?? join(homedir(), "Documents", "superwhisper", "recordings");
  if (!existsSync(recordingsPath)) {
    throw new Error("Recording directory not found. Please make a recording first.");
  }

  const directories = readdirSync(recordingsPath)
    .filter((dir) => /^\d+$/.test(dir))
    .map((dir) => ({
      dir,
      path: join(recordingsPath, dir),
    }));

  if (directories.length === 0) {
    throw new Error("No recordings found. Please make a recording first.");
  }

  const recordingsList: Recording[] = directories.flatMap((directory) => {
    const metaPath = join(directory.path, "meta.json");
    if (!existsSync(metaPath)) {
      return [];
    }

    const meta = parseRecordingMeta(metaPath);
    if (!meta) {
      return [];
    }

    const stats = statSync(metaPath);
    return [
      {
        directory: directory.dir,
        meta,
        timestamp: stats.mtime,
      },
    ];
  });

  if (recordingsList.length === 0) {
    throw new Error("No valid recordings metadata found. Some recording folders may be incomplete.");
  }

  recordingsList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return recordingsList;
}

export function deleteRecording(recordingsPath: string, directory: string): Promise<void> {
  if (!directory || !/^\d+$/.test(directory)) {
    return Promise.reject(new Error("Invalid directory: " + directory));
  }
  const fullPath = join(recordingsPath, directory);
  if (!existsSync(fullPath)) {
    return Promise.resolve();
  }
  return Promise.resolve(rmSync(fullPath, { recursive: true }));
}

export function getLatestRecordingByVariantFromRecordings(
  recordings: Recording[],
  variant: TranscriptVariant,
): LatestRecording | undefined {
  const latestRecording = recordings[0];
  if (!latestRecording) {
    return undefined;
  }

  const text = getRecordingTextByVariant(latestRecording.meta, variant);
  if (!text) {
    return undefined;
  }

  return {
    timestamp: latestRecording.timestamp,
    text,
  };
}

export async function getLatestRecordingByVariant(
  variant: TranscriptVariant,
  customRecordingsPath?: string,
): Promise<LatestRecording> {
  const recordings = await getRecordings(customRecordingsPath);
  const latestRecording = getLatestRecordingByVariantFromRecordings(recordings, variant);
  if (!latestRecording) {
    if (variant === "processed") {
      throw new Error("No AI processed transcript found. Switch Transcript Variant to Unprocessed.");
    }

    throw new Error("No unprocessed transcript found. Switch Transcript Variant to AI Processed.");
  }

  return latestRecording;
}

export function useRecordings(customRecordingsPath?: string) {
  const {
    data: recordings,
    isLoading,
    error,
    revalidate,
  } = useCachedPromise(getRecordings, [customRecordingsPath], {
    failureToastOptions: {
      title: `Failed to fetch recordings`,
      message: "Check if Superwhisper is installed and the recording directory is correct.",
      primaryAction: {
        title: "Install from superwhisper.com",
        onAction: async (toast) => {
          await open("https://superwhisper.com");
          await toast.hide();
        },
      },
    },
  });

  return { recordings, isLoading: (!recordings && !error) || isLoading, error, revalidate };
}
