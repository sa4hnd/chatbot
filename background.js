// Constants
const API_ENDPOINTS = {
  REDDIT_CHAT: 'https://chat.reddit.com/svc/matrix-web/v2j',
  MATRIX_SYNC: 'https://matrix.redditspace.com/_matrix/client/v3/sync',
  LLAMA_API: 'https://api.llama-api.com/chat/completions',
  MONGODB: 'mongodb+srv://admin:Hemzany211@fergeh.5fyte.mongodb.net/?retryWrites=true&w=majority&appName=Fergeh'
};

// API Configurations
const REDDIT_OAUTH = {
  CLIENT_ID: 'a8mF9CzD49e7WKDCQvQmGA',
  CLIENT_SECRET: 'DbqrrsJiFarGy9v72FNkiR4qv3dE8g',
  REDIRECT_URL: 'https://agiianhjoknekpojmphjgolbjdkacidn.chromiumapp.org/callback',
  SCOPES: ['identity', 'read', 'privatemessages', 'submit', 'history', 'account']
};

const LLAMA_CONFIG = {
  API_TOKEN: 'LA-511ac35c2d834508b2deebafb91382cf9cd343cc074f407cb26171190e972321',
  MODEL: 'llama3.1-70b'
};

// Enhanced bot state management (matching CupidBot's structure)
let botState = {
  isEnabled: false,
  accessToken: null,
  stats: {
    messagesSent: 0,
    messagesReceived: 0
  },
  settings: {
    massMessageData: {
      isEnabled: false,
      messageDelay: 5
    },
    chatStyle: 'youth',
    typingSpeed: 'medium'
  }
};

// Add these logging functions
const LOG_LEVELS = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    API: 'API',
    CHAT: 'CHAT',
    LLAMA: 'LLAMA',
    REDDIT: 'REDDIT'
};

