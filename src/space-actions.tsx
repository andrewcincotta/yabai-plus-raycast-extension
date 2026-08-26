import { Action, ActionPanel, Icon, List, Toast, showToast } from "@raycast/api";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { useEffect, useMemo, useState } from "react";

type YabaiWindow = {
  id: number;
  app: string;
  title: string;
  space: number;
  display: number;
  "is-visible": boolean;
  "is-minimized": boolean;
  "is-hidden": boolean;
};

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

function runYabai(args: string[]): string {
  const env = {
    ...process.env,
    USER: process.env.USER ?? os.userInfo().username,
  };

  return execFileSync("yabai", args, {
    encoding: "utf8",
    timeout: 10000,
    env,
  }).trim();
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error("Invalid yabai JSON response", error);
    return null;
  }
}

function getCurrentSpaceIndex(): number {
  const currentSpace = parseJson<{ index?: number }>(runYabai(["-m", "query", "--spaces", "--space"]));
  return currentSpace?.index ?? 1;
}

function getCurrentDisplayIndex(): number {
  const currentDisplay = parseJson<{ index?: number }>(runYabai(["-m", "query", "--displays", "--display"]));
  return currentDisplay?.index ?? 1;
}

function listWindows(): WindowEntry[] {
  const raw = runYabai(["-m", "query", "--windows"]);
  const windows = parseJson<YabaiWindow[]>(raw);

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
      space: Number(window.space ?? getCurrentSpaceIndex()),
      display: Number(window.display ?? 1),
    }))
    .sort((left, right) => {
      const appDifference = left.app.localeCompare(right.app);
      if (appDifference !== 0) return appDifference;
      return left.title.localeCompare(right.title);
    });
}

function moveWindowToCurrentSpace(window: WindowEntry) {
  try {
    const currentSpace = getCurrentSpaceIndex();
    const currentDisplay = getCurrentDisplayIndex();
    runYabai(["-m", "window", String(window.id), "--space", String(currentSpace)]);
    runYabai(["-m", "window", String(window.id), "--display", String(currentDisplay)]);
    runYabai(["-m", "window", String(window.id), "--focus"]);

    void showToast({
      style: Toast.Style.Success,
      title: "Window moved",
      message: `${window.title} is now on Space ${currentSpace} / Display ${currentDisplay}.`,
    });
  } catch (error) {
    console.error("Failed to move yabai window", error);
    void showToast({
      style: Toast.Style.Failure,
      title: "Unable to move window",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function visitWindowSpace(window: WindowEntry) {
  try {
    runYabai(["-m", "space", "--focus", String(window.space)]);

    void showToast({
      style: Toast.Style.Success,
      title: "Space visited",
      message: `Switched to Space ${window.space} / Display ${window.display}.`,
    });
  } catch (error) {
    console.error("Failed to visit yabai space", error);
    void showToast({
      style: Toast.Style.Failure,
      title: "Unable to visit space",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function minimizeWindow(window: WindowEntry) {
  try {
    runYabai(["-m", "window", String(window.id), "--minimize"]);

    void showToast({
      style: Toast.Style.Success,
      title: "Window minimized",
      message: window.title,
    });
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

  const refreshWindows = () => {
    setIsLoading(true);
    try {
      setWindows(listWindows());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshWindows();
  }, []);

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
                  title="Bring to Current Space and Display"
                  icon={Icon.ArrowRight}
                  onAction={() => moveWindowToCurrentSpace(item)}
                />
                <Action title="Visit Space" icon={Icon.Eye} onAction={() => visitWindowSpace(item)} />
                <Action
                  title="Minimize Window"
                  icon={Icon.Minus}
                  onAction={() => {
                    minimizeWindow(item);
                    refreshWindows();
                  }}
                />
                <Action title="Refresh" icon={Icon.RotateClockwise} onAction={refreshWindows} />
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
