# RedConnect

RedConnect is a full-stack blood-support platform built with HTML, CSS, JavaScript, and a dependency-free Node.js backend.

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

## Production notes

For public deployment, place the app behind HTTPS, replace the JSON store with PostgreSQL or another transactional database, add SMS/email verification, add organization-license review, and configure an abuse-reporting workflow. The included implementation is complete for local demos, prototypes, and further development.
