 import { DEFAULT_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT, SEARCH_RESULTS_PROMPT, getDefaultSystemPrompt } from './system-prompts.js';

// --- Markdown Rendering ---
function renderMarkdown(element, text) {
    if (typeof marked === 'undefined' || typeof hljs === 'undefined') {
        console.warn("Markdown libraries not loaded yet, using plain text");
        element.textContent = text;
        return;
    }

    try {
        // Configure marked with highlight.js
        marked.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
                    } catch (err) {
                        console.error('Failed to highlight code:', err);
                    }
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true,
            gfm: true
        });

        // Parse markdown to HTML
        const html = marked.parse(text);
        element.innerHTML = html;

        // Add copy buttons to code blocks
        element.querySelectorAll('pre > code').forEach(codeBlock => {
            const pre = codeBlock.parentNode;
            if (!pre.querySelector('.copy-code-button')) {
                const button = document.createElement('button');
                button.className = 'copy-code-button';
                button.textContent = 'Copy';
                button.onclick = async () => {
                    try {
                        await navigator.clipboard.writeText(codeBlock.textContent);
                        button.textContent = 'Copied!';
                        button.classList.add('copied');
                        setTimeout(() => {
                            button.textContent = 'Copy';
                            button.classList.remove('copied');
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to copy:', err);
                        button.textContent = 'Error';
                    }
                };
                pre.appendChild(button);
            }
        });

        // Format citations
        // Replace citations with interactive elements
        element.innerHTML = element.innerHTML.replace(
            /\[(\d+)\]/g,
            (match, index) => {
                // Create citation element
                const citation = document.createElement('span');
                citation.className = 'citation';
                citation.textContent = match;
                citation.dataset.index = index;

                // Add tooltip
                const tooltip = document.createElement('div');
                tooltip.className = 'citation-tooltip';
                citation.appendChild(tooltip);

                return citation.outerHTML;
            }
        );

        // Add click handlers to citations
        element.querySelectorAll('.citation').forEach(citation => {
            const index = citation.dataset.index;
            citation.addEventListener('click', (e) => {
                e.preventDefault();
                const searchResult = searchResults?.results[parseInt(index) - 1];
                if (searchResult?.url) {
                    window.open(searchResult.url, '_blank', 'noopener,noreferrer');
                }
            });
        });

    } catch (error) {
        console.error('Failed to render markdown:', error);
        element.textContent = text;
    }
}


// DOM Elements
// DOM Elements
const modelSelector = document.getElementById('model-selector');
const messageList = document.getElementById('message-list');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const settingsButton = document.getElementById('settings-button');
const historyButton = document.getElementById('history-button');
const settingsPanel = document.getElementById('settings-panel');
const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');
const clearHistoryButton = document.getElementById('clear-history-button');
const temperatureInput = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperature-value');
const apiKeyInput = document.getElementById('api-key');
const themeButtons = document.querySelectorAll('.theme-button');
const searchStatus = document.getElementById('search-status');
const searchStatusText = document.getElementById('search-status-text');
// State
let currentChatId = null;
let chatHistory = {}; // { chatId: { id: string, title: string, messages: [], timestamp: number } }
let isProcessingMessage = false;
const MAX_CONTEXT_LENGTH = 4000; // characters, adjust based on testing

// Settings
let settings = {
    temperature: 0.6,
    apiKey: '',
    theme: 'dark',
    enableSearch: true // Default to true for AI search capabilities
};

// --- Model Loading ---
async function loadModels() {
    try {
        const response = await fetch('/v1/models');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        modelSelector.innerHTML = '<option value="">Select a model</option>';

        if (data.data && data.data.length > 0) {
            // Get all operational models
            const healthyModels = data.data.filter(model =>
                model.health?.status === 'operational'
            );

            healthyModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.id;
                modelSelector.appendChild(option);
            });
        } else {
            modelSelector.innerHTML = '<option value="">No models available</option>';
        }
    } catch (error) {
        console.error('Failed to load models:', error);
        modelSelector.innerHTML = '<option value="">Error loading models</option>';
        addMessage('system', `Error loading models: ${error.message}`);
    }
}

// --- UI Helpers ---
function addMessage(role, content, chatIdToSave = currentChatId) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', role);

    // Create content element
    const contentElement = document.createElement('div');
    contentElement.classList.add('message-content');
    
    // Clean the content by removing any [google](...) syntax and extracting references
    let cleanedContent = content;
    const searchMatch = content.match(/\[google\]\((.*?)\)/);
    if (searchMatch) {
        cleanedContent = content.replace(/\[google\]\((.*?)\)/, '$1');
    }
    
    // Create message actions (edit button, etc.)
    if (role === 'user' || role === 'assistant') {
        const actionsElement = document.createElement('div');
        actionsElement.classList.add('message-actions');
        
        const editButton = document.createElement('button');
        editButton.classList.add('message-action-btn');
        editButton.innerHTML = '✏️';
        editButton.title = 'Edit message';
        editButton.addEventListener('click', () => editMessage(messageElement, cleanedContent, role, chatIdToSave));
        
        actionsElement.appendChild(editButton);
        messageElement.appendChild(actionsElement);
    }
    
    renderMarkdown(contentElement, cleanedContent);
    messageElement.appendChild(contentElement);
    
    // Create references container for citations if this is an assistant message
    if (role === 'assistant') {
        const referencesMatch = cleanedContent.match(/\[(\d+)\]/g);
        if (referencesMatch && referencesMatch.length > 0) {
            const referencesElement = document.createElement('div');
            referencesElement.classList.add('message-references', 'has-references');
            
            const referenceTitleElement = document.createElement('div');
            referenceTitleElement.classList.add('reference-title');
            referenceTitleElement.textContent = `References (${referencesMatch.length})`;
            referenceTitleElement.addEventListener('click', () => {
                referenceTitleElement.classList.toggle('collapsed');
                referencesListElement.classList.toggle('collapsed');
            });
            
            const referencesListElement = document.createElement('div');
            referencesListElement.classList.add('references-list');
            
            // We'll populate this with actual references when we have them
            // For now, create placeholder references
            const uniqueRefs = [...new Set(referencesMatch.map(ref => ref.replace(/[\[\]]/g, '')))];
            uniqueRefs.forEach(refNumber => {
                const refItem = document.createElement('div');
                refItem.classList.add('reference-item');
                refItem.dataset.refNumber = refNumber;
                refItem.innerHTML = `<strong>[${refNumber}]</strong> <span>Loading reference...</span>`;
                referencesListElement.appendChild(refItem);
            });
            
            referencesElement.appendChild(referenceTitleElement);
            referencesElement.appendChild(referencesListElement);
            messageElement.appendChild(referencesElement);
        }
    }

    messageList.appendChild(messageElement);
    scrollToBottom();

    if ((role === 'user' || role === 'assistant') && chatIdToSave) {
        saveMessageToHistory(chatIdToSave, { role, content: cleanedContent });
    }
    
    // Return the element so we can reference it later
    return messageElement;
}

