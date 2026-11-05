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

## Staff view

Use the "Staff sign in" link on the first page. In demo mode the key is `accel-demo-staff`. For real use, set your own `STAFF_KEY` in `backend/.env` and set `DEMO_MODE=false`, which also turns the built-in key off.

## Demo controls

No real installation partner is connected, so the tracker shows a clearly labelled button that moves an order through installation. Set `DEMO_MODE=false` in `backend/.env` to remove it.

## Run the tests

```powershell
cd backend
.venv\Scripts\python -m pytest
```

The normal run skips real OCR. To run it on all 47 sample documents, which takes about 2 minutes:

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
| `backend/app/access.py` | Checks each owner's secret token on every private request |
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
| `frontend/src/CataloguePage.tsx` | Rate list page |
| `YTL_TrackA_Udyam_Digital_Data/` | Hackathon dataset |
