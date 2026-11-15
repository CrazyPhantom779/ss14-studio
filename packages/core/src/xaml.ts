/**
 * Lightweight XAML tooling for RobustToolbox / Space Station 14.
 *
 * This is deliberately not a full XAML compiler. It tokenizes elements well
 * enough to provide an outline, diagnostics, navigate code-behind handlers,
 * suggest controls/properties and render an approximate visual designer.
 */
import type {
  Diagnostic,
  SourceSpan,
  XamlAttribute,
  XamlCompletion,
  XamlDesignNode,
  XamlElement,
  XamlOperation,
  XamlView,
} from './model.js';
import { parseCSharpFile } from './csharp.js';
import { LineIndex } from './yaml.js';

const SS14_NAMESPACE = 'https://spacestation14.io';

export const XAML_CONTROLS: { name: string; detail: string }[] = [
  { name: 'DefaultWindow', detail: 'RobustToolbox window root' },
  { name: 'BoxContainer', detail: 'Horizontal or vertical stack' },
  { name: 'GridContainer', detail: 'Row/column grid' },
  { name: 'ScrollContainer', detail: 'Scrollable viewport' },
  { name: 'PanelContainer', detail: 'Panel with background' },
  { name: 'Panel', detail: 'Simple panel' },
  { name: 'Label', detail: 'Text label' },
  { name: 'RichTextLabel', detail: 'Formatted text label' },
  { name: 'LineEdit', detail: 'Single-line text input' },
  { name: 'TextEdit', detail: 'Multi-line text input' },
  { name: 'Button', detail: 'Push button' },
  { name: 'CheckBox', detail: 'Toggle checkbox' },
  { name: 'OptionButton', detail: 'Dropdown' },
  { name: 'SpinBox', detail: 'Numeric input' },
  { name: 'Slider', detail: 'Range slider' },
  { name: 'ProgressBar', detail: 'Progress bar' },
  { name: 'TextureRect', detail: 'Image' },
  { name: 'SpriteView', detail: 'Entity sprite view' },
  { name: 'ItemList', detail: 'Selectable list' },
  { name: 'Tree', detail: 'Hierarchical tree' },
  { name: 'TabContainer', detail: 'Tabbed pages' },
  { name: 'TabBar', detail: 'Tab strip' },
  { name: 'SplitContainer', detail: 'Resizable split pane' },
  { name: 'MarginContainer', detail: 'Padding container' },
  { name: 'CenterContainer', detail: 'Centered content' },
  { name: 'AspectRatioContainer', detail: 'Aspect-ratio container' },
  { name: 'Collapsible', detail: 'Collapsible section' },
  { name: 'EntityPrototypeView', detail: 'Entity prototype preview' },
  { name: 'SpriteView', detail: 'Sprite preview' },
  { name: 'ColorPicker', detail: 'Color selection' },
  { name: 'HScrollBar', detail: 'Horizontal scroll bar' },
  { name: 'VScrollBar', detail: 'Vertical scroll bar' },
  { name: 'MenuBar', detail: 'Menu bar' },
  { name: 'MenuButton', detail: 'Menu button' },
  { name: 'Popup', detail: 'Popup container' },
  { name: 'Tooltip', detail: 'Tooltip container' },
];

