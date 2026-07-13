# MediDesk Feature Audit Report
**Date:** July 11, 2026  
**Scope:** Full frontend feature verification after UI/UX redesign, dark mode, and i18n implementation

---

## ✅ Working Features

### Authentication
- **Login (Doctor):** `JoinClinic.jsx` → `window.electronAPI.startLogin()` → `applySession()` → `setCloudTokens` + `setUserId` + `setSession` → `onJoined()`. Fully connected.
- **Login (Secretary):** 3-step flow (check → set-password or login) via `axios.post` to `/auth/secretary/check`, `/auth/secretary/set-password`, `/auth/secretary/login`. All steps correctly connected.
- **Logout:** `TopBar.jsx` → `handleLogout` → `window.electronAPI.logout()`. Connected.
- **Session persistence:** `App.jsx` reads session on startup from `window.electronAPI.getSession()`, writes to `_session` in-memory store. `useClinicSession.js` re-exports `getSession`/`setSession` from `App.jsx`. Correctly wired.
- **Role handling:** `isDoctor`, `isSecretary`, `isAdmin` from `utils/roleUtils` used correctly in all pages. Doctor-only routes guarded in `App.jsx`. Secretary mode conditionally disables features in `Dashboard-New.jsx` and `PatientDetail.jsx`.

### Patients
- **Patient list:** `PatientList.jsx` renders `PatientTable` with all required props. `fetchCloudPatients` called in `Dashboard-New.jsx`. Pagination via `onLoadMore` → `setPage` → `fetchPatients`. All connected.
- **Search:** `searchTerm` → debounced to `debouncedSearch` (300ms) → triggers `fetchPatients` via `useEffect`. Connected.
- **Add patient:** FAB and `onAddPatient` both set `showPatientForm=true`. `PatientForm` opens with `patient=null`. Save → `cloudApi.post('/patients')` → `onSave()` → `fetchPatients()`. Connected.
- **Edit patient:** `handleEditPatient` sets `editingPatient` + `showPatientForm=true`. `PatientForm` receives `patient` prop, fills form data, submits to `updateCloudPatient`. Connected.
- **Delete patient:** `handleDeletePatient` → `setDeleteConfirm(id)` → `ConfirmModal` opens → `confirmDeletePatient` → `deleteCloudPatient` → `fetchPatients`. Connected.
- **Duplicate detection:** `PatientForm` debounces on name/phone changes → `GET /patients/duplicates` → `DuplicateCheckModal` if duplicates found. `handleOpenDuplicate` and `handleCreateAnyway` both correctly connected.
- **Patient details (Overview):** Info rows, Voice Recording, AI Assistant all rendered correctly inside `PatientDetail`. Tab switch via `setActiveTab`. Connected.
- **Timeline:** Built from `buildTimeline(patient, attachments, appointments)` in `PatientDetail`. No API call needed — uses loaded data. Connected.
- **Notes (view):** Displayed in Notes tab. `showNotesEditor` state opens `NotesEditor`. Connected.
- **Notes (edit):** `NotesEditor` → `updateCloudPatient` (doctor) or `secretaryCloudWrite` (secretary). Auto-save after 10s idle. Voice transcription appended inline. All connected.
- **Files:** `loadAttachments` → `GET /patients/{id}/attachments`. Upload via `cloudApi.post` with retry. Download via presigned URL or open endpoint. Delete via `cloudApi.delete('/attachments/{id}')`. All connected.
- **Voice recording (in PatientDetail):** `VoiceRecorder` → `onTranscriptionComplete` → `handleTranscriptionComplete` → `updateCloudPatient`. Connected.
- **AI summary (patient):** `AIChat` in patient detail Overview tab. Messages persisted to `localStorage` keyed by `patient.global_id || cloud_id || id`. Clear chat removes localStorage entry. `POST /chat` with `patient_context`. Connected.
- **Prescription generation:** `generatePrescription` → `POST /chat` with structured JSON prompt → parses response → editable `prescriptionData` → `printPrescription` opens print window. Connected.

