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

// Enhanced logging system
function logWithDetails(level, message, details = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${level}: ${message}`;
  
  console.log(logMessage, details);
  
  // Send log to popup
  chrome.runtime.sendMessage({
    type: 'LOG_UPDATE',
    log: { level, message, timestamp, details }
  });

  // Update status in popup
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    state: {
      status: message,
      isEnabled: botState.isEnabled
    }
  });
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
        botState.isEnabled = !botState.isEnabled;
        logWithDetails('INFO', `Bot ${botState.isEnabled ? 'starting' : 'stopping'}...`);

        if (botState.isEnabled) {
            // Initialize debugger if not already attached
            if (!botState.debuggerAttached) {
                await initializeDebugger();
            }

            // Start other operations
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
        }

        // Save state and update UI
        await chrome.storage.local.set({ botState });
        sendResponse({ success: true, state: botState });

    } catch (error) {
        logWithDetails('ERROR', 'Toggle failed:', error);
        botState.isEnabled = false;
        sendResponse({ success: false, error: error.message });
    }
}

// Handle Reddit token save
async function handleSaveToken(token, sendResponse) {
  try {
    botState.accessToken = token;
    logWithDetails('INFO', 'Reddit token saved successfully');
    await chrome.storage.local.set({ botState });
    sendResponse({ success: true });
  } catch (error) {
    logWithDetails('ERROR', 'Failed to save Reddit token:', error);
    sendResponse({ success: false, error: error.message });
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
        // First get active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        
        if (!currentTab) {
            // If no active tab, create one
            const newTab = await chrome.tabs.create({ url: 'https://chat.reddit.com' });
            await attachDebugger(newTab.id);
        } else {
            await attachDebugger(currentTab.id);
        }
        
        // Keep extension alive
        startKeepAlive();
        
    } catch (error) {
        logWithDetails('ERROR', 'Debugger initialization failed:', error);
        // Retry after delay
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
    // Clear existing interval if any
    if (botState.keepAliveInterval) {
        clearInterval(botState.keepAliveInterval);
    }
    
    // Set new keep-alive interval
    botState.keepAliveInterval = setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {
            if (chrome.runtime.lastError) {
                logWithDetails('WARN', 'Keep-alive ping failed:', chrome.runtime.lastError);
            }
        });
        
        // Check debugger status and reattach if needed
        checkDebuggerStatus();
    }, 20000);
    
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
    logWithDetails('INFO', 'Starting Reddit authentication...');
    
    const state = generateRandomState();
    const authUrl = `https://www.reddit.com/api/v1/authorize?` +
        `client_id=${REDDIT_OAUTH.CLIENT_ID}&` +
        `response_type=code&` +
        `state=${state}&` +
        `redirect_uri=${encodeURIComponent(REDDIT_OAUTH.REDIRECT_URL)}&` +
        `duration=permanent&` +
        `scope=${REDDIT_OAUTH.SCOPES.join(' ')}`;

    try {
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
  try {
    const response = await fetch(API_ENDPOINTS.LLAMA_API, {
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
    });

    if (!response.ok) throw new Error('AI response generation failed');
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('AI response error:', error);
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
    log('INFO', 'Starting bot operations');
    
    try {
        await initializeMatrixSync(botState.accessToken);
        monitorRedditInbox();
        
        log('INFO', 'Bot operations started successfully');
    } catch (error) {
        log('ERROR', 'Failed to start bot operations', error);
        setTimeout(startBotOperations, 5000);
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
