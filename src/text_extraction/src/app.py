from flask import Flask, request, jsonify
from pipeline import EmailProcessingPipeline
import json
from pathlib import Path

app = Flask(__name__)
pipeline = EmailProcessingPipeline()

OUTPUT_JSON_PATH = Path("output_email.json")


@app.route("/process-email", methods=["POST"])
def process_email():
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "Missing JSON request body"}), 400

    try:
        email_data = pipeline.process_backend_payload(data)

        with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(email_data, f, ensure_ascii=False, indent=2, default=str)

        return jsonify({
            "message": "Email processed successfully",
            "saved_to": str(OUTPUT_JSON_PATH),
            "email_data": email_data
        }), 200

    except Exception as e:
        return jsonify({
            "error": "Failed to process email",
            "details": str(e)
        }), 500


if __name__ == "__main__":
    # use_reloader=False so Electron can reliably terminate a single Python process on quit.
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)