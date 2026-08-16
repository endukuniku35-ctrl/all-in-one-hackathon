# ⚙ HackTrack | Synora'26 — 2-Round Hackathon Management & Evaluation Platform

**HackTrack** is a responsive static frontend application engineered for **Synora'26**, featuring:
- **Organizer-Only Team Registration** generating **Cryptographically Strong QR Passes**.
- **Dynamic Team QR Web Portal ([`team-portal.html`](file:///c:/Users/ADMIN/Downloads/hackathon%20all%20in%20one/team-portal.html))**: Scanned by students to view team roster, and upon problem statement release by organizers/admin, unlocks a **One-Time Problem Statement Submission Form**.
- **One-Time Submission Lock**: Once submitted by the team, problem statement & project details are permanently locked for the team. Only logged-in Admins and Organizers can edit team details through their dashboards.
- **2 Independent Judging Rounds (100 Marks Each, Total 200 Marks)**:
  - **Round 1 (Innovation, Pitch & Ideation)**: 100 Marks (4 criteria × 25 marks).
  - **Round 2 (Prototype, Implementation & Demo)**: 100 Marks (4 criteria × 25 marks).
  - **Grand Total**: 200 Marks.
  - Rounds are **by default locked** until toggled active by Admin/Organizer.
- **Strict Duplicate Evaluation Rule**: Composite key check (`JudgeID + TeamID + Round`). One judge can submit only ONE score per team per round.
- **Primary Data Store**: Google Sheets via Google Apps Script Web App API (`Code.gs`).

---

## 🏗 Architecture & Data Flow

```text
Team Registers (Organizer Desk Only)
              ↓
Generates Strong Cryptographic QR Token (HT26-SEC-HT2026xxx)
              ↓
User Scans QR → Opens Live Dynamic Team Portal (team-portal.html)
              ↓
[Pre-Release State]: Displays Verified Team & Member Roster Only
              ↓
Admin/Organizer Releases Problem Statements Phase
              ↓
[Released State]: Dynamic QR Portal Unlocks 1-Time Problem Statement Entry
              ↓
Team Submits → Permanently Locked for Team (Only Admin/Organizer can Edit)
              ↓
Admin Unlocks Round 1 & Round 2 (100 Marks Each)
              ↓
Judges Evaluate (100 Marks/Round) → Live Standings & Podium (200 Grand Total)
```

---

## ⚡ Instant Demo Credentials

Sign in directly using the 1-Click Quick Demo Login buttons on [`login.html`](file:///c:/Users/ADMIN/Downloads/hackathon%20all%20in%20one/login.html):

| Role | Email / Username | Password | Focus / Capabilities |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@synora.io` | `admin` | Full system access, workflow switches, winner locking (200 max), certificates, edit all teams |
| **Organizer** | `organizer@synora.io` | `admin` | Team onboarding, strong QR pass generation, optical camera scanner, edit all teams |
| **Judge 1** | `judge1@synora.io` | `admin` | Prof. Alan Turing (*AI/ML & Deep Learning*) |
| **Judge 2** | `judge2@synora.io` | `admin` | Dr. Grace Hopper (*Cloud & Distributed Systems*) |
| **Judge 3** | `judge3@synora.io` | `admin` | Prof. Ada Lovelace (*Cyber Security & Cryptography*) |

---

## 🚀 Google Sheets & Apps Script Setup

1. Open [Google Sheets](https://sheets.new) and create a new spreadsheet.
2. Click **Extensions** → **Apps Script**.
3. Copy and paste the contents of [`Code.gs`](file:///c:/Users/ADMIN/Downloads/hackathon%20all%20in%20one/Code.gs).
4. Run `initDatabase()` to create the 2-round schema tabs:
   - `Users`, `Teams`, `Attendance`, `Round1_Evaluations`, `Round2_Evaluations`, `RoundConfig`, `Leaderboard`, `Certificates`, `ActivityLogs`, `Settings`.
5. Click **Deploy** → **New deployment** → **Web app** (`Execute as: Me`, `Who has access: Anyone`).
6. Copy your Web App URL and paste it into `CONFIG.API_URL` in [`js/config.js`](file:///c:/Users/ADMIN/Downloads/hackathon%20all%20in%20one/js/config.js).
