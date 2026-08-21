#!/usr/bin/env python3
"""Static server for The Verbasizer with a Gutenberg range-fetch proxy."""

from __future__ import annotations

import json
import random
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
REFERENCE_WORDS = 120
SCRAMBLE_WORDS = 3500
SCRAMBLE_CHUNKS = 4
CHUNK_SIZE = 12_000
REFERENCE_BYTES = 22_000
REFERENCE_LOOKBACK = 3_000
START_SCAN_BYTES = 8_192
FRONT_MATTER_MIN_BYTES = 20_000
FRONT_MATTER_FRACTION = 0.10
FRONT_MATTER_MAX_BYTES = 100_000
BACK_MATTER_BYTES = 4_000

WORD_PATTERN = re.compile(r"[\w']+")
SENTENCE_BOUNDARY = re.compile(r'[.!?]["\']?(?:\s+|\n+)')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self.send_health()
            return
        if self.path.startswith("/api/wikipedia"):
            self.handle_wikipedia()
            return
        if self.path.startswith("/api/gutenberg/"):
            self.handle_gutenberg()
            return
        super().do_GET()

    def send_health(self) -> None:
        body = json.dumps({"ok": True, "proxy": "gutenberg,wikipedia"}).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_wikipedia(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/wikipedia":
            self.send_error(HTTPStatus.BAD_REQUEST, "Expected /api/wikipedia?title=...")
            return

        params = urllib.parse.parse_qs(parsed.query)
        title = (params.get("title") or [""])[0].strip()
        if not title:
            self.send_error(HTTPStatus.BAD_REQUEST, "title is required")
            return

        try:
            extract = fetch_wikipedia_extract(title)
        except ValueError as exc:
            self.send_error(HTTPStatus.NOT_FOUND, str(exc))
            return
        except urllib.error.HTTPError as exc:
            self.send_error(exc.code, exc.reason)
            return
        except urllib.error.URLError as exc:
            self.send_error(HTTPStatus.BAD_GATEWAY, str(exc.reason))
            return

        body = json.dumps({"title": title, "extract": extract}).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_gutenberg(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        match = re.match(r"/api/gutenberg/(\d+)$", parsed.path)
        if not match:
            self.send_error(HTTPStatus.BAD_REQUEST, "Expected /api/gutenberg/{id}?parts=...")
            return

        book_id = int(match.group(1))
        params = urllib.parse.parse_qs(parsed.query)
        raw_parts = params.get("parts", ["reference"])
        parts = {
            part.strip()
            for value in raw_parts
            for part in value.split(",")
            if part.strip()
        }
        if not parts.issubset({"reference", "scramble"}):
            self.send_error(HTTPStatus.BAD_REQUEST, "parts must include reference and/or scramble")
            return

        try:
            payload = fetch_gutenberg_excerpts(book_id, parts)
        except urllib.error.HTTPError as exc:
            self.send_error(exc.code, exc.reason)
            return
        except urllib.error.URLError as exc:
            self.send_error(HTTPStatus.BAD_GATEWAY, str(exc.reason))
            return

        body = json.dumps(payload).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        request_line = str(args[0])
        if request_line.startswith("GET /api/gutenberg/") or request_line.startswith("GET /api/wikipedia"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))
            return
        super().log_message(format, *args)


def fetch_wikipedia_extract(title: str) -> str:
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "prop": "extracts",
            "explaintext": "1",
            "exsectionformat": "plain",
            "redirects": "1",
            "titles": title,
            "format": "json",
        }
    )
    url = f"https://en.wikipedia.org/w/api.php?{query}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Verbasizer/1.0 (local cut-up tool; educational use)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)

    page = next(iter(payload.get("query", {}).get("pages", {}).values()), None)
    if not page or page.get("missing") is not None:
        raise ValueError(f"Wikipedia page not found: {title}")

    extract = page.get("extract", "").strip()
    if not extract:
        raise ValueError(f"Wikipedia returned no text for: {title}")
    return extract


def fetch_gutenberg_excerpts(book_id: int, parts: set[str]) -> dict:
    url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
    total = head_content_length(url)
    body_start, body_end, content_start = find_body_bounds(url, total)
    payload: dict[str, object] = {"id": book_id}

    reference_offset = None
    if "reference" in parts:
        reference_offset = random_content_offset(
            content_start,
            body_end,
            REFERENCE_BYTES,
        )
        fetch_start = max(content_start, reference_offset - REFERENCE_LOOKBACK)
        reference_text = fetch_range(
            url,
            fetch_start,
            min(reference_offset + REFERENCE_BYTES, body_end),
        )
        reference_text = align_to_sentence_start(clean_gutenberg(reference_text))
        payload["reference"] = normalize_prose(trim_words(reference_text, REFERENCE_WORDS))

    if "scramble" in parts:
        chunks = sample_body_chunks(
            url,
            content_start,
            body_end,
            SCRAMBLE_CHUNKS,
            CHUNK_SIZE,
            avoid_near=reference_offset,
        )
        scramble_text = clean_gutenberg("\n\n".join(chunks))
        payload["scramble"] = normalize_prose(trim_words(scramble_text, SCRAMBLE_WORDS))

    return payload


