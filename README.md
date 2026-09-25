# RedConnect

RedConnect is a full-stack blood-support platform built with HTML, CSS, JavaScript, Supabase, and a dependency-free local Node.js fallback.

## Features

- Phone OTP authentication with persistent Supabase sessions
- Protected donor profile with private date of birth, phone, and exact location
- Separate Blood Network discovery page at `/Blood-Network/`
- Unified donor, organization, request, and OpenStreetMap medical discovery
- Controlled donor contact: request, donor approval, then phone sharing
- Pending donation history with organization verification support
- Individual donor and patient/caregiver registration
- Organization registration for hospitals, blood banks, NGOs, and donor networks
- Password hashing and session-based authentication
- Signed seven-day sessions that survive server restarts
- Account panel with donor availability controls
- Request-owner tools to mark requests fulfilled or cancelled
- Emergency blood requests with group, quantity, component, hospital, deadline, and location
- Blood compatibility filtering and nearest-first donor and organization matching
- OpenStreetMap map with a list fallback
- Persistent JSON data store and seeded organizations/requests
- Responsive, accessible interface for mobile and desktop
- Production PostgreSQL storage, Supabase Auth, Realtime, and Row Level Security

## Install and run locally

1. Install Node.js 18 or newer.
2. Open this folder in a terminal.
3. Run `npm install` (there are currently no package dependencies, but this validates the project metadata).
4. Run `npm start`.
5. Visit `http://localhost:8080`.

Open the site through that address. Double-clicking `public/index.html` uses a `file://` URL, which cannot reach the local API and may make images, scripts, and maps appear missing.

Useful commands:

```bash
npm start       # production-style local server
npm run dev     # restart automatically after file changes
npm run check   # JavaScript syntax verification
npm run build   # prepare the static public/ output for Vercel
```

For production, set a private session secret before starting the server:

```bash
SESSION_SECRET="replace-with-a-long-random-value" npm start
```

Map tiles, Leaflet, Three.js, the Supabase browser client, Nominatim, and Overpass load from the internet. Local application data is stored in relational-style `rc_` collections in `data/store.json`, including account, protected profile, location, availability, organization, inventory, request, donation, and contact-request records.

The local fallback cannot send real SMS. During local development, the OTP is printed in the server terminal and shown in a clearly labelled development box. Development OTP is disabled automatically when `NODE_ENV=production`; production OTP messages are sent only after Supabase phone authentication and an SMS provider are configured.

## Supabase and JSON database modes

The checked-in configuration connects to the selected Supabase project with a browser-safe publishable key. RedConnect uses isolated `rc_` tables, policies, triggers, and functions so it does not modify the project's existing application tables.

1. In **Authentication → Providers → Phone**, enable phone sign-in and configure a supported SMS provider.
2. For an India deployment, complete the SMS provider's DLT/TRAI registration and configure CAPTCHA plus suitable OTP rate limits.
3. In **Authentication → URL Configuration**, set the deployed site as the Site URL and add local and deployed redirect URLs.
4. Deploy the repository to Vercel. `vercel.json` runs the static build and publishes `public/`; authentication and data then go directly to Supabase.

To use the JSON database instead, set `forceLocalDatabase: true` in `public/config.js` and start the Node server. The local fallback saves logins and profile details in `data/store.json` and displays a development OTP because it cannot send real SMS.

The publishable key is designed for browser use when Row Level Security is enabled. Never put a `service_role` or secret key in `public/config.js`.

New organizations start as unverified. After reviewing the registration, set `rc_organizations.verified` to `true` in the Supabase Table Editor and add its available units to `rc_organization_inventory`.

## Production notes

For public deployment, use HTTPS, review organization licenses before verification, configure CAPTCHA and abuse reporting, and set suitable session controls. Public discovery reads sanitized directory tables that exclude phone numbers, birth dates, home addresses, and exact coordinates. A donor phone is copied into a contact request only after that donor approves the request.
