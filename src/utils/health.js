// health check utilities - sequential model testing with proper delays
import providers from '../providers/index.js';
import logger from './logger.js';

class HealthCheck {
    constructor() {
        this.models = new Map();
        this.lastCheck = 0;
        this.checkIntervalId = null;
        
        // concurrency control
        this.isChecking = false;
        this.checkQueue = [];
    }

    getRandomPrompt() {
        const prompts = [
            "If you had to choose, what's the worst way to eat a banana?",

            "How many pancakes would it take to build a ladder to the moon?",
        
            "What would happen if you tried to fry ice?",
        
            "Can you explain the concept of time using only emojis?",
        
            "If colors could scream, which one would be the loudest?",
        
            "How would you describe a smartphone to a medieval knight?",
        
            "What's the most useless superpower you can think of?",
        
            "If animals could talk, which would be the rudest?",
        
            "How many chickens would it take to win a fight against a lion?",
        
            "What would happen if you replaced all the water in the ocean with ketchup?",
        
            "If you could only eat 5 food2 for the rest of your life, but it had to be a crayon color, which would you pick?",
        
            "How would you survive a zombie apocalypse using only office supplies?",
        
            "What's the weirdest way to greet someone?",
        
            "If you could turn any object into a musical instrument, what would it be and why?",
        
            "How would you explain the internet to a caveman?",
        
            "What would happen if gravity stopped working for 5 seconds?",
        
            "If you could combine any two animals, what would be the most ridiculous combo?",
        
            "How many spoons of sugar does it take to make a coffee undrinkable?",
        
            "What's the most absurd way to propose to someone?",
        
            "If you could only communicate using movie quotes, which movie would you choose?",
        
            "How would you describe a rainbow to a blind alien?",
        
            "What's the worst possible name for a pet goldfish?",
        
            "If you had to replace your hands with everyday objects, what would you pick?",
        
            "How would you convince a cat to take a bath?",
        
            "What's the most unnecessary invention you can think of?",
        
            "If you could only wear 5 outfits for the rest of your life, what would it be?",
        
            "How would you explain memes to someone from the 1800s?",
        
            "What would happen if you tried to microwave a microwave?",
        
            "If you could make any food spicy by default, which would it be?",
        
            "How would you survive in the wilderness with only a roll of duct tape?",
        
            "What's the weirdest thing you could say to a stranger on an elevator?",
        
            "If you had to replace all the trees with something else, what would it be?",
        
            "How would you describe a smartphone to a potato?",
        
            "What's the most confusing way to give directions?",
        
            "If you could only listen to five songs for the rest of your life, but it had to be sung by a goat, which would it be?",
        
            "How would you explain TikTok to your great-grandparents?",
        
            "What's the worst possible pizza topping combination?",
        
            "If you could turn any body part into a kitchen appliance, what would it be?",
        
            "How would you teach a robot to dance using only metaphors?",
        
            "What's the most ridiculous way to cool down on a hot day?",
        
            "If you could only use 5 emojis for the rest of your life, which would it be?",
        
            "How would you describe a rainbow to someone who's never seen color?",
        
            "What's the weirdest thing you could order at a restaurant?",
        
            "If you had to replace all the wheels in the world with something else, what would it be?",
        
            "How would you explain a computer virus to a 5-year-old using only toys?",
        
            "What's the most pointless rule you could enforce at a workplace?",
        
            "If you could make any animal the size of a skyscraper, which would it be?",
        
            "How would you describe the taste of water to an alien?",
        
            "What's the worst possible way to start a conversation?",
        
            "If you could only eat food that's the color blue, what would your diet consist of?"
        ];
        return prompts[Math.floor(Math.random() * prompts.length)];
    }

    validateResponse(response, prompt) {
        if (!response || typeof response !== 'string') {
            // Log full response for Google API format errors
            if (response?.error === 'Invalid response format from Google API') {
                logger.debug('Full Google API response:', response);
            }
            return false;
        }

        const words = response.trim().split(/\s+/).filter(w => w.length > 0);
        const minWords = parseInt(process.env.HEALTH_CHECK_MIN_WORDS) || 2;
        return words.length >= minWords;
    }

