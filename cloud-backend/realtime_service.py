"""
realtime_service.py — Production-hardened WebSocket layer via Flask-SocketIO.

Architecture:
  - Each clinic gets its own SocketIO room: "clinic_<clinic_id>"
  - Clients join their room on connect (JWT verified)
  - Server emits events to the room on data changes
  - Redis pub/sub used as message broker (required for multi-worker Gunicorn)
  - At-least-once delivery: events include a sequence number stored in Redis
  - Clients can request missed events since last_seq on reconnect

Delivery guarantee: AT-LEAST-ONCE
  - Server stores last N events per clinic in Redis (TTL 1 hour)
  - On reconnect, client sends { last_seq } and server replays missed events
  - Client deduplicates by seq number

Events emitted to clients:
  patient_updated   { seq, global_id, clinic_id, updated_by, updated_at }
  patient_created   { seq, global_id, clinic_id, full_name }
  patient_deleted   { seq, global_id, clinic_id }
  message_new       { seq, id, clinic_id, sender_role, text, is_task, created_at }
  appointment_new   { seq, global_id, clinic_id, patient_name, date, start_time }
  appointment_updated { seq, global_id, clinic_id, status }
  notification_new  { seq, id, clinic_id, type, title, message }
  missed_events     { events: [...] }  — sent on reconnect with missed items
"""

import os
import json
import time
import logging
from flask_socketio import SocketIO, join_room, emit
from auth_service import verify_token

logger = logging.getLogger("realtime")

REDIS_URL = os.getenv("REDIS_URL")
_use_redis = bool(REDIS_URL)

# Max events stored per clinic for replay (at-least-once delivery)
EVENT_BUFFER_SIZE = 200
EVENT_BUFFER_TTL  = 3600  # 1 hour

socketio = SocketIO(
    cors_allowed_origins="*",
    message_queue=REDIS_URL if _use_redis else None,
    async_mode="eventlet",
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
)

# ── Redis event buffer (at-least-once delivery) ───────────────────────────────

_redis_client = None

def _get_redis():
    global _redis_client
    if _redis_client is None and _use_redis:
        import redis
        _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


def _next_seq(clinic_id: str) -> int:
    """Atomically increment and return the next sequence number for a clinic."""
    r = _get_redis()
    if not r:
        return int(time.time() * 1000)  # fallback: millisecond timestamp
    return r.incr(f"seq:{clinic_id}")


def _buffer_event(clinic_id: str, seq: int, event: str, data: dict) -> None:
    """Store event in Redis list for replay. Trims to EVENT_BUFFER_SIZE."""
    r = _get_redis()
    if not r:
        return
    key = f"events:{clinic_id}"
    entry = json.dumps({"seq": seq, "event": event, "data": data, "ts": time.time()})
    pipe = r.pipeline()
    pipe.rpush(key, entry)
    pipe.ltrim(key, -EVENT_BUFFER_SIZE, -1)
    pipe.expire(key, EVENT_BUFFER_TTL)
    pipe.execute()


def _get_missed_events(clinic_id: str, since_seq: int) -> list[dict]:
    """Return all buffered events with seq > since_seq."""
    r = _get_redis()
    if not r:
        return []
    key = f"events:{clinic_id}"
    raw = r.lrange(key, 0, -1)
    missed = []
    for entry in raw:
        try:
            item = json.loads(entry)
            if item.get("seq", 0) > since_seq:
                missed.append(item)
        except Exception:
            pass
    return missed


# ── Public API ────────────────────────────────────────────────────────────────

def emit_to_clinic(clinic_id: str, event: str, data: dict) -> None:
    """
    Emit an event to all connected clients in a clinic room.
    Assigns a sequence number and buffers for at-least-once delivery.
    Safe to call from any Flask route.
    """
    seq = _next_seq(clinic_id)
    payload = {"seq": seq, **data}
    _buffer_event(clinic_id, seq, event, payload)
    room = f"clinic_{clinic_id}"
    socketio.emit(event, payload, room=room)
    logger.debug(f"[realtime] emit clinic={clinic_id} event={event} seq={seq}")


# ── Socket event handlers ─────────────────────────────────────────────────────

@socketio.on("connect")
def on_connect(auth):
    """
    Client connects with JWT in auth dict: { token: "Bearer ..." }
    Verifies token, joins clinic room, and replays missed events if last_seq provided.
    """
    token_header = (auth or {}).get("token", "")
    token = token_header.removeprefix("Bearer ").strip()

    payload = verify_token(token) if token else None
    if not payload or payload.get("type") != "access":
        logger.warning("[realtime] rejected connection — invalid token")
        return False

    clinic_id = payload.get("clinic_id")
    if not clinic_id:
        return False

    room = f"clinic_{clinic_id}"
    join_room(room)

    # Replay missed events if client provides last_seq
    last_seq = int((auth or {}).get("last_seq", 0))
    if last_seq > 0:
        missed = _get_missed_events(clinic_id, last_seq)
        if missed:
            emit("missed_events", {"events": missed})
            logger.info(f"[realtime] replayed {len(missed)} missed events to clinic={clinic_id}")

    emit("connected", {
        "clinic_id": clinic_id,
        "room": room,
        "current_seq": _next_seq(clinic_id) - 1,  # last issued seq
    })
    logger.info(f"[realtime] client joined clinic={clinic_id}")


@socketio.on("disconnect")
def on_disconnect():
    # SocketIO handles room cleanup automatically on disconnect
    pass


@socketio.on("rejoin")
def on_rejoin(data):
    """
    Client sends { token, last_seq } after a network drop to rejoin room
    and receive missed events without a full page reload.
    """
    token = (data or {}).get("token", "").removeprefix("Bearer ").strip()
    payload = verify_token(token) if token else None
    if not payload or payload.get("type") != "access":
        emit("rejoin_error", {"error": "Invalid token"})
        return

    clinic_id = payload.get("clinic_id")
    if not clinic_id:
        return

    room = f"clinic_{clinic_id}"
    join_room(room)

    last_seq = int((data or {}).get("last_seq", 0))
    missed = _get_missed_events(clinic_id, last_seq) if last_seq > 0 else []
    if missed:
        emit("missed_events", {"events": missed})

    emit("rejoined", {"clinic_id": clinic_id, "replayed": len(missed)})
    logger.info(f"[realtime] client rejoined clinic={clinic_id}, replayed={len(missed)}")


@socketio.on("ping_clinic")
def on_ping(data):
    """Lightweight heartbeat — client sends, server echoes back with server timestamp."""
    emit("pong_clinic", {"ts": data.get("ts"), "server_ts": time.time()})