// Enhanced logging function
function logWithDetails(level, message, details = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level}: ${message}`;
    
    console.log(logMessage, details);
    
    // Store log in memory for popup
    const logEntry = {
        timestamp,
        level,
        message,
        details: details ? JSON.stringify(details) : null
    };

    // Keep logs in memory
    if (!botState.logs) botState.logs = [];
    botState.logs.unshift(logEntry);
    if (botState.logs.length > 1000) botState.logs.pop();

    // Send to popup if it exists
    try {
        chrome.runtime.sendMessage({
            type: 'LOG_UPDATE',
            log: logEntry
        });
    } catch (error) {
        console.log('Popup not ready for logs');
    }
}

// Add API request logging
async function makeAPIRequest(endpoint, options, type = 'API') {
    logWithDetails(type, `Making ${options.method || 'GET'} request to ${endpoint}`, {
        headers: options.headers,
        body: options.body
    });

    try {
        const response = await fetch(endpoint, options);
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        logWithDetails(type, 'API request successful', { data });
        return data;
    } catch (error) {
        logWithDetails('ERROR', `${type} request failed:`, error);
        throw error;
    }
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logWithDetails('DEBUG', 'Received message:', message);
  
  switch (message.action) {
    case 'TOGGLE_BOT':
      handleToggleBot(sendResponse);
      break;
    case 'SAVE_REDDIT_TOKEN':
      handleSaveToken(message.token, sendResponse);
      break;
    case 'GET_STATE':
      sendResponse({ state: botState });
      break;
    case 'SEND_MASS_MESSAGE':
      handleMassMessage(message.data, sendResponse);
      break;
  }
  return true;
});

// Initialize extension on install or update
chrome.runtime.onInstalled.addListener(async () => {
    logWithDetails('INFO', 'Extension installed/updated, initializing...');
    await initializeExtension();
});

// Initialize extension on browser startup
chrome.runtime.onStartup.addListener(async () => {
    logWithDetails('INFO', 'Browser started, initializing extension...');
    await initializeExtension();
});

// Main initialization function
async function initializeExtension() {
    try {
        // Create persistent popup
        await createPersistentPopup();

        // Check if we have stored credentials
        const stored = await chrome.storage.local.get(['botState', 'redditToken']);
        if (stored.redditToken) {
            botState.accessToken = stored.redditToken;
            logWithDetails('INFO', 'Found stored Reddit token');
        }

        // Initialize debugger
        await initializeDebugger();
        logWithDetails('INFO', 'Debugger initialized');

        // Try to restore previous state
        if (stored.botState?.isEnabled) {
            logWithDetails('INFO', 'Restoring previous bot state');
            await handleToggleBot(() => {});
        }
    } catch (error) {
        logWithDetails('ERROR', 'Initialization failed:', error);
    }
}

// Handle bot toggle with proper debugging
async function handleToggleBot(sendResponse) {
    try {
        if (authInProgress) {
            logWithDetails('INFO', 'Auth in progress, please wait...');
            sendResponse({ success: false, error: 'Authentication in progress' });
            return;
        }

        botState.isEnabled = !botState.isEnabled;
        logWithDetails('INFO', `Bot ${botState.isEnabled ? 'starting' : 'stopping'}...`);

        if (botState.isEnabled) {
            // Initialize debugger if not already attached
            if (!botState.debuggerAttached) {
                await initializeDebugger();
            }

            // Check for stored token first
            const stored = await chrome.storage.local.get(['redditToken']);
            if (stored.redditToken) {
                botState.accessToken = stored.redditToken;
                logWithDetails('INFO', 'Using stored Reddit token');
            } else {
                // Start Reddit auth if needed
                await initiateRedditAuth();
            }

            // Start bot operations
            await startBotOperations();
        } else {
            // Cleanup
            if (botState.debuggerAttached) {
                try {
                    await chrome.debugger.detach({ tabId: botState.debuggerTabId });
                    botState.debuggerAttached = false;
                    botState.debuggerTabId = null;
                } catch (error) {
                    logWithDetails('WARN', 'Error detaching debugger:', error);
                }
            }
            
            if (botState.keepAliveInterval) {
                clearInterval(botState.keepAliveInterval);
            }
        }

        // Save state
        await chrome.storage.local.set({ botState });
        
        sendResponse({ 
            success: true, 
            state: botState,
            message: `Bot ${botState.isEnabled ? 'started' : 'stopped'} successfully`
        });

    } catch (error) {
        logWithDetails('ERROR', 'Toggle failed:', error);
        botState.isEnabled = false;
        sendResponse({ success: false, error: error.message });
        await chrome.storage.local.set({ botState });
    }
}

// Handle Reddit token save
async function handleSaveToken(token, sendResponse) {
    try {
        logWithDetails('INFO', 'Saving Reddit token...');
        botState.accessToken = token;
        
        // Store token in chrome storage
        await chrome.storage.local.set({ 
            redditToken: token,
            botState: botState 
        });

        logWithDetails('INFO', 'Reddit token saved successfully');
        
        // Start bot operations after successful auth
        if (botState.isEnabled) {
            await startBotOperations();
        }

        sendResponse({ success: true });
        authInProgress = false;
    } catch (error) {
        logWithDetails('ERROR', 'Failed to save Reddit token:', error);
        sendResponse({ success: false, error: error.message });
        authInProgress = false;
    }
}

// Mass messaging functionality
async function sendMassMessage(recipients, template) {
  for (const recipient of recipients) {
    try {
      // Generate personalized message using Llama
      const personalizedMessage = await generateAIResponse(template, [{
        role: "system",
        content: "Personalize this message template while maintaining its core meaning"
      }]);

      // Send message with delay
      await new Promise(r => setTimeout(r, botState.settings.messageDelay * 1000));
      await sendMatrixMessage(recipient.roomId, personalizedMessage);

      // Update stats
      botState.stats.messagesSent++;
      await updateMongoDB('stats', botState.stats);

    } catch (error) {
      console.error('Mass message error:', error);
    }
  }
}

// Enhanced Matrix sync with auto-reconnect
async function initializeMatrixSync(token) {
  const filter = {
    room: {
      state: { lazy_load_members: true },
      timeline: {
        lazy_load_members: true,
        not_types: ["com.reddit.review_open", "com.reddit.review_close"],
        not_aggregated_relations: [
          "m.annotation",
          "com.reddit.hide_user_content",
          "com.reddit.potentially_toxic",
          "com.reddit.display_settings",
          "com.reddit.review_request"
        ],
        unread_thread_notifications: true
      }
    }
  };

  const syncLoop = async () => {
    try {
      const response = await fetch(`${API_ENDPOINTS.MATRIX_SYNC}?filter=${encodeURIComponent(JSON.stringify(filter))}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      await processMatrixEvents(data);
      
      // Continue sync loop
      setTimeout(syncLoop, 1000);
    } catch (error) {
      console.error('Matrix sync failed:', error);
      setTimeout(syncLoop, 5000);
    }
  };

  syncLoop();
}

