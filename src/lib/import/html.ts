/**
 * HTML to typed blocks, for archives that export HTML rather than Markdown.
 *
 * Markdown, Substack and WordPress all reduce to text, and text is the easy
 * case. Medium and Google Docs do not: "Download your data" from Medium gives
 * one `.html` file per post, and Google Docs gives a Word-flavoured HTML
 * document. Both carry the author's own structure — headings, lists, quotes,
 * code, tables, figures — and the existing importer flattened all of it with
 * `htmlToText`, so an imported post arrived as undifferentiated paragraphs.
 * Every heading became body text. That is not a lossy import, it is a destroyed
 * one, and the writer then has to rebuild the shape of their own writing by hand.
 *
 * So this is a real converter. Inline markup comes out in the *existing* inline
 * dialect — `**strong**`, `*em*`, `` `code` ``, `==mark==`, `[label](href)` —
 * because `renderInline` already understands exactly that, and inventing a
 * second dialect would mean a second renderer to keep in step.
 *
 * Untrusted input throughout. Nothing here executes, fetches, or resolves
 * anything; `<script>`, `<style>`, `<svg>`, `<iframe>` and friends are dropped
 * rather than flattened, because a flattened `<script>` body is just its source
 * sitting in the reader's article. Hrefs are passed through untouched on
 * purpose: `renderInline` runs them through `safeHref`, which drops anything
 * that is not http(s), mailto, in-page or same-origin — so the filtering lives
 * in one place, at render, where it cannot be forgotten.
 */

import { newBlockId, type Block } from '../blocks';
import { IMPORT_LIMITS } from './shared';

/* --------------------------------------------------------------- tokenizer */

interface HNode {
  /** Lowercased tag name; '' for a text node. */
  tag: string;
  attrs: Record<string, string>;
  children: HNode[];
  text?: string;
}

/** Never have content, so they never open a scope. */
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Dropped with their contents, not flattened. */
const OMIT_SUBTREE = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'math',
  'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'form', 'select',
]);

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

/**
 * `p` and `li` are the two elements HTML lets you leave open. Media exports are
 * full of `<li>text<li>text`, so closing them implicitly is not a nicety — it is
 * the difference between a list and one enormous line.
 *
 * `td`/`th` deliberately do *not* close `tr`. Adding `tr` there looks harmless
 * and is not: `<tr><th>` would pop the row off the stack, leaving every cell a
 * direct child of the table, and the row would then read as having no cells at
 * all — so the whole table silently vanished.
 */
const IMPLIED_CLOSE: Record<string, Set<string>> = {
  p: new Set(['p']),
  li: new Set(['li', 'p']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  tr: new Set(['tr']),
  option: new Set(['option']),
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeCodePoint(Number(d)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0?39;|&rsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&amp;/gi, '&');
}

/** An entity must not be able to produce a lone surrogate or a huge allocation. */
function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    if (name.length <= 64) out[name] = value;
  }
  return out;
}

/**
 * A deliberately tolerant HTML parser.
 *
 * Not a spec-compliant tree builder, and it does not need to be: the input is a
 * known export from a known generator, and the failure mode that matters is
 * crashing or losing text, not mis-nesting an edge case. Anything it cannot
 * make sense of becomes a text node, so no prose is ever dropped.
 */
