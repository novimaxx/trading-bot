// Trading Signal Bot — Telegram webhook server
// TradingView → Webhook → Telegram
// BTC / ETH / SOL · 1D + 4H + 1H

require('dotenv').config()
const express = require('express')
const path    = require('path')
const { Pool } = require('pg')
const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// BOT_TOKEN       — токен сигнального бота (отправляет DM)
// INDICATOR_BOT_TOKEN — токен основного бота (если нужен отдельный)
// CHAT_ID         — fallback: один чат (канал/пользователь), если база не подключена
// DATABASE_URL    — PostgreSQL (Digital Ocean), чтобы слать только PRO-подписчикам
const BOT_TOKEN   = process.env.INDICATOR_BOT_TOKEN || process.env.BOT_TOKEN
const CHAT_ID     = process.env.CHAT_ID
const PORT        = process.env.PORT || 3000

// ─── PostgreSQL ───────────────────────────────────────────
let pool = null
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
  pool.on('error', (err) => console.error('PG error:', err.message))
  console.log('🗄  PostgreSQL подключён — режим PRO-подписчиков')
} else {
  console.log('⚠️  DATABASE_URL не задан — сигналы идут в CHAT_ID (fallback)')
}

// ─── Авто-миграция таблиц ─────────────────────────────────
async function runMigrations() {
  if (!pool) return
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_signals (
        id         SERIAL PRIMARY KEY,
        pair       TEXT NOT NULL,
        action     TEXT NOT NULL,
        tag        TEXT,
        timeframe  TEXT,
        price      TEXT,
        sent_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_posts (
        id         SERIAL PRIMARY KEY,
        title      TEXT,
        body       TEXT,
        image_url  TEXT,
        file_id    TEXT,
        tag        TEXT DEFAULT 'АНАЛИТИКА',
        sent_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id                  BIGINT PRIMARY KEY,
        username            TEXT,
        first_name          TEXT,
        subscribed          BOOLEAN DEFAULT FALSE,
        subscription_until  TIMESTAMP,
        subscription_plan   TEXT,
        ref_by              BIGINT,
        ref_code            TEXT UNIQUE,
        referral_count      INTEGER DEFAULT 0,
        tradingview_username TEXT
      );
    `)
    console.log('✅ Миграции выполнены')
  } catch (err) {
    console.error('Migration error:', err.message)
  }
}

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

  const rsi       = data.rsi
  const rsiStatus = data.rsi_status
  const vol       = data.vol
  const trend     = data.trend
  const smLevel   = data.sm_level

  const rsiEmoji = rsiStatus === 'OVERSOLD' ? '🟢' : rsiStatus === 'OVERBOUGHT' ? '🔴' : '⚪️'
  const volEmoji = vol === 'OK' ? '✅' : '📉'
  const trendEmoji = trend === 'UP' ? '📈' : trend === 'DOWN' ? '📉' : ''

  const pct = smLevel && data.price
    ? ((parseFloat(smLevel) - parseFloat(data.price)) / parseFloat(data.price) * 100).toFixed(1)
    : null

  const lines = []
  lines.push(`${meta.emoji} *${meta.title}*`)
  lines.push(``)
  lines.push(`${icon} *${sym}* · ${tfLabel}`)
  lines.push(``)
  lines.push(`💰 Цена:    \`${price}\``)

  if (smLevel && !isPivot && !isLiq) {
    const pctStr = pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''
    lines.push(`📍 Уровень: \`${fmtPrice(smLevel)}\`${pctStr}`)
  }

  if (rsi && !isPivot && !isLiq) {
    lines.push(`📊 RSI:     \`${rsi}\`  ${rsiEmoji} _${rsiStatus || ''}_`)
  }

  if (vol && !isPivot && !isLiq) {
    lines.push(`📦 Объём:   ${volEmoji} \`${vol}\``)
  }

  if (trend && !isPivot && !isLiq && !isTrend) {
    lines.push(`${trendEmoji} Тренд:   \`${trend}\``)
  }

  if (isStrong) {
    lines.push(``)
    lines.push(`⚡️ _Все три фильтра совпали — сильный сигнал_`)
  }

  if (isTrend) {
    lines.push(``)
    const txt = signal === 'trend_up'
      ? '📊 Цена закрылась *выше* SMA50 → бычий тренд'
      : '📊 Цена закрылась *ниже* SMA50 → медвежий тренд'
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
async function sendTgTo(chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  })
  const j = await r.json()
  if (!j.ok) console.error(`TG error → ${chatId}:`, j.description)
  return j
}

// Получить PRO-подписчиков из БД
async function getProSubscribers() {
  if (!pool) return []
  try {
    const { rows } = await pool.query(`
      SELECT id FROM users
      WHERE subscribed = TRUE
        AND subscription_until IS NOT NULL
        AND subscription_until > NOW()
        AND subscription_plan = 'PRO'
    `)
    return rows.map(r => r.id)
  } catch (err) {
    console.error('DB error (getProSubscribers):', err.message)
    return []
  }
}