// Enhanced message processing with AI chat
async function processMatrixEvents(data) {
  if (!data.rooms?.join) return;

  for (const [roomId, room] of Object.entries(data.rooms.join)) {
    if (!room.timeline?.events) continue;

    for (const event of room.timeline.events) {
      if (event.type === 'm.room.message' && event.sender !== botState.accountID) {
        try {
          // Update stats
          botState.stats.messagesReceived++;
          
          // Get conversation context
          const context = await getConversationContext(roomId);
          
          // Generate AI response
          const aiResponse = await generateAIResponse(event.content.body, context);
          
          // Add typing delay for realism
          await new Promise(r => setTimeout(r, calculateTypingDelay(aiResponse)));
          
          // Send response
          await sendMatrixMessage(roomId, aiResponse);
          
          // Store in MongoDB
          await storeConversation({
            roomId,
            message: event.content.body,
            response: aiResponse,
            timestamp: new Date()
          });

          // Update stats
          botState.stats.messagesSent++;
          await updateMongoDB('stats', botState.stats);

        } catch (error) {
          console.error('Message processing error:', error);
        }
      }
    }
  }
}

// Helper function to calculate realistic typing delay
function calculateTypingDelay(message) {
  const wordsPerMinute = 30; // Slow typing speed for realism
  const words = message.split(' ').length;
  return (words / wordsPerMinute) * 60 * 1000;
}

// Initialize debugger and keep extension alive
async function initializeDebugger() {
    logWithDetails('INFO', 'Starting debugger initialization...');
    
    try {
        const tab = await ensureRedditChatTab();
        
        // Attach debugger to the Reddit chat tab
        if (!botState.debuggerAttached) {
            await chrome.debugger.attach({ tabId: tab.id }, '1.3');
            botState.debuggerTabId = tab.id;
            botState.debuggerAttached = true;
            
            // Enable necessary debugger domains
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable');
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable');
            
            logWithDetails('INFO', 'Debugger attached successfully', { tabId: tab.id });
        }

        // Keep tab alive
        startTabKeepAlive();
        
    } catch (error) {
        logWithDetails('ERROR', 'Debugger initialization failed:', error);
        setTimeout(initializeDebugger, 5000);
    }
}

// Separate function for attaching debugger
async function attachDebugger(tabId) {
    try {
        await chrome.debugger.attach({ tabId }, '1.3');
        botState.debuggerTabId = tabId;
        botState.debuggerAttached = true;
        
        // Enable necessary debugger domains
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
        await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
        
        logWithDetails('INFO', 'Debugger attached successfully', { tabId });
        
        // Show notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'hamzanibot.png',
            title: 'HamzaniBot Active',
            message: 'HamzaniBot started debugging this browser.'
        });
        
    } catch (error) {
        logWithDetails('ERROR', 'Failed to attach debugger:', error);
        throw error;
    }
}

