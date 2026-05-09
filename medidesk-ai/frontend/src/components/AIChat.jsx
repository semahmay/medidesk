import { useState, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import api from '../api';

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

  const quickActions = [
    { label: 'Summarize case',    prompt: 'Give me a brief 3 sentence summary of this patient.' },
    { label: 'Next steps',        prompt: 'What are the recommended next steps for this patient? Keep it brief.' },
    { label: 'Risks',             prompt: 'What are the main risks to watch for with this patient? List max 3.' },
    { label: 'Drug interactions', prompt: 'Are there any drug interactions I should know about for this patient?' },
  ];

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
      const response = await api.post('/api/chat', {
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
    <div className="ai-assistant">
      <div className="ai-assistant-header">
        <div className="ai-assistant-label">AI assistant</div>
        <button
          className="clear-chat-btn"
          onClick={() => { setMessages([]); if (storageKey) localStorage.removeItem(storageKey); }}
        >
          Clear chat
        </button>
      </div>

      <div className="chat-messages" ref={chatContainerRef}>
        <div className="quick-actions">
          {quickActions.map((action, index) => (
            <button
              key={index}
              className="quick-action-btn"
              onClick={() => handleSendMessage(action.prompt)}
              disabled={loading}
            >
              {action.label}
            </button>
          ))}
        </div>

        {messages.length === 0 ? (
          <div className="chat-welcome">
            <p>Ask me anything about this patient case</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={`message ${message.role === 'user' ? 'user-message' : 'ai-message'}`}>
              <div className="message-content">
                <span dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }} />
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="message ai-message">
            <div className="message-content">
              <div className="typing-indicator"><span /><span /><span /></div>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-area">
        <input
          type="text"
          className="chat-input"
          placeholder="Ask about this patient..."
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="send-btn"
          onClick={() => handleSendMessage(inputMessage)}
          disabled={loading || !inputMessage.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default AIChat;
