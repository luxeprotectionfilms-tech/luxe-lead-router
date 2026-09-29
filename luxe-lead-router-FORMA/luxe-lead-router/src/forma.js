'use strict';
// LUXE FORMA 7-Day Trial applications.
// POST /api/forma-trial -> validate -> Zoho dedupe + create/update (if creds set) -> email sales1@ (+bcc archive) -> applicant confirmation.
// Never provisions software. Customer-facing copy must not name any backend supplier.
const nodemailer = require('nodemailer');
const zoho = require('./zoho');

const s = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SERVICES = ['PPF', 'Window Tint', 'Vinyl Wrap'];
const PLOTTERS = ['Graphtec', 'Summa', 'Roland', 'Mimaki', 'GCC', 'Teneth', 'Other', 'No plotter yet'];
const SOFTWARE = ['XPEL DAP', 'Computer Cut', 'Other pattern software', 'None / hand cut'];
const VOLUMES = ['1-5', '6-15', '16-30', '31-60', '60+'];
const LUXE_STATUS = ['Current LUXE Dealer', 'Current LUXE Elite Dealer', 'Not currently a LUXE customer'];

// Zoho picklist values (must match the FT_ fields created in Leads).
const STAGE_NEW = 'Trial Requested';
const PROTECTED_STATUSES = ['Approved / Activated', 'First Order', 'Reorder']; // never downgrade a live customer
const LEAD_SOURCE = process.env.FORMA_LEAD_SOURCE || 'LUXE FORMA';
const LEAD_STATUS = process.env.FORMA_LEAD_STATUS || 'Trial Requested';
const SUB_SOURCE = '7-Day Trial Application';
const TAG = 'FORMA-TRIAL';

function validate(b) {
  let services = b.services;
  if (typeof services === 'string') services = services.split(',');
  services = (Array.isArray(services) ? services : []).map(x => s(x, 30)).filter(x => SERVICES.includes(x));
  const a = {
    firstName: s(b.firstName, 40), lastName: s(b.lastName, 80), businessName: s(b.businessName, 150),
    email: s(b.email, 100).toLowerCase(), phone: s(b.phone, 30),
    website: s(b.website, 250), instagram: s(b.instagram, 100).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '@').replace(/\/$/, ''),
    city: s(b.city, 100), state: s(b.state, 100), country: s(b.country, 100),
    services, plotterBrand: s(b.plotterBrand, 40), plotterModel: s(b.plotterModel, 100),
    patternSoftware: s(b.patternSoftware, 40), patternSoftwareOther: s(b.patternSoftwareOther, 100),
    monthlyInstalls: s(b.monthlyInstalls, 10), luxeStatus: s(b.luxeStatus, 40),
    testFocus: s(b.testFocus, 1500), startDate: s(b.startDate, 10),
    consent: b.consent === true || b.consent === 'true' || b.consent === 'on' || b.consent === '1',
    utmSource: s(b.utm_source, 100), utmMedium: s(b.utm_medium, 100), utmCampaign: s(b.utm_campaign, 150), utmContent: s(b.utm_content, 150),
    landingPage: s(b.landingPage, 400), referrer: s(b.referrer, 400), source: s(b.source || 'shopify', 40)
  };
  if (a.website && !/^https?:\/\//i.test(a.website)) a.website = 'https://' + a.website;
  if (a.instagram && !a.instagram.startsWith('@')) a.instagram = '@' + a.instagram;
  const e = [];
  if (!a.firstName) e.push('firstName');
  if (!a.lastName) e.push('lastName');
  if (!a.businessName) e.push('businessName');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) e.push('email');
  if (a.phone.replace(/\D/g, '').length < 7) e.push('phone');
  if (!a.city) e.push('city');
  if (!a.state) e.push('state');
  if (!a.country) e.push('country');
  if (!a.services.length) e.push('services');
  if (!PLOTTERS.includes(a.plotterBrand)) e.push('plotterBrand');
  if (a.plotterBrand !== 'No plotter yet' && !a.plotterModel) e.push('plotterModel');
  if (!SOFTWARE.includes(a.patternSoftware)) e.push('patternSoftware');
  if (!VOLUMES.includes(a.monthlyInstalls)) e.push('monthlyInstalls');
  if (!LUXE_STATUS.includes(a.luxeStatus)) e.push('luxeStatus');
  if (!a.testFocus) e.push('testFocus');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.startDate)) e.push('startDate');
  if (!a.consent) e.push('consent');
  return { app: a, errors: e };
}

