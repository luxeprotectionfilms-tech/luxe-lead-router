'use strict';
const nodemailer = require('nodemailer');

function enabled() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function leadTable(lead, routing, priority) {
  const rows = [
    ['Name', `${lead.firstName} ${lead.lastName}`], ['Phone', lead.phone], ['Email', lead.email],
    ['Zip / State', `${lead.zip} ${lead.state || ''}`], ['Vehicle', `${lead.vehicleYear} ${lead.vehicle}`],
    ['Film interest', lead.product], ['Priority', priority],
    ['Routed to', routing.assigned ? `${routing.assigned.name} (${routing.assigned.distanceMi} mi)` : `Corporate — ${routing.reason}`],
    ['Nearest shops', routing.nearest.map(n => `${n.name} — ${n.city}, ${n.state} (${n.distanceMi} mi)`).join('<br>') || '—'],
    ['Notes', lead.message || '—'], ['Consent', lead.consent ? 'Yes' : 'No'], ['Source', lead.source]
  ];
  return `<table cellpadding="6" style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif">${rows.map(([k, v]) =>
    `<tr><td style="border:1px solid #ddd;background:#f5f5f5;font-weight:bold">${esc(k)}</td><td style="border:1px solid #ddd">${k === 'Nearest shops' ? v : esc(v)}</td></tr>`).join('')}</table>`;
}

async function sendAll(lead, routing, priority) {
  if (!enabled()) return { skipped: true };
  const t = transport();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const corp = (process.env.CORPORATE_LEAD_EMAIL || 'sales1@luxeprotectionfilms.com').split(',').map(s => s.trim()).filter(Boolean);
  const brand = 'LUXE Protection Films';
  const results = {};

  // 1. Corporate always gets the full record.
  results.corporate = await t.sendMail({
    from: `"${brand} Installer Locator" <${from}>`, to: corp, replyTo: lead.email,
    subject: `[${priority.startsWith('High') ? 'HIGH' : 'STD'}] Install lead — ${lead.vehicleYear} ${lead.vehicle} — ${lead.zip} → ${routing.assigned ? routing.assigned.name : 'CORPORATE'}`,
    html: `<p><b>New consumer installation lead.</b></p>${leadTable(lead, routing, priority)}`
  });

  // 2. Assigned installer gets the lead (only if approved in installers.json).
  if (routing.assigned) {
    results.installer = await t.sendMail({
      from: `"${brand}" <${from}>`, to: routing.assigned.leadEmail, cc: corp, replyTo: lead.email,
      subject: `New LUXE PPF lead near you — ${lead.vehicleYear} ${lead.vehicle} (${lead.zip})`,
      html: `<p>Hi ${esc(routing.assigned.name)},</p><p>A customer near you requested a LUXE PPF quote through the LUXE Installer Locator. Please reach out within 24 hours.</p>${leadTable(lead, routing, priority)}<p style="color:#666;font-size:12px">Sent by ${brand}. Reply to this email to contact the customer directly.</p>`
    });
  }

  // 3. Consumer confirmation with nearest shops.
  const shops = routing.nearest.map(n =>
    `<li><b>${esc(n.name)}</b> — ${esc([n.address, n.city, n.state].filter(Boolean).join(', '))}${n.phone ? ` · ${esc(n.phone)}` : ''}${n.distanceMi != null ? ` · ${n.distanceMi} mi` : ''}</li>`).join('');
  results.consumer = await t.sendMail({
    from: `"${brand}" <${from}>`, to: lead.email, replyTo: corp[0],
    subject: `Your LUXE installer match — ${lead.vehicleYear} ${lead.vehicle}`,
    html: `<p>Hi ${esc(lead.firstName)},</p><p>Thanks for choosing LUXE Protection Films. ${routing.assigned
      ? `We've sent your request to <b>${esc(routing.assigned.name)}</b>, your nearest LUXE installer — they'll be in touch shortly.`
      : `Our team is reviewing your request and will connect you with the best LUXE installer for your area.`}</p>${shops ? `<p>Nearest LUXE installers:</p><ul>${shops}</ul>` : ''}<p>Browse all installers: <a href="https://luxeprotectionfilms.com/installer-locator/">luxeprotectionfilms.com/installer-locator</a></p><p>— ${brand}</p>`
  });
  return Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.messageId]));
}

module.exports = { enabled, sendAll };
