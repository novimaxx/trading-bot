// Trading Signal Bot — Telegram webhook server
// TradingView → Webhook → Telegram
// BTC / ETH / SOL · 1D + 4H + 1H

require('dotenv').config()
const express = require('express')
const app = express()
app.use(express.json())

const BOT_TOKEN = process.env.BOT_TOKEN
const CHAT_ID   = process.env.CHAT_ID
const PORT      = process.env.PORT || 3000

// ─── Настройки ────────────────────────────────────────────
const CFG = {
  tf: {
    '1D': process.env.TF_1D  !== 'false',
    '4H': process.env.TF_4H  !== 'false',
    '1H': process.env.TF_1H  !== 'false',
    '15': process.env.TF_15M === 'true',
    // TradingView aliases
    'D':   process.env.TF_1D  !== 'false',
    '240': process.env.TF_4H  !== 'false',
    '60':  process.env.TF_1H  !== 'false',
  },
  sig: {
    buy25:          process.env.SIGNAL_BUY25      !== 'false',
    buy50:          process.env.SIGNAL_BUY50      !== 'false',
    buy100:         process.env.SIGNAL_BUY100     !== 'false',
    sell50:         process.env.SIGNAL_SELL50     !== 'false',
    sell100:        process.env.SIGNAL_SELL100    !== 'false',
    strong_buy50:   process.env.SIGNAL_STRONG     !== 'false',
    strong_buy100:  process.env.SIGNAL_STRONG     !== 'false',
    strong_sell100: process.env.SIGNAL_STRONG     !== 'false',
    trend_up:       process.env.SIGNAL_TREND      !== 'false',
    trend_down:     process.env.SIGNAL_TREND      !== 'false',
    holding_sm4:    process.env.SIGNAL_HOLD       !== 'false',
    holding_sm5:    process.env.SIGNAL_HOLD       !== 'false',
    structure_lh:   process.env.SIGNAL_STRUCTURE  !== 'false',
    structure_hl:   process.env.SIGNAL_STRUCTURE  !== 'false',
    pivot_hh:         process.env.SIGNAL_PIVOT      !== 'false',
    pivot_ll:         process.env.SIGNAL_PIVOT      !== 'false',
    liq_buy_found:    process.env.SIGNAL_LIQ        !== 'false',
    liq_sell_found:   process.env.SIGNAL_LIQ        !== 'false',
    liq_buy_breach:   process.env.SIGNAL_LIQ        !== 'false',
    liq_sell_breach:  process.env.SIGNAL_LIQ        !== 'false',
  }
}

// ─── Метаданные сигналов ──────────────────────────────────
const META = {
  buy25:          { emoji: '🟡', title: 'BUY 25%',         level: 'SM3', onlyTF: '1D' },
  buy50:          { emoji: '🟠', title: 'BUY 50%',         level: 'SM4' },
  buy100:         { emoji: '🟢', title: 'BUY 100%',        level: 'SM5' },
  sell50:         { emoji: '🔴', title: 'SELL 50%',        level: 'SM2' },
  sell100:        { emoji: '🔴', title: 'SELL 100%',       level: 'SM1' },
  strong_buy50:   { emoji: '🔥', title: 'STRONG BUY 50%',  level: 'SM4' },
  strong_buy100:  { emoji: '🔥', title: 'STRONG BUY 100%', level: 'SM5' },
  strong_sell100: { emoji: '🔥', title: 'STRONG SELL 100%',level: 'SM1' },
  trend_up:       { emoji: '📈', title: 'Тренд вверх',     level: 'SMA50' },
  trend_down:     { emoji: '📉', title: 'Тренд вниз',      level: 'SMA50' },
  holding_sm4:    { emoji: '🔒', title: 'Удержание SM4',   level: 'SM4' },
  holding_sm5:    { emoji: '🔒', title: 'Удержание SM5',   level: 'SM5' },
  structure_lh:   { emoji: '⚠️', title: 'Слом структуры',  level: 'LH'  },
  structure_hl:   { emoji: '⚠️', title: 'Разворот',        level: 'HL'  },
  pivot_hh:       { emoji: '📈', title: 'HH — локальный хай',        level: 'HH', onlyTF: '1D' },
  pivot_ll:       { emoji: '📉', title: 'LL — локальный лой',        level: 'LL', onlyTF: '1D' },
  liq_buy_found:  { emoji: '🟢', title: 'Buyside ликвидность НАЙДЕНА'  },
  liq_sell_found: { emoji: '🔴', title: 'Sellside ликвидность НАЙДЕНА' },
  liq_buy_breach: { emoji: '⚡️', title: 'Buyside ликвидность ПРОБИТА'  },
  liq_sell_breach:{ emoji: '⚡️', title: 'Sellside ликвидность ПРОБИТА' },
}

