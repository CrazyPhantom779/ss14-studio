# SS14 Studio for JetBrains Rider

> **AI-generated project.** This plugin is built with AI assistance and reviewed
> by humans. Read the [AI disclosure](https://github.com/ss14studio/ss14-studio/blob/main/AI-GENERATED.md)
> before relying on it in a production pipeline. No AI watermark is added to your
> files.

**An all-in-one Space Station 14 development studio for Rider:** construction
graphs with entity sprites, YAML prototype inheritance and partials, RobustToolbox
XAML tooling, RSI animation and pixel editing, and diff/merge review — in a
dedicated **SS14 Studio** tool window.

The Rider edition shares its React interface and TypeScript engine with the VS
Code edition. A small Kotlin host starts a local Node sidecar, serves the UI over
loopback HTTP, and displays it in JCEF. The Kotlin host also handles IDE actions
such as opening files, notifications, clipboard, file pickers, settings, document
saves and VFS refresh.

## Status

| Item | Status |
| --- | --- |
| Kotlin host compiles | Yes, against Rider 2024.2 with JBR 21 |
| `buildPlugin` produces a ZIP | Yes |
| Node sidecar end-to-end smoke test | Yes, against the committed fixture and a full Starlight checkout |
| Sidecar test suite | Yes, 32 tests across config, paths, PNG, state, server and indexer |
| JCEF tool window on a local Rider install | **Not verified in this environment** |

The plugin is packaged and ready for Rider developers to test, but it has not
been run inside a local Rider installation here. Treat the JCEF layer as
unverified until a Rider developer confirms the tool window, file actions and
theme changes on their platform. Please report results with the Rider build
number, OS, Node version and any stack trace from **Help | Show Log**.

## Requirements

- **Rider 2024.2 or newer.** The plugin declares `sinceBuild=242` and
  `untilBuild=263.*`.
- **Node.js 18 or newer** on `PATH`, or an explicit path in
  **Settings | Tools | SS14 Studio**.
- **JCEF.** The bundled Rider runtime normally provides it. If JCEF is disabled,
  the tool window shows a fallback message instead of the Studio UI.
- **For building only:** JDK/JBR **21** and the bundled Gradle wrapper
  (Gradle 8.10.2).

## Install

Use the packaged ZIP:

```text
releases/ss14-studio-rider-0.2.0.zip
```

In Rider:

1. Open **Settings | Plugins**.
2. Click the gear icon and choose **Install Plugin from Disk…**.
3. Select the ZIP and restart Rider.
4. Open an SS14 project and open the **SS14 Studio** tool window on the right.

If the ZIP is not present, build it with the instructions below.

## Using the plugin

### Tool window

The right-side **SS14 Studio** tool window contains:

- a **Dashboard** button;
- a **Refresh** button;
- a **Settings** button;
- the shared Studio UI: dashboard, graphs, prototypes, RSI, XAML, diff and About.

The tool window starts the sidecar when it is opened. The sidecar is also started
on project open when **Start the sidecar when an SS14 project opens** is enabled
(the default) and the project looks like an SS14 repository.

### Editor and project actions

- **Editor context menu → Open in SS14 Studio** opens the current YAML, XAML,
  `.xaml.cs` or RSI metadata file in the appropriate Studio view.
- **Project view context menu → Open in SS14 Studio** does the same from the
  project tree.
- **Tools → Open SS14 Studio** opens the dashboard.
- **Tools → Refresh SS14 Studio Index** re-scans the project.
- The status bar shows a compact graph/error summary. Click it to open the
  dashboard.

### Follow the active editor

When **Follow the active editor when the tool window is visible** is enabled,
selecting a Studio-relevant file updates the tool window. Following only happens
while the tool window is already visible: it never opens or steals focus on its
own. Studio-driven navigation temporarily suppresses follow to avoid loops.

### Auto refresh and themes

- **Refresh the studio when project files change** batches VFS changes and sends
  them to the sidecar. Prototype, XAML, RSI and `.cs` changes are indexed.
- The current Rider Look & Feel is sent to the UI as `dark`, `light` or
  `high-contrast`. Changing the IDE theme updates the Studio UI immediately.

## Settings

Open **Settings | Tools | SS14 Studio**:

| Setting | Default | Description |
| --- | --- | --- |
| Node.js executable | empty | Explicit `node` path. Empty means detect from `PATH`. |
| Follow the active editor when the tool window is visible | on | Update the tool window when a relevant file is selected. |
| Refresh the studio when project files change | on | Send VFS changes to the sidecar. |
| Start the sidecar when an SS14 project opens | on | Start indexing without opening the tool window. |

Graph display, prototype display and other Studio options live in the in-Studio
settings drawer, shared with the VS Code edition. They are persisted per project
in the sidecar state directory.

## Build from source

From the repository root:

```bash
npm install
npm run build:rider
```

`build:rider` builds the core package, the shared UI, the Node sidecar and the
staged Rider web assets (`web/rider.html`, `web/rider-bridge.js`,
`web/assets/*`, `web-files.txt`).

Then build the plugin. The IntelliJ Platform Gradle Plugin requires JDK 21:

```powershell
# PowerShell: point JAVA_HOME at Rider's bundled JBR or any JDK 21
$env:JAVA_HOME = "C:\Users\<you>\.gradle\caches\8.10.2\transforms\<hash>\transformed\JetBrains.Rider-2024.2-win\jbr"

cd apps/rider
.\gradlew.bat buildPlugin --no-daemon
```

On macOS or Linux:

```bash
export JAVA_HOME=/path/to/jbr-21
cd apps/rider
./gradlew buildPlugin --no-daemon
```

The ZIP is written to:

```text
apps/rider/build/distributions/ss14-studio-rider-0.2.0.zip
```

Or run the whole pipeline from the repository root (with `JAVA_HOME` already set
to JDK 21):

```bash
npm run package:rider
```

`package:rider` invokes the Gradle wrapper through
`apps/rider/scripts/package.mjs`.

### Sidecar smoke test

The sidecar can be tested without launching Rider. It defaults to the committed
fixture project:

```bash
node apps/rider/scripts/smoke.mjs
```

Pass a real checkout path to test against a full SS14 repository:

```bash
node apps/rider/scripts/smoke.mjs C:\path\to\SS14\repo
```

It starts the real sidecar, checks health and bootstrap, connects to SSE, waits
for a non-empty index and prototype payload, opens a graph, opens a prototype,
opens About and Dashboard, then shuts down. It has been run against a full
Starlight checkout (427 construction graphs, tens of thousands of prototypes).

## Architecture

```text
apps/rider/
  src/main/kotlin/...      Kotlin host: tool window, service, actions,
                           settings, status bar, VFS/theme listeners.
  sidecar/src/             Node sidecar: indexer, studio session, HTTP/SSE
                           server, state, PNG handling, IDE bridge.
  web/rider-bridge.js      JCEF bridge: SSE + POST + UI-state persistence.
  scripts/build-web.mjs    Stages UI assets and generates rider.html.
  scripts/smoke.mjs        End-to-end sidecar test.
  build.gradle.kts         IntelliJ Platform Gradle Plugin build.
```

### Startup flow

1. Kotlin extracts the plugin's `web/` and `sidecar/` resources into the IDE
   system directory under `ss14-studio/<pluginVersion>/`.
2. Kotlin starts the sidecar:

   ```text
   node sidecar.mjs --project <base> --web <web> --state <state>
        --port 0 --theme <theme> --version <version> --root <root>...
   ```

3. The sidecar indexes the project and listens on `127.0.0.1` with a random port
   and a per-launch token.
4. The sidecar writes a `ready` JSON line to stdout with the URL. Kotlin loads
   that URL in a `JBCefBrowser`.
5. The JCEF page loads `/api/bootstrap.js`, then `/rider-bridge.js`, then the
   shared UI bundle. The bridge maps the VS Code webview API shape onto
   `window.ss14StudioBridge`.
6. Host-to-UI messages use **Server-Sent Events** at `/api/events`. UI-to-host
   messages use `POST /api/message`. UI state is persisted through
   `/api/ui-state`.
7. IDE actions travel from the sidecar to Kotlin as JSON lines on stdout. Kotlin
   sends commands back as JSON lines on stdin.

### State and security

- Settings, layouts, UI state and scratch files live under the IDE system path:

  ```text
  <system>/ss14-studio/state/<projectName-hash>/
    settings.json
    layouts.json
    ui-state.json
    scratch/
  ```

- The sidecar binds to loopback only. Every API request requires the per-launch
  token. The UI bundle and assets are served by the same local server, so JCEF
  avoids `file://` module and CORS problems.
- The sidecar performs `saveDocument` round-trips before writes and asks Kotlin
  to refresh and reload the affected files afterwards.
- There is no telemetry and no external network access. The only network traffic
  is the local loopback HTTP/SSE connection.

## Differences from the VS Code edition

The Studio views and the core engine are shared, so graph, prototype, RSI, XAML,
diff and dashboard behavior is the same. Integration differs:

| Capability | VS Code | Rider |
| --- | --- | --- |
| Dedicated UI surface | Webview panel | Right-side tool window with JCEF |
| Editor-title buttons | Yes | No |
| Code lenses | Yes | No |
| Activity-bar tree views | Yes | No |
| Editor context menu | Yes | Yes |
| Project/explorer context menu | Yes | Yes |
| Status bar summary | Yes | Yes |
| Follow active editor | Optional side preview | When the tool window is visible |
| Settings | VS Code Settings + Studio drawer | Settings | Tools | SS14 Studio + Studio drawer |
| Workspace trust | Read-only in untrusted workspaces | No equivalent trust model |

## Troubleshooting

### “Node.js was not found”

Install Node.js 18 or newer, or set the full path to `node` in
**Settings | Tools | SS14 Studio**. On Windows the usual path is
`C:\Program Files\nodejs\node.exe`.

### The tool window shows a JCEF fallback

The IDE was started without a working JCEF runtime. Use a standard Rider
installation with the bundled runtime, or enable JCEF in the IDE's runtime
settings. The VS Code edition does not need JCEF.

### “The SS14 Studio sidecar stopped”

Open the tool window again to restart it, or use **Tools → Refresh SS14 Studio
Index**. Check **Help | Show Log** for the sidecar's stderr lines (prefixed with
`[sidecar]`).

