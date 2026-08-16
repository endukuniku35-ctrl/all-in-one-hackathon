/**
 * HackTrack | Synora'26 Configuration
 * 2-Round Hackathon Judging & Evaluation Architecture (100 Marks Each, Total 200)
 */

const CONFIG = {
  APP_NAME: "HackTrack",
  EVENT_NAME: "Synora'26",
  EVENT_SUBTITLE: "National Level 36-Hour Flagship Hackathon",
  EDITION: "2026",
  VERSION: "3.0.0",
  ORGANIZATION: "Synora Innovation & Tech Council",
  
  // Mode: "production" enforces Google Apps Script API calls; "development" allows local sandbox
  MODE: "production",

  // Google Apps Script Web App API URL
  API_URL: "https://script.google.com/macros/s/AKfycby9seIb7uRuzTOq3SP0ImVY2AFYJJyBWhZxTqKjttrKgRFzIoqatOWZwwF9DANPTY7o/exec", // Live Google Cloud API

  // Exactly Two Independent Judging Rounds (100 Marks Each, Total 200)
  ROUNDS: {
    ROUND_1: {
      id: "round1",
      name: "Round 1 – Innovation, Pitch & Problem Understanding",
      shortName: "Round 1",
      maxMarks: 100,
      criteria: [
        { id: "c1", name: "Innovation & Originality", max: 25, desc: "Novelty, uniqueness and creativity of proposed solution" },
        { id: "c2", name: "Problem Understanding & Research", max: 25, desc: "Depth of root-cause framing and domain analysis" },
        { id: "c3", name: "Concept Feasibility & Utility", max: 25, desc: "Practical viability, user value and real-world relevance" },
        { id: "c4", name: "Pitch & Presentation Quality", max: 25, desc: "Clarity, technical communication, and Q&A handling" }
      ]
    },
    ROUND_2: {
      id: "round2",
      name: "Round 2 – Prototype, Technical Implementation & Demo",
      shortName: "Round 2",
      maxMarks: 100,
      criteria: [
        { id: "c1", name: "Technical Implementation & Architecture", max: 25, desc: "Code quality, robustness, scalability and tech stack execution" },
        { id: "c2", name: "Prototype Completeness & UX", max: 25, desc: "Degree of completion, functional user flows and interface polish" },
        { id: "c3", name: "Core Feature Functionality", max: 25, desc: "Execution of required user stories and constraint solving" },
        { id: "c4", name: "Working Live Demonstration", max: 25, desc: "Flawless live execution, resilience, and scale potential" }
      ]
    }
  },

  DOMAINS: [
    "AI/ML",
    "Agriculture & ML",
    "Cloud & DevOps",
    "Cryptography & Web3",
    "Cyber Security",
    "Healthcare & Blockchain",
    "Mobile Development",
    "Web Development",
    "IoT & Smart Hardware",
    "FinTech & Open Banking"
  ],

  SAMPLE_PROBLEM_STATEMENTS: [
    { id: "PS-AI-01", domain: "AI/ML", title: "Edge Vision Anomaly Detection for Medical Imagery" },
    { id: "PS-CY-02", domain: "Cyber Security", title: "Post-Quantum Cryptographic Identity & Microservices Gate" },
    { id: "PS-AG-03", domain: "Agriculture & ML", title: "Autonomous Soil Spectrometry & Nitrogen Depletion Mapping" },
    { id: "PS-HC-04", domain: "Healthcare & Blockchain", title: "Privacy-Preserving Clinical Trial Data Verification via zk-SNARKs" },
    { id: "PS-FT-05", domain: "FinTech & Open Banking", title: "Real-Time Graph Anomaly Filtering on High-Frequency Financial Streams" },
    { id: "PS-IOT-06", domain: "IoT & Smart Hardware", title: "Self-Healing LoRaWAN Microgrid Grid Sensor Mesh" },
    { id: "PS-CD-07", domain: "Cloud & DevOps", title: "AI-Driven Autonomous Resilience & Chaos Engineering Operator" },
    { id: "PS-WD-08", domain: "Web Development", title: "Sub-Millisecond Collaborative Canvas with WASM & CRDTs" }
  ],

  STORAGE_KEYS: {
    USERS: "ht_users",
    TEAMS: "ht_teams",
    ATTENDANCE: "ht_attendance",
    EVALUATIONS_R1: "ht_eval_r1",
    EVALUATIONS_R2: "ht_eval_r2",
    ROUND_CONFIG: "ht_round_config",
    LEADERBOARD: "ht_leaderboard",
    CERTIFICATES: "ht_certificates",
    ACTIVITY_LOGS: "ht_activity_logs",
    SETTINGS: "ht_settings",
    SESSION: "ht_session",
    THEME: "ht_theme"
  }
};

if (typeof window !== "undefined") {
  window.CONFIG = CONFIG;
}