const TF_LABEL = {
  '1D':'1 День', 'D':'1 День',
  '4H':'4 Часа', '240':'4 Часа',
  '1H':'1 Час',  '60':'1 Час',
  '15':'15 мин',
}

const COIN_ICON = {
  BTCUSDT:'₿', BTCUSD:'₿',
  ETHUSDT:'Ξ', ETHUSD:'Ξ',
  SOLUSDT:'◎', SOLUSD:'◎',
}

// ─── Утилиты ──────────────────────────────────────────────
function fmtPrice(p) {
  const n = parseFloat(p)
  if (isNaN(n)) return p
  if (n > 10000) return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
  if (n > 100)   return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

function fmtTime(t) {
  const n = parseInt(t)
  const ts = (!t || !n || n < 1000000000) ? Date.now()
    : (String(t).length > 12 ? n : n * 1000)
  return new Date(ts).toLocaleString('ru-RU', {
    timeZone: 'Europe/Prague',
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  })
}

function normalize(tf) {
  // TradingView может слать interval по-разному
  const map = { '1440':'1D', '240':'4H', '60':'1H', '15':'15', 'D':'1D' }
  return map[tf] || tf
}

// ─── Строим сообщение ─────────────────────────────────────
function buildMsg(data) {
  const signal   = data.signal
  const meta     = META[signal]
  if (!meta) return null

  const tf       = normalize(data.interval || '')
  const tfLabel  = TF_LABEL[tf] || tf || '?'
  const ticker   = (data.ticker || '').toUpperCase()
  const sym      = ticker.replace('USDT','').replace('USD','')
  const icon     = COIN_ICON[ticker] || ''
  const price    = fmtPrice(data.price)
  const time     = fmtTime(data.time)
  const bars     = data.bars || '5'
  const isStrong = signal.startsWith('strong_')
  const isBuy    = signal.includes('buy')
  const isSell   = signal.includes('sell')
  const isTrend  = signal.includes('trend')
  const isHold   = signal.includes('holding')
  const isStruct = signal.includes('structure')
  const isPivot  = signal === 'pivot_hh' || signal === 'pivot_ll'
  const isLiq    = signal.startsWith('liq_')

  const lines = []
  lines.push(`${meta.emoji} *${meta.title}*`)
  lines.push(``)
  lines.push(`${icon} *${sym}* · ${tfLabel}`)
  lines.push(``)
  lines.push(`💰 Цена:    \`${price}\``)

  if (isBuy || isSell) {
    lines.push(`📍 Уровень: \`${meta.level}\``)
  }

  if (isStrong) {
    lines.push(``)
    lines.push(`✅ Объём подтверждён`)
    lines.push(`✅ RSI в зоне`)
    lines.push(`✅ Тренд совпадает`)
    lines.push(``)
    lines.push(`⚡️ _Все три фильтра совпали_`)
  }

  if (isTrend) {
    lines.push(``)
    const txt = signal === 'trend_up'
      ? '📊 Закрытие *выше* SMA50 → бычий тренд'
      : '📊 Закрытие *ниже* SMA50 → медвежий тренд'
    lines.push(txt)
  }

  if (isHold) {
    lines.push(``)
    lines.push(`🔒 Уровень удерживается уже *${bars} баров*`)
    lines.push(`_Сигнал усиливается_`)
  }

  if (isStruct) {
    lines.push(``)
    const txt = signal === 'structure_lh'
      ? '📉 LH после HH — *бычья структура сломана*'
      : '📈 HL после LL — *медвежья структура сломана*'
    lines.push(txt)
  }

  if (isLiq) {
    const isBreach = signal.includes('breach')
    const isBuyside = signal.includes('buy')
    lines.push(`📍 Уровень: \`${fmtPrice(data.level || data.price)}\``)
    lines.push(``)
    if (isBreach) {
      lines.push(isBuyside
        ? '🎯 Стопы выбиты — возможный разворот вниз'
        : '🎯 Стопы выбиты — возможный разворот вверх')
    } else {
      lines.push(isBuyside
        ? '💡 Скопление покупок выше этой зоны'
        : '💡 Скопление продаж ниже этой зоны')
    }
  }

  if (isPivot && data.f382 && data.f500 && data.f618) {
    const label = signal === 'pivot_hh' ? 'Фибо коррекция ↓' : 'Фибо отскок ↑'
    lines.push(``)
    lines.push(`📊 *${label}*`)
    lines.push(`  0.382 → \`${fmtPrice(data.f382)}\``)
    lines.push(`  0.500 → \`${fmtPrice(data.f500)}\``)
    lines.push(`  0.618 → \`${fmtPrice(data.f618)}\``)
  }

  lines.push(``)
  lines.push(`🕐 ${time}`)

  return lines.join('\n')
}

// ─── Telegram ─────────────────────────────────────────────
async function sendTg(text) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' })
  })
  const j = await r.json()
  if (!j.ok) console.error('TG error:', j.description)
  return j
}