// Keep alive function
function startKeepAlive() {
    if (botState.keepAliveInterval) {
        clearInterval(botState.keepAliveInterval);
    }

    botState.keepAliveInterval = setInterval(async () => {
        try {
            // Check if debugger is still attached
            if (botState.debuggerTabId) {
                await chrome.debugger.sendCommand(
                    { tabId: botState.debuggerTabId },
                    'Runtime.evaluate',
                    { expression: '1 + 1' }
                );
            } else {
                await initializeDebugger();
            }

            // Check Reddit auth
            if (!botState.accessToken) {
                await initiateRedditAuth();
            }

            // Update state
            safeMessageSend({
                type: 'STATE_UPDATE',
                state: botState
            });

        } catch (error) {
            logWithDetails('WARN', 'Keep-alive check failed:', error);
            await initializeDebugger();
        }
    }, 5000); // Check every 5 seconds

    logWithDetails('INFO', 'Keep-alive system started');
}

// Check debugger status
async function checkDebuggerStatus() {
    if (!botState.debuggerAttached || !botState.debuggerTabId) {
        logWithDetails('WARN', 'Debugger not attached, attempting to reattach...');
        await initializeDebugger();
        return;
    }
    
    try {
        // Try to send a test command to verify debugger is still attached
        await chrome.debugger.sendCommand(
            { tabId: botState.debuggerTabId },
            'Runtime.evaluate',
            { expression: '1 + 1' }
        );
    } catch (error) {
        logWithDetails('WARN', 'Debugger check failed, reattaching...', error);
        await initializeDebugger();
    }
}

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (botState.debuggerTabId === tabId && changeInfo.status === 'complete') {
        logWithDetails('INFO', 'Debugger tab updated', { tabId, url: tab.url });
    }
});

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    if (botState.debuggerTabId === tabId) {
        logWithDetails('WARN', 'Debugger tab closed, reattaching to new tab...');
        initializeDebugger();
    }
});

// Reddit OAuth flow
async function initiateRedditAuth() {
    if (authInProgress) {
        logWithDetails('INFO', 'Auth already in progress, skipping...');
        return;
    }

    authInProgress = true;
    logWithDetails('INFO', 'Starting Reddit authentication...');
    
    try {
        // Check if we already have a valid token
        const stored = await chrome.storage.local.get(['redditToken']);
        if (stored.redditToken) {
            botState.accessToken = stored.redditToken;
            logWithDetails('INFO', 'Using stored Reddit token');
            authInProgress = false;
            return;
        }

        const state = generateRandomState();
        const authUrl = `https://www.reddit.com/api/v1/authorize?` +
            `client_id=${REDDIT_OAUTH.CLIENT_ID}&` +
            `response_type=code&` +
            `state=${state}&` +
            `redirect_uri=${encodeURIComponent(REDDIT_OAUTH.REDIRECT_URL)}&` +
            `duration=permanent&` +
            `scope=${REDDIT_OAUTH.SCOPES.join(' ')}`;

        logWithDetails('INFO', 'Launching auth flow...');
        const responseUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl,
            interactive: true
        });

        if (!responseUrl) {
            throw new Error('No response URL received from auth flow');
        }

        const url = new URL(responseUrl);
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');

        if (!code) {
            throw new Error('No authorization code received');
        }

        if (returnedState !== state) {
            throw new Error('State mismatch in auth response');
        }

        await exchangeCodeForToken(code);
        logWithDetails('INFO', 'Reddit authentication completed successfully');

    } catch (error) {
        logWithDetails('ERROR', 'Reddit authentication failed:', error);
        authInProgress = false;
        throw error;
    }
}