const softwareLabel = a => a.patternSoftware === 'Other pattern software' && a.patternSoftwareOther ? `Other: ${a.patternSoftwareOther}` : a.patternSoftware;
function businessType(services) {
  const p = services.includes('PPF'), t = services.includes('Window Tint');
  return p && t ? 'PPF + Tint Shop' : p ? 'PPF Installer' : t ? 'Tint Installer' : 'Other Automotive Industry';
}
function summaryText(a, when) {
  return [
    `LUXE FORMA 7-Day Trial Application (${when})`,
    `Business: ${a.businessName} | ${a.city}, ${a.state}, ${a.country}`,
    `Services: ${a.services.join(', ')}`,
    `Plotter: ${a.plotterBrand}${a.plotterModel ? ' ' + a.plotterModel : ''}`,
    `Current pattern software: ${softwareLabel(a)}`,
    `Installs / month: ${a.monthlyInstalls}`,
    `LUXE status: ${a.luxeStatus}`,
    `Requested start: ${a.startDate}`,
    `Wants to test: ${a.testFocus}`,
    a.utmSource || a.utmCampaign ? `Attribution: ${[a.utmSource, a.utmMedium, a.utmCampaign, a.utmContent].filter(Boolean).join(' / ')}` : '',
    a.landingPage ? `Landing page: ${a.landingPage}` : ''
  ].filter(Boolean).join('\n');
}

// Fields written on every submission (new or existing record).
function formaFields(a, now) {
  return {
    FT_Instagram: a.instagram || null,
    FT_Services: a.services,
    FT_Plotter_Brand: a.plotterBrand,
    FT_Plotter_Model: a.plotterModel || null,
    FT_Pattern_Software: softwareLabel(a),
    FT_Monthly_Installs: a.monthlyInstalls,
    FT_LUXE_Status: a.luxeStatus,
    FT_Requested_Start: a.startDate,
    FT_Test_Focus: a.testFocus,
    FT_Consent: a.consent,
    FT_Last_Applied_At: now,
    FT_UTM_Source: a.utmSource || null,
    FT_UTM_Campaign: a.utmCampaign || null
  };
}

