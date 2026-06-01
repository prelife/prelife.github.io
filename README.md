# Futures Grid

Real-time analysis dashboard for Binance USDT-margined futures markets. Identifies coins decoupling from Bitcoin, exhibiting high relative volatility, or experiencing sudden price spikes — all from your browser, no backend required.

[![React 18](https://img.shields.io/badge/React-18.3-61dafb?style=flat&logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5.4-646cff?style=flat&logo=vite)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06b6d4?style=flat&logo=tailwindcss)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat)](LICENSE)

🌐 **Live**: [prelife.github.io](https://prelife.github.io/)

## Features

### Real-Time Data
- **Live WebSocket** — Real-time price, change, and funding rate updates via Binance streaming API. Updates batched with `requestAnimationFrame` to avoid render storms across 200+ symbols. Auto-reconnect with exponential backoff, heartbeat monitoring, and visibility-aware pause/resume. On reconnect, recent 1m klines are replayed through spike/activity detectors so no moves are missed during brief disconnects.
- **Kline WebSocket** — Live candlestick streaming for the interactive chart. Candles update in real-time without polling.
- **Activity Score** — Composite metric (0–100) of price velocity and tick density over a 30s rolling window. Higher values signal momentum and attention.
- **Funding Rate** — Live from `/premiumIndex` endpoint. Color-coded: green = longs pay shorts, red = shorts pay longs, gray = near zero (±0.01%). Per-symbol `HH:MM:SS` countdown to next funding event. Sortable column.
- **Stats Panel** — Toggleable panel showing real-time API request weight usage, qualifying symbol count, BTC reference volume, and last execution time. Rate limit warning banner appears when usage exceeds 85% of the per-minute budget, automatically deferring new analysis cycles.

### Spike Detection
- Alerts on sudden price moves within a configurable rolling window (default 1 min, 1.5% threshold).
- **Locked baseline** — captures the median price at spike onset to prevent premature clears.
- **Hysteresis** — requires price to fall below 80% of threshold for confirmation.
- **Grace period** — 10s delay after resolution before clearing, avoiding flicker.
- **Velocity** — peak %/sec of the spike move (stable, does not decay as spike ages).
- **Volume confirmation** — peak tick volume vs rolling median ratio (≥3.0 = high conviction, ≥10.0 = extreme).

### BTC Correlation
- **Pearson coefficient** over 24h (287 return pairs from 288 × 5m candles) and 1h (11 return pairs from last 12 × 5m candles) windows.
- Computed via Welford's numerically stable online algorithm.
- **P-value significance** — two-tailed p-value via numerical integration of Student's t-distribution (tanh-sinh quadrature). Marks correlations with insufficient statistical confidence (p > 0.05) with †.
- Index-aligned log returns prevent temporal misalignment from independent zero-close skips.

### Volatility
- **NATR (2h)** — Normalized Average True Range using Wilder's smoothing over 48 × 5m candles.
- **6h Range** — Direct high-low price range over 72 × 5m candles. No model assumptions.

### Interactive Candlestick Charts
Powered by [`lightweight-charts`](https://github.com/tradingview/lightweight-charts) with drawing tools via [`lightweight-charts-drawing`](https://github.com/kuxleo/lightweight-charts-drawing) and [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand):
- **Multiple timeframes**: 1m, 5m, 15m, 1h, 4h, 1d
- **Drawing tools**: trend lines, horizontal rays (clean, no dots/arrowheads), vertical lines, rectangles, rotated rectangles, date-price ranges, text annotations, freehand
- **Cross-timeframe drawing persistence** — lossless anchor snapping via `_originalAnchors` (drawings survive timeframe changes and sessions)
- **Custom timezone support** — IANA timezone picker with live DST-aware UTC offsets. Chart axis ticks and crosshair labels always match the selected timezone.
- **Historical lazy-loading** — scroll left to load more candles (up to 1500 per API call), with 500 future whitespace candles for drawing anchoring

### Sparklines
- **Price Trend (24h)** — 24 hourly closes derived from 5m candles (every 12th close). Green = uptrend, red = downtrend.
- **Volume (14d)** — Daily quote volume bars.
- **Open Interest (14d)** — Daily OI bars with flow analysis. Green = new positions, red = unwinding.
- **OI Flow (σ)** — Composite z-score blending level anomaly (60%) and change acceleration (40%), using median + MAD for outlier resistance.

### RWA Detection
Identifies Binance TradFi Perpetual contracts (tokenized real-world assets) and badges them in the table.

### Internationalization
Translations for **English, Spanish (Español), Russian (Русский), and Chinese (中文)**. Lazy-loaded via dynamic `import()`. Covers table columns, tooltips, about modal, cookie notice, and footer.

### CJK Symbol Support
Symbols with non-Latin characters (Chinese, Japanese, Korean, etc.) are correctly filtered, displayed, and exported. System-level CJK font fallbacks (`Noto Sans CJK`, `Microsoft YaHei`, `Hiragino Sans`) ensure correct rendering across all platforms. CSV exports include a UTF-8 BOM for correct Excel compatibility.

### Interface
- **Table-only mode** — Toggle the header button to hide both the header bar and the config status line, maximizing table viewport. A floating restore button appears for quick access.
- **Cookie consent gate** — GDPR-compliant gate before any API calls. Cannot be dismissed with Escape — user must explicitly accept or leave. Language picker in the header lets you switch translations before accepting.
- **Toast notifications** — Non-intrusive feedback for copying symbols, blacklisting, and CSV export. Uses `aria-live="polite"` for screen reader support.
- **Modal accessibility** — Focus trap and keyboard navigation in all modals. Escape closes settings and about dialogs.

### Utilities
- **CSV Export** — Download full analysis results with all metrics and sparkline data. UTF-8 BOM for correct Excel compatibility.
- **Symbol Blacklist** — Hide majors and stables from analysis. Default: ETH, BNB, XRP, SOL, ADA, DOGE, SUI, XAU, 1000PEPE.
- **Dark/Light Theme** — Persisted to localStorage.
- **PWA (Progressive Web App)** — Installable on supported browsers (add to home screen, standalone mode). Service worker caches the app shell for instant offline loads; API calls are never cached. Auto-updates in the background.
- **Offline Banner** — Graceful degradation when connectivity is lost.
- **Error Boundary** — Catches render errors with recovery UI instead of white-screen.

## Settings

| Setting | Default | Description |
|---|---|---|
| Minimum Volume | $50M | Filter by 24h quoted volume (USDT) |
| Minimum Trades | 600K | Filter by 24h trade count |
| Minimum NATR | 0% | Filter by Normalized Average True Range (2h) |
| Minimum Vol 6h | 0% | Filter by 6h high-low price range |
| Refresh Interval | 3 min | How often the analysis re-runs (minimum enforced) |
| Spike Threshold | 1.5% | Alert when price moves by this % within the spike window |
| Spike Window | 1 min | Rolling window for spike detection |
| Default Timeframe | 1m | Chart default timeframe |
| Chart Candles | 300 | Initial candle count (1–1500) |
| Timezone | Local | Chart timezone (browser local or IANA string) |
| Language | English | UI language (en, es, ru, zh) |

Settings are versioned (currently v9) with automatic migration through a pure-function pipeline.

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

Deploy the `dist/` directory to any static hosting (GitHub Pages, Netlify, Vercel, Cloudflare Pages).

## Tests

```bash
npm test            # run once
npm run test:watch  # watch mode
```

Test suite: `analysis`, `math` (correlation, NATR, p-value), `cache` (L1/L2), `drawingStore`, `anchorSnap`, `t_upper_tail`, `drawingPerf.bench`.

## Architecture

```
src/
├── api.js              # Binance REST client with retry, rate-limit manager, kline fetcher
├── analysis.js         # Core analysis pipeline (batched, abortable, cached)
├── cache.js            # Two-tier cache: L1 in-memory LRU + L2 IndexedDB with TTL eviction
├── config.js           # Central configuration (endpoints, limits, timing)
├── constants.js        # Settings schema (v9), column labels, tooltips, migrations
├── db.js               # IndexedDB layer (drawings, klines, analysis stores)
├── drawingStore.js     # Cross-timeframe drawing persistence with lossless anchor snapping
├── i18n.js             # Lightweight localization (4 languages, lazy-loaded)
├── math.js             # Correlation, NATR, OI flow, p-value (t-distribution, tanh-sinh)
├── timezone.js         # IANA timezone formatters for charts
├── components/         # React UI (DataTable, CandleChart, Header, Settings, etc.)
├── hooks/              # Custom hooks (useWebSocket, useAnalysis, useKlineData, etc.)
└── __tests__/          # Unit tests + benchmarks (Vitest + jsdom)
```

### Data Flow

```
Binance REST API ──→ runAnalysis() ──→ DataTable (static metrics)
                              │
Binance WebSocket ──→ useWebSocket() ──→ livePrices + spikeAlerts + activity
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              Spike Detection    Activity Score
              (locked baseline)   (velocity × tick density)

Binance Kline WS ──→ useKlineWebSocket() ──→ CandleChart (live candles)
```

### Key Design Decisions
- **Single 5m kline fetch** serves 4 consumers (24h corr, 1h corr, NATR, 6h range) — no redundant API calls.
- **Batched analysis** (5 concurrent requests per batch, 250ms between batches) smooths API bursts and avoids 429s.
- **Rate limit safety margin** — analysis cycles auto-defer when estimated weight exceeds 85% of the per-minute budget, with a visible warning banner in the stats panel.
- **Client-side rate limiter** tracks Binance request weights since CORS blocks `X-MBX-USED-WEIGHT` headers. Serialized capacity checks prevent overshoot.
- **AbortController** cancels in-flight requests on re-analysis, preventing stale data races.
- **Two-tier caching** — L1 in-memory LRU (500 entries, 24h TTL) + L2 IndexedDB with TTL eviction and quota-exceeded auto-suppression.
- **rAF-batched WebSocket updates** — coalesces 1000+ ticks/sec into single state updates per frame.
- **Structural sort sharing** — reuses index arrays and skips re-sort when order hasn't changed.
- **Reconnect gap backfill** — on WebSocket reconnect, recent 1m klines are fetched and replayed through spike/activity detectors so no moves are missed during disconnect windows.
- **Event dedup** — Binance can send duplicate `@ticker` messages (especially during reconnect). Deduplicated by `ticker.T` event timestamp.
- **Debounced settings persistence** — localStorage writes throttled to 1s to avoid synchronous I/O on every slider/keystroke in the settings modal.

## Tech Stack

- **Framework**: React 18 + Vite 5
- **Styling**: Tailwind CSS 3 (CSS custom properties for theming)
- **Charts**: lightweight-charts + lightweight-charts-drawing
- **Icons**: Lucide React
- **Storage**: IndexedDB (via `idb`)
- **Freehand drawing**: perfect-freehand
- **PWA**: vite-plugin-pwa
- **Testing**: Vitest + jsdom
- **Linting**: ESLint + React Hooks plugin
- **Fonts**: Inter (sans) + JetBrains Mono (mono) + CJK system fallbacks (Noto Sans CJK, YaHei, Hiragino Sans)

## Disclaimer

This is an **unofficial, third-party tool** not affiliated with, endorsed by, or connected to Binance or any of its subsidiaries.

This tool makes direct API calls to Binance from your browser. Excessive requests may cause Binance to temporarily rate-limit your IP address. Use at your own risk.

Binance is a trademark of Binance Holdings Ltd.