// Send message to Reddit chat
async function sendMatrixMessage(roomId, message) {
  try {
    const response = await fetch(`${API_ENDPOINTS.REDDIT_CHAT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Authorization': `Bearer ${botState.accessToken}`,
        'Accept': '*/*'
      },
      body: JSON.stringify({
        room_id: roomId,
        message: message,
        message_type: 'm.text'
      })
    });

    if (!response.ok) throw new Error('Failed to send message');
    return await response.json();
  } catch (error) {
    console.error('Send message error:', error);
    throw error;
  }
}

// AI Chat function using Llama API
async function generateAIResponse(message, context) {
    logWithDetails('LLAMA', 'Generating AI response', { message, context });
    
    try {
        const response = await makeAPIRequest(API_ENDPOINTS.LLAMA_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LLAMA_CONFIG.API_TOKEN}`
            },
            body: JSON.stringify({
                model: LLAMA_CONFIG.MODEL,
                messages: [
                    {
                        role: "system",
                        content: `You are ${botState.settings.userInfo}. ${
                            new Date().getHours() < 18 
                                ? botState.settings.settingDayInfo 
                                : botState.settings.settingNightInfo
                        }`
                    },
                    ...context,
                    { role: "user", content: message }
                ],
                stream: false,
                temperature: 0.7,
                max_tokens: 800
            })
        }, 'LLAMA');

        logWithDetails('LLAMA', 'Generated response', { response: response.choices[0].message.content });
        return response.choices[0].message.content;
    } catch (error) {
        logWithDetails('ERROR', 'AI response generation failed:', error);
        throw error;
    }
}

// Initialize everything
initializeDebugger();
initiateRedditAuth();

// Reddit inbox monitoring
async function monitorRedditInbox() {
    try {
        const response = await fetch('https://oauth.reddit.com/message/inbox', {
            headers: {
                'Authorization': `Bearer ${botState.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        processInboxMessages(data.data.children);
    } catch (error) {
        console.error('Inbox monitoring error:', error);
    }

    // Check inbox every minute
    setTimeout(monitorRedditInbox, 60000);
}

// Process inbox messages
async function processInboxMessages(messages) {
    for (const message of messages) {
        if (message.data.new) {
            try {
                // Generate AI response
                const response = await generateAIResponse(message.data.body, []);
                
                // Send response
                await sendRedditMessage(message.data.name, response);
                
                // Mark as read
                await markMessageRead(message.data.name);
                
                // Update stats
                botState.stats.messagesSent++;
                await updateMongoDB('stats', botState.stats);
            } catch (error) {
                console.error('Message processing error:', error);
            }
        }
    }
}

// Send Reddit message
async function sendRedditMessage(fullname, text) {
    try {
        const response = await fetch('https://oauth.reddit.com/api/comment', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${botState.accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                api_type: 'json',
                text: text,
                thing_id: fullname
            })
        });

        return await response.json();
    } catch (error) {
        console.error('Send message error:', error);
        throw error;
    }
}

// Mark message as read
async function markMessageRead(fullname) {
    try {
        await fetch('https://oauth.reddit.com/api/read_message', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${botState.accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                id: fullname
            })
        });
    } catch (error) {
        console.error('Mark read error:', error);
    }
}

// Enhanced logging
function log(type, message, data = null) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        type,
        message,
        data
    };
    
    console.log(`[${logEntry.timestamp}] ${type}: ${message}`, data);
    
    // Store log in MongoDB
    updateMongoDB('logs', logEntry);
}

// Start monitoring after auth
async function startBotOperations() {
    try {
        logWithDetails('INFO', 'Starting bot operations...');
        
        // Start Matrix sync
        await initializeMatrixSync(botState.accessToken);
        
        // Start monitoring for new chats
        startChatMonitoring();
        
        // Start proactive messaging if enabled
        if (botState.settings.massMessageData.isEnabled) {
            startProactiveMessaging();
        }
        
        logWithDetails('INFO', 'Bot operations started successfully');
    } catch (error) {
        logWithDetails('ERROR', 'Failed to start bot operations:', error);
        throw error;
    }
}

// Add this to popup.js to display logs
function addLogToUI(log) {
    const logsContainer = document.getElementById('logsContainer');
    if (!logsContainer) return;

    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${log.level.toLowerCase()}`;
    logEntry.textContent = `[${log.timestamp}] ${log.level}: ${log.message}`;
    
    logsContainer.insertBefore(logEntry, logsContainer.firstChild);
    if (logsContainer.children.length > 100) {
        logsContainer.removeChild(logsContainer.lastChild);
    }
}

// Add this section to popup.html

// Update the message sending function to handle disconnected ports
function safeMessageSend(message) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(message, response => {
                if (chrome.runtime.lastError) {
                    console.log('Expected message send error:', chrome.runtime.lastError.message);
                }
                resolve(response);
            });
        } catch (error) {
            console.log('Safe message send caught error:', error);
            resolve(null);
        }
    });
}

