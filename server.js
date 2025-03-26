const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const swaggerUi = require('swagger-ui-express');
const docs = require('./docs.json');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Debug mode with getter/setter for toggling
let _debugMode = false; // Default to false for production
const DEBUG_MODE = {
    get enabled() {
        return _debugMode;
    },
    set enabled(value) {
        const oldValue = _debugMode;
        _debugMode = !!value; // Convert to boolean
        if (oldValue !== _debugMode) {
            console.log(`[${new Date().toISOString()}] Debug mode ${_debugMode ? 'ENABLED' : 'DISABLED'}`);
        }
    },
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
};

// Global variable to store the current model
let currentModel = 'llama-3.3-70b-versatile'; // Default fallback model

// Check if we're running on Vercel
const isVercelEnv = process.env.VERCEL === '1';

// Function to log messages to file and console
const logMessage = (message, isDebug = false) => {
    if (isDebug && !DEBUG_MODE.enabled) {
        return; // Skip debug messages if debug mode is disabled
    }
    
    const timestamp = new Date().toISOString();
    const prefix = isDebug ? '[DEBUG] ' : '';
    const logEntry = `[${timestamp}] ${prefix}${message}\n`;
    
    // Log to console
    console.log(logEntry.trim());
    
    // Only write to file if not in Vercel environment
    if (!isVercelEnv) {
        try {
            // Create logs directory if it doesn't exist
            const logsDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir);
            }
            
            // Log to file
            const logFile = path.join(logsDir, `${new Date().toISOString().split('T')[0]}.log`);
            fs.appendFileSync(logFile, logEntry);
        } catch (err) {
            console.error(`Failed to write to log file: ${err.message}`);
        }
    }
};

// Function to safely stringify objects for logging
const safeStringify = (obj) => {
    try {
        return JSON.stringify(obj, null, 2);
    } catch (error) {
        return `[Cannot stringify: ${error.message}]`;
    }
};

// Function to fetch the current model from HackClub's homepage
const fetchCurrentModel = async () => {
    try {
        logMessage('Fetching current model from HackClub AI...');
        const response = await fetch('https://ai.hackclub.com');
        
        // Check if response status is OK
        if (!response.ok) {
            logMessage(`Failed to fetch model: Invalid status code ${response.status}`);
            return;
        }
        
        const html = await response.text();

        // Extract model name using regex
        const modelRegex = /Current\s+model:\s*<b[^>]*><code[^>]*>([^<]+)<\/code><\/b>/i;
        const match = html.match(modelRegex);

        if (match && match[1]) {
            currentModel = match[1].trim();
            logMessage(`Current model updated to: ${currentModel}`);
        } else {
            // Be more specific about why it failed to find the model
            logMessage(`Could not extract current model from HackClub AI homepage: Couldn't find the model name pattern in the page. Looking for <b><code>model-name</code></b> format.`);
            
            // Add some debug info to see what we're getting from the homepage
            if (DEBUG_MODE.enabled) {
                const preview = html.substring(0, 500) + (html.length > 500 ? '...' : '');
                logMessage(`HTML Preview: ${preview}`, true);
            }
        }
    } catch (error) {
        logMessage(`Error fetching current model: ${error.message}`);
    }
};

// Helper function to log response details for debugging
const logResponseDetails = async (response, requestId) => {
    const contentType = response.headers.get('content-type') || 'unknown';
    try {
        // Try to get some text for debugging
        const text = await response.text();
        const preview = text.substring(0, 200) + (text.length > 200 ? '...' : '');
        logMessage(`[${requestId}] Response details: Status=${response.status}, ContentType=${contentType}, Body preview: ${preview}`);
        return text;
    } catch (error) {
        logMessage(`[${requestId}] Failed to read response body: ${error.message}`);
        return null;
    }
};

// Generate an OpenAI-compatible ID
const generateOpenAiId = () => {
    // Format: "chatcmpl-" + random alphanumeric string
    return 'chatcmpl-' + Math.random().toString(36).substring(2, 9);
};

