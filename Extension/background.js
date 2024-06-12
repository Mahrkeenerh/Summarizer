chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'summarize') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];

            // First, check if the summary-div is already present
            chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                function: checkSummaryDivPresence,
            }, (injectionResults) => {
                if (injectionResults && injectionResults[0] && !injectionResults[0].result) {
                    // Ensure the summaryDiv is created before sending the URL to the server
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
                            // console.log('response', response);
                            const eventSource = new EventSource('http://localhost:5000/stream-summary');

                            eventSource.onmessage = (event) => {
                                const summaryChunk = event.data;
                                chrome.scripting.executeScript({
                                    target: { tabId: activeTab.id },
                                    func: displaySummaryChunk,
                                    args: [summaryChunk]
                                });
                            };

                            eventSource.onerror = (error) => {
                                eventSource.close();
                            };
                        });
                    });
                }
            });
        });
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
        const mainContainer = document.querySelector('.main.w-full.flex-grid--main-container-card.right-sidebar-xs');
        if (!mainContainer) {
            // console.error('Main container not found');
            return;
        }

        summaryDiv = document.createElement('div');
        summaryDiv.id = summaryDivId;
        summaryDiv.style.margin = '10px';

        if (mainContainer.firstChild) {
            mainContainer.insertBefore(summaryDiv, mainContainer.firstChild);
        } else {
            mainContainer.appendChild(summaryDiv);
        }
    }
}

function displaySummaryChunk(chunk) {
    const summaryDivId = 'summary-div';
    let summaryDiv = document.getElementById(summaryDivId);
    let last_sub_element = summaryDiv.lastElementChild;

    if (chunk === '' || chunk.includes('\n')) {
        last_sub_element = document.createElement('div');
        last_sub_element.innerText += chunk;
        summaryDiv.appendChild(last_sub_element);
    } else if (chunk.includes('#')) {
        if (last_sub_element.tagName === 'H2') {
            last_sub_element.innerText += chunk;
        } else {
            last_sub_element = document.createElement('h2');
            last_sub_element.style.padding = '10px';
            last_sub_element.innerText = chunk;
            summaryDiv.appendChild(last_sub_element);
        }
    } else {
        if (last_sub_element) {
            last_sub_element.innerText += chunk;
        } else {
            last_sub_element = document.createElement('div');
            last_sub_element.innerText = chunk;
            summaryDiv.appendChild(last_sub_element);
        }
    }
}
