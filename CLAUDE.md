# Yabai Plus

Raycast extension (macOS only) that wraps the [yabai](https://github.com/koekeishiya/yabai) CLI to manage windows, spaces, displays, minimized windows, and scratchpads. Every command is a thin React UI that shells out to `yabai -m ...` and reads its JSON output.

## Commands

```sh
npm run dev                      # ray develop: loads the extension into Raycast with hot reload
npm run lint                     # ray lint (ESLint + Raycast manifest/title checks)
npm run fix-lint                 # ray lint --fix
npx tsc --noEmit                 # type check
npx prettier --check src         # formatting (120 cols, double quotes)
npm run build                    # ray build
```

- TypeScript 6 defaults `types` to `[]`, so `tsconfig.json` sets `"types": ["node"]` explicitly. Don't remove it, or every `node:*` import stops resolving.
- There are no automated tests. To verify a change, run `npm run dev` and exercise the command in Raycast against a running yabai instance. Most behavior depends on live window and space state.
- Don't run `npm publish`. `prepublishOnly` blocks it on purpose; Store publishing is `npm run publish`.

## Layout

- `package.json` `commands[]`: the manifest. Each `name` must match a file `src/<name>.tsx` that has a default-exported component. All commands use `"mode": "view"`.
- `raycast-env.d.ts`: generated from the manifest by `ray develop`/`ray build`. It's gitignored, so don't edit it.
- `src/yabai.ts`: shared yabai helpers that every command uses (`runYabai`, `parseYabaiJson`, `getActiveSpace`, `getFocusedWindow`, `resizeCenteredOnDisplay`, `centerWindowOnDisplay`, `triggerSketchybar`, `scratchpadLabel`, and the `YabaiWindow`/`YabaiSpace` types). Put new yabai calls and fields here instead of shelling out from a command file.
- `src/space-actions.tsx`: lists all visible windows; bring to the current space and display, visit the window's space, minimize.
- `src/restore-minimized-window.tsx`: lists minimized windows; deminimize (optionally move to the active space and re-tile), close.
- `src/scratchpad-actions.tsx`: if any window has a scratchpad label, lists scratchpads (summon/hide toggle, remove label). Otherwise it lists all windows with a form to make one a scratchpad.
- `src/resize-window-percent.tsx`: form that resizes the focused window to N% of each axis of its display and centers it (`resizeCenteredOnDisplay(..., "rectangle")`), then fires a sketchybar `window_focus` event.

## Conventions

- Call yabai with `execFile` and an argument array (`runYabai(["-m", "window", String(id), "--focus"])`), not a shell string. Pass a 10s timeout and set `USER` in `env`, because yabai needs `USER` and Raycast's environment may not set it.
- Resolve binaries through `binaryPath()` in `src/yabai.ts`, which checks `/opt/homebrew/bin` and other standard directories. Raycast doesn't inherit the shell `PATH`, so a bare `yabai` may not be found.
- Keep the extension self-contained. Do the math in TypeScript rather than calling scripts in `~/.config/yabai` or tools like `jq`. Optional integrations such as sketchybar must fail silently.
- yabai's JSON uses kebab-case keys (`"is-minimized"`, `"has-focus"`, `"is-floating"`). Access them with bracket notation and add any new fields to the shared types.
- Prefer window-id-targeted commands (`-m window <id> ...`) over the focused-window form. While Raycast is open, the "focused" window may not be the one the user means.
- Action handler pattern: run the yabai calls, then `showToast` with `Toast.Style.Success`, then `await closeMainWindow()`. On error, call `console.error` with context and show a `Toast.Style.Failure` whose `message` is the error text. Exceptions: actions that refresh the list (refresh, remove scratchpad) or push a form stay open.
- Load app icons from `getApplications()` (keyed by name, matched case-insensitively), fall back to `/Applications`, `/System/Applications`, and `/System/Applications/Utilities`, then to `Icon.AppWindow`.
- `ray lint` enforces Title Case for action titles and checks the manifest. Run it after adding actions or commands.

## Gotchas

- **Hardcoded values:** scratchpads are hidden by moving them to **Space 6** (`scratchpad-actions.tsx`). `centerWindowOnDisplay` always applies a centered square at 70% of the display's shorter side.
- `space-actions.tsx` filters out system and launcher apps through `IGNORED_APPS`, plus hidden and minimized windows.
- The extension declares no preferences. If you read one with `getPreferenceValues`, declare it in `package.json` first, or it's always undefined.
- The user's yabai config lives in `~/.config/yabai/` (`yabairc`, plus `windows/`, `spaces/`, `signals/` helper scripts). Behavior can depend on rules defined there.

## Adding a command

1. Add an entry to `commands[]` in `package.json` (`name`, `title`, `subtitle: "yabai"`, `description`, `mode: "view"`).
2. Create `src/<name>.tsx` with a default-exported component, using the helpers in `src/yabai.ts`.
3. Run `npm run dev` (this regenerates `raycast-env.d.ts`), then `npm run lint` and the type check.
