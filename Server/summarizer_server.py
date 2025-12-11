import os
from time import sleep

from dotenv import load_dotenv
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
from openai import OpenAI
import tiktoken

import RedditPostDownloader.RedditArchiver as ra


app = Flask(__name__)
CORS(app)

load_dotenv()
client = OpenAI(base_url="http://localhost:8080/v1", api_key="not-needed")

enc = tiktoken.get_encoding("o200k_base")

# model = "qwen3-14b-q6_K"  # Update to match your llama-cpp-server config.json
model = "Qwen3-8B-Q6_K"  # Update to match your llama-cpp-server config.json
response = None

def start_stream(html):
    global response

    user_content = (
        "/no_think\n\nSummarize a reddit post. Use ONLY ## for section headers (no other header levels). "
        + "Write three sections: ## Post Summary, ## Common Comments, and ## Controversial Comments. "
        + "For Post Summary, describe the main post. For Common Comments, summarize prevalent viewpoints. "
        + "For Controversial Comments, summarize minority or alternative opinions. "
        + "If there are only a few comments, combine them into a single ## Comments section instead. "
        + "Skip any section if there is no relevant content. Do not add titles, introductions, or extra headers.\n\n"
        + html
    )
    user_content = enc.decode(enc.encode(user_content)[:100000])

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

        buffer += content

        # Detect thinking start
        if "<think>" in buffer and not thinking_started:
            yield f"data: __THINKING_START__\n\n"
            in_thinking = True
            thinking_started = True
            buffer = buffer.split("<think>", 1)[1] if "<think>" in buffer else ""
            continue

        # Detect thinking end
        if "</think>" in buffer:
            remaining = buffer.split("</think>", 1)[0]
            if remaining:
                yield f"data: __THINKING_CONTENT__{remaining}\n\n"
            in_thinking = False
            yield f"data: __THINKING_END__\n\n"
            buffer = buffer.split("</think>", 1)[1] if "</think>" in buffer else ""
            continue

        # Send content with appropriate prefix
        # Escape newlines for SSE protocol (newlines break SSE messages)
        if in_thinking and content:
            escaped = content.replace("\n", "\\n")
            yield f"data: __THINKING_CONTENT__{escaped}\n\n"
        elif not in_thinking and content:
            escaped = content.replace("\n", "\\n")
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
    url = data['url']
    html, submission = ra.scrape_url(url)
    start_stream(html)

    return Response(status=200)


@app.route('/stream-summary', methods=['GET'])
def stream_summary():
    return Response(stream_with_context(stream_summarization()), content_type='text/event-stream')


if __name__ == '__main__':
    app.run(debug=True, port=5000, threaded=True)
