document.getElementById('summarize-button').addEventListener('click', () => {
    const button = document.getElementById('summarize-button');
    const defaultText = 'Summarize This Page';

    // Show loading state
    button.disabled = true;
    button.textContent = 'Processing...';
    button.className = '';

    // Send message to background script
    chrome.runtime.sendMessage({ action: 'summarize' }, (response) => {
        button.disabled = false;

        if (response && response.success) {
            if (response.message === 'Summary already exists') {
                button.textContent = 'Already exists!';
            } else {
                button.textContent = 'Done!';
            }
            button.className = 'success';
        } else if (response && response.error) {
            button.textContent = 'Error!';
            button.className = 'error';
        } else {
            button.textContent = 'Server offline';
            button.className = 'error';
        }

        // Reset button after 2 seconds
        setTimeout(() => {
            button.textContent = defaultText;
            button.className = '';
        }, 2000);
    });
});
