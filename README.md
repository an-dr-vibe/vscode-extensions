# an-dr VSCode Extensions

Personal VS Code extension pack. Each extension lives under `extensions/` and is
junctioned into `~/.vscode/extensions/` via `install.ps1` — no packaging, no marketplace,
no admin rights needed.

---

## Extensions

### an-dr: View in Git Tool

Opens the current repo in a git GUI tool from the status bar.

**Config** (`gitTool.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`tool`|`"smartgit"`|Which tool to open (`smartgit`, `gitkraken`, `sourcetree`, `fork`, `tower`, `github-desktop`, `sublime-merge`, `gitextensions`, `gitk`, `git-gui`, `custom`)|
|`toolPath`|`""`|Executable: a full path, or a bare command name looked up in PATH (e.g. `commits`). Empty = auto-detect. Required for `custom`.|
|`customArgs`|`[]`|Arguments for the `custom` tool. `${repoPath}` marks the repo root; without it the repo root is appended last.|
|`customName`|`""`|Status bar label for the `custom` tool. Empty = derived from the executable name.|
|`showStatusBar`|`true`|Show/hide the status bar button.|
|`statusBarIcon`|`"multiple-windows"`|Codicon shown in the status bar (`window`, `rocket`, `tools`, …). The `$(name)` form works too.|
|`statusBarIconOnly`|`false`|Show icon only, no tool name.|
|`statusBarAlignment`|`"right"`|`"left"` or `"right"`.|
|`statusBarPriority`|`99`|Higher = further from center.|

Tool discovery order: PATH → common install paths → directory search (handles versioned dirs).

Any other tool goes through `custom` — `toolPath` names the executable and `customArgs`
shapes the invocation; the tool always runs with the repo as its working directory:

```jsonc
"gitTool.tool": "custom",
"gitTool.toolPath": "commits",          // resolved from PATH, .exe implied on Windows
"gitTool.customArgs": []                // → commits <repoRoot>
```

---

### an-dr: View Online

Opens the current file (and optionally line / selection) on GitHub, GitLab, or Bitbucket.
Platform and remote URL are auto-detected from git.

**Config** (`viewOnline.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`remote`|`"origin"`|Git remote to use.|
|`defaultBranch`|`"main"`|Fallback branch name.|
|`openTarget`|`"browser"`|`"browser"`, `"clipboard"`, or `"both"`.|
|`showStatusBar`|`true`|Show/hide the status bar button.|
|`statusBarIconOnly`|`false`|Show icon only, no platform name.|
|`includeLineOnClick`|`true`|Include current line in URL on click.|
|`useSelectionRange`|`true`|Use start–end range when text is selected.|
|`customHostMap`|`{}`|Map custom hosts to base URLs (self-hosted GitLab etc.).|
|`statusBarAlignment`|`"right"`|`"left"` or `"right"`.|
|`statusBarPriority`|`100`|Higher = further from center.|

---

### an-dr: Jira Link

Status bar button that detects Jira tickets from the current branch name, commits unique to the branch, and comments in the active file, then opens them in the browser.

Shows one ticket directly or a picker when multiple are found. The icon indicates where the ticket was detected: `$(git-branch)` branch name, `$(git-commit)` commit message, `$(file-code)` file comment.

**Config** (`jiraLink.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`domain`|`""`|Jira base URL, e.g. `https://mycompany.atlassian.net`|
|`projects`|`[]`|Project keys to match, e.g. `["PROJ", "APP"]`. Empty = any ALL-CAPS key.|
|`mainBranch`|`"main"`|Base branch for scoping commit detection.|
|`statusBarAlignment`|`"left"`|`"left"` or `"right"`.|
|`statusBarPriority`|`10`|Higher = further from center on its side.|

**Commands** (Ctrl+Shift+P → `an-dr`):

- `Jira Link: Open Ticket` — open the detected ticket (or pick from a list)
- `Jira Link: Refresh Detection` — force re-scan

---

### an-dr: Editor Selection

Status bar item showing the current cursor position and selection info, with quick actions to copy the file location or jump to a line.

**Status bar behavior:**

|State|Shows|
|-----|-----|
|No selection|`Ln 12, Col 5`|
|Single-line selection|`Ln 12, Col 5  (8 selected)`|
|Multi-line selection|`Ln 12, Col 5  (3 lines, 42 chars)`|

**Click** the text → copies `relative/path/to/file.ts:12` to the clipboard.

**`$(go-to-file)` button** (right next to the text) → opens the built-in Go to Line dialog.

**Config** (`editorSelection.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`cursorFormat`|`"Ln {line}, Col {col}"`|Format when no selection. Placeholders: `{line}`, `{col}`.|
|`selectionFormat`|`"Ln {line}, Col {col}  ({chars} selected)"`|Format for a single-line selection. Placeholders: `{line}`, `{col}`, `{chars}`.|
|`multilineFormat`|`"Ln {line}, Col {col}  ({selLines} lines, {chars} chars)"`|Format for a multi-line selection. Placeholders: `{line}`, `{col}`, `{chars}`, `{selLines}`.|
|`showGoToLineButton`|`true`|Show/hide the go-to-line button.|

**Commands** (Ctrl+Shift+P → `an-dr`):

- `Editor Selection: Copy Relative Path and Line` — copy `<relative-path>:<line>` to clipboard
- `Editor Selection: Go to Line` — open the Go to Line dialog

---

### an-dr: Sync

Manages the extensions repo from inside VS Code — pull updates, rebuild, and reload without touching a terminal. Checks for updates shortly after VS Code starts and offers to pull and reload if any are found.

Auto-detects the repo root by resolving the NTFS junction / symlink from `~/.vscode/extensions/an-dr-*` back to the source. Falls back to `~/.vscode-an-dr`.

**Commands** (Ctrl+Shift+P → `an-dr`):

- `Sync: Pull & Reload` — `git pull`, rebuild all extensions, offer window reload
- `Sync: Check for Updates` — `git fetch` and report commits behind; offers Pull & Reload
- `Sync: Rebuild All Extensions` — Run `install.ps1` in a terminal (npm install + tsc + re-link)
- `Sync: Force Rebuild All Extensions` — Run `install.ps1 -Force` in a terminal (bypasses the up-to-date skip check; rebuilds every extension)
- `Sync: Open Repo in New Window` — Open the repo folder as a workspace in a new VS Code window
- `Sync: Show Repo Path` — Display the detected repo path; copy or open from the notification

**Config** (`sync.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`repoPath`|`""`|Override auto-detected repo root path.|
|`checkUpdatesOnStartup`|`true`|Check for updates ~5s after startup and offer to pull and reload. Silent when already up to date.|
|`checkUpdatesOnStartupThrottleHours`|`4`|Minimum hours between automatic startup checks (per machine). `0` checks every launch.|
|`autoWipCommit`|`true`|Automatically stage and commit all changes as a WIP commit once the repo has been quiet.|
|`autoWipCommitIntervalMinutes`|`30`|Minutes of inactivity required before an automatic WIP commit fires. Checked every minute; no commit while files are still being actively edited.|
|`autoPush`|`true`|Automatically push unpushed commits on a timer.|
|`autoPushIntervalMinutes`|`30`|Interval in minutes between automatic pushes.|

---

### an-dr: UI Control

Keeps the Activity Bar layout consistent across machines. Stores visibility and order in `settings.json` so Settings Sync carries it everywhere. New extensions are automatically appended at the end as visible; hidden items stay hidden.

**How it works:**

1. On startup, scans all installed extensions for `viewsContainers.activitybar` contributions.
2. Merges newly found containers into the config (appended as visible).
3. Applies the config — hides items marked as not visible.
4. On subsequent machines, synced settings are applied on startup.

**Commands** (Ctrl+Shift+P → `an-dr`):

- `UI Control: Configure Activity Bar` — Open the drag-and-drop configuration panel
- `UI Control: Apply Layout Now` — Re-apply the saved config (show + hide)
- `UI Control: Scan for New Extensions` — Discover newly installed extensions and add them to the config

**Config** (`uiControl.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`activityBar`|`[]`|Ordered list of `{id, visible}` objects. Managed by the extension, but editable by hand.|
|`applyOnStartup`|`true`|Automatically hide items on startup.|
|`statusBarIconOnly`|`true`|Show only the icon in the status bar.|

**Status bar:** `$(layout-activitybar-left)` — click to open the configure panel.

---

### an-dr: Code Review

Combines inline review comments with a dedicated changed-files tree for branch review.
The tree supports comparing against branches, tags, and commits, with tree/list
view, filtering, checkboxes, base switching, and diff opening directly from the review sidebar.
The changed-files tree uses the active theme's native Git colors: green for added
and untracked files, red for deleted files, and the modified color for other changes.
If Explorer decoration colors are disabled, colored file icons provide the same
status distinction without overriding that global preference. These become explicit
colored `A`, `D`, `M`, and other Git status badges when label colors are unavailable.

The Comments view lists every comment in the workspace, or only those under the file or
folder selected in the Changes tree. Each comment in the inline widget has **Edit** and **Delete** buttons. Edited comments
are labelled `edited`. The Comments view's title bar has a **Clear All Comments**
button, which asks for confirmation before it removes every comment in the workspace.

After every review change the extension writes `temp-code-review-latest.md` to the
workspace root. It lists the open entries as `file:line` references and tells whoever
addresses them, a person or an agent, to delete the file once every entry is done. The
file is removed automatically when no entry is open; turn it off with `latestMarkdown`.

Review comments live in the storage folder as JSON. If that file is edited outside
VS Code, for example by a checkout or another tool, open threads reload automatically.
A data file that is not valid JSON is never overwritten: the extension reports it and
leaves it for you to fix.

**Config** (`codeReview.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`storageDir`|`".artifacts-temp"`|Workspace-relative folder for review comments, checked files, and exports. It gets a `.gitignore` that ignores everything in it. Data from the old `code-review/` folder is copied here on first use.|
|`latestMarkdown`|`true`|Write `temp-code-review-latest.md` with the open entries after every review change.|
|`autoExport`|`"none"`|Keep `code-review.md`, `code-review.jira`, or both up to date in the storage folder after every change.|
|`showAuthor`|`false`|Include author names in comments and exports.|
|`author`|`""`|Author override for comment/export metadata.|
|`autoRefresh`|`true`|Refresh the changes tree on workspace changes.|
|`openChanges`|`true`|Open a diff instead of the file when selecting a changed file.|
|`diffMode`|`"merge"`|`"merge"` or `"full"` comparison mode.|
|`showCheckboxes`|`false`|Show review checkboxes beside files and folders.|
|`sortOrder`|`"path"`|List view sort: `name`, `path`, `status`, `recentlyModified`.|
|`omitUntrackedFiles`|`false`|Hide untracked files from the changes tree.|
|`omitUnstagedChanges`|`false`|Show only staged changes.|

**Commands** (Ctrl+Shift+P → `Code Review`):

- `Export Review to Markdown`
- `Export Review to Jira`
- `Clear All Comments`
- `Change Base...`
- `Refresh Changes`

Integrated tree-compare functionality is based on
[`vscode-git-tree-compare`](https://github.com/letmaik/vscode-git-tree-compare) by Maik Riechert,
with attribution preserved in the extension sources and notice files.

---

### an-dr: Commits

Git commit graph webview with branch/tag filtering, repository selection, common Git actions,
and an Activity Bar sidebar for working-tree changes. The sidebar shares the selected repository
with the main Commits tab and shows a compact current-branch graph below the commit controls.
Submodule full diffs show old/new commit details in Unified or Split view, while Raw shows Git's
semantic submodule log.

Fully self-contained: no dependency on VS Code's built-in Git extension (repo discovery,
branch/dirty status, and refresh detection use its own git spawns and file watchers).
Startup registers a lightweight shell; the Git-backed core loads on first use or after the
startup-critical window, and workspace reconciliation is deferred until interaction or idle.

**Config** (`an-dr-commits.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`graph.showTagsInActivityBar`|`true`|Show tag labels on the Activity Bar commit graph.|

---

### an-dr: Commits (MIT)

An independently distributable MIT-licensed Git graph based solely on
[neo-git-graph](https://github.com/asispts/neo-git-graph). It provides visual
history, commit details, branch/tag actions, diffs, and multi-repository
selection without using post-MIT Git Graph source.

**Config** (`an-dr-com-mit-s.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`showStatusBarItem`|`true`|Show/hide the graph status-bar button.|
|`statusBarIconOnly`|`true`|Show only its icon in the status bar.|

Use **an-dr: Commits (MIT): View Git Graph** from the Command Palette.

---

### an-dr: Extensions Grid

Grid overview of every installed extension (an-dr and third-party alike, enabled or
disabled), for managing hundreds of extensions at once. Reads each extension's own
`package.json` — no custom registry to maintain — plus a disk scan for disabled extensions,
since VS Code has no API to enumerate those.

Available from the Activity Bar ("Extensions Grid" icon) or as a full editor tab via
`Extensions Grid: Open in Editor Tab`. Both views share the same state.

- Extensions with no `icon` in their `package.json` show VS Code's own default extension
  icon (the same `codicon-extensions-large` glyph the native Extensions view uses), instead
  of a blank box.
- **Filter** box narrows the grid by name, ID, or description as you type.
- **Group by** selector: **Category** (default, from each extension's `categories` field —
  an extension in multiple categories appears once per category), **Alphabetical**,
  **Enabled / Disabled**, **Startup Time** (slowest first; see below), **My Groups** (your
  own custom groups, with an "Ungrouped" catch-all), or **None** (one flat grid).
- **Categories ▾** toolbar button opens a checklist to hide/show individual categories, or
  "Show all" to reset. This filter applies in every Group by mode, not just Category.
  Extensions bundled with VS Code itself are tagged with a synthetic **System** category,
  hidden by default, since they can't be uninstalled.
- **Startup Time** mode requires pressing **Measure Startup** (shown only in this mode) —
  it runs "Developer: Startup Performance" and reads its report; it's a manual action since
  it briefly opens/closes an editor tab and more extensions can activate lazily as your
  session goes on, so re-measuring later can surface new data.
- **Multi-select**: each card has a checkbox stacked under its icon, hidden until a
  selection exists. **Ctrl/Cmd-click** a card to toggle it (starting a selection, without
  opening its details); once any card is checked, checkboxes on every card become visible
  too. **Shift-click** selects the range between the last-touched card and the clicked one;
  **Esc** clears the selection. A plain click still always opens Details, regardless of any
  existing selection.
  With one or more checked, right-clicking a *checked* card opens a bulk version of the
  context menu (same actions, minus Open Details) acting on every checked extension at once —
  counts are shown per item, e.g. "Uninstall (3)". Apply to All Profiles is additive-only in
  bulk (it only turns on, never off), and ineligible items (System extensions for
  Uninstall/Apply to All Profiles) are silently skipped rather than blocking the batch.
  Add to group moves every selected extension into the chosen group (see below — it's a
  move, not a toggle, in bulk mode same as single). Right-clicking an *unchecked* card
  always shows the normal single-item menu regardless of what else is checked. Selection
  persists across filtering/re-renders and clears after a bulk action completes (Copy ID
  excepted, since it's non-destructive).
- **Right-click a card** for Open Details, Uninstall, Copy ID, Add to group ▸ (moves the
  extension into the chosen group — each extension belongs to at most one custom group at a
  time, so picking a group removes it from whatever group it was in before; "Remove from
  group" clears it back to Ungrouped), Add to Profile ▸ (adds the extension to a specific
  other VS Code Profile's own extension list — unlike Apply to All Profiles, this targets
  one chosen profile rather than all of them, and takes effect the next time *that* profile
  is loaded or reloaded, not the current window), and Apply to All Profiles (toggles whether
  the extension is scoped to every VS Code Profile instead of just the current one; shows a
  checkmark when already active). There's no command for targeting one specific other
  profile, so Add to Profile reads the profile list (name and internal id) from VS Code's
  own `storage.json` and writes directly into that profile's own extension list — the same
  kind of direct file access this grid already uses elsewhere where no command exists.
  Uninstall asks for confirmation; since VS Code applies
  uninstalls on window reload, the card is marked "uninstalled — reload to apply" and a reload
  is offered. System extensions can't be uninstalled or scoped to all profiles, so both
  entries are hidden for them; disabled extensions also don't get the Apply to All Profiles
  item, since there's no public API to resolve their install location. An extension already
  applied to all profiles shows an **All Profiles** badge on its card, in every grouping mode.
- Click a card (or use "Open Details" from the context menu) to open the extension's native
  Details page. From the editor-tab view, this reuses an existing split group to the right
  if one is open, or creates one; from the Activity Bar view it opens in place.
- Category visibility, Group by mode, and Startup Time results are stored per machine
  (`ExtensionContext.globalState`), not synced via Settings Sync. Custom groups are stored
  in the `an-dr-extensions.customGroups` setting, which *does* sync, since group membership
  is curated content you'd want on every machine.

**Config** (`an-dr-extensions.*`):

|Setting|Default|Description|
|-------|-------|-----------|
|`customGroups`|`{}`|Maps a custom group name to the extension IDs in it. Each extension belongs to at most one group. Managed via the grid's "Add to group" context menu action (a move, not a toggle), but editable by hand.|

- **Switch Profile...** toolbar button opens VS Code's native Profile switcher. There is no
  public API to read the active profile's name, list profiles, or group/manage extensions
  by profile (confirmed via [microsoft/vscode#226355](https://github.com/microsoft/vscode/issues/226355),
  closed *not planned*), so this is deliberately just a shortcut to the native picker.
  Switching profiles restarts the extension host in place rather than reloading the window;
  VS Code doesn't reconnect an already-open grid to the new host on its own. If the grid was
  open as an editor tab, switching via this button automatically closes and reopens that tab
  with the new profile's data — no reload needed. If only the sidebar view was open, you'll
  be prompted to reload the window instead, since there's no equivalent automatic fix for it.
  Switching profile through any other route (Command Palette, Profiles editor, etc.) gives no
  such prompt or auto-fix — reload manually if the grid looks stale.

**Commands** (Ctrl+Shift+P → `an-dr`):

- `Extensions Grid: Open in Editor Tab` — open the grid as a full editor-area tab

---

## Install

### One-liner (fresh machine or update)

Clones the repo into `~/.vscode-an-dr` (or pulls if already cloned), then installs all extensions. Requires `git`, `node`, and `pwsh` (PowerShell Core).

**Windows** — PowerShell / pwsh:

```powershell
iex (iwr 'https://raw.githubusercontent.com/an-dr/an-dr-vscode-extensions/main/bootstrap.ps1').Content
```

**Linux / macOS** — any shell:

```bash
pwsh -c "iex (iwr 'https://raw.githubusercontent.com/an-dr/an-dr-vscode-extensions/main/bootstrap.ps1').Content"
```

### Manual (if repo is already cloned)

```powershell
# Windows (PowerShell 5+ or pwsh)
.\install.ps1            # npm install + compile + link each extension
.\install.ps1 -SkipBuild # skip build, link only

# Linux / macOS
pwsh install.ps1
pwsh install.ps1 -SkipBuild
```

Then **Ctrl+Shift+P** → `Developer: Reload Window` in VS Code.

- **Windows**: creates NTFS junctions — no admin rights needed.
- **Linux/macOS**: creates symlinks — no admin rights needed.

### Excluding an extension

An extension containing a `.installignore` file is skipped: it is not built, not linked,
and not marked application-scoped. If an earlier run had already linked it, that link is
removed, so adding the file uninstalls the extension rather than just freezing it.

Use it for work in progress that should not load in the editor yet. The file's contents
are ignored — put a comment inside saying why, and delete the file to re-enable the
extension.

### When a build fails

If an extension's `npm install` or `npm run compile` fails — or the build finishes but the
entry point named by its `package.json` `main` is missing — `install.ps1` prints a red
`BUILD FAILED` line, marks the extension `linked (BROKEN BUILD)`, and carries on with the
rest. At the end it lists every failed extension and **exits with code 1**.

A failed extension is still linked (the junction points at live source, so fixing the build
is enough — no re-link needed), but its build stamp is *not* written, so the next run
rebuilds it instead of reporting `(up to date)`.
