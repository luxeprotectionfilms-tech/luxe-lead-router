// Offline test for /api/forma-trial: mocks Zoho HTTP + SMTP. Run: RATE_LIMIT_OFF=1 node test/forma.js
process.env.RATE_LIMIT_OFF = '1';
Object.assign(process.env, { ZOHO_CLIENT_ID: 'x', ZOHO_CLIENT_SECRET: 'x', ZOHO_REFRESH_TOKEN: 'x', SMTP_HOST: 'smtp.test', SMTP_USER: 'web@luxeprotectionfilms.com', SMTP_PASS: 'x' });

const nodemailer = require('nodemailer');
const sent = [];
nodemailer.createTransport = () => ({ sendMail: async m => { sent.push(m); return { messageId: 'm' + sent.length }; } });

// ---- Zoho mock ----
let db, calls, picklistsReady;
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  const json = (o, status = 200) => ({ status, json: async () => o });
  if (url.includes('/oauth/v2/token')) return json({ access_token: 't', expires_in: 3600 });
  calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  const u = new URL(url);
  const m = u.pathname.match(/\/crm\/v2\/(\w+)(?:\/(\w+))?(?:\/(\w+))?/);
  const mod = m[1];
  if (m[2] === 'search') {
    const email = u.searchParams.get('email'), crit = u.searchParams.get('criteria');
    const rows = db[mod].filter(r => email ? r.Email === email : crit && r.Company === crit.match(/equals:(.*)\)/)[1]);
    return rows.length ? json({ data: rows }) : { status: 204, json: async () => null };
  }
  if (m[2] === 'actions') return json({ data: [{ code: 'SUCCESS' }] });
  if (m[3] === 'Notes') { db.notes.push({ mod, id: m[2], body: JSON.parse(opts.body) }); return json({ data: [{ code: 'SUCCESS', details: { id: 'n1' } }] }); }
  const rec = JSON.parse(opts.body).data[0];
  if (!picklistsReady && rec.Lead_Source === 'LUXE FORMA') return json({ data: [{ code: 'INVALID_DATA', details: { api_name: 'Lead_Source' }, status: 'error' }] });
  if (!picklistsReady && rec.Lead_Status === 'Trial Requested') return json({ data: [{ code: 'INVALID_DATA', details: { api_name: 'Lead_Status' }, status: 'error' }] });
  if (opts.method === 'POST') { const id = 'L' + (db.Leads.length + 100); db.Leads.push({ ...rec, id }); return json({ data: [{ code: 'SUCCESS', details: { id } }] }); }
  if (opts.method === 'PUT') { const r = db.Leads.find(x => x.id === rec.id); Object.assign(r, rec); return json({ data: [{ code: 'SUCCESS', details: { id: rec.id } }] }); }
  return json({});
};

const app = require('../src/server');
const good = { firstName: 'Ana', lastName: 'Reyes', businessName: 'Apex Tint & PPF', email: 'Ana@ApexTint.com', phone: '(702) 555-0101', website: 'apextint.com', instagram: 'https://instagram.com/apextint/', city: 'Las Vegas', state: 'NV', country: 'United States', services: ['PPF', 'Window Tint'], plotterBrand: 'Graphtec', plotterModel: 'CE7000-130', patternSoftware: 'XPEL DAP', monthlyInstalls: '16-30', luxeStatus: 'Not currently a LUXE Installer', testFocus: 'Full front PPF on Model Y', startDate: '2026-10-05', consent: true, utm_source: 'instagram', utm_campaign: 'forma-trial-launch', landingPage: 'https://www.luxeppfilms.com/pages/luxe-forma-trial?utm_source=instagram' };