// Function to handle message editing
function editMessage(messageElement, content, role, chatId) {
    // Create an editable area
    const editArea = document.createElement('textarea');
    editArea.value = content;
    editArea.classList.add('message-edit-area');
    
    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.classList.add('chat-button', 'primary', 'small');
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.classList.add('chat-button', 'small');
    
    // Button container
    const btnContainer = document.createElement('div');
    btnContainer.classList.add('edit-buttons');
    btnContainer.appendChild(saveBtn);
    btnContainer.appendChild(cancelBtn);
    
    // Replace content with edit area
    const contentElement = messageElement.querySelector('.message-content');
    const originalContent = contentElement.innerHTML;
    contentElement.innerHTML = '';
    contentElement.appendChild(editArea);
    contentElement.appendChild(btnContainer);
    
    // Set focus and select all text
    editArea.focus();
    editArea.select();
    
    // Event handlers
    saveBtn.addEventListener('click', async () => {
        const newContent = editArea.value.trim();
        if (newContent === content || !newContent) {
            // No changes or empty content, just restore
            contentElement.innerHTML = originalContent;
            return;
        }
        
        // Update content in UI
        renderMarkdown(contentElement, newContent);
        
        // Update in chat history
        if (chatId && chatHistory[chatId]) {
            const messages = chatHistory[chatId].messages;
            // Find the message being edited
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === role && messages[i].content === content) {
                    messages[i].content = newContent;
                    break;
                }
            }
            saveChatHistory();
            
            // If editing an assistant message or a user message before the latest assistant message,
            // we need to regenerate the conversation from this point
            const editedIndex = messages.findIndex(msg => msg.role === role && msg.content === newContent);
            if (role === 'assistant' || (editedIndex < messages.length - 1)) {
                // Show regenerating message
                addMessage('system', 'Regenerating response based on edited message...');
                
                // Wait a moment to show the message
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // If it's a user message, get the next assistant message to regenerate
                if (role === 'user' && editedIndex < messages.length - 1 && messages[editedIndex + 1].role === 'assistant') {
                    // Remove the assistant message that follows
                    messages.splice(editedIndex + 1);
                    saveChatHistory();
                    
                    // Regenerate the response
                    await processMessage(newContent, modelSelector.value);
                }
            }
        }
    });
    
    cancelBtn.addEventListener('click', () => {
        // Restore original content
        contentElement.innerHTML = originalContent;
    });
}

function scrollToBottom() {
    messageList.scrollTop = messageList.scrollHeight;
}

// --- Event Listeners ---
settingsButton.addEventListener('click', () => toggleSidebar(settingsPanel));
historyButton.addEventListener('click', () => {
    loadChatHistoryList();
    toggleSidebar(historyPanel);
});

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Input auto-resize is handled in initializeChat()

