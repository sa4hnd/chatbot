document.addEventListener('DOMContentLoaded', function() {
    const statusDiv = document.getElementById('debugStatus');
    const toggleButton = document.getElementById('toggleBot');
    const messagesSentSpan = document.getElementById('messagesSent');
    const messagesReceivedSpan = document.getElementById('messagesReceived');
    const enableMassMessaging = document.getElementById('enableMassMessaging');
    const messageDelay = document.getElementById('messageDelay');
    const chatStyle = document.getElementById('chatStyle');
    const typingSpeed = document.getElementById('typingSpeed');

    // Initialize UI state
    chrome.storage.local.get(['botState'], function(result) {
        if (result.botState) {
            updateUI(result.botState);
        }
    });

    // Listen for state updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'STATE_UPDATE') {
            updateUI(message.state);
        }
        if (message.type === 'STATS_UPDATE') {
            updateStats(message.stats);
        }
        if (message.type === 'LOG_UPDATE') {
            addLogToUI(message.log);
        }
    });

    // Toggle bot
    toggleButton.addEventListener('click', function() {
        chrome.runtime.sendMessage({ 
            action: 'TOGGLE_BOT' 
        }, response => {
            if (response.success) {
                updateUI(response.state);
                console.log('Bot state updated:', response.state);
            } else {
                console.error('Failed to toggle bot:', response.error);
            }
        });
    });

    // Update mass messaging settings
    enableMassMessaging.addEventListener('change', function() {
        chrome.runtime.sendMessage({
            action: 'UPDATE_SETTINGS',
            settings: {
                massMessageData: {
                    isEnabled: this.checked
                }
            }
        });
    });

    messageDelay.addEventListener('change', function() {
        chrome.runtime.sendMessage({
            action: 'UPDATE_SETTINGS',
            settings: {
                massMessageData: {
                    messageDelay: parseInt(this.value)
                }
            }
        });
    });

    // Update chat settings
    chatStyle.addEventListener('change', function() {
        chrome.runtime.sendMessage({
            action: 'UPDATE_SETTINGS',
            settings: {
                chatStyle: this.value
            }
        });
    });

    typingSpeed.addEventListener('change', function() {
        chrome.runtime.sendMessage({
            action: 'UPDATE_SETTINGS',
            settings: {
                typingSpeed: this.value
            }
        });
    });

    // Add this to your existing popup.js event listeners
    document.getElementById('sendCustomMessage').addEventListener('click', async function() {
        const message = document.getElementById('customMessage').value;
        const count = document.getElementById('recipientCount').value;

        if (!message) {
            alert('Please enter a message');
            return;
        }

        this.disabled = true;
        this.textContent = 'Sending...';

        chrome.runtime.sendMessage({
            action: 'SEND_MASS_MESSAGE',
            data: {
                message: message,
                recipientCount: parseInt(count)
            }
        }, response => {
            this.disabled = false;
            this.textContent = 'Send Custom Message';

            if (response.success) {
                alert(`Message sent successfully to ${count} recipients`);
                updateStats(response.stats);
            } else {
                alert('Failed to send message: ' + response.error);
            }
        });
    });

    function updateUI(state) {
        statusDiv.textContent = state.isEnabled ? 'Bot is debugging Chrome' : 'Bot is inactive';
        statusDiv.className = `status ${state.isEnabled ? 'active' : 'inactive'}`;
        toggleButton.textContent = state.isEnabled ? 'Stop Bot' : 'Start Bot';
        
        // Update settings UI
        enableMassMessaging.checked = state.settings?.massMessageData?.isEnabled || false;
        messageDelay.value = state.settings?.massMessageData?.messageDelay || 5;
        chatStyle.value = state.settings?.chatStyle || 'youth';
        typingSpeed.value = state.settings?.typingSpeed || 'medium';
        
        // Update custom message UI
        document.getElementById('customMessage').disabled = !state.isEnabled;
        document.getElementById('recipientCount').disabled = !state.isEnabled;
        document.getElementById('sendCustomMessage').disabled = !state.isEnabled;
    }

    function updateStats(stats) {
        messagesSentSpan.textContent = stats.messagesSent;
        messagesReceivedSpan.textContent = stats.messagesReceived;
    }

    // Log initialization
    console.log('Popup initialized');

    // Add this to your existing popup.js
    function addLogToUI(log) {
        const logsContainer = document.getElementById('logsContainer');
        if (!logsContainer) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${log.level.toLowerCase()}`;
        logEntry.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.level}: ${log.message}`;
        
        logsContainer.insertBefore(logEntry, logsContainer.firstChild);
        if (logsContainer.children.length > 100) {
            logsContainer.removeChild(logsContainer.lastChild);
        }
    }
});
