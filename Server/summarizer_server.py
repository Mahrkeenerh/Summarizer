import logging
import os
from time import sleep

from dotenv import load_dotenv
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from openai import OpenAI
import requests as http_requests
import trafilatura

import RedditPostDownloader.RedditArchiver as ra


class HealthCheckFilter(logging.Filter):
    def filter(self, record):
        return '/health' not in record.getMessage()


# Suppress health endpoint logging
logging.getLogger('werkzeug').addFilter(HealthCheckFilter())

app = Flask(__name__)
CORS(app)

load_dotenv()
LLAMA_BASE = "http://localhost:8080"
client = OpenAI(base_url=f"{LLAMA_BASE}/v1", api_key="not-needed")


def tokenize(text):
    """Tokenize text using the llama-server's native tokenizer."""
    resp = http_requests.post(f"{LLAMA_BASE}/tokenize", json={"model": model, "content": text})
    return resp.json()["tokens"]


def detokenize(tokens):
    """Detokenize tokens using the llama-server's native tokenizer."""
    resp = http_requests.post(f"{LLAMA_BASE}/detokenize", json={"model": model, "tokens": tokens})
    return resp.json()["content"]

model = "gpt-oss-20b-Q8_0"
responses = {}  # Dict of request_id -> response stream


def is_reddit_url(url):
    """Check if the URL is a Reddit URL."""
    return "reddit.com" in url.lower()


def extract_general_webpage(url):
    """Extract main content from a general webpage using trafilatura."""
    try:
        print(f"Fetching URL: {url}")
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            print("ERROR: Failed to download page content")
            return None, None

        print(f"Downloaded {len(downloaded)} bytes")

        # Extract with formatting preserved - try multiple configurations
        extracted = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=True,
            include_links=False,
            output_format="html",
            favor_recall=True,  # Be more lenient in extraction
        )

        if not extracted:
            print("WARNING: HTML extraction failed, trying with fallback settings")
            # Try fallback with more aggressive extraction
            extracted = trafilatura.extract(
                downloaded,
                output_format="html",
                favor_recall=True,
                include_comments=False,
                include_tables=True,
                no_fallback=False,
            )

        if not extracted:
            print("ERROR: All extraction attempts failed")
            return None, None

        print(f"Successfully extracted {len(extracted)} bytes of content")

        # Return HTML content and a simple object with url
        class SimpleSubmission:
            def __init__(self, url):
                self.url = url

        return extracted, SimpleSubmission(url)
    except Exception as e:
        print(f"ERROR extracting webpage: {e}")
        import traceback

        traceback.print_exc()
        return None, None


def start_stream(html, request_id, question=""):
    global responses

    # Log content length for debugging
    print(f"Received HTML content length: {len(html)} characters")
    if question:
        print(f"User question: {question}")

    # Strip HTML tags to get text content for validation
    import re

    text_content = re.sub(r"<[^>]+>", "", html)
    text_length = len(text_content.strip())
    print(f"Text content length (after stripping HTML): {text_length} characters")

    if text_length < 100:
        print("WARNING: Very short content detected, summary may be poor quality")

    # Build prompt based on whether a question is provided
    # Thinking is always enabled (no /no_think prefix)
    if question:
        # Question-focused mode
        user_content = (
            f"The user has a question about this content: {question}\n\n"
            "Answer the question based on the content below. Use ## Answer as your main section header. "
            "If relevant context from the page helps explain your answer, include it. "
            "Be thorough but concise.\n\n"
            + html
        )
    else:
        # Regular summary mode
        user_content = (
            "TL;DR this in max 5 sentences total. Use ONLY ## for section headers. "
            + "For pages WITH comments: ## Post Summary (1-2 sentences), then ## Comments (2-3 sentences). "
            + "For pages WITHOUT comments: only ## Summary. No bullet lists. "
            + "Do NOT create comment sections if there are no comments.\n\n"
            + html
        )
    # Trim content to fit 45k context limit
    # Reserve tokens for: system message (~40), instructions (~100), response (~3500)
    encoded = tokenize(user_content)
    max_tokens = 45000
    was_truncated = len(encoded) > max_tokens
    if was_truncated:
        user_content = detokenize(encoded[:max_tokens])

    if was_truncated:
        user_content += "\n\n---\n[Content truncated to fit context size limits]"

    print(f"Using model: {model}")

    responses[request_id] = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": "You write very short TL;DRs of discussions. Casual and snarky. "
                "STRICT RULES: Maximum 5 sentences total. No bullet lists. No phrases like 'standout moments', "
                "'the split comes over', 'in the end', 'bottom line', 'the consensus'. "
                "Just say what happened and what people think. Drop a quote if one's funny.",
            },
            {"role": "user", "content": user_content},
        ],
        temperature=0.3,
        stream=True,
    )