// ---------- Zoho ----------
async function zapi(path, opts = {}) {
  const token = await zoho.accessToken();
  const API = process.env.ZOHO_API_URL || 'https://www.zohoapis.com';
  const r = await fetch(`${API}/crm/v2${path}`, { ...opts, headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' } });
  if (r.status === 204) return null;
  return r.json();
}
const firstRow = j => (j && j.data && j.data[0]) || null;

async function findExisting(a) {
  const q = encodeURIComponent(a.email);
  const lead = firstRow(await zapi(`/Leads/search?email=${q}`));
  if (lead) return { module: 'Leads', rec: lead };
  const contact = firstRow(await zapi(`/Contacts/search?email=${q}`));
  if (contact) return { module: 'Contacts', rec: contact };
  // Company match is a flag for sales, never an auto-merge (different person at same shop is a real, separate contact).
  const co = firstRow(await zapi(`/Leads/search?criteria=${encodeURIComponent(`(Company:equals:${a.businessName.replace(/[(),]/g, ' ')})`)}`));
  return co ? { module: 'Leads', rec: null, companyMatch: co } : null;
}

async function writeWithPicklistFallback(method, path, record) {
  let j = await zapi(path, { method, body: JSON.stringify({ data: [record], trigger: [] }) });
  let d = firstRow(j);
  const dropped = [];
  // If LUXE FORMA / Trial Requested picklist values have not been added in Zoho yet, retry without them rather than lose the lead.
  if (d && d.code === 'INVALID_DATA' && d.details && ['Lead_Source', 'Lead_Status'].includes(d.details.api_name)) {
    dropped.push(d.details.api_name);
    const r2 = { ...record }; delete r2[d.details.api_name];
    j = await zapi(path, { method, body: JSON.stringify({ data: [r2], trigger: [] }) });
    d = firstRow(j);
    if (d && d.code === 'INVALID_DATA' && d.details && ['Lead_Source', 'Lead_Status'].includes(d.details.api_name)) {
      dropped.push(d.details.api_name); delete r2[d.details.api_name];
      j = await zapi(path, { method, body: JSON.stringify({ data: [r2], trigger: [] }) });
      d = firstRow(j);
    }
  }
  if (!d || d.code !== 'SUCCESS') throw new Error('zoho write: ' + JSON.stringify(j));
  return { id: d.details.id, dropped };
}

async function addNote(module, id, title, content) {
  await zapi(`/${module}/${id}/Notes`, { method: 'POST', body: JSON.stringify({ data: [{ Note_Title: title, Note_Content: content }] }) });
}
async function addTag(id) {
  try { await zapi(`/Leads/actions/add_tags?ids=${id}&tag_names=${TAG}&over_write=false`, { method: 'POST' }); return true; }
  catch (_) { return false; } // org tag limit (60) may block; FT_Stage + Lead Source are the real filters
}

async function syncZoho(a) {
  if (!zoho.enabled()) return { status: 'pending-sync' };
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const found = await findExisting(a);
  const note = summaryText(a, now);

  if (found && found.module === 'Contacts') {
    // Existing customer contact: do not create a duplicate Lead. Log the application on the Contact.
    await addNote('Contacts', found.rec.id, 'LUXE FORMA trial application', note);
    return { status: 'existing-contact', module: 'Contacts', id: found.rec.id };
  }

  if (found && found.rec) {
    const cur = found.rec;
    const upd = { id: cur.id, ...formaFields(a, now), FT_Stage: ['Approved', 'Trial Active'].includes(cur.FT_Stage) ? cur.FT_Stage : STAGE_NEW,
      FT_Application_Count: (Number(cur.FT_Application_Count) || 0) + 1 };
    if (!PROTECTED_STATUSES.includes(cur.Lead_Status)) upd.Lead_Status = LEAD_STATUS;
    // Fill blanks only; never overwrite what sales already has.
    const fill = { Company: a.businessName, First_Name: a.firstName, Mobile: a.phone, Website: a.website, City: a.city, State: a.state, Country: a.country, LV26_Business_Type: businessType(a.services) };
    for (const [k, v] of Object.entries(fill)) if (v && !cur[k]) upd[k] = v;
    if (!cur.FT_Applied_At) upd.FT_Applied_At = now; // preserve the ORIGINAL submission date
    if (!cur.FT_Lead_Sub_Source) upd.FT_Lead_Sub_Source = SUB_SOURCE;
    // Lead_Source is intentionally NOT changed on existing records (preserve original source).
    const w = await writeWithPicklistFallback('PUT', '/Leads', upd);
    await addNote('Leads', cur.id, 'LUXE FORMA trial application (repeat or existing lead)', note);
    const tagged = await addTag(cur.id);
    return { status: 'updated', module: 'Leads', id: cur.id, dropped: w.dropped, tagged };
  }

  const rec = {
    First_Name: a.firstName, Last_Name: a.lastName, Company: a.businessName, Email: a.email, Mobile: a.phone, Phone: a.phone,
    Website: a.website || null, City: a.city, State: a.state, Country: a.country,
    Lead_Source: LEAD_SOURCE, Lead_Status: LEAD_STATUS, FT_Lead_Sub_Source: SUB_SOURCE,
    LV26_Business_Type: businessType(a.services), Description: note,
    ...formaFields(a, now), FT_Stage: STAGE_NEW, FT_Applied_At: now, FT_Application_Count: 1
  };
  const w = await writeWithPicklistFallback('POST', '/Leads', rec);
  const tagged = await addTag(w.id);
  return { status: 'created', module: 'Leads', id: w.id, dropped: w.dropped, tagged, companyMatch: found && found.companyMatch ? { id: found.companyMatch.id, name: `${found.companyMatch.First_Name || ''} ${found.companyMatch.Last_Name || ''}`.trim() } : null };
}

// ---------- Email ----------
function mailEnabled() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }
function transport() {
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE || 'false') === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}
const ZOHO_ORG = process.env.ZOHO_ORG_DOMAIN || 'luxeppf';
function zohoLine(z) {
  if (!z) return 'Zoho: error, see logs. The hourly sync job will pick this up from the record below.';
  if (z.status === 'pending-sync') return 'Zoho: not written directly. The hourly sync job will create/update the Lead from the record below.';
  if (z.error) return `Zoho: write failed (${esc(z.error).slice(0, 200)}). The hourly sync job will retry from the record below.`;
  const url = `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/${z.module}/${z.id}`;
  const label = { created: 'New Lead created', updated: 'Existing Lead updated (original source + date preserved)', 'existing-contact': 'EXISTING CONTACT, application logged as a Note (no duplicate Lead)' }[z.status];
  const extra = [z.dropped && z.dropped.length ? `Picklist value missing in Zoho, skipped: ${z.dropped.join(', ')}` : '', z.tagged === false ? 'Tag FORMA-TRIAL not applied (tag limit)' : '', z.companyMatch ? `Possible duplicate: another Lead with the same company (${esc(z.companyMatch.name)}, id ${z.companyMatch.id})` : ''].filter(Boolean);
  return `Zoho: <a href="${url}">${label}</a>${extra.length ? '<br>' + extra.map(esc).join('<br>') : ''}`;
}

