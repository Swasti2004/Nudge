# 🎯 Nudge Copilot

> **AI-powered opportunity, deadline, and academic career copilot for students.**  
> Powered by **TinyFish Web Agent** (Fetch & Search), **Google Gemma 4** (`gemma-4-26b-a4b-it`) via the official `@google/genai` SDK, native `node:sqlite`, and calm, rewarding productivity design.

---

### 🌐 Live Production Deployment
* **Live Web App:** **[https://nudge-production-4842.up.railway.app/](https://nudge-production-4842.up.railway.app/)**
* **Health Check & Status:** **[https://nudge-production-4842.up.railway.app/health](https://nudge-production-4842.up.railway.app/health)**
* **GitHub Repository:** **[https://github.com/Swasti2004/Nudge](https://github.com/Swasti2004/Nudge)**

---

## 📌 Overview

Students face constant cognitive overload: internships, hackathons, scholarships, academic project deadlines, and cold outreach follow-ups are scattered across WhatsApp group flyers, LinkedIn posts, job portals, and emails.

**Nudge Copilot** transforms raw, unstructured input into an organized timeline:
1. **Drop a link, paste an image screenshot (`Ctrl + V`), or type colloquially** (*"Remind me in 4 days to apply for EY Hackathon"*).
2. **TinyFish Web Agent (Fetch API)** renders complex JavaScript SPAs and provides clean, injection-sanitized markdown directly to Gemma 4.
3. **Google Gemma 4** extracts key dates, distinguishes registration deadlines from event dates, extracts eligibility, normalizes relative time to India Standard Time (IST), and avoids date hallucinations.
4. **Reassuring 1-Click Confirmation** allows the student to verify or override extracted deadlines before anything is saved.
5. **Automated Deadline Monitoring** periodically re-fetches official opportunity pages using TinyFish, alerts users to deadline changes, and **never silently overwrites** confirmed dates.
6. **Live Opportunity Discovery** uses TinyFish Search API + Gemma 4 to find internships, hackathons, and scholarships with 1-click tracking.
7. **Persistent Anonymous Workspaces** automatically preserve personal data across browser reloads and server restarts without forced sign-up walls.
8. **Cold Email Tracker & AI Drafter** helps students draft personalized cold emails with bracketed placeholders and follow-up schedules.
9. **Proactive Web Push Reminders** alert students before deadlines arrive.
10. **Executive Performance Reports & Excel Export** provide real-time pipeline visibility.

---

## 🐟 TinyFish Web Agent Integration

Nudge Copilot integrates **TinyFish** across three critical workflows:

### 1. TinyFish Fetch + Gemma 4 Pipeline
* **Endpoint:** `POST https://api.fetch.tinyfish.ai`
* **Real Browser Rendering:** Modern student portals (Devfolio, Unstop, Greenhouse, Lever, Luma) rely heavily on client-side JavaScript rendering. TinyFish executes full browser rendering to extract dynamically loaded deadline schedules, eligibility criteria, and application links.
* **Security & Prompt Injection Protection:** URLs undergo strict pre-flight SSRF validation (DNS verification against private IPv4 and IPv6 ranges). Webpage text is stripped of script tags, style sheets, and prompt-injection overrides (`ignore previous instructions`, `system prompt`) before reaching Gemma 4.
* **Graceful Fallback:** If `TINYFISH_API_KEY` is not present, times out, or encounters network errors, the engine falls back safely to local SSRF-safe fetching without crashing the user's flow.
* **Registration Deadline vs Event Date Separation:** Accurately distinguishes application/registration cutoffs from the dates the competition/event occurs.

### 2. Live Deadline Monitoring
* **Background Checks:** Monitored opportunities with URLs are automatically checked every 30 minutes in the background, or on-demand via the **"🐟 Check Live Page"** button.
* **Proactive Alerts:** If an organization extends or advances a registration deadline, Nudge notifies the student via Web Push and a prominent alert in their active conversation and Opportunities tab.
* **Non-Negotiable Invariant:** Confirmed deadlines are **NEVER silently overwritten**. The student is presented with clear options: `[Update to new date]` or `[Keep saved date]`.

### 3. Opportunity Discovery
* **Endpoint:** `GET https://api.search.tinyfish.ai?query=...`
* **Search Engine Discovery:** Students can type naturally in chat (*"Find upcoming AI hackathons"*, *"Search summer software internships"*) or click the **"🐟 Discover with TinyFish"** modal in the Opportunities view.
* **Structured by Gemma 4:** Search snippets and URLs are structured into title, organization, category, deadline, and eligibility.
* **Confirmation-First Saving:** Discovered opportunities are presented for review with 1-click confirmation before anything is saved to the tracker.

---

## 🏗️ Architecture & Technology Stack

```
   ┌──────────────────────────────────────────────────────────────┐
   │            Vanilla HTML5 / CSS3 / ES6 Frontend              │
   │      (Calm Productivity Palette: #F7F6F2 / #252746)          │
   │   - Collapsible Navigation & Chat Session Drawer             │
   │   - Service Worker & Web Push Client                         │
   │   - TinyFish Discovery Modal & Deadline Change Banners       │
   └──────────────────────────────┬───────────────────────────────┘
                                  │ HTTP (SameSite=Lax Cookie)
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                  Express Backend (Node.js 22+)               │
   │  - Anonymous Guest Session Middleware (HttpOnly, Secure)     │
   │  - Rate Limiter (Token-Bucket per Guest)                     │
   │  - SSRF Protection (IPv4/IPv6 private IP filtering)          │
   │  - node-cron Scheduler (Reminders + 30-min TinyFish Monitor) │
   └───────┬──────────────────────┬──────────────────────┬────────┘
           │                      │                      │
           ▼                      ▼                      ▼
   ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
   │   TinyFish    │      │ Google Gemma4 │      │    SQLite     │
   │ Web Agent API │      │   AI Engine   │      │  Persistence  │
   │- Fetch (SPAs) │      │- @google/genai│      │- node:sqlite  │
   │- Search (Live)│      │- Strict Schema│      │- WAL Mode     │
   │- SSRF Shield  │      │- Multi-modal  │      │- Multi-tenant │
   └───────────────┘      └───────────────┘      └───────────────┘
```

- **Live URL:** [https://nudge-production-4842.up.railway.app/](https://nudge-production-4842.up.railway.app/)
- **Backend Runtime:** Node.js (v24 / v22) using native ES modules (`"type": "module"`).
- **Web Agent:** Official TinyFish Fetch & Search API (`tinyfish.js`).
- **AI Engine:** Google Gemma 4 (`gemma-4-26b-a4b-it`) via official `@google/genai` SDK with strict JSON schema enforcement and fallback heuristics.
- **OCR:** `tesseract.js` for on-device fallback optical character recognition.
- **SSRF Protection:** DNS resolution and IP range validation blocking loopback (`127.0.0.1`), link-local (`169.254.0.0/16`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and IPv6 equivalents.
- **Database:** Native `node:sqlite` with `DatabaseSync` in WAL mode and `PRAGMA busy_timeout = 5000`.
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
- **Limitation:** Guest workspaces are bound to the browser's cookie storage. Clearing browser cookies or opening an incognito window creates a fresh guest workspace.

---

## 🚀 Getting Started Locally

### Prerequisites
- Node.js 22.0.0 or higher.
- A free Google AI Studio API key (for Gemma 4 inference): [https://aistudio.google.com/](https://aistudio.google.com/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Swasti2004/Nudge.git
   cd Nudge
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

Nudge Copilot includes 41 automated tests covering TinyFish Fetch & Search, SSRF validation, prompt injection resistance, deadline monitoring, Gemma 4 AI parsing, date math, duplicate detection, and guest isolation.

Run all tests:
```bash
npm test
```

Run TinyFish tests specifically:
```bash
npm run test:tinyfish
```

Run guest isolation security tests specifically:
```bash
npm run test:isolation
```

---

## 🚢 Production Deployment Details (Railway)

The production service is deployed on Railway using persistent volume storage and automated health monitoring:

* **Live Domain:** [https://nudge-production-4842.up.railway.app/](https://nudge-production-4842.up.railway.app/)
* **Health Check Path:** `/health` (Configured in `railway.json`)
* **Persistent Storage Mount:** `/data` (Houses `/data/nudge.db`)

### Configured Environment Variables
| Variable | Production Value | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enforces production security flags (`Secure` cookies) |
| `PORT` | `3000` | Port listened on by Express |
| `DATABASE_PATH` | `/data/nudge.db` | Points SQLite to persistent volume storage |
| `GEMMA_API_KEY` | *(Set in Railway)* | Google AI Studio API key |
| `GEMMA_MODEL` | `gemma-4-26b-a4b-it` | Gemma 4 model identifier |
| `TINYFISH_API_KEY` | *(Set in Railway)* | TinyFish Web Agent API key (Fetch & Search) |
| `AI_MODE` | `production` | Live AI inference mode |
| `VAPID_SUBJECT` | `mailto:support@nudgeapp.local` | Contact email for push services |

---

## ⚠️ Operational Considerations

1. **In-Process Scheduler:** The reminder scheduler runs via `node-cron` inside the Node.js process. Reminders scheduled during application downtime or deployment restarts will dispatch on the subsequent minute check. In multi-replica configurations, ensure single-instance operation or attach an external task runner.
2. **Browser Push Permissions:** Web Push requires the visitor to grant notification permissions in a supported browser (Chrome, Edge, Firefox, Safari on macOS/iOS 16.4+).
3. **Guest Session Binding:** Guest identities persist via `HttpOnly` cookies. If a user deletes browser cookies or uses private browsing, they will enter a new anonymous session.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