// Add connection status check
chrome.runtime.onConnect.addListener(function(port) {
    messagePort = port;
    port.onDisconnect.addListener(() => {
        messagePort = null;
    });
});

// Add error recovery
chrome.runtime.onSuspend.addListener(function() {
    logWithDetails('INFO', 'Extension being suspended, saving state...');
    chrome.storage.local.set({ botState });
});

chrome.runtime.onStartup.addListener(async function() {
    logWithDetails('INFO', 'Extension starting up, restoring state...');
    const data = await chrome.storage.local.get(['botState']);
    if (data.botState && data.botState.isEnabled) {
        await handleToggleBot();
    }
});

// Add these functions at the top of background.js
let redditChatTab = null;
let messagePort = null;
let authInProgress = false;

// Function to ensure Reddit chat tab exists
async function ensureRedditChatTab() {
    try {
        // Check if we have a stored tab ID
        if (redditChatTab) {
            // Verify the tab still exists
            try {
                const tab = await chrome.tabs.get(redditChatTab.id);
                if (tab && tab.url.includes('chat.reddit.com')) {
                    return tab;
                }
            } catch (e) {
                // Tab doesn't exist anymore
                redditChatTab = null;
            }
        }

        // Find existing Reddit chat tab
        const tabs = await chrome.tabs.query({ url: '*://chat.reddit.com/*' });
        if (tabs.length > 0) {
            redditChatTab = tabs[0];
            return redditChatTab;
        }

        // Create new Reddit chat tab
        redditChatTab = await chrome.tabs.create({
            url: 'https://chat.reddit.com',
            pinned: true, // Pin the tab so it's harder to close accidentally
            active: false // Don't switch to it automatically
        });

        // Wait for tab to load
        return new Promise((resolve) => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === redditChatTab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(redditChatTab);
                }
            });
        });
    } catch (error) {
        logWithDetails('ERROR', 'Failed to ensure Reddit chat tab:', error);
        throw error;
    }
}

// Add tab keep-alive function
function startTabKeepAlive() {
    if (botState.tabKeepAliveInterval) {
        clearInterval(botState.tabKeepAliveInterval);
    }

    botState.tabKeepAliveInterval = setInterval(async () => {
        try {
            await ensureRedditChatTab();
        } catch (error) {
            logWithDetails('WARN', 'Tab keep-alive check failed:', error);
        }
    }, 10000); // Check every 10 seconds
}

// Add tab removal handler
chrome.tabs.onRemoved.addListener((tabId) => {
    if (redditChatTab && tabId === redditChatTab.id) {
        logWithDetails('WARN', 'Reddit chat tab was closed, reopening...');
        redditChatTab = null;
        ensureRedditChatTab();
    }
});

// Add this helper function at the top of your file
function generateRandomState() {
    const array = new Uint32Array(8);
    crypto.getRandomValues(array);
    return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
}

