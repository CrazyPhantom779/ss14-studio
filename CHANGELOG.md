# Changelog

All notable changes to SS14 Studio are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) for its own version.

SS14 Studio is an AI-generated, human-reviewed alpha project. Read the
[AI disclosure](./AI-GENERATED.md) before relying on it in production.

## [Unreleased]

### Added

- **All-graph atlas:** a dashboard action draws the entire repository as one
  clustered construction-graph map with folder clusters, search dimming,
  pan/zoom, fit, click-through and links from construction recipes to the
  entities they build.
- **Graph layout and sprites:** overlap-safe auto-layout and new-node placement,
  sprite/board variants on nodes, `iconEntities` primary-first rendering,
  variant badges, primary-entity double-click and staggered parallel edge
  labels. Every node now resolves a sprite, including `TransFlag`, computer,
  machine and desktop board variants.
- **XAML UI themes:** `styleTheme` and `uiTheme` prototypes are extracted into a
  designer theme picker with palette swatches. The selected palette overrides
  the designer CSS variables, and nine-slice window/header/button/panel textures
  are resolved for every theme; explicit XAML colours still win.
- **Container previews:** `ContainerFill`, `EntityTableContainerFill`,
  `startingGear`, `entityTable` and `ItemSlots` are previewed alongside
  `StorageFill`. Selectors and nested tables expand, items are packed by
  footprint and rotation, and a spawn summary lists every container. Editing
  remains limited to `StorageFill`.
- **Display sprites:** construction recipes resolve `graph` + `targetNode` to
  their produced entity, uplink `listing` products and board products show
  sprites, entity sprites win over duplicate prototype ids, and entity tables
  and `OptionsVisualizer` layers provide fallbacks.
- **Publishing:** marketplace jobs for VS Code Marketplace, Open VSX and
  JetBrains Marketplace (skipped when secrets are absent), plus
  [`PUBLISHING.md`](./PUBLISHING.md) with repository creation, GitHub settings,
  secrets, versioning, auto-update behaviour and release-day checklists.
- **XAML simulated rendering:** resolved Fluent text and tooltips, RobustToolbox
  colours, RSI/texture/entity images, selected-element attributes and linked C#
  context in the approximate designer.
- **YAML sprite editing:** inherited and layered sprite resolution across the
  whole parent chain, with a layer editor for paths, states, colours, scales,
  offsets and visibility. Extra Sprite fields survive edits.
- **Storage editing:** an approximate in-game grid for Storage/StorageFill with
  item footprints, overflow, drag-to-reorder spawn contents, add/remove items,
  grid resizing and a generated-YAML preview.
- **YAML helper diagnostics:** warnings for component names ending in
  `Component`, PascalCase keys that should be camelCase, and inherited components
  redeclared without overriding anything.
- **C# context view:** namespace peers, partial siblings, declarations, linked
  XAML, code-behind handlers and source navigation in both hosts.
- **Formatting settings:** XAML indentation (four spaces by default) and RSI
  `meta.json` indentation/final newline (two spaces plus newline by default) in
  the Studio settings drawer and host settings.
- Automated test coverage for graph analysis, validation, YAML helpers,
  prototype parsing and editing, RSI metadata and operations, XAML parsing and
  cleanup, text diffing, graph UI helpers, layout, step fields, selection, atlas,
  themes, graph icons, storage and the Rider sidecar.
- Committed Rider fixture project at `apps/rider/fixtures/sample-project`.
- GitHub Actions CI matrix for Ubuntu and Windows, VS Code VSIX packaging,
  Rider sidecar smoke test, Rider plugin build and tagged-release publishing.
- CodeQL, dependency review and Dependabot configuration.
- Issue forms, pull request template, contributing guide, code of conduct,
  security policy and release-note categories.

### Changed

- RSI `meta.json` output omits `directions` for single-direction states and
  `delays` for single-frame states.
- The Rider sidecar smoke test now also checks sprite resolution and the atlas.
- Expanded automated coverage to **193 tests across 26 files** (118 core, 42 UI
  and 33 Rider sidecar).

### Fixed

- C# type declarations now report the line of the declaration instead of the
  preceding `;` or `}` consumed by the parser's anchor.
- Rider sidecar state writes are serialized per file with unique temporary names,
  so background layout saves cannot race an explicit save.
- XAML sprite-sheet images crop frame 0 instead of stretching the whole sheet.
- YAML scalars that look like reserved words (`true`, `false`, `null`, `yes`,
  `no`, `on`, `off`, `~`) are now quoted before being written as plain strings.
- Prototype field and component insertion now uses the prototype/component
  indentation instead of the sequence dash indentation.
- `file:` path arguments in the Rider sidecar now resolve with
  `fileURLToPath`, so Windows paths keep native separators and UNC paths work.
- Storage items now honour explicit `x`/`y` positions and stored rotations in
  the visual grid.
- Construction graph auto-layout no longer produces coincident slots for
  disconnected nodes, and new nodes never land on user-arranged nodes.

## [0.2.0] - 2026-11-15

### Added

- **Construction graphs:** full graph atlas, blueprint canvas, entity sprites
  cropped from RSI sheets, directed step edges, route tracing, inspector,
  search/filter/sort, graph creation and AST-based YAML editing.
- **YAML prototypes:** inheritance trees, resolved fields and components with
  provenance, overridden values, partial-prototype overlays and external
  effects, approximate in-game card, field/component editing and partial
  extraction.
- **RobustToolbox XAML:** validation, completion, outline, code-behind handler
  linking, approximate visual designer, formatting, cleanup, before/after diff
  and the functional `AutoGenerated` marker.
- **RSI sprites:** animation playback, directions, frame delays, metadata,
  license/copyright, non-atlas layouts, state and frame management, PNG
  import/replace, generated transparent sheets, orphan cleanup and a basic RGBA
  pixel editor.
- **Diff and merge review:** unified and split views, line gutters, hunk headers,
  conflict-marker detection and copyable new text without automatic merges.
- **VS Code integration:** editor-title buttons, code lenses, context menus,
  activity-bar graph and prototype views, status bar summary, optional side
  preview, opt-in default graph editor and untrusted-workspace read-only mode.
- **Rider integration:** Kotlin plugin host, JCEF tool window, shared React UI,
  loopback Node sidecar with SSE, project indexing, follow-editor behavior,
  settings page, file actions and per-project state.
- **Shared design system:** theme-aware light, dark and high-contrast UI,
  blueprint visuals, settings drawer and About/AI disclosure panel.
- **Documentation and packaging:** root and per-host READMEs, AI disclosure,
  VSIX packaging and Rider plugin ZIP packaging.

### Known limitations

- The XAML visual designer and prototype in-game card are approximate.
- Sequence-level `!Index` / `!CombineIndex` partial resolution is approximate.
- Adding or removing RSI frames updates metadata only until the sheet is
  replaced or edited.
- The Rider JCEF tool window has not been verified on a local Rider installation
  in the development environment.

[Unreleased]: https://github.com/ss14studio/ss14-studio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ss14studio/ss14-studio/releases/tag/v0.2.0
