# ⚙️ HackTrack | Synora'26 — Enterprise Digital Hackathon Operating System

**HackTrack** is an enterprise-grade, full-lifecycle digital hackathon management, judging, and verification platform built for **Synora'26**. It orchestrates the entire hackathon workflow—from organizer team onboarding and cryptographic QR attendance check-in, to one-time project locking, 2-round multi-criteria jury scoring (200 marks total), real-time auditorium projector broadcasting, automated certificate generation, and public credential verification.

---

## 📑 Table of Contents
1. [Core Pillars & System Architecture](#-core-pillars--system-architecture)
2. [Role-Based Portals & Capabilities](#-role-based-portals--capabilities)
3. [2-Round Judging Architecture & Tie-Breaker Engine](#-2-round-judging-architecture--tie-breaker-engine)
4. [Security, Session & Authorization Model](#-security-session--authorization-model)
5. [Event Lifecycle State Machine](#-event-lifecycle-state-machine)
6. [Repository File Map](#-repository-file-map)
7. [Google Apps Script Backend & Cloud Setup](#-google-apps-script-backend--cloud-setup)
8. [REST API Documentation](#-rest-api-documentation)
9. [Public Credential Verification](#-public-credential-verification)
10. [Automated Verification & Test Cases](#-automated-verification--test-cases)

---

## 🏗 Core Pillars & System Architecture

```text
                                  ┌──────────────────────────────────────────────┐
                                  │            HACKTRACK CENTRAL HUB             │
                                  │   (Unified UI Design System + Role Guard)    │
                                  └──────────────────────┬───────────────────────┘
                                                         │
         ┌─────────────────────────┬─────────────────────┴───────────────┬─────────────────────────┐
         ▼                         ▼                                     ▼                         ▼
┌──────────────────┐     ┌──────────────────┐                  ┌──────────────────┐      ┌──────────────────┐
│   SUPER ADMIN    │     │  ORGANIZER DESK  │                  │    JURY PANEL    │      │   TEAM COMMAND   │
│ (System & Judge  │     │ (Onboarding & QR │                  │ (Assigned Teams, │      │      CENTER      │
│  Allocation)     │     │   Check-in)      │                  │  200-Mark Jury)  │      │ (Progress Pass)  │
└────────┬─────────┘     └────────┬─────────┘                  └────────┬─────────┘      └────────┬─────────┘
         │                        │                                     │                         │
         └────────────────────────┼─────────────────────────────────────┼─────────────────────────┘
                                  ▼
                     ┌──────────────────────────┐
                     │ Google Apps Script API   │ ◄── [Server Validation, RBAC & Composite Key Guards]
                     └────────────┬─────────────┘
                                  ▼
                     ┌──────────────────────────┐
                     │ Google Sheets Database   │
                     │ (12 Synchronized Tables) │
                     └──────────────────────────┘
```

---

## 👑 Role-Based Portals & Capabilities

### 1. 👑 Super Admin Command Center (`admin/`)
- **System Dashboard (`admin/dashboard.html`)**: Real-time KPI statistics across registrations, attendance rate, completed evaluations, and leaderboard status.
- **Judge-to-Team Allocation Matrix (`admin/judge-assignment.html`)**: Workload-balancing matrix to route designated judges to specific teams or innovation domain tracks.
- **Scoring Analytics (`admin/analytics.html`)**: Interactive Chart.js visualizations covering R1 vs R2 distributions, domain cohort shares, 4-criterion radar mastery profiles, and score histograms.
- **Winner Declaration & Podium Lock (`admin/leaderboard.html`)**: Multi-tier tie-breaker engine, podium generation (1st Gold 🥇, 2nd Silver 🥈, 3rd Bronze 🥉), and score freeze.
- **Certificate Issuance Engine (`admin/certificates.html`)**: Batch-releases verifiable certificates to all team members with 1 click.
- **Immutable Audit Trail (`admin/activity-logs.html`)**: Real-time chronological audit logging of all system actions.

### 2. ⚙️ Organizer Operations Desk (`organizer/`)
- **Team Onboarding (`organizer/register-team.html`)**: Organizers register teams, validate member rosters, and generate 128-bit cryptographic QR passes.
- **Optical & Manual Attendance Terminal (`organizer/scan-qr.html`)**: Optical camera viewfinder with sound effects and instant duplicate check-in detection.
- **Event Phase Control (`organizer/rounds.html`)**: Toggle Problem Statement Release Phase, Round 1 Scoring, and Round 2 Scoring.

### 3. ⚖️ Jury Scoring Terminal (`judge/`)
- **Assigned Cohort Matrix (`judge/dashboard.html`)**: Judges only see teams assigned to their jury track.
- **Team Dossier Quick View (`judge/evaluate.html`)**: 1-click links to inspect team's GitHub repository, live web demo, and pitch deck during evaluation.
- **Multi-Criteria Scoring Sliders (100 Marks/Round)**: 4 criteria (25 marks each) with instant total computation.
- **Composite Key Duplicate Guard (`JudgeID + TeamID + Round`)**: Server strictly prevents double scoring.

### 4. 👥 Team Command Center (`team-portal.html`)
- **Dynamic Hackathon Progress Pipeline**: Visual state tracker:
  `Registration ✓` ➔ `Attendance QR Check-in ✓` ➔ `Problem Statement Release ✓` ➔ `Project Submission (GitHub, Demo, Tech Stack) ✓` ➔ `Round 1 Pitch (100) ⏳` ➔ `Round 2 Demo (100) 🔒` ➔ `Final Result & Certificate 🎓`
- **One-Time Submission Form**: Domain, project title, tailored problem statement, GitHub repository URL, and live demo link. Permanently locked in Google Cloud upon submission.
- **Live Score Breakdown**: Criterion-wise marks breakdown for Round 1, Round 2, and Grand Total (/200) once published.

### 5. 📺 Live Projector Screen ("Live Event Mode" — `projector.html`)
- Fullscreen auditorium stage display designed for big screens with animated podiums (🥇 Gold, 🥈 Silver, 🥉 Bronze) and 10-second auto-refreshing live score ticker.

---

## 🎯 2-Round Judging Architecture & Tie-Breaker Engine

Scoring is partitioned into **two independent 100-mark rounds (200 marks grand total)**:

### Round 1: Innovation, Pitch & Ideation (100 Marks Max)
1. **Innovation & Originality** (`25 Marks`): Novelty, uniqueness, and creativity of the proposed solution.
2. **Problem Understanding & Research** (`25 Marks`): Depth of root-cause framing and domain analysis.
3. **Concept Feasibility & Utility** (`25 Marks`): Practical viability, user value, and real-world relevance.
4. **Pitch & Presentation Quality** (`25 Marks`): Clarity, technical communication, and Q&A handling.

### Round 2: Prototype, Technical Implementation & Live Demo (100 Marks Max)
1. **Technical Implementation & Architecture** (`25 Marks`): Code quality, robustness, scalability, and stack execution.
2. **Prototype Completeness & UX** (`25 Marks`): Degree of completion, functional user flows, and interface polish.
3. **Core Feature Functionality** (`25 Marks`): Execution of required user stories and constraint solving.
4. **Working Live Demonstration** (`25 Marks`): Flawless live execution, resilience, and scale potential.

### Multi-Judge Score Averaging & Tie-Breakers:
$$\text{Round 1 Score} = \frac{\sum \text{Judge Scores in Round 1}}{\text{Number of R1 Judges}}$$
$$\text{Round 2 Score} = \frac{\sum \text{Judge Scores in Round 2}}{\text{Number of R2 Judges}}$$
$$\text{Grand Total} = \text{Round 1 Score} + \text{Round 2 Score} \quad (\text{Max 200.00 Marks})$$

**Multi-Tier Tie-Breaker Resolution**:
1. **1st Priority**: Highest Grand Total score (/200).
2. **2nd Priority**: Highest Round 2 Working Prototype & Demo score (/100).
3. **3rd Priority**: Highest Round 1 Innovation & Pitch score (/100).
4. **4th Priority**: Alphabetical order by Team Name.

---

## 🔒 Security, Session & Authorization Model

1. **SHA-256 Password Hashes**: Credentials stored strictly as cryptographic SHA-256 digests (`Utilities.computeDigest`).
2. **24-Hour Server-Side Session Tokens**: Successful logins return a cryptographically generated session ID (`SES-UUID`) stored in the `Sessions` Google Sheet and verified per request.
3. **Strict Non-Fallthrough Login**: Unregistered or invalid credentials return `INVALID_CREDENTIALS` (no fallback admin accounts).
4. **Server-Side One-Time Submission Enforcement**: `submitTeamProblemDetails` checks `if (SubmissionLocked) throw SUBMISSION_LOCKED`.
5. **Composite Key Duplicate Protection**: `submitEvaluation` validates `JudgeID + TeamID + Round` before inserting rows.
6. **Server-Side Range Bounds**: Validates `0 <= mark <= 25` per criterion and `total <= 100`.
7. **128-Bit Cryptographic QR Passes**: QR badges contain secure 128-bit UUID tokens (`HT26-SEC-HT2026001-A8F73D9C4E2B1A0F`).
8. **XSS Protection**: `escapeHtml()` sanitization across all dynamic HTML renderers.
9. **Zero-PII Public Verification**: `verify.html` returns only public credential attributes without leaking emails, phone numbers, or scoring sheets.

---

## 🔄 Event Lifecycle State Machine

```text
┌─────────────────────────┐
│     1. REGISTRATION     │ Organizer registers teams & generates 128-bit crypto QR badges.
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  2. ATTENDANCE CHECK-IN │ Optical scanner verifies team passes & registers timestamps.
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 3. PROBLEM STMT RELEASE │ Admin unlocks problem statement phase; teams submit & lock projects.
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  4. ROUND 1 EVALUATION  │ Jury scores Innovation & Pitch (100 Marks Max); scores locked.
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  5. ROUND 2 EVALUATION  │ Jury scores Prototype & Demo (100 Marks Max); scores locked.
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│   6. WINNER LOCKING     │ Admin declares winners with multi-tier tie-breakers; scores freeze.
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│ 7. CERTIFICATES & VERIFY│ Batch-generates verifiable certificates with public verification portal.
└─────────────────────────┘
```

---

## 📁 Repository File Map

```text
hacktrack-synora26/
├── index.html                   # Central Hub, stats counter, certificate search & launchpad
├── login.html                   # Secure authentication portal with session generation
├── team-portal.html             # Team Command Center with Progress Pipeline & One-Time Submission
├── certificate.html             # Official printable landscape certificate template
├── verify.html                  # Public Certificate Authenticity Verification Portal
├── projector.html               # Live Event Mode: Fullscreen auditorium stage podium & ticker
├── Code.gs                      # Production Google Apps Script backend engine & API router
│
├── admin/                       # 👑 Super Admin Portal
│   ├── dashboard.html           # Master overview, event stats, and quick toggles
│   ├── analytics.html           # Chart.js visualizations (bar, doughnut, radar, histogram)
│   ├── judge-assignment.html    # Interactive Judge-to-Team Workload Matrix
│   ├── teams.html               # Team directory with edit/delete/unlock controls
│   ├── users.html               # User accounts management (Admins, Organizers, Judges)
│   ├── attendance.html          # Live attendance registry and check-in timeline
│   ├── leaderboard.html         # Live standings, tie-breaker calculator, and winner declaration
│   ├── certificates.html        # Certificate release controller & previewer
│   └── activity-logs.html       # Real-time immutable audit trail
│
├── organizer/                   # ⚙️ Organizer Event Desk
│   ├── dashboard.html           # Operations desk overview & check-in metrics
│   ├── register-team.html       # Team onboarding form with instant QR generation
│   ├── scan-qr.html             # Optical camera scanner & manual check-in terminal
│   ├── teams.html               # Organizer team directory & dossier viewer
│   └── rounds.html              # Event phase switches (Problem Stmts, Round 1, Round 2)
│
├── judge/                       # ⚖️ Jury Scoring Panel
│   ├── dashboard.html           # Assigned team matrix & evaluation status
│   ├── evaluate.html            # 100-mark scoring sliders with GitHub/Demo dossier links
│   └── team-details.html        # Detailed team dossier and problem statement view
│
├── js/                          # 🧠 Core Client Logic
│   ├── config.js                # App configuration, active API URL, and mode settings
│   ├── api.js                   # Unified API client with automatic session token attachment
│   ├── auth.js                  # Client-side session management & route guards
│   ├── utils.js                 # QR code renderers, toast alerts, theme switcher
│   ├── judge.js                 # Jury scoring engine & assigned cohort filtering
│   ├── admin.js                 # Admin management, analytics charts & winner locking
│   ├── attendance.js            # QR scanning, duplicate check-in prevention, audio chimes
│   ├── certificates.js          # Certificate rendering & batch issuance helpers
│   └── demo-data.js             # Initial schema seeds and fallback sandbox data
│
└── css/                         # 🎨 Design System
    ├── style.css                # Core design tokens, CSS variables, typography
    ├── dashboard.css            # Sidebar layouts, KPI stat cards, headers
    ├── forms.css                # Input controls, custom sliders, submit buttons
    ├── tables.css               # Data grids, responsive tables, badge tags
    └── responsive.css           # Mobile breakpoints and responsive navigation
```

---

## ⚙️ First-Run Setup & Credential Policy

> **No hardcoded credentials are distributed.** Seeded accounts use the default password `admin`. The system detects this on first login and sets a `mustChangePassword: true` flag in the login response, prompting immediate credential rotation.

**First-Run Checklist:**
1. Run `initDatabase()` in Apps Script to seed the schema with SHA-256-hashed default accounts.
2. Log in → the API will return `{ mustChangePassword: true }` if using a default password.
3. Call `changePassword` immediately with your new 8+ character password.
4. All other active sessions for your account are automatically invalidated on password change.

**Default seed email mapping** (all use password `admin` — change immediately):

| Role | Email | First-Login Action |
| :--- | :--- | :--- |
| Super Admin | `admin@synora.io` | **Change password before any event operations** |
| Organizer | `organizer@synora.io` | Change password before team registration |
| Judge 1–3 | `judge1–3@synora.io` | Change password before scoring begins |

> **Do not use default passwords on a live event. Run `initDatabase()`, log in, and change all passwords before the hackathon begins.**

---

## 🚀 Google Apps Script Backend & Cloud Setup

1. Open [Google Sheets](https://sheets.new) and create a blank spreadsheet named `HackTrack Synora'26 Database`.
2. In the menu, click **Extensions ➔ Apps Script**.
3. Replace all code in the editor with the contents of [`Code.gs`](file:///c:/Users/ADMIN/Downloads/hackathon%20all%20in%20one/Code.gs).
4. Run `initDatabase()` to create the database schema:
   - `Users`, `Sessions`, `Teams`, `Attendance`, `JudgeAssignments`, `Round1_Evaluations`, `Round2_Evaluations`, `RoundConfig`, `Leaderboard`, `Certificates`, `ActivityLogs`, `Settings`.
5. Click **Deploy ➔ New deployment**:
   - **Type**: `Web app`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
6. Copy the generated Web App URL and update `CONFIG.API_URL` in [`js/config.js`](file:///c:/Users/ADMIN/Downloads/hackathon%20all%20in%20one/js/config.js).

---

## 📡 REST API Documentation

All POST requests receive payload in JSON format:
```http
POST https://script.google.com/macros/s/.../exec
Content-Type: text/plain;charset=utf-8
```

### 1. User Authentication (`login`)
```json
{
  "action": "login",
  "email": "admin@synora.io",
  "password": "admin",
  "role": "admin"
}
```
**Response**:
```json
{
  "success": true,
  "data": {
    "sessionId": "SES-8f1dcd9f-d064-4f40-9106-879a541113d2",
    "userId": "USR-ADM-01",
    "name": "Super Administrator",
    "email": "admin@synora.io",
    "role": "admin",
    "expiresAt": "2026-08-17 09:02:10"
  }
}
```

### 2. Submit Evaluation (`submitEvaluation`)
```json
{
  "action": "submitEvaluation",
  "sessionId": "SES-8f1dcd9f...",
  "round": "round1",
  "judgeId": "USR-JDG-01",
  "judgeName": "Prof. Alan Turing",
  "teamId": "HT2026001",
  "teamName": "Neural Ninjas",
  "c1": 24.5,
  "c2": 23.0,
  "c3": 25.0,
  "c4": 24.0,
  "comments": "Excellent root-cause architecture and clear technical pitch."
}
```

### 3. Error Response Standard
```json
{
  "success": false,
  "error": "DUPLICATE_EVALUATION: You have already evaluated team HT2026001 for ROUND1. (Evaluation ID: EV-ROUND1-001)"
}
```

---

## 🛡️ Public Credential Verification

Anyone scanning a certificate QR code or navigating to `verify.html?id=SYNORA26-W1-0001` receives instant validation:

```text
┌────────────────────────────────────────────────────────────┐
│  ✓ OFFICIAL VERIFIED CREDENTIAL                            │
│  Certificate ID: SYNORA26-W1-0001                          │
├────────────────────────────────────────────────────────────┤
│  Recipient: Rahul Sharma (Team Leader)                     │
│  Team Name: Neural Ninjas (HT2026001)                      │
│  Institution: Indian Institute of Technology               │
│  Project: "Autonomous Oncology Vision Anomaly Detector"    │
│  Achievement: 1st Place Winner (Gold 🥇)                   │
│  Issuing Body: Synora Council of Technology & Innovation   │
│  Status: VALID & CRYPTOGRAPHICALLY AUTHENTIC               │
└────────────────────────────────────────────────────────────┘
```

---

## 🧪 Automated Verification & Test Cases

| Scenario | Input / Action | Expected Behavior |
| :--- | :--- | :--- |
| **Invalid Login** | Unregistered email or bad password | Throws `INVALID_CREDENTIALS`. Never returns admin. |
| **Team 404** | `teamId: "INVALID_999"` | Throws `TEAM_NOT_FOUND`. Never returns `teams[0]`. |
| **Score Clamping** | `c1: 30` (Exceeds 25 limit) | Throws `INVALID_SCORE: Mark must be between 0 and 25.` |
| **Duplicate Judging** | Resubmit score for same team & round | Throws `DUPLICATE_EVALUATION` error code. |
| **One-Time Submission** | Edit project after initial locking | Throws `SUBMISSION_LOCKED`. Modification rejected. |
| **Closed Round Scoring** | Submit score when round is locked | Throws `ROUND_LOCKED: Judging round is locked.` |
| **Tie-Breaker Calculation** | Teams with identical total scores | Higher Round 2 Prototype score wins tie-break. |
| **Public Verification** | Verify valid certificate ID | Displays authentic credential without leaking PII. |

---

## 📄 License & Ownership
Engineered for **Synora'26 National Flagship Hackathon** by the Synora Innovation & Technology Council.  
Licensed under the **MIT License**.