export const XAML_PROPERTIES: { name: string; detail: string }[] = [
  { name: 'Name', detail: 'Element name' },
  { name: 'x:Name', detail: 'Typed name reference' },
  { name: 'Margin', detail: 'Outer spacing (left, top, right, bottom)' },
  { name: 'Padding', detail: 'Inner spacing' },
  { name: 'MinWidth', detail: 'Minimum width' },
  { name: 'MinHeight', detail: 'Minimum height' },
  { name: 'MaxWidth', detail: 'Maximum width' },
  { name: 'MaxHeight', detail: 'Maximum height' },
  { name: 'HorizontalAlignment', detail: 'Stretch, Center, Left, Right' },
  { name: 'VerticalAlignment', detail: 'Stretch, Center, Top, Bottom' },
  { name: 'HorizontalExpand', detail: 'Expand horizontally' },
  { name: 'VerticalExpand', detail: 'Expand vertically' },
  { name: 'Orientation', detail: 'Horizontal or Vertical' },
  { name: 'Columns', detail: 'Grid column count' },
  { name: 'Rows', detail: 'Grid row count' },
  { name: 'Text', detail: 'Label/button text' },
  { name: 'TextAlign', detail: 'Text alignment' },
  { name: 'StyleClasses', detail: 'Space-separated style classes' },
  { name: 'ToolTip', detail: 'Tooltip text' },
  { name: 'Visible', detail: 'Visibility' },
  { name: 'Modulate', detail: 'Tint colour' },
  { name: 'Scale', detail: 'Visual scale' },
  { name: 'Access', detail: 'Accessibility label' },
  { name: 'Disabled', detail: 'Disabled state' },
  { name: 'ToggleMode', detail: 'Button toggle mode' },
  { name: 'MaxLength', detail: 'Input length limit' },
  { name: 'Placeholder', detail: 'Input placeholder' },
  { name: 'Value', detail: 'Slider/progress value' },
  { name: 'MinValue', detail: 'Minimum value' },
  { name: 'MaxValue', detail: 'Maximum value' },
  { name: 'Src', detail: 'Texture resource path' },
  { name: 'Stretch', detail: 'Texture stretch mode' },
];

export const XAML_EVENTS: { name: string; detail: string }[] = [
  { name: 'OnPressed', detail: 'Button pressed' },
  { name: 'OnToggled', detail: 'Toggle changed' },
  { name: 'OnTextChanged', detail: 'Text input changed' },
  { name: 'OnTextEntered', detail: 'Text submitted' },
  { name: 'OnItemSelected', detail: 'List/tree selection' },
  { name: 'OnItemActivated', detail: 'List/tree activation' },
  { name: 'OnValueChanged', detail: 'Slider/spinbox changed' },
  { name: 'OnTabChanged', detail: 'Tab selection changed' },
  { name: 'OnClose', detail: 'Window close requested' },
  { name: 'OnVisibilityChanged', detail: 'Visibility changed' },
  { name: 'OnResized', detail: 'Control resized' },
];

interface Token {
  kind: 'open' | 'close' | 'self' | 'text' | 'comment' | 'decl';
  name: string;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  selfClosing: boolean;
}

function scan(xml: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < xml.length) {
    const next = xml.indexOf('<', index);
    if (next < 0) {
      const text = xml.slice(index);
      if (text.trim()) {
        tokens.push({
          kind: 'text',
          name: '',
          start: index,
          end: xml.length,
          nameStart: index,
          nameEnd: index,
          selfClosing: false,
        });
      }
      break;
    }
    if (next > index) {
      const text = xml.slice(index, next);
      if (text.trim()) {
        tokens.push({
          kind: 'text',
          name: '',
          start: index,
          end: next,
          nameStart: index,
          nameEnd: index,
          selfClosing: false,
        });
      }
    }
    if (xml.startsWith('<!--', next)) {
      const close = xml.indexOf('-->', next + 4);
      const end = close < 0 ? xml.length : close + 3;
      tokens.push({
        kind: 'comment',
        name: '',
        start: next,
        end,
        nameStart: next,
        nameEnd: end,
        selfClosing: false,
      });
      index = end;
      continue;
    }
    if (xml.startsWith('<![CDATA[', next)) {
      const close = xml.indexOf(']]>', next + 9);
      const end = close < 0 ? xml.length : close + 3;
      tokens.push({
        kind: 'text',
        name: '',
        start: next,
        end,
        nameStart: next,
        nameEnd: end,
        selfClosing: false,
      });
      index = end;
      continue;
    }
    if (xml.startsWith('<?', next)) {
      const close = xml.indexOf('?>', next + 2);
      const end = close < 0 ? xml.length : close + 2;
      tokens.push({
        kind: 'decl',
        name: '',
        start: next,
        end,
        nameStart: next,
        nameEnd: end,
        selfClosing: false,
      });
      index = end;
      continue;
    }
    if (xml.startsWith('<!', next)) {
      const close = xml.indexOf('>', next + 2);
      const end = close < 0 ? xml.length : close + 1;
      tokens.push({
        kind: 'decl',
        name: '',
        start: next,
        end,
        nameStart: next,
        nameEnd: end,
        selfClosing: false,
      });
      index = end;
      continue;
    }

    const close = xml.indexOf('>', next + 1);
    if (close < 0) {
      tokens.push({
        kind: 'text',
        name: '',
        start: next,
        end: xml.length,
        nameStart: next,
        nameEnd: xml.length,
        selfClosing: false,
      });
      break;
    }
    let cursor = next + 1;
    let closing = false;
    if (xml[cursor] === '/') {
      closing = true;
      cursor++;
    }
    while (cursor < close && /\s/.test(xml[cursor]!)) cursor++;
    const nameStart = cursor;
    while (cursor < close && !/[\s/>]/.test(xml[cursor]!)) cursor++;
    const nameEnd = cursor;
    const name = xml.slice(nameStart, nameEnd);
    const selfClosing = !closing && xml.slice(next, close).trimEnd().endsWith('/');
    tokens.push({
      kind: closing ? 'close' : selfClosing ? 'self' : 'open',
      name,
      start: next,
      end: close + 1,
      nameStart,
      nameEnd,
      selfClosing,
    });
    index = close + 1;
  }
  return tokens;
}

