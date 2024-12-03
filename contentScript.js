// Basic content script
console.log('HamzaniBot content script loaded');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'CHECK_PAGE') {
        sendResponse({ status: 'ready' });
    }
});
