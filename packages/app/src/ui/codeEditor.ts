import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion, type Completion as CmCompletion, type CompletionContext, type CompletionResult as CmResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Annotation, EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { Completion, CompletionResult, EditorCheck } from '../builder/scriptAssist';
import { SCRIPT_API } from '../builder/scriptRef';

/**
 * The code editor of the script view (M16): CodeMirror 6 with the JavaScript language, the pieces of its basic setup
 * the game needs (line numbers, history, brackets, search, completion, the lint gutter), and the Shop floor look.
 * It knows nothing of robots: what to complete and what to mark are handed in as plain data (`scriptAssist.ts`).
 */

/** Marks a change the editor did not make itself (the text was replaced from outside), so it is not sent back. */
const outside = Annotation.define<boolean>();

/** The Shop floor look, from the tokens in `styles.css`. */
const look = EditorView.theme(
  {
    '&': { color: 'var(--ink)', backgroundColor: 'var(--plate-3)', height: '100%', fontSize: '12.5px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', overflow: 'auto' },
    '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
    '.cm-line': { padding: '0 10px 0 6px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(242, 183, 5, 0.26)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
    '.cm-gutters': { backgroundColor: 'var(--plate-3)', color: 'var(--dim)', border: 'none', borderRight: '1px solid var(--edge)', fontFamily: 'var(--mono)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--ink)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 8px', minWidth: '30px' },
    '.cm-gutter-lint': { width: '14px' },
    '.cm-gutter-lint .cm-gutterElement': { padding: '0 0 0 3px' },
    '.cm-lint-marker': { width: '9px', height: '9px', marginTop: '6px' },
    '.cm-lint-marker-warning': { content: 'none', background: 'var(--warn)' },
    '.cm-lint-marker-error': { content: 'none', background: 'var(--bad)' },
    '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '2px solid var(--warn)', backgroundColor: 'rgba(224, 138, 46, 0.13)' },
    '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '2px solid var(--bad)', backgroundColor: 'rgba(229, 83, 60, 0.13)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(63, 193, 212, 0.22)', outline: '1px solid var(--reach)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(255, 255, 255, 0.09)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(242, 183, 5, 0.25)', outline: '1px solid var(--accent)' },
    '.cm-tooltip': { backgroundColor: 'var(--plate)', color: 'var(--ink)', border: '2px solid var(--edge)', borderRadius: '0', boxShadow: 'inset 0 1px 0 var(--edge-hi), 0 10px 30px rgba(0, 0, 0, 0.5)', fontFamily: 'var(--body)', fontSize: '12.5px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', fontSize: '12.5px', maxHeight: '15em', minWidth: '260px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px', lineHeight: '1.45' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' },
    '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': { color: 'var(--accent-ink)' },
    '.cm-completionDetail': { color: 'var(--dim)', fontStyle: 'normal', fontFamily: 'var(--body)', fontSize: '12px', marginLeft: '10px' },
    '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
    '.cm-completionIcon': { width: '14px', opacity: '1', paddingRight: '8px', fontSize: '11px' },
    '.cm-completion-dim .cm-completionLabel': { opacity: '0.5' },
    '.cm-completionSection, .cm-tooltip-autocomplete completion-section': { fontFamily: 'var(--head)', textTransform: 'uppercase', letterSpacing: 'var(--head-space)', fontSize: '11px', color: 'var(--dim)', borderBottom: '1px solid var(--edge)', padding: '4px 8px 2px' },
    '.cm-tooltip.cm-completionInfo': { padding: '6px 9px', maxWidth: '300px', lineHeight: '1.4' },
    '.cm-tooltip-lint': { padding: '0' },
    '.cm-diagnostic': { padding: '6px 9px', borderLeft: '4px solid var(--warn)', maxWidth: '420px', lineHeight: '1.4' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--bad)' },
    '.cm-diagnosticAction': { font: '700 11px var(--head)', textTransform: 'uppercase', letterSpacing: 'var(--head-space)', background: 'var(--plate-2)', color: 'var(--ink)', border: '2px solid var(--edge)', borderRadius: '0', padding: '2px 7px', margin: '5px 5px 0 0', cursor: 'pointer' },
    '.cm-api-tip': { padding: '6px 9px', maxWidth: '360px', lineHeight: '1.4' },
    '.cm-api-tip code': { fontFamily: 'var(--mono)', color: 'var(--accent)' },
    '.cm-panels': { backgroundColor: 'var(--plate)', color: 'var(--ink)', borderTop: '2px solid var(--edge)' },
    '.cm-panels input, .cm-panels button': { fontFamily: 'var(--body)' },
    '.cm-textfield': { backgroundColor: 'var(--plate-3)', color: 'var(--ink)', border: '2px solid var(--edge)', borderRadius: '0' },
    '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--plate-2)', color: 'var(--ink)', border: '2px solid var(--edge)', borderRadius: '0' },
  },
  { dark: true },
);

/** Colours for the code: few, and none of them the yellow of the selection or the red of a problem. */
const colours = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7d858d', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword, t.modifier], color: '#e0a35c' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a8cf8e' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#7fc4d6' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#f0e6c0' },
  { tag: [t.definition(t.variableName), t.definition(t.function(t.variableName))], color: '#e6e2d6', fontWeight: '600' },
  { tag: [t.propertyName], color: '#c9c5b8' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#9aa1a8' },
  { tag: t.invalid, color: '#e5533c' },
]);