// Add these functions to handle token exchange
async function exchangeCodeForToken(code) {
    try {
        logWithDetails('INFO', 'Exchanging code for token...');
        const tokenUrl = 'https://www.reddit.com/api/v1/access_token';
        const credentials = btoa(`${REDDIT_OAUTH.CLIENT_ID}:${REDDIT_OAUTH.CLIENT_SECRET}`);

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDDIT_OAUTH.REDIRECT_URL
            })
        });

        const data = await response.json();
        if (data.access_token) {
            logWithDetails('INFO', 'Successfully obtained access token');
            botState.accessToken = data.access_token;
            await chrome.storage.local.set({ 
                redditToken: data.access_token,
                botState: botState 
            });
            return data.access_token;
        } else {
            throw new Error('No access token in response');
        }
    } catch (error) {
        logWithDetails('ERROR', 'Token exchange failed:', error);
        throw error;
    }
}
// Add proactive messaging functionality
async function startProactiveMessaging() {
    if (!botState.settings.massMessageData.isEnabled) return;
    
    logWithDetails('INFO', 'Starting proactive messaging...');
    
    setInterval(async () => {
        try {
            // Get list of potential recipients
            const rooms = await fetchRedditChatRooms();
            
            // Filter for rooms we haven't messaged recently
            const eligibleRooms = await filterEligibleRooms(rooms);
            
            for (const room of eligibleRooms) {
                try {
                    // Generate personalized message
                    const message = await generateAIResponse('Start a conversation', []);
                    
                    // Add typing delay
                    await simulateTyping(message.length);
                    
                    // Send message
                    await sendMatrixMessage(room.roomId, message);
                    
                    // Update stats
                    botState.stats.messagesSent++;
                    await updateStats();
                    
                    // Wait between messages
                    await new Promise(r => setTimeout(r, botState.settings.massMessageData.messageDelay * 1000));
                    
                } catch (error) {
                    logWithDetails('ERROR', `Failed to send proactive message to room ${room.roomId}:`, error);
                }
            }
        } catch (error) {
            logWithDetails('ERROR', 'Proactive messaging error:', error);
        }
    }, 60000); // Check every minute
}

