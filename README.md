# Sniper Bot

A custom copy trading bot built using Node.js that connects to the Solana blockchain via WebSocket.

## 🚀 Fast Sniper Mode

For maximum trading speed when copying target wallet transactions, use the **Fast Sniper** mode:

```bash
npm run fast-sniper
```

### Fast Sniper Optimizations

The Fast Sniper mode includes several optimizations for maximum speed:

1. **Faster WebSocket Monitoring**: Uses "processed" commitment instead of "confirmed" for ~400ms faster detection
2. **Reduced API Rate Limiting**: 10ms between API calls instead of 100ms
3. **Higher Priority Fees**: 10M lamports priority fee for maximum transaction priority
4. **Skipped Safety Checks**: Bypasses price impact and liquidity checks for immediate execution
5. **Faster Transaction Settings**: Uses legacy transactions with optimized compute units
6. **Reduced Cooldowns**: 500ms cooldown between trades instead of 60 seconds
7. **Direct Route Trading**: Uses only direct routes for faster execution

### Speed Improvements

- **Transaction Detection**: ~400ms faster (processed vs confirmed)
- **API Calls**: ~90ms faster per call (10ms vs 100ms intervals)
- **Safety Checks**: ~200-500ms saved by skipping non-critical checks
- **Transaction Priority**: Much higher priority with 10M lamport fees
- **Total Speed Gain**: ~1-2 seconds faster execution

### Safety Considerations

⚠️ **Warning**: Fast Sniper mode sacrifices some safety checks for speed:
- No price impact validation
- No liquidity checks
- Reduced cooldown periods
- Higher priority fees (increased costs)

Use only if you understand the risks and have proper risk management in place.

## Regular Mode

For safer trading with full safety checks:

```bash
npm run dev
```
