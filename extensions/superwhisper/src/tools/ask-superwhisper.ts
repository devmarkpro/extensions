import { AI, environment, getPreferenceValues } from "@raycast/api";
import { homedir } from "os";
import { join } from "path";
import { format, startOfDay, subDays } from "date-fns";
import { getRecordings, getRecordingPrimaryText, type Recording } from "../hooks";

const DEFAULT_RECORDINGS_PATH = join(homedir(), "Documents", "superwhisper", "recordings");
const MAX_EXCERPTS = 10;
const EXCERPT_WINDOW = 300;

type RecordingStats = {
  total: number;
  yesterday: number;
  today: number;
  last7Days: number;
};

function getRecordingStats(recordings: Recording[]): RecordingStats {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(subDays(now, 1));
  const sevenDaysAgo = subDays(todayStart, 7);

  let yesterday = 0;
  let today = 0;
  let last7Days = 0;

  for (const r of recordings) {
    const t = r.timestamp.getTime();
    if (t >= yesterdayStart.getTime() && t < todayStart.getTime()) yesterday += 1;
    else if (t >= todayStart.getTime()) today += 1;
    if (t >= sevenDaysAgo.getTime()) last7Days += 1;
  }

  return {
    total: recordings.length,
    yesterday,
    today,
    last7Days,
  };
}

type MetadataSummary = {
  modeCounts: Record<string, number>;
  modelCounts: Record<string, number>;
  languageModelCounts: Record<string, number>;
};

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;

function buildMetadataSummary(recordings: Recording[]): MetadataSummary {
  const modeCounts: Record<string, number> = {};
  const modelCounts: Record<string, number> = {};
  const languageModelCounts: Record<string, number> = {};

  for (const r of recordings) {
    const m = r.meta;
    if (m.modeName?.trim()) {
      const name = m.modeName.trim();
      modeCounts[name] = (modeCounts[name] ?? 0) + 1;
    }
    if (m.modelName?.trim()) {
      const name = m.modelName.trim();
      modelCounts[name] = (modelCounts[name] ?? 0) + 1;
    }
    if (m.languageModelName?.trim()) {
      const name = m.languageModelName.trim();
      languageModelCounts[name] = (languageModelCounts[name] ?? 0) + 1;
    }
  }

  return {
    modeCounts,
    modelCounts,
    languageModelCounts,
  };
}

/** Parse a duration threshold from the question (e.g. "longer than 45 minutes", "over 2 hours"). Returns ms and a label for the answer. */
function parseDurationThreshold(question: string): { valueMs: number; label: string } | null {
  const q = question.toLowerCase();
  const durationIntent =
    q.includes("longer than") || q.includes("over") || q.includes("more than") || q.includes("at least");
  if (!durationIntent && !q.includes("minute") && !q.includes("hour") && !q.includes(" min") && !q.includes(" hr")) {
    return null;
  }
  // Match "30 minutes", "45 min", "1.5 hours", "2 hours", "90 min", etc.
  const minMatch = question.match(/(\d+(?:\.\d+)?)\s*(?:minute|min)s?/i);
  const hourMatch = question.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)s?/i);
  if (minMatch) {
    const value = parseFloat(minMatch[1]);
    if (Number.isFinite(value) && value > 0) {
      const valueMs = value * MS_PER_MIN;
      const label = value === 1 ? "1 minute" : `${value} minutes`;
      return { valueMs, label };
    }
  }
  if (hourMatch) {
    const value = parseFloat(hourMatch[1]);
    if (Number.isFinite(value) && value > 0) {
      const valueMs = value * MS_PER_HOUR;
      const label = value === 1 ? "1 hour" : `${value} hours`;
      return { valueMs, label };
    }
  }
  return null;
}

function formatMetadataSummaryBlock(summary: MetadataSummary): string {
  const lines: string[] = [
    "Recording metadata (use for questions about mode, duration, or model):",
    "For duration: each recording has a duration in ms; user can ask e.g. 'how many longer than 45 minutes' or 'over 2 hours'.",
  ];
  if (Object.keys(summary.modeCounts).length > 0) {
    const modeList = Object.entries(summary.modeCounts)
      .map(([name, n]) => `  - "${name}": ${n}`)
      .join("\n");
    lines.push("By mode:\n" + modeList);
  }
  if (Object.keys(summary.modelCounts).length > 0) {
    const modelList = Object.entries(summary.modelCounts)
      .map(([name, n]) => `  - "${name}": ${n}`)
      .join("\n");
    lines.push("By transcription model (modelName):\n" + modelList);
  }
  if (Object.keys(summary.languageModelCounts).length > 0) {
    const llmList = Object.entries(summary.languageModelCounts)
      .map(([name, n]) => `  - "${name}": ${n}`)
      .join("\n");
    lines.push("By language model (languageModelName):\n" + llmList);
  }
  return lines.join("\n") + "\n\n";
}

