import { LocalStorage } from "@raycast/api";

const STORAGE_KEY = "window-moves";

/** Where "Bring to Current Space" took a window from, so "Send Back" can return it. */
export type WindowMove = {
  windowId: number;
  app: string;
  title: string;
  fromSpace: number;
  /** Absent on moves logged before labels were recorded. */
  fromSpaceLabel?: string;
  fromDisplay: number;
  toSpace: number;
  toDisplay: number;
  movedAt: string;
};

/** Latest move per window, keyed by window id. */
export type WindowMoves = Record<string, WindowMove>;

async function readMoves(): Promise<WindowMoves> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) as WindowMoves;
  } catch (error) {
    console.error("Ignoring unreadable window move log", error);
    return {};
  }
}

async function writeMoves(moves: WindowMoves): Promise<void> {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(moves));
}

/** Replaces any earlier move, so Send Back always returns the window to the space it was just taken from. */
export async function recordWindowMove(move: WindowMove): Promise<void> {
  const moves = await readMoves();

  if (move.fromSpace === move.toSpace) {
    delete moves[move.windowId];
  } else {
    moves[move.windowId] = move;
  }
  await writeMoves(moves);
}

export async function clearWindowMove(windowId: number): Promise<void> {
  const moves = await readMoves();
  if (!(windowId in moves)) return;

  delete moves[windowId];
  await writeMoves(moves);
}

/** Drops moves for windows that no longer exist (window ids are reused across sessions). */
export async function pruneWindowMoves(liveWindowIds: Set<number>): Promise<WindowMoves> {
  const moves = await readMoves();
  const kept = Object.fromEntries(Object.entries(moves).filter(([id]) => liveWindowIds.has(Number(id))));

  if (Object.keys(kept).length !== Object.keys(moves).length) {
    await writeMoves(kept);
  }
  return kept;
}