def stream_summarization(request_id):
    global responses

    # Wait for this specific request's response
    timeout = 30  # 30 seconds max wait
    waited = 0
    while request_id not in responses:
        sleep(0.1)
        waited += 0.1
        if waited > timeout:
            yield f"data: Error: Request timed out\n\n"
            return

    response = responses[request_id]
    in_thinking = False

    for chunk in response:
        delta = chunk.choices[0].delta

        # Handle reasoning/thinking content (via reasoning_content field or <think> tags)
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            if not in_thinking:
                yield f"data: __THINKING_START__\n\n"
                in_thinking = True
            escaped = reasoning.replace("\n", "\\n")
            yield f"data: __THINKING_CONTENT__{escaped}\n\n"
            continue

        # Handle regular content
        content = delta.content
        if content:
            # Close thinking block when we transition to content
            if in_thinking:
                yield f"data: __THINKING_END__\n\n"
                in_thinking = False
            escaped = content.replace("\n", "\\n")
            yield f"data: {escaped}\n\n"

    # Close unclosed thinking block
    if in_thinking:
        yield f"data: __THINKING_END__\n\n"

    # Send footer
    yield f"data: \n"
    yield f"data: ---\n"
    yield f"data: \n"
    yield f"data: **Powered by {model}**\n\n"

    # Clean up this request's response
    if request_id in responses:
        del responses[request_id]


@app.route('/health')
def health():
    return {'status': 'ok'}


@app.route('/start-scrape-summarize', methods=['POST'])
def start_scrape_summarize():
    import uuid
    data = request.json
    url = data.get("url")
    question = data.get("question", "")
    request_id = data.get("request_id") or str(uuid.uuid4())
    print(f"Start request with request_id: {request_id}")

    # Check if content was already extracted by the extension
    if "content" in data:
        print(f"Using pre-extracted content from extension")
        html = data["content"]

        # Create a simple submission object
        class SimpleSubmission:
            def __init__(self, url):
                self.url = url

        submission = SimpleSubmission(url)
    else:
        # Fallback to server-side extraction for Reddit only
        if is_reddit_url(url):
            print(f"Extracting Reddit post from server: {url}")
            try:
                html, submission = ra.scrape_url(url)
            except Exception as e:
                error_msg = f"Failed to fetch Reddit post: {str(e)}"
                print(f"ERROR: {error_msg}")
                return Response(status=500, response=error_msg, content_type='text/plain')
        else:
            error_msg = "Non-Reddit URLs must be extracted by the extension"
            print(f"ERROR: {error_msg}")
            return Response(status=400, response=error_msg, content_type='text/plain')

    if not html:
        error_msg = "No content extracted from the page"
        print(f"ERROR: {error_msg}")
        return Response(status=400, response=error_msg, content_type='text/plain')

    try:
        start_stream(html, request_id, question)
    except Exception as e:
        error_msg = str(e)
        # Extract cleaner error message from OpenAI-style errors
        if "{'error':" in error_msg:
            import re
            match = re.search(r"'error':\s*'([^']+)'", error_msg)
            if match:
                error_msg = match.group(1)
        print(f"ERROR starting stream: {error_msg}")
        return Response(status=500, response=error_msg, content_type='text/plain')

    return Response(status=200, response=request_id, content_type='text/plain')


@app.route('/stream-summary', methods=['GET'])
def stream_summary():
    request_id = request.args.get('request_id')
    print(f"Stream request received for request_id: {request_id}")
    if not request_id:
        error_response = Response(status=400, response="Missing request_id parameter", content_type='text/plain')
        error_response.headers['Access-Control-Allow-Origin'] = '*'
        return error_response
    response = Response(stream_with_context(stream_summarization(request_id)), content_type='text/event-stream')
    # Explicitly set CORS headers for SSE streaming
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Connection'] = 'keep-alive'
    return response


if __name__ == '__main__':
    app.run(debug=False, port=5000, threaded=True)
