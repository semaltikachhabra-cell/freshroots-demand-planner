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

  function run() {
    result = E.analyse(parse(), cfg);
    decisions = store.get('fr-dec:' + result.asOf, {});
    render();
  }

  const saveDec = () => store.set('fr-dec:' + result.asOf, decisions);

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

  function render() { renderMeta(); renderKpis(); renderFilters(); renderTable(); renderPO(); renderRules(); }

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

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.f) { filter = t.dataset.f; renderFilters(); renderTable(); }
    else if (t.dataset.why) { open.has(t.dataset.why) ? open.delete(t.dataset.why) : open.add(t.dataset.why); renderTable(); }
    else if (t.id === 'export') exportCSV();
    else if (t.id === 'reset-data') { csv = { ...window.SEED_CSV }; store.del('fr-csv'); run(); }
    else if (t.id === 'reset-decisions') { decisions = {}; saveDec(); render(); }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.dec) {
      const sku = t.dataset.dec, row = result.rows.find((r) => r.sku === sku);
      if (!t.value) delete decisions[sku];
      else decisions[sku] = { status: t.value, qty: t.value === 'override' ? row.qty : undefined };
      saveDec(); renderKpis(); renderTable(); renderPO();
    } else if (t.dataset.qty) {
      decisions[t.dataset.qty] = { status: 'override', qty: Math.max(0, Number(t.value) || 0) };
      saveDec(); renderKpis(); renderPO();
    } else if (t.dataset.cfg) {
      cfg = { ...cfg, [t.dataset.cfg]: Number(t.value) }; store.set('fr-cfg', cfg); run();
    } else if (t.dataset.fest !== undefined) {
      const { festival, ...rest } = cfg; cfg = t.value === 'auto' ? rest : { ...rest, festival: t.value === 'on' };
      store.set('fr-cfg', cfg); run();
    } else if (t.type === 'file' && t.files[0]) {
      const key = t.dataset.key;
      t.files[0].text().then((text) => {
        const old = csv[key]; csv[key] = text;
        try { E.analyse(parse(), cfg); store.set('fr-csv', Object.fromEntries(Object.keys(csv).filter((k) => csv[k] !== window.SEED_CSV[k]).map((k) => [k, csv[k]]))); run(); }
        catch { csv[key] = old; alert('Could not read that file.'); }
      });
    }
  });

  run();
})();
