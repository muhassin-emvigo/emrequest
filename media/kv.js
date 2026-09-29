// Reusable key / value table with enable checkbox and an always-present empty row at the end.
(function () {
  class KVTable {
    constructor(container, opts = {}) {
      this.container = container;
      this.opts = opts;
      this.onChange = opts.onChange || (() => {});
      this.rows = [];
      this.render();
    }

    setRows(rows) {
      this.rows = (rows || []).map(r => ({ key: r.key || '', value: r.value || '', enabled: r.enabled !== false }));
      this.render();
    }

    getRows() {
      return this.rows.filter(r => r.key || r.value);
    }

    render() {
      const rows = [...this.rows, { key: '', value: '', enabled: true, _blank: true }];
      const table = document.createElement('table');
      table.className = 'kv';
      rows.forEach((row, i) => {
        const tr = document.createElement('tr');
        if (!row.enabled) tr.classList.add('disabled');

        const tdC = document.createElement('td');
        tdC.className = 'kv-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = row.enabled;
        cb.disabled = !!row._blank;
        cb.addEventListener('change', () => { this.rows[i].enabled = cb.checked; tr.classList.toggle('disabled', !cb.checked); this.onChange(); });
        tdC.appendChild(cb);

        const mk = (field, ph) => {
          const td = document.createElement('td');
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.spellcheck = false;
          inp.placeholder = ph;
          inp.value = row[field];
          inp.addEventListener('input', () => {
            if (row._blank) {
              // typing in the empty row turns it into a real row
              this.rows.push({ key: '', value: '', enabled: true });
              row._blank = false;
              this.rows[i][field] = inp.value;
              const focusField = field;
              this.render();
              const el = this.container.querySelectorAll('tr')[i].querySelector(`td.kv-${focusField} input`);
              el.focus();
              el.setSelectionRange(el.value.length, el.value.length);
            } else {
              this.rows[i][field] = inp.value;
            }
            this.onChange();
          });
          td.className = 'kv-' + field;
          td.appendChild(inp);
          return td;
        };

        const tdDel = document.createElement('td');
        tdDel.className = 'kv-del';
        if (!row._blank) {
          const del = document.createElement('button');
          del.className = 'icon';
          del.title = 'Remove';
          del.textContent = '×';
          del.addEventListener('click', () => { this.rows.splice(i, 1); this.render(); this.onChange(); });
          tdDel.appendChild(del);
        }

        tr.append(tdC, mk('key', this.opts.keyPlaceholder || 'Key'), mk('value', this.opts.valuePlaceholder || 'Value'), tdDel);
        table.appendChild(tr);
      });
      this.container.replaceChildren(table);
    }
  }
  window.KVTable = KVTable;

  // Simple tab switching shared by all pages: <nav class="tabs" data-group="x"><button data-tab="y">
  window.setupTabs = function () {
    document.querySelectorAll('nav.tabs').forEach(nav => {
      const group = nav.dataset.group;
      nav.querySelectorAll('button[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
          document.querySelectorAll(`.tab-body[data-group="${group}"]`).forEach(body =>
            body.classList.toggle('hidden', body.dataset.tab !== btn.dataset.tab));
        });
      });
    });
  };
})();
