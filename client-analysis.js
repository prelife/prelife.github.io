/**
 * Client-Side Analysis Engine
 * Replaces the Express /api/analysis endpoint with pure browser logic.
 * Intercepts fetch calls to /api/analysis and processes data locally.
 * 
 * Improvements:
 * - Rate limiting to prevent API bans
 * - Request caching with TTL
 * - Input validation
 * - Request cancellation support
 * - CORS compatibility checks
 */

const BINANCE_BASE = 'https://fapi.binance.com/fapi/v1';

// --- Configuration ---
const CONFIG = {
  RATE_LIMIT_DELAY: 100, // ms between API calls
  CACHE_TTL: 60000, // 60 seconds cache TTL
  MAX_CONCURRENT_REQUESTS: 5,
  REQUEST_TIMEOUT: 10000, // 10 seconds timeout
  VALID_INTERVALS: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'],
  MAX_KLINE_LIMIT: 1000,
  MIN_KLINE_LIMIT: 1,
  VALID_SYMBOL_REGEX: /^[A-Z0-9]+USDT$/
};

// --- Rate Limiter ---
class RateLimiter {
  constructor(delayMs) {
    this.delay = delayMs;
    this.lastCallTime = 0;
  }

  async wait() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    if (timeSinceLastCall < this.delay) {
      await new Promise(resolve => setTimeout(resolve, this.delay - timeSinceLastCall));
    }
    this.lastCallTime = Date.now();
  }
}

// --- Cache Manager ---
class CacheManager {
  constructor(ttlMs) {
    this.ttl = ttlMs;
    this.cache = new Map();
  }

  generateKey(prefix, params) {
    return `${prefix}:${JSON.stringify(params)}`;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear() {
    this.cache.clear();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

// --- Request Cancellation Manager ---
class RequestManager {
  constructor() {
    this.activeRequests = new Map();
  }

  createRequest(id) {
    this.cancelRequest(id);
    const controller = new AbortController();
    this.activeRequests.set(id, controller);
    return controller;
  }

  cancelRequest(id) {
    const controller = this.activeRequests.get(id);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(id);
    }
  }

  cancelAll() {
    for (const [id, controller] of this.activeRequests.entries()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }

  isCancelled(id) {
    const controller = this.activeRequests.get(id);
    return controller?.signal.aborted ?? false;
  }
}

// Initialize managers
const rateLimiter = new RateLimiter(CONFIG.RATE_LIMIT_DELAY);
const cacheManager = new CacheManager(CONFIG.CACHE_TTL);
const requestManager = new RequestManager();

// --- Input Validation ---
function validateSymbol(symbol) {
  if (typeof symbol !== 'string' || !symbol) {
    return { valid: false, error: 'Symbol must be a non-empty string' };
  }
  if (!CONFIG.VALID_SYMBOL_REGEX.test(symbol)) {
    return { valid: false, error: `Invalid symbol format: ${symbol}. Must end with USDT and contain only A-Z, 0-9` };
  }
  return { valid: true };
}

function validateInterval(interval) {
  if (!CONFIG.VALID_INTERVALS.includes(interval)) {
    return { valid: false, error: `Invalid interval: ${interval}. Must be one of: ${CONFIG.VALID_INTERVALS.join(', ')}` };
  }
  return { valid: true };
}

function validateLimit(limit) {
  const num = parseInt(limit, 10);
  if (isNaN(num) || num < CONFIG.MIN_KLINE_LIMIT || num > CONFIG.MAX_KLINE_LIMIT) {
    return { 
      valid: false, 
      error: `Invalid limit: ${limit}. Must be between ${CONFIG.MIN_KLINE_LIMIT} and ${CONFIG.MAX_KLINE_LIMIT}` 
    };
  }
  return { valid: true, value: num };
}

function validateNumber(value, paramName, min = -Infinity, max = Infinity, defaultValue = 0) {
  if (value === undefined || value === null || value === '') {
    return { valid: true, value: defaultValue };
  }
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (isNaN(num)) {
    return { valid: false, error: `${paramName} must be a number` };
  }
  if (num < min || num > max) {
    return { valid: false, error: `${paramName} must be between ${min} and ${max}` };
  }
  return { valid: true, value: num };
}

function validateBlacklist(blacklist) {
  if (!blacklist) return { valid: true, value: [] };
  if (typeof blacklist !== 'string') {
    return { valid: false, error: 'Blacklist must be a comma-separated string' };
  }
  const items = blacklist.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
  const invalid = items.filter(item => !/^[A-Z0-9]+$/.test(item));
  if (invalid.length > 0) {
    return { valid: false, error: `Invalid blacklist items: ${invalid.join(', ')}` };
  }
  return { valid: true, value: items };
}

// --- Mathematical & Indicator Functions ---
const correlation = (x, y) => {
  const n = x.length;
  if (n !== y.length || n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    sumX += xi; sumY += yi; sumXY += xi * yi; sumX2 += xi * xi; sumY2 += yi * yi;
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / denominator));
};

const calculateReturns = (closes) => {
  if (closes.length < 2) return [];
  const returns = new Float64Array(closes.length - 1);
  for (let i = 1; i < closes.length; i++) {
    returns[i - 1] = Math.log(closes[i] / closes[i - 1]);
  }
  return Array.from(returns);
};

const calculateATR = (highs, lows, closes, period = 14) => {
  if (closes.length < period + 1) return 0;
  const tr = new Float64Array(closes.length - 1);
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i], l = lows[i], cPrev = closes[i - 1];
    tr[i - 1] = Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev));
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let atr = sum / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
};