export function parseHtml(html: string): HNode[] {
  const roots: HNode[] = [];
  const stack: HNode[] = [];
  const push = (node: HNode) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
  };

  let i = 0;
  const len = html.length;
  let textStart = 0;

  const flushText = (upto: number) => {
    if (upto <= textStart) return;
    const raw = html.slice(textStart, upto);
    if (!raw) return;
    push({ tag: '', attrs: {}, children: [], text: decodeEntities(raw) });
  };

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // A `<` that is not a tag start is literal text. Media exports contain
    // `a < b` in code samples and prose often enough to matter.
    if (!/[a-zA-Z!/?]/.test(html[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }

    flushText(lt);
    i = lt;

    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? len : end + 3;
      textStart = i;
      continue;
    }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i);
      i = end === -1 ? len : end + 1;
      textStart = i;
      continue;
    }

    const closing = html[i + 1] === '/';
    const nameMatch = /^<\/?([a-zA-Z][-a-zA-Z0-9:]*)/.exec(html.slice(i, i + 64));
    if (!nameMatch) {
      // Not a tag. Emit the bracket as text and carry on.
      push({ tag: '', attrs: {}, children: [], text: '<' });
      i += 1;
      textStart = i;
      continue;
    }
    const tag = nameMatch[1]!.toLowerCase();

    const end = findTagEnd(html, i);
    const inner = html.slice(i + nameMatch[0].length, end);
    i = end + 1;
    textStart = i;

    if (closing) {
      // Close the nearest matching ancestor; ignore a stray close tag, which
      // real exports contain.
      for (let d = stack.length - 1; d >= 0; d--) {
        if (stack[d]!.tag === tag) {
          stack.length = d;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.trimEnd().endsWith('/');
    const node: HNode = { tag, attrs: parseAttrs(inner), children: [] };

    const implied = IMPLIED_CLOSE[node.tag];
    if (implied) {
      for (let d = stack.length - 1; d >= 0; d--) {
        if (implied.has(stack[d]!.tag)) {
          stack.length = d;
          break;
        }
        // Only unwind as far as a container that legitimately holds this.
        if (!['ul', 'ol', 'dl', 'table', 'tbody', 'thead', 'tr', 'body', 'div', 'section', 'article'].includes(stack[d]!.tag)) break;
      }
    }

    if (OMIT_SUBTREE.has(tag)) {
      // Skip to the matching close rather than descending: the contents are code
      // or markup, never prose.
      if (!selfClosing && !VOID.has(tag)) {
        const close = findCloseTag(html, tag, i);
        i = close === -1 ? len : close;
        textStart = i;
      }
      continue;
    }

    push(node);
    if (!selfClosing && !VOID.has(tag)) {
      if (RAW_TEXT.has(tag)) {
        const close = findCloseTag(html, tag, i);
        const stop = close === -1 ? len : close;
        const raw = decodeEntities(html.slice(i, stop));
        if (raw) node.children.push({ tag: '', attrs: {}, children: [], text: raw });
        i = stop;
        textStart = i;
      } else {
        stack.push(node);
      }
    }
  }

  flushText(len);
  return roots;
}

/** The `>` that ends a tag, ignoring any inside a quoted attribute value. */
function findTagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from + 1; i < html.length; i++) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return html.length - 1;
}

/** Offset just past the matching close tag, honouring nesting of the same name. */
function findCloseTag(html: string, tag: string, from: number): number {
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let cursor = from;
  while (cursor < html.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth++;
      cursor = o.index + 1;
    } else {
      depth--;
      cursor = c.index + c[0].length;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

/* ------------------------------------------------------------- inline text */

/**
 * Children of an inline context, rendered in the editor's inline dialect.
 *
 * `wrap` is applied to text only when there is text inside it, so an empty
 * `<strong></strong>` cannot produce stray `****` that `renderInline` would then
 * read as emphasis.
 */
function inline(nodes: HNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.tag === '') {
      out += node.text ?? '';
      continue;
    }
    switch (node.tag) {
      case 'b':
      case 'strong':
        out += wrap(inline(node.children), '**');
        break;
      case 'i':
      case 'em':
        out += wrap(inline(node.children), '*');
        break;
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        // Code content is literal: never let its own backticks or asterisks be
        // read as markup.
        out += wrap(plain(node.children), '`');
        break;
      case 'mark':
        out += wrap(inline(node.children), '==');
        break;
      case 'a': {
        const label = inline(node.children).trim();
        const href = (node.attrs.href ?? '').trim();
        if (!label) break;
        out += href ? `[${label}](${href})` : label;
        break;
      }
      case 'br':
        out += '\n';
        break;
      case 'sup':
      case 'sub':
      case 'small':
      case 'u':
      case 'time':
        out += inline(node.children);
        break;
      case 'span':
      case 'font': {
        /* Google Docs has no bold element. It marks emphasis with
           `font-weight: 700` on a span, so a Docs import without this arrives
           with every bolded word looking like ordinary prose — the formatting is
           in the file and simply not being read.

           Read off the inline `style`, and only from `style`: a class name is
           opaque here, and guessing at one would bold things nobody asked to be
           bold. */
        const style = node.attrs.style ?? '';
        const weight = /(?:^|;)\s*font-weight\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
        const bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
        const italic = /(?:^|;)\s*font-style\s*:\s*italic/i.test(style);
        const text = inline(node.children);
        out += bold ? wrap(text, '**') : italic ? wrap(text, '*') : text;
        break;
      }
      case 'img': {
        const alt = (node.attrs.alt ?? '').trim();
        if (alt) out += alt;
        break;
      }
      default:
        out += inline(node.children);
    }
  }
  return out;
}

function wrap(text: string, marker: string): string {
  const t = text.trim();
  if (!t) return '';
  // A code span cannot contain a backtick; if it does, the editor would render
  // it as prose. Emitting the bare text is better than emitting broken markup.
  if (marker === '`' && t.includes('`')) return t;
  return `${marker}${t}${marker}`;
}

function plain(nodes: HNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.tag === '') out += node.text ?? '';
    else if (node.tag === 'br') out += '\n';
    else out += plain(node.children);
  }
  return out;
}

