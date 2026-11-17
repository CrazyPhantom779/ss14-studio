# SS14 Studio feature work

Status legend: `[ ]` pending, `[~]` in progress, `[x]` done.

## 1. XAML simulated rendering
- [x] Resolve `{Loc key}` text from Fluent locale data in XAML views
- [x] Render colours, fonts, panels, margins, sprites and texture controls approximately
- [x] Support common RobustToolbox controls and control-specific properties
- [x] Link XAML handlers/fields to C# and show missing handlers
- [x] Add C# support: namespace peers, partial files, declarations, navigation
- [x] Extract `styleTheme` and `uiTheme` palettes from project prototypes
- [x] Add a designer theme picker with palette swatches
- [x] Apply the selected theme through designer CSS variables; explicit XAML colours still win
- [x] Resolve nine-slice window/header/button/panel textures for every theme

## 2. YAML sprite rendering and editing
- [x] Fix sprite lookup when the Sprite component comes from a parent
- [x] Resolve all Sprite fields and nested layers
- [x] Show each layer, its RSI/state, colour, scale, offset and visibility
- [x] Add Sprite component creation/editing, including nested layers
- [x] Surface inherited Sprite information clearly
- [x] Show sprites for prototypes that do not define one directly:
      `OptionsVisualizer`, construction recipes, uplink listings, entity tables
- [x] Prefer entity sprites when duplicate prototype ids exist
- [x] Show the produced entity sprite for `type: construction` recipes
      (`graph` + `targetNode`)
- [x] Add icon fallbacks for `MobGiantSpider`, `Drone` and other sprite-less ids

## 3. Formatting settings
- [x] XAML formatting uses 4-space indentation by default, configurable
- [x] RSI `meta.json` formatting configurable, with a clean default
- [x] Omit `directions` for single-direction states
- [x] Omit `delays` for single-frame states
- [x] Add both settings to VS Code and Rider settings surfaces

## 4. Storage and container previews
- [x] Parse Storage grids, StorageFill contents and item slots
- [x] Render an approximate in-game storage grid
- [x] Drag items between cells to update spawn layout/order
- [x] Add/remove items and grid cells from the UI
- [x] Preview the generated YAML before writing
- [x] Support `ContainerFill`, `EntityTableContainerFill`, `startingGear`,
      `entityTable` and `ItemSlots`
- [x] Expand selectors, nested tables and group alternatives
- [x] Place items by footprint and stored rotation in unit-cell first-fit order
- [x] Add multi-container tabs, read-only previews and a spawn summary
- [x] Keep editing limited to `StorageFill`; other container forms are preview-only

## 5. Construction graph layout and sprites
- [x] Give every node a sprite, including `TransFlag` and board variants
- [x] Infer `ComputerBoard` / `MachineBoard` / `DesktopBoard` variants
- [x] Prevent node overlap in auto-layout and when adding new nodes
- [x] Preserve user-arranged positions; place only new nodes
- [x] Stagger parallel edge labels and vary edge curvature
- [x] Add icon variant badges and primary-entity double-click
- [x] Add the all-graph atlas with folder clusters, search and construction links

## 6. YAML helper diagnostics
- [x] Warn on component names ending in `Component`
- [x] Warn on PascalCase keys that should be camelCase
- [x] Warn on redundant inherited components with no overrides
- [x] Add tests for every new diagnostic

## 7. UI cleanup
- [x] Remove the AI-generated tag from the top-right of the main menu
- [x] Keep the AI disclosure in About/docs/marketplace
- [x] Add CSS for storage tabs, read-only previews, spawn summaries,
      display-entity links and graph variant badges
- [x] Verify the atlas styling and dashboard entry point

## 8. GitHub, publishing and auto-update
- [x] CI matrix for Ubuntu and Windows, VSIX packaging, sidecar smoke test,
      Rider plugin build and tagged GitHub releases
- [x] Marketplace publishing jobs for VS Code Marketplace, Open VSX and
      JetBrains Marketplace (skipped when secrets are absent)
- [x] Document auto-update behaviour and manual-install limitations
- [x] Add `PUBLISHING.md` with repo/remote creation, GitHub settings, secrets,
      versioning and release-day checklists
- [x] Create the GitHub repository and push `main`
- [ ] Configure branch/tag protection, security features and marketplace secrets
- [ ] Publish the first VSIX to VS Code Marketplace and Open VSX
- [ ] Verify the signed Rider ZIP in a local Rider installation
- [ ] Publish the first Rider plugin to JetBrains Marketplace

## Verification
- [x] `npm run check` (all workspaces)
- [x] `npm run build:rider`
- [x] `node apps/rider/scripts/smoke.mjs` (fixture and full Starlight checkout)
- [x] VSIX and Rider ZIP package
- [x] Commit
