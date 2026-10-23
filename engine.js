// Freshroots demand-planning rules engine.
// Pure functions, no DOM: runs in the browser (window.Engine) and in Node (tests).
// The rules are Raghav Kulkarni's documented forecasting logic from Case 01.
(function (root) {
  const DEFAULT_CONFIG = {
    baseWeeks: 12,          // "12-week average"
    trendWeeks: 4,          // "sales in the last 4 weeks"
    trendThreshold: 0.2,    // more than 20% above the 12-week average => high-demand
    highDemandMultiplier: 1.5,
    stockoutWeeks: 6,       // below 6 weeks of average weekly sales => stockout risk
    overstockWeeks: 14,     // above 14 weeks => overstock risk
    perishableMinWeeks: 3,  // high-perishability SKUs: tighter window, 3 to 4 weeks
    perishableMaxWeeks: 4,
    festivalUplift: 0.25,   // +25% demand in festival months, applied before threshold checks
  };

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((v) => v.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  }

  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

  function isFestivalMonth(asOf, calendar) {
    const ym = asOf.slice(0, 7);
    const hit = (calendar || []).find((r) => r.Year_Month === ym);
    if (hit) return String(hit.Is_Festival_Month).toUpperCase() === 'TRUE';
    return [3, 10, 11].includes(Number(asOf.slice(5, 7))); // case rule: Oct, Nov, Mar
  }

  // data = { skus, sales, inventory, calendar, distributors } as parsed CSV row arrays.
  function analyse(data, userConfig) {
    const cfg = { ...DEFAULT_CONFIG, ...(userConfig || {}) };
    const salesBySku = {};
    for (const r of data.sales) (salesBySku[r.SKU_ID] ||= {})[r.Week] = Number(r.Units_Sold);
    const invBySku = {};
    for (const r of data.inventory) invBySku[r.SKU_ID] = r;
    const distName = Object.fromEntries((data.distributors || []).map((d) => [d.Distributor_ID, d.Distributor_Name]));

    const asOf = userConfig && userConfig.asOf
      ? userConfig.asOf
      : data.inventory.map((r) => r.As_Of_Date).sort().pop() || new Date().toISOString().slice(0, 10);
    const festival = userConfig && typeof userConfig.festival === 'boolean'
      ? userConfig.festival
      : isFestivalMonth(asOf, data.calendar);

    const rows = data.skus.map((s) => {
      const weeks = Object.keys(salesBySku[s.SKU_ID] || {}).sort();
      const series = weeks.map((w) => salesBySku[s.SKU_ID][w]);
      const inv = invBySku[s.SKU_ID];
      const onHand = inv ? Number(inv.Units_On_Hand) : null;
      const perishable = s.Perishability === 'High';
      const stdQty = Number(s.Standard_Reorder_Qty);
      const minW = perishable ? cfg.perishableMinWeeks : cfg.stockoutWeeks;
      const maxW = perishable ? cfg.perishableMaxWeeks : cfg.overstockWeeks;

      const base = avg(series.slice(-cfg.baseWeeks));
      const recent = avg(series.slice(-cfg.trendWeeks));
      const trend = base > 0 ? recent / base - 1 : 0;
      const demand = base * (festival ? 1 + cfg.festivalUplift : 1);
      const cover = onHand !== null && demand > 0 ? onHand / demand : null;

      const exceptions = [];
      if (series.length < cfg.baseWeeks) exceptions.push(`Only ${series.length} weeks of history (need ${cfg.baseWeeks}). Possible new launch.`);
      if (onHand === null) exceptions.push('No inventory row for this SKU.');
      if (base === 0) exceptions.push('No sales in the window; the rules cannot run.');

      const highDemand = trend > cfg.trendThreshold;
      const stockout = cover !== null && cover < minW;
      const overstock = cover !== null && cover > maxW;

      let action = 'OK', qty = 0, why = [];
      why.push(`12-wk avg ${base.toFixed(0)}/wk${festival ? ` ×${1 + cfg.festivalUplift} festival uplift = ${demand.toFixed(0)}/wk` : ''}.`);
      if (cover !== null) why.push(`${onHand} on hand = ${cover.toFixed(1)} wks of cover (${perishable ? 'perishable window' : 'normal window'} ${minW}–${maxW} wks).`);
      why.push(`Last ${cfg.trendWeeks} wks avg ${recent.toFixed(0)}/wk, ${(trend * 100 >= 0 ? '+' : '') + (trend * 100).toFixed(0)}% vs 12-wk avg.`);

      if (exceptions.length) {
        action = 'REVIEW';
      } else if (highDemand && overstock) {
        action = 'REVIEW';
        exceptions.push('Rules conflict: sales are running high but stock already exceeds the overstock limit.');
      } else if (stockout) {
        action = 'REORDER_NOW';
        qty = Math.ceil(stdQty * (highDemand ? cfg.highDemandMultiplier : 1));
        why.push(`Below ${minW} wks of cover: stockout risk, reorder immediately.${highDemand ? ` High-demand, so ${cfg.highDemandMultiplier}× the standard ${stdQty}.` : ` Standard qty ${stdQty}.`}`);
      } else if (overstock) {
        action = 'PAUSE';
        why.push(`Above ${maxW} wks of cover: overstock risk, pause the next order.`);
      } else if (highDemand) {
        action = 'REORDER';
        qty = Math.ceil(stdQty * cfg.highDemandMultiplier);
        why.push(`Last ${cfg.trendWeeks} wks are more than ${cfg.trendThreshold * 100}% above the 12-wk average: high-demand, reorder at ${cfg.highDemandMultiplier}× the standard ${stdQty}.`);
      } else {
        why.push('Within all thresholds. No action.');
      }

      return {
        sku: s.SKU_ID, name: s.SKU_Name, category: s.Category, perishable,
        distributorId: s.Distributor_ID, distributor: distName[s.Distributor_ID] || s.Distributor_ID,
        stdQty, onHand, series, weeks, base, recent, trend, demand, cover,
        minW, maxW, flags: { highDemand, stockout, overstock },
        action, qty, exceptions, why,
      };
    });

    const order = { REORDER_NOW: 0, REVIEW: 1, REORDER: 2, PAUSE: 3, OK: 4 };
    rows.sort((a, b) => order[a.action] - order[b.action] || (a.cover ?? 99) - (b.cover ?? 99));
    return { rows, asOf, festival, config: cfg };
  }

  const api = { DEFAULT_CONFIG, parseCSV, analyse, isFestivalMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
