import { useState, useEffect, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import cloudApi, { onRealtimeEvent } from '../cloudApi';
import { getSession } from '../hooks/useClinicSession';
import { useUX } from '../context/UXContext';

const ClinicChat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [isTask, setIsTask]     = useState(false);
  const [filter, setFilter]     = useState('all');
  const [sendError, setSendError] = useState('');
  const chatEndRef              = useRef(null);
  const lastMessageIdRef        = useRef(null);

  const { userRole } = getSession();
  const { clearUnread } = useUX();

  // Clear unread count when this page is open
  useEffect(() => {
    clearUnread();
    return () => {}; // no cleanup needed
  }, [clearUnread]);

  const fetchMessages = async (silent = false) => {
    try {
      const res = await cloudApi.get('/messages');
      const fetched = res.data.messages || [];

      // Detect new messages that arrived while user is on this page
      // (they're already reading, so no badge increment needed — just update list)
      setMessages(fetched);

      // Track last seen id for unread detection when NOT on this page
      if (fetched.length > 0) {
        lastMessageIdRef.current = fetched[fetched.length - 1].id;
      }
    } catch (err) {
      if (!silent) console.error('[ClinicChat] fetch error:', err);
    }
  };

  useEffect(() => {
    fetchMessages();
    const unsub = onRealtimeEvent('message_new', (payload) => {
      setMessages(prev => [...prev, payload]);
      lastMessageIdRef.current = payload.id;
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;

    setSendError('');
    // Optimistic update — show message immediately
    const optimisticMsg = {
      id:          `opt_${Date.now()}`,
      text,
      is_task:     isTask,
      sender_role: userRole,
      status:      'pending',
      created_at:  new Date().toISOString(),
      _optimistic: true,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setInput('');
    const wasTask = isTask;
    setIsTask(false);
    setLoading(true);

    try {
      await cloudApi.post('/messages', { text, is_task: wasTask });
      // Replace optimistic message with real one from server
      await fetchMessages(true);
    } catch (err) {
      // Remove optimistic message and show error
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setInput(text); // restore input
      setIsTask(wasTask);
      setSendError('Failed to send. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDone = async (msgId) => {
    try {
      await cloudApi.patch(`/messages/${msgId}`, { status: 'done' });
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, status: 'done' } : m));
    } catch {
      setSendError('Could not update task status.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayed = filter === 'tasks'
    ? messages.filter(m => m.is_task)
    : messages;

  const formatTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={s.layout}>
      <Sidebar activePage="clinic-chat" />

      <div style={s.page}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <div style={s.headerIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div>
              <h1 style={s.headerTitle}>Clinic Chat</h1>
              <p style={s.headerSub}>
                <span className="text-xs font-semibold" style={{ color: userRole === 'doctor' ? '#1D9E75' : '#3b82f6' }}>
                  {userRole === 'doctor' ? 'Doctor' : 'Secretary'}
                </span>
              </p>
            </div>
          </div>

          <div style={s.filterTabs}>
            {['all', 'tasks'].map(f => (
              <button
                key={f}
                style={{ ...s.filterBtn, ...(filter === f ? s.filterBtnActive : {}) }}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : 'Tasks'}
              </button>
            ))}
          </div>
        </div>

        {/* Send error */}
        {sendError && (
          <div className="error-banner flex-row justify-between text-base" style={{ padding: '8px 24px', background: '#fee2e2', color: '#991b1b' }}>
            {sendError}
            <button onClick={() => setSendError('')} className="error-dismiss-btn">×</button>
          </div>
        )}

        {/* Messages */}
        <div style={s.messageArea}>
          {displayed.length === 0 ? (
            <div style={s.empty}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p style={{ color: '#aaa', marginTop: 12 }}>
                {filter === 'tasks' ? 'No tasks yet' : 'No messages yet. Start the conversation.'}
              </p>
            </div>
          ) : (
            displayed.map((msg) => {
              const isOwn  = msg.sender_role === userRole;
              const isDone = msg.status === 'done';
              return (
                <div key={msg.id} className="flex-row gap-8 mb-8 w-full" style={{ justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth: '65%' }}>
                    <div style={{ ...s.msgLabel, textAlign: isOwn ? 'right' : 'left' }}>
                      {msg.sender_role === 'doctor' ? 'Doctor' : 'Secretary'}
                    </div>

                    <div className="chat-bubble" style={{
                      background: isOwn ? (msg._optimistic ? '#4ade80' : '#1D9E75') : '#ffffff',
                      color: isOwn ? '#fff' : '#1a202c',
                      borderBottomRightRadius: isOwn ? 4 : 16,
                      borderBottomLeftRadius:  isOwn ? 16 : 4,
                      border: isOwn ? 'none' : '1px solid #e2e8f0',
                      opacity: isDone ? 0.6 : 1,
                    }}>
                      {msg.is_task && (
                        <div style={{
                          ...s.taskBadge,
                          background: isDone ? '#d1fae5' : (isOwn ? 'rgba(255,255,255,0.25)' : '#fef3c7'),
                          color:      isDone ? '#065f46' : (isOwn ? '#fff' : '#92400e'),
                          textDecoration: isDone ? 'line-through' : 'none',
                        }}>
                          {isDone ? '✓ Done' : '☐ Task'}
                        </div>
                      )}
                      <span style={{ textDecoration: isDone ? 'line-through' : 'none' }}>{msg.text}</span>

                      {/* Mark done button — only on incomplete tasks, only for the other person's tasks */}
                      {msg.is_task && !isDone && !msg._optimistic && (
                        <button
                          onClick={() => handleMarkDone(msg.id)}
                          style={{
                            display: 'block', marginTop: 8,
                            padding: '3px 10px', fontSize: 11, fontWeight: 700,
                            background: isOwn ? 'rgba(255,255,255,0.2)' : '#f0fdf4',
                            color: isOwn ? '#fff' : '#166534',
                            border: isOwn ? '1px solid rgba(255,255,255,0.4)' : '1px solid #86efac',
                            borderRadius: 6, cursor: 'pointer',
                          }}
                        >
                          ✔ Mark as done
                        </button>
                      )}
                    </div>

                    <div className="chat-timestamp" style={{ textAlign: isOwn ? 'right' : 'left' }}>
                      {msg._optimistic ? 'Sending...' : formatTime(msg.created_at)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={s.inputArea}>
          <button
            onClick={() => setIsTask(v => !v)}
            title={isTask ? 'Switch to regular message' : 'Send as task'}
            style={{
              ...s.taskToggle,
              background: isTask ? '#fef3c7' : '#f1f5f9',
              color: isTask ? '#92400e' : '#64748b',
              border: isTask ? '1px solid #fde68a' : '1px solid #e2e8f0',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700 }}>{isTask ? '☐ Task' : '✓'}</span>
          </button>

          <input
            style={s.input}
            placeholder={isTask ? 'Type a task for the other person...' : `Message as ${userRole}...`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoFocus
          />

          <button
            className="flex-center rounded-lg cursor-pointer flex-shrink-0"
            style={{ width: 40, height: 40, background: '#1D9E75', border: 'none', opacity: (!input.trim() || loading) ? 0.5 : 1 }}
            onClick={handleSend}
            disabled={!input.trim() || loading}
            title="Send (Enter)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

const s = {
  layout:     { display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: '#f8fafb' },
  page:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e2e8f0', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerIcon: { width: 38, height: 38, borderRadius: 10, background: '#1D9E75', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  headerTitle:{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a202c' },
  headerSub:  { margin: 0, fontSize: 12, color: '#64748b' },
  filterTabs: { display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: 3 },
  filterBtn:  { padding: '5px 16px', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: 'transparent', color: '#64748b', fontWeight: 500 },
  filterBtnActive: { background: '#1D9E75', color: '#fff', fontWeight: 600 },
  messageArea:{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 },
  empty:      { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: 80 },
  msgRow:     { display: 'flex', width: '100%' },
  msgLabel:   { fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3, paddingLeft: 4, paddingRight: 4 },
  bubble:     { padding: '10px 14px', borderRadius: 16, fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' },
  taskBadge:  { display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, marginBottom: 5, letterSpacing: '0.3px' },
  msgTime:    { fontSize: 10, color: '#94a3b8', marginTop: 3, paddingLeft: 4, paddingRight: 4 },
  inputArea:  { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#fff', borderTop: '1px solid #e2e8f0', flexShrink: 0 },
  taskToggle: { height: 36, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, flexShrink: 0, transition: 'all 0.15s', whiteSpace: 'nowrap' },
  input:      { flex: 1, height: 40, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 14px', fontSize: 14, outline: 'none', background: '#f8fafb', color: '#1a202c' },
  sendBtn:    { width: 40, height: 40, background: '#1D9E75', border: 'none', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
};

export default ClinicChat;
