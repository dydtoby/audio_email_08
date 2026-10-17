from flask import Flask, request, jsonify
import pyttsx3
import threading
import time
import re
import platform
import subprocess
import json
import signal
import os
from typing import List, Optional

app = Flask(__name__)

# Initialize engine once globally
engine = pyttsx3.init()
engine_lock = threading.Lock()
state_lock = threading.Lock()

# Playback state
is_speaking = False
is_paused = False
stop_flag = False
skip_flag = False

current_email_text = None
current_voice = "Daniel"
current_speed = "normal"
current_pause_enabled = False
current_pause_seconds = 0.7
current_sequence = []
current_position = 0
current_process = None

# Batch / unread mode state
playback_mode = "idle"          # idle, single, batch
batch_emails = []
batch_index = -1                # current email index in batch
current_email_index = None      # alias for UI/debugging
total_emails_in_batch = 0

# Available voice options
VOICES = {
    "Daniel (UK)": "Daniel",
    "Reed (US)": "Reed",
    "Samantha (US)": "Samantha",
}

# Speed options
SPEEDS = {
    "slow": 100,
    "normal": 150,
    "fast": 200,
}

# Stub text from fetchEmails before body is loaded
STUB_TEXT = "Click to read full email content..."
PREFERENCES_FILE = 'preferences.json'
DEFAULT_PREFERENCES = {
    "voice": "Daniel (UK)",
    "speed": "normal",
    "pauseEnabled": False,
    "pauseSeconds": 0.7,
}

# Helpers

def success_response(status: str, message: str, data: Optional[dict] = None, code: int = 200):
    return jsonify({
        "success": True,
        "status": status,
        "message": message,
        "data": data or {}
    }), code


def error_response(message: str, code: int = 400, status: str = "error", data: Optional[dict] = None):
    return jsonify({
        "success": False,
        "status": status,
        "message": message,
        "data": data or {}
    }), code

def parse_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        s = value.strip().lower()
        if s in ("true", "1", "yes", "y", "on"):
            return True
        if s in ("false", "0", "no", "n", "off"):
            return False
    return default

def normalize_pause_settings(pause_enabled, pause_seconds):
    enabled = parse_bool(pause_enabled, DEFAULT_PREFERENCES["pauseEnabled"])
    try:
        seconds = float(pause_seconds)
    except (TypeError, ValueError):
        seconds = DEFAULT_PREFERENCES["pauseSeconds"]
    seconds = max(0.0, min(10.0, seconds))
    return enabled, seconds