// Helper function to sanitize message content (ensures content is always a string)
const sanitizeMessages = (messages) => {
    if (!Array.isArray(messages)) {
        return [];
    }
    
    return messages.map(msg => {
        if (typeof msg !== 'object' || msg === null) {
            return { role: 'user', content: String(msg || '') };
        }
        
        // Ensure role is a string
        const role = typeof msg.role === 'string' ? msg.role : 'user';
        
        // Handle content based on type
        let content = '';
        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (Array.isArray(msg.content)) {
            // For array content (like with images), convert to string
            content = msg.content.map(item => {
                if (typeof item === 'string') {
                    return item;
                } else if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
                    return item.text;
                }
                return '';
            }).join('\n').trim();
        } else if (msg.content && typeof msg.content === 'object') {
            // For object content, try to stringify or extract text
            if (msg.content.type === 'text' && typeof msg.content.text === 'string') {
                content = msg.content.text;
            } else {
                try {
                    content = JSON.stringify(msg.content);
                } catch (e) {
                    content = '';
                }
            }
        }
        
        return { role, content };
    });
};

// Function to get valid content from a response or use a fallback
const getValidMessageContent = (hackclubResponse, requestId) => {
    try {
        // Check if we have a valid response with a message
        if (hackclubResponse && 
            typeof hackclubResponse === 'object' &&
            hackclubResponse.choices && 
            Array.isArray(hackclubResponse.choices) &&
            hackclubResponse.choices.length > 0 && 
            hackclubResponse.choices[0].message &&
            typeof hackclubResponse.choices[0].message === 'object' &&
            typeof hackclubResponse.choices[0].message.content === 'string') {
            
            // Valid message found
            const content = hackclubResponse.choices[0].message.content;
            if (content.trim() !== '') {
                logMessage(`[${requestId}] Found valid message content: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`, true);
                return {
                    role: hackclubResponse.choices[0].message.role || 'assistant',
                    content: content
                };
            }
        }
        
        // If we get here, the response was invalid or incomplete
        logMessage(`[${requestId}] Invalid message structure or empty content, using fallback message`, true);
        logMessage(`[${requestId}] Response was: ${safeStringify(hackclubResponse)}`, true);
        
        // Return a fallback message
        return {
            role: 'assistant',
            content: "I apologize, but I couldn't generate a proper response at this time. Please try again."
        };
    } catch (error) {
        logMessage(`[${requestId}] Error extracting message: ${error.message}`, true);
        return {
            role: 'assistant',
            content: "An error occurred while processing your request. Please try again later."
        };
    }
};

// Function to transform HackClub response to OpenAI response format - SIMPLIFIED to exactly match OpenAI format
const transformToOpenAiFormat = (hackclubResponse, model, requestId) => {
    // Log the input for debugging
    if (DEBUG_MODE.enabled) {
        logMessage(`[${requestId}] HackClub Response to transform: ${safeStringify(hackclubResponse)}`, true);
    }
    
    // Get current timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Get a valid message or fallback
    const messageObj = getValidMessageContent(hackclubResponse, requestId);
    
    // Create a guaranteed-valid OpenAI format response
    const openAiResponse = {
        id: generateOpenAiId(),
        object: "chat.completion",
        created: timestamp,
        model: model || "gpt-3.5-turbo", 
        choices: [
            {
                index: 0,
                message: messageObj,
                finish_reason: "stop",
                logprobs: null
            }
        ],
        usage: {
            prompt_tokens: 10,
            completion_tokens: Math.ceil(messageObj.content.length / 4),
            total_tokens: 10 + Math.ceil(messageObj.content.length / 4)
        }
    };

    // Try to use the HackClub fields if they exist
    if (hackclubResponse && typeof hackclubResponse === 'object') {
        if (hackclubResponse.id) {
            openAiResponse.id = hackclubResponse.id;
        }
        
        if (hackclubResponse.created) {
            openAiResponse.created = hackclubResponse.created;
        }
        
        if (hackclubResponse.choices && 
            hackclubResponse.choices.length > 0) {
            
            const choiceData = hackclubResponse.choices[0];
            
            if (choiceData.finish_reason) {
                openAiResponse.choices[0].finish_reason = choiceData.finish_reason;
            }
            
            if (choiceData.index !== undefined) {
                openAiResponse.choices[0].index = choiceData.index;
            }
        }
        
        if (hackclubResponse.usage) {
            if (hackclubResponse.usage.prompt_tokens !== undefined) {
                openAiResponse.usage.prompt_tokens = hackclubResponse.usage.prompt_tokens;
            }
            
            if (hackclubResponse.usage.completion_tokens !== undefined) {
                openAiResponse.usage.completion_tokens = hackclubResponse.usage.completion_tokens;
            }
            
            if (hackclubResponse.usage.total_tokens !== undefined) {
                openAiResponse.usage.total_tokens = hackclubResponse.usage.total_tokens;
            } else if (hackclubResponse.usage.prompt_tokens !== undefined && 
                       hackclubResponse.usage.completion_tokens !== undefined) {
                openAiResponse.usage.total_tokens = hackclubResponse.usage.prompt_tokens + hackclubResponse.usage.completion_tokens;
            }
        }
    }
    
    // Log the final response for debugging
    if (DEBUG_MODE.enabled) {
        logMessage(`[${requestId}] Final OpenAI response (guaranteed valid): ${safeStringify(openAiResponse)}`, true);
    }
    
    return openAiResponse;
};