### The UI is blank

The shared UI assets may not have been staged when the plugin was built. Run
`npm run build:rider` before `gradlew buildPlugin`. The Gradle build verifies
`web/rider.html`, `web/rider-bridge.js`, `web/assets/studio.js`,
`web/assets/style.css` and `sidecar/sidecar.mjs` and fails if any are missing.

### Indexing is slow on first open

The first index scans every prototype file in the project. Later opens reuse the
sidecar's in-memory index and only rescan changed files. Use
**Tools → Refresh SS14 Studio Index** after large branch switches.

## Limitations

- The JCEF tool window is unverified on a local Rider installation.
- The XAML designer and the prototype in-game card are approximate.
- Sequence-level `!Index` / `!CombineIndex` partial resolution is approximate.
- RSI frame add/remove updates metadata only; replace the PNG or use the pixel
  editor when the sheet changes.
- Diff views are read-only and never auto-merge.
- The Rider host has no code lenses or editor-title buttons. Use the editor
  context menu, the tool window and the status bar.

Read the full [AI-generated disclosure](https://github.com/ss14studio/ss14-studio/blob/main/AI-GENERATED.md)
for scope, review policy, the no-watermark policy and the complete limitations
list.

## License

MIT — see [LICENSE](../../LICENSE).

SS14 Studio is not affiliated with Space Wizards Federation or RobustToolbox.
