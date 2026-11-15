# SS14 Studio feature work

Status legend: `[ ]` pending, `[~]` in progress, `[x]` done.

## 1. XAML simulated rendering
- [x] Resolve `{Loc key}` text from Fluent locale data in XAML views
- [x] Render colours, fonts, panels, margins, sprites and texture controls approximately
- [x] Support common RobustToolbox controls and control-specific properties
- [x] Link XAML handlers/fields to C# and show missing handlers
- [x] Add C# support: namespace peers, partial files, declarations, navigation

## 2. YAML sprite rendering and editing
- [x] Fix sprite lookup when the Sprite component comes from a parent
- [x] Resolve all Sprite fields and nested layers
- [x] Show each layer, its RSI/state, colour, scale, offset and visibility
- [x] Add Sprite component creation/editing, including nested layers
- [x] Surface inherited Sprite information clearly

## 3. Formatting settings
- [x] XAML formatting uses 4-space indentation by default, configurable
- [x] RSI `meta.json` formatting configurable, with a clean default
- [x] Add both settings to VS Code and Rider settings surfaces

## 4. Storage visual editing
- [x] Parse Storage grids, StorageFill contents and item slots
- [x] Render an approximate in-game storage grid
- [x] Drag items between cells to update spawn layout/order
- [x] Add/remove items and grid cells from the UI
- [x] Preview the generated YAML before writing

## 5. YAML helper diagnostics
- [x] Warn on component names ending in `Component`
- [x] Warn on PascalCase keys that should be camelCase
- [x] Warn on redundant inherited components with no overrides
- [x] Add tests for every new diagnostic

## 6. UI cleanup
- [x] Remove the AI-generated tag from the top-right of the main menu
- [x] Keep the AI disclosure in About/docs/marketplace

## Verification
- [x] `npm run check` (181 tests across 23 files)
- [x] `npm run build:rider`
- [x] `node apps/rider/scripts/smoke.mjs` (fixture and full Starlight checkout)
- [x] VSIX and Rider ZIP package
- [x] Commit
