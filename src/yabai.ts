import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type YabaiWindow = {
  id: number;
  app: string;
  title: string;
  space: number;
  display: number;
  scratchpad?: string | null;
  "has-focus"?: boolean;
  "is-visible"?: boolean;
  "is-minimized"?: boolean;
  "is-hidden"?: boolean;
  "is-floating"?: boolean;
};

export type YabaiSpace = {
  index: number;
  display: number;
};

type YabaiDisplay = {
  index: number;
  frame: { x: number; y: number; w: number; h: number };
};

/** Raycast doesn't inherit the shell PATH, so look for Homebrew/system binaries directly. */
function binaryPath(name: string): string {
  const standardDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return standardDirs.map((dir) => `${dir}/${name}`).find((path) => existsSync(path)) ?? name;
}

const commandEnv = () => ({ ...process.env, USER: process.env.USER ?? userInfo().username });

export async function runYabai(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(binaryPath("yabai"), args, {
    encoding: "utf8",
    timeout: 10_000,
    env: commandEnv(),
  });

  return stdout.trim();
}

/** Lets sketchybar refresh after a window change. sketchybar is optional, so failures are ignored. */
export async function triggerSketchybar(event: string): Promise<void> {
  try {
    await execFileAsync(binaryPath("sketchybar"), ["--trigger", event], { timeout: 5_000, env: commandEnv() });
  } catch {
    // Not installed or not running.
  }
}

export function parseYabaiJson<T>(value: string, query: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error(`Invalid JSON from yabai (${query})`, error);
    throw new Error("yabai returned an invalid response. Check that yabai is running.");
  }
}

export async function getActiveSpace(): Promise<YabaiSpace> {
  return parseYabaiJson<YabaiSpace>(await runYabai(["-m", "query", "--spaces", "--space"]), "active space");
}

export async function getFocusedWindow(): Promise<YabaiWindow> {
  return parseYabaiJson<YabaiWindow>(await runYabai(["-m", "query", "--windows", "--window"]), "focused window");
}

export async function getWindow(windowId: number): Promise<YabaiWindow> {
  return parseYabaiJson<YabaiWindow>(
    await runYabai(["-m", "query", "--windows", "--window", String(windowId)]),
    `window ${windowId}`,
  );
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls a window until `done` holds, because macOS applies some changes (like
 * deminimizing) asynchronously. Returns null if it times out.
 */
export async function waitForWindow(
  windowId: number,
  done: (window: YabaiWindow) => boolean,
  timeoutMs = 2_000,
): Promise<YabaiWindow | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const window = await getWindow(windowId);
    if (done(window)) return window;
    if (Date.now() >= deadline) return null;
    await delay(100);
  }
}

/**
 * Moves a window to a space and confirms yabai reports it there. A single
 * --space call isn't enough for a just-deminimized window: macOS may still be
 * restoring it to its old space and undo the move.
 */
export async function moveWindowToSpace(windowId: number, spaceIndex: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    const window = await getWindow(windowId);
    if (window.space === spaceIndex) return;
    if (Date.now() >= deadline) break;

    try {
      await runYabai(["-m", "window", String(windowId), "--space", String(spaceIndex)]);
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }

  const reason = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`yabai couldn't move the window to Space ${spaceIndex}.${reason}`);
}

/**
 * Resizes a window to a percentage of a display and centers it there. "square"
 * uses the display's shorter side for both dimensions; "rectangle" takes the
 * percentage of each axis. Using a window id avoids relying on whichever window
 * happens to be focused while the Raycast command is open.
 */
export async function resizeCenteredOnDisplay(
  windowId: number,
  displayIndex: number,
  percent: number,
  shape: "square" | "rectangle",
): Promise<void> {
  const displays = parseYabaiJson<YabaiDisplay[]>(await runYabai(["-m", "query", "--displays"]), "displays");
  const display = displays.find((candidate) => candidate.index === displayIndex);

  if (!display) {
    throw new Error(`yabai could not find Display ${displayIndex}.`);
  }

  const { x: displayX, y: displayY, w: displayWidth, h: displayHeight } = display.frame;
  const square = Math.floor((Math.min(displayWidth, displayHeight) * percent) / 100);
  const width = shape === "square" ? square : Math.floor((displayWidth * percent) / 100);
  const height = shape === "square" ? square : Math.floor((displayHeight * percent) / 100);
  const x = Math.floor(displayX + (displayWidth - width) / 2);
  const y = Math.floor(displayY + (displayHeight - height) / 2);

  await runYabai(["-m", "window", String(windowId), "--resize", `abs:${width}:${height}`]);
  await runYabai(["-m", "window", String(windowId), "--move", `abs:${x}:${y}`]);
}

/** The scratchpad default: a 70% square centered on the target display. */
export async function centerWindowOnDisplay(windowId: number, displayIndex: number): Promise<void> {
  await resizeCenteredOnDisplay(windowId, displayIndex, 70, "square");
}

export function scratchpadLabel(window: Pick<YabaiWindow, "scratchpad">): string | null {
  const label = window.scratchpad?.trim();
  return label ? label : null;
}
