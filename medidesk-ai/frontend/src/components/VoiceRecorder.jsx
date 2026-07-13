import React, { useState, useRef, useEffect } from 'react';
import cloudApi from '../cloudApi';

const VoiceRecorder = ({ onTranscriptionComplete, placeholder = 'Record voice note' }) => {
  const [isRecording, setIsRecording]       = useState(false);
  const [isPaused, setIsPaused]             = useState(false);
  const [audioURL, setAudioURL]             = useState('');
  const [audioBlob, setAudioBlob]           = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription]   = useState('');
  const [recordingTime, setRecordingTime]   = useState(0);
  const [error, setError]                   = useState('');
  const [permissionGranted, setPermissionGranted] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const timerRef         = useRef(null);

  useEffect(() => { checkMicPermission(); }, []);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const checkMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setPermissionGranted(true);
      setError('');
    } catch (err) {
      setPermissionGranted(false);
      if (err.name === 'NotAllowedError') setError('Microphone access denied. Please allow access.');
      else if (err.name === 'NotFoundError') setError('No microphone found.');
      else setError('Microphone error: ' + err.message);
    }
  };

  const startRecording = async () => {
    if (!permissionGranted) { await checkMicPermission(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioURL(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };

      mr.start();
      setIsRecording(true);
      setIsPaused(false);
      setError('');
      setTranscription('');
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch (err) {
      setError('Failed to start: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      clearInterval(timerRef.current);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    }
  };

  const clearRecording = () => {
    setAudioURL(''); setAudioBlob(null);
    setTranscription(''); setError(''); setRecordingTime(0);
  };

  const transcribeAudio = async () => {
    if (!audioBlob) { setError('No audio to transcribe'); return; }
    setIsTranscribing(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', audioBlob, 'recording.webm');
      const res = await cloudApi.post('/transcribe', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      if (res.data.success) {
        setTranscription(res.data.text);
        if (onTranscriptionComplete) onTranscriptionComplete(res.data.text);
      } else setError('Transcription failed.');
    } catch (err) {
      if (err.code === 'ECONNABORTED') setError('Timed out. Please try again.');
      else setError(err.response?.data?.error || 'Network error: ' + err.message);
    } finally { setIsTranscribing(false); }
  };

  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="vr-wrap">

      {/* ── Idle: show record button ── */}
      {!isRecording && !audioURL && (
        <button
          className="vr-record-btn"
          onClick={startRecording}
          disabled={!permissionGranted}
          title={!permissionGranted ? 'Microphone access required' : 'Start recording'}
        >
          <span className="vr-record-dot" />
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3"/>
            <path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8"/>
          </svg>
          {placeholder}
        </button>
      )}

      {/* ── Active recording ── */}
      {isRecording && (
        <div className="vr-active">
          <div className="vr-indicator">
            <span className="vr-pulse" />
            <span className="vr-timer">{isPaused ? 'Paused' : 'Recording'} — {fmt(recordingTime)}</span>
          </div>
          <div className="vr-controls">
            {isPaused ? (
              <button className="vr-btn vr-btn--resume" onClick={resumeRecording}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Resume
              </button>
            ) : (
              <button className="vr-btn vr-btn--pause" onClick={pauseRecording}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                Pause
              </button>
            )}
            <button className="vr-btn vr-btn--stop" onClick={stopRecording}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              Stop
            </button>
          </div>
        </div>
      )}

      {/* ── Post-recording: playback + actions ── */}
      {audioURL && !isRecording && (
        <div className="vr-post">
          <audio controls src={audioURL} style={{ width: '100%', height: 36, borderRadius: 8 }} />
          <div className="vr-controls" style={{ marginTop: 10 }}>
            <button className="vr-btn vr-btn--transcribe" onClick={transcribeAudio} disabled={isTranscribing}>
              {isTranscribing ? (
                <>
                  <span className="vr-spin" />
                  Transcribing…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  Transcribe to notes
                </>
              )}
            </button>
            <button className="vr-btn vr-btn--clear" onClick={clearRecording}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6"/><path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Discard
            </button>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="vr-error">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {/* ── Transcription result ── */}
      {transcription && (
        <div className="vr-transcript">
          <div className="vr-transcript-label">Transcription</div>
          <p className="vr-transcript-text">{transcription}</p>
        </div>
      )}

      {/* ── No permission ── */}
      {!permissionGranted && !error && (
        <div className="vr-permission">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/></svg>
          Microphone access required for voice recording
        </div>
      )}
    </div>
  );
};

export default VoiceRecorder;
