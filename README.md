# luxe-lead-router

Shared consumer installer-lead handler for LUXE Protection Films. One endpoint serves the WordPress installer locator, the Shopify `/pages/find-an-installer` page, and the ELITE Installer microsites.

## What it does
`POST /api/installer-lead` → validates → resolves zip → nearest 3 installers → assigns the nearest installer inside `COVERAGE_MILES` (150) **that is approved** in `data/installers.json` (`leadEmailApproved: true`) → emails installer + `sales1@` + consumer → creates a Zoho CRM Lead (tags `INSTALL-LEAD`, `IL-HIGH`/`IL-STANDARD`, `IL-COVERED`/`IL-NO-COVERAGE`).

Soft year gate: 2020+ = `High (2020+)`, else `Standard (2019-)`. Nothing is rejected.
No coverage: lead goes to corporate only; consumer still sees nearest 3.
No approved email for the nearest shop: corporate gets it; nearest shop is named in the email so sales can hand it off.

Other routes: `GET /api/health`, `GET /api/installers` (public dataset, no emails — feeds the phase-2 Shopify map), `GET /api/installers/nearest?zip=`.

## Deploy (DigitalOcean App Platform)
Add as a service component (or drop `src/`, `data/`, `package.json` into the existing SFS `/server`). Run command `npm start`, HTTP port 8080, health check `/api/health`. Set env vars from `.env.example` in the DO dashboard — never commit `.env`.

## Approving an installer for direct lead routing
Edit `data/installers.json`: set `leadEmail` to the address the shop owner supplied and `leadEmailApproved: true`. Until then their leads route to corporate.

## Form embed
`public/luxe-installer-form.html` — paste into a WordPress Custom HTML block / Shopify page. Change `data-endpoint` to the deployed host and `data-source` to `wordpress` / `shopify` / `microsite:<slug>`.

## Test
`RATE_LIMIT_OFF=1 npm test`