// Главная функция отправки — PRO-подписчики или CHAT_ID fallback
async function sendSignal(text) {
  if (pool) {
    const ids = await getProSubscribers()
    console.log(`📤 Отправляем сигнал ${ids.length} PRO-подписчикам`)
    if (ids.length === 0) return

    // Пауза между отправками чтобы не словить 429 от Telegram
    for (const id of ids) {
      await sendTgTo(id, text)
      await new Promise(res => setTimeout(res, 50))
    }
  } else {
    // Fallback — отправить в CHAT_ID (канал или один пользователь)
    await sendTgTo(CHAT_ID, text)
  }
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

    await sendSignal(msg)

    // Сохранить сигнал в БД для мини-апп
    if (pool) {
      const isBuy  = signal.includes('buy')
      const isSell = signal.includes('sell')
      const isStrong = signal.startsWith('strong_')
      const actionLabel = isStrong
        ? (isBuy ? 'STRONG BUY' : 'STRONG SELL')
        : (isBuy ? 'BUY' : isSell ? 'SELL' : meta.title)
      const sym = (data.ticker || '').toUpperCase().replace('USDT','').replace('USD','')
      const pair = sym ? `${sym}/USDT` : data.ticker

      pool.query(
        `INSERT INTO app_signals (pair, action, tag, timeframe, price) VALUES ($1,$2,$3,$4,$5)`,
        [pair, actionLabel, actionLabel, normalize(data.interval || ''), fmtPrice(data.price)]
      ).catch(e => console.error('Signal save error:', e.message))
    }

    res.sendStatus(200)

  } catch (err) {
    console.error('Error:', err)
    res.sendStatus(500)
  }
})

// ─── CORS для мини-апп ────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

const API_KEY = process.env.API_KEY || 'indicator-secret-key'

// ─── API: данные пользователя ─────────────────────────────
app.get('/api/user/:id', async (req, res) => {
  const userId = parseInt(req.params.id)
  if (!userId || !pool) return res.json({ plan: null })

  try {
    const { rows } = await pool.query(
      `SELECT subscription_plan, subscription_until, referral_count FROM users WHERE id = $1`,
      [userId]
    )

    if (!rows.length) return res.json({ plan: null })

    const u = rows[0]
    const until = u.subscription_until ? new Date(u.subscription_until) : null
    const active = until && until > new Date()
    const daysLeft = active ? Math.ceil((until - new Date()) / 86400000) : null

    let signalsCount = 0
    try {
      const s = await pool.query(`SELECT COUNT(*) FROM app_signals WHERE sent_at > NOW() - INTERVAL '30 days'`)
      signalsCount = parseInt(s.rows[0].count) || 0
    } catch (_) {}

    res.json({
      plan: active ? u.subscription_plan : null,
      daysLeft,
      refs: u.referral_count || 0,
      signalsCount,
    })
  } catch (err) {
    console.error('API /user error:', err.message)
    res.json({ plan: null })
  }
})