const calculateNATR = (highs, lows, closes, period = 14) => {
  if (closes.length < period + 1) return 0;
  const atr = calculateATR(highs, lows, closes, period);
  const lastClose = closes[closes.length - 1];
  return lastClose > 0 ? (atr / lastClose) * 100 : 0;
};

const calculateParkinsonVolatility = (highs, lows, period = 14) => {
  const n = Math.min(period, highs.length, lows.length);
  if (n < 2) return 0;
  let sumSquaredLogRange = 0, validCount = 0;
  for (let i = 0; i < n; i++) {
    if (highs[i] > 0 && lows[i] > 0 && highs[i] >= lows[i]) {
      sumSquaredLogRange += Math.pow(Math.log(highs[i] / lows[i]), 2);
      validCount++;
    }
  }
  if (validCount === 0) return 0;
  const k = 4 * Math.log(2);
  const variance = sumSquaredLogRange / (k * validCount);
  return Math.sqrt(variance) * 100;
};

// --- Data Fetching with Rate Limiting, Caching, and Cancellation ---
async function fetchKlines(symbol, interval, limit, requestId = 'default') {
  // Validate inputs
  const symbolValidation = validateSymbol(symbol);
  if (!symbolValidation.valid) {
    console.warn(`[Client] Invalid symbol: ${symbolValidation.error}`);
    return [];
  }

  const intervalValidation = validateInterval(interval);
  if (!intervalValidation.valid) {
    console.warn(`[Client] Invalid interval: ${intervalValidation.error}`);
    return [];
  }

  const limitValidation = validateLimit(limit);
  if (!limitValidation.valid) {
    console.warn(`[Client] Invalid limit: ${limitValidation.error}`);
    return [];
  }
  const validatedLimit = limitValidation.value;

  // Check cache
  const cacheKey = cacheManager.generateKey('klines', { symbol, interval, limit: validatedLimit });
  const cachedData = cacheManager.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  // Check if request was cancelled
  if (requestManager.isCancelled(requestId)) {
    throw new DOMException('Request cancelled', 'AbortError');
  }

  // Rate limiting
  await rateLimiter.wait();

  // Check again after waiting (in case of cancellation during wait)
  if (requestManager.isCancelled(requestId)) {
    throw new DOMException('Request cancelled', 'AbortError');
  }

  try {
    const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${validatedLimit}`;
    
    const controller = requestManager.createRequest(requestId);
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`[Client] Rate limited by Binance. Consider increasing delay.`);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const parsedData = data.map(k => ({
      open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
      close: parseFloat(k[4]), volume: parseFloat(k[5])
    }));
    
    // Cache the result
    cacheManager.set(cacheKey, parsedData);
    
    return parsedData;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[Client] Request cancelled for ${symbol}`);
      throw err;
    }
    console.warn(`[Client] Failed to fetch klines for ${symbol}:`, err.message);
    return [];
  }
}

