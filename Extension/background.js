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

                // Summary doesn't exist - inject Readability library first, then extract content
                chrome.scripting.executeScript({
                    target: { tabId: activeTab.id },
                    files: ['Readability.js']
                }, () => {
                    chrome.scripting.executeScript({
                        target: { tabId: activeTab.id },
                        function: extractPageContent,
                    }, (extractionResults) => {
                        if (!extractionResults || !extractionResults[0]) {
                            console.error('Script injection failed');
                            sendResponse({ success: false, error: 'Script injection failed' });
                            return;
                        }

                        const pageData = extractionResults[0].result;

                        // Check if extraction failed
                        if (!pageData) {
                            console.error('Failed to extract page content - page may not be readable');
                            // Create summary div and show error
                            chrome.scripting.executeScript({
                                target: { tabId: activeTab.id },
                                function: ensureSummaryDivCreated,
                            }, () => {
                            chrome.scripting.executeScript({
                                target: { tabId: activeTab.id },
                                function: displayError,
                                args: ['This page does not appear to have readable article content. Try a different page with article-like content.']
                            }, () => {
                                chrome.scripting.executeScript({
                                    target: { tabId: activeTab.id },
                                    function: addDeleteButton
                                });
                            });
                        });
                            sendResponse({ success: false, error: 'Page not readable' });
                            return;
                        }

                        console.log('Extracted page data:', { type: pageData.type, contentLength: pageData.content ? pageData.content.length : 'N/A' });

                        // Create summary div
                        chrome.scripting.executeScript({
                            target: { tabId: activeTab.id },
                            function: ensureSummaryDivCreated,
                        }, () => {
                            // Prepare request data
                            const requestData = pageData.type === 'reddit'
                                ? { url: pageData.url }  // Let server fetch Reddit content
                                : pageData;              // Send extracted content for general pages

                            // Send to server
                            fetch('http://localhost:5000/start-scrape-summarize', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                            body: JSON.stringify(requestData)
                        }).then(async response => {
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
                                    }, () => {
                                        // Add delete button after summary is complete
                                        chrome.scripting.executeScript({
                                            target: { tabId: activeTab.id },
                                            function: addDeleteButton
                                        });
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
                            // Get error message from server
                            const errorText = await response.text();
                            console.error('Server error:', errorText);

                            // Display error in the summary div
                            chrome.scripting.executeScript({
                                target: { tabId: activeTab.id },
                                function: displayError,
                                args: [errorText || 'Failed to extract content from this page']
                            }, () => {
                                chrome.scripting.executeScript({
                                    target: { tabId: activeTab.id },
                                    function: addDeleteButton
                                });
                            });

                            sendResponse({ success: false, error: errorText || 'Server error' });
                        }
                    }).catch(error => {
                        console.error('Fetch error:', error);

                        // Display error in the summary div
                        chrome.scripting.executeScript({
                            target: { tabId: activeTab.id },
                            function: displayError,
                            args: [error.message || 'Connection error']
                        }, () => {
                            chrome.scripting.executeScript({
                                target: { tabId: activeTab.id },
                                function: addDeleteButton
                            });
                        });

                        sendResponse({ success: false, error: error.message });
                    });
                    });
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
    return !!(summaryDiv);
}

// Extract page content using Mozilla Readability for general pages
function extractPageContent() {
    // For Reddit pages - let server handle it
    if (window.location.hostname.includes('reddit.com')) {
        return {
            type: 'reddit',
            url: window.location.href
        };
    }

    // For general web pages - use Mozilla Readability
    try {
        // Clone document to avoid modifying the actual page
        const documentClone = document.cloneNode(true);

        // Use Readability to extract article content
        const reader = new Readability(documentClone);
        const article = reader.parse();

        if (article && article.content) {
            // Validate content has meaningful text (not just HTML tags)
            const textContent = article.textContent || article.content.replace(/<[^>]*>/g, '');
            const textLength = textContent.trim().length;

            console.log(`Extracted content: ${article.content.length} chars HTML, ${textLength} chars text`);

            if (textLength < 100) {
                console.warn('Content too short, may not be a proper article');
                return null;
            }

            return {
                type: 'general',
                content: article.content,
                url: window.location.href,
                title: article.title || document.title,
                textLength: textLength
            };
        } else {
            // Readability failed - return error indicator
            console.warn('Readability parse failed - no article content found');
            return null;
        }
    } catch (error) {
        console.error('Readability error:', error);
        return null;
    }
}

// New function to ensure creation of the summaryDiv
function ensureSummaryDivCreated() {
    const summaryDivId = 'summary-div';
    let summaryDiv = document.getElementById(summaryDivId);

    if (!summaryDiv) {
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

        // Determine where to insert based on page structure
        let insertionPoint = null;
        let insertBefore = true;

        // Try Reddit-specific selectors first
        const redditPost = document.querySelector('shreddit-post') ||
            document.querySelector('[slot="post-container"]');

        if (redditPost) {
            // Reddit page - insert before post
            insertionPoint = redditPost;
        } else {
            // General webpage - try to find article or main content
            const article = document.querySelector('article');
            const main = document.querySelector('main');
            const content = document.querySelector('#content, .content, #main-content, .main-content');

            insertionPoint = article || main || content;
        }

        // Insert the summary div
        if (insertionPoint && insertionPoint.parentNode) {
            if (insertBefore) {
                insertionPoint.parentNode.insertBefore(summaryDiv, insertionPoint);
            } else {
                insertionPoint.insertBefore(summaryDiv, insertionPoint.firstChild);
            }
        } else {
            // Fallback: insert at the top of body
            if (document.body.firstChild) {
                document.body.insertBefore(summaryDiv, document.body.firstChild);
            } else {
                document.body.appendChild(summaryDiv);
            }
        }
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

function displayError(errorMessage) {
    const summaryDivId = 'summary-div';
    let summaryDiv = document.getElementById(summaryDivId);

    if (!summaryDiv) {
        console.error('Summary div not found');
        return;
    }

    // Clear any existing content
    summaryDiv.innerHTML = '';

    // Determine error type and appropriate header/suggestion
    const isServerError = errorMessage.includes('llama') || errorMessage.includes('model') || errorMessage.includes('load');
    const isConnectionError = errorMessage === 'Failed to fetch' || errorMessage.includes('NetworkError') || errorMessage.includes('Connection');

    let headerText = 'Summarization Failed';
    let suggestionText = '';

    if (isConnectionError) {
        headerText = 'Connection Error';
        suggestionText = 'Could not connect to the summarization server. Make sure the server is running on localhost:5000.';
    } else if (isServerError) {
        headerText = 'Server Error';
        suggestionText = 'The LLM backend encountered an error. Check if the model is loaded correctly.';
    } else {
        suggestionText = 'This page may require JavaScript, block automated access, or have limited text content. Try a different page.';
    }

    // Add error header
    const header = document.createElement('h2');
    header.textContent = headerText;
    header.style.cssText = `
        color: #FF4500;
        font-size: 18px;
        font-weight: 600;
        margin: 0 0 12px 0;
        padding-bottom: 8px;
        border-bottom: 2px solid #FF4500;
    `;
    summaryDiv.appendChild(header);

    // Add error message
    const p = document.createElement('p');
    p.textContent = errorMessage;
    p.style.cssText = `
        margin: 12px 0;
        line-height: 1.8;
        color: #FFFFFF;
    `;
    summaryDiv.appendChild(p);

    // Add suggestion
    if (suggestionText) {
        const suggestion = document.createElement('p');
        suggestion.textContent = suggestionText;
        suggestion.style.cssText = `
            margin: 12px 0;
            line-height: 1.8;
            color: rgba(255, 255, 255, 0.7);
            font-size: 14px;
            font-style: italic;
        `;
        summaryDiv.appendChild(suggestion);
    }
}

// Add delete button below the summary div
function addDeleteButton() {
    const summaryDiv = document.getElementById('summary-div');
    if (!summaryDiv) {
        console.error('Summary div not found');
        return;
    }

    // Check if button already exists
    if (document.getElementById('summary-delete-btn')) {
        return;
    }

    // Create button container (outside the border)
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'summary-delete-btn-container';
    buttonContainer.style.cssText = `
        text-align: center;
        margin: 10px 20px;
    `;

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.id = 'summary-delete-btn';
    deleteBtn.textContent = '✕ Remove Summary';
    deleteBtn.style.cssText = `
        background: #FF4500;
        color: #FFFFFF;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
    `;

    // Hover effects
    deleteBtn.onmouseover = () => {
        deleteBtn.style.background = '#CC3700';
        deleteBtn.style.transform = 'scale(1.05)';
    };
    deleteBtn.onmouseout = () => {
        deleteBtn.style.background = '#FF4500';
        deleteBtn.style.transform = 'scale(1)';
    };

    // Click handler
    deleteBtn.onclick = () => {
        const summaryDiv = document.getElementById('summary-div');
        const buttonContainer = document.getElementById('summary-delete-btn-container');
        if (summaryDiv) summaryDiv.remove();
        if (buttonContainer) buttonContainer.remove();
    };

    buttonContainer.appendChild(deleteBtn);

    // Insert after summary div
    if (summaryDiv.nextSibling) {
        summaryDiv.parentNode.insertBefore(buttonContainer, summaryDiv.nextSibling);
    } else {
        summaryDiv.parentNode.appendChild(buttonContainer);
    }
}