// Update chat monitoring
async function startChatMonitoring() {
    logWithDetails('CHAT', 'Starting chat monitoring...');
    
    let lastSyncToken = null;
    
    const monitorLoop = async () => {
        try {
            logWithDetails('CHAT', 'Checking for new messages', { lastSyncToken });
            
            const data = await makeAPIRequest(
                `${API_ENDPOINTS.MATRIX_SYNC}?since=${lastSyncToken || ''}`,
                {
                    headers: {
                        'Authorization': `Bearer ${botState.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                },
                'CHAT'
            );

            lastSyncToken = data.next_batch;
            
            if (data.rooms?.join) {
                for (const [roomId, room] of Object.entries(data.rooms.join)) {
                    if (room.timeline?.events) {
                        for (const event of room.timeline.events) {
                            if (event.type === 'm.room.message' && event.sender !== botState.accountID) {
                                logWithDetails('CHAT', 'Received new message', {
                                    roomId,
                                    sender: event.sender,
                                    message: event.content.body
                                });

                                // Process message
                                await processIncomingMessage(roomId, event);
                            }
                        }
                    }
                }
            }
            
            setTimeout(monitorLoop, 1000);
        } catch (error) {
            logWithDetails('ERROR', 'Chat monitoring error:', error);
            setTimeout(monitorLoop, 5000);
        }
    };
    
    monitorLoop();
}

// Add message processing function
async function processIncomingMessage(roomId, event) {
    try {
        // Update stats
        botState.stats.messagesReceived++;
        updateStats();
        
        logWithDetails('CHAT', 'Processing incoming message', {
            roomId,
            message: event.content.body
        });
        
        // Get conversation context
        const context = await getConversationContext(roomId);
        
        // Generate AI response
        const aiResponse = await generateAIResponse(event.content.body, context);
        
        // Simulate typing
        const typingDelay = calculateTypingDelay(aiResponse);
        logWithDetails('CHAT', `Simulating typing for ${typingDelay}ms`);
        await new Promise(r => setTimeout(r, typingDelay));
        
        // Send response
        await sendMatrixMessage(roomId, aiResponse);
        
        // Update stats
        botState.stats.messagesSent++;
        updateStats();
        
        logWithDetails('CHAT', 'Message processed successfully', {
            roomId,
            response: aiResponse
        });
    } catch (error) {
        logWithDetails('ERROR', 'Failed to process message:', error);
    }
}

// Update initialization
chrome.action.onClicked.addListener(async (tab) => {
    logWithDetails('INFO', 'Extension icon clicked');
    await createPersistentPopup();
});

// Add popup window management
async function createPersistentPopup() {
    logWithDetails('INFO', 'Creating persistent popup');
    
    if (popupWindow) {
        try {
            await chrome.windows.get(popupWindow.id);
            logWithDetails('INFO', 'Popup already exists');
            return;
        } catch (e) {
            logWithDetails('INFO', 'Previous popup window closed');
        }
    }

    const screenWidth = window.screen.availWidth;
    popupWindow = await chrome.windows.create({
        url: 'popup.html',
        type: 'popup',
        width: 400,
        height: window.screen.availHeight,
        left: screenWidth - 400,
        top: 0,
        focused: true
    });

    logWithDetails('INFO', 'Created new popup window', { windowId: popupWindow.id });
}

// Add this to handle mass messaging logs
function logMassMessage(message, recipients) {
    logWithDetails('INFO', `Sending mass message to ${recipients} recipients`);
    
    // Update UI with progress
    safeMessageSend({
        type: 'MASS_MESSAGE_STATUS',
        status: `Sending message to ${recipients} recipients...`
    });
}

// Add this function to handle mass messages
async function handleMassMessage(data, sendResponse) {
    try {
        logMassMessage(data.message, data.recipientCount);
        
        // Get chat rooms
        const rooms = await fetchRedditChatRooms();
        const eligibleRooms = rooms.slice(0, data.recipientCount);
        
        let successCount = 0;
        for (const room of eligibleRooms) {
            try {
                await sendMatrixMessage(room.roomId, data.message);
                successCount++;
                
                // Update progress
                safeMessageSend({
                    type: 'MASS_MESSAGE_STATUS',
                    status: `Sent ${successCount}/${data.recipientCount} messages...`
                });
                
                // Add delay between messages
                await new Promise(r => setTimeout(r, botState.settings.massMessageData.messageDelay * 1000));
            } catch (error) {
                logWithDetails('ERROR', `Failed to send message to room ${room.roomId}:`, error);
            }
        }
        
        logWithDetails('INFO', `Mass message completed. Sent ${successCount}/${data.recipientCount} messages`);
        sendResponse({ success: true, sentCount: successCount });
        
    } catch (error) {
        logWithDetails('ERROR', 'Mass message failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Add these at the top of your background.js
let popupTab = null;

// Function to ensure popup is visible
async function ensurePopupVisible() {
    try {
        // Check if popup exists
        if (popupTab) {
            try {
                await chrome.windows.get(popupTab.windowId);
                return; // Popup exists
            } catch (e) {
                // Popup was closed
                popupTab = null;
            }
        }

        // Create new popup
        const popup = await chrome.windows.create({
            url: 'popup.html',
            type: 'popup',
            width: 400,
            height: 800,
            left: screen.width - 420,
            top: 20,
            focused: true
        });

        // Store reference
        popupTab = popup.tabs[0];

        // Handle popup close
        chrome.windows.onRemoved.addListener((windowId) => {
            if (popupTab && popupTab.windowId === windowId) {
                popupTab = null;
                setTimeout(ensurePopupVisible, 1000); // Reopen if closed
            }
        });
    } catch (error) {
        console.error('Failed to create popup:', error);
    }
}
// Update your initialization
chrome.action.onClicked.addListener(async () => {
    await ensurePopupVisible();
});

// Add this to your existing initialization
chrome.runtime.onInstalled.addListener(async () => {
    await ensurePopupVisible();
});

// Add this to handle startup
chrome.runtime.onStartup.addListener(async () => {
    await ensurePopupVisible();
});


