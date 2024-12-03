// Handle Reddit OAuth callback
window.onload = function() {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = params.get('access_token');
    
    if (accessToken) {
        chrome.runtime.sendMessage({
            action: 'SAVE_REDDIT_TOKEN',
            token: accessToken
        }, response => {
            window.close();
        });
    }
}; 