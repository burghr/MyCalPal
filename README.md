# MyCalPal

A self-hosted calorie + macro tracker you can run on your phone or desktop. Log meals tagged by breakfast / lunch / dinner / snack, search USDA and Open Food Facts for nutrition, scan barcodes, or enter foods manually. Tracks weight over time, shows a report of goal hit rate, and supports multi-user with an admin role.

## Stack

- **Backend:** FastAPI (Python 3.12) + SQLAlchemy 2 + JWT auth
- **Database:** PostgreSQL 16
- **Frontend:** React 18 + Vite, mobile-first responsive UI, installable as a PWA, `@zxing/browser` for barcode scanning
- **Food data:** [USDA FoodData Central](https://fdc.nal.usda.gov/) (free key) + [Open Food Facts](https://world.openfoodfacts.org/) (no key)
- **Packaging:** Docker Compose (`db`, `api`, `web`)

## Quick start

```bash
cp .env.example .env        # set JWT_SECRET, USDA_API_KEY, ADMIN_EMAIL
docker compose up --build
```

Open:
- Web app: http://localhost:5173
- API docs: http://localhost:8000/docs

Sign up with email + password (min 8 chars) and start logging. The user whose email matches `ADMIN_EMAIL` gets an **Admin** link in the nav for managing other accounts.

## Using on your phone

The frontend derives the API URL from `window.location`, so both localhost and LAN access work out of the box.

1. Find your machine's LAN IP (`ipconfig getifaddr en0` on macOS).
2. On the phone (same Wi-Fi) open `http://<YOUR_IP>:5173`.
3. In iOS Safari: Share → **Add to Home Screen** to install as a PWA.

### Barcode scanning on iOS

iOS Safari requires **HTTPS** for camera access, except on `localhost`. Options:
- Use `localhost` in a desktop browser — works out of the box.
- Put the site behind an HTTPS reverse proxy (Caddy, ngrok, Cloudflare Tunnel) for phone use.

## Features

- Multi-user signup/login with JWT auth; profile page for weight/height/activity/goal
- Mifflin-St Jeor BMR → suggested calorie goal with manual override
- Daily meal diary (breakfast/lunch/dinner/snack) with prev/next day nav
- USDA + Open Food Facts search, with per-portion grams (cup, tbsp, slice, etc.)
- Barcode scanning (live camera via zxing)
- Per-gram auto-scaling when you change the serving size
- Daily weight log + weight trend chart
- Report page: goal hit rate and per-day calories
- kg ↔ lb and ft/in ↔ cm unit toggles
- Admin role (via `ADMIN_EMAIL`): list users, reset passwords, delete accounts
- PWA manifest + iOS home-screen install

## API highlights

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` | Create account → returns JWT |
| POST | `/auth/login` | Log in → returns JWT |
| GET  | `/auth/me` | Current user |
| PATCH | `/auth/me` | Update profile |
| POST | `/auth/me/password` | Change own password |
| GET  | `/foods/search?q=` | Search USDA + local + Open Food Facts |
| GET  | `/foods/usda/{fdc_id}` | USDA food + available portions |
| GET  | `/foods/barcode/{code}` | Lookup barcode (local first, then OFF) |
| POST | `/foods` | Create / upsert a food |
| POST | `/logs` | Log a food entry |
| GET  | `/logs/day?date=YYYY-MM-DD` | Daily summary grouped by meal |
| GET  | `/logs/history?days=N` | Per-day calorie totals |
| GET  | `/logs/stats?days=N` | Goal hit/miss counts + per-day list |
| GET/POST | `/weights` | List / upsert weight entries |
| GET  | `/admin/users` | Admin: list users |
| DELETE | `/admin/users/{id}` | Admin: delete user |
| POST | `/admin/users/{id}/reset-password` | Admin: reset password |

## Project layout

```
.
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py           # FastAPI app + CORS + startup create_all
│       ├── config.py         # env settings
│       ├── database.py       # engine + session
│       ├── models.py         # User, Food, FoodLog, WeightLog
│       ├── schemas.py        # Pydantic models
│       ├── auth.py           # password hashing + JWT + admin helpers
│       └── routers/
│           ├── auth.py       # signup / login / me / password
│           ├── foods.py      # search / barcode / USDA detail / create
│           ├── logs.py       # food log CRUD + day / history / stats
│           ├── weights.py    # weight log upsert + list
│           └── admin.py      # user management (admin-only)
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/               # PWA manifest + icons
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js            # fetch wrapper (derives API URL from window)
        ├── auth.jsx          # auth context + localStorage persistence
        ├── units.js          # serving + weight unit helpers
        ├── calorie.js        # BMR / TDEE / goal math
        ├── styles.css
        └── components/
            ├── Login.jsx
            ├── Signup.jsx
            ├── Dashboard.jsx       # daily diary
            ├── AddFood.jsx         # search / scan / manual
            ├── BarcodeScanner.jsx  # @zxing live camera
            ├── EditLog.jsx
            ├── Report.jsx          # goal stats + weight chart
            ├── Profile.jsx         # account + weight log + password
            └── Admin.jsx           # user management
```

## Production notes

- Replace `create_all` startup with Alembic migrations.
- Tighten CORS to your actual origin (currently `*`).
- Use a strong `JWT_SECRET` from a secrets manager.
- Put a reverse proxy (Caddy/Traefik) in front for HTTPS.
- Cache Open Food Facts / USDA hits to avoid re-hitting external APIs.
- The default PWA icons in `frontend/public/` are plain placeholders — replace `icon-192.png`, `icon-512.png`, `icon-180.png` with your own.