// Helper function to fetch exchange info and ticker with caching
async function fetchWithCache(endpoint, cacheKeyParams, requestId = 'default') {
  const cacheKey = cacheManager.generateKey(endpoint, cacheKeyParams);
  const cachedData = cacheManager.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  if (requestManager.isCancelled(requestId)) {
    throw new DOMException('Request cancelled', 'AbortError');
  }

  await rateLimiter.wait();

  if (requestManager.isCancelled(requestId)) {
    throw new DOMException('Request cancelled', 'AbortError');
  }

  try {
    const controller = requestManager.createRequest(requestId);
    const url = `${BINANCE_BASE}/${endpoint}`;
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    cacheManager.set(cacheKey, data);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err;
    }
    console.warn(`[Client] Failed to fetch ${endpoint}:`, err.message);
    throw err;
  }
}

// --- Main Analysis Runner ---
async function runAnalysis(params = {}, requestId = 'analysis-default') {
  // Validate all input parameters
  const minVolValidation = validateNumber(params.minVol, 'minVol', 0, Infinity, 80_000_000);
  if (!minVolValidation.valid) {
    throw new Error(minVolValidation.error);
  }
  const minVol = minVolValidation.value;

  const minTradesValidation = validateNumber(params.minTrades, 'minTrades', 0, Infinity, 600_000);
  if (!minTradesValidation.valid) {
    throw new Error(minTradesValidation.error);
  }
  const minTrades = minTradesValidation.value;

  const minNATRValidation = validateNumber(params.minNATR, 'minNATR', 0, 100, 0);
  if (!minNATRValidation.valid) {
    throw new Error(minNATRValidation.error);
  }
  const minNATR = minNATRValidation.value;

  const minVol6hValidation = validateNumber(params.minVol6h, 'minVol6h', 0, 100, 0);
  if (!minVol6hValidation.valid) {
    throw new Error(minVol6hValidation.error);
  }
  const minVol6h = minVol6hValidation.value;

  const blacklistValidation = validateBlacklist(params.blacklist);
  if (!blacklistValidation.valid) {
    throw new Error(blacklistValidation.error);
  }
  const blacklist = blacklistValidation.value.length > 0 
    ? blacklistValidation.value 
    : ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT'];

  console.log(`[Client] Starting analysis (MinVol: ${minVol}, MinTrades: ${minTrades})...`);

  try {
    // Fetch exchange info and ticker data with rate limiting and caching
    const [infoRes, tickerRes] = await Promise.all([
      fetchWithCache('exchangeInfo', {}, requestId),
      fetchWithCache('ticker/24hr', {}, requestId)
    ]);

    const symbolsStatus = infoRes.symbols.reduce((acc, s) => { acc[s.symbol] = s.status; return acc; }, {});
    const btcTicker = tickerRes.find(t => t.symbol === 'BTCUSDT');
    const btcVolume24h = parseFloat(btcTicker?.quoteVolume || '0');

    // Fetch BTC klines for correlation calculations
    const [btcKlines24h, btcKlines1h] = await Promise.all([
      fetchKlines('BTCUSDT', '30m', 50, requestId),
      fetchKlines('BTCUSDT', '5m', 15, requestId)
    ]);

    const btcReturns24h = calculateReturns(btcKlines24h.map(k => k.close));
    const btcReturns1h = calculateReturns(btcKlines1h.map(k => k.close));

    // Filter symbols based on criteria
    const filteredSymbols = tickerRes.filter(t => {
      const vol = parseFloat(t.quoteVolume);
      const trades = parseInt(t.count);
      return t.symbol.endsWith('USDT') &&
        /^[A-Z0-9]+$/.test(t.symbol) &&
        !blacklist.some(b => t.symbol === b || t.symbol === b + 'USDT') &&
        vol >= minVol && trades >= minTrades &&
        symbolsStatus[t.symbol] === 'TRADING';
    });

    // Get top 20 symbols by price change percent
    const topSymbols = filteredSymbols
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 20);

    console.log(`[Client] Analyzing ${topSymbols.length} symbols...`);

    // Process symbols sequentially with rate limiting instead of parallel to avoid overwhelming API
    const results = [];
    for (const t of topSymbols) {
      // Check if request was cancelled before processing each symbol
      if (requestManager.isCancelled(requestId)) {
        throw new DOMException('Analysis cancelled', 'AbortError');
      }

      const symbol = t.symbol;
      
      // Fetch klines for this symbol with rate limiting
      const [klines30m, klines5m, klines1h] = await Promise.all([
        fetchKlines(symbol, '30m', 50, requestId),
        fetchKlines(symbol, '5m', 15, requestId),
        fetchKlines(symbol, '1h', 8, requestId)
      ]);

      // Skip if we couldn't get data
      if (klines30m.length === 0 || klines5m.length === 0 || klines1h.length === 0) {
        continue;
      }

      const isBTC = symbol === 'BTCUSDT';
      const symReturns24h = calculateReturns(klines30m.map(k => k.close));
      const symReturns1h = calculateReturns(klines5m.map(k => k.close));

      const minLen24h = Math.min(symReturns24h.length, btcReturns24h.length);
      const corr24h = isBTC ? 1 : (minLen24h >= 30 ? correlation(symReturns24h.slice(-minLen24h), btcReturns24h.slice(-minLen24h)) : 0);

      const minLen1h = Math.min(symReturns1h.length, btcReturns1h.length);
      const corr1h = isBTC ? 1 : (minLen1h >= 10 ? correlation(symReturns1h.slice(-minLen1h), btcReturns1h.slice(-minLen1h)) : 0);

      const natr2h = calculateNATR(klines30m.map(k => k.high), klines30m.map(k => k.low), klines30m.map(k => k.close), 4);
      const vol6h = calculateParkinsonVolatility(klines1h.map(k => k.high), klines1h.map(k => k.low), 7);

      results.push({
        symbol,
        change: parseFloat(t.priceChangePercent),
        price: parseFloat(t.lastPrice),
        volume: parseFloat(t.quoteVolume),
        volumePct: (parseFloat(t.quoteVolume) / btcVolume24h) * 100,
        trades: parseInt(t.count),
        corr24h: corr24h * 100,
        corr1h: corr1h * 100,
        natr2h,
        vol6h,
        history: klines1h.map(k => k.close)
      });
    }

    return {
      timestamp: new Date().toISOString(),
      btcVolume24h,
      results: results
        .filter(r => r.natr2h >= minNATR && r.vol6h >= minVol6h)
        .sort((a, b) => b.change - a.change)
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[Client] Analysis cancelled by user');
      throw error;
    }
    throw error;
  }
}

