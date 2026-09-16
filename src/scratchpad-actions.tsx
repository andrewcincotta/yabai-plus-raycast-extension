import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  getApplications,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { existsSync } from "node:fs";
import { useCallback, useEffect, useState } from "react";
import {
  centerWindowOnDisplay,
  getActiveSpace,
  parseYabaiJson,
  runYabai,
  scratchpadLabel,
  type YabaiSpace,
  type YabaiWindow,
} from "./yabai";

type Scratchpad = YabaiWindow & { label: string };
type FormValues = { label: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fallbackAppPath(app: string): string | undefined {
  const paths = [
    `/Applications/${app}.app`,
    `/System/Applications/${app}.app`,
    `/System/Applications/Utilities/${app}.app`,
  ];
  return paths.find((path) => existsSync(path));
}

function CreateScratchpadForm({ window, onCreated }: { window: YabaiWindow; onCreated: () => Promise<void> }) {
  const { pop } = useNavigation();

  const createScratchpad = async ({ label }: FormValues) => {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      await showToast({ style: Toast.Style.Failure, title: "A scratchpad label is required" });
      return;
    }

    try {
      const currentSpace = await getActiveSpace();
      if (window.space !== currentSpace.index) {
        await runYabai(["-m", "window", String(window.id), "--space", String(currentSpace.index)]);
      }
      await runYabai(["-m", "window", String(window.id), "--scratchpad", cleanLabel]);
      await runYabai(["-m", "window", String(window.id), "--focus"]);
      await centerWindowOnDisplay(window.id, currentSpace.display);
      await onCreated();
      await showToast({ style: Toast.Style.Success, title: "Scratchpad created", message: cleanLabel });
      pop();
    } catch (error) {
      console.error("Could not create yabai scratchpad", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't create scratchpad",
        message: errorMessage(error),
      });
    }
  };

  return (
    <Form
      navigationTitle="Create Scratchpad"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Scratchpad" icon={Icon.Bookmark} onSubmit={createScratchpad} />
        </ActionPanel>
      }
    >
      <Form.Description
        title={`${window.app} — ${window.title || "Untitled window"}`}
        text={`Currently on Space ${window.space}. It will become an unmanaged floating scratchpad.`}
      />
      <Form.TextField id="label" title="Scratchpad Label" placeholder="Terminal" autoFocus />
    </Form>
  );
}

export default function Command() {
  const [windows, setWindows] = useState<YabaiWindow[]>([]);
  const [scratchpads, setScratchpads] = useState<Scratchpad[]>([]);
  const [appPaths, setAppPaths] = useState<Record<string, string>>({});
  const [activeSpace, setActiveSpace] = useState<YabaiSpace | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [windowsJson, currentSpace] = await Promise.all([runYabai(["-m", "query", "--windows"]), getActiveSpace()]);
      const queriedWindows = parseYabaiJson<YabaiWindow[]>(windowsJson, "windows").filter((window) =>
        Boolean(window?.id && window.app),
      );
      const queriedScratchpads = queriedWindows
        .flatMap((window) => {
          const label = scratchpadLabel(window);
          return label ? [{ ...window, label }] : [];
        })
        .sort((left, right) => left.label.localeCompare(right.label) || left.app.localeCompare(right.app));

      setWindows(
        queriedWindows.sort(
          (left, right) => left.app.localeCompare(right.app) || left.title.localeCompare(right.title),
        ),
      );
      setScratchpads(queriedScratchpads);
      setActiveSpace(currentSpace);
    } catch (error) {
      console.error("Could not query yabai windows", error);
      await showToast({ style: Toast.Style.Failure, title: "Couldn't load windows", message: errorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getApplications()
      .then((applications) => {
        setAppPaths(Object.fromEntries(applications.map((app) => [app.name.toLowerCase(), app.path])));
      })
      .catch((error) => console.error("Could not load application icons", error));
  }, [refresh]);

  const appIcon = (app: string) => {
    const path = appPaths[app.toLowerCase()] ?? fallbackAppPath(app);
    return path ? { fileIcon: path } : Icon.AppWindow;
  };

  const summon = async (scratchpad: Scratchpad) => {
    if (activeSpace === null) return;

    try {
      if (scratchpad.space === activeSpace.index) {
        await runYabai(["-m", "window", String(scratchpad.id), "--space", "6"]);
        await showToast({
          style: Toast.Style.Success,
          title: "Scratchpad hidden",
          message: `${scratchpad.label} moved to Space 6.`,
        });
      } else {
        await runYabai(["-m", "window", String(scratchpad.id), "--space", String(activeSpace.index)]);
        await centerWindowOnDisplay(scratchpad.id, activeSpace.display);
        await runYabai(["-m", "window", String(scratchpad.id), "--focus"]);
        await showToast({
          style: Toast.Style.Success,
          title: "Scratchpad summoned",
          message: `${scratchpad.label} is on Space ${activeSpace.index}.`,
        });
      }
      await closeMainWindow();
    } catch (error) {
      console.error("Could not summon yabai scratchpad", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't summon scratchpad",
        message: errorMessage(error),
      });
    }
  };

  const removeScratchpad = async (scratchpad: Scratchpad) => {
    try {
      await runYabai(["-m", "window", String(scratchpad.id), "--scratchpad"]);
      await refresh();
      await showToast({ style: Toast.Style.Success, title: "Scratchpad identity removed", message: scratchpad.label });
    } catch (error) {
      console.error("Could not remove yabai scratchpad", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't remove scratchpad",
        message: errorMessage(error),
      });
    }
  };

  const scratchpadMode = scratchpads.length > 0;

  return (
    <List
      isLoading={isLoading}
      navigationTitle={scratchpadMode ? "Scratchpad Actions" : "Choose a Window to Make a Scratchpad"}
      searchBarPlaceholder={scratchpadMode ? "Search scratchpads" : "Search windows"}
    >
      {scratchpadMode ? (
        scratchpads.map((scratchpad) => {
          const isHere = scratchpad.space === activeSpace?.index;
          return (
            <List.Item
              key={scratchpad.id}
              icon={appIcon(scratchpad.app)}
              title={scratchpad.label}
              subtitle={`${scratchpad.app} — ${scratchpad.title || "Untitled window"}`}
              accessories={[{ text: `Space ${scratchpad.space}` }]}
              actions={
                <ActionPanel>
                  <Action
                    title={isHere ? "Hide on Space 6" : "Summon to Current Space"}
                    icon={isHere ? Icon.EyeDisabled : Icon.ArrowRight}
                    onAction={() => void summon(scratchpad)}
                  />
                  <Action
                    title="Remove Scratchpad Identity"
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["cmd"], key: "x" }}
                    onAction={() => void removeScratchpad(scratchpad)}
                  />
                  <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => void refresh()} />
                </ActionPanel>
              }
            />
          );
        })
      ) : windows.length ? (
        windows.map((window) => (
          <List.Item
            key={window.id}
            icon={appIcon(window.app)}
            title={window.app}
            subtitle={window.title || "Untitled window"}
            accessories={[{ text: `Space ${window.space}` }]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Make Scratchpad"
                  icon={Icon.Bookmark}
                  target={<CreateScratchpadForm window={window} onCreated={refresh} />}
                />
                <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => void refresh()} />
              </ActionPanel>
            }
          />
        ))
      ) : (
        <List.EmptyView
          icon={Icon.Window}
          title="No windows found"
          description="yabai is not reporting any windows in this session."
          actions={
            <ActionPanel>
              <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => void refresh()} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
