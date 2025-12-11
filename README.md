# Reddit Summarizer

Chrome extension that summarizes Reddit threads using local LLMs via llama.cpp.

## Architecture

```
Chrome Extension → Flask Server (port 5000) → llama-cpp-server (port 8080)
```

## Prerequisites

- Python 3.8+
- llama-cpp-server running on port 8080
- Reddit API credentials

## Setup

```bash
# Server
cd Server
./setup.sh

# Configure Reddit API (https://www.reddit.com/prefs/apps)
cp RedditPostDownloader/config.yml.example RedditPostDownloader/config.yml
# Edit config.yml with your credentials

# Install systemd service
sudo cp reddit-summarizer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable reddit-summarizer
sudo systemctl start reddit-summarizer

# Chrome extension
# Load unpacked extension from Extension/ directory
```

## Usage

Click extension icon on any Reddit thread → Summary appears at top of page

## Configuration

`Server/summarizer_server.py`:
- Change `base_url` to point to your llama-cpp-server
- Change `model` to match your llama-cpp-server config

## Troubleshooting

```bash
# Check server status
sudo systemctl status reddit-summarizer

# View logs
sudo journalctl -u reddit-summarizer -f

# Check llama-cpp-server
curl http://localhost:8080/health
```
