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
};

export type YabaiSpace = {
  index: number;
  display: number;
};

type YabaiDisplay = {
  index: number;
  frame: { x: number; y: number; w: number; h: number };
};

function yabaiPath(): string {
  const standardPaths = ["/opt/homebrew/bin/yabai", "/usr/local/bin/yabai", "/usr/bin/yabai", "/bin/yabai"];
  return standardPaths.find((path) => existsSync(path)) ?? "yabai";
}

export async function runYabai(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(yabaiPath(), args, {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, USER: process.env.USER ?? userInfo().username },
  });

  return stdout.trim();
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

/**
 * Applies the reference resize helper's default: a 70% square, centered on the
 * target display. Using a window id avoids relying on whichever window happens
 * to be focused while the Raycast command is open.
 */
export async function centerWindowOnDisplay(windowId: number, displayIndex: number): Promise<void> {
  const displays = parseYabaiJson<YabaiDisplay[]>(await runYabai(["-m", "query", "--displays"]), "displays");
  const display = displays.find((candidate) => candidate.index === displayIndex);

  if (!display) {
    throw new Error(`yabai could not find Display ${displayIndex}.`);
  }

  const side = Math.floor(Math.min(display.frame.w * 0.7, display.frame.h * 0.7));
  const x = Math.floor(display.frame.x + (display.frame.w - side) / 2);
  const y = Math.floor(display.frame.y + (display.frame.h - side) / 2);

  await runYabai(["-m", "window", String(windowId), "--resize", `abs:${side}:${side}`]);
  await runYabai(["-m", "window", String(windowId), "--move", `abs:${x}:${y}`]);
}

export function scratchpadLabel(window: Pick<YabaiWindow, "scratchpad">): string | null {
  const label = window.scratchpad?.trim();
  return label ? label : null;
}