// --- Fetch Interceptor (Replaces /api/analysis) ---
let currentAnalysisId = null;

const originalFetch = window.fetch;
window.fetch = async function (url, options) {
  if (typeof url === 'string' && url.includes('/api/analysis')) {
    // Cancel any ongoing analysis before starting a new one
    if (currentAnalysisId) {
      requestManager.cancelRequest(currentAnalysisId);
    }
    
    // Generate unique request ID for this analysis
    currentAnalysisId = `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const urlObj = new URL(url, window.location.origin);
      const p = Object.fromEntries(urlObj.searchParams.entries());
      
      // Validate and parse parameters
      const config = {
        minVol: p.minVol,
        minTrades: p.minTrades,
        minNATR: p.minNATR,
        minVol6h: p.minVol6h,
        blacklist: p.blacklist
      };
      
      // Run analysis with validation and request tracking
      const data = await runAnalysis(config, currentAnalysisId);
      
      // Clear current analysis ID on success
      currentAnalysisId = null;
      
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    } catch (error) {
      // Clear current analysis ID on error
      currentAnalysisId = null;
      
      if (error.name === 'AbortError') {
        console.log('[Client] Analysis was cancelled');
        return new Response(JSON.stringify({ error: 'Analysis cancelled' }), {
          status: 499,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      console.error('[Client] Analysis error:', error.message);
      return new Response(JSON.stringify({ 
        error: 'Failed to run analysis',
        message: error.message 
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
  
  // Handle CORS preflight requests
  if (typeof url === 'string' && url.includes('/api/') && options?.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });
  }
  
  return originalFetch.apply(this, arguments);
};

// Expose API for external control (e.g., cancel button in UI)
window.BinanceAnalyzer = {
  cancelAnalysis: () => {
    if (currentAnalysisId) {
      requestManager.cancelRequest(currentAnalysisId);
      console.log('[Client] Cancelling analysis...');
      return true;
    }
    return false;
  },
  clearCache: () => {
    cacheManager.clear();
    console.log('[Client] Cache cleared');
  },
  getCacheStats: () => ({
    size: cacheManager.cache.size,
    entries: Array.from(cacheManager.cache.keys())
  }),
  getConfig: () => ({ ...CONFIG })
};

// Periodic cache cleanup every 2 minutes
setInterval(() => {
  cacheManager.cleanup();
}, 120000);

console.log('[Client] Serverless analysis engine loaded. /api/analysis intercepted.');
console.log('[Client] Use window.BinanceAnalyzer.cancelAnalysis() to cancel ongoing analysis');