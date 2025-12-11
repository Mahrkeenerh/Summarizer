# Web Summarizer

Chrome extension that summarizes web pages and Reddit threads using local LLMs via llama.cpp.

## How It Works

- **Reddit**: Server fetches post + comments using Reddit API
- **Web pages**: Extension extracts article content using Mozilla Readability (same as Firefox Reader View)
- **Summarization**: Local LLM via llama-cpp-server generates summary
- Summary appears at top of page with delete button

## Setup

### 1. Server
```bash
cd Server
./setup.sh

# Configure Reddit API (https://www.reddit.com/prefs/apps)
cp RedditPostDownloader/config.yml.example RedditPostDownloader/config.yml
# Edit config.yml with your Reddit API credentials

# Install systemd service
sudo cp web-summarizer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable web-summarizer
sudo systemctl start web-summarizer
```

### 2. Extension
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `Extension/` directory

### 3. Configuration
Edit `Server/summarizer_server.py`:
- `base_url`: Your llama-cpp-server URL (default: `http://localhost:8080/v1`)
- `model`: Model name matching your llama-cpp-server config

## Requirements

- Python 3.8+
- llama-cpp-server running on port 8080
- Reddit API credentials (for Reddit posts only)
- Chrome/Chromium browser

## Usage

Click the extension icon → Summary appears at top of page

Remove summary by clicking the "Remove Summary" button below it

## Troubleshooting

**Server issues:**
```bash
sudo systemctl status web-summarizer
sudo journalctl -u web-summarizer -f
```

**LLM not responding:**
```bash
curl http://localhost:8080/health
```

**Page not extracting:**
- Works best on article-like content
- Some pages with paywalls/anti-scraping may fail
- Reddit posts always work (uses API)
