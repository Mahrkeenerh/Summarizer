const button = document.getElementById('summarize-button');
const questionInput = document.getElementById('question-input');

// Update button text based on whether question is entered
function updateButtonText() {
    const hasQuestion = questionInput.value.trim().length > 0;
    button.textContent = hasQuestion ? 'Ask Question' : 'Summarize Page';
}

// Listen for input changes
questionInput.addEventListener('input', updateButtonText);

document.getElementById('summarize-button').addEventListener('click', () => {
    const question = questionInput.value.trim();
    const defaultText = question ? 'Ask Question' : 'Summarize Page';

    // Show loading state
    button.disabled = true;
    button.textContent = 'Processing...';
    button.className = '';

    // Send message to background script with optional question
    chrome.runtime.sendMessage({ action: 'summarize', question: question }, (response) => {
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
