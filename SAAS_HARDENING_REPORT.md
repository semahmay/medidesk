# SaaS Hardening and Data Integrity Fixes

## Summary
Implemented backend and frontend hardening consistent with multi-tenant, SaaS-ready architecture while preserving existing offline compatibility.

## What changed

### Backend (`cloud-backend`)
- Added `deleted_at` to `Patient` model and transitioned patient deletion to soft delete.
- Added dedicated `GET /api/patients/search?q=...` endpoint for full DB patient search within the current clinic.
- Enforced strict clinic isolation in search and patient update flows using `g.clinic_id`.
- Added version-based conflict support with `force` override in both `PUT /api/patients/by-global/<global_id>` and `PUT /api/patients/<patient_id>`.
- Emitted `sync_failed` events on version conflicts so the frontend can react in real time.
- Added additional PostgreSQL search/indexing support in `cloud-backend/database.py`.

### Frontend (`medidesk-ai/frontend`)
- Connected global realtime WebSocket support in `App.jsx` for SaaS web mode.
- Removed polling from `TopBar.jsx` and switched notification/unread updates to realtime `notification_new` and `message_new` events.
- Replaced chat polling in `ClinicChat.jsx` with realtime event subscription.
- Removed Sync Center polling in `SyncCenter.jsx`; it now refreshes from local queue/error events.
- Added event hooks to `patientSyncService.js` and `syncErrorQueue.js` so sync queue and failed error state updates drive the UI instead of timed polling.

## Validation
- Verified modified backend files: `cloud-backend/app.py`, `cloud-backend/models.py`, `cloud-backend/database.py`.
- Verified modified frontend files: `medidesk-ai/frontend/src/App.jsx`, `medidesk-ai/frontend/src/components/TopBar.jsx`, `medidesk-ai/frontend/src/pages/ClinicChat.jsx`, `medidesk-ai/frontend/src/components/SyncCenter.jsx`.
- No syntax or static errors reported in the touched files.

## Notes
- The system now supports better clinic isolation, explicit conflict handling, and event-driven updates for notifications and chat.
- The existing local offline queue remains compatible, while SaaS web mode now uses realtime client subscriptions instead of REST polling.
