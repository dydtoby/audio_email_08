# Email Processor

This service receives raw email content from the backend, extracts the useful parts, and returns a normalized JSON payload that can later be passed to the speech module.

It currently extracts and normalizes:

- sender
- subject
- date
- body
- attachments
- detected links
- detected images

## Important dependency note

This project depends on a **customized version of `html2text`**.

It does **not** use the standard upstream `html2text` package as-is.

The extractor relies on custom behavior and custom attributes added to `HTML2Text`, including:

- `detect_links`
- `detect_images`
- `detected_links`
- `detected_images`

These fields are used in `extractor.py` to collect link and image information separately from the main body text.

### What the customized `html2text` does

Our patched version adds email-specific behavior on top of normal HTML-to-text conversion:

- detects links separately from body text
- detects images separately from body text
- keeps meaningful visible link text in the body for readability
- keeps useful image text such as alt text in the body when appropriate
- supports cleaner handling of forwarded emails and repeated wrappers
- helps produce output that is easier for the speech module to read aloud

## Current pipeline

1. The backend sends an email payload to the Flask app.
2. The pipeline reads the payload and passes the HTML body to the extractor.
3. The extractor uses the **customized** `html2text` implementation to convert email HTML into readable text.
4. During conversion, links and images are detected separately.
5. The body text is cleaned to remove noisy metadata such as repeated email headers.
6. Sender, subject, date, and body are formatted for speech-oriented output.
7. Attachments are detected and post-processed into a speech-friendly structure.

## Current extraction rules

### Sender, subject, date, and body formatting

The pipeline returns speech-oriented strings:

- if sender exists: `sender is <value>`
- if sender is missing: `sender is empty`
- if subject exists: `subject is <value>`
- if subject is missing: `subject is empty`
- if date exists: `sent on <value>`
- if date is missing: `date is empty`
- if body exists: `the content is <value>`
- if body is missing: `the content is empty`

### Attachments

Attachments are only included when they appear to be realistically attached to the email, for example:

- in an explicit attachment section such as `Attachment:` or `Attachments:`
- in a non-HTTP attachment-like link or reference

If no real attachment is detected, the attachment processor currently returns a placeholder attachment item with:

- `file_type`: empty string
- `original_name`: empty string
- `spoken_name`: `no attachment detected`

If links or images were detected in the same email, their counts are appended to the attachment `spoken_name`.

### Subject and date normalization

- Forwarded prefixes such as `Fwd:` and `FW:` are removed from the subject before formatting.
- Dates are normalized before being returned in the final JSON.

### Forwarded email cleanup

Repeated forwarded headers, email metadata lines, and noisy wrapper content are cleaned from the extracted body text.

## Expected JSON shape

A typical processed payload looks like this:

```json
{
  "uid": 2330,
  "sender": "sender is Eli",
  "subject": "subject is Let Perplexity Computer handle your most complex tasks",
  "date": "sent on 2026-03-23",
  "body": "the content is Upgrade to Pro to unlock access ...",
  "attachments": [
    {
      "file_type": "",
      "original_name": "",
      "spoken_name": "no attachment detected, number of detected links is 1 and number of detected images is 1"
    }
  ],
  "links": [
    {
      "label": "Learn More",
      "url": "https://..."
    }
  ],
  "number_of_detected_links": 1,
  "images": [
    {
      "label": "Kaggle",
      "src": "https://...",
      "alt": "Kaggle"
    }
  ],
  "number_of_detected_images": 1
}
```

When real attachments exist, the output looks like this:

```json
{
  "attachments": [
    {
      "file_type": "pdf",
      "original_name": "report.pdf",
      "spoken_name": "attachment type is pdf and attachment is report"
    }
  ]
}
```

If link/image counts are nonzero, they are appended to `spoken_name`.

## Main project files

### `app.py`

Runs the Flask server and exposes the processing endpoint.

### `pipeline.py`

Coordinates the full processing flow:

- receives the backend payload
- calls the extractor
- normalizes sender / subject / date / body
- runs attachment post-processing
- returns the final JSON result

### `extractor.py`

Responsible for extracting the email content:

- converts HTML to readable text
- cleans noisy output
- extracts body
- reads detected links and images from the customized `html2text`
- extracts attachment candidates
- formats sender, subject, date, and body for speech output

### `html2text/__init__.py`

This is the customized `html2text` layer.

It is where link and image detection behavior is implemented.

Custom behavior includes:

- detect links separately from body text
- detect images separately from body text
- preserve visible link text inside the body
- preserve useful image text when available
- expose `detected_links`
- expose `detected_images`

### `attachment.py`

Turns raw attachment names into a structured output for downstream use.

It also builds a speech-oriented `spoken_name` and can include the number of detected links and images.

Example:

```json
{
  "file_type": "pdf",
  "original_name": "Project_Report_Final.pdf",
  "spoken_name": "attachment type is pdf and attachment is Project"
}
```

## How to run

Start the Flask server:

```bash
python app.py
```

Default local address:

```bash
http://127.0.0.1:5000
```

## How to test

Send a POST request to the processing endpoint.

Example:

```bash
curl -X POST http://127.0.0.1:5000/process-email \
  -H "Content-Type: application/json" \
  -d '{
    "uid": 1,
    "from": "Alice <alice@example.com>",
    "to": "Bob <bob@example.com>",
    "subject": "Fwd: Report Update",
    "date": "2026-03-23T15:49:16.000Z",
    "html": "<html><body><p>Hello team.</p><p><a href=\"https://example.com\">Open report</a></p></body></html>"
  }'
```

## Example response

```json
{
  "email_data": {
    "attachments": [
      {
        "file_type": "",
        "original_name": "",
        "spoken_name": "no attachment detected, number of detected links is 1 and number of detected images is 0"
      }
    ],
    "body": "the content is Hello team.\n\nOpen report",
    "date": "sent on 2026-03-23",
    "images": [],
    "links": [
      {
        "label": "Open report",
        "url": "https://example.com"
      }
    ],
    "number_of_detected_images": 0,
    "number_of_detected_links": 1,
    "sender": "sender is Alice alice@example.com",
    "subject": "subject is Report Update"
  },
  "message": "Email processed successfully",
  "saved_to": "output_email.json"
}
```

## Common troubleshooting notes

### Missing `detect_links` or `detected_links` errors

This usually means the code is running against the wrong `html2text` version.

Check that:

- the patched `html2text/__init__.py` is present
- your environment is importing the local customized version
- you are not accidentally using the unmodified upstream package

### Link or image output is missing

Check that the extractor still enables:

```python
self.html_converter.detect_links = True
self.html_converter.detect_images = True
```

### Attachment output looks wrong

If filenames mentioned in normal sentences appear as attachments, check that the current extractor logic is being used. The intended behavior is to include only realistically attached files, not filenames casually mentioned in the body.

### No-attachment behavior changed

The current attachment processor does not return an empty list when no attachment is found. Instead, it returns one placeholder item whose `spoken_name` explains that no attachment was detected.
