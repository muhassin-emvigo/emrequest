(function () {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let env = null;

  const vars = new KVTable($('vars'), {
    keyPlaceholder: 'variable name', valuePlaceholder: 'value',
    onChange: () => { $('savedMsg').textContent = 'Unsaved changes'; },
  });

  function save() {
    env.name = $('envName').value.trim() || 'Untitled';
    env.variables = vars.getRows();
    vscode.postMessage({ type: 'save', env });
  }

  $('save').addEventListener('click', save);
  $('envName').addEventListener('input', () => { $('savedMsg').textContent = 'Unsaved changes'; });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'load') {
      env = m.env;
      $('envName').value = env.name;
      vars.setRows(env.variables);
    } else if (m.type === 'saved') {
      $('savedMsg').textContent = 'Saved ✓';
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
