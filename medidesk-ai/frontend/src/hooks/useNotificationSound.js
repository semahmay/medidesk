/**
 * useNotificationSound.js
 * Messenger/Slack-style subtle notification sounds.
 * Uses Web Audio API for modern, lightweight audio without external files.
 */

import { useCallback, useState } from 'react';

const SOUND_ENABLED_KEY = 'medidesk_notification_sound_enabled';
const THROTTLE_MS = 2000;
let _lastPlayTime = 0;
let _audioCtx = null;

function getAudioContext() {
  if (!_audioCtx && typeof window !== 'undefined') {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      _audioCtx = new AC();
    } catch {
      return null;
    }
  }
  return _audioCtx;
}

function playTone(frequency, duration, type = 'sine', volume = 0.08) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playChime(freq1, freq2, duration1, duration2, delay) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [freq1, freq2].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + delay * i);
    gain.gain.setValueAtTime(0.07, now + delay * i);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay * i + (i === 0 ? duration1 : duration2));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + delay * i);
    osc.stop(now + delay * i + (i === 0 ? duration1 : duration2));
  });
}

export function getSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {}
}

const SOUNDS = {
  patient: () => playChime(520, 660, 0.12, 0.15, 0.1),
  appointment_created: () => playChime(440, 660, 0.1, 0.18, 0.12),
  appointment_updated: () => playChime(440, 550, 0.1, 0.12, 0.1),
  appointment_cancelled: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.linearRampToValueAtTime(300, now + 0.15);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  },
  message: () => playTone(600, 0.08, 'sine', 0.05),
  default: () => playChime(480, 620, 0.1, 0.12, 0.1),
};

export function useNotificationSound() {
  const [enabled, setEnabledState] = useState(getSoundEnabled);

  const toggleSound = useCallback((val) => {
    const v = val !== undefined ? val : !enabled;
    setSoundEnabled(v);
    setEnabledState(v);
  }, [enabled]);

  const playSound = useCallback((type = 'default') => {
    if (!enabled) return;
    const now = Date.now();
    if (now - _lastPlayTime < THROTTLE_MS) return;
    _lastPlayTime = now;

    try {
      const soundFn = SOUNDS[type] || SOUNDS.default;
      soundFn();
    } catch {
      // Silently fail — audio is non-critical
    }
  }, [enabled]);

  return { enabled, toggleSound, playSound };
}

export default useNotificationSound;
