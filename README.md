# 🎯 Nudge Copilot

> **AI-powered opportunity, deadline, and academic career copilot for students.**  
> Powered by **Google Gemma 4** (`gemma-4-26b-a4b-it`) via the official `@google/genai` SDK, native `node:sqlite`, and calm, rewarding productivity design.

---

## 📌 Overview

Students face constant cognitive overload: internships, hackathons, scholarships, academic project deadlines, and cold outreach follow-ups are scattered across WhatsApp group flyers, LinkedIn posts, job portals, and emails.

**Nudge Copilot** transforms raw, unstructured input into an organized timeline:
1. **Drop a link, paste an image screenshot (`Ctrl + V`), or type colloquially** (*"Remind me in 4 days to apply for EY Hackathon"*).
2. **Google Gemma 4** extracts key dates, distinguishes registration deadlines from event dates, normalizes relative time to India Standard Time (IST), and avoids date hallucinations.
3. **Reassuring 1-Click Confirmation** allows the student to verify or override extracted deadlines.
4. **Persistent Anonymous Workspaces** automatically preserve your personal data across browser reloads and server restarts without forced sign-up walls.
5. **Cold Email Tracker & AI Drafter** helps students draft personalized cold emails with bracketed placeholders and follow-up schedules.
6. **Proactive Web Push Reminders** alert students before deadlines arrive.
7. **Executive Performance Reports & Excel Export** provide real-time pipeline visibility.

---

## 🏗️ Architecture & Technology Stack

```
   ┌──────────────────────────────────────────────────────────────┐
   │            Vanilla HTML5 / CSS3 / ES6 Frontend              │
   │      (Calm Productivity Palette: #F7F6F2 / #252746)          │
   │   - Collapsible Navigation & Chat Session Drawer             │
   │   - Service Worker & Web Push Client                         │
   │   - Interactive Modals, Tour, and Countdown Cards            │
   └──────────────────────────────┬───────────────────────────────┘
                                  │ HTTP (SameSite=Lax Cookie)
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                  Express Backend (Node.js 22+)               │
   │  - Anonymous Guest Session Middleware (HttpOnly, Secure)     │
   │  - Rate Limiter (Token-Bucket per Guest)                     │
   │  - SSRF Protection (IPv4/IPv6 private IP filtering)          │
   │  - node-cron Background Scheduler (Single-Instance Safe)     │
   └───────────────┬──────────────────────────────┬───────────────┘
                   │                              │
                   ▼                              ▼
   ┌──────────────────────────────┐ ┌─────────────────────────────┐
   │   Google Gemma 4 AI Engine   │ │     SQLite Persistence      │
   │ - @google/genai SDK          │ │ - node:sqlite DatabaseSync  │
   │ - Model: gemma-4-26b-a4b-it  │ │ - WAL Mode Journaling       │
   │ - Multimodal Vision Support  │ │ - Multi-tenant Isolation    │
   │ - Tesseract.js OCR Fallback  │ │ - Configurable DATABASE_PATH│
   └──────────────────────────────┘ └─────────────────────────────┘
```

