import { Action, ActionPanel, closeMainWindow, Icon, List, Toast, showToast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveSpace, parseYabaiJson, runYabai, type YabaiWindow } from "./yabai";
import { clearWindowMove, pruneWindowMoves, recordWindowMove, type WindowMove, type WindowMoves } from "./window-moves";

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

function toWindowEntries(windows: YabaiWindow[]): WindowEntry[] {
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

    // Logged silently so Send Back can return the window; a logging failure must not undo the move.
    if (window.space !== currentSpace) {
      try {
        await recordWindowMove({
          windowId: window.id,
          app: window.app,
          title: window.title,
          fromSpace: window.space,
          fromDisplay: window.display,
          toSpace: currentSpace,
          toDisplay: currentDisplay,
          movedAt: new Date().toISOString(),
        });
      } catch (logError) {
        console.error("Failed to log window move", logError);
      }
    }

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

/** Returns the window to where it came from without following it there. */
async function sendWindowBack(window: WindowEntry, move: WindowMove) {
  try {
    await runYabai(["-m", "window", String(window.id), "--space", String(move.fromSpace)]);
    await clearWindowMove(window.id);

    await showToast({
      style: Toast.Style.Success,
      title: "Window sent back",
      message: `${window.title} returned to Space ${move.fromSpace} / Display ${move.fromDisplay}.`,
    });
    await closeMainWindow();
  } catch (error) {
    console.error("Failed to send yabai window back", error);
    void showToast({
      style: Toast.Style.Failure,
      title: "Unable to send window back",
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
  const [moves, setMoves] = useState<WindowMoves>({});
  const [isLoading, setIsLoading] = useState(true);

  const refreshWindows = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsed = parseYabaiJson<YabaiWindow[]>(await runYabai(["-m", "query", "--windows"]), "windows");
      const allWindows = Array.isArray(parsed) ? parsed : [];
      setWindows(toWindowEntries(allWindows));

      try {
        setMoves(await pruneWindowMoves(new Set(allWindows.map((window) => Number(window.id)))));
      } catch (logError) {
        console.error("Failed to read window move log", logError);
      }
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
        items.map((item) => {
          const move = moves[item.id];
          return (
            <List.Item
              key={`${item.app}-${item.id}-${item.title}`}
              icon={Icon.Window}
              title={item.title}
              subtitle={item.app}
              accessories={[
                ...(move
                  ? [{ icon: Icon.ArrowCounterClockwise, tooltip: `Moved here from Space ${move.fromSpace}` }]
                  : []),
                { text: `Space ${item.space} • Display ${item.display}` },
              ]}
              actions={
                <ActionPanel>
                  {/* A moved window defaults to Send Back (↵); Bring to Current Space drops to ⌘↵. */}
                  {move && (
                    <Action
                      title={`Send Back to Space ${move.fromSpace}`}
                      icon={Icon.ArrowCounterClockwise}
                      onAction={() => sendWindowBack(item, move)}
                    />
                  )}
                  <Action
                    title="Bring to Current Space"
                    icon={Icon.ArrowRight}
                    shortcut={move ? { modifiers: ["cmd"], key: "return" } : undefined}
                    onAction={() => moveWindowToCurrentSpace(item)}
                  />
                  <Action
                    title="Visit Space"
                    icon={Icon.Eye}
                    shortcut={{ modifiers: ["shift"], key: "return" }}
                    onAction={() => visitWindowSpace(item)}
                  />
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
          );
        })
      ) : (
        <List.EmptyView
          title="No visible windows found"
          description="yabai is not reporting any open windows in the current session."
        />
      )}
    </List>
  );
}
