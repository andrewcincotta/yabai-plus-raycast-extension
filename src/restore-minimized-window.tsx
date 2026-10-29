import {
  ActionPanel,
  Action,
  closeMainWindow,
  List,
  Icon,
  showToast,
  Toast,
  Keyboard,
  getApplications,
} from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { existsSync } from "node:fs";
import {
  centerOnDisplay,
  getActiveSpace,
  getMouseSpace,
  moveWindowToSpace,
  parseYabaiJson,
  runYabai,
  waitForWindow,
  type YabaiSpace,
  type YabaiWindow,
} from "./yabai";

export default function Command() {
  const [windows, setWindows] = useState<YabaiWindow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [appPaths, setAppPaths] = useState<Record<string, string>>({});
  // The space shown on the display under the cursor when the command opened.
  // Captured up front because deminimizing can make macOS switch to the
  // window's old space before we move it.
  const launchSpace = useRef<YabaiSpace | null>(null);

  useEffect(() => {
    getMouseSpace()
      .catch((error) => {
        console.error("Error querying the space under the mouse, using the active space:", error);
        return getActiveSpace();
      })
      .then((space) => {
        launchSpace.current = space;
      })
      .catch((error) => console.error("Error querying active space:", error));
  }, []);

  useEffect(() => {
    async function loadApps() {
      try {
        const apps = await getApplications();
        const map: Record<string, string> = {};
        for (const app of apps) {
          map[app.name] = app.path;
        }
        setAppPaths(map);
      } catch (error) {
        console.error("Failed to load applications:", error);
      }
    }
    loadApps();
  }, []);

  const getAppIcon = useCallback(
    (appName: string) => {
      const path = appPaths[appName];
      if (path) {
        return { fileIcon: path };
      }

      const lowerName = appName.toLowerCase();
      const resolvedPath = Object.entries(appPaths).find(([name]) => name.toLowerCase() === lowerName)?.[1];
      if (resolvedPath) {
        return { fileIcon: resolvedPath };
      }

      const fallbackPaths = [
        `/Applications/${appName}.app`,
        `/System/Applications/${appName}.app`,
        `/System/Applications/Utilities/${appName}.app`,
      ];
      for (const fallbackPath of fallbackPaths) {
        if (existsSync(fallbackPath)) {
          return { fileIcon: fallbackPath };
        }
      }

      return Icon.AppWindow;
    },
    [appPaths],
  );

  const fetchMinimizedWindows = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsed = parseYabaiJson<YabaiWindow[]>(await runYabai(["-m", "query", "--windows"]), "windows");
      const minimized = parsed.filter((win) => win["is-minimized"] === true);
      setWindows(minimized.reverse());
    } catch (error) {
      console.error("Error querying yabai minimized windows:", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't query yabai",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMinimizedWindows();
  }, [fetchMinimizedWindows]);

  // yabai keeps a window's float state through minimize and deminimize, so a
  // tiled window comes back tiled and an unmanaged one stays floating.
  async function deminimize(win: YabaiWindow, options: { moveToCursorSpace: boolean } = { moveToCursorSpace: true }) {
    try {
      const targetSpace = options.moveToCursorSpace ? (launchSpace.current ?? (await getMouseSpace())) : null;

      await runYabai(["-m", "window", "--deminimize", String(win.id)]);
      // Moving mid-animation gets undone when macOS finishes restoring the window.
      await waitForWindow(win.id, (window) => !window["is-minimized"]);

      if (targetSpace) {
        try {
          await moveWindowToSpace(win.id, targetSpace.index);
        } catch (moveError) {
          console.error(`Failed to move window ${win.id} to space ${targetSpace.index}:`, moveError);
          // Don't focus: that would pull you over to the window's old space.
          await showToast({
            style: Toast.Style.Failure,
            title: "Restored, but not to this space",
            message: moveError instanceof Error ? moveError.message : String(moveError),
          });
          return;
        }

        if (win["is-floating"] === true) {
          try {
            await centerOnDisplay(win.id, targetSpace.display);
          } catch (centerError) {
            console.error(`Failed to center window ${win.id} on display ${targetSpace.display}:`, centerError);
          }
        }
      }

      try {
        await runYabai(["-m", "window", "--focus", String(win.id)]);
      } catch (focusError) {
        console.error(`Failed to focus window ${win.id}:`, focusError);
      }

      await showToast({
        style: Toast.Style.Success,
        title: "Restored window",
        message: `${win.app} — ${win.title}`,
      });
      await closeMainWindow();
    } catch (error) {
      console.error(`Error deminimizing window ${win.id}:`, error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to deminimize",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function closeWindow(win: YabaiWindow) {
    try {
      await runYabai(["-m", "window", String(win.id), "--close"]);
      await showToast({
        style: Toast.Style.Success,
        title: "Closed window",
        message: `${win.app} — ${win.title}`,
      });
      await closeMainWindow();
    } catch (error) {
      console.error(`Error closing window ${win.id}:`, error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to close window",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter minimized windows...">
      {!isLoading && windows.length === 0 ? (
        <List.EmptyView
          icon={Icon.Window}
          title="No minimized windows"
          description="Everything yabai knows about is already visible."
        />
      ) : (
        windows.map((win) => (
          <List.Item
            key={win.id}
            icon={getAppIcon(win.app)}
            title={win.app}
            subtitle={win.title || "(untitled window)"}
            accessories={[{ text: `Space ${win.space}` }]}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action
                    title="Deminimize & Focus"
                    icon={Icon.Eye}
                    onAction={() => deminimize(win, { moveToCursorSpace: true })}
                  />
                  <Action
                    title="Deminimize to Original Space"
                    icon={Icon.ChevronLeft}
                    shortcut={{ modifiers: ["shift"], key: "return" }}
                    onAction={() => deminimize(win, { moveToCursorSpace: false })}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title="Close Window"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
                    onAction={() => closeWindow(win)}
                  />
                  <Action
                    title="Refresh List"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={fetchMinimizedWindows}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