### Voice Recording (standalone component)
- **Microphone permission:** `checkMicPermission()` on mount via `getUserMedia`. Fully implemented.
- **`getUserMedia()`:** Called in both `checkMicPermission` and `startRecording`. Connected.
- **`MediaRecorder`:** Created in `startRecording`, stored in `mediaRecorderRef`. `ondataavailable` pushes chunks. `onstop` creates Blob + URL. Connected.
- **Start/Stop/Pause/Resume recording:** All four handlers implemented and connected to buttons. Timer runs via `setInterval`. Connected.
- **Blob creation:** `new Blob(audioChunksRef.current, { type: 'audio/webm' })` in `mr.onstop`. Connected.
- **Upload/API call:** `transcribeAudio()` → `cloudApi.post('/transcribe', FormData)` with 60s timeout. On success calls `onTranscriptionComplete`. Connected.
- **Playback:** `<audio controls src={audioURL}>` rendered after stop. Connected.
- **Delete recording:** `clearRecording()` clears state. Connected.
- **Error handling:** Permission errors, network errors, and timeout all handled with `setError`. Connected.

### AI Chat (patient detail)
- **Open:** Renders inside patient detail Overview card when `doctorMode=true`.
- **Send message:** `handleSendMessage` → `POST /chat` → appends assistant response. `Enter` key triggers send. Connected.
- **Receive response:** Response appended to `messages` state. Typing dots shown while `loading=true`. Connected.
- **Persistence:** `useEffect` reads from `localStorage[storageKey]` on mount and when patient changes. Persists on every `messages` change. Connected.
- **Quick actions:** 4 pre-defined prompts, each calls `handleSendMessage`. Disabled while loading. Connected.
- **Clear chat:** Button appears when messages exist. Clears state and `localStorage`. Connected.

### Appointments
- **Calendar:** `AppointmentCalendar` receives `selectedDate`, `onDateSelect`, `appointments`, `onViewChange`. All props passed from `Appointments.jsx`. Connected.
- **Create:** "New appointment" button and FAB via `quick-add-appointment` event both set `showModal=true`. `AppointmentModal` → `createAppointment` → `onSave` → `reloadAll`. Connected.
- **Edit:** `handleReschedule` → `setEditingAppointment` + `setShowModal(true)`. Modal filled from `appointment` prop. `updateAppointment` called on submit. Connected.
- **Delete:** `handleDelete` → `setDeleteConfirm` → `ConfirmModal` → `confirmDelete` → `deleteAppointment` → `reloadAll`. Connected.
- **Status update:** "Complete" button → `handleStatusUpdate` → `updateAppointment(secretary, id, {...appt, status: newStatus})` → `reloadAll`. Connected.
- **Real-time updates:** `onRealtimeEvent('appointment_new')` and `appointment_updated` both call `reloadAll`. Connected.
- **Offline queue replay:** `online` event listener imports `replayApptQueue` dynamically and calls it. Connected.

### Notifications
- **Badge:** `unreadCount` state in `TopBar`, incremented by `notification_new` WebSocket event. `badge-dot` shown when `unreadCount > 0`. Connected.
- **Panel:** `showNotifPanel` toggle on bell click. `NotificationCenter` component rendered. Connected.
- **Mark read:** `PATCH /notifications/{id}/read` called in `onMarkRead` prop. Updates local state. Connected.
- **Mark all read:** `PATCH /notifications/read-all` called in `onMarkAllRead`. Updates local state. Connected.
- **Sound:** `useNotificationSound` hook. `playSound` called on new notification with type-specific sound. Connected.
- **Socket updates:** `onRealtimeEvent('notification_new')` appends to notifications list and increments unread. Connected.

### Sync
- **Sync status:** `TopBar` reads `pendingSync` from `getQueueCount()` and `failedSyncCount` from `getSyncErrors()`. `sync-pill` shows correct state. Connected.
- **Offline queue:** `patientSyncService` queues failed cloud calls. `replayQueue` called on app focus, online event, and 30s heartbeat in `AppInner`. Connected.
- **Conflict handling:** `ConflictMergeModal` rendered globally from `AppInner` when `conflictData` is set. `openConflict` called from `Dashboard-New` on conflict detection. Connected.
- **Sync badges:** `sync-pill` shows "Synced", "Syncing (N)", or "N issues" with correct CSS classes. Connected.
- **Sync Center:** `setShowSyncCenter(true)` in TopBar opens panel. Retry, conflict, and close all wired. Connected.

