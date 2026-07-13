import { useState, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import cloudApi from '../cloudApi';

const QUICK_ACTIONS = [
  { label: 'Summarize case',    prompt: 'Give me a brief 3 sentence summary of this patient.' },
  { label: 'Next steps',        prompt: 'What are the recommended next steps for this patient? Keep it brief.' },
  { label: 'Risks',             prompt: 'What are the main risks to watch for with this patient? List max 3.' },
  { label: 'Drug interactions', prompt: 'Are there any drug interactions I should know about for this patient?' },
];

const AIChat = ({ patient }) => {
  // Key by global_id (stable across sync) → fall back to local id for legacy records
  const storageKey = patient
    ? `aichat_${patient.global_id || patient.cloud_id || patient.id}`
    : null;

  const [messages, setMessages] = useState(() => {
    if (!storageKey) return [];
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
    catch { return []; }
  });
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const chatContainerRef = useRef(null);

  // Reload history when patient changes
  useEffect(() => {
    if (!storageKey) { setMessages([]); return; }
    try { setMessages(JSON.parse(localStorage.getItem(storageKey) || '[]')); }
    catch { setMessages([]); }
  }, [storageKey]);

  // Persist messages to localStorage on every change
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const formatMessage = (text) => {
    if (!text) return '';
    // Convert **bold** markdown, then sanitize to prevent XSS from AI-generated HTML
    const withBold = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return DOMPurify.sanitize(withBold, { ALLOWED_TAGS: ['strong', 'em', 'br'], ALLOWED_ATTR: [] });
  };

  const handleSendMessage = async (message) => {
    if (!message.trim()) return;

    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputMessage('');
    setLoading(true);

    try {
      const response = await cloudApi.post('/chat', {
        message,
        patient_context: patient,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: response.data.response }]);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputMessage);
    }
  };

  return (
    <>
      {/* Clear chat button — only when there are messages */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 0 6px' }}>
          <button
            onClick={() => {
              setMessages([]);
              if (storageKey) localStorage.removeItem(storageKey);
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
              background: 'none', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              transition: 'all 0.13s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = 'var(--danger-600)'; e.currentTarget.style.borderColor = 'rgba(196,52,43,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            title="Clear conversation"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Clear chat
          </button>
        </div>
      )}
      <div className="ai-msgs" ref={chatContainerRef}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            <p style={{ margin: '0 0 4px' }}>Ask me anything about this patient case</p>
            <div className="ai-quick" style={{ justifyContent: 'center', padding: '12px 0 0' }}>
              {QUICK_ACTIONS.map((action, index) => (
                <button key={index} onClick={() => handleSendMessage(action.prompt)} disabled={loading}>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="ai-quick">
              {QUICK_ACTIONS.map((action, index) => (
                <button key={index} onClick={() => handleSendMessage(action.prompt)} disabled={loading}>
                  {action.label}
                </button>
              ))}
            </div>
            {messages.map((message, index) => (
              <div key={index} className={`msg ${message.role === 'user' ? 'msg-user' : 'msg-ai'}`}>
                {message.role === 'assistant' && <div className="msg-ai-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M5 15h14M5 15a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2M5 15l-.5-4M19 15l.5-4"/></svg> AI</div>}
                <div dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }} />
              </div>
            ))}
            {loading && (
              <div className="msg msg-ai">
                <div className="msg-ai-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M5 15h14M5 15a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2M5 15l-.5-4M19 15l.5-4"/></svg> AI</div>
                <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="ai-input">
        <input
          type="text"
          placeholder="Ask about this patient..."
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="ai-send"
          onClick={() => handleSendMessage(inputMessage)}
          disabled={loading || !inputMessage.trim()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </>
  );
};

export default AIChat;