// Fetch the model on startup
fetchCurrentModel();

// Skip model refresh interval in Vercel environment as it won't persist across function invocations
// But we'll still get the latest model on each cold start
if (!isVercelEnv) {
    // Schedule periodic model fetching (every 6 hours)
    setInterval(fetchCurrentModel, 6 * 60 * 60 * 1000);
}

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    // Generate a unique request ID
    const requestId = Math.random().toString(36).substring(2, 15);
    req.requestId = requestId;
    
    // Record request start time
    req.requestStartTime = Date.now();
    
    // Get client IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Log the request
    logMessage(`[${requestId}] Request: ${req.method} ${req.url} from IP ${ip}`);
    if (req.method === 'POST' && (req.url === '/chat/completions' || req.url === '/v1/chat/completions')) {
        // For chat completions, log message count but not content for privacy
        const messageCount = req.body.messages ? req.body.messages.length : 0;
        logMessage(`[${requestId}] Chat request with ${messageCount} messages`);
        
        // In debug mode, log the request structure
        if (DEBUG_MODE.enabled) {
            // Redact sensitive content but keep the structure
            const debugBody = JSON.parse(JSON.stringify(req.body));
            if (debugBody.messages) {
                debugBody.messages = debugBody.messages.map(msg => {
                    return {
                        role: msg.role,
                        content: msg.content ? "[REDACTED FOR PRIVACY]" : undefined,
                        // Keep structure but redact content
                        ...(typeof msg.content === 'object' ? { content_type: 'complex-structure' } : {})
                    };
                });
            }
            logMessage(`[${requestId}] Request body structure: ${safeStringify(debugBody)}`, true);
        }
    }
    
    // Capture the original send function
    const originalSend = res.send;
    
    // Override the send function to log the response
    res.send = function(body) {
        // Calculate response time
        const responseTime = Date.now() - req.requestStartTime;
        
        // Log response info
        logMessage(`[${requestId}] Response: ${res.statusCode} (${responseTime}ms)`);
        
        // In debug mode, log response body structure
        if (DEBUG_MODE.enabled && body) {
            try {
                const responseObj = typeof body === 'string' ? JSON.parse(body) : body;
                // Redact actual content but keep structure in the logs
                if (responseObj.choices && responseObj.choices.length > 0 && responseObj.choices[0].message) {
                    const contentLength = responseObj.choices[0].message.content ? responseObj.choices[0].message.content.length : 0;
                    responseObj.choices[0].message.content = `[CONTENT REDACTED - ${contentLength} chars]`;
                }
                logMessage(`[${requestId}] Response body structure: ${safeStringify(responseObj)}`, true);
            } catch (error) {
                logMessage(`[${requestId}] Could not parse response body: ${error.message}`, true);
            }
        }
        
        // Call the original send function
        return originalSend.call(this, body);
    };
    
    next();
});

// Serve documentation
app.use('/', swaggerUi.serve);
app.get('/', swaggerUi.setup(docs));


// OpenAI compatible models endpoint
app.get('/models', (req, res) => {
    // Return a response in OpenAI format
    res.json({
        object: "list",
        data: [
            {
                id: currentModel,
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: "hackclub",
                permission: [],
                root: currentModel,
                parent: null
            }
        ]
    });
});

// Add the v1/models endpoint for OpenAI compatibility 
app.get('/v1/models', (req, res) => {
    // Return a response in OpenAI format
    res.json({
        object: "list",
        data: [
            {
                id: currentModel,
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: "hackclub",
                permission: [],
                root: currentModel,
                parent: null
            }
        ]
    });
});

