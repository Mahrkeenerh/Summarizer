<!-- https://platform.openai.com/api-keys -->

# Reddit Thread Summarizer

Summarize a Reddit thread using OpenAI's API models.


## Installation

### RedditPostDownloader

Follow the instructions in the [RedditPostDownloader](https://github.com/Mahrkeenerh/RedditPostDownloader/).

### Dependencies

Clone the repository and install the dependencies:

```bash
python -m pip install -r requirements.txt
```

### OpenAI API Key

Create a `.env` file in the [Server](./Server) directory and add your OpenAI API key (https://platform.openai.com/api-keys):

```bash
OPENAI_API_KEY=your-api-key
```

### Chrome Extension

Enable developer mode in Chrome and load unpacked extension from the [Extension](./Extension) directory.


## Usage

Run the server:

```bash
python Server/app.py
```

Open a Reddit thread and click on the extension icon -> button to summarize the thread.
