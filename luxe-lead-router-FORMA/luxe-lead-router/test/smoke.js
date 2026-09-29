const app = require('../src/server');
const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (b) => fetch(base + '/api/installer-lead', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://luxeprotectionfilms.com' }, body: JSON.stringify(b) }).then(r => r.json());
  const good = { firstName: 'Test', lastName: 'Lead', email: 'test@example.com', phone: '4085551212', zip: '95126', vehicle: 'Porsche 911', vehicleYear: '2024', product: 'Gloss Is Boss', consent: true, source: 'smoke' };
  const cases = [
    ['San Jose 2024 → SFS assigned', good, r => r.ok && r.assigned === 'SFS Bay Area' && r.priority.startsWith('High')],
    ['Fresno 2016 → nearest approved (Top Notch, Ceres), Standard', { ...good, zip: '93701', vehicleYear: '2016' }, r => r.ok && r.covered && r.assigned === 'Top Notch Detail & Tint' && r.priority.startsWith('Standard')],
    ['Sarasota → covered by 941 Wraps, unapproved → corporate', { ...good, zip: '34236' }, r => r.ok && r.covered && r.assigned === null],
    ['Chicago → no coverage, still nearest 3', { ...good, zip: '60601' }, r => r.ok && !r.covered && r.nearest.length === 3],
    ['Missing consent → 400', { ...good, consent: false }, r => r.ok === false && r.fields.includes('consent')],
    ['Bad zip → no coverage', { ...good, zip: '00000' }, r => r.ok && !r.covered && r.nearest.length === 0],
  ];
  let fail = 0;
  for (const [name, body, check] of cases) {
    const r = await post(body); const ok = check(r);
    if (!ok) fail++;
    console.log((ok ? 'PASS' : 'FAIL'), name, ok ? '' : JSON.stringify(r));
  }
  const h = await fetch(base + '/api/health').then(r => r.json());
  console.log('health', JSON.stringify(h));
  srv.close(); process.exit(fail ? 1 : 0);
});