// Function to stream response in OpenAI-compatible SSE format
const streamResponse = (content, req, res) => {
    // Set headers for SSE (Server-Sent Events)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Create a unique ID for this streaming session
    const responseId = generateOpenAiId();
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Break the content into small chunks (3-8 words per chunk)
    const words = content.split(' ');
    const chunks = [];
    let currentChunk = [];
    
    for (const word of words) {
        currentChunk.push(word);
        // Randomly decide if we should end this chunk (between 3-8 words)
        if (currentChunk.length >= 3 && (currentChunk.length >= 8 || Math.random() < 0.3)) {
            chunks.push(currentChunk.join(' '));
            currentChunk = [];
        }
    }
    
    // Add any remaining words as the final chunk
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
    }
    
    // Stream each chunk with a small delay
    let index = 0;
    const streamChunk = () => {
        if (index < chunks.length) {
            // Format the chunk as an OpenAI-compatible SSE event
            const chunk = chunks[index];
            const chunkObj = {
                id: `${responseId}-${index}`,
                object: "chat.completion.chunk",
                created: timestamp,
                model: currentModel,
                choices: [{
                    index: 0,
                    delta: {
                        content: index === 0 ? chunk : ' ' + chunk
                    },
                    finish_reason: null
                }]
            };
            
            // Send the chunk as an SSE event
            res.write(`data: ${JSON.stringify(chunkObj)}\n\n`);
            
            // Schedule the next chunk
            index++;
            setTimeout(streamChunk, 10); // Super fast streaming with 10ms delay
        } else {
            // Send the final chunk with finish_reason
            const finalChunkObj = {
                id: `${responseId}-${index}`,
                object: "chat.completion.chunk",
                created: timestamp,
                model: currentModel,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "stop"
                }]
            };
            
            res.write(`data: ${JSON.stringify(finalChunkObj)}\n\n`);
            
            // End the stream with [DONE]
            res.write('data: [DONE]\n\n');
            res.end();
        }
    };
    
    // Start streaming
    streamChunk();
};

// Main proxy endpoint
app.post('/chat/completions', async (req, res) => {
    try {
        // Check if streaming is requested
        const isStreaming = req.body.stream === true;
        
        logMessage(`[${req.requestId}] Request ${isStreaming ? 'with streaming' : 'without streaming'}`);
        
        // Handle the special case where the client is expecting a response but no actual messages are passed
        if (!req.body.messages || req.body.messages.length === 0) {
            if (isStreaming) {
                // Stream a stub message
                return streamResponse("Hello! How can I assist you today?", req, res);
            } else {
                const stubResponse = {
                    id: generateOpenAiId(),
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model: currentModel,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: "Hello! How can I assist you today?"
                            },
                            finish_reason: "stop",
                            logprobs: null
                        }
                    ],
                    usage: {
                        prompt_tokens: 0,
                        completion_tokens: 8,
                        total_tokens: 8
                    }
                };
                logMessage(`[${req.requestId}] No messages found in request, responding with stub message`, true);
                return res.json(stubResponse);
            }
        }
        
        // Sanitize messages to ensure content is always a string
        const sanitizedMessages = sanitizeMessages(req.body.messages || []);
        
        if (DEBUG_MODE.enabled) {
            logMessage(`[${req.requestId}] Sanitized messages structure: ${safeStringify(
                sanitizedMessages.map(m => ({ role: m.role, content_length: m.content ? m.content.length : 0 }))
            )}`, true);
        }
        
        // Forward the request to HackClub API with sanitized messages
        const requestBody = {
            messages: sanitizedMessages
        };

        // handle additional parameters that HackClub API might support
        if (req.body.temperature !== undefined) {
            requestBody.temperature = req.body.temperature;
        }
        
        if (req.body.max_tokens !== undefined) {
            requestBody.max_tokens = req.body.max_tokens;
        }

        // Log the outgoing request body structure (not content for privacy)
        logMessage(`[${req.requestId}] Forwarding request to HackClub API with ${sanitizedMessages.length} sanitized messages`);

        // forward the request to HackClub API
        const response = await fetch('https://ai.hackclub.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });
        
        // Check if the response is OK
        if (!response.ok) {
            const errorText = await logResponseDetails(response, req.requestId);
            logMessage(`[${req.requestId}] Error from HackClub API: ${response.status} ${errorText || 'No response body'}`, true);
            
            // Still return a valid response to the client, but with an error message
            const fallbackResponse = {
                id: generateOpenAiId(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: currentModel,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: `I'm sorry, there was an error processing your request. The HackClub API returned status code ${response.status}.`
                        },
                        finish_reason: "stop",
                        logprobs: null
                    }
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 20,
                    total_tokens: 20
                }
            };
            return res.json(fallbackResponse);
        }

        // Clone the response for text extraction and JSON parsing
        const responseClone = response.clone();
        
        // Try to parse as JSON
        let data;
        try {
            const responseText = await response.text();
            if (DEBUG_MODE.enabled) {
                logMessage(`[${req.requestId}] Raw HackClub API response: ${responseText}`, true);
            }
            data = JSON.parse(responseText);
        } catch (err) {
            // If JSON parsing fails, log the raw response for debugging
            const responseText = await logResponseDetails(responseClone, req.requestId);
            logMessage(`[${req.requestId}] JSON parsing error: ${err.message}. Response was: ${responseText || 'Unable to read response'}`, true);
            
            // Still return a valid response to the client, but with an error message
            const fallbackResponse = {
                id: generateOpenAiId(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: currentModel,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: "I'm sorry, there was an error processing your request. The response from HackClub could not be parsed as valid JSON."
                        },
                        finish_reason: "stop",
                        logprobs: null
                    }
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 25,
                    total_tokens: 25
                }
            };
            return res.json(fallbackResponse);
        }

        // Check if streaming was requested
        if (isStreaming) {
            // For streaming, extract the content and stream it
            const messageContent = getValidMessageContent(data, req.requestId).content;
            return streamResponse(messageContent, req, res);
        } else {
            // Transform to OpenAI format (guaranteed valid)
            const openAiResponse = transformToOpenAiFormat(data, currentModel, req.requestId);
            res.json(openAiResponse);
        }
    } catch (error) {
        // Get client IP
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        // Log the error with request details
        logMessage(`[${req.requestId}] ERROR: ${error.message} from IP ${ip}`);
        logMessage(`[${req.requestId}] Error stack: ${error.stack}`);
        
        // Always return a valid response structure even if there's an error
        res.json({
            id: generateOpenAiId(),
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: currentModel,
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: "I apologize, but an error occurred while processing your request. Please try again later."
                    },
                    finish_reason: "stop",
                    logprobs: null
                }
            ],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 17,
                total_tokens: 17
            }
        });
    }
});

