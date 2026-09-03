'use strict';
const express = require('express');
const { route, priorityFor, installers, publicInstaller } = require('./routing');
const zoho = require('./zoho');
const mail = require('./mail');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// CORS — LUXE-owned origins only.
const ALLOWED = (process.env.ALLOWED_ORIGINS ||
  'https://luxeprotectionfilms.com,https://www.luxeprotectionfilms.com,https://luxeppfilms.com,https://www.luxeppfilms.com,https://luxe-film-shop.myshopify.com'
).split(',').map(s => s.trim());
app.use((req, res, next) => {
  const o = req.headers.origin || '';
  const ok = ALLOWED.includes(o) || /^https:\/\/[a-z0-9-]+\.luxeprotectionfilms\.com$/.test(o);
  if (ok) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(ok ? 204 : 403);
  next();
});

// Simple per-IP rate limit: 5 submissions / 10 min.
const hits = new Map();
function rateLimited(ip) {
  if (process.env.RATE_LIMIT_OFF === '1') return false;
  const now = Date.now(), win = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 5;
}

const PRODUCTS = ['Gloss Is Boss', 'Stealth Matte', 'Color Series PPF', 'Windshield Guard', 'Not sure yet'];
const s = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function validate(b) {
  const lead = {
    firstName: s(b.firstName, 60), lastName: s(b.lastName, 60), email: s(b.email, 120).toLowerCase(),
    phone: s(b.phone, 30), zip: s(b.zip, 12), state: s(b.state, 40).toUpperCase(), country: s(b.country || 'US', 2).toUpperCase(),
    vehicle: s(b.vehicle, 80), vehicleYear: s(b.vehicleYear, 4), product: s(b.product, 40),
    message: s(b.message, 1500), consent: b.consent === true || b.consent === 'true' || b.consent === 'on' || b.consent === '1',
    source: s(b.source || 'unknown', 40)
  };
  const errors = [];
  if (!lead.firstName) errors.push('firstName');
  if (!lead.lastName) errors.push('lastName');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) errors.push('email');
  if (lead.phone.replace(/\D/g, '').length < 10) errors.push('phone');
  if (!lead.zip) errors.push('zip');
  if (!lead.vehicle) errors.push('vehicle');
  if (!/^(19|20)\d{2}$/.test(lead.vehicleYear)) errors.push('vehicleYear');
  if (!PRODUCTS.includes(lead.product)) errors.push('product');
  if (!lead.consent) errors.push('consent');
  return { lead, errors };
}

app.get('/api/health', (req, res) => res.json({ ok: true, installers: installers.length, zoho: zoho.enabled(), mail: mail.enabled() }));

// Public dataset for maps (no emails).
app.get('/api/installers', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(installers.map(i => publicInstaller(i)));
});

// Nearest lookup (no lead created) — used by the form's live "nearest shops" preview.
app.get('/api/installers/nearest', (req, res) => {
  const r = route({ zip: req.query.zip, country: req.query.country });
  res.json({ covered: r.covered, nearest: r.nearest, location: r.location });
});

app.post('/api/installer-lead', async (req, res) => {
  if (req.body.website2) return res.json({ ok: true }); // honeypot
  if (rateLimited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many requests' });
  const { lead, errors } = validate(req.body);
  if (errors.length) return res.status(400).json({ ok: false, error: 'Invalid fields', fields: errors });

  const routing = route(lead);
  const priority = priorityFor(lead.vehicleYear);
  const out = { ok: true, covered: routing.covered, priority, assigned: routing.assigned ? routing.assigned.name : null, nearest: routing.nearest };

  const log = { t: new Date().toISOString(), lead: { ...lead, message: undefined }, routing: { covered: routing.covered, reason: routing.reason, assigned: routing.assigned?.id }, priority };
  try { out.mail = await mail.sendAll(lead, routing, priority); } catch (e) { out.mailError = true; log.mailError = e.message; }
  try { const z = await zoho.createLead(lead, routing, priority); out.zoho = z.id || (z.skipped ? 'skipped' : null); } catch (e) { out.zohoError = true; log.zohoError = e.message; }
  console.log(JSON.stringify({ event: 'installer_lead', ...log, mail: out.mail, zoho: out.zoho }));
  res.json(out);
});

const PORT = process.env.PORT || 8080;
if (require.main === module) app.listen(PORT, () => console.log(`luxe-lead-router on :${PORT} (zoho=${zoho.enabled()} mail=${mail.enabled()})`));
module.exports = app;
