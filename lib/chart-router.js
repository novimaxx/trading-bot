// ─── API графика для мини-аппа ────────────────────────────
// GET /api/chart?symbol=BTCUSDT&interval=1d&limit=300
// GET /api/symbols?q=sol&limit=50
// Уровни SM считаются у нас, TradingView не участвует.

const express = require('express')
const { fetchKlines, fetchSymbols, isValidSymbol, INTERVALS } = require('./binance')
const { compute } = require('./indicator')
const alerts = require('./alerts')
const { userIdFromRequest } = require('./chart-auth')

// Монеты, по которым идут сигналы в Telegram — всегда сверху в списке
const PINNED = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

// Сколько дневных свечей тянуть под интерполяцию базы
const DAILY_LOOKBACK = 400

const router = express.Router()

// ─── Список монет для выбора ──────────────────────────────
router.get('/symbols', async (req, res) => {
  const q     = String(req.query.q || '').trim().toUpperCase()
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 60, 1), 300)

  try {
    const all = await fetchSymbols()
    const list = q
      ? all.filter(s => s.base.includes(q) || s.symbol.includes(q))
      : [
          ...PINNED.map(p => all.find(s => s.symbol === p)).filter(Boolean),
          ...all.filter(s => !PINNED.includes(s.symbol)),
        ]

    res.json({ total: all.length, pinned: PINNED, symbols: list.slice(0, limit) })
  } catch (err) {
    console.error('symbols error:', err.message)
    res.status(502).json({ error: 'data source unavailable' })
  }
})

// ─── Свечи + уровни + сигналы ─────────────────────────────
router.get('/chart', async (req, res) => {
  const symbol   = String(req.query.symbol || 'BTCUSDT').toUpperCase()
  const interval = String(req.query.interval || '1d')
  const limit    = Math.min(Math.max(parseInt(req.query.limit) || 300, 50), 1000)

  if (!INTERVALS[interval]) return res.status(400).json({ error: 'unsupported interval' })
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) return res.status(400).json({ error: 'bad symbol' })

  try {
    if (!await isValidSymbol(symbol)) {
      return res.status(404).json({ error: 'unknown symbol' })
    }

    // Дневные свечи нужны всегда — на них строится база уровней
    const [candles, daily] = await Promise.all([
      fetchKlines(symbol, interval, limit),
      interval === '1d'
        ? Promise.resolve(null)
        : fetchKlines(symbol, '1d', DAILY_LOOKBACK),
    ])

    if (!candles.length) return res.status(404).json({ error: 'no data' })

    const r = compute(candles, daily || candles, interval)

    res.json({
      symbol,
      interval,
      // знаков после запятой — по шагу цены самой монеты
      digits: priceDigits(candles[candles.length - 1].close),
      candles: candles.map((c, i) => ({
        t: Math.floor(c.openTime / 1000),
        o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
        sm: r.levels[i] || null,
        tr: r.trend[i],
      })),
      signals: r.signals.map(s => ({ ...s, t: Math.floor(s.time / 1000) })),
      pivots:  r.pivots.map(p => ({ ...p, t: Math.floor(p.t / 1000) })),
      fib:     r.fib,
      liquidity: r.liquidity.map(z => ({
        ...z, from: Math.floor(z.from / 1000), to: Math.floor(z.to / 1000),
      })),
      state:   r.state,
    })
  } catch (err) {
    console.error('chart error:', err.message)
    res.status(502).json({ error: 'data source unavailable' })
  }
})

// ─── Алерты по уровням ────────────────────────────────────
// Прямые ссылки подписаны сервером, а Mini App передаёт Telegram initData.
// Открытого uid недостаточно: его легко подменить в адресной строке.
async function alertUser(req, res) {
  const id = userIdFromRequest(req)
  if (!id) {
    res.status(401).json({ error: 'unauthorized' })
    return null
  }
  if (!await alerts.isActivePro(id)) {
    res.status(403).json({ error: 'pro required' })
    return null
  }
  return id
}

router.get('/alerts', async (req, res) => {
  try {
    const id = await alertUser(req, res)
    if (!id) return
    res.json({ alerts: await alerts.list(id) })
  } catch (err) {
    console.error('alerts list:', err.message)
    res.status(503).json({ error: 'unavailable' })
  }
})

router.post('/alerts', async (req, res) => {
  const { symbol, interval, level } = req.body || {}
  if (!INTERVALS[interval]) return res.status(400).json({ error: 'bad interval' })
  if (!/^[A-Z0-9]{2,20}$/.test(String(symbol))) return res.status(400).json({ error: 'bad symbol' })

  try {
    const id = await alertUser(req, res)
    if (!id) return
    if (!await isValidSymbol(symbol)) return res.status(404).json({ error: 'unknown symbol' })
    res.json(await alerts.create(id, symbol, interval, level))
  } catch (err) {
    if (err.message === 'limit') {
      return res.status(429).json({ error: 'limit', max: alerts.MAX_PER_USER })
    }
    if (err.message === 'bad level') return res.status(400).json({ error: 'bad level' })
    console.error('alerts create:', err.message)
    res.status(503).json({ error: 'unavailable' })
  }
})

router.delete('/alerts/:id', async (req, res) => {
  try {
    const id = await alertUser(req, res)
    if (!id) return
    res.json({ ok: await alerts.remove(id, parseInt(req.params.id)) })
  } catch (err) {
    console.error('alerts delete:', err.message)
    res.status(503).json({ error: 'unavailable' })
  }
})

// Копеечные монеты вроде PEPE требуют больше знаков, чем BTC
function priceDigits(price) {
  if (price >= 1000) return 2
  if (price >= 1)    return 3
  if (price >= 0.01) return 5
  return 8
}

module.exports = { router, PINNED }