// ─── Webhook ──────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const data   = req.body
    const signal = data.signal
    const tf     = normalize(data.interval || '')

    console.log(`[${new Date().toISOString()}] ${signal} ${data.ticker} ${tf}`)

    // Сигнал включён?
    if (!CFG.sig[signal]) {
      return res.sendStatus(200)
    }

    // Таймфрейм включён?
    if (CFG.tf[tf] === false) {
      return res.sendStatus(200)
    }

    // BUY 25% только на 1D
    const meta = META[signal]
    if (meta?.onlyTF && normalize(tf) !== meta.onlyTF) {
      console.log(`${signal} skipped — only allowed on ${meta.onlyTF}`)
      return res.sendStatus(200)
    }

    const msg = buildMsg(data)
    if (!msg) return res.sendStatus(400)

    await sendTg(msg)
    res.sendStatus(200)

  } catch (err) {
    console.error('Error:', err)
    res.sendStatus(500)
  }
})

// ─── Health ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    bot: 'Trading Signal Bot',
    coins: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    timeframes: Object.entries(CFG.tf).filter(([,v])=>v).map(([k])=>k),
  })
})

// ─── Test ─────────────────────────────────────────────────
app.get('/test/:signal?', async (req, res) => {
  const signal = req.params.signal || 'buy100'
  const data = {
    signal,
    ticker:   'BTCUSDT',
    price:    '76125.50',
    interval: '1D',
    time:     String(Date.now()),
  }
  const msg = buildMsg(data)
  if (!msg) return res.json({ error: 'unknown signal' })
  await sendTg(msg)
  res.json({ sent: true, preview: msg })
})

app.listen(PORT, () => {
  console.log(`\n🤖 Trading Signal Bot`)
  console.log(`📡 Port: ${PORT}`)
  console.log(`📬 Webhook: POST /webhook`)
  console.log(`🧪 Test:    GET  /test/buy100\n`)
})
