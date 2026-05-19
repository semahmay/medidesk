import { useState, useEffect, useRef } from 'react';
import cloudApi from '../cloudApi';
import Sidebar from '../components/Sidebar';
import '../new-design.css';

const SUGGESTED_QUESTIONS = [
  "What is the correct dosage of Amoxicillin for adults?",
  "Ibuprofen and Lisinopril — is there an interaction?",
  "What are the symptoms of appendicitis?",
  "Normal blood pressure range by age?",
  "Anaphylaxis emergency protocol",
  "Metformin contraindications?"
];

const MedicalReference = ({ settings, currentUser }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const chatContainerRef = useRef(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const formatMessage = (text) => {
    if (!text) return '';
    let formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>');
    // Wrap consecutive <li> elements in <ul>
    formatted = formatted.replace(/(<li>[\s\S]*?<\/li>)(\s*<li>[\s\S]*?<\/li>)*/g, (match) => `<ul>${match}</ul>`);
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  };

  const handleSendMessage = async (message) => {
    if (!message.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputMessage('');
    setLoading(true);
    try {
      const response = await cloudApi.post('/medical-reference', { question: message, category: 'General' });
      setMessages(prev => [...prev, { role: 'assistant', content: response.data.answer }]);
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
    <div className="app-container">
      <Sidebar activePage="medical-reference" />
      <div className="main-content page-transition">
        <div className="medical-reference-simple">
          {/* Chat Area */}
          <div className="medical-reference-chat" ref={chatContainerRef}>
            {messages.length === 0 ? (
              <div className="medical-reference-empty">
                <div className="suggested-questions-grid">
                  {SUGGESTED_QUESTIONS.map((question, index) => (
                    <button key={index} className="suggested-question-card" onClick={() => handleSendMessage(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="medical-reference-messages">
                {messages.map((message, index) => (
                  <div key={index} className={`medical-chat-message ${message.role === 'user' ? 'user-message' : 'ai-message'}`}>
                    <div className="message-bubble">
                      {message.role === 'assistant' && <div className="ai-indicator" />}
                      <div className="message-content" dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }} />
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="medical-chat-message ai-message">
                    <div className="message-bubble">
                      <div className="ai-indicator" />
                      <div className="message-content loading">
                        <div className="typing-indicator"><span /><span /><span /></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input Bar */}
          <div className="medical-reference-input">
            <input
              type="text"
              className="medical-chat-input"
              placeholder="Ask any medical question..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="medical-send-btn"
              onClick={() => handleSendMessage(inputMessage)}
              disabled={loading || !inputMessage.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MedicalReference;
