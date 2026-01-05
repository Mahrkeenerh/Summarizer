# Web Summarizer - Agent Context

## Overview

Chrome extension backend that summarizes web pages and Reddit threads using local LLMs via llama-cpp-server. The server extracts content and sends it to a local LLM for summarization.

## Architecture

```
Extension (Chrome) --> Server (Flask :5000) --> llama-cpp-server (:8080)
                           |
                           +--> Reddit API (for Reddit posts)
```

## Quick Commands

```bash
# Start/stop/restart
systemctl --user start web-summarizer
systemctl --user stop web-summarizer
systemctl --user restart web-summarizer

# View logs
journalctl --user -u web-summarizer -f

# Check status
systemctl --user status web-summarizer

# Reinstall/update
./install.sh
```

## Configuration

- **Server config**: `Server/.env` (environment variables)
- **Reddit API**: `Server/RedditPostDownloader/config.yml`
- **LLM settings**: Hardcoded in `Server/summarizer_server.py`:
  - `base_url`: llama-cpp-server URL (default: `http://localhost:8080/v1`)
  - `model`: Model name for the LLM
  - Token limit: 12k tokens (for 16k GPU context)

## Dependencies

- **llama-cpp-server**: Must be running on port 8080
- **Python packages**: Flask, OpenAI client, trafilatura, tiktoken, Flask-CORS
- **Reddit API credentials**: Required only for Reddit post summarization

## Troubleshooting

### Service won't start

1. Check logs: `journalctl --user -u web-summarizer -n 50`
2. Verify venv exists: `ls Server/venv/bin/python`
3. Check if port 5000 is in use: `lsof -i :5000`
4. Ensure install.sh was run: `./install.sh`

### LLM not responding

1. Check llama-cpp-server health: `curl http://localhost:8080/health`
2. Check llama-cpp-server status: `systemctl status llama-cpp-server`
3. Verify model is loaded in llama-cpp-server logs

### Extension not connecting

1. Check server is running: `curl http://localhost:5000/health`
2. Verify CORS is enabled (should be by default)
3. Check browser console for errors
4. Ensure extension is loaded in Chrome

### Reddit posts not working

1. Verify Reddit credentials in `Server/RedditPostDownloader/config.yml`
2. Check if Reddit API is accessible
3. Look for authentication errors in logs

### Content extraction fails

- Some pages with paywalls/anti-scraping may fail
- Works best on article-like content
- Reddit posts always work (uses API directly)

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Connection refused" | Server not running | `systemctl --user start web-summarizer` |
| "Model not found" | Wrong model name | Check model name in summarizer_server.py matches llama-cpp-server |
| "Context too long" | Article too large | Content is auto-truncated to 12k tokens |
| Empty summary | LLM timeout | Check llama-cpp-server logs, may need more memory |
| Reddit 401 error | Bad credentials | Re-run `python RedditPostDownloader/authentication.py` |

## Ports

- **5000**: Web Summarizer server (this service)
- **8080**: llama-cpp-server (dependency)

## File Locations

- Service file: `systemd/web-summarizer.service`
- Main server: `Server/summarizer_server.py`
- Extension: `Extension/` directory
- Virtual environment: `Server/venv/`
