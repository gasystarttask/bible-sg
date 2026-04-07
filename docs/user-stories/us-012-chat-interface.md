# User Story: US-012 - Chat Interface & Citations

**As a** Scholar/User,  
**I want to** interact with a clean chat interface that highlights biblical sources,  
**So that** I can verify the AI's claims against the original sacred text.

---

## 🎯 Acceptance Criteria

- [x] **Streaming UI:** Implement real-time response streaming using Vercel AI SDK's `useChat`.
- [x] **Interactive Citations:** Automatically turn text like `(Gen 12:1)` into clickable components.
- [x] **Source Preview:** Show the full verse text in a side panel or tooltip when a citation is clicked.

---

## 🛠️ Technical Notes

* **Frontend:** Next.js 14, Tailwind CSS, and `framer-motion` for smooth transitions.
* **Citations:** Regex-based parsing on the frontend to map `book_id.chapter.verse` to database lookups.

---

## 🧪 Definition of Done (DoD)

1. The user can see the AI typing in real-time.
2. Clicking a citation opens a modal/panel with the correct French text from the Louis Segond version.
3. Mobile responsiveness is verified (no horizontal scrolling).

---

**Priority:** High  
**Estimation:** 8 Story Points  
**Status:** ✅ `done`