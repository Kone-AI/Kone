import BaseProvider from './base.js';
import logger from '../utils/logger.js';

class HackClubProvider extends BaseProvider {
  constructor() {
    super({
      name: 'HackClubProvider',
      baseURL: 'https://ai.hackclub.com',
      apiKeyRequired: false,
      supportsStreaming: true,
      enabled: true,
      models: []
    });
    this.enabled = true;
    this.lastModelCheck = 0;
    this.modelCheckInterval = 5 * 60 * 1000; // Check every 5 minutes
  }

  async getCurrentModel() {
    const now = Date.now();
    if (now - this.lastModelCheck < this.modelCheckInterval) {
      return this.currentModel;
    }

    try {
      logger.debug('[HackClub] Fetching current model');
      const response = await fetch(`${this.baseURL}/model`);
      if (!response.ok) {
        throw new Error(`Failed to fetch model: ${response.status}`);
      }

      const modelId = await response.text();
      this.currentModel = modelId.trim();
      this.lastModelCheck = now;

      // Update models list with current model
      this.models = [{
        id: `hackclub/${this.currentModel}`,
        name: this.currentModel.split('/').pop(),
        contextLength: 10000000, // 10M context length
        pricing: { prompt: 0, completion: 0 },
        owned_by: 'hackclub.com'
      }];

      logger.debug(`[HackClub] Current model: ${this.currentModel}`);
      return this.currentModel;
    } catch (error) {
      logger.error('[HackClub] Failed to get current model:', error);
      throw error;
    }
  }
  async getModels() {
    try {
      await this.getCurrentModel();
      return this.models;
    } catch (error) {
      logger.error('[HackClub] Failed to get models:', error);
      return [];
    }
  }

  async canHandle(model) {
    return model.startsWith('hackclub/');
  }

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('Provider is not enabled');
    }

    // Ensure we have the current model
    await this.getCurrentModel();

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': options.stream ? 'text/event-stream' : 'application/json'
      },
      body: JSON.stringify({
        messages,
        stream: options.stream
      })
    });

    if (!response.ok) {
      throw new Error(`HackClub API returned ${response.status}`);
    }

    if (options.stream) {
      return this._handleStream(response);
    }

    const data = await response.json();
    if (!data.choices?.[0]?.message) {
      throw new Error('Invalid response format from HackClub API');
    }

    return {
      id: data.id || `hackclub-${Date.now()}`,
      object: 'chat.completion',
      created: data.created || Math.floor(Date.now() / 1000),
      model: this.models[0].id,
      choices: [{
        index: 0,
        message: {
          role: data.choices[0].message.role || 'assistant',
          content: data.choices[0].message.content || ''
        },
        finish_reason: data.choices[0].finish_reason || 'stop'
      }]
    };
  }

  async *_handleStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          if (line.includes('[DONE]')) return;

          try {
            const data = JSON.parse(line.slice(6));
            if (!data.choices?.[0]?.delta) continue;

            yield {
              id: data.id || `hackclub-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: data.created || Math.floor(Date.now() / 1000),
              model: this.models[0].id,
              choices: [{
                index: 0,
                delta: {
                  role: data.choices[0].delta.role || 'assistant',
                  content: data.choices[0].delta.content || ''
                },
                finish_reason: data.choices[0].finish_reason
              }]
            };
          } catch (error) {
            logger.error('[HackClub] Error parsing stream chunk:', error);
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export default new HackClubProvider();