'use strict';
// Creates a Lead in Zoho CRM. Enabled only when ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN are set.
const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com';
const API = process.env.ZOHO_API_URL || 'https://www.zohoapis.com';
let cached = { token: null, exp: 0 };

function enabled() {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN);
}

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN
  });
  const r = await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('zoho token: ' + JSON.stringify(j));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

function buildLead(lead, routing, priority) {
  const desc = [
    `Installer Locator lead (${lead.source})`,
    `Vehicle: ${lead.vehicleYear} ${lead.vehicle}`,
    `Film interest: ${lead.product}`,
    `Zip: ${lead.zip} ${lead.state || ''} ${lead.country || 'US'}`.trim(),
    routing.assigned ? `Routed to: ${routing.assigned.name} (${routing.assigned.distanceMi} mi)` : `Routing: ${routing.reason}`,
    routing.nearest.length ? `Nearest: ${routing.nearest.map(n => `${n.name} ${n.distanceMi}mi`).join('; ')}` : '',
    lead.message ? `Notes: ${lead.message}` : ''
  ].filter(Boolean).join('\n');
  return {
    Last_Name: lead.lastName,
    First_Name: lead.firstName,
    Company: 'Consumer',
    Email: lead.email,
    Phone: lead.phone,
    Zip_Code: lead.zip,
    State: lead.state || routing.location?.state || '',
    Country: lead.country || 'US',
    Lead_Source: 'Website Leads',
    Lead_Status: 'Not Contacted',
    Description: desc,
    IL_Vehicle: lead.vehicle,
    IL_Vehicle_Year: String(lead.vehicleYear),
    IL_Film_Interest: lead.product,
    IL_Priority: priority,
    IL_Routed_Installer: routing.assigned ? routing.assigned.name : (routing.covered ? 'Corporate (no approved email)' : 'Corporate (no coverage)'),
    IL_Coverage: routing.covered ? 'Covered' : 'No coverage',
    IL_Distance_Mi: routing.nearest[0] ? routing.nearest[0].distanceMi : null,
    IL_Consent: !!lead.consent,
    IL_Source_Site: lead.source
  };
}

async function createLead(lead, routing, priority) {
  if (!enabled()) return { skipped: true };
  const token = await accessToken();
  const tags = ['INSTALL-LEAD', 'CONSUMER', priority.startsWith('High') ? 'IL-HIGH' : 'IL-STANDARD', routing.covered ? 'IL-COVERED' : 'IL-NO-COVERAGE'];
  const r = await fetch(`${API}/crm/v2/Leads`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ ...buildLead(lead, routing, priority), Tag: tags.map(name => ({ name })) }], trigger: ['workflow'] })
  });
  const j = await r.json();
  const d = j.data && j.data[0];
  if (!d || d.code !== 'SUCCESS') throw new Error('zoho create: ' + JSON.stringify(j));
  return { id: d.details.id };
}

module.exports = { enabled, createLead, buildLead };
