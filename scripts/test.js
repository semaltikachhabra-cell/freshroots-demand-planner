const fs = require('fs'), path = require('path'), assert = require('assert');
const { parseCSV, analyse } = require('../engine.js');
const rd = (f) => parseCSV(fs.readFileSync(path.join(__dirname, '..', 'data', f + '.csv'), 'utf8'));
const data = { skus: rd('sku_master'), sales: rd('weekly_sales'), inventory: rd('current_inventory'), calendar: rd('calendar'), distributors: rd('distributor_master') };
const r = analyse(data);
const by = Object.fromEntries(r.rows.map((x) => [x.sku, x]));
assert.strictEqual(r.asOf, '2026-10-19'); assert.strictEqual(r.festival, true);
const exp = { SKU001: ['REORDER_NOW', 750], SKU003: ['REORDER_NOW', 300], SKU004: ['REORDER_NOW', 150], SKU011: ['REORDER_NOW', 500], SKU013: ['REORDER_NOW', 120], SKU006: ['PAUSE', 0], SKU007: ['PAUSE', 0] };
for (const [s, [a, q]] of Object.entries(exp)) { assert.strictEqual(by[s].action, a, s + ' action ' + by[s].action); assert.strictEqual(by[s].qty, q, s + ' qty'); }
for (const s of ['SKU002', 'SKU005', 'SKU008', 'SKU009', 'SKU010', 'SKU012', 'SKU014', 'SKU015']) assert.strictEqual(by[s].action, 'OK', s);
// festival off: SKU003 cover 5.4 is still <6; SKU013 4.0 still <6; SKU007 5.1 > 4 pause
const off = analyse(data, { festival: false });
assert.strictEqual(Object.fromEntries(off.rows.map((x) => [x.sku, x.action])).SKU001, 'REORDER_NOW');
// conflict: high demand + overstock => REVIEW
const d2 = JSON.parse(JSON.stringify(data)); d2.inventory.find((x) => x.SKU_ID === 'SKU001').Units_On_Hand = '9000';
assert.strictEqual(analyse(d2).rows.find((x) => x.sku === 'SKU001').action, 'REVIEW');
// short history => REVIEW
const d3 = JSON.parse(JSON.stringify(data)); d3.sales = d3.sales.filter((x) => !(x.SKU_ID === 'SKU002' && x.Week < '2026-W35'));
assert.strictEqual(analyse(d3).rows.find((x) => x.sku === 'SKU002').action, 'REVIEW');
console.log('all tests passed');
console.table(r.rows.map((x) => ({ sku: x.sku, act: x.action, qty: x.qty, cover: x.cover?.toFixed(1), trend: (x.trend * 100).toFixed(0) + '%' })));
