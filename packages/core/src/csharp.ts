/**
 * Lightweight C# project context for SS14 Studio.
 *
 * This is not a compiler. It extracts the declarations that matter for editor
 * navigation: namespaces, usings, type declarations, partial siblings and the
 * link between a XAML file and its code-behind.
 */
import type {
  CSharpFileInfo,
  CSharpPeer,
  CSharpTypeInfo,
  CSharpView,
  Diagnostic,
} from './model.js';

export interface CSharpParseOptions {
  filePath: string;
  relativePath: string;
  linkedXaml?: string | null;
}

const TYPE_RE =
  /(?:^|[;{}])\s*((?:(?:public|internal|private|protected|static|abstract|sealed|partial|readonly|ref|unsafe|new)\s+)*)\b(class|struct|record|interface|enum)\s+([A-Za-z_]\w*)/g;

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index++) {
    if (source.charCodeAt(index) === 10) line++;
  }
  return line;
}

/** Parse a C# file into the subset used by the studio. */
export function parseCSharpFile(
  source: string,
  options: CSharpParseOptions,
): CSharpFileInfo {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const namespaceMatch =
    /^\s*namespace\s+([A-Za-z_][\w.]*)\s*[;{]/m.exec(normalized);
  const namespace = namespaceMatch?.[1] ?? null;
  const usings: string[] = [];
  for (const match of normalized.matchAll(/^\s*using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/gm)) {
    if (match[1] && !usings.includes(match[1])) usings.push(match[1]);
  }

  const types: CSharpTypeInfo[] = [];
  for (const match of normalized.matchAll(TYPE_RE)) {
    const modifiers = match[1] ?? '';
    const kind = match[2] as CSharpTypeInfo['kind'];
    const name = match[3]!;
    const rest = normalized.slice((match.index ?? 0) + match[0].length);
    const baseMatch = /^\s*(?:<[^>]*>)?\s*:\s*([^{\n]+)/.exec(rest);
    const baseTypes = baseMatch
      ? baseMatch[1]!
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];
    // The regex anchors on the preceding ';', '}' or start of file, so use the
    // offset of the type name itself for accurate line navigation.
    const nameOffset = (match.index ?? 0) + match[0].length - name.length;
    types.push({
      name,
      kind: ['class', 'struct', 'record', 'interface', 'enum'].includes(kind)
        ? kind
        : 'unknown',
      partial: /\bpartial\b/.test(modifiers),
      baseTypes,
      line: lineAt(normalized, nameOffset),
      namespace,
      filePath: options.filePath,
      relativePath: options.relativePath,
    });
  }

  return {
    filePath: options.filePath,
    relativePath: options.relativePath,
    source: normalized,
    namespace,
    usings,
    types,
    linkedXaml: options.linkedXaml ?? null,
  };
}

export interface CSharpIndexFile {
  filePath: string;
  relativePath: string;
  namespace: string | null;
  types: CSharpTypeInfo[];
}

export interface XamlClassEntry {
  filePath: string;
  relativePath: string;
  className: string;
}

function peerFrom(type: CSharpTypeInfo): CSharpPeer {
  return {
    filePath: type.filePath ?? '',
    relativePath: type.relativePath ?? '',
    typeName: type.name,
    partial: type.partial,
    line: type.line,
    namespace: type.namespace,
  };
}

/**
 * Combine one C# file with a project index into the view shown by the studio.
 */
export function buildCSharpView(
  file: CSharpFileInfo,
  index: CSharpIndexFile[],
  xamlClasses: XamlClassEntry[] = [],
  exists?: (path: string) => boolean,
): CSharpView {
  const diagnostics: Diagnostic[] = [];
  const currentTypes = new Set(file.types.map((type) => type.name));
  const qualifiedNames = new Set(
    file.types.map((type) => (file.namespace ? `${file.namespace}.${type.name}` : type.name)),
  );

  const partialSiblings: CSharpPeer[] = [];
  const namespacePeers: CSharpPeer[] = [];
  for (const other of index) {
    if (other.filePath === file.filePath) continue;
    const sharesNamespace = (other.namespace ?? null) === file.namespace;
    for (const type of other.types) {
      if (sharesNamespace && currentTypes.has(type.name)) {
        partialSiblings.push(peerFrom(type));
      } else if (sharesNamespace) {
        namespacePeers.push(peerFrom(type));
      }
    }
  }

  partialSiblings.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  namespacePeers.sort(
    (a, b) =>
      a.namespace?.localeCompare(b.namespace ?? '') ||
      a.typeName.localeCompare(b.typeName),
  );

  const linkedXaml = xamlClasses.filter((entry) =>
    qualifiedNames.has(entry.className) ||
    file.types.some((type) => entry.className.endsWith(`.${type.name}`)),
  );

  for (const entry of linkedXaml) {
    for (const type of file.types) {
      if (!entry.className.endsWith(`.${type.name}`) && entry.className !== type.name) continue;
      if (!type.partial) {
        diagnostics.push({
          severity: 'warning',
          code: 'csharp.class.notPartial',
          message: `${type.name} is referenced by ${entry.relativePath} but is not declared partial.`,
          line: type.line,
        });
      }
    }
  }

  if (!file.namespace && file.types.length > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'csharp.namespace.missing',
      message: 'This file has no namespace declaration.',
      line: 1,
    });
  }

  const linkedCodeBehind = file.filePath.endsWith('.xaml.cs')
    ? file.filePath.slice(0, -3)
    : null;
  if (linkedCodeBehind && exists && !exists(linkedCodeBehind)) {
    diagnostics.push({
      severity: 'info',
      code: 'csharp.xaml.missing',
      message: 'This code-behind has no matching .xaml file.',
      line: 1,
    });
  }

  return {
    filePath: file.filePath,
    relativePath: file.relativePath,
    source: file.source,
    namespace: file.namespace,
    usings: file.usings,
    types: file.types,
    partialSiblings,
    namespacePeers,
    linkedXaml,
    linkedCodeBehind,
    diagnostics,
  };
}

/** Resolve the simple `{Loc key}` / `{Loc 'key'}` markup used by SS14 XAML. */
export function parseLocMarkup(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\s*\{\s*Loc\s+(?:'([^']+)'|"([^"]+)"|([^\s}]+))\s*\}\s*$/.exec(value);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

/** Replace `{Loc ...}` markup with a localized string when one is available. */
export function localizeXamlText(
  value: string | null | undefined,
  lookup: (key: string) => string | undefined,
): { text: string | null; key: string | null } {
  if (!value) return { text: null, key: null };
  const key = parseLocMarkup(value);
  if (!key) return { text: value, key: null };
  return { text: lookup(key) ?? key, key };
}