- **Backend Runtime:** Node.js (v22 or later) using ES modules (`"type": "module"`).
- **AI Engine:** Google Gemma 4 (`gemma-4-26b-a4b-it`) via `@google/genai` with strict JSON schema enforcement and fallback heuristics.
- **OCR:** `tesseract.js` for on-device fallback optical character recognition.
- **SSRF Protection:** DNS resolution and IP range validation blocking loopback (`127.0.0.1`), link-local (`169.254.0.0/16`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and IPv6 equivalents.
- **Database:** Native `node:sqlite` with `DatabaseSync` in WAL mode.
- **Push Notifications:** `web-push` using VAPID credentials.
- **Reports:** `xlsx` for Excel workbook generation.

---

## 🔒 Security & Anonymous Multi-Tenant Isolation

### Anonymous Guest Sessions
- When a user visits Nudge, the server generates a cryptographically secure 64-character token (`crypto.randomBytes(32)`).
- An opaque, persistent session is stored server-side in `guest_sessions` with an 1-year lifetime.
- A cookie named `nudge_guest` is set with `HttpOnly`, `SameSite=Lax`, and `Secure` (over HTTPS).
- **Zero Insecure Direct Object References (IDOR):** Every database query, update, and deletion is scoped strictly to `req.guestId`. Guest B cannot view, modify, or delete Guest A's records by guessing integer IDs.
- **Reminder Privacy:** Push notifications are dispatched solely to subscriptions owned by the guest who created that reminder.
- **Limitation:** Guest workspaces are bound to the browser's cookie storage. Clearing browser cookies or opening an incognito window creates a fresh guest workspace. (Account linking can be implemented for cross-device synchronization).

---

## 🚀 Getting Started Locally

### Prerequisites
- Node.js 22.0.0 or higher.
- A free Google AI Studio API key (for Gemma 4 inference): [https://aistudio.google.com/](https://aistudio.google.com/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/nudge-copilot.git
   cd nudge-copilot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set your `GEMMA_API_KEY`:
   ```ini
   GEMMA_API_KEY=AIzaSy...your_key_here
   GEMMA_MODEL=gemma-4-26b-a4b-it
   PORT=3000
   NODE_ENV=development
   ```

4. **Verify Gemma 4 Connection:**
   ```bash
   npm run verify:gemma
   ```

5. **Start Application:**
   ```bash
   npm start
   ```
   Open your browser to [http://localhost:3000](http://localhost:3000).

---

## 🧪 Testing

Nudge Copilot includes automated test coverage for AI parsing, deadline extraction, date math, duplicate detection, and guest isolation.

Run all tests:
```bash
npm test
```

Run guest isolation security tests specifically:
```bash
npm run test:isolation
```

---

## 🚢 Production Deployment on Railway

### Step 1: Push to GitHub
Ensure your repository is published to GitHub (see GitHub publication instructions below).

### Step 2: Create a New Project on Railway
1. Log in to [Railway](https://railway.com/).
2. Click **+ New Project** > **Deploy from GitHub repo**.
3. Select your `nudge-copilot` repository.

### Step 3: Attach a Persistent Volume (Required for SQLite)
1. In your Railway service settings, navigate to the **Volumes** tab.
2. Click **+ Add Volume**.
3. Set the mount path to `/data`.

### Step 4: Configure Environment Variables
In the Railway dashboard under **Variables**, set:
| Variable | Value | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enables production security flags (`Secure` cookies) |
| `PORT` | `3000` | Port listened on by Express |
| `DATABASE_PATH` | `/data/nudge.db` | Points SQLite to persistent volume storage |
| `GEMMA_API_KEY` | `your_actual_key` | Google AI Studio API key |
| `GEMMA_MODEL` | `gemma-4-26b-a4b-it` | Gemma 4 model identifier |
| `AI_MODE` | `production` | Live AI inference mode |
| `VAPID_PUBLIC_KEY` | *(optional)* | Your VAPID public key (auto-generated if omitted) |
| `VAPID_PRIVATE_KEY`| *(optional)* | Your VAPID private key |
| `VAPID_SUBJECT` | `mailto:support@yourdomain.com` | Contact email for push services |

### Step 5: Networking & Domain
1. In service **Settings** > **Networking**, click **Generate Domain**.
2. Railway provides a public HTTPS domain (e.g. `nudge-copilot-production.up.railway.app`).
3. Set health check path to `/health`.

---

## ⚠️ Known Limitations & Operational Considerations

1. **In-Process Scheduler:** The reminder scheduler runs via `node-cron` inside the Node.js process. Reminders scheduled during application downtime or deployment restarts will dispatch on the subsequent minute check. In multi-replica configurations, ensure single-instance operation or attach an external task runner.
2. **Browser Push Permissions:** Web Push requires the visitor to grant notification permissions in a supported browser (Chrome, Edge, Firefox, Safari on macOS/iOS 16.4+).
3. **Guest Session Binding:** Guest identities persist via `HttpOnly` cookies. If a user deletes browser cookies or uses private browsing, they will enter a new anonymous session.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
