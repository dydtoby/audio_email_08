from extractor import EmailTextExtractor
from attachment import AttachmentProcessor


def _coerce_attachment_names(raw) -> list:
    """Turn payload attachment / attachments (strings or UI dicts) into filename strings."""
    if not raw:
        return []
    if isinstance(raw, str):
        s = raw.strip()
        return [s] if s else []
    if not isinstance(raw, list):
        return []
    out = []
    seen = set()
    for item in raw:
        s = ""
        if isinstance(item, str):
            s = item.strip()
        elif isinstance(item, dict):
            s = str(
                item.get("original_name")
                or item.get("filename")
                or item.get("name")
                or item.get("fileName")
                or ""
            ).strip()
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _link_spoken_name(link: dict) -> str:
    if not isinstance(link, dict):
        return "link"
    text = str(link.get("text") or "").strip()
    label = str(link.get("label") or "").strip()
    title = text or label
    if title:
        return f"link is {title}"
    return "link"


def _image_spoken_name(image: dict) -> str:
    if not isinstance(image, dict):
        return "inline image"
    alt = str(image.get("alt") or "").strip()
    label = str(image.get("label") or "").strip()
    title = alt or label
    if title:
        return f"image is {title}"
    return "inline image"


class EmailProcessingPipeline:
    def __init__(self):
        self.extractor = EmailTextExtractor()
        self.attachment_processor = AttachmentProcessor()

    def process_backend_payload(self, payload: dict) -> dict:
        raw_html = payload.get("html") or ""

        raw_text = payload.get("text") or payload.get("plain_text") or ""
        extracted = self.extractor.extract_email_data(raw_html, raw_text)

        payload_names = _coerce_attachment_names(
            payload.get("attachment") or payload.get("attachments")
        )
        html_names = list(extracted.get("attachments") or [])
        raw_attachments = payload_names or html_names
        processed_attachments = self.attachment_processor.process_attachments(
            raw_attachments,
            extracted.get("number_of_detected_links", 0),
            extracted.get("number_of_detected_images", 0))

        subject = payload.get("subject") or extracted.get("subject", "")

        normalized_date = self._normalize_date(payload.get("date"))
        body = extracted.get("body", "")

        raw_links = extracted.get("links", []) or []
        processed_links = []
        for link in raw_links:
            d = dict(link) if isinstance(link, dict) else {"url": str(link)}
            d["spoken_name"] = _link_spoken_name(d)
            processed_links.append(d)

        raw_images = extracted.get("images", []) or []
        processed_images = []
        for image in raw_images:
            d = dict(image) if isinstance(image, dict) else {"src": str(image)}
            d["spoken_name"] = _image_spoken_name(d)
            processed_images.append(d)

        result = {
            "uid": payload.get("uid"),
            # "receiver": self.extractor.format_receiver_for_speech(payload.get("to", "")),
            "sender": self.extractor.format_sender_for_speech(payload.get("from", "")),
            "subject": self.extractor.format_subject_for_speech(subject),
            "date": self.extractor.format_date_for_speech(normalized_date),
            "body": self.extractor.format_body_for_speech(body),
            "attachments": processed_attachments,
            "links": processed_links,
            "number_of_detected_links": extracted.get("number_of_detected_links", 0),
            "images": processed_images,
            "number_of_detected_images": extracted.get("number_of_detected_images", 0),
        }
        return result

    def _normalize_date(self, value):
        if value is None:
            return ""

        text = str(value).strip()
        if not text:
            return ""

        match = __import__("re").match(r"^(\d{4}-\d{2}-\d{2})", text)
        if match:
            return match.group(1)

        return text