function splitName(name: string): { prefix: string | null; local: string } {
  const colon = name.indexOf(':');
  if (colon < 0) return { prefix: null, local: name };
  return { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

function parseAttributes(
  xml: string,
  token: Token,
  lines: LineIndex,
): XamlAttribute[] {
  const attributes: XamlAttribute[] = [];
  const inner = xml.slice(token.start, token.end);
  const nameOffset = token.nameEnd - token.start;
  const bodyStart = nameOffset;
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  re.lastIndex = bodyStart;
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner))) {
    const value = match[2] ?? match[3] ?? '';
    const valueStart = token.start + match.index + match[0].length - value.length - 1;
    const valueEnd = valueStart + value.length;
    const spanStart = token.start + match.index;
    const spanEnd = token.start + match.index + match[0].length;
    attributes.push({
      name: match[1]!,
      value,
      span: {
        start: spanStart,
        end: spanEnd,
        line: lines.lineAt(spanStart),
        endLine: lines.lineAt(Math.max(spanStart, spanEnd - 1)),
      },
    });
  }
  return attributes;
}

function parseTree(
  xml: string,
  tokens: Token[],
  lines: LineIndex,
  diagnostics: Diagnostic[],
): XamlElement | null {
  const stack: XamlElement[] = [];
  let root: XamlElement | null = null;

  for (const token of tokens) {
    if (token.kind === 'open') {
      const attributes = parseAttributes(xml, token, lines);
      const { prefix, local } = splitName(token.name);
      const namespaceAttr = attributes.find((attribute) =>
        prefix ? attribute.name === `xmlns:${prefix}` : attribute.name === 'xmlns',
      );
      const elementSpan = {
        start: token.start,
        end: token.end,
        line: lines.lineAt(token.start),
        endLine: lines.lineAt(Math.max(token.start, token.end - 1)),
      };
      const events = attributes
        .filter((attribute) => /^On[A-Z]/.test(attribute.name))
        .map((attribute) => ({ event: attribute.name, handler: attribute.value }));
      const xname =
        attributes.find((attribute) => attribute.name === 'x:Name')?.value ??
        attributes.find((attribute) => attribute.name === 'Name')?.value ??
        null;
      const element: XamlElement = {
        name: local,
        prefix,
        namespace: namespaceAttr?.value ?? null,
        attributes,
        children: [],
        text: '',
        span: elementSpan,
        startTagSpan: elementSpan,
        endTagSpan: null,
        selfClosing: false,
        xname,
        events,
      };
      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(element);
      } else if (!root) {
        root = element;
      } else {
        diagnostics.push({
          severity: 'warning',
          code: 'xaml.root.multiple',
          message: 'XAML has more than one root element.',
          line: elementSpan.line,
        });
      }
      stack.push(element);
      continue;
    }

    if (token.kind === 'self') {
      const attributes = parseAttributes(xml, token, lines);
      const { prefix, local } = splitName(token.name);
      const namespaceAttr = attributes.find((attribute) =>
        prefix ? attribute.name === `xmlns:${prefix}` : attribute.name === 'xmlns',
      );
      const span = {
        start: token.start,
        end: token.end,
        line: lines.lineAt(token.start),
        endLine: lines.lineAt(Math.max(token.start, token.end - 1)),
      };
      const element: XamlElement = {
        name: local,
        prefix,
        namespace: namespaceAttr?.value ?? null,
        attributes,
        children: [],
        text: '',
        span,
        startTagSpan: span,
        endTagSpan: null,
        selfClosing: true,
        xname:
          attributes.find((attribute) => attribute.name === 'x:Name')?.value ??
          attributes.find((attribute) => attribute.name === 'Name')?.value ??
          null,
        events: attributes
          .filter((attribute) => /^On[A-Z]/.test(attribute.name))
          .map((attribute) => ({ event: attribute.name, handler: attribute.value })),
      };
      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(element);
      } else if (!root) {
        root = element;
      }
      continue;
    }

    if (token.kind === 'close') {
      const current = stack[stack.length - 1];
      if (!current) {
        diagnostics.push({
          severity: 'warning',
          code: 'xaml.close.orphan',
          message: `Closing tag </${token.name}> has no matching opening tag.`,
          line: lines.lineAt(token.start),
        });
        continue;
      }
      if (current.name !== splitName(token.name).local) {
        diagnostics.push({
          severity: 'error',
          code: 'xaml.close.mismatch',
          message: `Expected </${current.name}> but found </${token.name}>.`,
          line: lines.lineAt(token.start),
        });
      }
      stack.pop();
      current.endTagSpan = {
        start: token.start,
        end: token.end,
        line: lines.lineAt(token.start),
        endLine: lines.lineAt(Math.max(token.start, token.end - 1)),
      };
      current.span = {
        ...current.span,
        end: token.end,
        endLine: lines.lineAt(Math.max(token.start, token.end - 1)),
      };
      continue;
    }

    if (token.kind === 'text' && stack.length > 0) {
      const value = xml.slice(token.start, token.end).trim();
      if (value) {
        const current = stack[stack.length - 1]!;
        current.text = current.text ? `${current.text} ${value}` : value;
      }
    }
  }

  for (const element of stack) {
    diagnostics.push({
      severity: 'error',
      code: 'xaml.open.unclosed',
      message: `<${element.name}> is never closed.`,
      line: element.startTagSpan.line,
    });
  }

  return root;
}