    async testModel(model, attempt = 1) {
        const maxRetries = parseInt(process.env.HEALTH_CHECK_RETRIES) || 2;
        const prompt = this.getRandomPrompt();
        
        try {
            const provider = await providers.getProviderForModel(model);
            if (!provider) {
                return { status: 'error', error: 'No provider available' };
            }

            const startTime = Date.now();
            const response = await provider.chat([{
                role: 'user',
                content: prompt
            }], {
                operation: 'health',
                headers: {
                    'User-Agent': 'KoneHealthCheck/1.0'
                },
                model,
                temperature: 0.3,
                max_tokens: 50
            });
            const latency = Date.now() - startTime;

            // Extract content and log full response for debugging
            let content = '';
            
            if (response.choices?.[0]?.message?.content) {
                content = response.choices[0].message.content;
            } else if (response.choices?.[0]?.delta?.content) {
                content = response.choices[0].delta.content;
            } else if (typeof response === 'string') {
                content = response;
            } else {
                logger.debug(`Invalid response format from ${model}:`, {
                    type: typeof response,
                    structure: response ? Object.keys(response) : 'null',
                    raw: response
                });
            }

            if (!this.validateResponse(content, prompt)) {
                // Log the invalid response for debugging
                logger.debug(`Model ${model} invalid response (attempt ${attempt}/${maxRetries}):`, {
                    prompt,
                    response: content || 'null',
                    latency
                });

                // Retry if we haven't hit the limit
                if (attempt < maxRetries) {
                    logger.debug(`Retrying ${model}...`);
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
                    return this.testModel(model, attempt + 1);
                }
                
                return {
                    status: 'error',
                    latency,
                    error: `Response invalid: "${content || 'null'}" (${typeof content})`,
                    prompt,
                    response: content,
                    attempts: attempt,
                    rawResponse: response
                };
            }

            logger.debug(`Model ${model} healthy (attempt ${attempt}/${maxRetries}):`, {
                latency,
                response: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
                prompt
            });

            return {
                status: 'operational',
                latency,
                error: null,
                response: content,
                attempts: attempt
            };

        } catch (error) {
            // Retry on potentially temporary errors
            if (attempt < maxRetries && (
                error.message.includes('timeout') ||
                error.message.includes('rate limit') ||
                error.status === 429 ||
                error.status === 500 ||
                error.status === 502 ||
                error.status === 503 ||
                error.status === 504
            )) {
                logger.debug(`Model ${model} error (attempt ${attempt}/${maxRetries}), retrying...`, {
                    error: error.message,
                    status: error.status
                });
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
                return this.testModel(model, attempt + 1);
            }

            // Determine status based on error type
            let status = 'error';
            const statusCode = error.status || error.statusCode || error.code;
            if (error.message === 'Timeout') {
                status = 'unknown';
            } else if (statusCode === 429) {
                status = 'limited'; // Set status to 'limited' for rate limits
            }
            
            // Log full error details for debugging
            logger.debug(`Model ${model} failed after ${attempt} attempts:`, {
                error: error.message,
                status: statusCode,
                response: error.response || null,
                details: error.details || null,
                prompt: prompt,
                rawError: typeof error === 'object' ? JSON.stringify(error, null, 2) : error
            });
            return {
                status,
                latency: null,
                error: `${statusCode ? `[${statusCode}] ` : ''}${error.message}`,
                prompt,
                attempts: attempt
            };
        }
    }

    getStatus() {
        return Array.from(this.models.entries()).map(([model, data]) => ({
            model,
            ...data
        }));
    }

    async checkAllModels(callback) {
        // dont start a new check if one is already running
        if (this.isChecking) {
            logger.debug('Health check already in progress, skipping');
            return;
        }

        this.isChecking = true;
        this.lastCheck = Date.now();

        try {
            const allModels = await providers.getAvailableModels();
            if (!allModels?.length) {
                logger.warn('No models available for health check');
                return;
            }

            logger.info(`Starting health checks for ${allModels.length} models`);
            
            // Process models one at a time with proper delay
            const delayMs = parseInt(process.env.HEALTH_CHECK_DELAY) || 26000;
            
            for (const model of allModels) {
                if (!model?.id) continue;

                try {
                    // Wait for delay before testing next model
                    await new Promise(resolve => setTimeout(resolve, delayMs));

                    const result = await this.testModel(model.id);
                    this.models.set(model.id, {
                        ...result,
                        lastCheck: Date.now()
                    });

                    // Log the result with attempt count
                    const status = result.status === 'operational' ? 'healthy' : 'unhealthy';
                    logger.debug(`Model ${model.id} ${status} after ${result.attempts} attempt(s) - latency: ${result.latency}ms`);

                    if (callback) {
                        callback(model.id, result);
                    }
                } catch (error) {
                    logger.debug(`Health check failed for ${model.id}:`, {
                        error: error.message,
                        stack: error.stack,
                        status: error.status || error.code,
                        response: error.response || null,
                        details: error.details || null,
                        rawError: typeof error === 'object' ? JSON.stringify(error, null, 2) : error
                    });
                }
            }

            logger.info('Health check cycle completed');
        } catch (error) {
            logger.error('Health check cycle failed:', error);
        } finally {
            this.isChecking = false;
        }
    }

    stopHealthChecks() {
        if (this.checkIntervalId) {
            clearInterval(this.checkIntervalId);
            this.checkIntervalId = null;
            logger.info('Health checks stopped');
        }
    }

    startHealthChecks(callback) {
        if (this.isChecking) return;
        
        this.stopHealthChecks();
        
        // Get interval from env (in seconds) and convert to milliseconds
        const intervalSecs = parseInt(process.env.HEALTH_CHECK_INTERVAL) || 7200;
        const intervalMs = intervalSecs * 1000;
        
        // Run initial check
        this.checkAllModels(callback);

        // Set up recurring checks
        this.checkIntervalId = setInterval(() => {
            this.checkAllModels(callback);
        }, intervalMs);
    }
}

export default new HealthCheck();