// --- Chat Logic ---
async function sendMessage() {
    const messageText = messageInput.value.trim();
    const selectedModel = modelSelector.value;

    if (!messageText || isProcessingMessage) return;
    if (!selectedModel) {
        addMessage('system', 'Please select a model first.');
        return;
    }

    addMessage('user', messageText);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    
    if (!currentChatId) {
        currentChatId = createNewChatHistory(messageText);
    }

    await processMessage(messageText, selectedModel);
}
async function processMessage(messageText, selectedModel) {
    isProcessingMessage = true;
    sendButton.disabled = true;
    sendButton.innerHTML = 'Thinking... <div class="loading-indicator"></div>';

    try {
        // Process the message text to remove any [google](...) syntax
        // before adding to chat history to avoid duplicate searches
        const cleanedMessageText = messageText.replace(/\[google\]\((.*?)\)/g, '$1');
        
        const messages = getMessagesForApi(currentChatId);
        const contextLength = JSON.stringify(messages).length;

        // Check if we need to summarize
        if (contextLength > MAX_CONTEXT_LENGTH) {
            await summarizeChat();
        }

        // Final messages array with system prompt and proper message structure
        const messagesPayload = getMessagesForApi(currentChatId);
        // Ensure we have a system message at the start with correct search setting
        if (!messagesPayload.length || messagesPayload[0].role !== 'system') {
            messagesPayload.unshift({
                role: 'system',
                content: getDefaultSystemPrompt({ enableSearch: settings.enableSearch })
            });
        }
        
        // Remove any empty messages and unsupported properties
        const cleanedMessages = messagesPayload.filter(msg =>
            msg.content?.trim() && // Remove empty messages
            !('partial' in msg)    // Remove partial property
        ).map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        // Implement retry mechanism for API requests
        let attempts = 0;
        let maxRetries = 2;
        let response;
        
        while (attempts <= maxRetries) {
            try {
                response = await fetch('/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': settings.apiKey ? `Bearer ${settings.apiKey}` : undefined
                    },
                    body: JSON.stringify({
                        model: selectedModel,
                        messages: cleanedMessages,
                        stream: true,
                        temperature: settings.temperature
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error?.message || `API Error (${response.status})`);
                }
                
                break; // Success, exit retry loop
            } catch (error) {
                attempts++;
                if (attempts > maxRetries) {
                    throw error; // Re-throw if we've exhausted retries
                }
                
                // Add a visual indicator of retry
                addMessage('system', `Request failed. Retrying in 10 seconds... (${attempts}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before retry
            }
        }

        await handleStreamingResponse(response);

    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('error', `Failed to get response: ${error.message}`);
    } finally {
        isProcessingMessage = false;
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
    }
}
async function handleStreamingResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMessageContent = '';
    let assistantMessageElement = null;
    let buffer = '';
    let searchResults = null;
    
    // Check for search command patterns in real-time
    const searchPatterns = {
        google: /\[google\]\((.*?)\)/,
        wikipedia: /\[wikipedia\]\((.*?)\)/
    };
    let searchDetected = false;
    let searchQuery = null;
    let searchType = null;
    
    // Function to update citations with search result data
    // Function to update citations with search result data
    const updateCitations = () => {
        if (!assistantMessageElement || !searchResults) return;
        
        assistantMessageElement.querySelectorAll('.citation').forEach(citation => {
            const index = parseInt(citation.dataset.index);
            const result = searchResults.results[index - 1];
            if (!result) return;
            
            // Create or update tooltip
            let tooltip = citation.querySelector('.citation-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'citation-tooltip';
                citation.appendChild(tooltip);
            }
            
            // Update tooltip content
            tooltip.innerHTML = `
                <div class="citation-title">${result.title || 'No title available'}</div>
                ${result.snippet ? `<div class="citation-snippet">${result.snippet}</div>` : ''}
                ${result.url ? `<div class="citation-url">${result.url}</div>` : ''}
            `;
            
            // Add click handler to open URL
            if (result.url) {
                citation.style.cursor = 'pointer';
                citation.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.open(result.url, '_blank', 'noopener,noreferrer');
                });
            }
        });
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const dataString = line.substring(6).trim();
                if (dataString === '[DONE]') {
                    // Check if we need to handle search
                    if (assistantMessageElement && searchDetected && searchQuery) {
                        await pauseAndSearch(searchQuery, assistantMessageElement, assistantMessageContent);
                        return;
                    }

                    // Normal message completion
                    if (assistantMessageElement) {
                        // Save the message
                        saveMessageToHistory(currentChatId, {
                            role: 'assistant',
                            content: assistantMessageContent,
                            hasSearch: false
                        });
                        
                        // Update UI
                        const contentDiv = assistantMessageElement.querySelector('.message-content');
                        renderMarkdown(contentDiv, assistantMessageContent);
                        updateCitations();
                    }
                    return;
                }

                try {
                    const chunk = JSON.parse(dataString);
                    const deltaContent = chunk.choices?.[0]?.delta?.content;

                    if (deltaContent) {
                        assistantMessageContent += deltaContent;

                        // Check if we need to create a new message element
                        if (!assistantMessageElement) {
                            assistantMessageElement = addMessage('assistant', '', currentChatId);
                        }
                        
                        // Check for search command patterns in real-time
                        if (!searchDetected && settings.enableSearch) {
                            let match;
                            for (const [type, pattern] of Object.entries(searchPatterns)) {
                                match = pattern.exec(assistantMessageContent);
                                if (match) {
                                    searchDetected = true;
                                    searchType = type;
                                    searchQuery = match[1];
                                    updateSearchStatus(`Detected ${type} search request: "${searchQuery}"`, true);
                                    
                                    // Stop the current stream to handle search
                                    reader.cancel();
                                    if (type === 'wikipedia') {
                                        await handleWikipediaSearch(searchQuery, assistantMessageElement, assistantMessageContent);
                                    } else {
                                        await pauseAndSearch(searchQuery, assistantMessageElement, assistantMessageContent);
                                    }
                                    return;
                                }
                            }
                        }

                        // Update the content - use textContent for streaming for performance
                        assistantMessageElement.querySelector('.message-content').textContent = assistantMessageContent;
                        scrollToBottom();
                    }
                } catch (e) {
                    console.error('Error parsing stream chunk:', e);
                }
            }
        }
    }

    if (assistantMessageElement) {
        // If we detected a search command, handle it
        if (searchDetected && searchQuery) {
            // Pause here and do the search
            await pauseAndSearch(searchQuery, assistantMessageElement, assistantMessageContent);
        } else {
            saveMessageToHistory(currentChatId, {
                role: 'assistant',
                content: assistantMessageContent
            });
            
            // Update the message with proper markdown rendering
            const contentDiv = assistantMessageElement.querySelector('.message-content');
            renderMarkdown(contentDiv, assistantMessageContent);
            
            // Handle reference linking
            updateReferences(assistantMessageElement, assistantMessageContent, searchResults);
        }
    }
}

function updateSearchStatus(message, isVisible = true) {
    searchStatusText.textContent = message;
    searchStatus.style.display = isVisible ? 'block' : 'none';
}

// Update references in an assistant message
// Update references section with search results
function updateReferences(messageElement, content, searchResults) {
    if (!searchResults?.results?.length) return;
    
    // Find or create references container
    let referencesElement = messageElement.querySelector('.message-references');
    if (!referencesElement) {
        referencesElement = document.createElement('div');
        referencesElement.className = 'message-references has-references';
        messageElement.appendChild(referencesElement);
    }
    
    // Create or update references content
    referencesElement.innerHTML = `
        <div class="reference-title">
            Search Results (${searchResults.results.length})
            <span class="reference-query">${searchResults.query}</span>
        </div>
        <div class="references-list">
            ${searchResults.results.map(result => `
                <div class="reference-item" data-index="${result.index}">
                    <strong>[${result.index}]</strong>
                    ${result.url
                        ? `<a href="${result.url}" target="_blank" rel="noopener noreferrer">${result.title || 'No title'}</a>`
                        : `<span>${result.title || 'No title'}</span>`
                    }
                    ${result.snippet ? `<div class="reference-snippet">${result.snippet}</div>` : ''}
                    ${result.content ? `<div class="reference-content">${result.content.substring(0, 300)}...</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
    
    // Add click handler to toggle references
    const titleElement = referencesElement.querySelector('.reference-title');
    const listElement = referencesElement.querySelector('.references-list');
    
    titleElement.addEventListener('click', () => {
        titleElement.classList.toggle('collapsed');
        listElement.classList.toggle('collapsed');
    });
}

// Handle Wikipedia search
async function handleWikipediaSearch(query, messageElement, currentContent) {
    try {
        updateSearchStatus(`Searching Wikipedia for: "${query}"...`, true);
        
        // Save partial response without the search command
        const cleanedContent = currentContent.replace(/\[wikipedia\]\((.*?)\)/, '$1');
        saveMessageToHistory(currentChatId, {
            role: 'assistant',
            content: cleanedContent,
            partial: true
        });
        
        // Update UI with cleaned content
        const contentDiv = messageElement.querySelector('.message-content');
        renderMarkdown(contentDiv, cleanedContent);
        
        // Search Wikipedia
        const response = await fetch('/v1/search/wikipedia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            throw new Error(`Wikipedia search failed: ${response.statusText}`);
        }

        const searchData = await response.json();
        searchResults = searchData;

        // Create references section
        if (searchData.results?.length > 0) {
            const result = searchData.results[0];
            updateReferences(messageElement, currentContent, {
                query,
                results: [{
                    index: 1,
                    title: result.title,
                    url: result.url,
                    snippet: result.extract
                }]
            });

            // Continue with additional information
            updateSearchStatus(`Continuing response with Wikipedia data...`, true);

            // Create continuation prompt
            const continuePrompt = {
                role: 'system',
                content: `You are continuing your previous response with the following Wikipedia information about "${query}":

[1] ${result.title}
URL: ${result.url}
${result.extract}

Please continue your previous response, incorporating this information naturally. Use [1] to cite the Wikipedia article. Make sure to explain or elaborate on the information you're citing.`
            };

            // Reset search flags and continue
            searchDetected = false;
            searchQuery = null;
            addMessage('assistant', '', currentChatId);
            await processMessage(continuePrompt.content, modelSelector.value);
        } else {
            // Handle no results
            const noResultsPrompt = {
                role: 'system',
                content: `No Wikipedia results found for "${query}". Please continue your response acknowledging this and provide the best information you can from your own knowledge.`
            };
            await processMessage(noResultsPrompt.content, modelSelector.value);
        }

        updateSearchStatus('', false);

    } catch (error) {
        console.error('Wikipedia search error:', error);
        updateSearchStatus(`Wikipedia search failed: ${error.message}`, true);
        setTimeout(() => updateSearchStatus('', false), 5000);
    }
}

// Handle Google searching and continuing the conversation
async function pauseAndSearch(query, messageElement, currentContent) {
    try {
        updateSearchStatus(`Searching for: "${query}"...`, true);
        
        // Save partial response without the search command
        const cleanedContent = currentContent.replace(/\[google\]\((.*?)\)/, '$1');
        saveMessageToHistory(currentChatId, {
            role: 'assistant',
            content: cleanedContent,
            partial: true // Mark as partial response
        });
        
        // Update UI with cleaned content
        const contentDiv = messageElement.querySelector('.message-content');
        renderMarkdown(contentDiv, cleanedContent);
        
        // Fetch model details to get context length
        let modelContextLimit = 8000; // Default fallback value
        try {
            const modelResponse = await fetch('/v1/models');
            if (modelResponse.ok) {
                const modelData = await modelResponse.json();
                const selectedModelData = modelData.data.find(m => m.id === modelSelector.value);
                if (selectedModelData && selectedModelData.context_length) {
                    modelContextLimit = selectedModelData.context_length;
                }
            }
        } catch (error) {
            console.error("Failed to fetch model context length:", error);
        }

        // Calculate approx character budget for search results
        const charLimit = modelContextLimit * 4; // Approx 4 chars per token
        const maxCharsPerResult = Math.floor(charLimit / 5); // Limit per result, allowing for multiple results

        // Implement retry mechanism
        let attempts = 0;
        let maxRetries = 2;
        let success = false;
        let searchData;
        
        while (attempts <= maxRetries && !success) {
            try {
                if (attempts > 0) {
                    updateSearchStatus(`Retry attempt ${attempts}/${maxRetries} for "${query}"...`, true);
                    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between retries
                }
                
                const response = await fetch('/v1/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query,
                        include_urls: true,
                        fetch_content: true
                    })
                });

                if (!response.ok) {
                    throw new Error(`Search failed: ${response.statusText}`);
                }

                searchData = await response.json();
                success = true;
            } catch (error) {
                attempts++;
                if (attempts > maxRetries) {
                    throw error; // Re-throw if we've exhausted retries
                }
            }
        }

        // Determine if this is likely to be an article-related query
        const articleKeywords = [
            'news', 'article', 'blog', 'post', 'report', 'story', 'publication',
            'paper', 'research', 'study', 'analysis', 'review', 'guide',
            'tutorial', 'how to', 'what is', 'explained', 'latest'
        ];
        
        const isArticleRelated = articleKeywords.some(keyword =>
            query.toLowerCase().includes(keyword.toLowerCase())
        );

        updateSearchStatus(`Found ${searchData.results.length} results for "${query}". Processing...`, true);

        // Format search results based on query type
        let processedResults = [];
        
        if (isArticleRelated) {
            // For article-related queries, try to fetch full content
            for (const result of searchData.results) {
                try {
                    // Make sure the URL is valid
                    if (!result.url) continue;
                    
                    updateSearchStatus(`Retrieving detailed content for "${result.title}"...`, true);
                    
                    const contentResponse = await fetch(`/v1/search/content?url=${encodeURIComponent(result.url)}`);
                    
                    if (!contentResponse.ok) {
                        // Fall back to using snippet if full content fetch fails
                        processedResults.push({
                            index: result.index,
                            title: result.title || 'No title',
                            url: result.url,
                            content: result.snippet || 'No content available'
                        });
                        continue;
                    }
                    
                    const contentData = await contentResponse.json();
                    
                    // Add to processed results, trimming content to fit within limits
                    const contentText = contentData.content || result.snippet || '';
                    const trimmedContent = contentText.length > maxCharsPerResult
                        ? contentText.substring(0, maxCharsPerResult) + '...'
                        : contentText;
                    
                    processedResults.push({
                        index: result.index,
                        title: result.title || 'No title',
                        url: result.url,
                        content: trimmedContent
                    });
                    
                } catch (error) {
                    console.error(`Error fetching content for ${result.url}:`, error);
                    // Still add what we have if content fetch fails
                    processedResults.push({
                        index: result.index,
                        title: result.title || 'No title',
                        url: result.url,
                        content: result.snippet || 'No content available'
                    });
                }
            }
            
            updateSearchStatus(`Synthesizing detailed content from ${processedResults.length} articles...`, true);
        } else {
            // For non-article queries, just use the snippets
            processedResults = await Promise.all(searchData.results.map(async (r) => {
                const result = {
                    index: r.index,
                    title: r.title || 'No title',
                    url: r.url || '',
                    snippet: r.snippet || 'No content available'
                };

                if (r.url) {
                    try {
                        const contentResponse = await fetch(`/v1/search/content?url=${encodeURIComponent(r.url)}`);
                        if (contentResponse.ok) {
                            const contentData = await contentResponse.json();
                            result.content = contentData.content || result.snippet;
                        }
                    } catch (error) {
                        console.error(`Error fetching content for ${r.url}:`, error);
                        result.content = result.snippet;
                    }
                }

                return result;
            }));
        }

        // Create a search prompt with the processed results
        let resultsText = processedResults.map(r =>
            `[${r.index}] ${r.title}\n${r.url}\n${r.content}\n`
        ).join('\n\n');

        const searchPrompt = SEARCH_RESULTS_PROMPT
            .replace('{query}', query)
            .replace('{results}', resultsText);

        // Save search results for later reference
        searchResults = {
            query,
            results: processedResults
        };
        
        // Add references to the assistant message
        const referencesElement = document.createElement('div');
        referencesElement.classList.add('message-references', 'has-references');
        
        const referenceTitleElement = document.createElement('div');
        referenceTitleElement.classList.add('reference-title');
        referenceTitleElement.textContent = `Search Results (${processedResults.length})`;
        
        const referencesListElement = document.createElement('div');
        referencesListElement.classList.add('references-list');
        
        processedResults.forEach(result => {
            const refItem = document.createElement('div');
            refItem.classList.add('reference-item');
            refItem.innerHTML = `
                <strong>[${result.index}]</strong>
                <a href="${result.url}" target="_blank" rel="noopener noreferrer">${result.title}</a>
                <div class="reference-snippet">${result.snippet}</div>
                ${result.content ? `<div class="reference-content">${result.content.substring(0, 300)}...</div>` : ''}
            `;
            referencesListElement.appendChild(refItem);
        });
        
        referenceTitleElement.addEventListener('click', () => {
            referenceTitleElement.classList.toggle('collapsed');
            referencesListElement.classList.toggle('collapsed');
        });
        
        referencesElement.appendChild(referenceTitleElement);
        referencesElement.appendChild(referencesListElement);
        messageElement.appendChild(referencesElement);

        // Continue with additional information from the search
        updateSearchStatus(`Continuing response with search data...`, true);

        // Send search results back to AI
        // Continue conversation with search results
        const continuePrompt = {
            role: 'system',
            content: `You are continuing your previous response with the following search results for "${query}":

${searchResults.results.map(r =>
    `[${r.index}] ${r.title}
URL: ${r.url || 'No URL available'}
${r.content || r.snippet || 'No content available'}`
).join('\n\n')}

Please continue your previous response, incorporating these search results naturally. Use [index] notation to cite specific sources. Make sure to explain or elaborate on the information you're citing.`
        };

        // Reset search flags
        searchDetected = false;
        searchQuery = null;
        updateSearchStatus('', false);
        updateCitations();

        // Create a new message for the AI's response to search results
        addMessage('assistant', '', currentChatId);
        await processMessage(continuePrompt.content, modelSelector.value);

    } catch (error) {
        console.error('Search error:', error);
        updateSearchStatus(`Search failed: ${error.message}`, true);
        setTimeout(() => updateSearchStatus('', false), 5000);
    }
}

async function checkForSearchCommand(content) {
    // Modified to remove [google](...) syntax before sending to AI
    const searchMatch = content.match(/\[google\]\((.*?)\)/);
    if (!searchMatch) return;

    const query = searchMatch[1];
    const searchElement = document.createElement('div');
    searchElement.classList.add('message', 'system');
    searchElement.textContent = `Searching for: "${query}"...`;
    messageList.appendChild(searchElement);
    
    // Fetch model details to get context length
    let modelContextLimit = 8000; // Default fallback value
    try {
        const modelResponse = await fetch('/v1/models');
        if (modelResponse.ok) {
            const modelData = await modelResponse.json();
            const selectedModelData = modelData.data.find(m => m.id === modelSelector.value);
            if (selectedModelData && selectedModelData.context_length) {
                modelContextLimit = selectedModelData.context_length;
            }
        }
    } catch (error) {
        console.error("Failed to fetch model context length:", error);
    }

    // Calculate approx character budget for search results (using rough token-to-char ratio)
    const charLimit = modelContextLimit * 4; // Approx 4 chars per token
    const maxCharsPerResult = Math.floor(charLimit / 5); // Limit per result, allowing for multiple results

    try {
        let attempts = 0;
        let maxRetries = 2;
        let success = false;
        let searchData;
        
        // Implement retry mechanism
        while (attempts <= maxRetries && !success) {
            try {
                if (attempts > 0) {
                    searchElement.textContent = `Retry attempt ${attempts}/${maxRetries} for "${query}"...`;
                    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between retries
                }
                
                const response = await fetch('/v1/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });

                if (!response.ok) {
                    throw new Error(`Search failed: ${response.statusText}`);
                }

                searchData = await response.json();
                success = true;
            } catch (error) {
                attempts++;
                if (attempts > maxRetries) {
                    throw error; // Re-throw if we've exhausted retries
                }
            }
        }

        // Determine if this is likely to be an article-related query
        const articleKeywords = [
            'news', 'article', 'blog', 'post', 'report', 'story', 'publication',
            'paper', 'research', 'study', 'analysis', 'review', 'guide',
            'tutorial', 'how to', 'what is', 'explained', 'latest'
        ];
        
        const isArticleRelated = articleKeywords.some(keyword =>
            query.toLowerCase().includes(keyword.toLowerCase())
        );

        searchElement.textContent = `Found ${searchData.results.length} results for "${query}". Analyzing content...`;

        // Format search results based on query type
        let processedResults = [];
        
        if (isArticleRelated) {
            // For article-related queries, try to fetch full content
            for (const result of searchData.results) {
                try {
                    // Make sure the URL is valid
                    if (!result.url) continue;
                    
                    const contentResponse = await fetch(`/v1/search/content?url=${encodeURIComponent(result.url)}`);
                    
                    if (!contentResponse.ok) {
                        // Fall back to using snippet if full content fetch fails
                        processedResults.push({
                            index: result.index,
                            title: result.title || 'No title',
                            url: result.url,
                            content: result.snippet || 'No content available'
                        });
                        continue;
                    }
                    
                    const contentData = await contentResponse.json();
                    
                    // Add to processed results, trimming content to fit within limits
                    const contentText = contentData.content || result.snippet || '';
                    const trimmedContent = contentText.length > maxCharsPerResult
                        ? contentText.substring(0, maxCharsPerResult) + '...'
                        : contentText;
                    
                    processedResults.push({
                        index: result.index,
                        title: result.title || 'No title',
                        url: result.url,
                        content: trimmedContent
                    });
                    
                } catch (error) {
                    console.error(`Error fetching content for ${result.url}:`, error);
                    // Still add what we have if content fetch fails
                    processedResults.push({
                        index: result.index,
                        title: result.title || 'No title',
                        url: result.url,
                        content: result.snippet || 'No content available'
                    });
                }
            }
            
            searchElement.textContent = `Retrieved detailed content for ${processedResults.length} articles related to "${query}". Synthesizing...`;
            
        } else {
            // For non-article queries, just use the snippets
            processedResults = searchData.results.map(r => ({
                index: r.index,
                title: r.title || 'No title',
                url: r.url || '',
                content: r.snippet || 'No content available'
            }));
            
            searchElement.textContent = `Found ${processedResults.length} search results for "${query}". Processing...`;
        }

        // Create a search prompt with the processed results
        let resultsText = processedResults.map(r =>
            `[${r.index}] ${r.title}\n${r.url}\n${r.content}\n`
        ).join('\n\n');

        const searchPrompt = SEARCH_RESULTS_PROMPT
            .replace('{query}', query)
            .replace('{results}', resultsText);

        // Send search results back to AI
        const messages = [
            { role: 'system', content: searchPrompt },
            { role: 'user', content: 'Please incorporate these search results into your response. Include citations using [index] notation.' }
        ];

        await processMessage(messages[1].content, modelSelector.value);

    } catch (error) {
        console.error('Search error:', error);
        searchElement.textContent = `Search failed: ${error.message}`;
    }
}

// --- History Management ---
function generateChatId() {
    return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function saveChatHistory() {
    try {
        localStorage.setItem('sylphChatHistory', JSON.stringify(chatHistory));
    } catch (e) {
        console.error("Failed to save chat history:", e);
    }
}

function loadChatHistory() {
    try {
        const storedHistory = localStorage.getItem('sylphChatHistory');
        chatHistory = storedHistory ? JSON.parse(storedHistory) : {};
    } catch (e) {
        console.error("Failed to load chat history:", e);
        chatHistory = {};
    }
    loadChatHistoryList();
}

function createNewChatHistory(firstMessage) {
    const newId = generateChatId();
    const title = firstMessage.substring(0, 30) + (firstMessage.length > 30 ? '...' : '');
    chatHistory[newId] = {
        id: newId,
        title: title,
        messages: [],
        timestamp: Date.now()
    };
    saveChatHistory();
    loadChatHistoryList();
    return newId;
}

function generateChatTitle(messages) {
    // Find significant content to base the title on
    let titleSource = "";
    
    // Look for user messages with substantial content
    for (const message of messages) {
        if (message.role === 'user' && message.content.length > 10) {
            titleSource = message.content;
            break;
        }
    }
    
    if (!titleSource) {
        return "Untitled Chat";
    }
    
    // Clean up the title and limit length
    const maxLength = 40;
    let title = titleSource
        .replace(/[^a-zA-Z0-9 ]/g, ' ')  // Remove special chars
        .replace(/\s+/g, ' ')            // Remove extra spaces
        .trim();
    
    // Truncate if too long
    if (title.length > maxLength) {
        title = title.substring(0, maxLength) + "...";
    }
    
    return title;
}

function saveMessageToHistory(chatId, message) {
    if (chatHistory[chatId]) {
        chatHistory[chatId].messages.push(message);
        chatHistory[chatId].timestamp = Date.now();
        saveChatHistory();
    }
}

function getMessagesForApi(chatId) {
    return chatHistory[chatId]?.messages || [];
}

async function summarizeChat() {
    const messages = getMessagesForApi(currentChatId);
    if (messages.length < 3) return; // Don't summarize very short conversations

    // First update the user with a subtle notification about summarization
    updateSearchStatus('Summarizing conversation...', true);
    
    // Prepare a request to get both summary and title
    const summaryRequest = [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: `Please summarize the following conversation and generate a concise, relevant title (5-7 words) for it.
Format your response as:
TITLE: [Your title here]
SUMMARY: [Your detailed summary here]

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}` }
    ];

    try {
        const response = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelSelector.value,
                messages: summaryRequest,
                temperature: 0.3 // Lower temperature for more consistent summaries
            })
        });

        if (!response.ok) throw new Error('Failed to generate summary');
        
        const data = await response.json();
        const fullResponse = data.choices[0].message.content;
        
        // Extract title and summary from the response
        let title = "Summarized Chat";
        let summary = fullResponse;
        
        const titleMatch = fullResponse.match(/TITLE:\s*(.*?)(?:\n|$)/);
        const summaryMatch = fullResponse.match(/SUMMARY:\s*([\s\S]*?)(?:$)/);
        
        if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
        }
        
        if (summaryMatch && summaryMatch[1]) {
            summary = summaryMatch[1].trim();
        }

        // Update the chat title
        chatHistory[currentChatId].title = title;
        
        // Replace chat history with summary, preserving only the last user message and AI response
        let newMessages = [{ role: 'system', content: `Previous conversation summary:\n\n${summary}` }];
        
        // Don't show a visual indicator in the chat, keep the conversation flow clean
        
        // Save the updated history
        chatHistory[currentChatId].messages = newMessages;
        saveChatHistory();
        loadChatHistoryList(); // Update the sidebar with the new title

    } catch (error) {
        console.error('Failed to summarize chat:', error);
        // Continue without summarizing if it fails
    } finally {
        updateSearchStatus('', false);
    }
}