function sections(a) {
  return [
    ['Contact', [['Name', `${a.firstName} ${a.lastName}`], ['Business', a.businessName], ['Email', a.email], ['Mobile', a.phone]]],
    ['Business', [['Website', a.website || '—'], ['Instagram', a.instagram || '—'], ['Location', `${a.city}, ${a.state}, ${a.country}`]]],
    ['Installer profile', [['Services', a.services.join(', ')], ['Plotter', a.plotterBrand], ['Plotter model', a.plotterModel || '—'], ['Current pattern software', softwareLabel(a)], ['Installs / month', a.monthlyInstalls]]],
    ['Relationship with LUXE', [['Status', a.luxeStatus]]],
    ['Trial request', [['Wants to test', a.testFocus], ['Requested start', a.startDate]]],
    ['Tracking', [['Consent', a.consent ? 'Yes' : 'No'], ['UTM', [a.utmSource, a.utmMedium, a.utmCampaign, a.utmContent].filter(Boolean).join(' / ') || '—'], ['Landing page', a.landingPage || '—'], ['Referrer', a.referrer || '—'], ['Form', a.source]]]
  ];
}
function table(a) {
  return sections(a).map(([h, rows]) =>
    `<tr><td colspan="2" style="background:#111;color:#F2B705;font-weight:bold;padding:8px 10px;letter-spacing:.04em;text-transform:uppercase;font-size:12px">${esc(h)}</td></tr>` +
    rows.map(([k, v]) => `<tr><td style="border:1px solid #e3e3e3;background:#fafafa;font-weight:bold;width:190px;padding:7px 10px">${esc(k)}</td><td style="border:1px solid #e3e3e3;padding:7px 10px;white-space:pre-wrap">${esc(v)}</td></tr>`).join('')
  ).join('');
}

