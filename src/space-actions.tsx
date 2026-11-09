import {
  Action,
  ActionPanel,
  closeMainWindow,
  Icon,
  Keyboard,
  List,
  PopToRootType,
  Toast,
  showHUD,
  showToast,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  centerOnDisplay,
  getActiveSpace,
  getMouseSpace,
  getSpaces,
  moveWindowToSpace,
  parseYabaiJson,
  runYabai,
  spaceName,
  spaceSelector,
  type YabaiSpace,
  type YabaiWindow,
} from "./yabai";
import {
  clearWindowMove,
  reconcileWindowMoves,
  recordWindowMove,
  type WindowLocation,
  type WindowMove,
  type WindowMoves,
} from "./window-moves";

type WindowEntry = {
  id: number;
  app: string;
  title: string;
  space: number;
  spaceLabel?: string;
  display: number;
  isFloating: boolean;
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
      isFloating: window["is-floating"] === true,
    }))
    .sort((left, right) => {
      const appDifference = left.app.localeCompare(right.app);
      if (appDifference !== 0) return appDifference;
      return left.title.localeCompare(right.title);
    });
}

/** The space shown on the display under the cursor, falling back to the active space. */
function getCursorSpace(): Promise<YabaiSpace> {
  return getMouseSpace().catch((error) => {
    console.error("Failed to query the space under the mouse, using the active space", error);
    return getActiveSpace();
  });
}

/**
 * Moves the window to the space shown on the display under the cursor, not the
 * focused display. A floating window keeps its frame through a space move, so
 * it's centered on that display; otherwise it can stay on or straddle its old one.
 */
async function moveWindowToCurrentSpace(window: WindowEntry, cursorSpace: YabaiSpace | null) {
  try {
    const target = cursorSpace ?? (await getCursorSpace());
    const { index: currentSpace, display: currentDisplay } = target;
    await moveWindowToSpace(window.id, currentSpace);
    if (window.isFloating) {
      await centerOnDisplay(window.id, currentDisplay);
    }
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
    await closeMainWindow({ popToRootType: PopToRootType.Immediate });
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
    await runYabai(["-m", "window", String(window.id), "--space", spaceSelector(move.fromSpace, move.fromSpaceLabel)]);
    await clearWindowMove(window.id);

    // A HUD rather than a toast so the destination stays visible after Raycast closes.
    await showHUD(`${window.app} sent back to ${fromName} • Display ${move.fromDisplay}`, {
      popToRootType: PopToRootType.Immediate,
    });
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
    await runYabai(["-m", "space", "--focus", spaceSelector(window.space, window.spaceLabel)]);

    await showToast({
      style: Toast.Style.Success,
      title: "Space visited",
      message: `Switched to ${spaceName(window.space, window.spaceLabel)} / Display ${window.display}.`,
    });
    await closeMainWindow({ popToRootType: PopToRootType.Immediate });
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
    await closeMainWindow({ popToRootType: PopToRootType.Immediate });
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
  // Captured when the command opens, so the target is the display the cursor was on when Raycast was invoked.
  const cursorSpace = useRef<YabaiSpace | null>(null);

  useEffect(() => {
    getCursorSpace()
      .then((space) => {
        cursorSpace.current = space;
      })
      .catch((error) => console.error("Failed to query the active space", error));
  }, []);

  const refreshWindows = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsed = parseYabaiJson<YabaiWindow[]>(await runYabai(["-m", "query", "--windows"]), "windows");
      const allWindows = Array.isArray(parsed) ? parsed : [];

      // Without labels, names fall back to "Space N" and actions target spaces by index.
      const labels = new Map<number, string>();
      try {
        for (const space of await getSpaces()) {
          if (space.label) labels.set(space.index, space.label);
        }
      } catch (spaceError) {
        console.error("Failed to query yabai space labels", spaceError);
      }
      setWindows(toWindowEntries(allWindows, labels));

      // Checked against the windows just queried, so a window already back on its origin space drops out of Send Back.
      const locations = new Map<number, WindowLocation>(
        allWindows.map((window) => [
          Number(window.id),
          { space: Number(window.space), spaceLabel: labels.get(Number(window.space)) },
        ]),
      );
      try {
        setMoves(await reconcileWindowMoves(locations, labels));
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
    const fromName = move ? spaceName(move.fromSpace, move.fromSpaceLabel) : "";
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
              onAction={() => moveWindowToCurrentSpace(item, cursorSpace.current)}
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
            <Action
              title="Refresh"
              icon={Icon.RotateClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={() => void refreshWindows()}
            />
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