/** Build the full context block (stats + metadata). Optionally append a duration count line when the question mentions a duration threshold. */
function buildFullContextBlock(
  stats: RecordingStats,
  metadataSummary: MetadataSummary,
  question: string,
  recordings: Recording[],
): string {
  let block = `Recording statistics (each folder = one recording/meeting):
- Total recordings: ${stats.total}
- Recordings yesterday: ${stats.yesterday}
- Recordings today: ${stats.today}
- Recordings in the last 7 days: ${stats.last7Days}

${formatMetadataSummaryBlock(metadataSummary)}`;
  const durationThreshold = parseDurationThreshold(question);
  if (durationThreshold) {
    const count = recordings.filter(
      (r) => typeof r.meta.duration === "number" && r.meta.duration >= durationThreshold.valueMs,
    ).length;
    block += `Recordings longer than ${durationThreshold.label}: ${count}\n\n`;
  }
  return block;
}

type Input = {
  /**
   * The user's question about their voice transcripts (e.g. "What did I say about the project deadline?").
   * Pass the user's exact question when they ask about their Superwhisper recordings.
   */
  question: string;
};

/**
 * Search the user's Superwhisper transcripts and answer their question using AI.
 * Use this when the user asks about their voice recordings, meeting notes, or what they said in past transcripts.
 */
export default async function askSuperwhisper(input: Input): Promise<string> {
  const question = input.question?.trim();
  if (!question) {
    return "Please ask a question about your transcripts (e.g. what you said about a topic, or a summary of your recordings).";
  }

  if (!environment.canAccess(AI)) {
    return "Raycast Pro is required to use AI for searching your transcripts. Please upgrade to use this feature.";
  }

  const prefs = getPreferenceValues<Preferences>();
  const recordingsPath = prefs.recordingDir || DEFAULT_RECORDINGS_PATH;

  let recordings: Recording[];
  try {
    recordings = await getRecordings(recordingsPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Could not load recordings: ${message}. Please check that Superwhisper is installed and you have made at least one recording.`;
  }

  if (recordings.length === 0) {
    return "No recordings found. Make a recording with Superwhisper first, then ask again.";
  }

  const stats = getRecordingStats(recordings);
  const metadataSummary = buildMetadataSummary(recordings);

  const corpus = recordings.map((r) => ({
    id: r.directory,
    timestamp: r.timestamp,
    text: getRecordingPrimaryText(r.meta),
  }));

  const textsWithContent = corpus.filter((c) => c.text.length > 0);
  const contextBlock = buildFullContextBlock(stats, metadataSummary, question, recordings);

  let excerptBlock: string;
  if (textsWithContent.length === 0) {
    excerptBlock = "No transcript content is available in your recordings (meta may be missing llmResult/rawResult).";
  } else {
    let refinedQuery: string;
    try {
      refinedQuery = await AI.ask(
        `You are helping refine a search query. The user will ask a question about their voice transcripts. Output ONLY a short search query (keywords or phrase, no full sentence) that would best find relevant transcript content. Do not explain. Output nothing else.

User question: ${question}`,
        { creativity: "none" },
      );
    } catch (err) {
      return "Failed to prepare the search. Please try again.";
    }

    const query = refinedQuery.trim() || question;
    const queryLower = query.toLowerCase();
    const terms = queryLower.split(/\s+/).filter(Boolean);

    type Match = { id: string; date: string; excerpt: string; score: number };
    const matches: Match[] = [];

    for (const item of textsWithContent) {
      const text = item.text;
      const textLower = text.toLowerCase();
      let score = 0;
      if (terms.length === 0) {
        score = 1;
      } else {
        for (const term of terms) {
          if (textLower.includes(term)) score += 1;
        }
      }
      if (score === 0) continue;

      const idx = textLower.indexOf(terms[0]);
      const start = Math.max(0, idx - EXCERPT_WINDOW);
      const end = Math.min(text.length, idx + terms[0].length + EXCERPT_WINDOW);
      let excerpt = text.slice(start, end);
      if (start > 0) excerpt = "…" + excerpt;
      if (end < text.length) excerpt = excerpt + "…";

      matches.push({
        id: item.id,
        date: format(item.timestamp, "yyyy-MM-dd HH:mm"),
        excerpt,
        score,
      });
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, MAX_EXCERPTS);

    if (top.length === 0) {
      excerptBlock = "No transcript excerpts found for this query.";
    } else {
      excerptBlock = top.map((m) => `[Recording ${m.id} (${m.date})]\n${m.excerpt}`).join("\n\n---\n\n");
    }
  }

  try {
    const answer = await AI.ask(
      `You have the following recording statistics and metadata. Use them to answer count and metadata questions (e.g. how many recordings, how many in a mode, how many longer than X, which model). When transcript excerpts are provided below, use them for content questions (e.g. what was said about a topic). Answer only from this data; if the answer is not here, say so. When relevant, mention which recording or date the information came from.

User question: ${question}

${contextBlock}
Transcript excerpts:
${excerptBlock}`,
      { creativity: "low" },
    );
    return answer.trim();
  } catch (err) {
    return "Failed to generate an answer from your transcripts. Please try again.";
  }
}
