import { describe, expect, it } from 'vitest';
import {
  SS14_NAMESPACE,
  applyXamlOperation,
  formatXaml,
  parseCodeBehind,
  parseXaml,
  xamlCompletions,
} from '../src/index.js';

const xaml = `<?xml version="1.0" encoding="utf-8"?>
<DefaultWindow xmlns="https://spacestation14.io"
               xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
               x:Class="Content.Client.TestWindow"
               MinWidth="320">
  <BoxContainer Orientation="Vertical" Margin="8" HorizontalExpand="True">
    <Label Name="Title" Text="{Loc test-title}" ToolTip="A tooltip" />
    <GridContainer Columns="2" Rows="1">
      <Button x:Name="ConfirmButton" OnPressed="OnConfirm">Confirm</Button>
      <CheckBox OnToggled="OnToggled" />
    </GridContainer>
  </BoxContainer>
</DefaultWindow>`;

function view(source = xaml, codeBehindSource: string | null = null) {
  return parseXaml(source, {
    filePath: '/repo/Content.Client/TestWindow.xaml',
    relativePath: 'Content.Client/TestWindow.xaml',
    codeBehindPath: codeBehindSource == null ? null : '/repo/Content.Client/TestWindow.xaml.cs',
    codeBehindSource,
  });
}

describe('XAML parsing', () => {
  it('parses namespaces, names, outline and design nodes', () => {
    const parsed = view();
    expect(SS14_NAMESPACE).toBe('https://spacestation14.io');
    expect(parsed.root?.name).toBe('DefaultWindow');
    expect(parsed.root?.namespace).toBe(SS14_NAMESPACE);
    expect(parsed.className).toBe('Content.Client.TestWindow');
    expect(parsed.outline.map((item) => [item.name, item.depth, item.xname])).toEqual([
      ['DefaultWindow', 0, null],
      ['BoxContainer', 1, null],
      ['Label', 2, 'Title'],
      ['GridContainer', 2, null],
      ['Button', 3, 'ConfirmButton'],
      ['CheckBox', 3, null],
    ]);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    expect(parsed.design?.className).toBe('DefaultWindow');
    expect(parsed.design?.children[0]?.orientation).toBe('vertical');
    expect(parsed.design?.children[0]?.stretch).toBe(true);
    expect(parsed.design?.children[0]?.style.margin).toBe('8');
    const label = parsed.design?.children[0]?.children[0];
    expect(label).toMatchObject({
      className: 'Label#Title',
      text: '{Loc test-title}',
      tooltip: 'A tooltip',
    });
    const grid = parsed.design?.children[0]?.children[1];
    expect(grid?.style.columns).toBe(2);
    expect(grid?.style.rows).toBe(1);
    expect(grid?.children[0]?.text).toBe('Confirm');
  });

  it('links code-behind handlers and reports missing methods', () => {
    const linked = view(
      xaml,
      `public sealed class TestWindow : DefaultWindow
{
    private Label Title;
    private void OnConfirm() {}
    public async Task OnToggled() {}
}`,
    );
    expect(linked.codeBehindExists).toBe(true);
    expect(linked.codeBehindHandlers).toEqual(expect.arrayContaining(['OnConfirm', 'OnToggled']));
    expect(linked.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.handler.missing')).toBe(
      false,
    );

    const missing = view(xaml, 'public class TestWindow {}');
    expect(missing.diagnostics.filter((diagnostic) => diagnostic.code === 'xaml.handler.missing')).toHaveLength(
      2,
    );
  });

  it('reports duplicate names, missing namespaces and mismatched tags', () => {
    const duplicate = view(
      '<DefaultWindow xmlns="https://spacestation14.io"><Label x:Name="A" /><Button x:Name="A" /></DefaultWindow>',
    );
    expect(duplicate.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.name.duplicate')).toBe(true);

    const noNamespace = view('<DefaultWindow><Label /></DefaultWindow>');
    expect(noNamespace.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.namespace.missing')).toBe(
      true,
    );

    const otherNamespace = view('<Window xmlns="http://example.com"><Label /></Window>');
    expect(otherNamespace.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.namespace.other')).toBe(
      true,
    );

    const broken = view('<DefaultWindow xmlns="https://spacestation14.io"><BoxContainer></DefaultWindow>');
    expect(broken.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.close.mismatch')).toBe(true);
    expect(broken.diagnostics.some((diagnostic) => diagnostic.code === 'xaml.open.unclosed')).toBe(true);
  });

  it('extracts C# handlers and fields', () => {
    const info = parseCodeBehind(`
public sealed class TestWindow
{
    private Label TitleLabel;
    public Button ConfirmButton;
    private void OnConfirm() {}
    protected async Task OnToggled() {}
}`);
    expect(info.handlers).toEqual(['OnConfirm', 'OnToggled']);
    expect(info.fields).toEqual(
      expect.arrayContaining([
        { type: 'Label', name: 'TitleLabel' },
        { type: 'Button', name: 'ConfirmButton' },
      ]),
    );
  });

  it('provides filtered control, property and event completions', () => {
    const all = xamlCompletions();
    expect(all.some((completion) => completion.label === 'DefaultWindow' && completion.kind === 'control')).toBe(
      true,
    );
    expect(all.some((completion) => completion.label === 'Margin' && completion.kind === 'property')).toBe(
      true,
    );
    expect(all.some((completion) => completion.label === 'OnPressed' && completion.kind === 'event')).toBe(
      true,
    );
    const filtered = xamlCompletions('button');
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((completion) => completion.label.toLowerCase().includes('button'))).toBe(true);
    expect(xamlCompletions('onpress').map((completion) => completion.label)).toContain('OnPressed');
  });
});

describe('XAML cleanup', () => {
  it('formats nested markup idempotently', () => {
    const messy = `<DefaultWindow xmlns="https://spacestation14.io">
<BoxContainer>
<Label Text="Hi" />


</BoxContainer>
</DefaultWindow>`;
    const formatted = formatXaml(messy);
    expect(formatted).toContain('  <BoxContainer>');
    expect(formatted).toContain('    <Label Text="Hi" />');
    expect(formatted).not.toContain('\n\n\n');
    expect(formatXaml(formatted)).toBe(formatted);
  });

  it('adds and removes the functional AutoGenerated marker', () => {
    const marked = applyXamlOperation(xaml, { kind: 'markAutoGenerated' });
    expect(marked.text).toMatch(/^<\?xml[^\n]*\n<!-- AutoGenerated by SS14 Studio/);
    expect(view(marked.text).autoGenerated).toBe(true);

    const already = applyXamlOperation(marked.text, { kind: 'markAutoGenerated' });
    expect(already.text).toBe(marked.text);
    expect(already.message).toContain('already');

    const removed = applyXamlOperation(marked.text, { kind: 'removeAutoGenerated' });
    expect(removed.text).not.toContain('AutoGenerated by SS14 Studio');
    expect(view(removed.text).autoGenerated).toBe(false);
  });

  it('cleans whitespace and preserves an existing marker', () => {
    const cleaned = applyXamlOperation('  <DefaultWindow xmlns="https://spacestation14.io">  \n</DefaultWindow>  ', {
      kind: 'cleanup',
    });
    expect(cleaned.text).toMatch(/AutoGenerated/);
    expect(cleaned.text).not.toMatch(/[ \t]+$/m);
    const cleanedAgain = applyXamlOperation(cleaned.text, { kind: 'cleanup' });
    expect(cleanedAgain.text).toBe(cleaned.text);
  });
});
