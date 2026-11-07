# 🎯 Nudge Copilot

> **AI-powered opportunity, deadline, and academic career copilot for students.**  
> Powered by **TinyFish Web Agent** (Fetch & Search), **Google Gemma 4** (`gemma-4-26b-a4b-it`) via the official `@google/genai` SDK, native `node:sqlite`, and calm, rewarding productivity design.

---

### 🌐 Live Production Deployment
* **Live Web App:** **[https://nudgeweb.up.railway.app/](https://nudgeweb.up.railway.app/)**
* **Health Check & Status:** **[https://nudgeweb.up.railway.app/health](https://nudgeweb.up.railway.app/health)**
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

## 🐟 TinyFish Web Agent Integration & Hackathon Contribution

> **TinyFish Web Agent Showcase:** [https://tinyfish.io](https://tinyfish.io)  
> **Live Deployed Application:** [https://nudgeweb.up.railway.app/](https://nudgeweb.up.railway.app/)  
> **TinyFish Fetch API:** `POST https://api.fetch.tinyfish.ai` | **TinyFish Search API:** `GET https://api.search.tinyfish.ai`

### 💡 How TinyFish Uniquely Contributes to Nudge's Solution

In traditional student productivity apps, pasting a link to an opportunity is virtually useless because modern application portals (Devfolio, Unstop, Greenhouse, Lever, Luma, Devpost) are **heavily client-side rendered Single-Page Applications (SPAs)**. Standard HTTP clients only receive empty container tags (`<div id="root"></div>`), completely missing dynamic application deadlines, eligibility criteria, and application links.

**TinyFish transforms Nudge from a passive note-taker into an autonomous, proactive opportunity copilot across three foundational pillars:**

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │                  TinyFish Web Agent Contribution                       │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
 1. Real Browser Fetch         2. Autonomous Monitor          3. Live Discovery
 ─────────────────────         ─────────────────────          ──────────────────
 • Renders dynamic SPAs        • 30-min background crawl      • Live query search
 • Extracts hydrated dates     • Detects deadline changes     • Discovers new opps
 • Separates reg vs event      • Alert without overwrite      • 1-click tracking
```

#### 1. Real Browser Rendering & Information Extraction (TinyFish Fetch API)
* **Solving the CSR Barrier:** TinyFish executes a real browser engine that executes JavaScript, waits for dynamic DOM hydration, and extracts clean, injection-sanitized markdown from complex portals.
* **Separation of Registration Deadlines vs. Event Dates:** For hackathons and conferences, TinyFish extracts both the registration cutoff and the actual event dates. The AI model assigns the registration deadline to the primary tracking schedule, ensuring students don't confuse when the hackathon happens with when applications close.
* **Intelligent Date Constraint Validation:** When an official closing date is extracted by TinyFish or an uploaded flyer, the UI enforces strict calendar validation (`custom_deadline <= official_closing_date`). Students can choose an earlier personal preparation deadline, but are prevented from setting a reminder after the opportunity has officially closed.
* **Security & Prompt Injection Resistance:** Built-in pre-flight SSRF validation checks domains against private IPv4/IPv6 address spaces. Raw text is sanitized before reaching the reasoning model.

#### 2. Autonomous Deadline Vigilance & Change Detection (TinyFish Monitoring)
* **Continuous Background Re-crawling:** Student deadlines change constantly—organizers extend hackathon submissions by 48 hours or close job applications early due to high volume. Every 30 minutes, a `node-cron` background worker uses TinyFish to re-crawl saved opportunity pages.
* **Proactive In-App & Web Push Alerts:** If a date change is detected, Nudge notifies the student instantly via Web Push and banners in the active conversation and Opportunities view.
* **Immutable Confirmed Dates:** To preserve user trust, confirmed deadlines are **never silently overwritten**. The student is always given explicit control: `[Update to new date]` or `[Keep saved date]`.

#### 3. Live Opportunity Discovery (TinyFish Search API)
* **Natural Conversational Search:** Students can type naturally (*"Find upcoming AI hackathons"* or *"Search summer 2026 software internships"*) or open the **"🐟 Discover with TinyFish"** modal.
* **Real-Time Web Intelligence:** TinyFish Search queries the live web for active competitions and scholarships. Results are structured by the AI reasoning model and presented with 1-click tracking and verification.

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

- **Live URL:** [https://nudgeweb.up.railway.app/](https://nudgeweb.up.railway.app/)
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

Nudge Copilot includes 43 automated tests covering TinyFish Fetch & Search, SSRF validation, prompt injection resistance, deadline monitoring, Gemma 4 AI parsing, date math, duplicate detection, and guest isolation.

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

* **Live Domain:** [https://nudgeweb.up.railway.app/](https://nudgeweb.up.railway.app/)
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