const ICON: Record<Completion['kind'], string> = { group: 'class', kind: 'type', part: 'constant', input: 'property', output: 'variable', api: 'function', member: 'property' };
const SECTION: Partial<Record<Completion['kind'], { name: string; rank: number }>> = {
  group: { name: 'Groups', rank: 0 },
  kind: { name: 'Kinds of part', rank: 1 },
  part: { name: 'Single parts', rank: 2 },
  input: { name: 'Inputs', rank: 0 },
  output: { name: 'What it reports', rank: 1 },
};

export interface CodeEditorHooks {
  /** The text changed by typing (never called for a text set from outside). */
  onChange(text: string): void;
  onFocus(): void;
  onBlur(): void;
  /** What to offer at a place in the text (`scriptAssist.completeAt`). */
  complete(text: string, pos: number, inComment: boolean): CompletionResult | undefined;
}

export interface CodeEditor {
  view: EditorView;
  /** Replaces the text when it is not what the editor holds (an undo in the builder, a fix, an update). */
  setText(text: string): void;
  /** Marks in the margin and under the text. */
  setChecks(checks: readonly EditorCheck[]): void;
  /** Puts text in at the caret (over the selection), with the caret `caret` characters before its end. */
  insert(text: string, caret?: number): void;
  /** Shows a line (from 1), selected. */
  showLine(line: number): void;
  /** Selects a stretch of the text and brings it into view. */
  showRange(from: number, to: number): void;
  /** Scrolls so the caret is in view, when the text has the focus (the room for the code changed). */
  keepCaretInView(): void;
  focus(): void;
  destroy(): void;
}

/** The API entry a word under the mouse is about, if any: `set`, `contacts`, `self.pos`, `p.spec`. */
function apiAt(doc: string, from: number, to: number): { sig: string; about: string; more?: string } | undefined {
  const word = doc.slice(from, to);
  const before = doc.slice(Math.max(0, from - 12), from);
  const owner = /([A-Za-z_]\w*)\.$/.exec(before)?.[1];
  const whole = owner !== undefined ? `${owner}.${word}` : word;
  const e = SCRIPT_API.find((x) => x.name === whole) ?? (owner !== undefined && owner !== 'self' && owner !== 'keys' && owner !== 'Math' ? SCRIPT_API.find((x) => x.name === `part.${word}` || (x.name.startsWith('part.') && new RegExp(`\\bp\\.${word}\\b`).test(x.sig))) : SCRIPT_API.find((x) => x.name === word));
  return e ? { sig: e.sig, about: e.about, ...(e.more !== undefined ? { more: e.more } : {}) } : undefined;
}

