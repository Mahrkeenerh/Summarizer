import os
from time import sleep

from dotenv import load_dotenv
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from openai import OpenAI
import tiktoken
import trafilatura

import RedditPostDownloader.RedditArchiver as ra


app = Flask(__name__)
CORS(app)

load_dotenv()
client = OpenAI(base_url="http://localhost:8080/v1", api_key="not-needed")

enc = tiktoken.get_encoding("o200k_base")

model = "Qwen3-8B-Q8_0"  # 8B model with Q8 quantization
response = None


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


def start_stream(html):
    global response

    # Log content length for debugging
    print(f"Received HTML content length: {len(html)} characters")

    # Strip HTML tags to get text content for validation
    import re

    text_content = re.sub(r"<[^>]+>", "", html)
    text_length = len(text_content.strip())
    print(f"Text content length (after stripping HTML): {text_length} characters")

    if text_length < 100:
        print("WARNING: Very short content detected, summary may be poor quality")

    user_content = (
        "/no_think\n\nSummarize the content below. Use ONLY ## for section headers (no other header levels). "
        + "For pages WITH comments: Create sections for ## Post Summary, ## Common Comments, and ## Controversial Comments. "
        + "If there are only a few comments, use a single ## Comments section instead. "
        + "For pages WITHOUT comments (articles, blogs, etc.), or with NO comments: Create only ## Summary section with the main content. "
        + "Do NOT create comment sections if there are no comments. "
        + "Skip any section if there is no relevant content. Do not add titles, introductions, or extra headers.\n\n"
        + html
    )
    # Trim content to fit 16k context limit (using 12k to be safe)
    # Reserve tokens for: system message (~40), instructions (~100), response (~3500)
    encoded = enc.encode(user_content)
    max_tokens = 12000
    was_truncated = len(encoded) > max_tokens
    user_content = enc.decode(encoded[:max_tokens])

    if was_truncated:
        user_content += "\n\n---\n[Content truncated to fit context size limits]"

    print(f"Using model: {model}")

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": "You are a summary assistant, skilled in summarizing posts and comments. Ensure the generated summary is concise and captures the essence of the content.",
            },
            {"role": "user", "content": user_content},
        ],
        temperature=0.3,
        stream=True,
    )


def stream_summarization():
    global response

    while response is None:
        sleep(0.1)

    in_thinking = False
    buffer = ""
    thinking_started = False

    for chunk in response:
        content = chunk.choices[0].delta.content or ""
        if not content:
            continue

        # Check for thinking tags FIRST before processing
        if "<think>" in content and not thinking_started:
            # Split content at thinking tag
            before_think = content.split("<think>", 1)[0]
            after_think = content.split("<think>", 1)[1] if "<think>" in content else ""

            # Send content before thinking tag if any
            if before_think:
                escaped = before_think.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"

            # Start thinking mode
            yield f"data: __THINKING_START__\n\n"
            in_thinking = True
            thinking_started = True
            content = after_think
            if not content:
                continue

        # Check for thinking end
        if "</think>" in content:
            # Split content at end tag
            during_think = content.split("</think>", 1)[0]
            after_think = (
                content.split("</think>", 1)[1] if "</think>" in content else ""
            )

            # Send thinking content if any
            if during_think:
                escaped = during_think.replace("\n", "\\n")
                yield f"data: __THINKING_CONTENT__{escaped}\n\n"

            # End thinking mode
            in_thinking = False
            yield f"data: __THINKING_END__\n\n"
            content = after_think
            if not content:
                continue

        # Send regular content immediately (don't buffer)
        if content:
            escaped = content.replace("\n", "\\n")
            if in_thinking:
                yield f"data: __THINKING_CONTENT__{escaped}\n\n"
            else:
                yield f"data: {escaped}\n\n"

    # Send footer without escaping since it's intentional formatting
    yield f"data: \n"
    yield f"data: ---\n"
    yield f"data: \n"
    yield f"data: **Powered by {model}**\n\n"
    response = None


@app.route('/start-scrape-summarize', methods=['POST'])
def start_scrape_summarize():
    data = request.json
    url = data.get("url")

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
        start_stream(html)
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

    return Response(status=200)


@app.route('/stream-summary', methods=['GET'])
def stream_summary():
    return Response(stream_with_context(stream_summarization()), content_type='text/event-stream')


if __name__ == '__main__':
    app.run(debug=True, port=5000, threaded=True)