async function sendMails(a, z) {
  if (!mailEnabled()) return { skipped: true };
  const t = transport();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const sales = (process.env.FORMA_SALES_EMAIL || process.env.CORPORATE_LEAD_EMAIL || 'sales1@luxeprotectionfilms.com').split(',').map(x => x.trim()).filter(Boolean);
  const archive = (process.env.LEAD_ARCHIVE_EMAIL || 'info@luxeprotectionfilms.com').split(',').map(x => x.trim()).filter(x => x && !sales.includes(x));
  const machine = { v: 1, kind: 'forma-trial', app: a, zoho: z, ts: new Date().toISOString() };
  const out = {};
  out.sales = (await t.sendMail({
    from: `"LUXE FORMA Applications" <${from}>`, to: sales, bcc: archive, replyTo: a.email,
    subject: `NEW LUXE FORMA TRIAL APPLICATION — ${a.businessName}`,
    html: `<div style="font:14px/1.45 Arial,sans-serif;color:#111;max-width:680px">
<p style="margin:0 0 4px;font-size:18px;font-weight:bold">New LUXE FORMA 7-Day Trial Application</p>
<p style="margin:0 0 14px;color:#555">Review before activating. Do not provision an account until approved.</p>
<p style="margin:0 0 14px;padding:10px;background:#fff8e1;border-left:4px solid #F2B705">${zohoLine(z)}</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">${table(a)}</table>
<p style="color:#999;font-size:11px;margin-top:18px">Record for CRM sync (do not edit):</p>
<pre style="font-size:10px;color:#999;white-space:pre-wrap">LUXE-FORMA-JSON:${esc(JSON.stringify(machine))}:END-LUXE-FORMA-JSON</pre></div>`
  })).messageId;
  out.applicant = (await t.sendMail({
    from: `"LUXE Protection Films" <${from}>`, to: a.email, replyTo: sales[0],
    subject: 'We received your LUXE FORMA trial application',
    html: `<div style="background:#f4f4f4;padding:24px 0;font-family:Arial,sans-serif">
<table cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:#111;padding:22px 28px"><div style="color:#F2B705;font-size:22px;font-weight:bold;letter-spacing:.14em">LUXE FORMA</div><div style="color:#bbb;font-size:12px;letter-spacing:.2em;text-transform:uppercase;margin-top:4px">Vehicle Pattern Technology</div></td></tr>
<tr><td style="padding:26px 28px;color:#111;font-size:15px;line-height:1.55">
<p style="margin:0 0 14px">Hi ${esc(a.firstName)},</p>
<p style="margin:0 0 14px">Your LUXE FORMA trial application for <b>${esc(a.businessName)}</b> has been received.</p>
<p style="margin:0 0 14px">Our team will review your information and contact you about activating your 7-day trial. Trials are approved individually, so there is nothing else you need to do right now.</p>
<p style="margin:0 0 14px">Questions in the meantime? Just reply to this email.</p>
<p style="margin:22px 0 0">LUXE Protection Films</p></td></tr>
<tr><td style="padding:14px 28px;background:#fafafa;color:#888;font-size:12px">You are receiving this because you applied for a LUXE FORMA trial at luxeppfilms.com.</td></tr>
</table></div>`
  })).messageId;
  return out;
}

async function handle(req, res, rateLimited) {
  if (req.body.website2) return res.json({ ok: true }); // honeypot
  if (rateLimited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many requests' });
  const { app: a, errors } = validate(req.body);
  if (errors.length) return res.status(400).json({ ok: false, error: 'Invalid fields', fields: errors });
  let z;
  try { z = await syncZoho(a); } catch (e) { z = { status: 'error', error: e.message }; }
  let m;
  try { m = await sendMails(a, z); } catch (e) { m = { error: e.message }; }
  const zohoOk = z && ['created', 'updated', 'existing-contact'].includes(z.status);
  const mailOk = m && !m.error && !m.skipped;
  // If neither Zoho nor email captured it, log the full application so nothing is lost, and let the applicant retry.
  console.log(JSON.stringify({ event: 'forma_trial', t: new Date().toISOString(), email: a.email, business: a.businessName, zoho: z, mail: m, app: zohoOk && mailOk ? undefined : a }));
  if (!zohoOk && !mailOk) return res.status(502).json({ ok: false, error: 'capture_failed' });
  // Applicant only ever sees a neutral confirmation.
  res.json({ ok: true });
}

module.exports = { handle, validate, formaFields, businessType, summaryText, syncZoho, sendMails, SERVICES, PLOTTERS, SOFTWARE, VOLUMES, LUXE_STATUS };
