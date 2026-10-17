import mimetypes
import os
import re


class AttachmentProcessor:
    """
    Process email attachments for speech output.
    - Detects a speech-friendly file type
    - Keeps original filename
    - Builds a cleaner spoken filename
    """

    def process_attachments(
        self,
        attachment_names: list[str],
        number_of_detected_links: int = 0,
        number_of_detected_images: int = 0,
    ) -> list[dict]:
        results = []

        if not attachment_names:
            spoken_name = "no attachment detected"
            if number_of_detected_links > 0 or number_of_detected_images > 0:
                spoken_name += (
                    f", number of detected links is {number_of_detected_links}"
                    f" and number of detected images is {number_of_detected_images}"
                )

            return [{
                "file_type": "",
                "original_name": "",
                "spoken_name": spoken_name
            }]

        for filename in attachment_names:
            if not filename or not isinstance(filename, str):
                continue

            file_type = self._categorize_file(filename)
            attachment_name = self._build_spoken_name(filename)

            spoken_name = (
                f"attachment type is {file_type} and attachment is {attachment_name}"
            )

            if number_of_detected_links > 0 or number_of_detected_images > 0:
                spoken_name += (
                    f", number of detected links is {number_of_detected_links}"
                    f" and number of detected images is {number_of_detected_images}"
                )

            results.append({
                "file_type": file_type,
                "original_name": filename,
                "spoken_name": spoken_name
            })

        return results

    def _categorize_file(self, filename: str) -> str:
        """
        Uses stdlib 'mimetypes' to guess content type from filename
        and returns a stable, speech-friendly category.
        """
        mime, _ = mimetypes.guess_type(filename)
        ext = os.path.splitext(filename)[1].lower().lstrip(".")

        if mime:
            major = mime.split("/", 1)[0].lower()

            if major == "image":
                return "image"
            if major == "audio":
                return "audio"
            if major == "video":
                return "video"
            if mime == "application/pdf":
                return "pdf"
            if "powerpoint" in mime or "presentation" in mime or ext in {"ppt", "pptx"}:
                return "presentation"
            if "word" in mime or ext in {"doc", "docx"}:
                return "document"
            if "excel" in mime or "spreadsheet" in mime or ext in {"xls", "xlsx", "csv"}:
                return "spreadsheet"
            if major == "text":
                return "text"
            if "zip" in mime or ext in {"zip", "rar", "7z", "tar", "gz"}:
                return "archive"

        # Fallback by extension
        if ext in {"jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "svg"}:
            return "image"
        if ext == "pdf":
            return "pdf"
        if ext in {"ppt", "pptx"}:
            return "presentation"
        if ext in {"doc", "docx"}:
            return "document"
        if ext in {"xls", "xlsx", "csv"}:
            return "spreadsheet"
        if ext in {"txt"}:
            return "text"
        if ext in {"mp3", "wav", "ogg", "m4a"}:
            return "audio"
        if ext in {"mp4", "avi", "mov", "mkv"}:
            return "video"
        if ext in {"zip", "rar", "7z", "tar", "gz"}:
            return "archive"

        return "unknown"

    def _build_spoken_name(self, filename: str) -> str:
        """
        Convert filename into a more speech-friendly form.
        Example:
        'Project_Report_Final_V2.pdf' -> 'Project Report Final V2'
        """
        name_without_ext = os.path.splitext(filename)[0]

        spoken_name = name_without_ext.replace("_", " ").replace("-", " ")
        spoken_name = re.sub(r"\s+", " ", spoken_name).strip()
        words = spoken_name.split()
        if not words:
            return ""

        if len(words[0]) < 7 and len(words) > 1:
            return f"{words[0]} {words[1]}"

        return words[0][:10]