function loadChatHistoryList() {
    historyList.innerHTML = '';
    const sortedChats = Object.values(chatHistory)
        .sort((a, b) => b.timestamp - a.timestamp);

    if (sortedChats.length === 0) {
        historyList.innerHTML = '<li class="text-muted">No history yet</li>';
        clearHistoryButton.style.display = 'none';
        return;
    }

    clearHistoryButton.style.display = 'block';

    sortedChats.forEach(chat => {
        const listItem = document.createElement('li');
        listItem.textContent = chat.title;
        listItem.dataset.chatId = chat.id;
        if (chat.id === currentChatId) {
            listItem.classList.add('active');
        }
        listItem.addEventListener('click', () => switchChat(chat.id));
        historyList.appendChild(listItem);
    });
}

function switchChat(chatId) {
    if (chatId === currentChatId && messageList.children.length > 1) return;

    currentChatId = chatId;
    messageList.innerHTML = '';

    const chat = chatHistory[chatId];
    if (chat?.messages) {
        chat.messages.forEach(msg => {
            addMessage(msg.role, msg.content, null);
        });
    } else {
        addMessage('system', 'Started new chat.');
    }

    loadChatHistoryList();
    scrollToBottom();
}

clearHistoryButton.addEventListener('click', () => {
    if (confirm('Clear all chat history? This cannot be undone.')) {
        chatHistory = {};
        currentChatId = null;
        saveChatHistory();
        loadChatHistoryList();
        messageList.innerHTML = '';
        addMessage('system', 'Chat history cleared.');
    }
});
// --- Settings Management ---
// Add settings panel content
function addSearchToggle() {
    const settingsForm = document.querySelector('#settings-panel form');
    if (!settingsForm) return;

    const searchToggleDiv = document.createElement('div');
    searchToggleDiv.className = 'settings-group';
    searchToggleDiv.innerHTML = `
        <label class="switch-label">
            Enable AI Search
            <div class="switch">
                <input type="checkbox" id="enable-search" ${settings.enableSearch ? 'checked' : ''}>
                <span class="slider"></span>
            </div>
        </label>
        <p class="text-muted">Allow AI to search the web and Wikipedia for information</p>
    `;

    settingsForm.appendChild(searchToggleDiv);

    // Add event listener for the search toggle
    document.getElementById('enable-search').addEventListener('change', (e) => {
        settings.enableSearch = e.target.checked;
        saveSettings();
    });
}

