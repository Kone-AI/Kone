// voids.js provider - the free one we all love
class VoidsProvider {
  constructor() {
    this.baseUrl = 'https://api.voids.top/v1';
    this.supportsStreaming = true;
    this.lastRequest = 0;
    this.requestDelay = 1000; // 1 second between requests
    this.models = new Map();
    this.lastModelUpdate = 0;
    this.modelUpdateInterval = 5 * 60 * 1000; // 5 minutes
  }

  formatModelName(modelId) {
    // if it already has our prefix, use it as-is
    if (modelId.startsWith('voids/')) {
      return modelId;
    }
    return `voids/${modelId}`;
  }

  getBaseModelName(model) {
    // if it starts with our prefix, remove it
    if (model.startsWith('voids/')) {
      return model.replace('voids/', '');
    }
    // if it's not our model, return as-is
    return model;
  }

  async throttleRequest() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequest = Date.now();
  }

  async makeRequest(url, options = {}) {
    await this.throttleRequest();

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      // Check for rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After')) || 5;
        this.requestDelay = Math.max(this.requestDelay, retryAfter * 1000);
        throw new Error(`Rate limited. Please wait ${retryAfter} seconds.`);
      }

      // Check for other errors
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('Raw response:', text);
        throw new Error(`Invalid JSON response: ${e.message}`);
      }
    } catch (error) {
      console.error('Request failed:', error);
      throw error;
    }
  }

  async canHandle(model) {
    const baseModel = this.getBaseModelName(model);
    const models = await this.getModels();
    return models.some(m => m.id === this.formatModelName(baseModel));
  }

  transformResponse(response, model) {
    if (response && typeof response === 'object') {
      if (response.model) {
        response.model = this.formatModelName(model);
      }
      if (response.choices && Array.isArray(response.choices)) {
        response.choices.forEach(choice => {
          if (choice.model) {
            choice.model = this.formatModelName(model);
          }
        });
      }
    }
    return response;
  }

  async chat(messages, options = {}) {
    const { model, stream } = options;
    const baseModel = this.getBaseModelName(model);

    try {
      const response = await this.makeRequest(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        body: JSON.stringify({
          messages,
          model: baseModel,
          stream,
          ...options
        })
      });

      if (stream) {
        return this._handleStream(response, model);
      }

      return this.transformResponse(response, model);
    } catch (error) {
      if (error.message.includes('Rate limited')) {
        // Wait and retry once
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
        return this.chat(messages, options);
      }
      throw error;
    }
  }

  async *_handleStream(response, model) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line === 'data: [DONE]') return;

          try {
            const data = JSON.parse(line.slice(6)); // remove 'data: '
            yield this.transformResponse(data, model);
          } catch (e) {
            console.error('Streaming parse error:', e);
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async getModels() {
    const now = Date.now();
    if (now - this.lastModelUpdate < this.modelUpdateInterval && this.models.size > 0) {
      return Array.from(this.models.values());
    }

    try {
      const data = await this.makeRequest(`${this.baseUrl}/models`);
      
      if (!data || !data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid model data format');
      }

      this.models = new Map(data.data.map(model => [
        this.formatModelName(model.id),
        {
          id: this.formatModelName(model.id),
          object: 'model',
          created: Date.now(),
          owned_by: 'https://voids.top',
          permission: [],
          root: model.id,
          parent: null,
          context_length: model.context_length || 8192,
          capabilities: {
            text: true,
            images: model.id.includes('vision')
          }
        }
      ]));

      this.lastModelUpdate = now;
      return Array.from(this.models.values());
    } catch (error) {
      console.error('Model fetch failed:', error);
      // Return cached models if available, otherwise empty array
      return Array.from(this.models.values());
    }
  }
}

export default VoidsProvider;