// Compatibility with v1/chat/completions endpoint (for other clients)
app.post('/v1/chat/completions', async (req, res) => {
    try {
        // Check if streaming is requested
        const isStreaming = req.body.stream === true;
        
        logMessage(`[${req.requestId}] V1 Request ${isStreaming ? 'with streaming' : 'without streaming'}`);
        
        // Handle the special case where the client is expecting a response but no actual messages are passed
        if (!req.body.messages || req.body.messages.length === 0) {
            if (isStreaming) {
                // Stream a stub message
                return streamResponse("Hello! How can I assist you today?", req, res);
            } else {
                const stubResponse = {
                    id: generateOpenAiId(),
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model: currentModel,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: "Hello! How can I assist you today?"
                            },
                            finish_reason: "stop",
                            logprobs: null
                        }
                    ],
                    usage: {
                        prompt_tokens: 0,
                        completion_tokens: 8,
                        total_tokens: 8
                    }
                };
                logMessage(`[${req.requestId}] No messages found in request, responding with stub message`, true);
                return res.json(stubResponse);
            }
        }
        
        // Sanitize messages to ensure content is always a string
        const sanitizedMessages = sanitizeMessages(req.body.messages || []);
        
        if (DEBUG_MODE.enabled) {
            logMessage(`[${req.requestId}] Sanitized messages structure: ${safeStringify(
                sanitizedMessages.map(m => ({ role: m.role, content_length: m.content ? m.content.length : 0 }))
            )}`, true);
        }
        
        // Forward the request to HackClub API with sanitized messages
        const requestBody = {
            messages: sanitizedMessages
        };

        // handle additional parameters that HackClub API might support
        if (req.body.temperature !== undefined) {
            requestBody.temperature = req.body.temperature;
        }
        
        if (req.body.max_tokens !== undefined) {
            requestBody.max_tokens = req.body.max_tokens;
        }

        // Log the outgoing request body structure (not content for privacy)
        logMessage(`[${req.requestId}] Forwarding request to HackClub API via v1 endpoint with ${sanitizedMessages.length} sanitized messages`);

        // forward the request to HackClub API
        const response = await fetch('https://ai.hackclub.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        // Check if the response is OK
        if (!response.ok) {
            const errorText = await logResponseDetails(response, req.requestId);
            logMessage(`[${req.requestId}] Error from HackClub API: ${response.status} ${errorText || 'No response body'}`, true);
            
            // Still return a valid response to the client, but with an error message
            const fallbackResponse = {
                id: generateOpenAiId(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: currentModel,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: `I'm sorry, there was an error processing your request. The HackClub API returned status code ${response.status}.`
                        },
                        finish_reason: "stop",
                        logprobs: null
                    }
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 20,
                    total_tokens: 20
                }
            };
            return res.json(fallbackResponse);
        }

        // Clone the response for text extraction and JSON parsing
        const responseClone = response.clone();
        
        // Try to parse as JSON
        let data;
        try {
            const responseText = await response.text();
            if (DEBUG_MODE.enabled) {
                logMessage(`[${req.requestId}] Raw HackClub API response: ${responseText}`, true);
            }
            data = JSON.parse(responseText);
        } catch (err) {
            // If JSON parsing fails, log the raw response for debugging
            const responseText = await logResponseDetails(responseClone, req.requestId);
            logMessage(`[${req.requestId}] JSON parsing error: ${err.message}. Response was: ${responseText || 'Unable to read response'}`, true);
            
            // Still return a valid response to the client, but with an error message
            const fallbackResponse = {
                id: generateOpenAiId(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: currentModel,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: "I'm sorry, there was an error processing your request. The response from HackClub could not be parsed as valid JSON."
                        },
                        finish_reason: "stop",
                        logprobs: null
                    }
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 25,
                    total_tokens: 25
                }
            };
            return res.json(fallbackResponse);
        }

        // Check if streaming was requested
        if (isStreaming) {
            // For streaming, extract the content and stream it
            const messageContent = getValidMessageContent(data, req.requestId).content;
            return streamResponse(messageContent, req, res);
        } else {
            // Transform to OpenAI format (guaranteed valid)
            const openAiResponse = transformToOpenAiFormat(data, currentModel, req.requestId);
            res.json(openAiResponse);
        }
    } catch (error) {
        // Get client IP
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        // Log the error with request details
        logMessage(`[${req.requestId}] ERROR in v1 endpoint: ${error.message} from IP ${ip}`);
        logMessage(`[${req.requestId}] Error stack: ${error.stack}`);
        
        // Always return a valid response structure even if there's an error
        res.json({
            id: generateOpenAiId(),
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: currentModel,
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: "I apologize, but an error occurred while processing your request. Please try again later."
                    },
                    finish_reason: "stop",
                    logprobs: null
                }
            ],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 17,
                total_tokens: 17
            }
        });
    }
});

