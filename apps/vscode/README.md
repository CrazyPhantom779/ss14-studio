# SS14 Studio

A visual studio for Space Station 14 construction graphs inside VS Code.

- Browse every construction graph in your workspace.
- Explore nodes, steps, conditions, actions, and materials on an interactive blueprint canvas.
- Edit graphs through the inspector while preserving YAML formatting and comments.
- See workspace-wide diagnostics as you type.
- Follow construction routes and jump straight to the exact line in the YAML source.

## Open it

Open a Space Station 14 repository and use the **SS14 Studio** activity bar icon, or run **SS14 Studio: Open Dashboard** from the command palette.

## Editing

SS14 Studio applies every change as a surgical YAML edit. Use the normal VS Code undo/redo commands to roll back a change.

The extension only edits when the workspace is trusted. In restricted workspaces the graph remains fully browsable in read-only mode.

## Settings

- `ss14Studio.graphGlobs`
- `ss14Studio.autoRefresh`
- `ss14Studio.animations`
- `ss14Studio.blueprintIntensity`

## More

SS14 Studio is being built into an all-in-one SS14 development suite. Construction graphs are the first module, with prototype intelligence, sprites, animations, and XAML on the roadmap.

Licensed under MIT.
