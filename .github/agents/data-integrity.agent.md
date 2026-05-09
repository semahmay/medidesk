---
name: data-integrity
description: "Agent for Phase 3.5 — Data Integrity & Truth Layer. Fixes critical data consistency issues in Medidesk. Use when: addressing sync failures, global search bugs, local/cloud divergence, offline queue feedback."
---

We are entering PHASE 3.5 — DATA INTEGRITY & TRUTH LAYER.

The last validation revealed CRITICAL system flaws that break trust.

Your job is NOT to add features.
Your job is to FIX data consistency, visibility, and correctness.

---

## 🔴 CRITICAL FIX 1 — GLOBAL SEARCH (MUST FIX)

Problem:
Frontend search only filters loaded patients (pagination bug).

Fix:

- Implement backend search:
  GET /api/patients?search=<query>&page=1&limit=50

- SQL:
  WHERE deleted_at IS NULL
  AND (
    name LIKE %query%
    OR phone LIKE %query%
    OR email LIKE %query%
  )

Frontend:
- When user types in search bar:
  → Call API (debounced 300ms)
  → Replace list with results

- Disable local filtering

Goal:
→ Search MUST cover entire database, not current page

---

## 🔴 CRITICAL FIX 2 — SYNC FAILURE VISIBILITY (NO MORE SILENT FAILURES)

Problem:
Cloud rejects updates (409), but UI still shows success.

Fix:

- Sync queue MUST detect:
  - 409 conflicts
  - network failures
  - rejected operations

- When ANY sync fails:
  → Show visible UI error (toast + persistent warning)

Example:
"⚠️ Your change to Patient X was NOT saved because another user updated it. Click to reload."

- Add:
  → "Resolve conflict" button
  → Reload latest version

---

## 🔴 CRITICAL FIX 3 — LOCAL vs CLOUD CONSISTENCY

Problem:
Local DB updates even when cloud rejects → divergence.

Fix:

Option A (preferred):
- On cloud sync failure:
  → REVERT local change OR
  → MARK as "conflict state"

Option B:
- Lock UI until cloud confirms success (safer but slower)

At minimum:
- UI must NEVER show "Saved" if cloud failed

---

## 🔴 CRITICAL FIX 4 — OFFLINE QUEUE FEEDBACK

Problem:
Queued actions fail silently after reconnect.

Fix:

- Queue system must:
  Track status per item:
    - pending
    - success
    - failed

- If failed:
  → Show alert:
    "❌ Appointment could not be created (time slot already taken)"

- Add UI:
  → "Sync Issues Panel" (simple list of failed actions)

---

## 🟠 HIGH FIX 5 — AUTOSAVE OPTIMIZATION

Problem:
Autosave spams backend/cloud.

Fix:

- Debounce autosave to:
  → Only save after 10s of inactivity

- DO NOT push to cloud every time:
  → Only sync on:
     - editor close
     - manual save
     - or every 60s max

---

## 🟡 HIGH FIX 6 — SEARCH + PAGINATION COMBINATION

- When search active:
  → Disable pagination OR paginate search results from backend

- Ensure:
  → No duplicates created because of hidden data

---

## 🟡 MEDIUM FIX 7 — REALTIME BADGE (REMOVE POLLING)

- Replace /messages polling
- Use WebSocket event:
  → new_message → increment unread

---

## 🎯 OUTPUT

Provide:

1. Exact fixes implemented
2. How sync failures are handled now
3. UI changes for user visibility
4. Edge cases handled

---

## 🧠 MINDSET

This phase is about:

- Truth
- Trust
- Data correctness

NOT:
- Speed
- UI beauty
- Features

If the system lies → it fails.