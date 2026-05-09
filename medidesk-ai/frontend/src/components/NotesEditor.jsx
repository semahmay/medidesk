import React, { useState, useRef, useEffect } from 'react';
import api from '../api';
import { getSession } from '../hooks/useClinicSession';
import { isSecretary } from '../utils/roleUtils';
import { useUX } from '../context/UXContext';
import { secretaryCloudWrite, updateCloudPatient } from '../services/patientSyncService';

const NotesEditor = ({ patient, onClose, onSave }) => {
  const { userRole } = getSession();
  const secretary = isSecretary(userRole);
  const { showToast, reportSyncIssue } = useUX();
  const [notes, setNotes] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showSaved, setShowSaved] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingIntervalRef = useRef(null);

  useEffect(() => {
    if (patient) {
      setNotes(patient.notes || '');
    }
  }, [patient]);

  // Priority 3: Auto-Save Notes (ANTI-DATA LOSS)
  useEffect(() => {
    if (!notes || notes === patient?.notes) return;
    const timer = setTimeout(() => {
      handleSave();
    }, 10000);
    return () => clearTimeout(timer);
  }, [notes, patient?.notes]);

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  const handleSave = async () => {
    try {
      if (secretary) {
        // Secretary: write to cloud with offline queue fallback
        const { ok, queued, conflict } = await secretaryCloudWrite(patient, { notes });
        if (conflict) {
          alert('Your notes were not saved — another user updated this patient more recently. Please reload and try again.');
          return;
        }
        if (!ok && !queued) {
          alert('Could not save notes. Please try again.');
          return;
        }
        onSave(patient.id, notes);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), queued ? 3000 : 2000);
        return;
      }
      // Doctor: local save
      await api.put(`/api/patients/${patient.id}`, { notes });
      const cloudResult = await updateCloudPatient({ ...patient, notes });
      if (!cloudResult.ok) {
        if (cloudResult.conflict) {
          showToast('⚠️ Your notes were not saved to the cloud because another user updated this patient. Please reload.', 'error', 7000);
          reportSyncIssue({
            type: 'conflict',
            action: 'update',
            message: `Conflict saving notes for ${patient.full_name || 'patient'}.`,
            patientId: patient.id,
          });
        } else {
          showToast('⚠️ Notes saved locally but cloud sync failed. It will retry automatically.', 'error', 7000);
          reportSyncIssue({
            type: 'sync',
            action: 'update',
            message: `Cloud sync failed for notes on ${patient.full_name || 'patient'}.`,
            patientId: patient.id,
          });
        }
      }
      onSave(patient.id, notes);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (error) {
      console.error('Error saving notes:', error);
      alert('Error saving notes. Please try again.');
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check your permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const transcribeAudio = async (audioBlob) => {
    // Secretary has no local backend — transcription not available
    if (secretary) {
      alert('Voice transcription requires the local backend (doctor only).');
      return;
    }
    setIsTranscribing(true);

    try {
      // Use FormData — same format as VoiceRecorder and what /api/transcribe expects
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      const response = await api.post('/api/transcribe', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });

      if (response.data?.text) {
        const transcribedText = response.data.text.trim();
        if (transcribedText) {
          setNotes(prev => {
            const separator = prev.trim() && !prev.endsWith('\n') ? '\n\n' : '';
            return prev + separator + `🎤 ${transcribedText}`;
          });
        }
      }
    } catch (error) {
      console.error('Error transcribing audio:', error);
      alert('Error transcribing audio. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const formatRecordingTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getWordCount = () => {
    return notes.trim() ? notes.trim().split(/\s+/).length : 0;
  };

  const getCharCount = () => {
    return notes.length;
  };

  return (
    <div className="notes-editor-overlay">
      <div className="notes-editor-modal">
        {/* Header */}
        <div className="notes-editor-header">
          <div className="header-left">
            <button
              className={`mic-button ${isRecording ? 'recording' : ''}`}
              onClick={toggleRecording}
              disabled={isTranscribing}
              title={isRecording ? 'Stop recording' : 'Start voice recording'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            <h2>{patient?.full_name || 'Patient'} - Notes</h2>
          </div>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        {/* Textarea Area */}
        <div className="notes-editor-body">
          <div className="notes-textarea-container">
            <textarea
              className="notes-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter patient notes here... You can type or use the voice recording feature."
              disabled={isTranscribing}
            />
          </div>
          
          {isTranscribing && (
            <div className="transcribing-indicator">
              <div className="spinner"></div>
              <div>
                <span>Transcribing audio...</span>
                <small>Please wait a moment</small>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="notes-editor-footer">
          <div className="notes-info">
            {isRecording && (
              <div className="recording-info">
                <span className="recording-dot"></span>
                <span>Recording... {formatRecordingTime(recordingTime)}</span>
              </div>
            )}
            {!isRecording && (
              <div className="notes-stats">
                <span className="word-count">{getWordCount()} words</span>
                <span className="char-count">{getCharCount()} characters</span>
              </div>
            )}
          </div>
          <div className="notes-actions">
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isTranscribing}
            >
              Save notes
            </button>
          </div>
          {showSaved && (
            <div className="saved-confirmation">
              ✅ Saved!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotesEditor;
