import requests
import json
import sys

# Get the input file name from command line
if len(sys.argv) < 2:
    print("Usage: python test_pipeline.py <file_name>")
    exit()

file_name = sys.argv[1]

# Load JSON payload from file
with open(file_name, 'r', encoding='utf-8') as f:
    payload = json.load(f)

# Send request to Eli's text extraction API
response = requests.post('http://127.0.0.1:5000/process-email',
    json=payload
)

email_data = response.json()
print("Extracted email data:", email_data)

# Send extracted email data to Ayana's TTS API
tts_response = requests.post('http://127.0.0.1:5001/speak', json=email_data['email_data'])
print("TTS response:", tts_response.json())