def head_content_length(url: str) -> int:
    request = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(request, timeout=30) as response:
        length = response.headers.get("Content-Length")
        if not length:
            raise urllib.error.URLError("Missing Content-Length header")
        return int(length)


def fetch_range(url: str, start: int, end: int) -> str:
    request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def find_body_bounds(url: str, total: int) -> tuple[int, int, int]:
    start_chunk = fetch_range(url, 0, min(START_SCAN_BYTES, total - 1))
    match = re.search(r"\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\n", start_chunk, re.I)
    body_start = match.end() if match else min(2500, total - 1)
    body_end = max(body_start + 10_000, total - BACK_MATTER_BYTES)
    body_length = max(body_end - body_start, 1)
    front_matter = min(
        FRONT_MATTER_MAX_BYTES,
        max(FRONT_MATTER_MIN_BYTES, int(body_length * FRONT_MATTER_FRACTION)),
        max(body_length - REFERENCE_BYTES - CHUNK_SIZE, 0),
    )
    content_start = min(body_start + front_matter, body_end - 1_000)
    content_start = max(content_start, body_start)
    return body_start, body_end, content_start


def random_content_offset(content_start: int, body_end: int, chunk_size: int) -> int:
    span = max(body_end - content_start - chunk_size, 0)
    return content_start + random.randint(0, span)


def sample_body_chunks(
    url: str,
    content_start: int,
    body_end: int,
    count: int,
    chunk_size: int,
    avoid_near: int | None = None,
) -> list[str]:
    span = max(body_end - content_start - chunk_size, 1)
    offsets: list[int] = []
    cushion = chunk_size // 2

    while len(offsets) < count:
        offset = content_start + random.randint(0, span)
        if avoid_near is not None and abs(offset - avoid_near) < cushion:
            continue
        if offsets and any(abs(offset - existing) < cushion for existing in offsets):
            continue
        offsets.append(offset)

    offsets.sort()
    return [fetch_range(url, offset, min(offset + chunk_size - 1, body_end)) for offset in offsets]


def normalize_prose(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r"\n+", " ", text)
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def clean_gutenberg(text: str) -> str:
    text = re.sub(r"\*\*\* END OF THE PROJECT GUTENBERG EBOOK.*", "", text, flags=re.I | re.S)
    text = re.sub(r"\[(?:Illustration|Frontispiece|T\.I\.|Pg \d+)[^\]]*\]", "", text, flags=re.I)
    text = re.sub(r"^\s*CONTENTS\s*$", "", text, flags=re.I | re.M)
    text = re.sub(r"_([^_\n]+)_", r"\1", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def looks_like_sentence_start(text: str) -> bool:
    stripped = text.lstrip()
    if not stripped:
        return False
    if stripped[0] in "\"'“‘":
        stripped = stripped[1:].lstrip()
    if not stripped:
        return False
    return stripped[0].isupper() or stripped[0].isdigit()


def align_to_sentence_start(text: str) -> str:
    if looks_like_sentence_start(text):
        return text.lstrip()

    scan_limit = min(len(text), 2500)
    for match in SENTENCE_BOUNDARY.finditer(text[:scan_limit]):
        remainder = text[match.end() :].lstrip()
        if remainder and looks_like_sentence_start(remainder):
            return remainder

    paragraph = re.search(r"\n\s*\n", text[:scan_limit])
    if paragraph:
        remainder = text[paragraph.end() :].lstrip()
        if remainder:
            return align_to_sentence_start(remainder)

    return text.lstrip()


def trim_words(text: str, limit: int) -> str:
    words = WORD_PATTERN.findall(text)
    if len(words) <= limit:
        return trim_to_sentence_end(normalize_prose(text.strip()))

    cut_index = 0
    seen = 0
    for match in WORD_PATTERN.finditer(text):
        seen += 1
        if seen == limit:
            cut_index = match.end()
            break

    trimmed = normalize_prose(text[:cut_index].rstrip())
    return trim_to_sentence_end(trimmed)


def trim_to_sentence_end(text: str) -> str:
    trimmed = text.strip()
    if not trimmed or re.search(r'[.!?]["\']?$', trimmed):
        return trimmed

    boundaries = list(re.finditer(r'[.!?]["\']?(?=\s|$)', trimmed))
    if not boundaries:
        if trimmed.endswith((".", "!", "?", '"', "'")):
            return trimmed
        return f"{trimmed}..."

    last = boundaries[-1]
    end = last.end()
    if end >= len(trimmed) * 0.55:
        return trimmed[:end].strip()

    if trimmed.endswith((".", "!", "?", '"', "'")):
        return trimmed
    return f"{trimmed}..."


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server_address = ("127.0.0.1", port)
    try:
        server = ThreadingHTTPServer(server_address, Handler)
    except OSError as exc:
        if exc.errno == 98:
            sys.stderr.write(
                f"Port {port} is already in use.\n"
                "Stop the other server first, then run:\n"
                f"  python3 web/serve.py {port}\n"
            )
        raise SystemExit(1) from exc

    print(f"Serving {WEB_DIR} at http://127.0.0.1:{port}/")
    print("Gutenberg excerpts: GET /api/gutenberg/{id}?parts=reference,scramble")
    print("Wikipedia excerpts: GET /api/wikipedia?title={page}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
