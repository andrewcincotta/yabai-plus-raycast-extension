import {
  ActionPanel,
  Action,
  List,
  Icon,
  showToast,
  Toast,
  getPreferenceValues,
  Keyboard,
  getApplications,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { userInfo } from "os";

const execAsync = promisify(exec);

async function execYabaiCommand(command: string) {
  return execAsync(command, {
    env: {
      ...process.env,
      USER: userInfo().username,
    },
  });
}

interface Preferences {
  yabaiPath?: string;
}

interface YabaiWindow {
  id: number;
  app: string;
  title: string;
  space: number;
  display: number;
  "is-minimized": boolean;
  "is-floating": boolean;
}

interface YabaiSpace {
  index: number;
  "has-focus": boolean;
  display: number;
}

function getAbsoluteYabaiPath(prefPath: string | undefined): string {
  if (prefPath && prefPath.trim() !== "") {
    return prefPath.trim();
  }
  const standardPaths = ["/opt/homebrew/bin/yabai", "/usr/local/bin/yabai", "/usr/bin/yabai", "/bin/yabai"];
  for (const path of standardPaths) {
    if (existsSync(path)) {
      return path;
    }
  }
  return "yabai";
}

async function getActiveSpaceIndex(yabaiPath: string): Promise<number | null> {
  try {
    const { stdout } = await execYabaiCommand(`${yabaiPath} -m query --spaces --space`);
    const spaceInfo: YabaiSpace = JSON.parse(stdout.trim());
    return spaceInfo.index;
  } catch (error) {
    console.error("Error querying active space index:", error);
    return null;
  }
}

export default function Command() {
  const { yabaiPath: prefYabaiPath } = getPreferenceValues<Preferences>();
  const yabaiPath = getAbsoluteYabaiPath(prefYabaiPath);
  const [windows, setWindows] = useState<YabaiWindow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [appPaths, setAppPaths] = useState<Record<string, string>>({});

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
      const { stdout } = await execYabaiCommand(`${yabaiPath} -m query --windows`);
      const parsed: YabaiWindow[] = JSON.parse(stdout || "[]");
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
  }, [yabaiPath]);

  useEffect(() => {
    fetchMinimizedWindows();
  }, [fetchMinimizedWindows]);

  async function deminimize(
    win: YabaiWindow,
    options: { moveToActiveSpace: boolean; tileWindow: boolean } = { moveToActiveSpace: true, tileWindow: true },
  ) {
    try {
      let activeSpaceIndex: number | null = null;
      if (options.moveToActiveSpace) {
        activeSpaceIndex = await getActiveSpaceIndex(yabaiPath);
      }

      await execYabaiCommand(`${yabaiPath} -m window --deminimize ${win.id}`);

      if (options.moveToActiveSpace && activeSpaceIndex !== null && win.space !== activeSpaceIndex) {
        try {
          await execYabaiCommand(`${yabaiPath} -m window ${win.id} --space ${activeSpaceIndex}`);
        } catch (moveError) {
          console.error(`Failed to move window ${win.id} to space ${activeSpaceIndex}:`, moveError);
        }
      }

      try {
        await execYabaiCommand(`${yabaiPath} -m window --focus ${win.id}`);
      } catch (focusError) {
        console.error(`Failed to focus window ${win.id}:`, focusError);
      }

      if (options.tileWindow && win["is-floating"] === true) {
        try {
          await execYabaiCommand(`${yabaiPath} -m window ${win.id} --toggle float`);
        } catch (floatError) {
          console.error(`Failed to toggle float off for window ${win.id}:`, floatError);
        }
      }

      await showToast({
        style: Toast.Style.Success,
        title: "Restored window",
        message: `${win.app} — ${win.title}`,
      });
      fetchMinimizedWindows();
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
      await execYabaiCommand(`${yabaiPath} -m window ${win.id} --close`);
      await showToast({
        style: Toast.Style.Success,
        title: "Closed window",
        message: `${win.app} — ${win.title}`,
      });
      fetchMinimizedWindows();
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
                    onAction={() => deminimize(win, { moveToActiveSpace: true, tileWindow: true })}
                  />
                  <Action
                    title="Deminimize (Keep Floating)"
                    icon={Icon.Window}
                    shortcut={{ modifiers: ["opt"], key: "return" }}
                    onAction={() => deminimize(win, { moveToActiveSpace: true, tileWindow: false })}
                  />
                  <Action
                    title="Deminimize to Original Space"
                    icon={Icon.ChevronLeft}
                    shortcut={{ modifiers: ["shift"], key: "return" }}
                    onAction={() => deminimize(win, { moveToActiveSpace: false, tileWindow: true })}
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
