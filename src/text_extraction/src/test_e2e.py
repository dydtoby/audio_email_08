from pathlib import Path

from app import app


def test_single_email_end_to_end_no_false_attachment():
    client = app.test_client()

    payload = {
        "uid": 1001,
        "from": "Alice <alice@example.com>",
        "to": "Bob <bob@example.com>",
        "subject": "Monthly Report Update",
        "date": "2026-03-23T15:49:16.000Z",
        "html": """
        <html>
          <body>
            <div>From: Alice &lt;alice@example.com&gt;</div>
            <div>To: Bob &lt;bob@example.com&gt;</div>
            <div>Date: 2026-03-23T15:49:16.000Z</div>
            <div>Subject: Monthly Report Update</div>

            <p>Hello Bob,</p>
            <p>Please review the attached report.pdf before tomorrow.</p>
            <p>You can open the dashboard here:
              <a href="https://example.com/dashboard">Open dashboard</a>
            </p>
            <p>
              <img src="cid:team_chart.png" alt="Team performance chart" />
            </p>
          </body>
        </html>
        """
    }

    response = client.post("/process-email", json=payload)
    assert response.status_code == 200

    result = response.get_json()
    assert result["message"] == "Email processed successfully"
    email_data = result["email_data"]

    # Metadata
    assert email_data["uid"] == 1001
    assert "receiver" not in email_data
    assert email_data["sender"] == "sender is Alice alice@example.com"
    assert email_data["subject"] == "subject is Monthly Report Update"
    assert email_data["date"] == "sent on 2026-03-23"

    # Body
    assert email_data["body"].startswith("the content is ")
    assert "Hello Bob" in email_data["body"]
    assert "Please review the attached report.pdf before tomorrow." in email_data["body"]
    assert "Open dashboard" in email_data["body"]

    # Links
    assert email_data["number_of_detected_links"] == 1
    assert any(
        link.get("label") == "Open dashboard" and "example.com/dashboard" in link.get("url", "")
        for link in email_data["links"]
    )
    assert all("spoken_name" in link for link in email_data["links"])
    assert any(link.get("spoken_name") == "link is Open dashboard" for link in email_data["links"])

    # Images
    assert email_data["number_of_detected_images"] == 1
    assert any(
        image.get("alt") == "Team performance chart"
        for image in email_data["images"]
    )
    assert all("spoken_name" in image for image in email_data["images"])
    assert any(
        image.get("spoken_name") == "image is Team performance chart"
        for image in email_data["images"]
    )

    # Attachments
    # A filename merely mentioned in body text must NOT be treated as a real attachment.
    # Current attachment processor returns a placeholder spoken item when no attachment exists.
    assert len(email_data["attachments"]) == 1
    assert email_data["attachments"][0]["file_type"] == ""
    assert email_data["attachments"][0]["original_name"] == ""
    assert (
        email_data["attachments"][0]["spoken_name"]
        == "no attachment detected, number of detected links is 1 and number of detected images is 1"
    )

    # Saved output file exists
    assert Path("output_email.json").exists()


def test_single_email_end_to_end_with_real_attachment_section():
    client = app.test_client()

    payload = {
        "uid": 1002,
        "from": "Alice <alice@example.com>",
        "to": "Bob <bob@example.com>",
        "subject": "Project Files",
        "date": "2026-03-24T10:00:00.000Z",
        "html": """
        <html>
          <body>
            <div>From: Alice &lt;alice@example.com&gt;</div>
            <div>To: Bob &lt;bob@example.com&gt;</div>
            <div>Date: 2026-03-24T10:00:00.000Z</div>
            <div>Subject: Project Files</div>

            <p>Hello Bob,</p>
            <p>Please see the files below.</p>
            <div>Attachments: report.pdf, budget.xlsx</div>
          </body>
        </html>
        """
    }

    response = client.post("/process-email", json=payload)
    assert response.status_code == 200

    result = response.get_json()
    assert result["message"] == "Email processed successfully"
    email_data = result["email_data"]

    # Metadata
    assert email_data["uid"] == 1002
    assert "receiver" not in email_data
    assert email_data["sender"] == "sender is Alice alice@example.com"
    assert email_data["subject"] == "subject is Project Files"
    assert email_data["date"] == "sent on 2026-03-24"

    # Body
    assert email_data["body"].startswith("the content is ")
    assert "Hello Bob" in email_data["body"]
    assert "Please see the files below." in email_data["body"]

    # Links/images counts should be zero for this case
    assert email_data["number_of_detected_links"] == 0
    assert email_data["number_of_detected_images"] == 0

    # Attachments
    assert len(email_data["attachments"]) == 2
    assert any(
        attachment.get("original_name") == "report.pdf"
        and attachment.get("file_type") == "pdf"
        and attachment.get("spoken_name") == "attachment type is pdf and attachment is report"
        for attachment in email_data["attachments"]
    )
    assert any(
        attachment.get("original_name") == "budget.xlsx"
        and attachment.get("file_type") == "spreadsheet"
        and attachment.get("spoken_name") == "attachment type is spreadsheet and attachment is budget"
        for attachment in email_data["attachments"]
    )

    # Saved output file exists
    assert Path("output_email.json").exists()


def test_attachments_inside_iframe_srcdoc_are_discovered():
    """Body + attachment UI inside iframe[srcdoc] are not nodes on the outer document."""
    client = app.test_client()
    inner = (
        "<html><body><p>Hello</p>"
        "<div>Attachments: quarterly.pdf</div>"
        '<p><a href="https://example.com/x">Link inside iframe</a></p>'
        '<p><img src="cid:z.png" alt="Chart Z" /></p>'
        "</body></html>"
    )
    from html import escape

    escaped = escape(inner, quote=True)
    payload = {
        "uid": 2001,
        "from": "Alice <alice@example.com>",
        "to": "Bob <bob@example.com>",
        "subject": "Iframe mail",
        "date": "2026-04-01",
        "html": f'<html><body><iframe srcdoc="{escaped}"></iframe></body></html>',
    }
    response = client.post("/process-email", json=payload)
    assert response.status_code == 200
    email_data = response.get_json()["email_data"]

    assert any(a.get("original_name") == "quarterly.pdf" for a in email_data["attachments"])
    assert email_data["number_of_detected_links"] == 1
    assert any("example.com/x" in (link.get("url") or "") for link in email_data["links"])
    assert email_data["number_of_detected_images"] == 1
    assert any(image.get("alt") == "Chart Z" for image in email_data["images"])


def test_payload_attachments_as_objects_coerced_to_filenames():
    client = app.test_client()
    payload = {
        "uid": 1003,
        "from": "Alice <alice@example.com>",
        "to": "Bob <bob@example.com>",
        "subject": "Files",
        "date": "2026-03-25",
        "attachments": [
            {"name": "notes.pdf", "size": 123},
            {"original_name": "sheet.xlsx"},
        ],
        "html": "<html><body><p>No attachment section here.</p></body></html>",
    }
    response = client.post("/process-email", json=payload)
    assert response.status_code == 200
    email_data = response.get_json()["email_data"]
    names = {a["original_name"] for a in email_data["attachments"]}
    assert names == {"notes.pdf", "sheet.xlsx"}
    assert all(a.get("spoken_name", "").startswith("attachment type is") for a in email_data["attachments"])


if __name__ == "__main__":
    test_single_email_end_to_end_no_false_attachment()
    test_single_email_end_to_end_with_real_attachment_section()
    test_attachments_inside_iframe_srcdoc_are_discovered()
    test_payload_attachments_as_objects_coerced_to_filenames()
    print("Single end-to-end email tests passed.")
