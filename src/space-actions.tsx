import { Action, ActionPanel, closeMainWindow, Icon, List, Toast, showToast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveSpace, parseYabaiJson, runYabai, type YabaiWindow } from "./yabai";

type WindowEntry = {
  id: number;
  app: string;
  title: string;
  space: number;
  display: number;
};

const IGNORED_APPS = new Set([
  "Dock",
  "Finder",
  "Control Center",
  "SystemUIServer",
  "Notification Center",
  "WindowServer",
  "yabai",
  "Raycast",
  "Raycast Beta",
]);

async function listWindows(): Promise<WindowEntry[]> {
  const windows = parseYabaiJson<YabaiWindow[]>(await runYabai(["-m", "query", "--windows"]), "windows");

  if (!Array.isArray(windows)) {
    return [];
  }

  return windows
    .filter((window) => {
      if (!window || !window.app || !window.id) return false;
      if (window["is-hidden"] || window["is-minimized"]) return false;
      if (IGNORED_APPS.has(window.app)) return false;
      return true;
    })
    .map((window) => ({
      id: Number(window.id),
      app: window.app,
      title: window.title || window.app,
      space: Number(window.space),
      display: Number(window.display ?? 1),
    }))
    .sort((left, right) => {
      const appDifference = left.app.localeCompare(right.app);
      if (appDifference !== 0) return appDifference;
      return left.title.localeCompare(right.title);
    });
}

async function moveWindowToCurrentSpace(window: WindowEntry) {
  try {
    const { index: currentSpace, display: currentDisplay } = await getActiveSpace();
    await runYabai(["-m", "window", String(window.id), "--space", String(currentSpace)]);
    await runYabai(["-m", "window", String(window.id), "--display", String(currentDisplay)]);
    await runYabai(["-m", "window", String(window.id), "--focus"]);

    await showToast({
      style: Toast.Style.Success,
      title: "Window moved",
      message: `${window.title} is now on Space ${currentSpace} / Display ${currentDisplay}.`,
    });
    await closeMainWindow();
  } catch (error) {
    console.error("Failed to move yabai window", error);
    void showToast({
      style: Toast.Style.Failure,
      title: "Unable to move window",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function visitWindowSpace(window: WindowEntry) {
  try {
    await runYabai(["-m", "space", "--focus", String(window.space)]);

    await showToast({
      style: Toast.Style.Success,
      title: "Space visited",
      message: `Switched to Space ${window.space} / Display ${window.display}.`,
    });
    await closeMainWindow();
  } catch (error) {
    console.error("Failed to visit yabai space", error);
    void showToast({
      style: Toast.Style.Failure,
      title: "Unable to visit space",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function minimizeWindow(window: WindowEntry) {
  try {
    await runYabai(["-m", "window", String(window.id), "--minimize"]);

    await showToast({
      style: Toast.Style.Success,
      title: "Window minimized",
      message: window.title,
    });
    await closeMainWindow();
  } catch (error) {
    console.error("Failed to minimize yabai window", error);
    void showToast({
      style: Toast.Style.Failure,
      title: "Unable to minimize window",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export default function Command() {
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshWindows = useCallback(async () => {
    setIsLoading(true);
    try {
      setWindows(await listWindows());
    } catch (error) {
      console.error("Failed to query yabai windows", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't query yabai",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWindows();
  }, [refreshWindows]);

  const items = useMemo(() => windows, [windows]);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search windows" navigationTitle="All windows">
      {items.length > 0 ? (
        items.map((item) => (
          <List.Item
            key={`${item.app}-${item.id}-${item.title}`}
            icon={Icon.Window}
            title={item.title}
            subtitle={item.app}
            accessories={[{ text: `Space ${item.space} • Display ${item.display}` }]}
            actions={
              <ActionPanel>
                <Action
                  title="Bring to Current Space"
                  icon={Icon.ArrowRight}
                  onAction={() => moveWindowToCurrentSpace(item)}
                />
                <Action title="Visit Space" icon={Icon.Eye} onAction={() => visitWindowSpace(item)} />
                <Action
                  title="Minimize Window"
                  icon={Icon.Minus}
                  shortcut={{ modifiers: ["opt"], key: "return" }}
                  onAction={() => {
                    minimizeWindow(item);
                  }}
                />
                <Action title="Refresh" icon={Icon.RotateClockwise} onAction={() => void refreshWindows()} />
              </ActionPanel>
            }
          />
        ))
      ) : (
        <List.EmptyView
          title="No visible windows found"
          description="yabai is not reporting any open windows in the current session."
        />
      )}
    </List>
  );
}
