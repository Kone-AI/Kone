// hackclub.js provider - our local ai friend
import * as cheerio from 'cheerio';
import BaseProvider from './base.js';

class HackClubProvider extends BaseProvider {
  constructor() {
    super({
      name: 'HackClubProvider',
      baseURL: 'https://ai.hackclub.com',
      apiKeyRequired: false,
      supportsStreaming: true,
      models: [{
        id: 'hackclub/llama-latest',
        name: 'Llama Latest',
        contextLength: 128000,
        pricing: { prompt: 0, completion: 0 }
      }]
    });

    this.lastRateLimit = 0;
    this.rateLimitDelay = 1000;
    this.lastRateLimitError = 0;
    this.rateLimitCooldown = 60 * 60 * 1000;
    this.currentModel = 'unknown';
    this.lastModelCheck = 0;
    this.modelCheckInterval = 5 * 60 * 1000;
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
      console.log('[HackClub] Using cached model:', this.currentModel);
      return this.currentModel;
    }

    console.log('[HackClub] Checking current model...');
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
      
      // Try different selectors to find the model name
      const selectors = [
        'b code',          // Original selector
        '#modelInfo code',  // Try an ID
        '.model-info code', // Try a class
        'code',            // Any code element
        'body'             // Get the entire body for inspection
      ];
      
      let modelName = '';
      let selectedElement = null;
      
      for (const selector of selectors) {
        const element = $(selector);
        console.log(`[HackClub] Trying selector "${selector}": found ${element.length} elements`);
        
        if (element.length > 0) {
          const text = element.text().trim();
          
          // If it's the body selector, try to extract model info with regex
          if (selector === 'body' && text) {
            const modelMatch = text.match(/(?:model|using|running)(?:\s*:\s*|\s+)([a-zA-Z0-9\-\.]+)/i);
            if (modelMatch && modelMatch[1]) {
              modelName = modelMatch[1].trim();
              console.log(`[HackClub] Extracted model name from body using regex:`, modelName);
              break;
            }
          } else if (text) {
            modelName = text;
            selectedElement = element;
            console.log(`[HackClub] Found text with selector "${selector}":`, text);
            break;
          }
        }
      }
      
      if (modelName) {
        // Clean up the model name if it's too long or contains HTML
        if (modelName.length > 100) {
          modelName = 'llama-3.3-70b-versatile';
          console.log('[HackClub] Model name too long, falling back to default');
        } else {
          // Try to identify a model name pattern in the text
          const modelPattern = modelName.match(/(?:llama|mistral|claude|gpt|gemini|mixtral)(?:[\-\s])?[0-9\.a-z\-]+/i);
          if (modelPattern) {
            modelName = modelPattern[0].trim();
            console.log('[HackClub] Extracted model pattern:', modelName);
          }
        }
        
        this.currentModel = modelName;
        console.log('[HackClub] Updated current model to:', this.currentModel);
      } else {
        console.warn('[HackClub] Could not find model name in HackClub homepage, falling back to default');
        this.currentModel = 'llama-3.3-70b-versatile';
      }
    } catch (error) {
      console.error('[HackClub] Failed to get current model:', error);
      this.currentModel = 'llama-3.3-70b-versatile';
      if (error.name === 'AbortError') {
        console.warn('[HackClub] Model check timed out, using default model');
      }
    }

    this.lastModelCheck = now;
    console.log('[HackClub] Final model set to:', this.currentModel);
    return this.currentModel;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async handleRateLimit() {
    const now = Date.now();
    
    if (this.lastRateLimitError > 0 && now - this.lastRateLimitError < this.rateLimitCooldown) {
      const remainingCooldown = Math.round((this.lastRateLimitError + this.rateLimitCooldown - now) / 1000);
      throw new Error(`HackClub API is cooling down after rate limit. Try again in ${remainingCooldown} seconds.`);
    }
    
    const timeSinceLastRequest = now - this.lastRateLimit;
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await this.sleep(this.rateLimitDelay - timeSinceLastRequest);
    }
    
    this.lastRateLimit = Date.now();
  }

  async getCurrentModel() {
    const now = Date.now();
    if (now - this.lastModelCheck < this.modelCheckInterval) {
      return this.currentModel;
    }

    try {
      const response = await fetch(this.baseURL);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      const selectors = [
        'b code',
        '#modelInfo code',
        '.model-info code',
        'code',
        'body'
      ];
      
      for (const selector of selectors) {
        const element = $(selector);
        if (element.length > 0) {
          const text = element.text().trim();
          
          if (selector === 'body' && text) {
            const modelMatch = text.match(/(?:model|using|running)(?:\s*:\s*|\s+)([a-zA-Z0-9\-\.]+)/i);
            if (modelMatch && modelMatch[1]) {
              this.currentModel = modelMatch[1].trim();
              break;
            }
          } else if (text) {
            this.currentModel = text;
            break;
          }
        }
      }
      
      if (!this.currentModel || this.currentModel === 'unknown') {
        this.currentModel = 'llama-3.3-70b-versatile';
      }
      
    } catch (error) {
      this.currentModel = 'llama-3.3-70b-versatile';
    }

    this.lastModelCheck = now;
    return this.currentModel;
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('HackClub provider is not enabled');
    }

    await this.handleRateLimit();

    try {
      const currentModel = await this.getCurrentModel();
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': options.stream ? 'text/event-stream' : 'application/json'
        },
        body: JSON.stringify({
          messages,
          stream: options.stream,
          model: options.model?.replace('hackclub/', '') || currentModel
        })
      });

      if (!response.ok) {
        if (response.status === 429) {
          this.lastRateLimitError = Date.now();
          this.rateLimitDelay = Math.min(this.rateLimitDelay * 2, 10000);
          throw new Error('Rate limited by HackClub API');
        }
        throw new Error(`HackClub API returned ${response.status}`);
      }

      if (options.stream) {
        return this._handleStream(response, currentModel);
      }

      const data = await response.json();
      return this._formatResponse(data, currentModel);
    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.status === 404) {
        this.enabled = false;
      }
      throw error;
    }
  }

  async *_handleStream(response) {
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
            id: data.id || (`hackclub-${Date.now()}`),
            object: 'chat.completion.chunk',
            created: data.created || Math.floor(Date.now() / 1000),
            model: this.models[0].id,
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

  async getModels() {
    const models = await super.getModels();
    
    // Update model ID with current model name
    const currentModel = await this.getCurrentModel();
    if (currentModel && currentModel !== 'unknown') {
      models[0].id = `hackclub/${currentModel}`;
      models[0].name = currentModel;
    }
    
    return models;
  }
}

export default new HackClubProvider();