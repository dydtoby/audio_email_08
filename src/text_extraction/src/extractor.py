from bs4 import BeautifulSoup
from html import unescape
import re

from html2text import html2text

class EmailTextExtractor:
    """Extract and clean email content for downstream speech processing."""
    def __init__(self):
        self.html_converter = html2text.HTML2Text()
        self.html_converter.detect_links = True
        self.html_converter.detect_images = True
        self.html_converter.body_width = 0
        self.html_converter.ignore_emphasis = True
        self.html_converter.ignore_tables = False

    def extract_email_data(self, cleaned_html: str, plain_text: str = "") -> dict:
        if not cleaned_html and not plain_text:
            return {
                "subject": "",
                "body": "",
                "attachments": [],
                "links": [],
                "number_of_detected_links": 0,
                "images": [],
                "number_of_detected_images": 0,
            }

        soup = BeautifulSoup(cleaned_html, "html.parser") if cleaned_html else None

        body = ""
        attachments = []
        links = []
        images = []

        if soup:
            body_soup = self._resolve_body_soup(soup)
            extracted = self._extract_body_data(body_soup)
            body = extracted["body"]
            links = extracted["links"]
            images = extracted["images"]
            # Attachments are detected via DOM walk (not html2text). Body content
            # often lives inside iframe[srcdoc] or a narrowed Gmail/Outlook div;
            # html2text already uses that inner tree, but attachment scan used to
            # run only on the outer document—so filenames inside srcdoc never
            # appeared as elements. Merge outer + body soup like link/image path.
            attachments = self._extract_attachment_names_merged(soup, body_soup)

        if not body and plain_text:
            body = self._extract_body_from_text(plain_text)

        return {
            "subject": "",
            "body": body,
            "attachments": attachments,
            "links": links,
            "number_of_detected_links": len(links),
            "images": images,
            "number_of_detected_images": len(images),
        }

    def clean_person_value(self, value: str) -> str:
        if not value:
            return ""

        cleaned = value.strip()
        cleaned = re.sub(
            r"<\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*>",
            r" \1",
            cleaned,
            flags=re.IGNORECASE
            )
        cleaned = cleaned.replace("\\", "")
        cleaned = cleaned.replace('"', "")
        cleaned = cleaned.replace("<", "").replace(">", "")
        cleaned = re.sub(r"[·|;]+", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        return cleaned

    def clean_subject(self, value: str) -> str:
        if not value:
            return ""

        cleaned = value.strip()
        cleaned = re.sub(r"^(?:(?:fw|fwd|wg)\s*:\s*)+", "", cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    def _extract_body_from_text(self, plain_text: str) -> str:
        if not plain_text:
            return ""

        text = re.sub(r"\r\n?", "\n", plain_text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

        paragraphs = []
        for block in text.split("\n\n"):
            block = block.strip()
            if not block:
                continue

            sentence_chunks = re.split(r'(?<=[.!?])\s+', block)
            sentence_chunks = [chunk.strip() for chunk in sentence_chunks if chunk.strip()]
            paragraphs.append("\n".join(sentence_chunks))

        return "\n\n".join(paragraphs)

    def _find_email_body_soup(self, outer_soup: BeautifulSoup):
        iframe = outer_soup.select_one("iframe[srcdoc]")
        if iframe and iframe.has_attr("srcdoc"):
            inner_html = unescape(iframe["srcdoc"])
            return BeautifulSoup(inner_html, "html.parser")

        gmail_body = outer_soup.select_one("div.a3s")
        if gmail_body:
            return BeautifulSoup(str(gmail_body), "html.parser")

        gmail_body = outer_soup.select_one("div.ii.gt")
        if gmail_body:
            return BeautifulSoup(str(gmail_body), "html.parser")

        gmail_body = outer_soup.select_one("div.msg")
        if gmail_body:
            return BeautifulSoup(str(gmail_body), "html.parser")

        msg_div = outer_soup.find("div", class_=re.compile(r"^msg-"))
        if msg_div:
            return BeautifulSoup(str(msg_div), "html.parser")

        return None

    def _resolve_body_soup(self, soup: BeautifulSoup) -> BeautifulSoup:
        """Subtree passed to html2text (iframe inner HTML, Gmail body div, etc.)."""
        inner = self._find_email_body_soup(soup)
        return inner if inner is not None else soup

    def _extract_body_data(self, body_soup: BeautifulSoup) -> dict:
        converted_text = self.html_converter.handle(str(body_soup))
        return {
            "body": self._clean_html2text_output(converted_text),
            "links": list(self.html_converter.detected_links),
            "images": list(self.html_converter.detected_images),
        }

    def _clean_html2text_output(self, text: str) -> str:
        if not text:
            return ""

        text = re.sub(r"\r\n?", "\n", text)
        text = re.sub(r"[ \t]+", " ", text)

        cleaned_lines = []

        for line in text.split("\n"):
            line = line.strip()

            if not line:
                cleaned_lines.append("")
                continue

            if self._is_attachment_line(line):
                continue

            if self._is_metadata_line(line):
                continue

            cleaned_lines.append(line)

        text = "\n".join(cleaned_lines)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        text = self._strip_forwarded_prefix(text)
        text = self._remove_invisible_chars(text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

        return text

    def _strip_forwarded_prefix(self, text: str) -> str:
        if not text:
            return ""

        text = text.lstrip("\\").lstrip()
        forwarded_pattern = re.compile(
            r"^[-\\\s]*forwarded message[-\\\s]*\n+",
            flags=re.IGNORECASE,
        )
        text = re.sub(forwarded_pattern, "", text, count=1)

        metadata_line_pattern = re.compile(
            r"^(from|to|subject|date|sent|cc|bcc)\s*:\s*.*$",
            flags=re.IGNORECASE,
        )

        lines = text.split("\n")
        idx = 0
        while idx < len(lines):
            line = lines[idx].strip()
            if not line:
                idx += 1
                continue
            if metadata_line_pattern.match(line):
                idx += 1
                continue
            break

        stripped = "\n".join(lines[idx:]).lstrip()
        return stripped

    def _remove_invisible_chars(self, text: str) -> str:
        if not text:
            return ""

        invisible_chars = "[\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]"
        text = re.sub(invisible_chars, "", text)
        lines = [re.sub(r"\s+", " ", line).strip() for line in text.split("\n")]
        return "\n".join(lines).strip()

    def _is_attachment_line(self, text: str) -> bool:
        normalized = text.strip().lower()
        return bool(re.match(r"^attachments?\b", normalized))

    def _is_metadata_line(self, text: str) -> bool:
        normalized = text.strip().lower()
        metadata_prefixes = (
            "from:",
            "to:",
            "receiver:",
            "recipient:",
            "subject:",
            "date:",
            "sent:"
        )
        return normalized.startswith(metadata_prefixes)

    def _extract_attachment_names(self, soup: BeautifulSoup) -> list[str]:
        attachments = []
        seen = set()

        # Match realistic filenames, not full sentences.
        filename_pattern = re.compile(
            r'(?<![\w.-])'
            r'[\w.-]+'
            r'\.(?:pdf|doc|docx|txt|ppt|pptx|xls|xlsx|csv|jpg|jpeg|png|gif|bmp|webp|zip|rar|7z)'
            r'(?![\w.-])',
            re.IGNORECASE
        )

        attachment_section_pattern = re.compile(
            r"^\s*attachments?\s*:",
            re.IGNORECASE
        )

        def add_attachment(filename: str):
            filename = filename.strip().strip(".,;:()[]{}<>\"'")
            if filename and filename not in seen:
                seen.add(filename)
                attachments.append(filename)

        def is_attachment_section_header(text: str) -> bool:
            return bool(attachment_section_pattern.search(text))

        def is_inside_attachment_section(tag) -> bool:
            """
            Only treat text filenames as attachments when they are listed inside
            an explicit Attachments: section.
            """
            current = tag
            while current:
                if hasattr(current, "get_text"):
                    current_text = current.get_text(" ", strip=True)
                    if is_attachment_section_header(current_text):
                        return True
                current = current.parent

            previous = tag.find_previous(string=attachment_section_pattern)
            return previous is not None

        # Text-based attachment detection:
        # only count filenames that appear in an explicit Attachments: section.
        for tag in soup.find_all(["div", "p", "span", "li"]):
            text = tag.get_text(" ", strip=True)
            if not text:
                continue

            if not is_inside_attachment_section(tag):
                continue

            for match in filename_pattern.finditer(text):
                add_attachment(match.group(0))

        # Link-based attachment detection:
        # count only non-HTTP attachment-like hrefs (for example cid:, file paths,
        # or backend-generated download targets that are not normal web links).
        for a_tag in soup.find_all("a"):
            href = (a_tag.get("href") or "").strip()
            if not href:
                continue

            lower_href = href.lower()

            if (
                lower_href.startswith("mailto:")
                or lower_href.startswith("http://")
                or lower_href.startswith("https://")
                or lower_href.startswith("//")
                or lower_href.startswith("#")
                or lower_href.startswith("javascript:")
                or lower_href.startswith("tel:")
                or lower_href.startswith("data:")
            ):
                continue

            candidate = href.split("/")[-1].split("?")[0].split("#")[0].strip()
            if filename_pattern.fullmatch(candidate):
                add_attachment(candidate)

        return attachments

    def _extract_attachment_names_merged(
        self, outer_soup: BeautifulSoup, body_soup: BeautifulSoup
    ) -> list[str]:
        primary = self._extract_attachment_names(outer_soup)
        if body_soup is outer_soup:
            return primary
        secondary = self._extract_attachment_names(body_soup)
        seen = set(primary)
        out = list(primary)
        for name in secondary:
            if name not in seen:
                seen.add(name)
                out.append(name)
        return out

    def format_subject_for_speech(self, value: str) -> str:
        cleaned = self.clean_subject(value)
        if not cleaned:
            return "subject is empty"
        return f"subject is {cleaned}"

    # def format_receiver_for_speech(self, value: str) -> str:
    #     cleaned = self.clean_person_value(value)
    #     if not cleaned:
    #         return "receiver is empty"

    #     # split common multi-recipient formats
    #     parts = [part.strip() for part in re.split(r"[;,]", cleaned) if part.strip()]

    #     if len(parts) <= 1:
    #         return cleaned

    #     return f"receiver is {', '.join(parts)}"
    
    def format_sender_for_speech(self, value: str) -> str:
        cleaned = self.clean_person_value(value)
        if not cleaned:
            return "sender is empty"
        return f"sender is {cleaned}"
    

    def format_date_for_speech(self, value: str) -> str:
        cleaned = str(value).strip() if value is not None else ""
        if not cleaned:
            return "date is empty"
        return f"sent on {cleaned}"

    def format_body_for_speech(self, value: str) -> str:
        cleaned = value.strip() if value else ""
        if not cleaned:
            return "the content is empty"
        return f"the content is {cleaned}"
