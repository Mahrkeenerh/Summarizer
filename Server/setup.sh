#!/bin/bash

set -e

echo "Setting up Reddit Summarizer Server..."

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
else
    echo "Virtual environment already exists"
fi

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install requirements
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Install RedditPostDownloader requirements
if [ -d "RedditPostDownloader" ]; then
    echo "Installing RedditPostDownloader dependencies..."
    pip install -r RedditPostDownloader/requirements.txt
fi

# Check .env file
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Creating template..."
    echo "OPENAI_API_KEY=not-needed" > .env
    echo "Created .env file. Edit if needed."
fi

# Check Reddit credentials
if [ ! -f "RedditPostDownloader/config.yml" ]; then
    echo ""
    echo "Warning: RedditPostDownloader/config.yml not found!"
    echo "You need to set up Reddit API credentials:"
    echo "  1. Copy RedditPostDownloader/config.yml.example to RedditPostDownloader/config.yml"
    echo "  2. Register a Reddit app at https://www.reddit.com/prefs/apps"
    echo "  3. Run: python RedditPostDownloader/authentication.py"
    echo "  4. Update config.yml with your credentials"
    echo ""
fi

echo ""
echo "Setup complete!"
echo ""
echo "To run the server:"
echo "  source venv/bin/activate"
echo "  python summarizer_server.py"
echo ""
echo "To install as systemd service:"
echo "  sudo cp reddit-summarizer.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable reddit-summarizer"
echo "  sudo systemctl start reddit-summarizer"
