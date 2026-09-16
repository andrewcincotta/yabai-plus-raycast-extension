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

export function scratchpadLabel(window: Pick<YabaiWindow, "scratchpad">): string | null {
  const label = window.scratchpad?.trim();
  return label ? label : null;
}

export const FLOATING_GRID = "5:5:1:1:3:3";
