// Bundles data/*.csv into data.js so the app also runs from file:// with no server.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'data');
const out = {};
for (const [k, f] of Object.entries({ skus: 'sku_master', sales: 'weekly_sales', inventory: 'current_inventory', calendar: 'calendar', distributors: 'distributor_master' }))
  out[k] = fs.readFileSync(path.join(dir, f + '.csv'), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'data.js'), 'window.SEED_CSV = ' + JSON.stringify(out) + ';\n');
console.log('data.js written');
