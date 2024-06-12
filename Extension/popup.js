document.getElementById('summarize-button').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'summarize' });
});
