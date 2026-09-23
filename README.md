# RedConnect

RedConnect is a full-stack blood-support platform built with HTML, CSS, JavaScript, Supabase, and a dependency-free local Node.js fallback.

## Features

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

## Run

1. Install Node.js 18 or newer.
2. Open this folder in a terminal.
3. Run `npm start`.
4. Visit `http://localhost:8080`.

For production, set a private session secret before starting the server:

```bash
SESSION_SECRET="replace-with-a-long-random-value" npm start
```

No package installation is required. Map tiles and the Leaflet map library load from the internet. Application data is stored in `data/store.json`.

## Connect Supabase for production

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it once.
3. Open **Project Settings → API** and copy the Project URL and **publishable** key.
4. Replace the two placeholders in `public/config.js`.
5. In **Authentication → URL Configuration**, set your deployed site as the Site URL and add your local and deployed redirect URLs.
6. Deploy the `public` directory to Vercel, Netlify, or another static host.

The publishable key is safe to include in browser code when Row Level Security is enabled. Never put a `service_role` or secret key in `public/config.js`. When Supabase is configured, the site automatically uses PostgreSQL and Supabase Auth. With placeholders unchanged, it falls back to the local Node API and `data/store.json`.

New organizations start as unverified. After reviewing the registration, set `organizations.verified` to `true` in the Supabase Table Editor and add its available units to `organization_inventory`.

## Production notes

For public deployment, use HTTPS, keep email confirmation enabled, review organization licenses before verification, and configure an abuse-reporting workflow. Donor contact details require authentication and are protected by database policies.
