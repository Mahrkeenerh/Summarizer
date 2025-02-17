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
client = OpenAI(
    base_url='http://localhost:11434/v1',
    api_key=os.environ['OPENAI_API_KEY']
)

enc = tiktoken.get_encoding("o200k_base")

model = None
response = None

def start_stream(html):
    global model, response

    user_content = "Summarize a reddit post. Start section headers with markdown marking. First, make a summary on the post itself. Then summarize the content of the most common comments, and finally, include a content summary of the controversial or rare comments. If there are only a few comments, summarize them in a combined section instead. If there are zero comments, do not add any comment summaries.\n\n" + html
    user_content = enc.decode(enc.encode(user_content)[:100000])

    model = "qwen2.5:14b-instruct-q6_K"
    print(f"Using model: {model}")

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a summary assistant, skilled in summarizing posts and comments. Ensure the generated summary is concise and captures the essence of the content."},
            {"role": "user", "content": user_content}
        ],
        temperature=0.1,
        stream=True
    )


def stream_summarization():
    global response

    while response is None:
        sleep(0.1)

    for chunk in response:
        yield f"data: {chunk.choices[0].delta.content or ''}\n\n"

    yield f"data: # Powered by {model}\n \n\n"
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
