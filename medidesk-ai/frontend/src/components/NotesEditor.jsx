import React, { useState, useRef, useEffect } from 'react';
import cloudApi from '../cloudApi';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { useUX } from '../context/UXContext';
import { secretaryCloudWrite, updateCloudPatient } from '../services/patientSyncService';
import { useLanguage } from '../context/LanguageContext';

const NotesEditor = ({ patient, onClose, onSave }) => {
  const { userRole } = getSession();
  const secretary = isSecretary(userRole);
  const { showToast, reportSyncIssue } = useUX();
  const { t } = useLanguage();

  const [notes, setNotes]               = useState('');
  const [isRecording, setIsRecording]   = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime]   = useState(0);
  const [saving, setSaving]             = useState(false);
  const [savedOk, setSavedOk]           = useState(false);

  const mediaRecorderRef      = useRef(null);
  const audioChunksRef        = useRef([]);
  const recordingIntervalRef  = useRef(null);
  const textareaRef           = useRef(null);

  useEffect(() => {
    if (patient) setNotes(patient.notes || '');
  }, [patient]);

  useEffect(() => {
    // auto-focus textarea
    setTimeout(() => textareaRef.current?.focus(), 80);
  }, []);

  // Auto-save after 10s of idle
  useEffect(() => {
    if (!notes || notes === patient?.notes) return;
    const autoSaveTimer = setTimeout(() => handleSave(), 10000);
    return () => clearTimeout(autoSaveTimer);
  }, [notes, patient?.notes]);

  useEffect(() => {
    return () => { if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current); };
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      if (secretary) {
        const { ok, queued, conflict } = await secretaryCloudWrite(patient, { notes });
        if (conflict) { showToast('⚠️ Conflict — another user updated this patient. Reload and try again.', 'error', 7000); return; }
        if (!ok && !queued) { showToast('Could not save notes. Please try again.', 'error', 5000); return; }
        onSave(patient.id, notes);
      } else {
        const result = await updateCloudPatient({ ...patient, notes });
        if (!result.ok) {
          if (result.conflict) {
            showToast('⚠️ Conflict — another user updated this patient. Reload to get latest.', 'error', 7000);
            reportSyncIssue({ type: 'conflict', action: 'update', message: `Conflict saving notes for ${patient.full_name || 'patient'}.`, patientId: patient.id });
          } else {
            showToast('⚠️ Notes saved but cloud sync failed. Will retry.', 'warning', 5000);
          }
        }
        onSave(patient.id, notes);
      }
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (e) {
      console.error('[NotesEditor] save failed:', e);
      showToast('Error saving notes. Please try again.', 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  // ── Voice recording ───────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch (e) {
      showToast('Could not access microphone. Check permissions.', 'error', 5000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const transcribeAudio = async (blob) => {
    setIsTranscribing(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, 'recording.webm');
      const res = await cloudApi.post('/transcribe', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
      if (res.data?.text?.trim()) {
        setNotes(prev => prev.trim() ? prev + '\n\n🎤 ' + res.data.text.trim() : '🎤 ' + res.data.text.trim());
      }
    } catch (e) {
      showToast('Transcription failed. Please try again.', 'error', 5000);
    } finally {
      setIsTranscribing(false);
    }
  };

  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const wordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0;
  const charCount = notes.length;

  return (
    <div className="ne-overlay" onClick={onClose}>
      <div className="ne-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="ne-header">
          <div className="ne-header-left">
            <div className="ne-header-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </div>
            <div>
              <div className="ne-header-title">{t('notes.title')}</div>
              <div className="ne-header-sub">{patient?.full_name || 'Patient'}</div>
            </div>
          </div>

          {/* Recording indicator in header */}
          {isRecording && (
            <div className="ne-recording-badge">
              <span className="ne-recording-dot" />
              {fmt(recordingTime)}
            </div>
          )}
          {isTranscribing && (
            <div className="ne-transcribing-badge">
              <span className="ne-spin-sm" />
              Transcribing…
            </div>
          )}

          <button className="ne-close-btn" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="ne-body">
          <textarea
            ref={textareaRef}
            className="ne-textarea"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t('notes.placeholder')}
            disabled={isTranscribing}
          />
        </div>

        {/* ── Footer ── */}
        <div className="ne-footer">
          {/* Left: voice button + word count */}
          <div className="ne-footer-left">
            <button
              className={`ne-mic-btn ${isRecording ? 'ne-mic-btn--recording' : ''}`}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing}
              title={isRecording ? 'Stop recording' : 'Record voice note'}
            >
              {isRecording ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                  </svg>
                  {t('notes.stop')}
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="9" y="2" width="6" height="12" rx="3"/>
                    <path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8"/>
                  </svg>
                  {t('notes.voice')}
                </>
              )}
            </button>
            <span className="ne-stats">
              <span>{wordCount} {t('notes.words')}</span>
              <span className="ne-stats-dot" />
              <span>{charCount} {t('notes.chars')}</span>
            </span>
          </div>

          {/* Right: save status + action buttons */}
          <div className="ne-footer-right">
            {savedOk && (
              <span className="ne-saved-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                {t('notes.saved')}
              </span>
            )}
            <button className="ne-btn ne-btn--secondary" onClick={onClose}>
              {t('notes.close')}
            </button>
            <button className="ne-btn ne-btn--primary" onClick={handleSave} disabled={saving || isTranscribing}>
              {saving ? (
                <><span className="ne-spin-sm" /> {t('notes.saving')}</>
              ) : (
                <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> {t('notes.save')}</>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default NotesEditor;
