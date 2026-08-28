// ─── Загрузка свечей и списка монет с Binance ─────────────
// Публичный REST, без ключей. Node 18+ — global fetch.

const BASE = 'https://api.binance.com/api/v3'

const INTERVALS = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' }

// Простой кеш в памяти — Binance режет по весу запросов,
// а мини-апп дёргает график часто.
const cache = new Map()
const TTL = { '15m': 20_000, '1h': 30_000, '4h': 60_000, '1d': 120_000 }

async function get(path) {
  const r = await fetch(BASE + path, { headers: { 'User-Agent': 'IT-v3' } })
  if (!r.ok) throw new Error(`binance ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function fetchKlines(symbol, interval, limit = 500) {
  const iv = INTERVALS[interval]
  if (!iv) throw new Error(`unsupported interval: ${interval}`)

  const key = `k:${symbol}:${iv}:${limit}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < (TTL[iv] || 60_000)) return hit.data

  const raw = await get(`/klines?symbol=${encodeURIComponent(symbol)}&interval=${iv}&limit=${limit}`)
  const data = raw.map(k => ({
    openTime:  k[0],
    open:      parseFloat(k[1]),
    high:      parseFloat(k[2]),
    low:       parseFloat(k[3]),
    close:     parseFloat(k[4]),
    volume:    parseFloat(k[5]),
    closeTime: k[6],
  }))

  cache.set(key, { at: Date.now(), data })
  return data
}

// ─── Список торгуемых пар к USDT ──────────────────────────
// Отсортирован по обороту за сутки — популярные монеты сверху.
let symbolsCache = { at: 0, data: null }
const SYMBOLS_TTL = 6 * 60 * 60 * 1000  // 6 часов

// Стейблы к USDT — уровни на них бессмысленны, в список не пускаем
const STABLES = new Set(['USDC','FDUSD','TUSD','BUSD','USD1','DAI','USDP','EUR','AEUR','XUSD',
                         'RLUSD','USDE','USDS','PYUSD','USDG','BFUSD','EURI'])

async function fetchSymbols() {
  if (symbolsCache.data && Date.now() - symbolsCache.at < SYMBOLS_TTL) return symbolsCache.data

  const [info, tickers] = await Promise.all([
    get('/exchangeInfo?permissions=SPOT'),
    get('/ticker/24hr'),
  ])

  const stats = new Map()
  for (const t of tickers) {
    stats.set(t.symbol, {
      price:  parseFloat(t.lastPrice),
      change: parseFloat(t.priceChangePercent),
      quoteVolume: parseFloat(t.quoteVolume),
    })
  }

  const data = info.symbols
    .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' &&
                 s.isSpotTradingAllowed && !STABLES.has(s.baseAsset))
    .map(s => {
      const st = stats.get(s.symbol) || {}
      return {
        symbol: s.symbol,
        base:   s.baseAsset,
        price:  st.price ?? null,
        change: st.change ?? null,
        volume: st.quoteVolume ?? 0,
      }
    })
    // отсекаем неликвид — на нём уровни всё равно бессмысленны
    .filter(s => s.volume > 500_000)
    .sort((a, b) => b.volume - a.volume)

  symbolsCache = { at: Date.now(), data }
  return data
}

async function isValidSymbol(symbol) {
  const list = await fetchSymbols()
  return list.some(s => s.symbol === symbol)
}

module.exports = { fetchKlines, fetchSymbols, isValidSymbol, INTERVALS }
