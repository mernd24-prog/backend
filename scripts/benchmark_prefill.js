const https = require('https');
const { URL } = require('url');

function timeRequest(url, token) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    };
    const start = Date.now();
    const req = https.request(opts, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        const duration = Date.now() - start;
        resolve({ status: res.statusCode, duration });
      });
    });
    req.on('error', (err) => resolve({ error: err.message, duration: Date.now() - start }));
    req.end();
  });
}

async function run() {
  const base = process.argv[2] || 'https://localhost:3000';
  const token = process.argv[3] || '';
  const endpoints = [
    '/api/v1/admin/products/prefill/basic',
    '/api/v1/admin/products/prefill/lookups',
    '/api/v1/admin/products/prefill/locations',
    '/api/v1/admin/products/prefill/products?includeProducts=true&productLimit=100',
  ];

  console.log('Benchmarking prefill endpoints against', base);
  for (const ep of endpoints) {
    const url = base.replace(/\/$/, '') + ep;
    const results = [];
    for (let i = 0; i < 3; i++) {
      // warm + measured
      // eslint-disable-next-line no-await-in-loop
      const res = await timeRequest(url, token);
      results.push(res);
      // wait a bit
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log('\nEndpoint:', ep);
    results.forEach((r, idx) => console.log(`  Run ${idx + 1}:`, r));
    const durations = results.filter((r) => !r.error).map((r) => r.duration);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    console.log('  Avg duration (ms):', Math.round(avg));
  }
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