### File Upload
- **Upload:** `fileInputRef` → `handleFileSelect` → validates extension → `cloudApi.post('/patients/{id}/attachments', FormData)` with progress tracking. Retry on network error (3 retries). Connected.
- **Download:** `handleDownloadAttachment` → presigned URL or fallback endpoint → `window.open`. Connected.
- **Delete:** `handleDeleteAttachment` → `confirm()` → `cloudApi.delete('/attachments/{id}')` → removes from state. Connected.
- **Preview:** Opens URL in new tab via `window.open`. Connected.

### Modals
- `PatientForm`: Opens via `showPatientForm` state. Closes via `handlePatientFormClose`. Dirty-check before close via `ConfirmModal`. Conflict modal renders nested. All connected.
- `NotesEditor`: Opens via `showNotesEditor`. Closes via `onClose` prop. Connected.
- `AppointmentModal`: Opens via `showModal`. Closes via `onClose`. ESC key handler attached. Connected.
- `ConfirmModal`: Used for delete patient, delete appointment, delete column, close-with-changes. All correctly wired with `open`, `onConfirm`, `onCancel` props.
- `ConflictMergeModal`: Rendered globally in `AppInner` when `conflictData !== null`. Connected.
- `DuplicateCheckModal`: Rendered in `PatientForm` when `showDuplicateModal=true`. Connected.

### Navigation
- **All routes:** `/`, `/patients`, `/appointments`, `/clinic-chat`, `/medical-reference`, `/analytics`, `/operations` all registered in `App.jsx`. Doctor-only routes guarded. Connected.
- **Sidebar buttons:** All 6 nav items use `ROUTE_MAP` → `navigate(ROUTE_MAP[page])`. Connected.
- **TopBar actions:** Collapse toggle, clinic switch, sync center, dark mode, notifications, user menu — all connected.
- **Keyboard shortcuts:** Ctrl+N (add patient), Ctrl+F (search), Ctrl+1/2 (navigate), Ctrl+Shift+A (add appointment). All in `AppInner`. Connected.

### API
- All `cloudApi` calls use the configured `baseURL`. Auth header injected via interceptor in `cloudApi.js`. Token refresh handled. All API endpoints verified as still called correctly.

### Dark Mode
- `TopBar` sets `data-theme` on `<html>` and persists to `localStorage`. Theme applied on initial load via IIFE in `App.jsx`. `[data-theme="dark"]` CSS block in `design-system.css` covers all components.

### Language (EN/FR)
- `LanguageProvider` wraps the app. `setLanguage` from context updates `localStorage` and `<html lang>`. `Sidebar`, `DashboardPage`, `PatientList`, `PatientDetail`, `PatientForm`, `NotesEditor` all use `t()`. TopBar language pills call `setLanguage`.

---

## ⚠️ Potential Problems

### 1. `PatientForm` — `VoiceRecorder` imported but never rendered
**File:** `PatientForm.jsx`, line 4  
**Import:** `import VoiceRecorder from './VoiceRecorder'`  
The `handleTranscriptionComplete` handler is also defined but never used (notes voice transcription was in the form previously). No crash, but dead code.

### 2. `Dashboard-New.jsx` — `language` state is redundant
**File:** `Dashboard-New.jsx`  
`const [language, setLanguage] = useState(settings?.language || 'en')` is set via `handleLanguageChange` but never used — language is now managed by `LanguageContext`. No functional impact; dead state.

### 3. `NotesEditor` — shadowed `t` variable in auto-save effect
**File:** `NotesEditor.jsx`  
```js
const { t } = useLanguage(); // outer t = translation function
// ...
const t = setTimeout(() => handleSave(), 10000); // inner t shadows outer!
```
The auto-save `useEffect` uses `const t = setTimeout(...)` which **shadows** the outer `t` (the translation function). This does not break auto-save (it works), but if `t` is ever used inside that effect, it would fail silently.