export function createCodeEditor(parent: HTMLElement, text: string, hooks: CodeEditorHooks): CodeEditor {
  const source = (ctx: CompletionContext): CmResult | null => {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    const inComment = /Comment/.test(node.name);
    const r = hooks.complete(ctx.state.doc.toString(), ctx.pos, inComment);
    if (!r) return null;
    // A bare word offers the API only once something is typed, or when asked for (Ctrl+Space).
    if (r.where === 'word' && !ctx.explicit && ctx.pos - r.from < 1) return null;
    const options: CmCompletion[] = r.options.map((o) => {
      const section = SECTION[o.kind];
      const out: CmCompletion = { label: o.label, detail: o.dim !== undefined ? `${o.detail} (${o.dim})` : o.detail, type: o.dim !== undefined ? 'completion-dim' : ICON[o.kind], boost: -o.rank };
      if (o.info !== undefined) out.info = o.info;
      if (o.apply !== undefined) out.apply = o.apply;
      if (section && r.where !== 'word' && r.where !== 'member') out.section = section;
      if (r.where === 'name' || r.where === 'channel') {
        // The whole name is replaced, not only what is left of the caret; then on to what is typed next.
        out.apply = (view, _c, from, to) => {
          const line = view.state.doc.lineAt(to);
          const rest = /^[^"'`\n,)]*/.exec(line.text.slice(to - line.from))?.[0].length ?? 0;
          view.dispatch({ changes: { from, to: to + rest, insert: o.label }, selection: { anchor: from + o.label.length }, userEvent: 'input.complete' });
        };
      }
      return out;
    });
    return { from: r.from, to: ctx.pos, options, validFor: r.where === 'name' || r.where === 'channel' ? /^[^"'`\n,)]*$/ : /^\w*$/ };
  };

  const tips = hoverTooltip((view, pos) => {
    const { from, to, text: lineText } = view.state.doc.lineAt(pos);
    let start = pos;
    let end = pos;
    while (start > from && /\w/.test(lineText[start - from - 1] ?? '')) start--;
    while (end < to && /\w/.test(lineText[end - from] ?? '')) end++;
    if (start === end) return null;
    const node = syntaxTree(view.state).resolveInner(pos, 0);
    if (/Comment|String/.test(node.name)) return null;
    const e = apiAt(view.state.doc.toString(), start, end);
    if (!e) return null;
    return {
      pos: start,
      end,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-api-tip';
        const sig = document.createElement('code');
        sig.textContent = e.sig;
        dom.append(sig, document.createTextNode(`  ${e.about}.`));
        if (e.more !== undefined) {
          const more = document.createElement('div');
          more.textContent = e.more;
          more.style.marginTop = '4px';
          more.style.color = 'var(--dim)';
          dom.append(more);
        }
        return { dom };
      },
    };
  });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        lintGutter(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        EditorState.tabSize.of(2),
        indentUnit.of('  '),
        EditorView.lineWrapping,
        javascript(),
        syntaxHighlighting(colours),
        autocompletion({ override: [source], activateOnTyping: true, icons: true, closeOnBlur: true, maxRenderedOptions: 60, optionClass: (c) => (c.type === 'completion-dim' ? 'cm-completion-dim' : '') }),
        tips,
        look,
        // Esc only closes a completion or a search: it never lets go of the text, or the next letters typed would be the
        // board's keys (E takes the eraser). Done, or a click on the board, leaves it.
        keymap.of([...closeBracketsKeymap, ...completionKeymap, ...lintKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(outside))) hooks.onChange(u.state.doc.toString());
          if (u.focusChanged) (u.view.hasFocus ? hooks.onFocus : hooks.onBlur)();
          // A quote opened inside set( or get(, or a comma after the name: the real names are offered at once.
          if (u.docChanged && u.transactions.some((tr) => tr.isUserEvent('input.type'))) {
            const pos = u.state.selection.main.head;
            const line = u.state.doc.lineAt(pos);
            if (/\b(set|get)\(\s*(["'][^"'\n]*["']\s*,\s*)?["']$/.test(line.text.slice(0, pos - line.from))) setTimeout(() => startCompletion(u.view), 0);
          }
        }),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': 'script code' }),
      ],
    }),
  });

  const clampPos = (p: number): number => Math.max(0, Math.min(p, view.state.doc.length));
  return {
    view,
    setText(next) {
      const now = view.state.doc.toString();
      if (next === now) return;
      // Only what differs is replaced, so the caret stays where it was when it can.
      let a = 0;
      while (a < now.length && a < next.length && now[a] === next[a]) a++;
      let b = 0;
      while (b < now.length - a && b < next.length - a && now[now.length - 1 - b] === next[next.length - 1 - b]) b++;
      view.dispatch({ changes: { from: a, to: now.length - b, insert: next.slice(a, next.length - b) }, annotations: outside.of(true) });
    },
    setChecks(checks) {
      const len = view.state.doc.length;
      const diagnostics: Diagnostic[] = checks.map((c) => {
        const from = clampPos(c.from);
        const to = Math.max(from, clampPos(c.to));
        const d: Diagnostic = { from, to, severity: c.severity, message: c.message };
        if (c.fixes.length > 0)
          d.actions = c.fixes.map((f) => ({
            name: f.label,
            apply: (v, df, dt) => v.dispatch({ changes: { from: df, to: dt, insert: f.text } }),
          }));
        return d;
      });
      view.dispatch(setDiagnostics(view.state, diagnostics.filter((d) => d.from <= len)));
    },
    insert(textIn, caret = 0) {
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: textIn }, selection: { anchor: sel.from + textIn.length - caret }, scrollIntoView: true, userEvent: 'input' });
      view.focus();
    },
    showLine(n) {
      const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      view.focus();
    },
    showRange(from, to) {
      const a = clampPos(from);
      const b = Math.max(a, clampPos(to));
      view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
      view.focus();
    },
    keepCaretInView() {
      if (view.hasFocus) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest', yMargin: 24 }) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
