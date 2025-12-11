chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'summarize') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];

            // First, check if the summary-div is already present
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                function: checkSummaryDivPresence,
            }, (injectionResults) => {
                if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                    // Summary already exists - do not start new summarization
                    console.log('Summary already exists, skipping...');
                    sendResponse({ success: true, message: 'Summary already exists' });
                    return;
                }

                // Summary doesn't exist - create div and start summarization
                chrome.scripting.executeScript({
                    target: { tabId: activeTab.id },
                    function: ensureSummaryDivCreated,
                }, () => {
                    // After ensuring summaryDiv's existence, proceed with the fetch request
                    fetch('http://localhost:5000/start-scrape-summarize', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ url: activeTab.url })
                    }).then(response => {
                        if (response.ok) {
                            sendResponse({ success: true });
                            const eventSource = new EventSource('http://localhost:5000/stream-summary');

                            eventSource.onmessage = (event) => {
                                // Unescape newlines that were escaped for SSE protocol
                                const summaryChunk = event.data.replace(/\\n/g, '\n');
                                console.log('Received chunk:', JSON.stringify(summaryChunk));

                                // Close EventSource when we receive the "Powered by" footer
                                if (summaryChunk.includes('**Powered by')) {
                                    chrome.scripting.executeScript({
                                        target: { tabId: activeTab.id },
                                        function: displaySummaryChunk,
                                        args: [summaryChunk]
                                    });
                                    eventSource.close();
                                    return;
                                }

                                chrome.scripting.executeScript({
                                    target: { tabId: activeTab.id },
                                    function: displaySummaryChunk,
                                    args: [summaryChunk]
                                });
                            };

                            eventSource.onerror = (error) => {
                                console.error('EventSource error:', error);
                                eventSource.close();
                            };
                        } else {
                            sendResponse({ success: false, error: 'Server error' });
                        }
                    }).catch(error => {
                        sendResponse({ success: false, error: error.message });
                    });
                });
            });
        });
        return true; // Required for async sendResponse
    }
});

// This function remains as is
function checkSummaryDivPresence() {
    const summaryDiv = document.getElementById('summary-div');
    return !!summaryDiv;
}

// New function to ensure creation of the summaryDiv
function ensureSummaryDivCreated() {
    const summaryDivId = 'summary-div';
    let summaryDiv = document.getElementById(summaryDivId);

    if (!summaryDiv) {
        // Try multiple selectors for different Reddit layouts
        const mainContainer =
            document.querySelector('shreddit-post') ||
            document.querySelector('[slot="post-container"]') ||
            document.querySelector('main') ||
            document.querySelector('#main-content');

        if (!mainContainer) {
            console.error('Main container not found');
            return;
        }

        summaryDiv = document.createElement('div');
        summaryDiv.id = summaryDivId;
        summaryDiv.style.cssText = `
            margin: 20px;
            padding: 20px;
            background: #333333;
            color: #FFFFFF;
            border: 2px solid #FF4500;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Insert before the post
        mainContainer.parentNode.insertBefore(summaryDiv, mainContainer);
    }
}

function displaySummaryChunk(chunk) {
    const summaryDivId = 'summary-div';
    let summaryDiv = document.getElementById(summaryDivId);

    if (!summaryDiv) {
        console.error('Summary div not found');
        return;
    }

    // Use data attribute for persistence across execution contexts
    if (!summaryDiv.dataset.buffer) {
        summaryDiv.dataset.buffer = '';
    }

    // Handle thinking markers
    if (chunk === '__THINKING_START__') {
        const header = document.createElement('h2');
        header.textContent = '💭 Thinking Process';
        header.style.cssText = `
            color: #FF4500;
            font-size: 18px;
            font-weight: 600;
            margin: 20px 0 12px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid #FF4500;
        `;
        summaryDiv.appendChild(header);

        const content = document.createElement('div');
        content.id = 'thinking-content';
        content.style.cssText = `
            color: rgba(255, 255, 255, 0.7);
            font-size: 14px;
            line-height: 1.6;
            font-style: italic;
            margin-bottom: 20px;
        `;
        summaryDiv.appendChild(content);
        return;
    }

    if (chunk.startsWith('__THINKING_CONTENT__')) {
        const thinkingContent = document.getElementById('thinking-content');
        if (thinkingContent) {
            const text = chunk.replace('__THINKING_CONTENT__', '');
            thinkingContent.textContent += text;
        }
        return;
    }

    if (chunk === '__THINKING_END__') {
        // Check if thinking content is empty, remove if so
        const thinkingContent = document.getElementById('thinking-content');
        if (thinkingContent && !thinkingContent.textContent.trim()) {
            const header = thinkingContent.previousElementSibling;
            if (header) header.remove();
            thinkingContent.remove();
        }
        return;
    }

    // Append chunk directly - model output already includes proper spacing
    // Do NOT add spaces between chunks as tokens can be partial words
    summaryDiv.dataset.buffer += chunk;

    // Process each newline-separated chunk
    if (chunk.includes('\n')) {
        const lines = summaryDiv.dataset.buffer.split('\n');
        summaryDiv.dataset.buffer = lines.pop() || '';  // Keep incomplete line

        // Remove streaming paragraph when we have complete lines
        let streamingP = summaryDiv.querySelector('.streaming-paragraph');
        if (streamingP) {
            streamingP.remove();
        }

        lines.forEach(line => {
            const trimmed = line.trim();

            // Skip empty lines (they provide spacing via paragraph margins)
            if (!trimmed) return;

            // Check for header (##)
            if (trimmed.startsWith('##')) {
                const headerText = trimmed.replace(/^##\s*/, '');
                const header = document.createElement('h2');
                header.textContent = headerText;
                header.style.cssText = `
                    color: #FF4500;
                    font-size: 18px;
                    font-weight: 600;
                    margin: 20px 0 12px 0;
                    padding-bottom: 8px;
                    border-bottom: 2px solid #FF4500;
                `;
                summaryDiv.appendChild(header);
            }
            // Check for horizontal rule
            else if (trimmed.startsWith('---')) {
                const hr = document.createElement('hr');
                hr.style.cssText = `
                    border: none;
                    border-top: 1px solid #FF4500;
                    margin: 16px 0;
                `;
                summaryDiv.appendChild(hr);
            }
            // Regular text - create paragraph
            else {
                const p = document.createElement('p');
                p.innerHTML = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #FF4500;">$1</strong>');
                p.style.cssText = `
                    margin: 12px 0;
                    line-height: 1.8;
                    color: #FFFFFF;
                `;
                summaryDiv.appendChild(p);
            }
        });
    }

    // Always update or create paragraph for buffered content
    if (summaryDiv.dataset.buffer) {
        let lastElement = summaryDiv.lastElementChild;

        // Check if last element is our streaming paragraph
        if (lastElement && lastElement.classList.contains('streaming-paragraph')) {
            // Update existing streaming paragraph
            lastElement.innerHTML = summaryDiv.dataset.buffer.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #FF4500;">$1</strong>');
        } else {
            // Create new streaming paragraph
            const p = document.createElement('p');
            p.className = 'streaming-paragraph';
            p.innerHTML = summaryDiv.dataset.buffer.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #FF4500;">$1</strong>');
            p.style.cssText = `
                margin: 8px 0;
                line-height: 1.8;
                color: #FFFFFF;
            `;
            summaryDiv.appendChild(p);
        }
    }
}