### 4. `PatientDetail` — `pd.edit_notes` translation key defined but not used in the Notes tab card-head
The Notes tab's edit button uses `pd-card-btn--edit` CSS class with the label text, but the label text for the Notes tab edit button in `PatientDetail` uses hardcoded text rendered via `pd-card-btn--edit` class. The `pd.edit_notes` key exists in translations but the text is correctly applied through the `t('pd.edit_notes')` call — verified as connected.

### 5. `App.jsx` — `networkStatus` state declared but never read
`const [networkStatus, setNetworkStatus]` is set but the value is never consumed in the render. This is pre-existing, not a regression.

### 6. `Appointments.jsx` — `loadStats` is not a `useCallback`
`loadStats` is declared as a plain `async` function (not `useCallback`), so it's recreated every render. Since it's only called inside `reloadAll` (which IS a `useCallback`), the dependency array of `reloadAll` includes a reference to the unstable `loadStats`, which could cause unnecessary effect re-runs. This is a pre-existing issue, not a regression.

---

## ❌ Confirmed Regressions

### 1. `PatientForm` — VoiceRecorder section removed from form (Notes tab voice input)
**File:** `PatientForm.jsx`  
**Evidence:** `VoiceRecorder` is imported and `handleTranscriptionComplete` is defined, but no `<VoiceRecorder>` element is rendered anywhere in the form's JSX. The original form had a voice recording section at the bottom to append transcriptions to the notes field. This section was removed during the UI redesign.  
**Impact:** Users can no longer dictate notes directly inside the Add/Edit Patient form. The `handleTranscriptionComplete` function (which appends to `formData.notes`) is wired correctly but never called because the component isn't rendered.

### 2. `NotesEditor` — auto-save `useEffect` has shadowed `t` variable (silent variable collision)
**File:** `NotesEditor.jsx`  
```js
const { t } = useLanguage();  // line ~14 — translation function
// ...
useEffect(() => {
  if (!notes || notes === patient?.notes) return;
  const t = setTimeout(() => handleSave(), 10000);  // shadows outer t!
  return () => clearTimeout(t);
}, [notes, patient?.notes]);
```
The `const t = setTimeout(...)` variable inside the auto-save effect shadows the translation `t` from `useLanguage()`. While the auto-save still functions (the inner `t` holds the timer ID), the outer `t` (translation function) becomes inaccessible inside that effect's closure. If `t` were ever used inside the effect for an error message, it would silently use the timer ID instead. This is a naming collision introduced during the i18n refactor.

---

## Recommended Fixes (Minimal Changes Only)

### Fix 1 — Restore VoiceRecorder in PatientForm (Regression #1)
Add the VoiceRecorder element back into the form body, between the notes textarea and the duplicate warning section:

```jsx
{/* In PatientForm.jsx, after the notes <div className="field"> block: */}
{!secretary && (
  <VoiceRecorder
    onTranscriptionComplete={handleTranscriptionComplete}
    placeholder="Dictate notes"
  />
)}
```

### Fix 2 — Rename shadowed `t` variable in NotesEditor auto-save effect (Regression #2)
```js
// NotesEditor.jsx — auto-save useEffect
useEffect(() => {
  if (!notes || notes === patient?.notes) return;
  const autoSaveTimer = setTimeout(() => handleSave(), 10000);  // renamed from t
  return () => clearTimeout(autoSaveTimer);
}, [notes, patient?.notes]);
```

### Fix 3 — Remove dead `VoiceRecorder` import from PatientForm (if Fix 1 is not applied)
If the VoiceRecorder is intentionally removed from the form, clean up:
```js
// Remove these two lines:
import VoiceRecorder from './VoiceRecorder';
// and
const handleTranscriptionComplete = ...
```

### Fix 4 — Remove dead `language` state from `Dashboard-New.jsx`
```js
// Remove:
const [language, setLanguage] = useState(settings?.language || 'en');
// and
const handleLanguageChange = (lang) => { setLanguage(lang); };
```
And update the `TopBar` prop from `onLanguageChange={handleLanguageChange}` to just omit it (TopBar manages language via context now).
