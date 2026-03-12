import { useState } from "react";
import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  getPreferenceValues,
  confirmAlert,
  Alert,
  showToast,
  Toast,
} from "@raycast/api";
import { homedir } from "os";
import { join } from "path";
import { format } from "date-fns";
import { getRecordingPrimaryText, formatDurationMs, useRecordings, useModes, deleteRecording } from "./hooks";
import { getIconForModeName, getModeIcon } from "./select-mode";

const PROMPT_LABEL_PATTERN =
  /^(INSTRUCTIONS|CRITICAL INSTRUCTION|SUMMARY FORMAT REQUIREMENTS|SYSTEM CONTEXT|USER MESSAGE):\s*$/i;
const PROMPT_SUMMARY_MAX_LEN = 50;

function getPromptSummary(prompt: string | undefined): string | undefined {
  const p = prompt?.trim();
  if (!p) return undefined;
  const lines = p
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const firstMeaningful = lines.find((l) => !PROMPT_LABEL_PATTERN.test(l)) ?? lines[0];
  if (!firstMeaningful) return undefined;
  return firstMeaningful.length > PROMPT_SUMMARY_MAX_LEN
    ? firstMeaningful.slice(0, PROMPT_SUMMARY_MAX_LEN) + "…"
    : firstMeaningful;
}

export default function Command() {
  const { recordingDir } = getPreferenceValues<Preferences.SearchHistory>();
  const recordingsPath = recordingDir || join(homedir(), "Documents", "superwhisper", "recordings");
  const { recordings, isLoading, error, revalidate } = useRecordings(recordingsPath);
  const { modes, isLoading: modesLoading } = useModes();
  const [selectedMode, setSelectedMode] = useState<string>("");

  const filteredRecordings = recordings?.filter((r) => !selectedMode || r.meta.modeName === selectedMode) ?? [];
  const latestHistoryText = filteredRecordings[0] ? getRecordingPrimaryText(filteredRecordings[0].meta) : "";

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
          title="Error"
          description={error.message}
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading || modesLoading}
      isShowingDetail
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by mode" value={selectedMode} onChange={setSelectedMode}>
          <List.Dropdown.Item title="All Modes" value="" icon={Icon.Document} />
          {modes?.map((mode) => (
            <List.Dropdown.Item key={mode.key} title={mode.name} value={mode.name} icon={getModeIcon(mode)} />
          ))}
        </List.Dropdown>
      }
    >
      {filteredRecordings.length === 0 && (recordings?.length ?? 0) > 0 ? (
        <List.EmptyView
          icon={Icon.Filter}
          title="No recordings for this mode"
          description={`No transcripts match "${selectedMode}". Try another mode or All Modes.`}
        />
      ) : null}
      {filteredRecordings.map((recording) => {
        const { meta } = recording;
        const rawResult = meta.rawResult?.trim() ?? "";
        const llmResult = meta.llmResult?.trim() ?? "";
        const primaryResult = getRecordingPrimaryText(recording.meta);
        let detailMarkdown = llmResult
          ? `### LLM Result
${llmResult}

### Raw Result
${rawResult || "_No raw result available._"}`
          : `### Result
${rawResult || "_No result available._"}`;
        if (meta.prompt?.trim()) {
          const promptBody = meta.prompt.trim();
          detailMarkdown += `

### Prompt
~~~
${promptBody}
~~~`;
        }

        const promptSummary = getPromptSummary(meta.prompt);

        const detailMetadata = (
          <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label title="Folder ID" text={recording.directory} />
            <List.Item.Detail.Metadata.Separator />
            {meta.duration != null && (
              <>
                <List.Item.Detail.Metadata.Label title="Duration" text={formatDurationMs(meta.duration)} />
                <List.Item.Detail.Metadata.Separator />
              </>
            )}
            {meta.modelName && (
              <>
                <List.Item.Detail.Metadata.Label title="Model" text={meta.modelName} />
                <List.Item.Detail.Metadata.Separator />
              </>
            )}
            {meta.modeName && (
              <>
                <List.Item.Detail.Metadata.Label title="Mode" text={meta.modeName} />
                <List.Item.Detail.Metadata.Separator />
              </>
            )}
            {meta.languageModelName && (
              <>
                <List.Item.Detail.Metadata.Label title="LLM Model" text={meta.languageModelName} />
                <List.Item.Detail.Metadata.Separator />
              </>
            )}
            {promptSummary && <List.Item.Detail.Metadata.Label title="Prompt" text={promptSummary} />}
          </List.Item.Detail.Metadata>
        );

        return (
          <List.Item
            key={recording.directory}
            icon={getIconForModeName(meta.modeName) ?? Icon.Document}
            title={format(recording.timestamp, "yyyy/MM/dd HH:mm:ss")}
            subtitle={meta.modeName ?? undefined}
            detail={<List.Item.Detail markdown={detailMarkdown} metadata={detailMetadata ?? undefined} />}
            actions={
              <ActionPanel>
                {latestHistoryText ? (
                  <Action.CopyToClipboard
                    title="Copy Last History"
                    content={latestHistoryText}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
                  />
                ) : null}
                {primaryResult ? (
                  <>
                    <Action.Paste title="Paste Result" content={primaryResult} />
                    <Action.CopyToClipboard title="Copy Result" content={primaryResult} />
                  </>
                ) : null}
                {llmResult ? (
                  <>
                    <Action.Paste
                      title="Paste Raw Result"
                      content={rawResult}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                    />
                    <Action.CopyToClipboard
                      title="Copy Raw Result"
                      content={rawResult}
                      shortcut={{ modifiers: ["cmd", "opt"], key: "enter" }}
                    />
                  </>
                ) : null}
                <Action.ShowInFinder
                  title="Show in Finder"
                  path={join(recordingsPath, recording.directory)}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                />
                <Action.CopyToClipboard
                  title="Copy Meeting ID"
                  content={recording.directory}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
                />
                {meta.prompt?.trim() ? (
                  <Action.CopyToClipboard title="Copy Prompt" content={meta.prompt.trim()} />
                ) : null}
                <Action
                  icon={Icon.Trash}
                  title="Delete Recording"
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    if (
                      await confirmAlert({
                        title: "Delete Recording",
                        message:
                          "This will permanently delete this transcript and its folder. This cannot be undone. \n" +
                          join(recordingsPath, recording.directory),
                        primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
                      })
                    ) {
                      try {
                        await deleteRecording(recordingsPath, recording.directory);
                        await showToast({
                          style: Toast.Style.Success,
                          title: "Recording deleted",
                          message: join(recordingsPath, recording.directory),
                        });
                        await revalidate();
                      } catch (err) {
                        await showToast({
                          style: Toast.Style.Failure,
                          title: "Delete failed",
                          message: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }
                  }}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
