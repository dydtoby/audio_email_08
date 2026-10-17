# TTS Module - Audio Emailer

Text-to-Speech module for the Audio Emailer application.
Converts email content to speech using pyttsx3 (Windows/Linux) and macOS `say` command (Mac).

---

## Setup
```bash
pip install flask pyttsx3
python tts.py
```

Server runs on `http://127.0.0.1:5001`

---

## API Endpoints

### POST /speak
Converts email data to speech.

**Request:**
```json
{
    "sender": "John Smith",
    "subject": "Project Notification",
    "body": "Hello! This is the email body.",
    "attachments": [],
    "voice": "Daniel (UK)",
    "speed": "normal"
}
```

**Voice options:** `"Daniel (UK)"`, `"Reed (US)"`, `"Samantha (US)"`

**Speed options:** `"slow"` (0.5x), `"normal"` (1.0x), `"fast"` (1.5x)

**Response:**
```json
{
    "status": "started",
    "text": "From: John Smith. Subject: ...",
    "voice": "Daniel (UK)",
    "speed": "normal"
}
```

---

### GET /voices
Returns list of available voice options.

**Response:**
```json
{
    "voices": ["Daniel (UK)", "Reed (US)", "Samantha (US)"]
}
```

---

### POST /pause
Pauses current playback.

### POST /resume
Resumes paused playback.

### POST /stop
Stops current playback.

### POST /skip
Skips current email (used with /speak/unread).

### POST /replay
Replays current email from the beginning.

---

### GET /preferences
Returns saved user preferences.

### POST /preferences
Saves user preferences.

**Request:**
```json
{
    "voice": "Samantha (US)",
    "speed": "fast"
}
```

---

### POST /speak/unread
Reads all unread emails sequentially.

**Request:**
```json
{
    "emails": [...],
    "voice": "Samantha (US)",
    "speed": "normal"
}
```

---

## Reading Order
Email is read in this order:
1. Sender
2. Date
3. Subject
4. Body
5. Attachments (titles only)

---

## Platform Notes
- **Mac**: Uses built-in `say` command for better voice quality
- **Windows/Linux**: Uses pyttsx3
- On Windows, install English voice pack for best experience:
  Settings → Time & Language → Speech → Add voices

---

## Pipeline Integration
Works with Elli's text extraction module:
```python
import requests

with open('email.html', 'r', encoding='utf-8') as f:
    html_content = f.read()

# Send to Elli's extraction API
response = requests.post('http://127.0.0.1:5000/process-email', json={"html": html_content})
email_data = response.json()

# Send to TTS API
tts_response = requests.post('http://127.0.0.1:5001/speak', json=email_data['email_data'])
```

---

## Testing
```bash
# Run TTS module tests
python test_tts.py

# Run full pipeline test with Elli's module
python test_pipeline.py
```