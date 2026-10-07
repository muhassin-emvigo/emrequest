// GraphQL editor for the request tab. Bundled by esbuild into media/graphql-editor.js
// and loaded only when the user picks the GraphQL body type.
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';
import { graphql as graphqlLang, updateSchema } from 'cm6-graphql';
import {
  buildClientSchema, buildSchema, getIntrospectionQuery, parse, print,
  isObjectType, isInterfaceType, isInputObjectType, isEnumType, isUnionType, isScalarType,
  getNamedType, isLeafType,
} from 'graphql';

// ---------- look: follow the VS Code theme ----------
const theme = EditorView.theme({
  '&': {
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-input-background)',
    fontSize: 'var(--vscode-editor-font-size)',
    border: '1px solid var(--vscode-input-border, transparent)',
    borderRadius: '2px',
    height: '100%',
  },
  '&.cm-focused': { outline: '1px solid var(--vscode-focusBorder)' },
  '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground)' },
  '.cm-cursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
  '.cm-gutters': {
    backgroundColor: 'var(--vscode-input-background)',
    color: 'var(--vscode-editorLineNumber-foreground)',
    border: 'none',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background))',
    color: 'var(--vscode-editorSuggestWidget-foreground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-widget-border))',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground))',
    color: 'var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground))',
  },
  '.cm-completionInfo': { maxWidth: '360px', padding: '4px 8px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--vscode-editorError-foreground)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--vscode-editorError-foreground)' },
  '.cm-panels': { backgroundColor: 'var(--vscode-editorWidget-background)', color: 'var(--vscode-foreground)' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: 'var(--vscode-descriptionForeground)' },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.operatorKeyword], color: 'var(--vscode-debugTokenExpression-boolean, #569cd6)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--vscode-debugTokenExpression-name, #9cdcfe)' },
  { tag: [t.typeName, t.className], color: 'var(--vscode-symbolIcon-classForeground, #4ec9b0)' },
  { tag: [t.variableName, t.special(t.variableName)], color: 'var(--vscode-symbolIcon-variableForeground, #c586c0)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--vscode-debugTokenExpression-string, #ce9178)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--vscode-debugTokenExpression-number, #b5cea8)' },
  { tag: t.comment, color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.brace], color: 'var(--vscode-editor-foreground)' },
]);

// ---------- schema helpers ----------
/** Accepts an introspection result ({data:{__schema}} or {__schema}) or SDL text. Throws with a readable message. */
function schemaFromText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('The schema is empty');
  if (trimmed.startsWith('{')) {
    let json;
    try { json = JSON.parse(trimmed); } catch (e) { throw new Error('Schema file is not valid JSON: ' + e.message); }
    if (json.errors && !json.data) throw new Error('The server refused the schema request: ' + (json.errors[0]?.message || 'unknown error'));
    const data = json.data ?? json;
    if (!data.__schema) throw new Error('This JSON is not a GraphQL schema (no "__schema" found)');
    return buildClientSchema(data);
  }
  return buildSchema(trimmed);
}

