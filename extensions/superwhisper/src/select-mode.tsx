import { Action, ActionPanel, Color, Icon, Image, List, open, openCommandPreferences, showToast } from "@raycast/api";
import { SUPERWHISPER_BUNDLE_ID } from "./utils";
import { useModes } from "./hooks";

async function startRecordingWithMode(key: string, name: string) {
  await open(`superwhisper://mode?key=${key}`, SUPERWHISPER_BUNDLE_ID);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await open("superwhisper://record", SUPERWHISPER_BUNDLE_ID);
  await showToast({ title: `Started recording with ${name} mode` });
}

export interface Mode {
  key: string;
  name: string;
  description?: string;
  iconName?: string;
  type?: string;
  adjustOutputVolume?: boolean;
  language?: string;
  useSystemAudio?: boolean;
  diarize?: boolean;
  literalPunctuation?: boolean;
  languageModelID?: string;
  contextFromClipboard?: boolean;
  translateToEnglish?: boolean;
  voiceModelID?: string;
  realtimeOutput?: boolean;
  contextFromActiveApplication?: boolean;
}

const MODE_TYPE_ICONS: Record<string, Icon> = {
  Default: Icon.Microphone,
  Meeting: Icon.TwoPeople,
  Mail: Icon.Envelope,
  Message: Icon.Message,
  Note: Icon.Document,
  Custom: Icon.SquareEllipsis,
};

function normalizeTypeOrName(s: string | undefined): string | undefined {
  if (!s?.trim()) return undefined;
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function getIconForModeType(type: string | undefined): Icon {
  if (!type) return Icon.Microphone;
  const direct = MODE_TYPE_ICONS[type];
  if (direct) return direct;
  const key = normalizeTypeOrName(type);
  const byKey = key ? MODE_TYPE_ICONS[key] : undefined;
  return byKey ?? Icon.Microphone;
}

export function getIconForModeName(modeName: string | undefined): Icon | undefined {
  if (!modeName?.trim()) return undefined;
  const normalized = normalizeTypeOrName(modeName.trim());
  return normalized ? MODE_TYPE_ICONS[normalized] ?? undefined : undefined;
}

export function getModeIcon(mode: Mode): Image.ImageLike {
  const iconName = mode.iconName?.trim();
  const typeIcon = getIconForModeType(mode.type);
  if (iconName) {
    return { source: `${iconName}.png`, fallback: typeIcon };
  }
  const nameIcon = getIconForModeName(mode.name);
  return nameIcon ?? typeIcon;
}

export default function Command() {
  const { modes, isLoading, error } = useModes();
  const isShowingDetail = !isLoading && !error && (modes?.length || 0) > 0;

  return (
    <List isLoading={isLoading} isShowingDetail={isShowingDetail}>
      {error && (
        <List.EmptyView
          title="Failed to fetch modes"
          description={error.message}
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          actions={
            <ActionPanel>
              {error.message.includes("not installed") ? (
                <Action.OpenInBrowser url="https://superwhisper.com" title={"Install From superwhisper.com"} />
              ) : (
                <Action icon={Icon.Gear} title={"Open Preferences"} onAction={openCommandPreferences} />
              )}
            </ActionPanel>
          }
        />
      )}
      {!isLoading && !error && modes?.length === 0 && (
        <List.EmptyView
          title="No modes found"
          description="Check if mode directory is correct."
          icon={{ source: Icon.Warning, tintColor: Color.Orange }}
          actions={
            <ActionPanel>
              <Action icon={Icon.Gear} title={"Open Preferences"} onAction={openCommandPreferences} />
            </ActionPanel>
          }
        />
      )}
      {modes?.map(
        (
          {
            key,
            name = "Default",
            description = "",
            iconName,
            type,
            adjustOutputVolume,
            language,
            useSystemAudio,
            diarize,
            literalPunctuation,
            languageModelID,
            contextFromClipboard,
            translateToEnglish,
            voiceModelID,
            realtimeOutput,
            contextFromActiveApplication,
          },
          index,
        ) => (
          <List.Item
            key={key}
            icon={getModeIcon({ key, name, iconName, type })}
            title={name}
            subtitle={`⌘${index + 1}`}
            detail={
              <List.Item.Detail
                markdown={description ? description : undefined}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Key" text={key} />
                    <List.Item.Detail.Metadata.Label title="Name" text={name} />
                    {language && (
                      <List.Item.Detail.Metadata.Label
                        title="Language"
                        text={language}
                        icon={{ source: Icon.Microphone, tintColor: Color.Blue }}
                      />
                    )}
                    {languageModelID && (
                      <List.Item.Detail.Metadata.Label
                        title="Language Model ID"
                        text={languageModelID}
                        icon={{ source: Icon.Dna, tintColor: Color.Yellow }}
                      />
                    )}
                    {voiceModelID && (
                      <List.Item.Detail.Metadata.Label
                        title="Voice Model ID"
                        text={voiceModelID}
                        icon={{ source: Icon.Waveform, tintColor: Color.Blue }}
                      />
                    )}
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title="Adjust Output Volume"
                      {...booleanProps(!!adjustOutputVolume)}
                    />
                    <List.Item.Detail.Metadata.Label title="Use System Audio" {...booleanProps(!!useSystemAudio)} />
                    <List.Item.Detail.Metadata.Label title="Diarize" {...booleanProps(!!diarize)} />
                    <List.Item.Detail.Metadata.Label
                      title="Literal Punctuation"
                      {...booleanProps(!!literalPunctuation)}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="Context From Clipboard"
                      {...booleanProps(!!contextFromClipboard)}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="Translate To English"
                      {...booleanProps(!!translateToEnglish)}
                    />
                    <List.Item.Detail.Metadata.Label title="Realtime Output" {...booleanProps(!!realtimeOutput)} />
                    <List.Item.Detail.Metadata.Label
                      title="Context From Active Application"
                      {...booleanProps(!!contextFromActiveApplication)}
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            accessories={[
              ...(language
                ? [
                    {
                      text: language,
                      icon: { source: Icon.Microphone, tintColor: Color.Blue },
                      tooltip: `Language: ${language}`,
                    },
                  ]
                : []),
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section title={name}>
                  <Action.Open
                    icon={Icon.Circle}
                    title={`Select ${name} Mode`}
                    target={`superwhisper://mode?key=${key}`}
                    application={SUPERWHISPER_BUNDLE_ID}
                    onOpen={() => showToast({ title: `Selected ${name} mode for Superwhisper` })}
                  />
                  <Action
                    icon={Icon.Microphone}
                    title={`Start Recording with ${name}`}
                    onAction={() => startRecordingWithMode(key, name)}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ),
      )}
    </List>
  );
}

function booleanProps(flag: boolean) {
  return {
    text: { value: flag ? "Yes" : "No", color: flag ? Color.Green : Color.Red },
    icon: { source: flag ? Icon.Checkmark : Icon.Xmark, tintColor: flag ? Color.Green : Color.Red },
  };
}