function attr(element: XamlElement, name: string): string | null {
  return element.attributes.find((attribute) => attribute.name === name)?.value ?? null;
}

function designStyle(element: XamlElement): XamlDesignNode['style'] {
  const margin = attr(element, 'Margin');
  const padding = attr(element, 'Padding');
  const color =
    attr(element, 'FontColorOverride') ??
    attr(element, 'Foreground') ??
    attr(element, 'Modulate');
  const styleBox = element.children.find((child) =>
    /^(StyleBoxFlat|StyleBoxTexture|StyleBoxEmpty)$/.test(child.name),
  );
  const background =
    attr(element, 'Background') ??
    (attr(element, 'PanelOverride') && !attr(element, 'PanelOverride')!.startsWith('{')
      ? attr(element, 'PanelOverride')
      : null) ??
    (styleBox ? attr(styleBox, 'BackgroundColor') : null);
  const borderColor = styleBox ? attr(styleBox, 'BorderColor') : attr(element, 'BorderColor');
  const borderThickness = styleBox
    ? Number(attr(styleBox, 'BorderThickness') ?? '0') || undefined
    : Number(attr(element, 'BorderThickness') ?? '0') || undefined;
  const cornerRadius = styleBox
    ? Number(attr(styleBox, 'CornerRadius') ?? '0') || undefined
    : undefined;
  const align = attr(element, 'HorizontalAlignment');
  const justify = attr(element, 'VerticalAlignment');
  const columns = Number(attr(element, 'Columns') ?? '0') || undefined;
  const rows = Number(attr(element, 'Rows') ?? '0') || undefined;
  const separation = Number(attr(element, 'SeparationOverride') ?? attr(element, 'Separation') ?? '0') || undefined;
  const fontSize = Number(attr(element, 'FontSize') ?? '0') || undefined;
  const opacity = Number(attr(element, 'Opacity') ?? '1');
  return {
    ...(margin ? { margin } : {}),
    ...(padding ? { padding } : {}),
    ...(color ? { color } : {}),
    ...(background ? { background } : {}),
    ...(borderColor ? { borderColor } : {}),
    ...(borderThickness ? { borderWidth: borderThickness } : {}),
    ...(cornerRadius ? { cornerRadius } : {}),
    ...(align ? { align } : {}),
    ...(justify ? { justify } : {}),
    ...(columns ? { columns } : {}),
    ...(rows ? { rows } : {}),
    ...(separation ? { separation } : {}),
    ...(fontSize ? { fontSize } : {}),
    ...(Number.isFinite(opacity) && opacity !== 1 ? { opacity } : {}),
  };
}

