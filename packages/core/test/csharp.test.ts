import { describe, expect, it } from 'vitest';
import {
  buildCSharpView,
  localizeXamlText,
  parseCSharpFile,
  parseLocMarkup,
  type CSharpIndexFile,
  type XamlClassEntry,
} from '../src/index.js';

const source = `using System;
using Robust.Client.UserInterface;
using Robust.Client.UserInterface.Controls;

namespace Content.Client.Example;

public sealed partial class ExampleWindow : DefaultWindow
{
    private Label TitleLabel;
    public Button ConfirmButton;

    private void OnConfirm() {}
    protected async Task OnToggled() {}
}

internal record ExampleRow(string Name);

public interface IExampleView
{
}
`;

function parse(text = source, filePath = '/repo/Content.Client/ExampleWindow.xaml.cs') {
  return parseCSharpFile(text, {
    filePath,
    relativePath: 'Content.Client/ExampleWindow.xaml.cs',
  });
}

function indexEntry(
  filePath: string,
  relativePath: string,
  namespace: string | null,
  types: ReturnType<typeof parseCSharpFile>['types'],
): CSharpIndexFile {
  return { filePath, relativePath, namespace, types };
}

describe('C# context parsing', () => {
  it('extracts namespaces, usings, declarations, modifiers and base types', () => {
    const file = parse();
    expect(file.namespace).toBe('Content.Client.Example');
    expect(file.usings).toEqual([
      'System',
      'Robust.Client.UserInterface',
      'Robust.Client.UserInterface.Controls',
    ]);
    expect(file.types.map((type) => [type.name, type.kind, type.partial])).toEqual([
      ['ExampleWindow', 'class', true],
      ['ExampleRow', 'record', false],
      ['IExampleView', 'interface', false],
    ]);
    expect(file.types[0]).toMatchObject({
      baseTypes: ['DefaultWindow'],
      line: 7,
      namespace: 'Content.Client.Example',
    });
    expect(file.types[1]?.baseTypes).toEqual([]);
  });

  it('strips a UTF-8 BOM before parsing', () => {
    const file = parse(`\ufeffnamespace A.B;\npublic partial class C {}\n`);
    expect(file.namespace).toBe('A.B');
    expect(file.types[0]?.name).toBe('C');
  });

  it('handles files with no namespace', () => {
    const file = parse('public class Bare {}\n');
    expect(file.namespace).toBeNull();
    expect(file.types[0]?.namespace).toBeNull();
  });
});

describe('C# project context', () => {
  it('finds partial siblings, namespace peers and linked XAML', () => {
    const file = parse();
    const index = [
      indexEntry('/repo/Content.Client/ExampleWindow.xaml.cs', 'Content.Client/ExampleWindow.xaml.cs', 'Content.Client.Example', file.types),
      indexEntry('/repo/Content.Client/ExampleWindow.Partial.cs', 'Content.Client/ExampleWindow.Partial.cs', 'Content.Client.Example', [
        {
          name: 'ExampleWindow',
          kind: 'class',
          partial: true,
          baseTypes: [],
          line: 3,
          namespace: 'Content.Client.Example',
          filePath: '/repo/Content.Client/ExampleWindow.Partial.cs',
          relativePath: 'Content.Client/ExampleWindow.Partial.cs',
        },
      ]),
      indexEntry('/repo/Content.Client/OtherWindow.cs', 'Content.Client/OtherWindow.cs', 'Content.Client.Example', [
        {
          name: 'OtherWindow',
          kind: 'class',
          partial: false,
          baseTypes: [],
          line: 1,
          namespace: 'Content.Client.Example',
          filePath: '/repo/Content.Client/OtherWindow.cs',
          relativePath: 'Content.Client/OtherWindow.cs',
        },
      ]),
    ];
    const xamlClasses: XamlClassEntry[] = [
      {
        filePath: '/repo/Content.Client/ExampleWindow.xaml',
        relativePath: 'Content.Client/ExampleWindow.xaml',
        className: 'Content.Client.Example.ExampleWindow',
      },
    ];
    const view = buildCSharpView(file, index, xamlClasses, () => true);
    expect(view.partialSiblings).toEqual([
      expect.objectContaining({
        typeName: 'ExampleWindow',
        relativePath: 'Content.Client/ExampleWindow.Partial.cs',
        partial: true,
      }),
    ]);
    // Namespace peers are declared in *other* files; this file's own types are
    // exposed separately through `view.types`.
    expect(view.types.map((type) => type.name)).toEqual([
      'ExampleWindow',
      'ExampleRow',
      'IExampleView',
    ]);
    expect(view.namespacePeers).toEqual([
      expect.objectContaining({ typeName: 'OtherWindow' }),
    ]);
    expect(view.linkedXaml).toEqual(xamlClasses);
    expect(view.linkedCodeBehind).toBe('/repo/Content.Client/ExampleWindow.xaml');
    expect(view.diagnostics.some((diagnostic) => diagnostic.code === 'csharp.class.notPartial')).toBe(
      false,
    );
  });

  it('warns when a linked XAML class is not partial', () => {
    const file = parse('namespace N;\npublic class Plain {}\n');
    const xamlClasses: XamlClassEntry[] = [
      { filePath: '/repo/Plain.xaml', relativePath: 'Plain.xaml', className: 'N.Plain' },
    ];
    const view = buildCSharpView(file, [], xamlClasses, () => true);
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'csharp.class.notPartial', severity: 'warning' }),
      ]),
    );
  });

  it('reports a missing namespace and missing code-behind XAML', () => {
    const file = parse('public partial class NoNamespace {}\n', '/repo/NoNamespace.xaml.cs');
    const view = buildCSharpView(file, [], [], () => false);
    expect(view.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'csharp.namespace.missing', severity: 'info' }),
        expect.objectContaining({ code: 'csharp.xaml.missing', severity: 'info' }),
      ]),
    );
    expect(view.linkedCodeBehind).toBe('/repo/NoNamespace.xaml');
  });
});

describe('Fluent markup in XAML', () => {
  it('parses the supported Loc spellings', () => {
    expect(parseLocMarkup('{Loc test-title}')).toBe('test-title');
    expect(parseLocMarkup("{Loc 'test-title'}")).toBe('test-title');
    expect(parseLocMarkup('{Loc "test-title"}')).toBe('test-title');
    expect(parseLocMarkup('{Loc  spaced-key }')).toBe('spaced-key');
    expect(parseLocMarkup('Plain text')).toBeNull();
    expect(parseLocMarkup('{Loc}')).toBeNull();
    expect(parseLocMarkup(null)).toBeNull();
  });

  it('resolves keys and leaves plain text alone', () => {
    const lookup = (key: string) => (key === 'test-title' ? 'Test title' : undefined);
    expect(localizeXamlText('{Loc test-title}', lookup)).toEqual({
      text: 'Test title',
      key: 'test-title',
    });
    expect(localizeXamlText('{Loc missing}', lookup)).toEqual({
      text: 'missing',
      key: 'missing',
    });
    expect(localizeXamlText('Confirm', lookup)).toEqual({
      text: 'Confirm',
      key: null,
    });
    expect(localizeXamlText(null, lookup)).toEqual({ text: null, key: null });
  });
});