/** Collapse whitespace without eating the newlines `<br>` produced. */
function tidy(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ----------------------------------------------------------------- blocks */

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol',
  'table', 'figure', 'hr', 'section', 'article', 'main', 'div', 'aside',
  'header', 'footer', 'nav', 'body', 'html', 'details', 'summary',
]);

function isBlocky(node: HNode): boolean {
  if (node.tag === '') return false;
  if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol', 'table', 'figure', 'hr'].includes(node.tag)) return true;
  if (!BLOCK_TAGS.has(node.tag)) return false;
  // A div that only wraps inline content is a container, not a paragraph.
  return node.children.some((c) => isBlocky(c));
}

interface Ctx {
  warnings: string[];
  blocks: Block[];
}

function emit(ctx: Ctx, payload: Record<string, unknown>): void {
  if (ctx.blocks.length >= IMPORT_LIMITS.maxBlocksPerPost) {
    if (ctx.warnings[ctx.warnings.length - 1] !== 'Block limit reached.') {
      ctx.warnings.push('Block limit reached.');
    }
    return;
  }
  ctx.blocks.push({ id: newBlockId(), ...payload } as Block);
}

/** One post's worth of HTML to blocks. */
export function htmlToBlocks(html: string, warnings: string[] = []): Block[] {
  const ctx: Ctx = { warnings, blocks: [] };
  walk(parseHtml(html), ctx);
  return ctx.blocks;
}

function walk(nodes: HNode[], ctx: Ctx): void {
  // Loose inline text between block elements still deserves to be kept.
  let loose: HNode[] = [];

  const flushLoose = () => {
    if (!loose.length) return;
    const text = tidy(inline(loose));
    loose = [];
    if (text) emit(ctx, { type: 'paragraph', text });
  };

  for (const node of nodes) {
    if (node.tag === '') {
      loose.push(node);
      continue;
    }
    if (node.tag === 'br') {
      loose.push(node);
      continue;
    }
    if (!isBlocky(node)) {
      loose.push(node);
      continue;
    }
    flushLoose();
    block(node, ctx);
  }
  flushLoose();
}