// ─── API: синхронизация пользователя из основного бота ────
app.post('/api/user/sync', async (req, res) => {
  if (req.headers['x-api-key'] !== API_KEY) return res.sendStatus(401)
  if (!pool) return res.sendStatus(503)

  const { id, username, first_name, subscribed, subscription_until, subscription_plan, referral_count } = req.body
  if (!id) return res.sendStatus(400)

  try {
    await pool.query(`
      INSERT INTO users (id, username, first_name, subscribed, subscription_until, subscription_plan, referral_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        subscribed = EXCLUDED.subscribed,
        subscription_until = EXCLUDED.subscription_until,
        subscription_plan = EXCLUDED.subscription_plan,
        referral_count = EXCLUDED.referral_count
    `, [id, username, first_name, subscribed, subscription_until, subscription_plan, referral_count || 0])
    res.json({ ok: true })
  } catch (err) {
    console.error('User sync error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: сигналы ─────────────────────────────────────────
app.get('/api/signals', async (req, res) => {
  if (!pool) return res.json(getDemoSignals())

  try {
    const { rows } = await pool.query(
      `SELECT pair, action, tag, timeframe, price, sent_at FROM app_signals ORDER BY sent_at DESC LIMIT 30`
    )
    res.json(rows.length ? rows.map(formatSignalRow) : getDemoSignals())
  } catch (err) {
    console.error('API /signals error:', err.message)
    res.json(getDemoSignals())
  }
})

function formatSignalRow(r) {
  const diffH = (Date.now() - new Date(r.sent_at)) / 3600000
  const time = diffH < 1
    ? Math.round(diffH * 60) + ' мин'
    : diffH < 24 ? Math.round(diffH) + ' ч'
    : Math.round(diffH / 24) + ' дн'
  const action = (r.action || '').toUpperCase()
  return {
    pair: r.pair || 'BTC/USDT',
    action: action.includes('BUY') ? 'BUY' : 'SELL',
    tag: r.tag || action,
    tf: r.timeframe || '1H',
    time,
    price: r.price || '—',
  }
}

function getDemoSignals() {
  return [
    { pair: 'BTC/USDT', action: 'BUY', tag: 'STRONG BUY', tf: '4H', time: 'только что', price: '96,240' },
    { pair: 'ETH/USDT', action: 'BUY', tag: 'BUY', tf: '1H', time: '3 ч', price: '1,830' },
    { pair: 'SOL/USDT', action: 'SELL', tag: 'SELL', tf: '4H', time: '1 дн', price: '142' },
  ]
}

// ─── API: посты / аналитика ───────────────────────────────
app.get('/api/posts', async (req, res) => {
  if (!pool) return res.json(getDemoPosts())

  try {
    const { rows } = await pool.query(
      `SELECT id, title, body, image_url, file_id, tag, sent_at FROM app_posts ORDER BY sent_at DESC LIMIT 20`
    )
    res.json(rows.length ? rows : getDemoPosts())
  } catch (err) {
    console.error('API /posts error:', err.message)
    res.json(getDemoPosts())
  }
})

// Публикация поста из бота
app.post('/api/posts', async (req, res) => {
  if (req.headers['x-api-key'] !== API_KEY) return res.sendStatus(401)
  if (!pool) return res.sendStatus(503)

  const { title, body, image_url, file_id, tag } = req.body
  if (!body && !image_url && !file_id) return res.sendStatus(400)

  try {
    const { rows } = await pool.query(
      `INSERT INTO app_posts (title, body, image_url, file_id, tag) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [title || null, body || null, image_url || null, file_id || null, tag || 'АНАЛИТИКА']
    )
    res.json({ ok: true, id: rows[0].id })
  } catch (err) {
    console.error('API POST /posts error:', err.message)
    res.sendStatus(500)
  }
})

function getDemoPosts() {
  return [
    {
      id: 1,
      title: '💎 SOL — обновление по рынку',
      body: `Структура ослабла.\n\n📍 Что произошло:\n\n• Цена закрепилась ниже оранжевой линии SM\n• Потеряли локальную поддержку\n• Покупатель пока не показывает силы\n\nЭто сигнал о смещении приоритета в сторону коррекции.\n\n⚠️ Важно\n\nС текущих уровней покупки не рассматриваем.\nРиск продолжения снижения сохраняется.\n\n🔻 Зоны набора\n\nОбозначены уровни, откуда логично работать частями:\n\n• ~78 зона частичного набора\n• ~69–70 более сильная зона поддержки\n\nИменно там имеет смысл смотреть реакцию рынка.\n\nПока цена ниже оранжевой SM —\nприоритет за коррекцией.`,
      tag: 'SOL · 1D',
      file_id: null,
      sent_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
    {
      id: 2,
      title: '₿ BTC — Анализ недели',
      body: `Биткоин консолидируется у уровня $96K.\n\nСтруктура бычья — серия HH/HL сохраняется на дневном.\n\n📍 Ключевые уровни:\n\n• $93,500–$94,800 — зона поддержки\n• $98,200 — ближайшее сопротивление\n• $101,500 — цель при пробое\n\nПока держимся выше оранжевой SM — сетапы на покупку актуальны.`,
      tag: 'BTC · 1D',
      file_id: null,
      sent_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 3,
      title: 'Ξ ETH — Накопление',
      body: `ETH формирует базу в диапазоне $1,780–$1,850.\n\nRSI на дневном выходит из зоны перепроданности.\nОбъёмы немного растут — признак накопления.\n\n⚠️ Важно:\n\nПока нет подтверждения — позицию не набираем.\nОжидаем реакцию у $1,780 или пробой $1,880 с объёмом.`,
      tag: 'ETH · 4H',
      file_id: null,
      sent_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
  ]
}

// ─── API: прокси Telegram-фото для мини-апп ──────────────
app.get('/api/image/:fileId', async (req, res) => {
  const { fileId } = req.params
  if (!BOT_TOKEN) return res.sendStatus(404)

  try {
    // Получить путь к файлу
    const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
    const info = await infoRes.json()
    if (!info.ok) return res.sendStatus(404)

    // Стримим файл
    const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`)
    if (!fileRes.ok) return res.sendStatus(404)

    res.set('Content-Type', fileRes.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400')

    const buf = await fileRes.arrayBuffer()
    res.send(Buffer.from(buf))
  } catch (err) {
    console.error('Image proxy error:', err.message)
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
    ticker:     'BTCUSDT',
    price:      '76125.50',
    sm_level:   '70095.00',
    rsi:        '38',
    rsi_status: 'OVERSOLD',
    vol:        'LOW',
    trend:      'UP',
    interval:   '1D',
    time:       String(Date.now()),
    f382: '73800', f500: '72100', f618: '70400',
  }
  const msg = buildMsg(data)
  if (!msg) return res.json({ error: 'unknown signal' })
  await sendSignal(msg)
  res.json({ sent: true, preview: msg })
})

app.listen(PORT, async () => {
  console.log(`\n🤖 Trading Signal Bot`)
  console.log(`📡 Port: ${PORT}`)
  console.log(`📬 Webhook: POST /webhook`)
  console.log(`🧪 Test:    GET  /test/buy100\n`)
  await runMigrations()
})
