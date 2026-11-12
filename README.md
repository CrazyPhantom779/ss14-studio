# SS14 Studio

**The all-in-one development studio for Space Station 14 — built for VS Code today, JetBrains tomorrow.**

SS14 Studio starts with a complete visual workbench for **construction graphs** and is designed to grow into a full SS14 toolchain: prototypes, sprites, animations, and XAML, all inside the editor you already use.

![status](https://img.shields.io/badge/status-alpha-f59e0b)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90-22d3ee)

## Construction graphs, visualized

- Browse every construction graph in the workspace from the activity bar or the full dashboard.
- Inspect the whole graph on a blueprint canvas with nodes, directed step edges, conditions, and live diagnostics.
- Click any node or edge to open a focused inspector with prototype details, material totals, actions, transforms, and completion steps.
- Search, filter, and sort the graph atlas by folder, size, or diagnostics.
- Follow incoming and outgoing paths, and highlight a full construction route from any node.

## Edit without losing YAML

Every edit is surgical: SS14 Studio writes through the YAML AST and preserves your comments, ordering, and formatting.

- Add and delete nodes.
- Connect nodes, rename them, and change their entity prototypes.
- Add, edit, and remove construction steps, step fields, and `completed` actions.
- Add edge conditions, node actions, node transforms, and completion actions.
- Create new graph prototypes from a guided form.
- Undo everything with the normal VS Code undo command.

## Built for the whole workspace

- Automatic indexing of `Resources/Prototypes/**/*.{yml,yaml}`.
- Live refresh when prototype files change.
- Workspace-wide diagnostics for missing targets, isolated nodes, unknown tags, and malformed step definitions.
- Read-only mode when the workspace is not trusted.
- A blueprint-inspired UI that adapts to light, dark, and high-contrast VS Code themes.

## Getting started

1. Install the extension from a VSIX or the Marketplace.
2. Open a Space Station 14 repository (the one containing `Resources/Prototypes`).
3. Open the **SS14 Studio** activity bar view, or run **SS14 Studio: Open Dashboard** from the command palette.
4. Pick a graph and start exploring.

### Commands

| Command | Description |
| --- | --- |
| `SS14 Studio: Open Dashboard` | Open the graph atlas and project health dashboard. |
| `SS14 Studio: Open Construction Graph` | Pick a graph from the workspace. |
| `SS14 Studio: Create Construction Graph` | Scaffold a new graph prototype. |
| `SS14 Studio: Refresh Graph Index` | Re-scan prototype files. |
| `SS14 Studio: Reveal Graph YAML` | Jump from a graph to its YAML source. |

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ss14Studio.graphGlobs` | `Resources/Prototypes/**/*.{yml,yaml}` | Globs used to discover graph prototypes. |
| `ss14Studio.autoRefresh` | `true` | Re-index and refresh open diagrams when YAML changes. |
| `ss14Studio.animations` | `true` | Canvas transitions and animations. |
| `ss14Studio.blueprintIntensity` | `balanced` | Blueprint grid/glow strength: `subtle`, `balanced`, or `bold`. |

## Development

The repository is a TypeScript monorepo:

```text
packages/core   Framework-agnostic parser, validator, editor, and graph algorithms
packages/ui     Shared React webview (React Flow, Vite, lucide-react)
apps/vscode     VS Code extension host (esbuild, webview plumbing, indexer)
```

```bash
npm install
npm run check        # typecheck + core parser/editor tests
npm run build        # build core, webview, and extension
npm run package      # build a VSIX in releases/
```

The webview is deliberately framework-neutral at the protocol layer: `packages/ui` talks to a small host bridge, so a future JetBrains/JCEF host can reuse the same graph engine and interface.

## Roadmap

- [x] Construction graph parser, validator, and surgical editor
- [x] Graph atlas, canvas, inspector, and validation tray
- [x] Full node/edge/step/tagged-entry editing
- [ ] Sprite and entity icon previews
- [ ] Prototype YAML intelligence (schemas, completion, references)
- [ ] Animation and RSI inspection
- [ ] XAML tooling
- [ ] JetBrains Rider plugin

## License

MIT — see [LICENSE](./LICENSE).
