import requests
import time

BASE_URL = "http://127.0.0.1:5001"

def test_speak():
    """Test basic email playback."""
    print("\n=== Test 1: Basic Speak ===")
    print("Starting basic speak test...")
    response = requests.post(f"{BASE_URL}/speak", json={
        "sender": "Elham Honarvar",
        "subject": "Project Update",
        "body": "This is a basic speak test. The TTS module will now read this email from Elham Honarvar about the project update. Please listen to confirm the voice and speed are correct.",
        "attachments": [],
        "voice": "Samantha (US)",
        "speed": "normal"
    })
    print(response.json())
    time.sleep(25)
    print("Test 1 done!")

def test_preferences():
    """Test saving and loading preferences."""
    print("\n=== Test 2: Preferences ===")
    print("Saving Daniel UK with slow speed as default preference...")
    response = requests.post(f"{BASE_URL}/preferences", json={
        "voice": "Daniel (UK)",
        "speed": "slow"
    })
    print("Saved:", response.json())

    response = requests.get(f"{BASE_URL}/preferences")
    print("Loaded:", response.json())

    print("Playing with saved preferences. Voice should be Daniel UK at slow speed...")
    response = requests.post(f"{BASE_URL}/speak", json={
        "sender": "Test",
        "subject": "Preference Test",
        "body": "This is a preference test. This email should be read by Daniel in slow speed, which was saved as the default preference. If you hear Daniel speaking slowly, the preference test passed successfully.",
        "attachments": []
    })
    print(response.json())
    time.sleep(50)
    print("Test 2 done!")

def test_pause_resume():
    """Test pause and resume during playback."""
    print("\n=== Test 3: Pause & Resume ===")
    print("Starting pause and resume test...")
    requests.post(f"{BASE_URL}/speak", json={
        "sender": "Test",
        "subject": "Pause Resume Test",
        "body": "This is a pause and resume test. The reading will pause after a few seconds. After three seconds of silence it will resume from where it stopped.",
        "attachments": [],
        "voice": "Samantha (US)",
        "speed": "slow"
    })

    time.sleep(5)
    response = requests.post(f"{BASE_URL}/pause", json={})
    print("Pause response:", response.json()) 
    time.sleep(0.5)
    print("Pausing now...")

    time.sleep(3) 

    response = requests.post(f"{BASE_URL}/resume", json={})
    print("Resume response:", response.json())
    time.sleep(0.5)
    print("Resuming now...")

    time.sleep(25)
    requests.post(f"{BASE_URL}/stop", json={})  
    time.sleep(1)
    print("Test 3 done!")

def test_skip():
    """Test skip during unread emails playback."""
    print("\n=== Test 4: Skip ===")
    print("Starting skip test with two emails...")
    requests.post(f"{BASE_URL}/speak/unread", json={
        "emails": [
            {
                "sender": "Elham",
                "subject": "First Email",
                "body": "This is the first email in the skip test. This email will be skipped after a few seconds. The second email should start playing automatically after the skip.",
                "attachments": []
            },
            {
                "sender": "John",
                "subject": "Second Email",
                "body": "This is the second email in the skip test. If you can hear this, the skip function worked correctly.",
                "attachments": []
            }
        ],
        "voice": "Samantha (US)",
        "speed": "slow"
    })

    time.sleep(5)
    response = requests.post(f"{BASE_URL}/skip", json={})
    print("Skip response:", response.json())
    time.sleep(0.5)
    print("Skipping to next email...")
    time.sleep(50)
    print("Test 4 done!")

def test_replay():
    """Test replay current email."""
    print("\n=== Test 5: Replay ===")
    print("Starting replay test. Playing Test 1 email first...")

    requests.post(f"{BASE_URL}/speak", json={
        "sender": "Elham Honarvar",
        "subject": "Project Update",
        "body": "This is a basic speak test. The TTS module will now read this email from Elham Honarvar about the project update.",
        "attachments": [],
        "voice": "Samantha (US)",
        "speed": "normal"
    })

    time.sleep(20)
    requests.post(f"{BASE_URL}/stop", json={})
    time.sleep(2)
    print("Replaying from beginning. You should hear the same email again...")
    response = requests.post(f"{BASE_URL}/replay", json={})
    print(response.json())
    time.sleep(25)
    print("Test 5 done!")

def test_empty_inbox():
    """Test empty inbox handling."""
    print("\n=== Test 6: Empty Inbox ===")
    print("Starting empty inbox test. You should hear a voice message...")
    response = requests.post(f"{BASE_URL}/speak/unread", json={
        "emails": [],
        "voice": "Samantha (US)",
        "speed": "normal"
    })
    print(response.json())
    time.sleep(5)
    print("Test 6 done!")

if __name__ == "__main__":
    print("Starting TTS Module Tests...")
    print("Make sure tts.py server is running on http://127.0.0.1:5000")

    test_speak()
    test_preferences()
    test_pause_resume()
    test_skip()
    test_replay()
    test_empty_inbox()

    print("\nAll tests completed!")