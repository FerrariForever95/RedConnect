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

Map tiles, Leaflet, Three.js, the Supabase browser client, Nominatim, and Overpass load from the internet. Local application data is stored in `data/store.json`.

The local fallback cannot send real SMS. During local development, the OTP is printed in the server terminal and shown in a clearly labelled development box. Development OTP is disabled automatically when `NODE_ENV=production`; production OTP messages are sent only after Supabase phone authentication and an SMS provider are configured.

## Connect Supabase for production

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it once. The schema creates separate profile, location, availability, donation, organization, request, contact, and safe public-directory tables.
3. Open **Project Settings → API** and copy the Project URL and **publishable** key.
4. Replace the two placeholders in `public/config.js`.
5. In **Authentication → Providers → Phone**, enable phone sign-in and configure an SMS provider supported by Supabase.
6. For an India deployment, complete the SMS provider's DLT/TRAI registration and configure CAPTCHA plus suitable OTP rate limits.
7. In **Authentication → URL Configuration**, set your deployed site as the Site URL and add your local and deployed redirect URLs.
8. Deploy the repository to Vercel. `vercel.json` runs the non-blocking static build and publishes `public/`.

The publishable key is designed for browser use when Row Level Security is enabled. Never put a `service_role` or secret key in `public/config.js`. When Supabase is configured, the site automatically uses PostgreSQL and Supabase Auth. With placeholders unchanged, it falls back to the local Node API and `data/store.json`.

New organizations start as unverified. After reviewing the registration, set `organizations.verified` to `true` in the Supabase Table Editor and add its available units to `organization_inventory`.

## Production notes

For public deployment, use HTTPS, review organization licenses before verification, configure CAPTCHA and abuse reporting, and set suitable session controls. Public discovery reads sanitized directory tables that exclude phone numbers, birth dates, home addresses, and exact coordinates. A donor phone is copied into a contact request only after that donor approves the request.
