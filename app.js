(function () {
  const E = window.Engine;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const LABEL = { REORDER_NOW: 'Reorder now', REORDER: 'Reorder (high demand)', PAUSE: 'Pause next order', REVIEW: 'Needs Raghav', OK: 'No action' };
  const FILTERS = [['ALL', 'All'], ['ACT', 'Needs action'], ['REORDER_NOW', 'Reorder now'], ['PAUSE', 'Pause'], ['REVIEW', 'Needs Raghav'], ['OK', 'No action']];

  let csv = { ...window.SEED_CSV, ...store.get('fr-csv', {}) };
  let cfg = store.get('fr-cfg', {});
  let filter = 'ACT';
  let result, decisions;
  const open = new Set();

  const parse = () => ({
    skus: E.parseCSV(csv.skus), sales: E.parseCSV(csv.sales), inventory: E.parseCSV(csv.inventory),
    calendar: E.parseCSV(csv.calendar), distributors: E.parseCSV(csv.distributors),
  });

  let dbOk = null; // null = unknown, true = shared database reachable, false = browser-only

  function run() {
    result = E.analyse(parse(), cfg);
    decisions = store.get('fr-dec:' + result.asOf, {});
    render();
    if (window.DB.on) {
      const asOf = result.asOf;
      window.DB.loadDecisions(asOf).then((rows) => {
        if (asOf !== result.asOf) return;
        decisions = Object.fromEntries(rows.map((d) => [d.sku_id, { status: d.status, qty: d.qty ?? undefined, by: d.decided_by }]));
        saveDecLocal(); setDb(true); renderKpis(); renderTable(); renderPO();
      }).catch(() => setDb(false));
    }
  }

  const saveDecLocal = () => store.set('fr-dec:' + result.asOf, decisions);
  const who = () => store.get('fr-name', '');

  // Persist one SKU's decision to this browser and, when reachable, the shared database.
  function persist(sku) {
    saveDecLocal();
    if (!window.DB.on) return;
    const d = decisions[sku], row = result.rows.find((r) => r.sku === sku);
    const p = d
      ? window.DB.saveDecision({ as_of: result.asOf, sku_id: sku, status: d.status, qty: d.status === 'override' ? Number(d.qty) || 0 : d.status === 'approved' ? row.qty : null, recommended_qty: row.qty, action: row.action, decided_by: who() || null })
      : window.DB.deleteDecision(result.asOf, sku);
    p.then(() => { setDb(true); loadHistory(); }).catch(() => setDb(false));
  }

  function setDb(ok) {
    dbOk = ok;
    const el = $('#db-status');
    if (!el) return;
    el.className = 'dbs ' + (ok ? 'ok' : 'off');
    el.textContent = !window.DB.on ? 'Browser-only mode' : ok ? 'Shared database connected' : 'Database unreachable: saving in this browser only';
  }

  function spark(series) {
    if (series.length < 2) return '';
    const max = Math.max(...series), min = Math.min(...series), w = 84, h = 24;
    const pts = series.map((v, i) => `${(i / (series.length - 1) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  }

  function lineQty(r) {
    const d = decisions[r.sku];
    if (!d) return null;
    if (d.status === 'approved') return r.qty;
    if (d.status === 'override') return Number(d.qty) || 0;
    return null;
  }

  function renderMeta() {
    $('#meta').innerHTML = `Inventory as of <b>${esc(result.asOf)}</b><br>${result.festival ? `Festival month: <b>+${Math.round(result.config.festivalUplift * 100)}% demand uplift applied</b>` : 'Not a festival month: no uplift'}`;
  }

  function renderKpis() {
    const c = (a) => result.rows.filter((r) => r.action === a).length;
    const approved = result.rows.filter((r) => lineQty(r) > 0).length;
    const tiles = [
      [c('REORDER_NOW'), 'Reorder now'], [c('REORDER'), 'High-demand reorders'], [c('PAUSE'), 'Orders to pause'],
      [c('REVIEW'), 'Need Raghav'], [approved, 'Lines approved'], [result.rows.length, 'SKUs reviewed'],
    ];
    $('#kpis').innerHTML = tiles.map(([n, l]) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  }

  function renderFilters() {
    $('#filters').innerHTML = FILTERS.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join('');
  }

  function decisionCell(r) {
    if (r.action === 'OK') return '<span class="note">None needed</span>';
    const d = decisions[r.sku] || {};
    const opts = r.action === 'REVIEW'
      ? [['', 'Pending'], ['override', 'Set my own qty'], ['rejected', 'No order']]
      : [['', 'Pending'], ['approved', r.action === 'PAUSE' ? 'Approve pause' : 'Approve'], ['override', 'Override qty'], ['rejected', 'Reject']];
    const sel = `<select data-dec="${esc(r.sku)}" aria-label="Decision for ${esc(r.sku)}">${opts.map(([v, l]) => `<option value="${v}" ${d.status === v || (!d.status && v === '') ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const qty = d.status === 'override' ? `<input type="number" min="0" step="1" data-qty="${esc(r.sku)}" value="${esc(d.qty ?? r.qty)}" aria-label="Override quantity">` : '';
    return `${sel} ${qty}`;
  }

  function renderTable() {
    const rows = result.rows.filter((r) => filter === 'ALL' || (filter === 'ACT' ? r.action !== 'OK' : r.action === filter));
    const head = '<thead><tr><th>SKU</th><th>Distributor</th><th class="num">On hand</th><th class="num">12-wk avg</th><th>Trend</th><th class="num">Cover (wks)</th><th>Recommendation</th><th class="num">Qty</th><th>Raghav</th></tr></thead>';
    if (!rows.length) { $('#table').innerHTML = head + '<tbody><tr><td colspan="9" class="empty">Nothing in this view.</td></tr></tbody>'; return; }
    const body = rows.map((r) => {
      const isOpen = open.has(r.sku);
      const warn = r.exceptions.length ? `<br><span class="note" style="color:var(--amber)">${esc(r.exceptions[0])}</span>` : '';
      const main = `<tr>
        <td class="sku"><b>${esc(r.name)}</b><span>${esc(r.sku)} · ${esc(r.category)}${r.perishable ? '<span class="tag">perishable</span>' : ''}</span></td>
        <td>${esc(r.distributor)}</td>
        <td class="num">${r.onHand ?? '–'}</td>
        <td class="num">${r.base.toFixed(0)}</td>
        <td>${spark(r.series)} <span class="note">${r.trend >= 0 ? '+' : ''}${(r.trend * 100).toFixed(0)}%</span></td>
        <td class="num">${r.cover === null ? '–' : r.cover.toFixed(1)}</td>
        <td><span class="pill ${r.action}">${LABEL[r.action]}</span>${warn}<br><button class="toggle" data-why="${esc(r.sku)}">${isOpen ? 'Hide' : 'Why?'}</button></td>
        <td class="num">${r.qty || '–'}</td>
        <td>${decisionCell(r)}</td></tr>`;
      const why = isOpen ? `<tr class="detail"><td colspan="9"><ul>${r.why.map((w) => `<li>${esc(w)}</li>`).join('')}${r.exceptions.map((w) => `<li><b>Check:</b> ${esc(w)}</li>`).join('')}</ul></td></tr>` : '';
      return main + why;
    }).join('');
    $('#table').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function poGroups() {
    const g = {};
    for (const r of result.rows) {
      const q = lineQty(r);
      if (q > 0) (g[r.distributor] ||= []).push({ r, q });
    }
    return g;
  }

  function renderPO() {
    const g = poGroups();
    const holds = result.rows.filter((r) => r.action === 'PAUSE' && decisions[r.sku]?.status === 'approved');
    const names = Object.keys(g);
    let html = names.length ? names.map((n) => `<div class="po-group"><h3>${esc(n)}</h3><table><thead><tr><th>SKU</th><th>Item</th><th class="num">Qty</th><th>Basis</th></tr></thead><tbody>${g[n].map(({ r, q }) => `<tr><td>${esc(r.sku)}</td><td>${esc(r.name)}</td><td class="num">${q}</td><td>${decisions[r.sku].status === 'override' ? `Raghav override (rec. ${r.qty})` : esc(LABEL[r.action])}</td></tr>`).join('')}</tbody></table></div>`).join('')
      : '<p class="empty">No approved lines yet. Approve or override a recommendation above.</p>';
    if (holds.length) html += `<p class="note"><b>On hold (do not reorder):</b> ${holds.map((r) => esc(r.name)).join(', ')}</p>`;
    $('#po').innerHTML = html;
    $('#export').disabled = !names.length;
  }

  function renderRules() {
    const c = result.config;
    const num = (k, l, step) => `<div class="rule"><label for="r-${k}">${l}</label><input id="r-${k}" type="number" step="${step || 1}" min="0" data-cfg="${k}" value="${c[k]}"></div>`;
    $('#rules').innerHTML = `<h3>Rules (from Raghav's documentation)</h3>
      ${num('trendThreshold', 'High-demand if last 4 wks exceed 12-wk avg by', 0.05)}
      ${num('highDemandMultiplier', 'High-demand reorder multiplier', 0.1)}
      ${num('stockoutWeeks', 'Stockout risk below (weeks of cover)')}
      ${num('overstockWeeks', 'Overstock risk above (weeks of cover)')}
      ${num('perishableMinWeeks', 'Perishable minimum (weeks)')}
      ${num('perishableMaxWeeks', 'Perishable maximum (weeks)')}
      ${num('festivalUplift', 'Festival-month demand uplift', 0.05)}
      <div class="rule"><label for="r-fest">Festival month</label><select id="r-fest" data-fest><option value="auto" ${typeof cfg.festival !== 'boolean' ? 'selected' : ''}>Auto (calendar)</option><option value="on" ${cfg.festival === true ? 'selected' : ''}>Force on</option><option value="off" ${cfg.festival === false ? 'selected' : ''}>Force off</option></select></div>
      <p class="note">The uplift is applied to average weekly demand before the cover checks. The 20% trend test uses actual sales, which already contain any festival lift.</p>`;
  }

  function render() { renderUploads(); renderMeta(); renderKpis(); renderFilters(); renderTable(); renderPO(); renderRules(); }

  function exportCSV() {
    const lines = [['Distributor', 'SKU_ID', 'SKU_Name', 'Order_Qty', 'Basis', 'Status']];
    const g = poGroups();
    for (const n of Object.keys(g)) for (const { r, q } of g[n]) lines.push([n, r.sku, r.name, q, decisions[r.sku].status === 'override' ? 'Override' : LABEL[r.action], 'DRAFT - approve in Zoho']);
    const text = lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `draft-po-${result.asOf}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function runRow(source) {
    const c = (a) => result.rows.filter((r) => r.action === a).length;
    return { as_of: result.asOf, festival: result.festival, source, config: result.config, summary: { reorder_now: c('REORDER_NOW'), reorder: c('REORDER'), pause: c('PAUSE'), review: c('REVIEW'), ok: c('OK'), approved_lines: result.rows.filter((r) => lineQty(r) > 0).length } };
  }

  const fmt = (t) => new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const STATUS_TXT = { approved: 'approved', override: 'set own qty', rejected: 'rejected', cleared: 'cleared' };

  function loadHistory() {
    if (!window.DB.on) return;
    Promise.all([window.DB.loadLog(), window.DB.loadRuns()]).then(([log, runs]) => {
      setDb(true);
      $('#history').innerHTML = `<div class="grid">
        <div><h3>Decision audit trail</h3>${log.length ? `<ul class="hist">${log.map((l) => `<li><b>${esc(l.sku_id)}</b> ${STATUS_TXT[l.status] || esc(l.status)}${l.qty != null ? ` (${l.qty})` : ''} <span class="src">by ${esc(l.decided_by || 'unnamed')} · ${esc(fmt(l.logged_at))}</span></li>`).join('')}</ul>` : '<p class="empty">No decisions recorded yet.</p>'}</div>
        <div><h3>Recent runs</h3>${runs.length ? `<ul class="hist">${runs.map((r) => `<li>${esc(r.source)} · as of ${esc(r.as_of)}: ${esc(r.summary.reorder_now)} reorder now, ${esc(r.summary.pause)} pause, ${esc(r.summary.approved_lines)} approved <span class="src">· ${esc(fmt(r.created_at))}</span></li>`).join('')}</ul>` : '<p class="empty">No runs recorded yet.</p>'}</div></div>`;
    }).catch(() => setDb(false));
  }

  // ---- uploads ----
  const KINDS = {
    sales: ['SKU_ID', 'Week', 'Units_Sold'],
    inventory: ['SKU_ID', 'Units_On_Hand', 'As_Of_Date'],
    skus: ['SKU_ID', 'SKU_Name', 'Perishability', 'Standard_Reorder_Qty', 'Distributor_ID'],
    calendar: ['Year_Month', 'Is_Festival_Month'],
    distributors: ['Distributor_ID', 'Distributor_Name'],
  };
  const KIND_LABEL = { sales: 'Weekly sales', inventory: 'Current inventory', skus: 'SKU master', calendar: 'Calendar', distributors: 'Distributor master' };
  const uploaded = {};

  function detect(text) {
    const head = (text.split(/\r?\n/)[0] || '').split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    return Object.keys(KINDS).find((k) => KINDS[k].every((c) => head.includes(c)));
  }

  async function ingest(files) {
    const msgs = [];
    const next = { ...csv };
    const names = {};
    for (const f of files) {
      const text = await f.text();
      const kind = detect(text);
      if (!kind) { msgs.push(`${f.name}: not recognised. Check the column headers match the seed files.`); continue; }
      next[kind] = text; names[kind] = f.name;
    }
    const kinds = Object.keys(names);
    if (kinds.length) {
      try {
        E.analyse({ skus: E.parseCSV(next.skus), sales: E.parseCSV(next.sales), inventory: E.parseCSV(next.inventory), calendar: E.parseCSV(next.calendar), distributors: E.parseCSV(next.distributors) }, cfg);
        csv = next; Object.assign(uploaded, names);
        store.set('fr-csv', Object.fromEntries(Object.keys(csv).filter((k) => csv[k] !== window.SEED_CSV[k]).map((k) => [k, csv[k]])));
        store.set('fr-names', uploaded);
        msgs.unshift(`Loaded ${kinds.map((k) => KIND_LABEL[k]).join(', ')}. Recommendations updated.`);
        run();
        if (window.DB.on) {
          Promise.all(kinds.map((k) => window.DB.saveDataset(k, names[k], csv[k])))
            .then(() => window.DB.logRun(runRow('upload')))
            .then(() => { setDb(true); loadHistory(); renderUploads(msgs.concat('Saved to the shared database.')); })
            .catch(() => { setDb(false); renderUploads(msgs.concat('Could not reach the database: files kept in this browser only.'), true); });
        }
      } catch (e) { msgs.unshift('Those files could not be used together, nothing was changed: ' + (e.message || 'unreadable data')); }
    }
    renderUploads(msgs, !kinds.length || msgs[0].startsWith('Those'));
  }

  function renderUploads(msgs, isErr) {
    const names = { ...store.get('fr-names', {}), ...uploaded };
    $('#file-status').innerHTML = Object.keys(KINDS).map((k) => {
      const n = E.parseCSV(csv[k]).length, up = csv[k] !== window.SEED_CSV[k];
      return `<li><span>${KIND_LABEL[k]} <span class="src">· ${n} rows</span></span><span class="${up ? 'up' : 'src'}">${up ? esc(names[k] || 'uploaded file') : 'seed data'}</span></li>`;
    }).join('');
    const m = $('#upload-msg');
    m.className = 'note' + (isErr ? ' err' : '');
    m.innerHTML = (msgs || []).map(esc).join('<br>');
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.f) { filter = t.dataset.f; renderFilters(); renderTable(); }
    else if (t.dataset.why) { open.has(t.dataset.why) ? open.delete(t.dataset.why) : open.add(t.dataset.why); renderTable(); }
    else if (t.id === 'export') { exportCSV(); if (window.DB.on) window.DB.logRun(runRow('export')).then(loadHistory).catch(() => setDb(false)); }
    else if (t.id === 'reset-data') { csv = { ...window.SEED_CSV }; store.del('fr-csv'); store.del('fr-names'); Object.keys(uploaded).forEach((k) => delete uploaded[k]); run(); renderUploads(['Reset to seed data.']); if (window.DB.on) window.DB.clearDatasets().then(() => window.DB.logRun(runRow('reset'))).then(loadHistory).catch(() => setDb(false)); }
    else if (t.id === 'reset-decisions') { decisions = {}; saveDecLocal(); render(); if (window.DB.on) window.DB.clearDecisions(result.asOf).then(loadHistory).catch(() => setDb(false)); }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.dec) {
      const sku = t.dataset.dec, row = result.rows.find((r) => r.sku === sku);
      if (!t.value) delete decisions[sku];
      else decisions[sku] = { status: t.value, qty: t.value === 'override' ? row.qty : undefined };
      persist(sku); renderKpis(); renderTable(); renderPO();
    } else if (t.dataset.qty) {
      decisions[t.dataset.qty] = { status: 'override', qty: Math.max(0, Number(t.value) || 0) };
      persist(t.dataset.qty); renderKpis(); renderPO();
    } else if (t.dataset.cfg) {
      cfg = { ...cfg, [t.dataset.cfg]: Number(t.value) }; store.set('fr-cfg', cfg); run();
    } else if (t.dataset.fest !== undefined) {
      const { festival, ...rest } = cfg; cfg = t.value === 'auto' ? rest : { ...rest, festival: t.value === 'on' };
      store.set('fr-cfg', cfg); run();
    } else if (t.id === 'who') { store.set('fr-name', t.value.trim());
    } else if (t.id === 'files' && t.files.length) {
      ingest([...t.files]); t.value = '';
    }
  });

  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => ingest([...e.dataTransfer.files]));

  $('#who').value = who();
  setDb(window.DB.on ? null : false);
  if (window.DB.on) {
    window.DB.loadDatasets().then((rows) => {
      csv = { ...window.SEED_CSV };
      const nm = {};
      for (const r of rows) { csv[r.kind] = r.csv; nm[r.kind] = r.filename; }
      Object.assign(uploaded, nm); store.set('fr-names', uploaded);
      try { E.analyse({ skus: E.parseCSV(csv.skus), sales: E.parseCSV(csv.sales), inventory: E.parseCSV(csv.inventory), calendar: E.parseCSV(csv.calendar), distributors: E.parseCSV(csv.distributors) }, cfg); }
      catch { csv = { ...window.SEED_CSV }; }
      run(); loadHistory();
    }).catch(() => { setDb(false); run(); });
  } else run();
})();
