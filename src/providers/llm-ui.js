// llm-ui.js - provider for llm-ui.com api
import BaseProvider from './base.js';

class LLMUIProvider extends BaseProvider {
  constructor() {
    super({
      name: 'LLMUIProvider',
      baseURL: 'https://llm-ui.com/api',
      apiKeyRequired: false,
      supportsStreaming: false,
      models: [{
        id: 'llm-ui/gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        contextLength: 4096,
        pricing: { prompt: 0, completion: 0 }
      }]
    });
    
    this.lastRateLimit = 0;
    this.rateLimitDelay = 1000;
    this.lastRateLimitError = 0;
    this.rateLimitCooldown = 60 * 60 * 1000; // 1 hour cooldown when rate limited
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async handleRateLimit() {
    const now = Date.now();
    
    // If we hit a rate limit recently, don't retry for the cooldown period
    if (this.lastRateLimitError > 0 && now - this.lastRateLimitError < this.rateLimitCooldown) {
      const remainingCooldown = Math.round((this.lastRateLimitError + this.rateLimitCooldown - now) / 1000);
      if (process.env.DEBUG_MODE === 'true') {
        console.log(`[LLM-UI] Still in rate limit cooldown. ${remainingCooldown}s remaining.`);
      }
      throw new Error(`LLM-UI API is cooling down after rate limit. Try again in ${remainingCooldown} seconds.`);
    }
    
    // Regular request rate limiting
    const timeSinceLastRequest = now - this.lastRateLimit;
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await this.sleep(this.rateLimitDelay - timeSinceLastRequest);
    }
    
    this.lastRateLimit = Date.now();
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('LLM-UI provider is not enabled');
    }

    await this.handleRateLimit();

    try {
      const response = await fetch(`${this.baseURL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
          "Accept": "*/*",
          "Sec-Fetch-Site": "same-origin"
        },
        body: JSON.stringify({
          messages,
          apiKey: "",
          model: options.model?.replace('llm-ui/', '') || "gpt-3.5-turbo"
        }),
        credentials: "include",
        referrer: "https://llm-ui.com/chat"
      });

      if (!response.ok) {
        if (response.status === 429) {
          this.lastRateLimitError = Date.now();
          this.rateLimitDelay = Math.min(this.rateLimitDelay * 2, 10000);
          throw new Error('Rate limited by LLM-UI API');
        }
        throw new Error(`LLM-UI API returned ${response.status}`);
      }

      const result = await response.json();
      
      return {
        id: `llm-${Date.now()}`,
        object: 'chat.completion',
        created: Date.now(),
        model: options.model || 'llm-ui/gpt-3.5-turbo',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.message?.content || result
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

    } catch (error) {
      if (error.message.includes('Failed to fetch') || error.status === 404) {
        this.enabled = false;
      }
      throw error;
    }
  }
}

export default new LLMUIProvider();