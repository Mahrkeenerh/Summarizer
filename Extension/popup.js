document.getElementById('summarize-button').addEventListener('click', () => {
    const status = document.getElementById('status');
    const button = document.getElementById('summarize-button');

    // Show loading state
    status.textContent = 'Generating summary...';
    status.className = 'active';
    button.disabled = true;
    button.textContent = 'Processing...';

    // Send message to background script
    chrome.runtime.sendMessage({ action: 'summarize' }, (response) => {
        button.disabled = false;
        button.textContent = 'Summarize This Thread';

        if (response && response.success) {
            if (response.message === 'Summary already exists') {
                status.textContent = 'Summary already exists!';
                status.className = 'active success';
            } else {
                status.textContent = 'Summary added to page!';
                status.className = 'active success';
            }
        } else if (response && response.error) {
            status.textContent = `Error: ${response.error}`;
            status.className = 'active error';
        } else {
            status.textContent = 'Server not responding. Check if server is running.';
            status.className = 'active error';
        }

        // Hide status after 4 seconds
        setTimeout(() => {
            status.className = '';
        }, 4000);
    });
});
