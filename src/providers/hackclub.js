// hackclub.js provider - our local ai friend
import * as cheerio from 'cheerio';

class HackClubProvider {
  constructor() {
    this.enabled = process.env.ENABLE_HACKCLUB !== 'false'; // Enable by default unless explicitly disabled
    this.supportsStreaming = true;
    this.lastRateLimit = 0;
    this.rateLimitDelay = 1000; // 1 second between requests
    this.currentModel = 'unknown';
    this.lastModelCheck = 0;
    this.modelCheckInterval = 5 * 60 * 1000; // check model every 5 minutes
    this.models = new Map();
  }

  formatModelName(modelId) {
    // if it already has our prefix, use it as-is
    if (modelId.startsWith('hackclub/')) {
      return modelId;
    }
    return `hackclub/${modelId}`;
  }

  getBaseModelName(model) {
    // if it starts with our prefix, remove it
    if (model.startsWith('hackclub/')) {
      return model.replace('hackclub/', '');
    }
    // if it's not our model, return as-is
    return model;
  }

  async getCurrentModel() {
    const now = Date.now();
    if (now - this.lastModelCheck < this.modelCheckInterval) {
      return this.currentModel;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('https://ai.hackclub.com', {
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      const html = await response.text();
      
      // Use cheerio to parse the HTML and find the model name
      const $ = cheerio.load(html);
      const modelName = $('b code').text().trim();
      
      if (modelName) {
        this.currentModel = modelName;
      } else {
        console.warn('Could not find model name in HackClub homepage');
        this.currentModel = 'llama-3.3-70b-versatile';
      }
    } catch (error) {
      console.error('Failed to get current HackClub model:', error);
      this.currentModel = 'llama-3.3-70b-versatile';
      if (error.name === 'AbortError') {
        console.warn('HackClub model check timed out, using default model');
      }
    }

    this.lastModelCheck = now;
    return this.currentModel;
  }

  async canHandle(model) {
    if (!this.enabled) return false;
    return model.startsWith('hackclub/');
  }

  transformResponse(response, model) {
    const modelName = response.model || model;

    return {
      id: response.id || ('hackclub-' + Math.random().toString(36).substring(2)),
      object: response.object || 'chat.completion',
      created: response.created || Math.floor(Date.now() / 1000),
      model: this.formatModelName(modelName),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.choices?.[0]?.message?.content || response
        },
        finish_reason: response.choices?.[0]?.finish_reason || 'stop'
      }],
      usage: response.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async handleRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRateLimit;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await this.sleep(this.rateLimitDelay - timeSinceLastRequest);
    }
    
    this.lastRateLimit = Date.now();
  }

  async makeRequest(url, options) {
    if (!this.enabled) {
      throw new Error('HackClub provider is not enabled');
    }

    await this.handleRateLimit();
    const response = await fetch(url, options);

    if (!response.ok) {
      if (response.status === 429) {
        this.rateLimitDelay = Math.min(this.rateLimitDelay * 2, 10000);
        throw new Error('Rate limited by HackClub API');
      }
      const text = await response.text();
      throw new Error(`HackClub API returned ${response.status}: ${text}`);
    }

    return response;
  }

  async *handleStream(response, model) {
    if (!response.body) {
      throw new Error('Response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          if (line.includes('[DONE]')) return;

          const data = JSON.parse(line.slice(6));
          if (!data.choices?.[0]?.delta) continue;

          yield {
            id: data.id || ('hackclub-' + Math.random().toString(36).substring(2)),
            object: 'chat.completion.chunk',
            created: data.created || Math.floor(Date.now() / 1000),
            model: this.formatModelName(model),
            choices: [{
              index: 0,
              delta: {
                role: data.choices[0].delta.role,
                content: data.choices[0].delta.content || ''
              },
              finish_reason: data.choices[0].finish_reason
            }]
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('HackClub provider is not enabled');
    }

    const currentModel = await this.getCurrentModel();
    
    try {
      const response = await this.makeRequest('https://ai.hackclub.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': options.stream ? 'text/event-stream' : 'application/json'
        },
        body: JSON.stringify({
          messages,
          stream: options.stream,
          model: currentModel
        })
      });

      if (options.stream) {
        return this.handleStream(response, currentModel);
      }

      const data = await response.json();
      return this.transformResponse(data, currentModel);
    } catch (error) {
      // Only disable provider on permanent errors
      if (error.message.includes('Failed to fetch') || error.status === 404) {
        this.enabled = false;
      }

      const enhancedError = new Error(`HackClub API error: ${error.message}`);
      enhancedError.cause = error;
      enhancedError.requestBody = messages;
      throw enhancedError;
    }
  }

  async getModelInfo() {
    if (!this.enabled) return null;

    const modelName = await this.getCurrentModel();
    return {
      id: this.formatModelName(modelName),
      object: 'model',
      created: Date.now(),
      owned_by: 'https://hackclub.com',
      permission: [],
      root: 'hackclub',
      parent: null,
      context_length: 128000,
      capabilities: {
        text: true,
        images: false
      }
    };
  }

  async getModels() {
    if (!this.enabled) return [];
    const modelInfo = await this.getModelInfo();
    return modelInfo ? [modelInfo] : [];
  }
}

export default new HackClubProvider();