function attributesOf(element: XamlElement): Record<string, string> {
  const output: Record<string, string> = {};
  for (const attribute of element.attributes) {
    if (!attribute.name.startsWith('xmlns')) output[attribute.name] = attribute.value;
  }
  return output;
}

function toDesign(element: XamlElement, path: string): XamlDesignNode {
  const name = element.name;
  const text =
    attr(element, 'Text') ??
    attr(element, 'Placeholder') ??
    attr(element, 'Title') ??
    attr(element, 'Label') ??
    (element.children.length === 0 && element.text ? element.text : null);
  const orientationValue = attr(element, 'Orientation')?.toLowerCase();
  const orientation =
    orientationValue === 'vertical'
      ? 'vertical'
      : orientationValue === 'horizontal'
        ? 'horizontal'
        : name === 'BoxContainer' || name === 'SplitContainer'
          ? 'horizontal'
          : null;
  return {
    id: `${path}/${element.xname ?? name}`,
    name,
    className: element.xname ? `${name}#${element.xname}` : name,
    width: attr(element, 'Width') ?? attr(element, 'MinWidth'),
    height: attr(element, 'Height') ?? attr(element, 'MinHeight'),
    orientation,
    stretch: attr(element, 'HorizontalExpand') === 'True' || attr(element, 'VerticalExpand') === 'True',
    text,
    textResolved: text,
    textKey: null,
    tooltip: attr(element, 'ToolTip'),
    tooltipResolved: attr(element, 'ToolTip'),
    sourceLine: element.startTagSpan.line,
    attributes: attributesOf(element),
    image: null,
    style: designStyle(element),
    children: element.children.map((child, index) => toDesign(child, `${path}/${index}`)),
  };
}

/** Parse RobustToolbox colour strings into a CSS colour where possible. */
export function robustColorToCss(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    // RobustToolbox stores colours as RRGGBBAA.
    const red = trimmed.slice(1, 3);
    const green = trimmed.slice(3, 5);
    const blue = trimmed.slice(5, 7);
    const alpha = trimmed.slice(7, 9);
    return `#${red}${green}${blue}${alpha}`;
  }
  if (/^#[0-9a-fA-F]{4}$/.test(trimmed)) {
    const red = trimmed[1]!;
    const green = trimmed[2]!;
    const blue = trimmed[3]!;
    const alpha = trimmed[4]!;
    return `#${red}${green}${blue}${alpha}`;
  }
  return trimmed;
}

export interface CodeBehindInfo {
  handlers: string[];
  fields: { name: string; type: string }[];
}

export function parseCodeBehind(source: string): CodeBehindInfo {
  const handlers: string[] = [];
  const fields: { name: string; type: string }[] = [];
  const methodRe =
    /(?:private|public|protected|internal)?\s*(?:async\s+)?(?:void|Task|ValueTask)\s+([A-Za-z_]\w*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = methodRe.exec(source))) handlers.push(match[1]!);
  const fieldRe = /(?:private|public|protected|internal)?\s*(?:readonly\s+)?([A-Za-z_][\w<>.,?[\]]*)\s+([A-Za-z_]\w*)\s*;/g;
  while ((match = fieldRe.exec(source))) {
    fields.push({ type: match[1]!, name: match[2]! });
  }
  return { handlers, fields };
}

export function xamlCompletions(context?: string): XamlCompletion[] {
  const controls = XAML_CONTROLS.map((control) => ({
    label: control.name,
    kind: 'control' as const,
    detail: control.detail,
  }));
  const properties = XAML_PROPERTIES.map((property) => ({
    label: property.name,
    kind: 'property' as const,
    detail: property.detail,
  }));
  const events = XAML_EVENTS.map((event) => ({
    label: event.name,
    kind: 'event' as const,
    detail: event.detail,
  }));
  if (!context) return [...controls, ...properties, ...events];
  const normalized = context.toLowerCase();
  return [...controls, ...properties, ...events].filter((item) =>
    item.label.toLowerCase().includes(normalized),
  );
}

