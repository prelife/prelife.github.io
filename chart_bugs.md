Code Review — Chart & UI Bug Analysis                                                      
                                                                                            
 ### CRITICAL BUGS                                                                          
                                                                                            
 #### 1. Whitespace candles corrupt series.data() after loadMore() — causes duplicate/gap   
 candles                                                                                    
                                                                                            
 File: useKlineData.js → loadMore() (line ~115)                                             
                                                                                            
 ```js                                                                                      
   const realData = dataRef.current.filter(d => d.open != null);                            
   const merged = [...dedupedOlder, ...realData];                                           
   setData(appendWhitespace(merged, interval));                                             
 ```                                                                                        
                                                                                            
 Problem: After loadMore(), the whitespace tail is re-appended from the last real candle.   
 But dataRef.current still contains the old whitespace tail (which starts from the old last 
 candle). The filter d.open != null correctly strips old whitespace. However, if loadMore() 
  is called rapidly (race condition), dataRef.current may have already been updated by a    
 previous loadMore() completion, causing the new whitespace to start from an                
 already-extended position, creating a gap between real candles and whitespace.             
                                                                                            
 Impact: Visible gap in chart where timeToCoordinate() returns null for the gap region.     
 Drawing anchors placed in the gap become invisible.                                        
                                                                                            
 Fix: Use the actual last real candle time from merged, not from dataRef.current:           
                                                                                            
 ```js                                                                                      
   const lastReal = merged[merged.length - 1];                                              
   setData(appendWhitespace(merged, interval));                                             
 ```                                                                                        
                                                                                            
 Actually appendWhitespace reads from its input, so this is already correct. The real race  
 is in loadingRef — it guards against concurrent calls, so this is low risk. Still, the     
 dedup boundary check uses dataRef.current[0].time which could be stale if a second         
 loadMore() fires after the first setData but before the first loadingRef.current = false.  
                                                                                            
 #### 2. series.update() with historicalUpdate: true can corrupt the last candle            
                                                                                            
 File: CandleChart.jsx (line ~1095)                                                         
                                                                                            
 ```js                                                                                      
   seriesRef.current.update({                                                               
     time: last.time,                                                                       
     open: last.open,                                                                       
     high: Math.max(last.high, price),                                                      
     low:  Math.min(last.low,  price),                                                      
     close: price,                                                                          
   }, true);                                                                                
 ```                                                                                        
                                                                                            
 Problem: The historicalUpdate: true flag bypasses lightweight-charts' lastSeriesTime       
 check. This is needed because whitespace tail points push lastSeriesTime into the future.  
 However, if livePrice arrives for a candle that has already closed (e.g., during a slow    
 reconnect or stale WS data), this silently overwrites a completed candle's OHLC. The chart 
 shows a corrupted candle with a close price from the future.                               
                                                                                            
 Impact: Candle body/wick extends incorrectly. No visual indicator that data is stale.      
                                                                                            
 Fix: Add a time-boundary check:                                                            
                                                                                            
 ```js                                                                                      
   const currentUnixTime = Math.floor(Date.now() / 1000);                                   
   const candleInterval = INTERVAL_SECONDS[tfRef.current] || 60;                            
   const candleOpenTime = last.time;                                                        
   const candleCloseTime = candleOpenTime + candleInterval;                                 
   // Only update if we're still within the current candle's time window (+1s grace)        
   if (currentUnixTime < candleCloseTime + 1) {                                             
     seriesRef.current.update({ ... }, true);                                               
   }                                                                                        
 ```                                                                                        
                                                                                            
 #### 3. Volume color mismatch after theme change                                           
                                                                                            
 File: CandleChart.jsx (line ~1230)                                                         
                                                                                            
 ```js                                                                                      
   const colored = data.map(d => ({                                                         
     ...d,                                                                                  
     color: d.value >= 0                                                                    
       ? (isDark ? 'rgba(52,211,153,0.4)' : 'rgba(5,150,105,0.4)')                          
       : (isDark ? 'rgba(248,113,113,0.4)' : 'rgba(220,38,38,0.4)'),                        
   }));                                                                                     
 ```                                                                                        
                                                                                            
 Problem: Volume bars are colored by d.value >= 0 (always true for volume). The original    
 setData correctly colors by k.close >= k.open. On theme change, all volume bars become     
 green because volume is always ≥ 0.                                                        
                                                                                            
 Impact: After toggling theme, all volume bars lose their up/down coloring and render       
 uniformly green.                                                                           
                                                                                            
 Fix: Store the original color or re-derive from candle data. The cleanest fix: read the    
 candle series data alongside volume data to re-derive colors:                              
                                                                                            
 ```js                                                                                      
   const candles = seriesRef.current.data();                                                
   const colored = data.map((d, i) => {                                                     
     const candle = candles?.[i];                                                           
     const isUp = candle ? candle.close >= candle.open : d.color?.includes('52,211,153');   
     return { ...d, color: isUp                                                             
       ? (isDark ? 'rgba(52,211,153,0.4)' : 'rgba(5,150,105,0.4)')                          
       : (isDark ? 'rgba(248,113,113,0.4)' : 'rgba(220,38,38,0.4)') };                      
   });                                                                                      
 ```                                                                                        
                                                                                            
 ### SIGNIFICANT BUGS                                                                       
                                                                                            
 #### 4. Timeframe switch race: anchor snapping runs before setData() completes             
                                                                                            
 File: CandleChart.jsx (line ~1388)                                                         
                                                                                            
 ```js                                                                                      
   requestAnimationFrame(() => {                                                            
     // snap anchors...                                                                     
   });                                                                                      
 ```                                                                                        
                                                                                            
 Problem: The anchor-snapping rAF fires in the timeframe-change effect. The setData()       
 effect also fires on the same render (triggered by klines changing). React batches effects 
 in declaration order, but the klines effect and the timeframe effect are separate          
 useEffect calls. The klines effect runs first (declared first), but setData() is           
 synchronous — the data is set. However, if the klines array hasn't changed yet (fetch      
 still in-flight when timeframe changes), the snapping runs against stale data from the     
 previous timeframe.                                                                        
                                                                                            
 Impact: Drawings snap to wrong candles or become invisible after timeframe switch during   
 slow network.                                                                              
                                                                                            
 Mitigation already present: The renderedTimeframeRef gate in the klines effect prevents    
 stale data from being rendered. But the snapping rAF doesn't check this ref.               
                                                                                            
 #### 5. nearestTime binary search has an off-by-one edge case                              
                                                                                            
 File: CandleChart.jsx (line ~1408)                                                         
                                                                                            
 ```js                                                                                      
   if (lo === times.length - 1 && times[lo] >= target) {                                    
     return Math.abs(times[lo] - target) < Math.abs(times[lo - 1] - target) ? times[lo] :   
 times[lo - 1];                                                                             
   }                                                                                        
 ```                                                                                        
                                                                                            
 Problem: When lo === 0 && lo === times.length - 1 (single-element array), times[lo - 1] is 
 undefined. The condition lo === 0 is checked first, so this is guarded. But when lo ===    
 times.length - 1 && times.length === 1, the first guard if (lo === 0) catches it. This is  
 actually correct. No bug here — the test suite (anchorSnap.test.js) covers this.           
                                                                                            
 #### 6. Chart overlay row data becomes stale                                               
                                                                                            
 File: DataTable.jsx — ChartOverlay                                                         
                                                                                            
 The openChartRow state captures the row object at chart-open time. If a re-analysis cycle  
 runs while the chart is open, the row's history, volumeHistory, oiHistory arrays are from  
 the old analysis cycle. The overlay header clone shows stale sparklines and metrics.       
                                                                                            
 Impact: Minor — sparklines and correlation values in the overlay header don't update until 
 the chart is closed and re-opened. Price/change update via livePrices.                     
                                                                                            
 ### MINOR ISSUES                                                                           
                                                                                            
 #### 7. CleanHorizontalRay custom renderer doesn't respect lineWidth scaling on high-DPI   
                                                                                            
 The renderer multiplies by horizontalPixelRatio for line width but uses x * e, y * e for   
 coordinates. This is correct for the bitmap coordinate space. No bug.                      
                                                                                            
 #### 8. No aria-label on timeframe buttons                                                 
                                                                                            
 Accessibility gap — timeframe buttons have no screen-reader labels.                        
                                                                                            
 #### 9. formatDuration in MeasureOverlay treats numeric timestamps as seconds              
                                                                                            
 ```js                                                                                      
   } else if (typeof t1 === 'number' && typeof t2 === 'number') {                           
     durationMs = Math.abs(t2 - t1) * 1000;                                                 
   }                                                                                        
 ```                                                                                        
                                                                                            
 This assumes numeric times are epoch seconds. lightweight-charts uses epoch seconds for    
 UTCTimestamp type. This is correct for Binance data.                                       
                                                                                            
 ### DATA INTEGRITY SUMMARY                                                                 
                                                                                            
 ┌──────────────────────────────────────────┬────────────┬────────────────────────────────┐ 
 │ Issue                                    │ Severity   │ Impact                         │ 
 ├──────────────────────────────────────────┼────────────┼────────────────────────────────┤ 
 │ #1: loadMore() race with whitespace      │ Low-Medium │ Potential gap in chart         │ 
 ├──────────────────────────────────────────┼────────────┼────────────────────────────────┤ 
 │ #2: Stale livePrice overwrites closed    │ High       │ Corrupted candle OHLC          │ 
 │ candle                                   │            │                                │ 
 ├──────────────────────────────────────────┼────────────┼────────────────────────────────┤ 
 │ #3: Volume color loss on theme toggle    │ Medium     │ All bars green after theme     │ 
 │                                          │            │ change                         │ 
 ├──────────────────────────────────────────┼────────────┼────────────────────────────────┤ 
 │ #4: Anchor snap races with setData       │ Medium     │ Drawings invisible after TF    │ 
 │                                          │            │ switch                         │ 
 ├──────────────────────────────────────────┼────────────┼────────────────────────────────┤ 
 │ #6: Stale overlay row data               │ Low        │ Outdated sparklines in overlay │ 
 └──────────────────────────────────────────┴────────────┴────────────────────────────────┘ 
                                                                                            
 ### RECOMMENDED FIXES (priority order)                                                     
                                                                                            
 1. Fix #2 — Add candle-time-boundary check before series.update() in the live price rAF    
 handler                                                                                    
 2. Fix #3 — Re-derive volume colors from candle data on theme change, not d.value >= 0     
 3. Fix #4 — Have the anchor-snapping rAF check renderedTimeframeRef.current ===            
 activeTimeframe before running                                                             
                                                                                            
 Want me to implement any of these fixes?                    