function block(node: HNode, ctx: Ctx): void {
  switch (node.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = tidy(inline(node.children));
      if (!text) return;
      // The editor's headings are H2/H3 only; a document's single H1 is its
      // title, not a section, so deeper levels collapse upward rather than
      // becoming body text.
      emit(ctx, { type: 'heading', level: node.tag === 'h3' || node.tag === 'h4' || node.tag === 'h5' || node.tag === 'h6' ? 3 : 2, text });
      return;
    }
    case 'p': {
      // A paragraph holding only an image is a figure wearing a disguise. Both
      // Medium and Google Docs wrap a picture in a <p>.
      const img = onlyMeaningful(node);
      if (img) {
        figure(img, node, ctx);
        return;
      }
      const text = tidy(inline(node.children));
      if (text) emit(ctx, { type: 'paragraph', text });
      return;
    }
    case 'blockquote': {
      // A blockquote that is mostly a link and short is a pull quote; anything
      // longer is prose in someone else's voice. Keep the attribution if the
      // export gave one, otherwise leave it blank rather than inventing one.
      const text = tidy(inline(node.children));
      if (!text) return;
      const cite = node.children.find((c) => c.tag === 'cite' || c.tag === 'footer');
      emit(ctx, { type: 'quote', text, attribution: cite ? tidy(inline(cite.children)) : '' });
      return;
    }
    case 'pre': {
      const codeEl = node.children.find((c) => c.tag === 'code');
      const code = (codeEl ? plain(codeEl.children) : plain(node.children)).replace(/\n+$/, '');
      if (!code.trim()) return;
      const cls = codeEl?.attrs.class ?? node.attrs.class ?? '';
      const lang = /language-([a-z0-9+#._-]+)/i.exec(cls)?.[1]?.toLowerCase() ?? 'text';
      emit(ctx, { type: 'code', lang, code, caption: '' });
      return;
    }
    case 'ul':
    case 'ol': {
      const items: string[] = [];
      for (const child of node.children) {
        if (child.tag !== 'li') continue;
        // Nested lists are rare enough in exports that dropping them loses less
        // than a flattened run-on line does — but say so rather than pretend.
        const hasNested = child.children.some((c) => c.tag === 'ul' || c.tag === 'ol');
        const text = tidy(inline(child.children.filter((c) => c.tag !== 'ul' && c.tag !== 'ol')));
        if (text) items.push(text);
        if (hasNested) {
          ctx.warnings.push('A nested list was flattened into its parent item.');
        }
      }
      if (items.length) emit(ctx, { type: 'list', ordered: node.tag === 'ol', items });
      return;
    }
    case 'table': {
      const table = readTable(node);
      if (table) emit(ctx, table);
      return;
    }
    case 'figure': {
      const img = findFirst(node, 'img');
      if (img) {
        figure(img, node, ctx);
        return;
      }
      walk(node.children, ctx);
      return;
    }
    case 'hr':
      return;
    default:
      walk(node.children, ctx);
  }
}

/** The image a paragraph is only wrapping, if that is all it holds. */
function onlyMeaningful(node: HNode): HNode | null {
  const significant = node.children.filter((c) => !(c.tag === '' && !c.text?.trim()));
  if (significant.length !== 1) return null;
  const only = significant[0]!;
  if (only.tag === 'img') return only;
  if (only.tag === 'a') {
    const inner = only.children.filter((c) => c.tag === 'img');
    if (inner.length === 1 && significant.length === 1) return inner[0]!;
  }
  return null;
}

function findFirst(node: HNode, tag: string): HNode | null {
  for (const child of node.children) {
    if (child.tag === tag) return child;
    const nested = findFirst(child, tag);
    if (nested) return nested;
  }
  return null;
}

function figure(img: HNode, container: HNode, ctx: Ctx): void {
  const src = (img.attrs.src ?? '').trim();
  if (!src) {
    ctx.warnings.push('An image was dropped because the export had no address for it.');
    return;
  }
  const captionEl = container.children.find((c) => c.tag === 'figcaption');
  emit(ctx, {
    type: 'figure',
    src,
    alt: (img.attrs.alt ?? '').trim(),
    caption: captionEl ? tidy(inline(captionEl.children)) : '',
  });
}

/**
 * Table to the editor's head/rows shape.
 *
 * Only a real `<th>` makes a header row. Promoting the first row unconditionally
 * would silently turn a data row into a header on every table an export
 * produces, and the author would have to notice and undo it.
 */
function readTable(node: HNode): { type: 'table'; head: string[]; rows: string[][] } | null {
  const rowNodes = collectRows(node);
  const rows: string[][] = [];
  let hasHeader = false;

  for (const tr of rowNodes) {
    const cells: string[] = [];
    for (const cell of tr.children) {
      if (cell.tag !== 'td' && cell.tag !== 'th') continue;
      if (cell.tag === 'th') hasHeader = true;
      cells.push(tidy(inline(cell.children)).replace(/\|/g, '\\|'));
    }
    if (cells.length) rows.push(cells);
  }

  if (rows.length < 2) return null;
  return hasHeader
    ? { type: 'table', head: rows[0]!, rows: rows.slice(1) }
    : { type: 'table', head: [], rows };
}

function collectRows(node: HNode): HNode[] {
  const out: HNode[] = [];
  const visit = (n: HNode) => {
    for (const c of n.children) {
      if (c.tag === 'tr') out.push(c);
      else visit(c);
    }
  };
  visit(node);
  return out;
}

/* ------------------------------------------------------------- extraction */

/** `<meta>` values, keyed by `name` or `property`, lowercased. */
export function htmlMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = parseAttrs(m[0].slice(5, -1));
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    const value = attrs.content ?? '';
    if (key && value && !out[key]) out[key] = decodeEntities(value);
  }
  return out;
}

/**
 * The inner HTML of the first element matching a predicate.
 *
 * Media exports wrap the article in a lot of navigation, signup prompts and
 * share buttons. Importing those as prose is worse than importing nothing, so
 * the body has to be found rather than assumed.
 */
export function extractSubtree(
  html: string,
  match: (tag: string, attrs: Record<string, string>) => boolean,
): string | null {
  const tokens = parseHtml(html);
  /* An explicit stack, not a recursive closure: TypeScript cannot see an
     assignment made inside a closure, so it narrows the result to `null` and
     rejects the property access. An array cannot be narrowed that way. */
  const stack: HNode[] = [...tokens];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.tag !== '' && match(node.tag, node.attrs)) {
      return serialize(node.children);
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return null;
}

/**
 * Back to HTML so `htmlToBlocks` can parse it as a standalone fragment.
 *
 * Attributes have to survive. This looks like a pointless round-trip through a
 * string when the whole point was to find a subtree in a document, and it
 * nearly was: the first version emitted `<a>` instead of `<a href="...">`, which
 * silently turned every link in an imported archive into plain text and every
 * `<code class="language-go">` into an unlabelled code block. Both bugs were
 * invisible in the output and obvious in the assertions.
 */
function serialize(nodes: HNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.tag === '') {
      out += (n.text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      continue;
    }
    let attrs = '';
    for (const [name, value] of Object.entries(n.attrs)) {
      // Attribute names come from a permissive regex, so they are checked
      // rather than trusted: this string is re-parsed as HTML.
      if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(name)) continue;
      attrs += ` ${name}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
    }
    if (VOID.has(n.tag)) {
      out += `<${n.tag}${attrs}>`;
      continue;
    }
    out += `<${n.tag}${attrs}>${serialize(n.children)}</${n.tag}>`;
  }
  return out;
}