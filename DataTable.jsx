import { RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Copy, Ban, Zap, ArrowUpDown, ArrowUp, ArrowDown, Activity, BarChart3, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { LIVE_PRICE_FIELDS } from '../constants';
import { formatCurrency, formatNumberM } from '../math';
import { useTranslation } from '../hooks/useTranslation';
const fmt2 = (v) => (v == null || !isFinite(v)) ? 'N/A' : Number(v).toFixed(2);

const TABLE_COLUMN_COUNT = 13; // symbol, change, activity, volume, 14d vol, trades, 14d OI, corr24h, corr1h, natr2h, vol6h, 24h trend, 5m spike
const CORRELATION_THRESHOLD = 50;
const CORRELATION_ALPHA_STRONG = 0.3;
const CORRELATION_ALPHA_WEAK = 0.2;

function SortIcon({ column, sortConfig }) {
  if (sortConfig.key !== column) return <ArrowUpDown size={12} className="opacity-30" />;
  return sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />;
}

function getCorrColor(val, theme) {
  if (val == null) return 'transparent';
  const abs = Math.abs(val);
  if (abs < CORRELATION_THRESHOLD) {
    const i = (CORRELATION_THRESHOLD - abs) / CORRELATION_THRESHOLD;
    return theme === 'dark'
      ? `rgba(16,185,129,${i * CORRELATION_ALPHA_STRONG})`
      : `rgba(5,150,105,${i * CORRELATION_ALPHA_WEAK})`;
  }
  const i = (abs - CORRELATION_THRESHOLD) / CORRELATION_THRESHOLD;
  return theme === 'dark'
    ? `rgba(239,68,68,${i * CORRELATION_ALPHA_STRONG})`
    : `rgba(220,38,38,${i * CORRELATION_ALPHA_WEAK})`;
}

/**
 * Activity score color — smooth gradient from muted (dead) → amber (moderate) → green (explosive).
 */
function getActivityColor(score) {
  if (score == null || score === 0) return 'var(--color-text-muted)';
  const t = Math.min(score / 60, 1); // 0–60 maps to full gradient, 60+ is max green
  // Interpolate: #6B7280 (muted) → #F59E0B (amber, t=0.3) → #10B981 (green, t=1)
  if (t < 0.5) {
    const u = t / 0.5;
    const r = Math.round(107 + (245 - 107) * u);
    const g = Math.round(114 + (158 - 114) * u);
    const b = Math.round(128 + (11 - 128) * u);
    return `rgb(${r},${g},${b})`;
  } else {
    const u = (t - 0.5) / 0.5;
    const r = Math.round(245 + (16 - 245) * u);
    const g = Math.round(158 + (185 - 158) * u);
    const b = Math.round(11 + (129 - 11) * u);
    return `rgb(${r},${g},${b})`;
  }
}



/**
 * 14-day volume sparkline — bar chart showing daily quote volume.
 * Bars are colored by relative height: muted for low, amber for mid, green for high.
 */
function VolumeSparkline({ data }) {
  const maxVol = Math.max(...data, 1);
  const n = data.length;
  const barW = 6;
  const gap = 1;
  const svgW = 100; // fixed viewBox width so bars always render same thickness
  const contentW = n * (barW + gap) - gap;
  const offsetX = svgW - contentW; // right-align so latest bar is always in same spot
  return (
    <ResponsiveContainer width="99%" height={40} minWidth={0}>
      <svg width="100%" height="40" viewBox={`0 0 ${svgW} 40`} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        {data.map((v, i) => {
          const h = Math.max(1, (v / maxVol) * 36);
          const x = offsetX + i * (barW + gap);
          const fill = i > 0 && v > data[i - 1]
            ? 'var(--color-up)'
            : i > 0 && v < data[i - 1]
              ? 'var(--color-down)'
              : 'var(--color-text-muted)';
          return <rect key={i} x={x} y={40 - h} width={barW} height={h} fill={fill} rx={0.5} opacity={0.85} />;
        })}
      </svg>
    </ResponsiveContainer>
  );
}

/**
 * 14-day open interest sparkline — directional bars showing daily OI levels.
 * Green = OI increased vs prior day (new positions entering),
 * Red = OI decreased (positions unwinding),
 * Muted = unchanged.
 * Bar height encodes absolute OI level relative to the 14d max.
 */
function OpenInterestSparkline({ data }) {
  const maxOi = Math.max(...data, 1);
  const n = data.length;
  const barW = 6;
  const gap = 1;
  const svgW = 100;
  const contentW = n * (barW + gap) - gap;
  const offsetX = svgW - contentW;
  return (
    <ResponsiveContainer width="99%" height={40} minWidth={0}>
      <svg width="100%" height="40" viewBox={`0 0 ${svgW} 40`} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        {data.map((v, i) => {
          const h = Math.max(1, (v / maxOi) * 36);
          const x = offsetX + i * (barW + gap);
          const fill = i > 0 && v > data[i - 1]
            ? 'var(--color-up)'
            : i > 0 && v < data[i - 1]
              ? 'var(--color-down)'
              : 'var(--color-text-muted)';
          return <rect key={i} x={x} y={40 - h} width={barW} height={h} fill={fill} rx={0.5} opacity={0.85} />;
        })}
      </svg>
    </ResponsiveContainer>
  );
}

/**
 * Activity score cell with glow effect for high values.
 */
function ActivityCell({ score, tooltip }) {
  // During warm-up computeActivityScore returns null — show 0.00 so the column
  // renders immediately instead of waiting for the first non-null score.
  if (score == null) {
    return <span className="text-text-muted font-bold tabular-nums">0.00</span>;
  }
  const color = getActivityColor(score);
  const isHot = score >= 35;
  return (
    <span
      className="font-bold tabular-nums"
      style={{
        color,
        textShadow: isHot ? `0 0 8px ${color}80` : 'none',
      }}
      title={tooltip}
    >
      {score.toFixed(2)}
    </span>
  );
}

export function DataTable({ data, loading, error, failedSymbols, sortedResults, sortConfig, livePrices, spikeAlerts, spikeWindowMinutes, theme, lang, onSort, onCopy, onBlacklist, onRetry }) {
  const t = useTranslation(lang);
  return (
    <div className="table-container flex-1 min-h-[600px] shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('symbol')} title={t('tip.symbol')}>
                Trading Symbol
                <SortIcon column="symbol" sortConfig={sortConfig} />
              </th>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('change')} title={t('tip.change')}>
                24h Price<br/>Change %
                <SortIcon column="change" sortConfig={sortConfig} />
              </th>
              <th className="w-[100px]" title={t('tip.trend')}>
                <span className="flex items-center justify-center gap-1">
                  24h Price<br/>Trend
                  <TrendingUp size={11} className="opacity-40" />
                </span>
              </th>
              <th className="w-[90px] text-center group/act relative cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('activity')} title={t('tip.activity')}>
                <span className="flex items-center justify-center gap-1">
                  Activity
                  <Activity size={11} className="opacity-40" />
                  <SortIcon column="activity" sortConfig={sortConfig} />
                </span>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-52 p-2 bg-gray-900 text-white text-[10px] rounded opacity-0 group-hover/act:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                  {t('tip.activity')}
                </span>
              </th>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('volume')} title={t('tip.volume')}>
                24h<br/>Volume
                <SortIcon column="volume" sortConfig={sortConfig} />
              </th>
              <th className="w-[100px]" title={t('tip.volume14d')}>
                <span className="flex items-center justify-center gap-1">
                  14d<br/>Volume
                  <BarChart3 size={11} className="opacity-40" />
                </span>
              </th>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('trades')} title={t('tip.trades')}>
                24h Trade<br/>Count
                <SortIcon column="trades" sortConfig={sortConfig} />
              </th>
              <th className="w-[100px]" title={t('tip.oi14d')}>
                <span className="flex items-center justify-center gap-1">
                  14d<br/>OI
                  <BarChart3 size={11} className="opacity-40" />
                </span>
              </th>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('corr24h')} title={t('tip.corr24h')}>
                24h BTC<br/>Correlation
                <SortIcon column="corr24h" sortConfig={sortConfig} />
              </th>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('corr1h')} title={t('tip.corr1h')}>
                1h BTC<br/>Correlation
                <SortIcon column="corr1h" sortConfig={sortConfig} />
              </th>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('natr2h')} title={t('tip.natr2h')}>
                2h<br/>NATR
                <SortIcon column="natr2h" sortConfig={sortConfig} />
              </th>
              <th className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors" onClick={() => onSort('vol6h')} title={t('tip.vol6h')}>
                6h<br/>Volatility
                <SortIcon column="vol6h" sortConfig={sortConfig} />
              </th>
              <th className="w-[80px] text-center" title={t('tip.spike')}>
                <span className="flex items-center justify-center gap-1">
                  Spike
                  <Zap size={11} className="opacity-40" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {loading && !data ? (
                <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <td colSpan={TABLE_COLUMN_COUNT} className="text-center py-20">
                    <div className="flex flex-col items-center gap-4">
                      <RefreshCw className="animate-spin text-accent" size={32} />
                      <p className="text-text-muted font-sans">{t('table.loading')}</p>
                    </div>
                  </td>
                </motion.tr>
              ) : error ? (
                <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <td colSpan={TABLE_COLUMN_COUNT} className="text-center py-20">
                    <div className="flex flex-col items-center gap-4 text-down">
                      <AlertTriangle size={32} />
                      <p className="font-sans font-medium">{error}</p>
                      {failedSymbols.length > 0 && (
                        <div className="text-left bg-red-900/10 border border-red-500/30 rounded-lg p-4 max-w-lg w-full">
                          <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">
                            {t('table.failedTitle')} ({failedSymbols.length})
                          </p>
                          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                            {failedSymbols.map((fs, i) => (
                              <div key={fs.symbol || i} className="flex justify-between items-center text-xs">
                                <span className="font-mono font-bold text-red-300">{fs.symbol}</span>
                                <span className="text-red-400/80 text-right max-w-[200px] truncate">
                                  {typeof fs.error === 'string' ? fs.error : fs.error?.message || String(fs.error)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={onRetry}
                        className="px-4 py-2 bg-accent text-white rounded-md text-sm font-sans hover:bg-blue-700 transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ) : (
                sortedResults.map(row => {
                  const live = livePrices[row.symbol] || Object.fromEntries(
                    Object.entries(LIVE_PRICE_FIELDS).map(([k, f]) => [f.key, row[f.key] ?? f.default])
                  );
                  const spikeAlert = spikeAlerts[row.symbol];
                  const isUp = live.change >= 0;

                  return (
                    <motion.tr
                      key={row.symbol}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onClick={() => onCopy(row.symbol)}
                      className={`hover:bg-[#F9FAFB] dark:hover:bg-slate-700/50 transition-colors group cursor-pointer ${spikeAlert ? 'bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500' : ''}`}
                    >
                      <td className="sym-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between gap-2 group/sym">
                          <div className="flex flex-col cursor-pointer" onClick={() => onCopy(row.symbol)}>
                            <span className="dark:text-blue-400 flex items-center gap-2">
                              {row.symbol}
                              <Copy size={12} className="opacity-0 group-hover/sym:opacity-50 transition-opacity" />
                            </span>
                            {row.incomplete && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-sans font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5" title={t('tip.incomplete')}>
                                <AlertCircle size={10} />{t('table.incomplete')}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => onBlacklist(row.symbol)}
                            title={`Blacklist ${row.symbol}`}
                            className="p-1.5 hover:bg-red-500/10 text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={`Blacklist ${row.symbol}`}
                          >
                            <Ban size={14} />
                          </button>
                        </div>
                      </td>
                      <td className={isUp ? 'up' : 'down'}>
                        <div className="flex items-center gap-1 font-bold">
                          {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          {isUp ? '+' : ''}{fmt2(live.change)}%
                        </div>
                      </td>
                      <td className="p-0">
                        <div className="h-10 w-full min-w-0 relative overflow-hidden">
                          {row.history.length > 0 && (
                            <ResponsiveContainer width="99%" height={40} minWidth={0}>
                              <LineChart data={row.history.map((v, i) => ({ v, i }))}>
                                <YAxis hide domain={['dataMin', 'dataMax']} />
                                <Line
                                  type="monotone"
                                  dataKey="v"
                                  stroke={isUp ? '#10B981' : '#EF4444'}
                                  strokeWidth={1.5}
                                  dot={false}
                                  isAnimationActive={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </td>
                      <td className="text-center">
                        <ActivityCell score={live.activity} tooltip={t('tip.activityCell')} />
                      </td>
                      <td>{formatCurrency(row.volume)}</td>
                      <td className="p-0">
                        <div className="h-10 w-full min-w-0 relative overflow-hidden">
                          {row.volumeHistory && row.volumeHistory.length >= 2 && (
                            <VolumeSparkline data={row.volumeHistory.slice(-14)} />
                          )}
                        </div>
                      </td>
                      <td>{formatNumberM(row.trades)}</td>
                      <td className="p-0">
                        <div className="h-10 w-full min-w-0 relative overflow-hidden">
                          {row.oiHistory && row.oiHistory.length >= 2 && (
                            <OpenInterestSparkline data={row.oiHistory.slice(-14)} />
                          )}
                        </div>
                      </td>
                      <td style={{ backgroundColor: getCorrColor(row.corr24h, theme) }} className={`font-bold ${row.corr24h == null ? 'text-text-muted' : ''}`}>
                        {row.corr24h != null ? fmt2(row.corr24h) + '%' : '—'}
                      </td>
                      <td style={{ backgroundColor: getCorrColor(row.corr1h, theme) }} className={`font-bold ${row.corr1h == null ? 'text-text-muted' : ''}`}>
                        {row.corr1h != null ? fmt2(row.corr1h) + '%' : '—'}
                      </td>
                      <td className={row.natr2h == null ? 'text-text-muted' : ''}>
                        {row.natr2h != null ? fmt2(row.natr2h) + '%' : '—'}
                      </td>
                      <td className={row.vol6h == null ? 'text-text-muted' : ''}>
                        {row.vol6h != null ? fmt2(row.vol6h) + '%' : '—'}
                      </td>
                      <td className="text-center">
                        <div className="h-10 flex items-center justify-center">
                          {spikeAlert ? (
                            <div className="flex flex-col items-center gap-px text-yellow-600 dark:text-yellow-400 font-bold">
                              <div className="flex items-center gap-1">
                                <Zap size={14} className="fill-current" />
                                <span>{fmt2(spikeAlert.spike)}%</span>
                              </div>
                              <span className="text-[10px] font-normal" style={{ color: spikeAlert.direction === 'up' ? '#10B981' : '#EF4444' }}>
                                {spikeAlert.direction === 'up' ? '▲' : '▼'}
                              </span>
                              <span className="text-[9px] font-normal text-text-muted">
                                {Math.floor((Date.now() - spikeAlert.timestamp) / 60000)}m ago
                              </span>
                            </div>
                          ) : (
                            <span className="text-text-muted text-xs">-</span>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );
}
