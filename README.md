# Project Udyam Digital

A phone-first journey that lets a small business owner choose a bundle, buy it, complete KYC and track activation. Built for YTL Hackathon 2026, Enterprise Track A. All data is synthetic.

## Run it on Windows

You need Python 3.11+ and Node 20+. Use two terminals, starting from the project folder.

**Terminal 1: backend**

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m app.import_data
.venv\Scripts\python -m uvicorn app.main:app --reload
```

Skip the `venv`, `pip` and `import_data` lines after the first run. API docs: http://127.0.0.1:8000/docs

**Terminal 2: frontend**

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Skip `npm install` after the first run.

## Turn on the advisor chat (optional)

Copy `backend/.env.example` to `backend/.env`, add your Groq API key to the copy, and restart the backend. Git ignores `.env`, so keep keys there and never in `.env.example`, which is public. Without a key, the app opens a guided form that gives the same bundle and prices. If the LLM fails during a chat, the app moves to that form.

## Accounts

The app opens on a sign-in page. Owners sign in or create an account first, then go straight to finding a bundle. Every order belongs to the signed-in owner and appears on their profile on any device. Their first name at the top of the page opens the profile.

The server enforces this too: starting a quote, getting a recommendation or price, the advisor chat and call-back requests all answer 401 without a signed-in owner. The rate list, city list and KYC notice stay public. Orders made before sign-in was required can still be added to an account at sign-in, because the browser can prove it owns them. Staff keep their own separate sign-in.

Security choices:
- Passwords are hashed with Argon2id (`argon2-cffi`). They are never stored or logged in plain text.
- Sign-in uses an HttpOnly, Secure, SameSite=Lax cookie that page scripts cannot read. The server keeps only a hash of its token, and signing out deletes it on the server.
- Each order's access secret is also an HttpOnly cookie. Nothing secret is kept in the browser's localStorage, which holds only the language, the order number being followed and unsaved profile changes. The profile page has a button that clears all of it.
- Requests that use these cookies to change data must send an `X-Accel-CSRF` header, which other websites cannot add.
- After 5 wrong passwords for an email, sign-in for that email pauses for 15 minutes.
- API clients can still use the `X-Access-Token` header for an order, exactly as before.

Secure cookies need HTTPS, except on `localhost`, where browsers accept them. To test over plain HTTP on another address, set `COOKIE_SECURE=false` in `backend/.env`. Never do that in real use.

## Staff view

Use the "Staff sign in" link on the first page. In demo mode the key is `accel-demo-staff`. For real use, set your own `STAFF_KEY` in `backend/.env` and set `DEMO_MODE=false`, which also turns the built-in key off.

## Demo controls

No real installation partner is connected, so the tracker shows a clearly labelled button that moves an order through installation. Set `DEMO_MODE=false` in `backend/.env` to remove it.

## Run the tests

```powershell
cd backend
.venv\Scripts\python -m pytest
```

Frontend checks:

```powershell
cd frontend
npm test
npm run build
npm run lint
```

The normal backend run skips real OCR. To run it on all 47 sample documents, which takes about 2 minutes:

```powershell
.venv\Scripts\python -m pytest -m slow -o addopts=""
```

## Project layout

| Path | What it holds |
| --- | --- |
| `backend/app/database.py` | Database connection (SQLite by default) |
| `backend/app/models.py` | All database tables |
| `backend/app/import_data.py` | Loads the CSV files into the database |
| `backend/app/catalogue.py` | Catalogue API |
| `backend/app/rules.py` | What a business may buy: eligibility and product dependencies |
| `backend/app/pricing.py` | What a bundle costs: the only place that calculates money |
| `backend/app/recommend.py` | Which bundle fits best, and why |
| `backend/app/bundles.py` | Bundle API: recommend and quote |
| `backend/app/llm.py` | The only file that talks to the LLM |
| `backend/app/advisor.py` | Advisor chat API, which turns a conversation into a business profile |
| `backend/app/explain.py` | Explains a bundle in plain words and checks any LLM rewrite |
| `backend/app/quotes.py` | Saves an accepted quote with its prices |
| `backend/app/kyc_ocr.py` | Reads text from an uploaded image, in memory only |
| `backend/app/kyc_parse.py` | Turns text into fields, and checks GSTIN format and check digit |
| `backend/app/kyc_rules.py` | Compares documents with the registries and with each other |
| `backend/app/kyc.py` | KYC API: consent, upload and status |
| `backend/app/order_state.py` | The moves an order may make, enforced on the server |
| `backend/app/orders.py` | Order API: tracker, checkout, cancel and help |
| `backend/app/access.py` | Checks on every private request that the owner, by token, order cookie or account, owns the data |
| `backend/app/auth.py` | Password hashing, sign-in sessions, cookies and the CSRF check |
| `backend/app/accounts.py` | Account API: sign up, sign in, sign out and profile |
| `backend/app/staff.py` | Staff API: KYC reviews, help requests, installations and the call list |
| `backend/app/analytics.py` | Funnel numbers for the staff dashboard |
| `backend/app/lead_score.py` | A simple, explainable score for which leads to call |
| `backend/app/callbacks.py` | Lets an owner ask a person to call them |
| `backend/tests/` | Automated tests |
| `frontend/src/api.ts` | All calls from the frontend to the backend |
| `frontend/src/App.tsx` | Moves the owner between screens |
| `frontend/src/AdvisorChat.tsx` | Advisor chat |
| `frontend/src/GuidedForm.tsx` | Form used when the chat is off or fails |
| `frontend/src/QuotePage.tsx` | Quote with add-ons the owner can toggle |
| `frontend/src/KycPage.tsx` | Consent screen and document upload |
| `frontend/src/OrderPage.tsx` | Order tracker and checkout |
| `frontend/src/StaffPage.tsx` | Staff work queue, funnel dashboard and call list |
| `frontend/src/i18n.ts` | English and Hindi text |
| `frontend/src/storage.ts` | The only code that uses localStorage, with checks for broken or old data |
| `frontend/src/AuthPage.tsx` | Sign in and sign up |
| `frontend/src/ProfilePage.tsx` | Profile, businesses, orders and clearing this device |
| `frontend/src/CataloguePage.tsx` | Rate list page |
| `YTL_TrackA_Udyam_Digital_Data/` | Hackathon dataset |
