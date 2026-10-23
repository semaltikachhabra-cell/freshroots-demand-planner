// Thin Supabase (PostgREST) client. If it is unreachable the app keeps working from this browser only.
(function () {
  const c = window.SUPABASE;
  const on = !!(c && c.url && c.key);
  const base = on ? c.url.replace(/\/$/, '') + '/rest/v1/' : '';

  async function req(path, { method = 'GET', body, prefer } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        apikey: c.key,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Database error ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const q = encodeURIComponent;

  window.DB = {
    on,
    ping: () => req('datasets?select=kind&limit=1'),
    loadDatasets: () => req('datasets?select=kind,filename,csv'),
    saveDataset: (kind, filename, csv) =>
      req('datasets?on_conflict=kind', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { kind, filename, csv, uploaded_at: new Date().toISOString() } }),
    clearDatasets: () => req('datasets?kind=not.is.null', { method: 'DELETE' }),
    loadDecisions: (asOf) => req(`decisions?as_of=eq.${q(asOf)}&select=sku_id,status,qty,decided_by,decided_at`),
    saveDecision: (row) =>
      req('decisions?on_conflict=as_of,sku_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { ...row, decided_at: new Date().toISOString() } }),
    deleteDecision: (asOf, sku) => req(`decisions?as_of=eq.${q(asOf)}&sku_id=eq.${q(sku)}`, { method: 'DELETE' }),
    clearDecisions: (asOf) => req(`decisions?as_of=eq.${q(asOf)}`, { method: 'DELETE' }),
    logRun: (row) => req('runs', { method: 'POST', body: row }),
    loadLog: () => req('decision_log?select=as_of,sku_id,status,qty,recommended_qty,decided_by,logged_at&order=logged_at.desc&limit=15'),
    loadRuns: () => req('runs?select=as_of,festival,source,summary,created_at&order=created_at.desc&limit=8'),
  };
})();
