/**
 * Client-Side Analysis Engine
 * Replaces the Express /api/analysis endpoint with pure browser logic.
 * Intercepts fetch calls to /api/analysis and processes data locally.
 */

const BINANCE_BASE = 'https://fapi.binance.com/fapi/v1';

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

// --- Data Fetching ---
async function fetchKlines(symbol, interval, limit) {
  try {
    const res = await fetch(`${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.map(k => ({
      open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
      close: parseFloat(k[4]), volume: parseFloat(k[5])
    }));
  } catch (err) {
    console.warn(`Failed to fetch klines for ${symbol}:`, err);
    return [];
  }
}

// --- Main Analysis Runner ---
async function runAnalysis(params = {}) {
  const {
    minVol = 80_000_000,
    minTrades = 600_000,
    minNATR = 0,
    minVol6h = 0,
    blacklist = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT']
  } = params;

  console.log(`[Client] Starting analysis (MinVol: ${minVol}, MinTrades: ${minTrades})...`);

  const [infoRes, tickerRes] = await Promise.all([
    fetch(`${BINANCE_BASE}/exchangeInfo`).then(r => r.json()),
    fetch(`${BINANCE_BASE}/ticker/24hr`).then(r => r.json())
  ]);

  const symbolsStatus = infoRes.symbols.reduce((acc, s) => { acc[s.symbol] = s.status; return acc; }, {});
  const btcTicker = tickerRes.find(t => t.symbol === 'BTCUSDT');
  const btcVolume24h = parseFloat(btcTicker?.quoteVolume || '0');

  const [btcKlines24h, btcKlines1h] = await Promise.all([
    fetchKlines('BTCUSDT', '30m', 50),
    fetchKlines('BTCUSDT', '5m', 15)
  ]);

  const btcReturns24h = calculateReturns(btcKlines24h.map(k => k.close));
  const btcReturns1h = calculateReturns(btcKlines1h.map(k => k.close));

  const filteredSymbols = tickerRes.filter(t => {
    const vol = parseFloat(t.quoteVolume);
    const trades = parseInt(t.count);
    return t.symbol.endsWith('USDT') &&
      /^[A-Z0-9]+$/.test(t.symbol) &&
      !blacklist.some(b => t.symbol === b || t.symbol === b + 'USDT') &&
      vol >= minVol && trades >= minTrades &&
      symbolsStatus[t.symbol] === 'TRADING';
  });

  const topSymbols = filteredSymbols
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, 20);

  const results = await Promise.all(topSymbols.map(async t => {
    const symbol = t.symbol;
    const [klines30m, klines5m, klines1h] = await Promise.all([
      fetchKlines(symbol, '30m', 50),
      fetchKlines(symbol, '5m', 15),
      fetchKlines(symbol, '1h', 8)
    ]);

    const isBTC = symbol === 'BTCUSDT';
    const symReturns24h = calculateReturns(klines30m.map(k => k.close));
    const symReturns1h = calculateReturns(klines5m.map(k => k.close));

    const minLen24h = Math.min(symReturns24h.length, btcReturns24h.length);
    const corr24h = isBTC ? 1 : (minLen24h >= 30 ? correlation(symReturns24h.slice(-minLen24h), btcReturns24h.slice(-minLen24h)) : 0);

    const minLen1h = Math.min(symReturns1h.length, btcReturns1h.length);
    const corr1h = isBTC ? 1 : (minLen1h >= 10 ? correlation(symReturns1h.slice(-minLen1h), btcReturns1h.slice(-minLen1h)) : 0);

    const natr2h = calculateNATR(klines30m.map(k => k.high), klines30m.map(k => k.low), klines30m.map(k => k.close), 4);
    const vol6h = calculateParkinsonVolatility(klines1h.map(k => k.high), klines1h.map(k => k.low), 7);

    return {
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
    };
  }));

  return {
    timestamp: new Date().toISOString(),
    btcVolume24h,
    results: results
      .filter(r => r.natr2h >= minNATR && r.vol6h >= minVol6h)
      .sort((a, b) => b.change - a.change)
  };
}

// --- Fetch Interceptor (Replaces /api/analysis) ---
const originalFetch = window.fetch;
window.fetch = async function (url, options) {
  if (typeof url === 'string' && url.includes('/api/analysis')) {
    try {
      const urlObj = new URL(url, window.location.origin);
      const p = Object.fromEntries(urlObj.searchParams.entries());
      const config = {
        minVol: parseFloat(p.minVol) || 80_000_000,
        minTrades: parseInt(p.minTrades) || 600_000,
        minNATR: parseFloat(p.minNATR) || 0,
        minVol6h: parseFloat(p.minVol6h) || 0,
        blacklist: p.blacklist ? p.blacklist.split(',').map(s => s.trim().toUpperCase()).filter(s => s) : undefined
      };
      const data = await runAnalysis(config);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('[Client] Analysis error:', error);
      return new Response(JSON.stringify({ error: 'Failed to run analysis' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  return originalFetch.apply(this, arguments);
};

console.log('[Client] Serverless analysis engine loaded. /api/analysis intercepted.');