// Add a test endpoint that returns a guaranteed valid OpenAI format response
app.get('/test-response', (req, res) => {
    const testResponse = {
        id: generateOpenAiId(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: currentModel,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: "This is a test response in standard OpenAI format. Your client should be able to parse and display this message properly."
                },
                finish_reason: "stop",
                logprobs: null
            }
        ],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 25,
            total_tokens: 25
        }
    };
    
    res.json(testResponse);
});

// Error handler middleware
app.use((err, req, res, next) => {
    // Get client IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Log the error
    logMessage(`[${req.requestId || 'UNKNOWN'}] Unhandled error: ${err.message} from IP ${ip}`);
    logMessage(`[${req.requestId || 'UNKNOWN'}] Error stack: ${err.stack}`);
    
    // Send error response
    res.status(500).json({
        error: {
            message: 'Server error: ' + err.message,
            type: 'internal_server_error'
        }
    });
});

// Handle invalid routes
app.use((req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logMessage(`[${req.requestId}] 404 Not Found: ${req.method} ${req.url} from IP ${ip}`);
    
    res.status(404).json({
        error: {
            message: 'Not found',
            type: 'invalid_request_error'
        }
    });
});

// Start the server
app.listen(port, () => {
    logMessage(`Server running on port ${port}`);
    logMessage(`Current model: ${currentModel}`);
    logMessage(`Debug mode: ${DEBUG_MODE.enabled ? 'ENABLED' : 'DISABLED'}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logMessage(`UNCAUGHT EXCEPTION: ${err.message}`);
    logMessage(`Stack: ${err.stack}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logMessage(`UNHANDLED REJECTION: ${reason}`);
});