export interface ParseXamlOptions {
  filePath: string;
  relativePath: string;
  codeBehindPath?: string | null;
  codeBehindSource?: string | null;
}

export function parseXaml(source: string, options: ParseXamlOptions): XamlView {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = new LineIndex(normalized);
  const diagnostics: Diagnostic[] = [];
  const tokens = scan(normalized);
  const root = parseTree(normalized, tokens, lines, diagnostics);
  const className =
    root?.attributes.find((attribute) => attribute.name === 'x:Class')?.value ??
    normalized.match(/x:Class\s*=\s*"([^"]+)"/)?.[1] ??
    null;

  if (root) {
    if (!root.namespace && !root.attributes.some((attribute) => attribute.name.startsWith('xmlns'))) {
      diagnostics.push({
        severity: 'warning',
        code: 'xaml.namespace.missing',
        message: `The root element has no xmlns. RobustToolbox controls use ${SS14_NAMESPACE}.`,
        line: root.startTagSpan.line,
      });
    } else if (root.namespace && root.namespace !== SS14_NAMESPACE) {
      diagnostics.push({
        severity: 'info',
        code: 'xaml.namespace.other',
        message: `Root namespace is ${root.namespace}; most SS14 XAML uses ${SS14_NAMESPACE}.`,
        line: root.startTagSpan.line,
      });
    }
  } else {
    diagnostics.push({
      severity: 'error',
      code: 'xaml.root.missing',
      message: 'No root element was found.',
      line: 1,
    });
  }

  const xnames = new Set<string>();
  const outline: XamlView['outline'] = [];
  const events: { event: string; handler: string; element: XamlElement }[] = [];
  const walk = (element: XamlElement, depth: number) => {
    if (element.xname) {
      if (xnames.has(element.xname)) {
        diagnostics.push({
          severity: 'warning',
          code: 'xaml.name.duplicate',
          message: `x:Name "${element.xname}" is declared more than once.`,
          line: element.startTagSpan.line,
        });
      }
      xnames.add(element.xname);
    }
    outline.push({
      name: element.name,
      depth,
      xname: element.xname,
      line: element.startTagSpan.line,
    });
    for (const event of element.events) {
      events.push({ ...event, element });
    }
    for (const child of element.children) walk(child, depth + 1);
  };
  if (root) walk(root, 0);

  let codeBehindSource = options.codeBehindSource ?? null;
  const codeBehindExists = Boolean(options.codeBehindPath && codeBehindSource != null);
  const codeInfo = codeBehindSource ? parseCodeBehind(codeBehindSource) : { handlers: [], fields: [] };
  const csharpInfo = codeBehindSource && options.codeBehindPath
    ? parseCSharpFile(codeBehindSource, {
        filePath: options.codeBehindPath,
        relativePath: options.codeBehindPath,
      })
    : null;
  for (const event of events) {
    if (!codeInfo.handlers.includes(event.handler) && codeBehindSource) {
      diagnostics.push({
        severity: 'warning',
        code: 'xaml.handler.missing',
        message: `${event.event} references "${event.handler}", but no matching method exists in the code-behind.`,
        line: event.element.startTagSpan.line,
      });
    }
  }
  if (className && csharpInfo) {
    const shortName = className.split('.').pop();
    const declaration = csharpInfo.types.find((type) => type.name === shortName);
    if (!declaration) {
      diagnostics.push({
        severity: 'warning',
        code: 'xaml.codebehind.class',
        message: `x:Class "${className}" has no matching type in the code-behind.`,
        line: root?.startTagSpan.line ?? 1,
      });
    } else {
      if (!declaration.partial) {
        diagnostics.push({
          severity: 'warning',
          code: 'xaml.codebehind.partial',
          message: `${declaration.name} must be declared partial to connect to ${options.relativePath}.`,
          line: declaration.line,
        });
      }
      const dot = className.lastIndexOf('.');
      const expectedNamespace = dot > 0 ? className.slice(0, dot) : null;
      if (expectedNamespace && csharpInfo.namespace && expectedNamespace !== csharpInfo.namespace) {
        diagnostics.push({
          severity: 'warning',
          code: 'xaml.codebehind.namespace',
          message: `x:Class namespace "${expectedNamespace}" does not match the code-behind namespace "${csharpInfo.namespace}".`,
          line: declaration.line,
        });
      }
    }
  }

  const autoGenerated = /AutoGenerated|auto-generated|generated by SS14 Studio/i.test(normalized);

  return {
    filePath: options.filePath,
    relativePath: options.relativePath,
    source: normalized,
    root,
    className,
    codeBehindPath: options.codeBehindPath ?? null,
    codeBehindExists,
    codeBehindHandlers: codeInfo.handlers,
    codeBehindFields: codeInfo.fields,
    codeBehindNamespace: csharpInfo?.namespace ?? null,
    codeBehindTypes: csharpInfo?.types ?? [],
    outline,
    diagnostics,
    completions: xamlCompletions(),
    design: root ? toDesign(root, '') : null,
    autoGenerated,
  };
}

