import { useState, useEffect, useRef } from 'react';
import cloudApi from '../cloudApi';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import DOMPurify from 'dompurify';

const SUGGESTED = [
  { icon: '💊', text: 'Amoxicillin dosage for adults?' },
  { icon: '⚠️', text: 'Ibuprofen + Lisinopril interaction?' },
  { icon: '🩺', text: 'Appendicitis symptoms?' },
  { icon: '❤️', text: 'Normal blood pressure by age?' },
  { icon: '🚨', text: 'Anaphylaxis emergency protocol?' },
  { icon: '🔬', text: 'Metformin contraindications?' },
];

const MedicalReference = ({ settings, currentUser }) => {
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const chatEndRef                  = useRef(null);
  const inputRef                    = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const formatMsg = (text) => {
    if (!text) return '';
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)(\s*<li>[\s\S]*?<\/li>)*/g, m => `<ul>${m}</ul>`)
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/\n/g, '<br>');
    return DOMPurify.sanitize(`<p>${html}</p>`, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'li'],
      ALLOWED_ATTR: [],
    });
  };

  const send = async (msg) => {
    const text = (msg || input).trim();
    if (!text || loading) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const res = await cloudApi.post('/medical-reference', { question: text, category: 'General' });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.answer }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <TopBar settings={settings} currentUser={currentUser} />
      <Sidebar activePage="medical-reference" />
      <div className="main-content page-transition" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Top bar inside content ── */}
        <div className="mr-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mr-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Medical Reference</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>AI-powered clinical knowledge base</div>
            </div>
          </div>
          {messages.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setMessages([])}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6"/><path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Clear
            </button>
          )}
        </div>

        {/* ── Chat area ── */}
        <div className="mr-chat-area">
          {messages.length === 0 ? (
            /* Empty state with suggestion cards */
            <div className="mr-empty">
              <div className="mr-empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
              </div>
              <h3 className="mr-empty-title">What do you want to look up?</h3>
              <p className="mr-empty-sub">Ask about dosages, drug interactions, symptoms, or protocols</p>
              <div className="mr-suggestions">
                {SUGGESTED.map((s, i) => (
                  <button key={i} className="mr-suggestion-card" onClick={() => send(s.text)}>
                    <span className="mr-suggestion-icon">{s.icon}</span>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message thread */
            <div className="mr-messages">
              {messages.map((m, i) => (
                <div key={i} className={`mr-msg ${m.role === 'user' ? 'mr-msg--user' : 'mr-msg--ai'}`}>
                  {m.role === 'assistant' && (
                    <div className="mr-ai-badge">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                      </svg>
                      Medical Reference
                    </div>
                  )}
                  {m.role === 'user' ? (
                    <div className="mr-msg-text">{m.content}</div>
                  ) : (
                    <div className="mr-msg-text" dangerouslySetInnerHTML={{ __html: formatMsg(m.content) }} />
                  )}
                </div>
              ))}
              {loading && (
                <div className="mr-msg mr-msg--ai">
                  <div className="mr-ai-badge">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                    Medical Reference
                  </div>
                  <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
                    <span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div className="mr-input-bar">
          <input
            ref={inputRef}
            className="mr-input"
            type="text"
            placeholder="Ask any medical question — dosages, interactions, protocols..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={loading}
          />
          <button
            className="mr-send-btn"
            onClick={() => send()}
            disabled={loading || !input.trim()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
};

export default MedicalReference;