def save_preferences(voice: str, speed: str, pause_enabled: bool, pause_seconds: float):
    """Save user preferences to JSON file."""
    try:
        with open(PREFERENCES_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "voice": voice,
                    "speed": speed,
                    "pauseEnabled": pause_enabled,
                    "pauseSeconds": pause_seconds,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        return True, None
    except Exception as e:
        return False, str(e)

def load_preferences():
    """Load user preferences from JSON file."""
    try:
        if not os.path.exists(PREFERENCES_FILE):
            return DEFAULT_PREFERENCES.copy()

        with open(PREFERENCES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        voice = data.get("voice", DEFAULT_PREFERENCES["voice"])
        speed = data.get("speed", DEFAULT_PREFERENCES["speed"])
        pause_enabled, pause_seconds = normalize_pause_settings(
            data.get("pauseEnabled", DEFAULT_PREFERENCES["pauseEnabled"]),
            data.get("pauseSeconds", DEFAULT_PREFERENCES["pauseSeconds"]),
        )

        if voice not in VOICES:
            voice = DEFAULT_PREFERENCES["voice"]
        if speed not in SPEEDS:
            speed = DEFAULT_PREFERENCES["speed"]

        return {
            "voice": voice,
            "speed": speed,
            "pauseEnabled": pause_enabled,
            "pauseSeconds": pause_seconds,
        }
    except Exception:
        return DEFAULT_PREFERENCES.copy()

def validate_voice_speed(voice_display: str, speed: str):
    if voice_display not in VOICES:
        return False, f"Invalid voice. Choose from: {list(VOICES.keys())}"
    if speed not in SPEEDS:
        return False, f"Invalid speed. Choose from: {list(SPEEDS.keys())}"
    return True, None

def find_voice(engine, name_keyword: str):
    """Find voice by name keyword instead of hardcoded index."""
    voices = engine.getProperty('voices')
    for voice in voices:
        if name_keyword.lower() in voice.name.lower():
            return voice.id
    return voices[0].id  # Fallback to first voice

def split_for_tts(text: str, pause_enabled: bool = True, pause_seconds: float = 0.7):
    """Split text into spoken chunks and pause markers."""

    def append_text_with_sentence_pauses(chunk_text: str):
        cleaned_chunk = chunk_text.strip()
        if not cleaned_chunk:
            return
        if not pause_enabled:
            sequence.append(("text", cleaned_chunk))
            return
        parts = re.split(r'(?<=[.!?。！？])\s+', cleaned_chunk)
        parts = [p.strip() for p in parts if p and p.strip()]
        for idx, p in enumerate(parts):
            sequence.append(("text", p))
            if idx < len(parts) - 1:
                sequence.append(("pause", pause_seconds))

    parts = re.split(r'(\n\n|\n)', text)
    sequence = []
    for part in parts:
        if not part:
            continue
        if part == '\n':
            sequence.append(("pause", 0.35))
        elif part == '\n\n':
            if pause_enabled:
                sequence.append(("pause", pause_seconds))
        else:
            append_text_with_sentence_pauses(part)
    return sequence

def clean_text(text: str) -> str:
    """Clean and normalize text for TTS playback while preserving newlines."""
    text = text or ""
    text = text.replace('$', ' dollars ')
    text = text.replace('%', ' percent ')
    text = text.replace('&', ' and ')
    text = text.replace('@', ' at ')
    text = text.replace('^', ' ')
    text = text.replace('\u2019', "'")
    text = text.replace('\u2014', ', ')
    text = text.replace('Image:', 'Image attached. ')
    text = text.replace('Image detected', 'Image attached. ')

    # Normalize hyperlink markers
    text = re.sub(r'(?i)hyperlink detected\s*:?\s*', 'Link attached. ', text)
    text = re.sub(r'(?i)hyperlink\s*:?\s*', 'Link attached. ', text)

    # Remove noisy suffix/punctuation around link markers
    text = re.sub(r'Link attached\.\s*:\s*[^.\n]+', 'Link attached.', text)
    text = re.sub(r'Link attached\.\s*[.:]+\s*', 'Link attached. ', text)

    # Collapse repeated markers
    text = re.sub(r'(?:Link attached\.\s*){2,}', 'Link attached. ', text)

    # Normalize spaces but preserve line breaks
    text = re.sub(r'[ \t]+', ' ', text)        # spaces/tabs only
    text = re.sub(r'\n{3,}', '\n\n', text)     # max two newlines
    text = re.sub(r' *\n *', '\n', text)       # trim around newlines

    return text.strip()

def _spoken_lines(items) -> List[str]:
    """Speech-only labels: use spoken_name on dict items; ignore other fields (file_type, original_name, text, label, url, src, alt)."""
    if not items or not isinstance(items, list):
        return []
    out: List[str] = []
    for item in items:
        if isinstance(item, dict):
            sn = str(item.get("spoken_name") or "").strip()
            if sn:
                out.append(sn)
    return out


def _link_spoken_line(item) -> str:
    """Prefer pipeline spoken_name; else derive from text/label (matches pipeline._link_spoken_name). Skip data: URLs."""
    if not isinstance(item, dict):
        return ""
    sn = str(item.get("spoken_name") or "").strip()
    if sn:
        return sn
    url = str(item.get("url") or "").strip()
    if url.startswith("data:"):
        return ""
    text = str(item.get("text") or "").strip()
    label = str(item.get("label") or "").strip()
    title = text or label
    if title:
        return f"link is {title}"
    return ""


def _attachment_spoken_lines(attachments) -> List[str]:
    return _spoken_lines(attachments)


def _links_spoken_lines(links) -> List[str]:
    if not links or not isinstance(links, list):
        return []
    out: List[str] = []
    for item in links:
        line = _link_spoken_line(item)
        if line:
            out.append(line)
    return out


def _images_spoken_lines(images) -> List[str]:
    return _spoken_lines(images)


def build_text(email_data: dict) -> str:
    """Build readable text from pipeline / html2text email_data.

    Read order: receiver, sender, subject, date, body,
    attachments[*].spoken_name,
    links[*].spoken_name (or text/label fallback; data: URLs skipped).
    `images` is intentionally NOT read aloud.
    Date: if already speech-formatted (e.g. \"sent on …\"), do not add a \"Date \" prefix.
    """
    header_lines: List[str] = []

    receiver = str(email_data.get("receiver") or "").strip()
    if receiver:
        header_lines.append(receiver)

    sender = str(email_data.get("sender") or "").strip()
    if sender:
        header_lines.append(sender)

    subject = str(email_data.get("subject") or "").strip()
    if subject:
        header_lines.append(subject)

    date = str(email_data.get("date") or "").strip()
    if date:
        # Pipeline format_date_for_speech already returns e.g. "sent on 2026-03-23" — do not prefix again.
        dl = date.lower()
        if dl.startswith("sent on") or dl.startswith("date "):
            header_lines.append(date)
        else:
            header_lines.append(f"Date {date}")

    body = clean_text(email_data.get("body", ""))

    text = ""
    if header_lines:
        text = "\n".join(header_lines) + "\n\n"
    text += body

    attachments = email_data.get("attachments") or email_data.get("attachement", [])
    spoken_att = _attachment_spoken_lines(attachments)
    if spoken_att:
        text += f"\n\nAttachments: {', '.join(spoken_att)}"

    link_lines = _links_spoken_lines(email_data.get("links") or [])
    if link_lines:
        text += f"\n\nLinks: {', '.join(link_lines)}"

    # images are intentionally not read aloud.

    return text

def reset_runtime_flags():
    global stop_flag, skip_flag, is_paused
    stop_flag = False
    skip_flag = False
    is_paused = False

def terminate_current_process():
    """Terminate current macOS say process if alive."""
    global current_process

    if platform.system() == "Darwin" and current_process and current_process.poll() is None:
        try:
            os.kill(current_process.pid, signal.SIGCONT)
        except ProcessLookupError:
            pass

        try:
            current_process.terminate()
        except Exception:
            pass

    current_process = None

def set_idle_state():
    global is_speaking, is_paused, stop_flag, skip_flag
    global playback_mode, batch_emails, batch_index, current_email_index, total_emails_in_batch
    global current_process

    with state_lock:
        is_speaking = False
        is_paused = False
        stop_flag = False
        skip_flag = False
        playback_mode = "idle"
        batch_emails = []
        batch_index = -1
        current_email_index = None
        total_emails_in_batch = 0
        current_process = None

def playback_status_dict():
    with state_lock:
        return {
            "is_speaking": is_speaking,
            "is_paused": is_paused,
            "playback_mode": playback_mode,
            "current_position": current_position,
            "has_current_email": current_email_text is not None,
            "voice": current_voice,
            "speed": current_speed,
            "pauseEnabled": current_pause_enabled,
            "pauseSeconds": current_pause_seconds,
            "current_email_index": current_email_index,
            "total_emails_in_batch": total_emails_in_batch,
            "can_pause": is_speaking and not is_paused,
            "can_resume": (not is_speaking) and is_paused,
            "can_stop": is_speaking,
            "can_replay": current_email_text is not None,
            "can_skip": is_speaking,
        }

def speak_text_sequence(sequence: list, start_index: int = 0, voice_name: str = "Daniel", speed: str = "normal"):
    """
    Speak from current_sequence[start_index:].
    Returns:
        "completed" | "stopped" | "skipped" | "paused"
    """
    global is_speaking, stop_flag, skip_flag, is_paused
    global current_voice, current_speed, current_sequence, current_position, current_process

    with state_lock:
        is_speaking = True
        current_voice = voice_name
        current_speed = speed
        current_sequence = sequence

        if start_index < 0:
            start_index = 0
        if start_index >= len(sequence):
            return "completed"

        current_position = start_index

    try:
        with engine_lock:
            for i in range(start_index, len(sequence)):
                kind, value = sequence[i]

                with state_lock:
                    current_position = i

                if stop_flag:
                    return "stopped"
                if skip_flag:
                    return "skipped"
                if is_paused:
                    terminate_current_process()
                    return "paused"

                if kind == "text":
                    print(f"Speaking chunk {i}: {value[:80]}...")

                    if platform.system() == "Darwin":
                        mac_speeds = {"slow": 80, "normal": 120, "fast": 160}
                        rate = mac_speeds.get(speed, 120)

                        current_process = subprocess.Popen(
                            ["say", "-v", voice_name, "-r", str(rate), value]
                        )

                        while current_process and current_process.poll() is None:
                            if stop_flag:
                                terminate_current_process()
                                return "stopped"
                            if skip_flag:
                                terminate_current_process()
                                return "skipped"
                            if is_paused:
                                terminate_current_process()
                                return "paused"
                            time.sleep(0.05)

                        current_process = None

                    else:
                        voice_id = find_voice(engine, voice_name)
                        engine.setProperty("voice", voice_id)
                        engine.setProperty("rate", SPEEDS.get(speed, 150))
                        engine.say(value)
                        engine.runAndWait()

                        if stop_flag:
                            return "stopped"
                        if skip_flag:
                            return "skipped"
                        if is_paused:
                            return "paused"

                elif kind == "pause":
                    remaining = value
                    while remaining > 0:
                        if stop_flag:
                            return "stopped"
                        if skip_flag:
                            return "skipped"
                        if is_paused:
                            return "paused"

                        step = min(0.05, remaining)
                        time.sleep(step)
                        remaining -= step

        return "completed"

    finally:
        terminate_current_process()

def speak_single(
    email_text: str,
    voice_name: str,
    speed: str,
    pause_enabled: bool,
    pause_seconds: float,
    start_index: int = 0,
):
    """Background worker for single email playback."""
    global is_speaking, playback_mode, is_paused, stop_flag, skip_flag
    global current_email_text, current_sequence, current_pause_enabled, current_pause_seconds

    with state_lock:
        playback_mode = "single"
        current_email_text = email_text
        current_pause_enabled = pause_enabled
        current_pause_seconds = pause_seconds

        if start_index == 0 or not current_sequence:
            current_sequence = split_for_tts(email_text, pause_enabled, pause_seconds)

    result = speak_text_sequence(
        sequence=current_sequence,
        start_index=start_index,
        voice_name=voice_name,
        speed=speed
    )

    with state_lock:
        if result == "paused":
            is_speaking = False
            is_paused = True
            playback_mode = "single"

        elif result in ("completed", "stopped", "skipped"):
            is_paused = False
            is_speaking = False
            playback_mode = "idle"

            if result in ("completed", "stopped"):
                current_position = 0

        stop_flag = False
        skip_flag = False

    print(f"Single playback finished with result: {result}")

def speak_batch(
    emails: list,
    voice_name: str,
    speed: str,
    pause_enabled: bool,
    pause_seconds: float,
    start_email_index: int = 0,
    start_chunk_index: int = 0,
):
    """Background worker for unread/batch playback."""
    global batch_emails, batch_index, current_email_index, total_emails_in_batch
    global is_speaking, playback_mode, stop_flag, skip_flag, is_paused
    global current_email_text, current_sequence, current_position, current_pause_enabled, current_pause_seconds

    with state_lock:
        playback_mode = "batch"
        batch_emails = emails
        total_emails_in_batch = len(emails)
        is_speaking = True
        stop_flag = False
        skip_flag = False
        current_pause_enabled = pause_enabled
        current_pause_seconds = pause_seconds

    try:
        for idx in range(start_email_index, len(emails)):
            email = emails[idx]

            with state_lock:
                batch_index = idx
                current_email_index = idx
                current_email_text = build_text(email)

                if idx != start_email_index:
                    current_sequence = split_for_tts(current_email_text, pause_enabled, pause_seconds)
                    current_position = 0

            if stop_flag:
                break

            if idx == start_email_index and current_sequence and start_chunk_index < len(current_sequence):
                seq = current_sequence
                chunk_start = start_chunk_index
            else:
                seq = split_for_tts(current_email_text, pause_enabled, pause_seconds)
                with state_lock:
                    current_sequence = seq
                chunk_start = 0

            result = speak_text_sequence(
                sequence=seq,
                start_index=chunk_start,
                voice_name=voice_name,
                speed=speed
            )

            if result == "stopped":
                break
            elif result == "skipped":
                with state_lock:
                    skip_flag = False
                    current_position = 0
                continue
            elif result == "paused":
                with state_lock:
                    is_speaking = False
                    is_paused = True
                    playback_mode = "batch"
                return
            elif result == "completed":
                with state_lock:
                    current_position = 0
                continue

    finally:
        if not is_paused:
            set_idle_state()
            print("Batch playback finished")

@app.route("/status", methods=["GET"])
def get_status():
    return success_response(
        status="ok",
        message="Playback status retrieved",
        data=playback_status_dict()
    )

@app.route("/voices", methods=["GET"])
def get_voices():
    return success_response(
        status="ok",
        message="Available voices retrieved",
        data={"voices": list(VOICES.keys())}
    )

@app.route("/speeds", methods=["GET"])
def get_speeds():
    return success_response(
        status="ok",
        message="Available speeds retrieved",
        data={"speeds": list(SPEEDS.keys())}
    )

@app.route('/preferences', methods=['GET'])
def get_preferences():
    """Get saved user preferences."""
    prefs = load_preferences()
    return success_response(
        status="ok",
        message="Preferences retrieved",
        data=prefs
    )

@app.route('/preferences', methods=['POST'])
def set_preferences():
    """Save user preferences."""
    data = request.get_json(silent=True)
    if not data:
        return error_response("No data received", 400)
    
    current = load_preferences()
    voice = data.get('voice', current['voice'])
    speed = data.get('speed', current['speed'])
    pause_enabled, pause_seconds = normalize_pause_settings(
        data.get('pauseEnabled', current['pauseEnabled']),
        data.get('pauseSeconds', current['pauseSeconds']),
    )

    is_valid, error_msg = validate_voice_speed(voice, speed)
    if not is_valid:
        return error_response(error_msg, 400)

    ok, err = save_preferences(voice, speed, pause_enabled, pause_seconds)
    if not ok:
        return error_response(f"Failed to save preferences: {err}", 500)

    return success_response(
        status="saved",
        message="Preferences saved successfully",
        data={
            "voice": voice,
            "speed": speed,
            "pauseEnabled": pause_enabled,
            "pauseSeconds": pause_seconds,
        }
    )

@app.route("/speak", methods=["POST"])
def speak_email():
    global is_speaking

    data = request.get_json(silent=True)
    if not data:
        return error_response("No data received", 400)

    body = data.get("body", "")
    if "body" not in data or not body.strip() or body == STUB_TEXT:
        return error_response("Email body not loaded yet", 400)

    with state_lock:
        if is_speaking:
            return error_response("Already playing. Stop first.", 409)

    preferences = load_preferences()
    voice_display = data.get("voice", preferences["voice"])
    speed = data.get("speed", preferences["speed"])
    pause_enabled, pause_seconds = normalize_pause_settings(
        data.get("pauseEnabled", preferences["pauseEnabled"]),
        data.get("pauseSeconds", preferences["pauseSeconds"]),
    )

    is_valid, error_msg = validate_voice_speed(voice_display, speed)
    if not is_valid:
        return error_response(error_msg, 400)

    voice_keyword = VOICES[voice_display]
    email_text = build_text(data)

    with state_lock:
        reset_runtime_flags()

    threading.Thread(
        target=speak_single,
        args=(email_text, voice_keyword, speed, pause_enabled, pause_seconds, 0),
        daemon=True
    ).start()

    return success_response(
        status="started",
        message="Playback started",
        data={
            "text": email_text,
            "voice": voice_display,
            "speed": speed,
            "pauseEnabled": pause_enabled,
            "pauseSeconds": pause_seconds,
            "is_speaking": True,
            "is_paused": False,
            "playback_mode": "single"
        }
    )

@app.route('/pause', methods=['POST'])
def pause_playback():
    global is_paused, is_speaking

    with state_lock:
        if not is_speaking:
            return error_response("Nothing is currently playing", 400)
        if is_paused:
            return error_response("Playback is already paused", 400)

        is_paused = True
        is_speaking = False

    terminate_current_process()

    return success_response(
        status="paused",
        message="Playback paused",
        data=playback_status_dict()
    )

@app.route('/resume', methods=['POST'])
def resume_playback():
    global is_paused, is_speaking

    with state_lock:
        if not is_paused:
            return error_response("Playback is not paused", 400)
        if is_speaking:
            return error_response("Playback is already active", 409)

        mode = playback_mode
        voice_name = current_voice
        speed = current_speed
        pause_enabled = current_pause_enabled
        pause_seconds = current_pause_seconds
        email_text = current_email_text
        chunk_index = current_position
        emails = batch_emails[:]
        email_index = current_email_index if current_email_index is not None else 0

        is_paused = False
        is_speaking = True

    if mode == "single":
        if not email_text:
            return error_response("No paused email to resume", 400)

        threading.Thread(
            target=speak_single,
            args=(email_text, voice_name, speed, pause_enabled, pause_seconds, chunk_index),
            daemon=True
        ).start()

    elif mode == "batch":
        if not emails:
            return error_response("No paused batch to resume", 400)

        threading.Thread(
            target=speak_batch,
            args=(emails, voice_name, speed, pause_enabled, pause_seconds, email_index, chunk_index),
            daemon=True
        ).start()

    else:
        return error_response("Nothing to resume", 400)

    return success_response(
        status="resumed",
        message="Playback resumed from saved position",
        data={
            "playback_mode": mode,
            "current_position": chunk_index,
            "current_email_index": email_index
        }
    )

@app.route('/stop', methods=['POST'])
def stop_playback():
    global stop_flag, is_paused, is_speaking

    with state_lock:
        if not is_speaking:
            return error_response("Nothing is currently playing", 400)

        stop_flag = True
        is_paused = False

    terminate_current_process()

    return success_response(
        status="stopping",
        message="Stop requested",
        data=playback_status_dict()
    )


@app.route('/replay', methods=['POST'])
def replay_playback():
    global stop_flag, skip_flag, is_paused, is_speaking, current_position

    with state_lock:
        if not current_email_text:
            return error_response("No email to replay", 400)
        if is_speaking:
            return error_response("Cannot replay while playback is active. Stop first.", 409)

        stop_flag = False
        skip_flag = False
        is_paused = False
        current_position = 0

        email_text = current_email_text
        voice_name = current_voice
        speed = current_speed
        pause_enabled = current_pause_enabled
        pause_seconds = current_pause_seconds

    threading.Thread(
        target=speak_single,
        args=(email_text, voice_name, speed, pause_enabled, pause_seconds, 0),
        daemon=True
    ).start()

    return success_response(
        status="replaying",
        message="Replay started from beginning",
        data={
            "voice": voice_name,
            "speed": speed,
            "playback_mode": "single",
            "current_position": 0
        }
    )

@app.route('/skip', methods=['POST'])
def skip_playback():
    global skip_flag, is_paused, current_position

    with state_lock:
        if not is_speaking:
            return error_response("Nothing is currently playing", 400)

        current_mode = playback_mode

        if current_mode == "single":
            if current_sequence and current_position < len(current_sequence) - 1:
                current_position += 1
            skip_flag = True
        else:
            skip_flag = True

        is_paused = False

    terminate_current_process()

    if current_mode == "batch":
        msg = "Skip requested. Moving to next email."
    else:
        msg = "Skip requested. Moving to next chunk."

    return success_response(
        status="skipping",
        message=msg,
        data=playback_status_dict()
    )

@app.route('/speak/unread', methods=['POST'])
def speak_unread():
    """
    Read all unread emails.
    Expected JSON:
    {
        "emails": [...],
        "voice": "Samantha (US)",
        "speed": "normal"
    }
    """
    global is_speaking
    
    data = request.get_json(silent=True)
    if not data:
        return error_response("No data received", 400)
    
    with state_lock:
        if is_speaking:
            return error_response("Already playing. Stop first.", 409)

    emails = data.get("emails", [])

    preferences = load_preferences()
    voice_display = data.get("voice", preferences["voice"])
    speed = data.get("speed", preferences["speed"])
    pause_enabled, pause_seconds = normalize_pause_settings(
        data.get("pauseEnabled", preferences["pauseEnabled"]),
        data.get("pauseSeconds", preferences["pauseSeconds"]),
    )

    is_valid, error_msg = validate_voice_speed(voice_display, speed)
    if not is_valid:
        return error_response(error_msg, 400)

    voice_keyword = VOICES[voice_display]

    if not emails:
        no_emails_speech = "You have no unread emails at the moment."
        with state_lock:
            reset_runtime_flags()

        threading.Thread(
            target=speak_single,
            args=(no_emails_speech, voice_keyword, speed, pause_enabled, pause_seconds, 0),
            daemon=True
        ).start()

        return success_response(
            status="started",
            message="No unread emails available",
            data={
                "count": 0,
                "voice": voice_display,
                "speed": speed,
                "pauseEnabled": pause_enabled,
                "pauseSeconds": pause_seconds,
                "playback_mode": "single"
            }
        )

    with state_lock:
        reset_runtime_flags()

    threading.Thread(
        target=speak_batch,
        args=(emails, voice_keyword, speed, pause_enabled, pause_seconds, 0, 0),
        daemon=True
    ).start()

    return success_response(
        status="started",
        message="Unread email playback started",
        data={
            "count": len(emails),
            "voice": voice_display,
            "speed": speed,
            "pauseEnabled": pause_enabled,
            "pauseSeconds": pause_seconds,
            "playback_mode": "batch"
        }
    )

if __name__ == '__main__':
    app.run(debug=True, use_reloader=False, port=5001)