function loadSettings() {
    try {
        // Load settings
        const stored = localStorage.getItem('sylphChatSettings');
        if (stored) {
            const loadedSettings = JSON.parse(stored);
            settings = {
                ...settings,
                ...loadedSettings,
                // Ensure enableSearch has a default value if not in stored settings
                enableSearch: loadedSettings.hasOwnProperty('enableSearch')
                    ? loadedSettings.enableSearch
                    : settings.enableSearch
            };
        }
        
        // Load API key (stored separately for security)
        const apiKey = localStorage.getItem('apiKey');
        if (apiKey) {
            settings.apiKey = apiKey;
            apiKeyInput.value = apiKey;
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
    
    // Apply settings to UI
    temperatureInput.value = settings.temperature;
    temperatureValue.textContent = settings.temperature;
    
    // Apply theme
    document.body.classList.add('theme-' + settings.theme);
    document.querySelectorAll('.theme-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });
}

// Temperature setting
temperatureInput.addEventListener('input', () => {
    temperatureValue.textContent = temperatureInput.value;
    settings.temperature = parseFloat(temperatureInput.value);
    saveSettings();
});

// Function to save settings
function saveSettings() {
    // Don't save API key with other settings
    const settingsToSave = {
        ...settings,
        apiKey: undefined
    };
    localStorage.setItem('sylphChatSettings', JSON.stringify(settingsToSave));
}

// API Key setting
apiKeyInput.addEventListener('change', () => {
    const apiKey = apiKeyInput.value.trim();
    localStorage.setItem('apiKey', apiKey);
    settings.apiKey = apiKey;
    
    // Show confirmation
    const small = apiKeyInput.nextElementSibling;
    const originalText = small.innerHTML;
    small.innerHTML = apiKey ? '✓ API key saved' : 'API key removed';
    
    setTimeout(() => {
        small.innerHTML = originalText;
    }, 2000);
});

// Initialize chat interface and settings
function initializeChat() {
    console.log("Initializing Sylph Chat...");
    
    // Load settings and history
    loadSettings();
    loadChatHistory();
    loadModels();

    // Add search toggle to settings
    addSearchToggle();

    // Configure animations
    document.querySelectorAll('.chat-sidebar').forEach(sidebar => {
        sidebar.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease';
    });
    
    // Setup input box auto-resize with max height
    const resizeInput = () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
    };
    messageInput.addEventListener('input', resizeInput);
    messageInput.dispatchEvent(new Event('input'));
    window.addEventListener('resize', resizeInput);

    // Initialize chat state
    messageList.innerHTML = '';
    currentChatId = null;
    loadChatHistoryList();
    
    // Configure layout with generous bottom padding for better scrolling
    messageList.style.paddingBottom = '300px';
    
    // Setup event listeners
    searchStatus.addEventListener('click', () => updateSearchStatus('', false));
    window.addEventListener('resize', scrollToBottom);

    // Initial resize
    resizeInput();
}

// Theme setting
document.querySelectorAll('.theme-button').forEach(button => {
    button.addEventListener('click', () => {
        const theme = button.dataset.theme;
        settings.theme = theme;
        
        // Update active state
        document.querySelectorAll('.theme-button').forEach(btn => {
            btn.classList.toggle('active', btn === button);
        });
        
        // Apply theme
        document.body.className = document.body.className.replace(/theme-\w+/g, '');
        document.body.classList.add('theme-' + theme);
        
        saveSettings();
    });
});

// Start the chat interface
document.addEventListener('DOMContentLoaded', initializeChat);

/**
 * Toggle sidebar panel visibility with smooth animations.
 * @param {HTMLElement} panel - The panel to toggle (settingsPanel or historyPanel)
 */
function toggleSidebar(panel) {
    const mainContent = document.querySelector('.chat-area');
    const otherPanel = panel === settingsPanel ? historyPanel : settingsPanel;
    const isPanel = panel === settingsPanel;
    
    // Smooth animation timing
    const timing = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const delay = 200;
    const duration = 400;
    
    // Set up transitions
    panel.style.transition = `transform ${duration}ms ${timing}, opacity ${duration}ms ease`;
    mainContent.style.transition = `margin-left ${duration}ms ${timing}`;
    
    const hidePanel = (p, direction) => {
        p.style.transform = `translateX(${direction === 'left' ? '-100%' : '100%'})`;
        p.style.opacity = '0';
        mainContent.classList.remove('with-sidebar');
        mainContent.style.marginLeft = '0';
        setTimeout(() => p.classList.add('hidden'), duration);
    };
    
    const showPanel = (p, direction) => {
        p.classList.remove('hidden');
        p.style.transform = 'translateX(0)';
        p.style.opacity = '1';
        mainContent.classList.add('with-sidebar');
        mainContent.style.marginLeft = '280px';
    };
    
    // Handle panel toggling with other panel checks
    if (!otherPanel.classList.contains('hidden')) {
        // Hide other panel first
        hidePanel(otherPanel, isPanel ? 'left' : 'right');
        // Show current panel after delay
        setTimeout(() => {
            showPanel(panel, isPanel ? 'right' : 'left');
        }, delay);
    } else {
        // Just toggle current panel
        if (panel.classList.contains('hidden')) {
            showPanel(panel, isPanel ? 'right' : 'left');
        } else {
            hidePanel(panel, isPanel ? 'right' : 'left');
        }
    }
}

// Initialize the application
// Ensure markup is ready before initialization
document.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => {
        initializeChat();
        // Force layout recalculation
        window.dispatchEvent(new Event('resize'));
    });
});