/* ------------------------------------------------------------------ */
/* Formatting / cleanup                                               */
/* ------------------------------------------------------------------ */

function tagLines(xml: string): string[] {
  return xml.replace(/\r\n/g, '\n').split('\n');
}

export interface XamlFormatOptions {
  /** Spaces per indentation level. Defaults to 4. */
  indentSize?: number;
  /** Preserve the source's CRLF line endings. Defaults to true. */
  preserveEol?: boolean;
}

export function formatXaml(source: string, options: XamlFormatOptions = {}): string {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const indentSize = Math.max(1, Math.min(8, Math.round(options.indentSize ?? 4)));
  const indent = ' '.repeat(indentSize);
  const eol = options.preserveEol !== false && /\r\n/.test(normalized) ? '\r\n' : '\n';
  const lines = tagLines(normalized);
  const output: string[] = [];
  let depth = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') output.push('');
      continue;
    }
    const closing = /^<\//.test(trimmed);
    if (closing) depth = Math.max(0, depth - 1);
    output.push(`${indent.repeat(depth)}${trimmed}`);
    const opens = (trimmed.match(/<[A-Za-z_][^>]*>/g) ?? []).filter(
      (tag) => !tag.startsWith('</') && !tag.endsWith('/>') && !tag.startsWith('<!') && !tag.startsWith('<?'),
    ).length;
    const closes = (trimmed.match(/<\/[A-Za-z_][^>]*>/g) ?? []).length;
    if (!closing) depth += Math.max(0, opens - closes);
  }
  while (output.length > 0 && output[output.length - 1] === '') output.pop();
  return `${output.join(eol)}${eol}`;
}

export function applyXamlOperation(
  source: string,
  operation: XamlOperation,
  relativePath = 'file.xaml',
  options: XamlFormatOptions = {},
): { text: string; message: string } {
  const eol = options.preserveEol !== false && /\r\n/.test(source) ? '\r\n' : '\n';
  if (operation.kind === 'format') {
    return {
      text: formatXaml(source, options),
      message: `Formatted ${relativePath} with ${Math.max(1, options.indentSize ?? 4)}-space indentation.`,
    };
  }
  if (operation.kind === 'cleanup') {
    let text = formatXaml(source, options);
    text = text.replace(/[ \t]+$/gm, '');
    if (!/AutoGenerated/i.test(text)) {
      text = `<!-- AutoGenerated by SS14 Studio. This file may be regenerated. -->${eol}${text}`;
    }
    return { text, message: `Cleaned up ${relativePath}.` };
  }
  if (operation.kind === 'markAutoGenerated') {
    if (/AutoGenerated/i.test(source)) {
      return { text: source, message: 'This file is already marked as AutoGenerated.' };
    }
    const marker = `<!-- AutoGenerated by SS14 Studio. This file may be regenerated. -->${eol}`;
    const text = source.startsWith('<?')
      ? source.replace(/(\?>[^\n]*\r?\n)/, `$1${marker}`)
      : `${marker}${source}`;
    return { text, message: 'Added the AutoGenerated marker.' };
  }
  if (operation.kind === 'removeAutoGenerated') {
    const text = source
      .split(/\r?\n/)
      .filter((line) => !/AutoGenerated by SS14 Studio/i.test(line))
      .join(eol);
    return { text, message: 'Removed the AutoGenerated marker.' };
  }
  return { text: source, message: 'Unsupported XAML operation.' };
}

export { SS14_NAMESPACE };