const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = b => realFetch(base + '/api/forma-trial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, ...(await r.json()) }));
  const reset = (ready = true) => { db = { Leads: [], Contacts: [], notes: [] }; calls = []; sent.length = 0; picklistsReady = ready; };
  let fail = 0; const t = (name, ok, dbg) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(dbg).slice(0, 600)); };

  reset();
  let r = await post(good);
  const L = db.Leads[0];
  t('new applicant → Lead created with full mapping', r.ok && L && L.Company === 'Apex Tint & PPF' && L.Email === 'ana@apextint.com' && L.Lead_Source === 'LUXE FORMA' && L.Lead_Status === 'Trial Requested' && L.FT_Lead_Sub_Source === '7-Day Trial Application' && L.FT_Stage === 'Trial Requested' && L.FT_Instagram === '@apextint' && L.Website === 'https://apextint.com' && L.FT_Services.join() === 'PPF,Window Tint' && L.LV26_Business_Type === 'PPF + Tint Shop' && L.FT_Application_Count === 1 && L.FT_UTM_Source === 'instagram', L);
  t('tag FORMA-TRIAL attempted', calls.some(c => c.url.includes('add_tags') && c.url.includes('FORMA-TRIAL')), calls.map(c => c.url));
  t('sales email subject + to sales1 + bcc info', sent[0].subject === 'NEW LUXE FORMA TRIAL APPLICATION — Apex Tint & PPF' && sent[0].to.includes('sales1@luxeprotectionfilms.com') && sent[0].bcc.includes('info@luxeprotectionfilms.com') && /LUXE-FORMA-JSON/.test(sent[0].html) && /New Lead created/.test(sent[0].html), sent[0] && sent[0].subject);
  t('applicant confirmation sent, no supplier names', sent[1].to === 'ana@apextint.com' && !/yink/i.test(sent[1].html + sent[0].html), sent[1] && sent[1].to);

  // repeat submission: update, preserve original date + source, protect customer status
  const firstApplied = L.FT_Applied_At; L.Lead_Source = 'Instagram'; L.Lead_Status = 'First Order'; L.Owner = 'Deepak';
  sent.length = 0;
  r = await post({ ...good, testFocus: 'Tint patterns now too', startDate: '2026-10-12' });
  t('repeat → no duplicate, updated in place', db.Leads.length === 1 && L.FT_Test_Focus === 'Tint patterns now too' && L.FT_Application_Count === 2, db.Leads.length);
  t('repeat → original source/date/status preserved', L.Lead_Source === 'Instagram' && L.FT_Applied_At === firstApplied && L.Lead_Status === 'First Order', { s: L.Lead_Source, st: L.Lead_Status });
  t('repeat → note logged', db.notes.length === 1 && db.notes[0].id === L.id, db.notes);

  // existing contact (converted dealer) → note on contact, no new lead
  reset(); db.Contacts.push({ id: 'C1', Email: 'ana@apextint.com' });
  r = await post(good);
  t('existing Contact → note only, no Lead', r.ok && db.Leads.length === 0 && db.notes[0].mod === 'Contacts' && /EXISTING CONTACT/.test(sent[0].html), db);

  // company match → create but flag
  reset(); db.Leads.push({ id: 'L9', Company: 'Apex Tint & PPF', Email: 'owner@apextint.com', First_Name: 'Sam', Last_Name: 'Lee' });
  r = await post(good);
  t('same company, different email → new Lead + duplicate flag in email', db.Leads.length === 2 && /Possible duplicate/.test(sent[0].html), sent[0] && sent[0].html.slice(0, 300));

  // picklist values not yet added in Zoho → still captured
  reset(false);
  r = await post(good);
  t('missing picklist values → Lead still created, flagged', r.ok && db.Leads.length === 1 && !db.Leads[0].Lead_Source && /Picklist value missing/.test(sent[0].html), db.Leads[0]);

  // validation
  reset();
  r = await post({ ...good, services: [], consent: false, plotterModel: '' });
  t('validation → 400 with fields', r.status === 400 && ['services', 'consent', 'plotterModel'].every(x => r.fields.includes(x)), r);
  r = await post({ ...good, plotterBrand: 'No plotter yet', plotterModel: '' });
  t('no plotter → model not required', r.ok, r);
  r = await post({ ...good, website2: 'bot' });
  t('honeypot → silent ok, nothing written', r.ok && db.Leads.length === 1, db.Leads.length);


  // v1.2 option values
  reset();
  r = await post({ ...good, patternSoftware: 'Other', patternSoftwareOther: 'ProCut Pro', luxeStatus: 'LUXE Regional Hub' });
  t('Other software → stores typed name; new LUXE status stored', r.ok && db.Leads[0].FT_Pattern_Software === 'ProCut Pro' && db.Leads[0].FT_LUXE_Status === 'LUXE Regional Hub' && /ProCut Pro/.test(sent[0].html), db.Leads[0]);
  reset();
  r = await post({ ...good, patternSoftware: 'Other', patternSoftwareOther: '' });
  t('Other with no name → 400', r.status === 400 && r.fields.includes('patternSoftwareOther'), r);
  for (const v of ['LUXE Certified Installer','LUXE Elite Installer','LUXE Authorized Distributor','LUXE Regional Hub','Not currently a LUXE Installer']) { reset(); r = await post({ ...good, luxeStatus: v }); if (!r.ok) t('status ' + v, false, r); }
  for (const v of ['XPEL DAP','Core by Eastman','DigiCut','Not currently using pattern software']) { reset(); r = await post({ ...good, patternSoftware: v }); if (!r.ok || db.Leads[0].FT_Pattern_Software !== v) t('software ' + v, false, r); }
  reset(); r = await post({ ...good, luxeStatus: 'Current LUXE Dealer', patternSoftware: 'Computer Cut' });
  t('legacy values still accepted', r.ok, r);
  reset(); r = await post({ ...good, luxeStatus: 'Random' });
  t('unknown status → 400', r.status === 400, r);
  // Zoho down + mail down → 502 so applicant can retry
  reset(); const save = process.env.SMTP_HOST; delete process.env.SMTP_HOST; delete process.env.ZOHO_REFRESH_TOKEN;
  r = await post(good);
  t('nothing captured → 502', r.status === 502, r);
  process.env.SMTP_HOST = save;
  r = await post(good);
  t('Zoho creds missing → email only, pending-sync', r.ok && /hourly sync job/.test(sent[0].html), sent[0] && sent[0].subject);

  srv.close(); console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
});
