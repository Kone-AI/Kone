// stats.js - tracking stuff without going crazy
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// setup dirname for esm
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// stats file location
const statsFile = path.join(__dirname, '../../data/stats.json');

// make sure data directory exists
const dataDir = path.dirname(statsFile);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// initialize stats object
let stats = {
  startTime: Date.now(),
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  providers: {}
};

// load stats if they exist
try {
  if (fs.existsSync(statsFile)) {
    const data = fs.readFileSync(statsFile, 'utf8');
    stats = JSON.parse(data);
    // always update start time on load
    stats.startTime = Date.now();
  }
} catch (error) {
  console.error('failed to load stats:', error);
}

// save stats to disk
const saveStats = () => {
  if (process.env.ENABLE_STATS !== 'true') return;
  
  try {
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error('failed to save stats:', error);
  }
};

// auto-save every 5 minutes
const SAVE_INTERVAL = 5 * 60 * 1000;
setInterval(saveStats, SAVE_INTERVAL);

// save on process exit
process.on('SIGINT', () => {
  saveStats();
  process.exit();
});

process.on('SIGTERM', () => {
  saveStats();
  process.exit();
});

// track api interaction
export const trackInteraction = async ({
  requestId,
  provider,
  model,
  messages,
  response,
  error,
  startTime
}) => {
  if (process.env.ENABLE_STATS !== 'true') return;

  stats.totalRequests++;

  // initialize provider stats
  if (!stats.providers[provider]) {
    stats.providers[provider] = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      models: {},
      lastRequest: null,
      averageLatency: 0
    };
  }

  // initialize model stats
  if (!stats.providers[provider].models[model]) {
    stats.providers[provider].models[model] = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      averageLatency: 0,
      lastRequest: null
    };
  }

  const providerStats = stats.providers[provider];
  const modelStats = providerStats.models[model];

  providerStats.totalRequests++;
  modelStats.totalRequests++;

  // calculate latency
  const latency = Date.now() - startTime;
  modelStats.averageLatency = (modelStats.averageLatency * (modelStats.totalRequests - 1) + latency) / modelStats.totalRequests;
  providerStats.averageLatency = (providerStats.averageLatency * (providerStats.totalRequests - 1) + latency) / providerStats.totalRequests;

  if (error) {
    stats.failedRequests++;
    providerStats.failedRequests++;
    modelStats.failedRequests++;
  } else {
    stats.successfulRequests++;
    providerStats.successfulRequests++;
    modelStats.successfulRequests++;

    // try to get token counts
    if (response?.usage?.total_tokens) {
      modelStats.totalTokens += response.usage.total_tokens;
    }
  }

  // update timestamps
  const now = Date.now();
  providerStats.lastRequest = now;
  modelStats.lastRequest = now;

  // save after each interaction
  saveStats();
};

// get current stats
export const getStats = () => {
  if (process.env.ENABLE_STATS !== 'true') {
    return { enabled: false };
  }

  const uptime = Date.now() - stats.startTime;

  return {
    enabled: true,
    uptime,
    stats: {
      ...stats,
      successRate: stats.totalRequests > 0
        ? (stats.successfulRequests / stats.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      requestsPerMinute: stats.totalRequests > 0
        ? ((stats.totalRequests / uptime) * 60000).toFixed(2)
        : '0'
    }
  };
};