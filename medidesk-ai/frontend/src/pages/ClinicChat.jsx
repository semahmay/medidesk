import { useState, useEffect, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import cloudApi, { onRealtimeEvent } from '../cloudApi';
import { getSession } from '../hooks/useClinicSession';
import { useUX } from '../context/UXContext';

const ClinicChat = ({ currentUser }) => {
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [isTask, setIsTask]         = useState(false);
  const [filter, setFilter]         = useState('all');
  const [sendError, setSendError]   = useState('');
  const chatEndRef                  = useRef(null);
  const lastMessageIdRef            = useRef(null);
  const inputRef                    = useRef(null);

  const { userRole } = getSession();
  const { clearUnread } = useUX();

  useEffect(() => { clearUnread(); }, [clearUnread]);

  const fetchMessages = async (silent = false) => {
    try {
      const res = await cloudApi.get('/messages');
      const fetched = res.data.messages || [];
      setMessages(fetched);
      if (fetched.length > 0) lastMessageIdRef.current = fetched[fetched.length - 1].id;
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
    const optimistic = {
      id: `opt_${Date.now()}`, text, is_task: isTask,
      sender_role: userRole, status: 'pending',
      created_at: new Date().toISOString(), _optimistic: true,
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    const wasTask = isTask;
    setIsTask(false);
    setLoading(true);
    try {
      await cloudApi.post('/messages', { text, is_task: wasTask });
      await fetchMessages(true);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setInput(text);
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

  const fmtTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Group messages by date
  const groupByDate = (msgs) => {
    const groups = [];
    let lastDate = null;
    msgs.forEach(m => {
      const d = m.created_at ? new Date(m.created_at).toDateString() : null;
      if (d && d !== lastDate) { groups.push({ type: 'date', label: d === new Date().toDateString() ? 'Today' : d }); lastDate = d; }
      groups.push({ type: 'msg', msg: m });
    });
    return groups;
  };

  const displayed = filter === 'tasks' ? messages.filter(m => m.is_task) : messages;
  const items = groupByDate(displayed);

  return (
    <div className="app-shell">
      <TopBar currentUser={currentUser} />
      <Sidebar activePage="clinic-chat" />
      <div className="main-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Header ── */}
        <div className="cc-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="cc-header-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Clinic Chat</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                You're chatting as&nbsp;
                <strong style={{ color: userRole === 'doctor' ? 'var(--primary-700)' : 'var(--info-600)' }}>
                  {userRole === 'doctor' ? 'Doctor' : 'Secretary'}
                </strong>
              </div>
            </div>
          </div>
          <div className="cc-filter">
            {['all', 'tasks'].map(f => (
              <button
                key={f}
                className={`cc-filter-btn ${filter === f ? 'cc-filter-btn--active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> All</>
                ) : (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Tasks</>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Error banner */}
        {sendError && (
          <div className="banner banner-sync-warning" style={{ flexShrink: 0 }}>
            {sendError}
            <button onClick={() => setSendError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* ── Messages ── */}
        <div className="cc-messages">
          {items.length === 0 ? (
            <div className="cc-empty">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.25 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p style={{ color: 'var(--text-disabled)', marginTop: 12, fontSize: 13 }}>
                {filter === 'tasks' ? 'No tasks yet' : 'No messages yet. Start the conversation.'}
              </p>
            </div>
          ) : (
            items.map((item, idx) => {
              if (item.type === 'date') {
                return (
                  <div key={`date-${idx}`} className="cc-date-divider">
                    <span>{item.label}</span>
                  </div>
                );
              }
              const msg = item.msg;
              const isOwn  = msg.sender_role === userRole;
              const isDone = msg.status === 'done';
              return (
                <div key={msg.id} className={`cc-msg-row ${isOwn ? 'cc-msg-row--own' : ''}`}>
                  {/* Avatar for other side */}
                  {!isOwn && (
                    <div className={`cc-avatar cc-avatar--${msg.sender_role === 'doctor' ? 'doctor' : 'secretary'}`}>
                      {msg.sender_role === 'doctor' ? 'Dr' : 'Se'}
                    </div>
                  )}

                  <div className="cc-msg-group">
                    {!isOwn && (
                      <div className="cc-msg-sender">
                        {msg.sender_role === 'doctor' ? 'Doctor' : 'Secretary'}
                      </div>
                    )}
                    <div className={`cc-bubble ${isOwn ? 'cc-bubble--own' : 'cc-bubble--other'} ${isDone ? 'cc-bubble--done' : ''} ${msg.is_task ? 'cc-bubble--task' : ''}`}>
                      {msg.is_task && (
                        <div className={`cc-task-label ${isDone ? 'cc-task-label--done' : ''}`}>
                          {isDone ? (
                            <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> Done</>
                          ) : (
                            <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/></svg> Task</>
                          )}
                        </div>
                      )}
                      <div className={`cc-bubble-text ${isDone ? 'cc-bubble-text--done' : ''}`}>{msg.text}</div>
                      {msg.is_task && !isDone && !msg._optimistic && !isOwn && (
                        <button className="cc-done-btn" onClick={() => handleMarkDone(msg.id)}>
                          Mark as done
                        </button>
                      )}
                    </div>
                    <div className="cc-msg-time">
                      {msg._optimistic ? 'Sending…' : fmtTime(msg.created_at)}
                    </div>
                  </div>

                  {/* Avatar for own side */}
                  {isOwn && (
                    <div className={`cc-avatar cc-avatar--${userRole === 'doctor' ? 'doctor' : 'secretary'}`}>
                      {userRole === 'doctor' ? 'Dr' : 'Se'}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── Input ── */}
        <div className="cc-input-bar">
          <button
            className={`cc-task-toggle ${isTask ? 'cc-task-toggle--active' : ''}`}
            onClick={() => setIsTask(v => !v)}
            title={isTask ? 'Switch to regular message' : 'Send as task'}
          >
            {isTask ? (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 11 12 14 22 4"/></svg> Task</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Msg</>
            )}
          </button>
          <input
            ref={inputRef}
            className="cc-input"
            placeholder={isTask ? 'Describe a task for the other person…' : `Message as ${userRole}…`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={loading}
            autoFocus
          />
          <button className="cc-send-btn" onClick={handleSend} disabled={!input.trim() || loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
};

export default ClinicChat;
