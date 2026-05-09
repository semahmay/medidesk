import React, { useState, useRef, useEffect } from 'react';
import api from '../api';

const VoiceRecorder = ({ onTranscriptionComplete, placeholder = "Click to record voice note" }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioURL, setAudioURL] = useState('');
  const [audioBlob, setAudioBlob] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState('');
  const [permissionGranted, setPermissionGranted] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // Check microphone permissions on mount
  useEffect(() => {
    checkMicrophonePermission();
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const checkMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setPermissionGranted(true);
      setError('');
    } catch (err) {
      setPermissionGranted(false);
      if (err.name === 'NotAllowedError') {
        setError('Microphone access denied. Please allow microphone access to use voice recording.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect a microphone to use voice recording.');
      } else {
        setError('Microphone access error: ' + err.message);
      }
    }
  };

  const startRecording = async () => {
    if (!permissionGranted) {
      await checkMicrophonePermission();
      if (!permissionGranted) return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create MediaRecorder instance
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(audioBlob);
        const url = URL.createObjectURL(audioBlob);
        setAudioURL(url);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
      setError('');
      setTranscription('');
      
      // Start timer
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      setError('Failed to start recording: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      
      // Stop timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      
      // Stop timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      
      // Resume timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    }
  };

  const clearRecording = () => {
    setAudioURL('');
    setAudioBlob(null);
    setTranscription('');
    setError('');
    setRecordingTime(0);
  };

  const transcribeAudio = async () => {
    if (!audioBlob) {
      setError('No audio to transcribe');
      return;
    }

    setIsTranscribing(true);
    setError('');

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      // Send to backend
      const response = await api.post('/api/transcribe', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000, // 60 second timeout
      });

      if (response.data.success) {
        setTranscription(response.data.text);
        if (onTranscriptionComplete) {
          onTranscriptionComplete(response.data.text);
        }
      } else {
        setError('Transcription failed');
      }
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        setError('Transcription timed out. Please try again.');
      } else if (err.response) {
        setError(err.response.data.error || 'Transcription failed');
      } else {
        setError('Network error: ' + err.message);
      }
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const insertIntoNotes = () => {
    if (onTranscriptionComplete && transcription) {
      onTranscriptionComplete(transcription);
    }
  };

  return (
    <div className="voice-recorder">
      <div className="voice-recorder-container">
        {/* Recording Controls */}
        <div className="recording-controls">
          {!isRecording && !audioURL && (
            <button
              className="record-button"
              onClick={startRecording}
              disabled={!permissionGranted}
              title={!permissionGranted ? "Microphone access required" : "Start recording"}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              {placeholder}
            </button>
          )}

          {isRecording && (
            <div className="recording-active">
              <div className="recording-indicator">
                <div className="recording-dot"></div>
                <span className="recording-text">
                  {isPaused ? 'Paused' : 'Recording'} {formatTime(recordingTime)}
                </span>
              </div>
              
              <div className="recording-buttons">
                {isPaused ? (
                  <button className="resume-button" onClick={resumeRecording}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                    Resume
                  </button>
                ) : (
                  <button className="pause-button" onClick={pauseRecording}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16"/>
                      <rect x="14" y="4" width="4" height="16"/>
                    </svg>
                    Pause
                  </button>
                )}
                
                <button className="stop-button" onClick={stopRecording}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12"/>
                  </svg>
                  Stop
                </button>
              </div>
            </div>
          )}

          {audioURL && !isRecording && (
            <div className="recorded-audio">
              <audio controls src={audioURL} className="audio-player" />
              
              <div className="audio-actions">
                <button className="transcribe-button" onClick={transcribeAudio} disabled={isTranscribing}>
                  {isTranscribing ? (
                    <>
                      <div className="loading-spinner"></div>
                      Transcribing...
                    </>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10,9 9,9 8,9"/>
                      </svg>
                      Transcribe
                    </>
                  )}
                </button>
                
                <button className="clear-button" onClick={clearRecording}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3,6 5,6 21,6"/>
                    <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"/>
                  </svg>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-message">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            {error}
          </div>
        )}

        {/* Transcription Result */}
        {transcription && (
          <div className="transcription-result">
            <div className="transcription-header">
              <h4>Transcription</h4>
              {onTranscriptionComplete && (
                <button className="insert-button" onClick={insertIntoNotes}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 3h5v5"/>
                    <path d="M21 3l-7 7"/>
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h7"/>
                  </svg>
                  Insert into notes
                </button>
              )}
            </div>
            <div className="transcription-text">
              {transcription}
            </div>
          </div>
        )}

        {/* Permission Request */}
        {!permissionGranted && !error && (
          <div className="permission-request">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
            </svg>
            Microphone access is required for voice recording
          </div>
        )}
      </div>

      <style jsx>{`
        .voice-recorder {
          width: 100%;
        }

        .voice-recorder-container {
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 8px;
          padding: 16px;
        }

        .recording-controls {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .record-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: #1D9E75;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: background-color 0.2s;
        }

        .record-button:hover:not(:disabled) {
          background: #157a5a;
        }

        .record-button:disabled {
          background: #6c757d;
          cursor: not-allowed;
        }

        .recording-active {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .recording-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #fff3cd;
          border: 1px solid #ffeaa7;
          border-radius: 6px;
        }

        .recording-dot {
          width: 8px;
          height: 8px;
          background: #dc3545;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }

        .recording-text {
          font-size: 14px;
          font-weight: 500;
          color: #856404;
        }

        .recording-buttons {
          display: flex;
          gap: 8px;
        }

        .pause-button, .resume-button, .stop-button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .pause-button {
          background: #ffc107;
          color: #212529;
        }

        .pause-button:hover {
          background: #e0a800;
        }

        .resume-button {
          background: #28a745;
          color: white;
        }

        .resume-button:hover {
          background: #218838;
        }

        .stop-button {
          background: #dc3545;
          color: white;
        }

        .stop-button:hover {
          background: #c82333;
        }

        .recorded-audio {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .audio-player {
          width: 100%;
          height: 40px;
        }

        .audio-actions {
          display: flex;
          gap: 8px;
        }

        .transcribe-button, .clear-button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .transcribe-button {
          background: #007bff;
          color: white;
        }

        .transcribe-button:hover:not(:disabled) {
          background: #0056b3;
        }

        .transcribe-button:disabled {
          background: #6c757d;
          cursor: not-allowed;
        }

        .clear-button {
          background: #6c757d;
          color: white;
        }

        .clear-button:hover {
          background: #545b62;
        }

        .loading-spinner {
          width: 12px;
          height: 12px;
          border: 2px solid #ffffff;
          border-top: 2px solid transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .error-message {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #f8d7da;
          border: 1px solid #f5c6cb;
          border-radius: 4px;
          color: #721c24;
          font-size: 12px;
        }

        .transcription-result {
          margin-top: 16px;
          padding: 12px;
          background: white;
          border: 1px solid #dee2e6;
          border-radius: 6px;
        }

        .transcription-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .transcription-header h4 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #495057;
        }

        .insert-button {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: #28a745;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          transition: background-color 0.2s;
        }

        .insert-button:hover {
          background: #218838;
        }

        .transcription-text {
          font-size: 14px;
          line-height: 1.5;
          color: #495057;
          white-space: pre-wrap;
        }

        .permission-request {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #d1ecf1;
          border: 1px solid #bee5eb;
          border-radius: 4px;
          color: #0c5460;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
};

export default VoiceRecorder;
