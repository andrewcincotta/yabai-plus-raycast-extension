import { Action, ActionPanel, closeMainWindow, Icon, List, Toast, showHUD, showToast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getActiveSpace,
  getMouseSpace,
  getSpaces,
  parseYabaiJson,
  runYabai,
  spaceName,
  type YabaiWindow,
} from "./yabai";
import { clearWindowMove, pruneWindowMoves, recordWindowMove, type WindowMove, type WindowMoves } from "./window-moves";

type WindowEntry = {
  id: number;
  app: string;
  title: string;
  space: number;
  spaceLabel?: string;
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

function toWindowEntries(windows: YabaiWindow[], spaceLabels: Map<number, string>): WindowEntry[] {
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
      spaceLabel: spaceLabels.get(Number(window.space)),
      display: Number(window.display ?? 1),
    }))
    .sort((left, right) => {
      const appDifference = left.app.localeCompare(right.app);
      if (appDifference !== 0) return appDifference;
      return left.title.localeCompare(right.title);
    });
}

/** Moves the window to the space shown on the display under the cursor, not the focused display. */
async function moveWindowToCurrentSpace(window: WindowEntry) {
  try {
    const target = await getMouseSpace().catch((error) => {
      console.error("Failed to query the space under the mouse, using the active space", error);
      return getActiveSpace();
    });
    const { index: currentSpace, display: currentDisplay } = target;
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
          fromSpaceLabel: window.spaceLabel,
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
      message: `${window.title} is now on ${spaceName(currentSpace, target.label)} / Display ${currentDisplay}.`,
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

/**
 * Returns the window to where it came from without following it there. Targets
 * the space by label when one was logged, so it still lands right if spaces
 * were added or reordered since the move.
 */
async function sendWindowBack(window: WindowEntry, move: WindowMove, fromName: string) {
  try {
    await runYabai(["-m", "window", String(window.id), "--space", move.fromSpaceLabel || String(move.fromSpace)]);
    await clearWindowMove(window.id);

    // A HUD rather than a toast so the destination stays visible after Raycast closes.
    await showHUD(`${window.app} sent back to ${fromName} • Display ${move.fromDisplay}`);
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
      message: `Switched to ${spaceName(window.space, window.spaceLabel)} / Display ${window.display}.`,
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
  const [spaceLabels, setSpaceLabels] = useState<Map<number, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const refreshWindows = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsed = parseYabaiJson<YabaiWindow[]>(await runYabai(["-m", "query", "--windows"]), "windows");
      const allWindows = Array.isArray(parsed) ? parsed : [];

      // Labels are only for display, so an unlabeled or failed query falls back to "Space N".
      const labels = new Map<number, string>();
      try {
        for (const space of await getSpaces()) {
          if (space.label) labels.set(space.index, space.label);
        }
      } catch (spaceError) {
        console.error("Failed to query yabai space labels", spaceError);
      }
      setSpaceLabels(labels);
      setWindows(toWindowEntries(allWindows, labels));

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

  // Windows that can be sent back are pulled into their own section at the top.
  const [movedItems, otherItems] = useMemo(() => {
    const moved = windows.filter((window) => moves[window.id]);
    const others = windows.filter((window) => !moves[window.id]);
    return [moved, others];
  }, [windows, moves]);

  const renderItem = (item: WindowEntry) => {
    const move = moves[item.id];
    // Moves logged before labels were recorded fall back to the space's current label.
    const fromName = move ? spaceName(move.fromSpace, move.fromSpaceLabel || spaceLabels.get(move.fromSpace)) : "";
    return (
      <List.Item
        key={`${item.app}-${item.id}-${item.title}`}
        icon={Icon.Window}
        title={item.title}
        subtitle={item.app}
        accessories={[
          ...(move
            ? [
                {
                  icon: Icon.ArrowCounterClockwise,
                  text: fromName,
                  tooltip: `Moved here from ${fromName} / Display ${move.fromDisplay}`,
                },
              ]
            : []),
          { text: `${spaceName(item.space, item.spaceLabel)} • Display ${item.display}` },
        ]}
        actions={
          <ActionPanel>
            {/* A moved window defaults to Send Back (↵); Bring to Current Space drops to ⌘↵. */}
            {move && (
              <Action
                title={`Send Back to ${fromName}`}
                icon={Icon.ArrowCounterClockwise}
                onAction={() => sendWindowBack(item, move, fromName)}
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
  };

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search windows" navigationTitle="All windows">
      {windows.length > 0 ? (
        <>
          <List.Section title="Send Back">{movedItems.map(renderItem)}</List.Section>
          <List.Section title={movedItems.length > 0 ? "Other Windows" : undefined}>
            {otherItems.map(renderItem)}
          </List.Section>
        </>
      ) : (
        <List.EmptyView
          title="No visible windows found"
          description="yabai is not reporting any open windows in the current session."
        />
      )}
    </List>
  );
}