/** Names of the operations in the query, in order. Works on half-typed queries too. */
function operationNames(query) {
  try {
    return parse(query).definitions.filter(d => d.kind === 'OperationDefinition' && d.name).map(d => d.name.value);
  } catch {
    const out = [];
    const re = /\b(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/g;
    let m;
    while ((m = re.exec(query))) out.push(m[2]);
    return out;
  }
}

/** Returns the tidied query, or throws with the parse error. */
function formatQuery(query) {
  return print(parse(query));
}

// ---------- editor ----------
function createEditor({ parent, doc = '', nonce, onChange, onShowInDocs, onRun }) {
  const schemaSlot = new Compartment();
  let currentSchema;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { onRun?.(); return true; } }])),
        keymap.of([indentWithTab]),
        theme,
        syntaxHighlighting(highlight),
        nonce ? EditorView.cspNonce.of(nonce) : [],
        schemaSlot.of(graphqlLang(undefined, { onShowInDocs: (field, type, parentType) => onShowInDocs?.(type || parentType, field) })),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange?.(view.state.doc.toString()); }),
        EditorView.contentAttributes.of({ 'aria-label': 'GraphQL query' }),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) {
      if (text === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    insertAtCursor(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    format() {
      const out = formatQuery(view.state.doc.toString());
      this.setValue(out);
      return out;
    },
    setSchema(schema) { currentSchema = schema || undefined; updateSchema(view, currentSchema); },
    getSchema: () => currentSchema,
    focus: () => view.focus(),
  };
}

// ---------- schema explorer ----------
function typeLabel(type) { return String(type); }

/**
 * Renders a small browsable list of the schema into `container`.
 * onInsert(text) is called when the user clicks a field's "+" button.
 */
function createExplorer(container, { onInsert }) {
  let schema = null;
  const stack = [];          // navigation history of type names
  let filter = '';

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function rootTypes() {
    return [schema.getQueryType(), schema.getMutationType(), schema.getSubscriptionType()].filter(Boolean);
  }

  function fieldSnippet(field) {
    const named = getNamedType(field.type);
    const required = (field.args || []).filter(a => String(a.type).endsWith('!'));
    const args = required.length ? `(${required.map(a => `${a.name}: `).join(', ')})` : '';
    return isLeafType(named) ? `${field.name}${args}` : `${field.name}${args} {\n  \n}`;
  }

  function typeLink(type) {
    const named = getNamedType(type);
    const a = el('button', 'gx-type', typeLabel(type));
    a.title = `Open ${named.name}`;
    a.addEventListener('click', () => show(named.name));
    return a;
  }

  function renderType(type) {
    const box = el('div', 'gx-typebox');
    const head = el('div', 'gx-head');
    head.append(el('span', 'gx-kind', kindOf(type)), el('span', 'gx-name', type.name));
    box.appendChild(head);
    if (type.description) box.appendChild(el('p', 'gx-desc', type.description));

    if (isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)) {
      const fields = Object.values(type.getFields())
        .filter(f => !filter || f.name.toLowerCase().includes(filter));
      if (!fields.length) box.appendChild(el('p', 'gx-empty', filter ? 'No fields match.' : 'No fields.'));
      fields.forEach(f => {
        const row = el('div', 'gx-field');
        const line = el('div', 'gx-line');
        if (!isInputObjectType(type)) {
          const add = el('button', 'gx-add', '+');
          add.title = `Insert ${f.name}`;
          add.addEventListener('click', () => onInsert(fieldSnippet(f)));
          line.appendChild(add);
        }
        line.appendChild(el('span', 'gx-fname', f.name));
        if (f.args && f.args.length) {
          line.appendChild(el('span', 'gx-punct', '('));
          f.args.forEach((a, i) => {
            line.appendChild(el('span', 'gx-arg', a.name + ': '));
            line.appendChild(typeLink(a.type));
            if (i < f.args.length - 1) line.appendChild(el('span', 'gx-punct', ', '));
          });
          line.appendChild(el('span', 'gx-punct', ')'));
        }
        line.appendChild(el('span', 'gx-punct', ': '));
        line.appendChild(typeLink(f.type));
        row.appendChild(line);
        if (f.description) row.appendChild(el('p', 'gx-desc', f.description));
        if (f.deprecationReason) row.appendChild(el('p', 'gx-deprecated', 'Deprecated: ' + f.deprecationReason));
        box.appendChild(row);
      });
    } else if (isEnumType(type)) {
      type.getValues().filter(v => !filter || v.name.toLowerCase().includes(filter))
        .forEach(v => {
          const row = el('div', 'gx-field');
          row.appendChild(el('span', 'gx-fname', v.name));
          if (v.description) row.appendChild(el('p', 'gx-desc', v.description));
          box.appendChild(row);
        });
    } else if (isUnionType(type)) {
      const row = el('div', 'gx-field');
      row.appendChild(el('span', 'gx-muted', 'One of: '));
      type.getTypes().forEach((u, i) => { row.appendChild(typeLink(u)); if (i < type.getTypes().length - 1) row.appendChild(el('span', 'gx-punct', ' | ')); });
      box.appendChild(row);
    } else if (isScalarType(type)) {
      box.appendChild(el('p', 'gx-muted', 'Scalar value'));
    }
    return box;
  }

  function kindOf(type) {
    if (isObjectType(type)) return 'type';
    if (isInterfaceType(type)) return 'interface';
    if (isInputObjectType(type)) return 'input';
    if (isEnumType(type)) return 'enum';
    if (isUnionType(type)) return 'union';
    return 'scalar';
  }

  function render() {
    container.replaceChildren();
    if (!schema) {
      container.appendChild(el('p', 'gx-empty', 'No schema yet. Click "Fetch schema" to download it from the endpoint, or "Load file" to open a schema file.'));
      return;
    }
    const bar = el('div', 'gx-bar');
    if (stack.length) {
      const back = el('button', 'gx-back', '← Back');
      back.addEventListener('click', () => { stack.pop(); filter = ''; render(); });
      bar.appendChild(back);
    }
    const search = el('input', 'gx-search');
    search.type = 'text';
    search.placeholder = stack.length ? 'Filter fields' : 'Search all types and fields';
    search.value = filter;
    search.spellcheck = false;
    search.addEventListener('input', () => {
      filter = search.value.toLowerCase().trim();
      render();
      const s = container.querySelector('.gx-search');
      s.focus(); s.setSelectionRange(s.value.length, s.value.length);
    });
    bar.appendChild(search);
    container.appendChild(bar);

    if (stack.length) {
      const type = schema.getType(stack.at(-1));
      container.appendChild(type ? renderType(type) : el('p', 'gx-empty', 'Type not found.'));
      return;
    }

    if (filter) {
      // global search across every type name and field name
      const hits = el('div', 'gx-typebox');
      let count = 0;
      Object.values(schema.getTypeMap()).filter(ty => !ty.name.startsWith('__')).forEach(ty => {
        if (ty.name.toLowerCase().includes(filter)) {
          const row = el('div', 'gx-field'); row.appendChild(typeLink(ty)); row.appendChild(el('span', 'gx-muted', ' ' + kindOf(ty)));
          hits.appendChild(row); count++;
        }
        if (isObjectType(ty) || isInterfaceType(ty)) {
          Object.values(ty.getFields()).filter(f => f.name.toLowerCase().includes(filter)).forEach(f => {
            const row = el('div', 'gx-field');
            row.appendChild(typeLink(ty)); row.appendChild(el('span', 'gx-punct', '.'));
            row.appendChild(el('span', 'gx-fname', f.name)); row.appendChild(el('span', 'gx-punct', ': ')); row.appendChild(typeLink(f.type));
            hits.appendChild(row); count++;
          });
        }
      });
      if (!count) hits.appendChild(el('p', 'gx-empty', 'Nothing matches.'));
      container.appendChild(hits);
      return;
    }

    rootTypes().forEach(ty => container.appendChild(renderType(ty)));
  }

  function show(typeName) {
    if (!schema || !schema.getType(typeName)) return;
    if (stack.at(-1) !== typeName) stack.push(typeName);
    filter = '';
    render();
  }

  render();
  return {
    setSchema(s) { schema = s || null; stack.length = 0; filter = ''; render(); },
    show,
  };
}

window.EmGraphQL = {
  createEditor,
  createExplorer,
  schemaFromText,
  operationNames,
  formatQuery,
  introspectionQuery: getIntrospectionQuery({ descriptions: true }),
};
window.dispatchEvent(new Event('emgraphql-ready'));
