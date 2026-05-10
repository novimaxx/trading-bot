// Trading Signal Bot — Telegram webhook server
// TradingView → Webhook → Telegram
// BTC / ETH / SOL · 1D + 4H + 1H

require('dotenv').config()
const express = require('express')
const path    = require('path')
const { Pool } = require('pg')
const app = express()
app.use(express.json({ limit: '10mb' }))
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
        comment    TEXT,
        sent_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE app_signals ADD COLUMN IF NOT EXISTS comment TEXT;
      ALTER TABLE app_signals ADD COLUMN IF NOT EXISTS direction TEXT;

      CREATE TABLE IF NOT EXISTS app_posts (
        id         SERIAL PRIMARY KEY,
        title      TEXT,
        body       TEXT,
        image_url  TEXT,
        file_id    TEXT,
        tag        TEXT DEFAULT 'АНАЛИТИКА',
        visibility TEXT DEFAULT 'ALL',
        post_type  TEXT DEFAULT 'analytics',
        sent_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
      ALTER TABLE app_posts ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'ALL';
      ALTER TABLE app_posts ADD COLUMN IF NOT EXISTS post_type TEXT DEFAULT 'analytics';

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

      CREATE TABLE IF NOT EXISTS payment_requests (
        id          SERIAL PRIMARY KEY,
        user_id     BIGINT NOT NULL,
        username    TEXT,
        first_name  TEXT,
        plan        TEXT,
        tx_link     TEXT,
        tv_username TEXT,
        note        TEXT,
        status      TEXT DEFAULT 'pending',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS support_messages (
        id         SERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL,
        username   TEXT,
        first_name TEXT,
        message    TEXT NOT NULL,
        reply      TEXT,
        status     TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW(),
        replied_at TIMESTAMP
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

// ─── Send to Admin ────────────────────────────────────────
async function sendToAdmin(text) {
  const chatId = process.env.CHAT_ID
  if (!chatId) return
  await bot_sendMessage(chatId, text)
}

async function bot_sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  }).catch(e => console.error('sendToAdmin error:', e.message))
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
      const isBuy    = signal.includes('buy')
      const isSell   = signal.includes('sell')
      const isStrong = signal.startsWith('strong_')
      const isTrend  = signal.includes('trend')
      const isHold   = signal.includes('holding')
      const isStruct = signal.includes('structure')
      const isLiq    = signal.startsWith('liq_')
      const actionLabel = isStrong
        ? (isBuy ? 'STRONG BUY' : 'STRONG SELL')
        : (isBuy ? 'BUY' : isSell ? 'SELL' : meta.title)
      const sym = (data.ticker || '').toUpperCase().replace('USDT','').replace('USD','')
      const pair = sym ? `${sym}/USDT` : data.ticker

      // Строим comment — дополнительный контекст для апп
      const commentParts = []
      if (data.rsi)   commentParts.push(`RSI: ${data.rsi}${data.rsi_status ? ' · ' + data.rsi_status : ''}`)
      if (data.vol)   commentParts.push(`Объём: ${data.vol}`)
      if (data.trend) commentParts.push(`Тренд: ${data.trend}`)
      if (isStrong)   commentParts.push('⚡️ Все три фильтра совпали — сильный сигнал')
      if (isTrend)    commentParts.push(signal === 'trend_up'
        ? '📊 Цена закрылась выше SMA50 → бычий тренд'
        : '📊 Цена закрылась ниже SMA50 → медвежий тренд')
      if (isHold)     commentParts.push(`🔒 Уровень удерживается уже ${data.bars || '5'} баров`)
      if (isStruct)   commentParts.push(signal === 'structure_lh'
        ? '📉 LH после HH — бычья структура сломана'
        : '📈 HL после LL — медвежья структура сломана')
      if (isLiq) {
        const isBreach  = signal.includes('breach')
        const isBuyside = signal.includes('buy')
        commentParts.push(isBreach
          ? (isBuyside ? '🎯 Стопы выбиты — возможный разворот вниз' : '🎯 Стопы выбиты — возможный разворот вверх')
          : (isBuyside ? '💡 Скопление покупок выше этой зоны'        : '💡 Скопление продаж ниже этой зоны'))
      }
      if (data.sm_level) commentParts.push(`📍 Уровень: ${fmtPrice(data.sm_level)}`)
      const comment = commentParts.join('\n') || null

      // Явный маппинг направления по типу сигнала
      const direction =
        signal === 'trend_up'         ? 'BUY'  :
        signal === 'structure_hl'     ? 'BUY'  :  // HL = higher low = бычий разворот
        signal === 'liq_sell_found'   ? 'BUY'  :  // sellside liq ниже = цель BUY
        signal === 'liq_sell_breach'  ? 'BUY'  :  // пробой sellside = разворот вверх
        signal === 'trend_down'       ? 'SELL' :
        signal === 'structure_lh'     ? 'SELL' :  // LH = lower high = медвежий слом
        signal === 'liq_buy_found'    ? 'SELL' :  // buyside liq выше = цель SELL
        signal === 'liq_buy_breach'   ? 'SELL' :  // пробой buyside = разворот вниз
        isBuy ? 'BUY' : 'SELL'
      pool.query(
        `INSERT INTO app_signals (pair, action, tag, timeframe, price, comment, direction) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pair, actionLabel, actionLabel, normalize(data.interval || ''), fmtPrice(data.price), comment, direction]
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
      `SELECT subscription_plan, subscription_until, referral_count, tv_username, created_at FROM users WHERE id = $1`,
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
      tv_username: u.tv_username || null,
      created_at: u.created_at || null,
    })
  } catch (err) {
    console.error('API /user error:', err.message)
    res.json({ plan: null })
  }
})

// ─── API: сохранить TradingView username ──────────────────
app.post('/api/user/:id/tv-username', async (req, res) => {
  const userId = parseInt(req.params.id)
  if (!userId || !pool) return res.sendStatus(400)

  const tv = (req.body?.tv_username || '').trim().replace(/^@/, '')
  if (!tv || !/^[a-zA-Z0-9_]{2,40}$/.test(tv)) {
    return res.status(400).json({ error: 'invalid username' })
  }

  try {
    // ensure column exists
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tv_username TEXT`).catch(()=>{})
    await pool.query(`UPDATE users SET tv_username = $1 WHERE id = $2`, [tv, userId])
    res.json({ ok: true, tv_username: tv })
  } catch (err) {
    console.error('TV username save error:', err.message)
    res.sendStatus(500)
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
      `SELECT pair, action, tag, timeframe, price, comment, direction, sent_at FROM app_signals ORDER BY sent_at DESC LIMIT 30`
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
  const d = new Date(r.sent_at)
  const dateStr = d.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' })
    + ', ' + d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })
  const direction = r.direction || (action.includes('BUY') ? 'BUY' : 'SELL')
  return {
    pair: r.pair || 'BTC/USDT',
    action: action.includes('BUY') ? 'BUY' : action.includes('SELL') ? 'SELL' : action,
    tag: r.tag || action,
    direction,
    tf: r.timeframe || '1H',
    time,
    price: r.price || '—',
    comment: r.comment || null,
    date: dateStr,
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
    // Определяем план пользователя для фильтрации
    const tgId = String(req.query.tg_id || '')
    let userPlan = null
    if (tgId) {
      try {
        const { rows: urows } = await pool.query(
          `SELECT subscription_plan, subscription_until FROM users WHERE id = $1`, [tgId]
        )
        if (urows.length && urows[0].subscription_until && new Date(urows[0].subscription_until) > new Date()) {
          userPlan = urows[0].subscription_plan
        }
      } catch (_) {}
    }

    // Фильтр видимости по подписке
    let visFilter = `visibility = 'ALL'`
    if (userPlan === 'PRO') {
      visFilter = `visibility IN ('ALL','STANDARD','PRO')`
    } else if (userPlan === 'STANDARD') {
      visFilter = `visibility IN ('ALL','STANDARD')`
    }

    const { rows } = await pool.query(
      `SELECT id, title, body, file_id, image_data, tag, visibility, post_type, sent_at
       FROM app_posts WHERE ${visFilter} ORDER BY sent_at DESC LIMIT 30`
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
      image_url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80',
      sent_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
    {
      id: 2,
      title: '₿ BTC — Анализ недели',
      body: `Биткоин консолидируется у уровня $96K.\n\nСтруктура бычья — серия HH/HL сохраняется на дневном.\n\n📍 Ключевые уровни:\n\n• $93,500–$94,800 — зона поддержки\n• $98,200 — ближайшее сопротивление\n• $101,500 — цель при пробое\n\nПока держимся выше оранжевой SM — сетапы на покупку актуальны.`,
      tag: 'BTC · 1D',
      file_id: null,
      image_url: 'https://images.unsplash.com/photo-1640340434855-6084b1f4901c?w=800&q=80',
      sent_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 3,
      title: 'Ξ ETH — Накопление',
      body: `ETH формирует базу в диапазоне $1,780–$1,850.\n\nRSI на дневном выходит из зоны перепроданности.\nОбъёмы немного растут — признак накопления.\n\n⚠️ Важно:\n\nПока нет подтверждения — позицию не набираем.\nОжидаем реакцию у $1,780 или пробой $1,880 с объёмом.`,
      tag: 'ETH · 4H',
      file_id: null,
      image_url: 'https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=800&q=80',
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

// ─── Admin middleware ─────────────────────────────────────
const ADMIN_IDS = [String(process.env.ADMIN_ID || ''), '562914492'].filter(Boolean)
function adminOnly(req, res, next) {
  const tgId = String(req.query.tg_id || req.body?.tg_id || '')
  if (!ADMIN_IDS.includes(tgId)) return res.sendStatus(403)
  next()
}

// ─── API: Admin stats ─────────────────────────────────────
app.get('/api/admin/stats', adminOnly, async (req, res) => {
  if (!pool) return res.json({ total_users:0, active_subs:0, total_signals:0, total_posts:0, pending_payments:0, no_db:true })
  try {
    const [users, active, newToday, signals, posts, payments] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users`),
      pool.query(`SELECT COUNT(*) FROM users WHERE subscribed = TRUE AND subscription_until > NOW()`),
      pool.query(`SELECT COUNT(*) FROM users WHERE id IN (SELECT id FROM users WHERE TRUE) AND (subscription_until > NOW() - INTERVAL '1 day' OR TRUE) AND created_at::date = CURRENT_DATE`).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(`SELECT COUNT(*) FROM app_signals`),
      pool.query(`SELECT COUNT(*) FROM app_posts`),
      pool.query(`SELECT COUNT(*) FROM payment_requests WHERE status = 'pending'`),
    ])
    res.json({
      total_users:    parseInt(users.rows[0].count),
      active_subs:    parseInt(active.rows[0].count),
      total_signals:  parseInt(signals.rows[0].count),
      total_posts:    parseInt(posts.rows[0].count),
      pending_payments: parseInt(payments.rows[0].count),
    })
  } catch (err) {
    console.error('Admin stats error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Admin users list ────────────────────────────────
app.get('/api/admin/users', adminOnly, async (req, res) => {
  if (!pool) return res.json([])
  const search = req.query.search || ''
  const limit  = parseInt(req.query.limit) || 50
  const offset = parseInt(req.query.offset) || 0
  try {
    const query = search
      ? `SELECT id, username, first_name, subscribed, subscription_until, subscription_plan, referral_count, tv_username
         FROM users WHERE username ILIKE $1 OR first_name ILIKE $1 OR id::text = $2 OR tv_username ILIKE $1
         ORDER BY subscription_until DESC NULLS LAST, id DESC LIMIT $3 OFFSET $4`
      : `SELECT id, username, first_name, subscribed, subscription_until, subscription_plan, referral_count, tv_username
         FROM users ORDER BY subscription_until DESC NULLS LAST, id DESC LIMIT $1 OFFSET $2`
    const params = search ? [`%${search}%`, search, limit, offset] : [limit, offset]
    const { rows } = await pool.query(query, params)
    const result = rows.map(u => {
      const until = u.subscription_until ? new Date(u.subscription_until) : null
      const active = until && until > new Date()
      const daysLeft = active ? Math.ceil((until - new Date()) / 86400000) : null
      return { ...u, active, daysLeft }
    })
    res.json(result)
  } catch (err) {
    console.error('Admin users error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Admin activate subscription ────────────────────
app.post('/api/admin/user/:id/activate', adminOnly, async (req, res) => {
  if (!pool) return res.sendStatus(503)
  const userId = parseInt(req.params.id)
  const { plan = 'PRO', days = 30 } = req.body
  try {
    await pool.query(`
      UPDATE users SET
        subscribed = TRUE,
        subscription_plan = $1,
        subscription_until = NOW() + ($2 || ' days')::INTERVAL
      WHERE id = $3
    `, [plan, days, userId])

    // Отправить уведомление пользователю через бота
    if (BOT_TOKEN) {
      const planName = plan === 'PRO' ? '💎 PRO' : '📊 STANDARD'
      const msg = `✅ Подписка активирована!\n\n${planName} — ${days} дней\n\nДобро пожаловать в IT v3! 🚀`
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: userId, text: msg })
      }).catch(() => {})
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('Admin activate error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Admin deactivate subscription ──────────────────
app.post('/api/admin/user/:id/deactivate', adminOnly, async (req, res) => {
  if (!pool) return res.sendStatus(503)
  const userId = parseInt(req.params.id)
  try {
    await pool.query(`UPDATE users SET subscribed = FALSE, subscription_until = NULL WHERE id = $1`, [userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('Admin deactivate error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Admin payment requests ─────────────────────────
app.get('/api/admin/payments', adminOnly, async (req, res) => {
  if (!pool) return res.json([])
  try {
    const { rows } = await pool.query(
      `SELECT * FROM payment_requests ORDER BY created_at DESC LIMIT 50`
    )
    res.json(rows)
  } catch (err) {
    console.error('Admin payments error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Save payment request (from bot) ────────────────
app.post('/api/payment-request', async (req, res) => {
  // Accept both API key (bot) and tg_id (mini-app)
  const isBot = req.headers['x-api-key'] === API_KEY
  const tgId = String(req.body?.tg_id || '')
  if (!isBot && !tgId) return res.sendStatus(401)

  const { user_id, username, first_name, plan, tx_link, txid, tv_username, note } = req.body
  // mini-app sends tg_id as user identifier; bot sends user_id
  const uid = user_id || tgId
  const txRef = tx_link || txid
  if (!uid || !txRef) return res.status(400).json({ error: 'bad request' })

  try {
    if (pool) {
      await pool.query(
        `INSERT INTO payment_requests (user_id, username, first_name, plan, tx_link, tv_username, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uid, username || null, first_name || null, plan || null, txRef, tv_username || null, note || null]
      )
    }
    // Уведомление админу
    const name = first_name ? `${first_name}${username ? ' @'+username : ''}` : `ID ${uid}`
    const planText = plan ? ` · ${plan}` : ''
    const txDisplay = /^https?:\/\//.test(txRef)
      ? `[Открыть транзакцию](${txRef})`
      : `\`${txRef}\``
    const adminText = `💳 *Заявка на активацию*\n\nОт: ${name}${planText}\nTX: ${txDisplay}\nTV: ${tv_username || '—'}${note ? '\n\n'+note : ''}`
    await sendToAdmin(adminText).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error('Payment request save error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Admin broadcast post ───────────────────────────
app.post('/api/admin/broadcast', adminOnly, async (req, res) => {
  const { title, body, tag, image_url } = req.body
  if (!body && !title) return res.sendStatus(400)

  let savedId = null

  // Сохранить пост в БД
  const audience = req.body.audience || 'all'
  const visibility = audience === 'PRO' ? 'PRO' : audience === 'STANDARD' ? 'STANDARD' : 'ALL'
  if (pool) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO app_posts (title, body, image_url, tag, visibility) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [title||null, body||null, image_url||null, tag||'АНАЛИТИКА', visibility]
      )
      savedId = rows[0].id
    } catch (err) {
      console.error('Broadcast save error:', err.message)
    }
  }

  // Собрать список подписчиков (audience: all | PRO | STANDARD)
  let subscribers = []
  if (pool) {
    try {
      const planFilter = audience === 'all'
        ? '' : `AND subscription_plan = '${audience === 'PRO' ? 'PRO' : 'STANDARD'}'`
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE subscribed = TRUE AND subscription_until > NOW() ${planFilter}`
      )
      subscribers = rows.map(r => r.id)
    } catch (err) {
      console.error('Broadcast get subs error:', err.message)
    }
  }

  // Отправить через бота
  const text = [
    title ? `*${title}*` : null,
    body || null,
    tag ? `\n🏷 ${tag}` : null,
    '\n📱 _IT v3_'
  ].filter(Boolean).join('\n\n')

  let sent = 0, failed = 0
  for (const id of subscribers) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text, parse_mode: 'Markdown' })
      })
      sent++
      await new Promise(r => setTimeout(r, 50))
    } catch (_) { failed++ }
  }

  res.json({ ok: true, savedId, sent, failed, total: subscribers.length })
})

// ─── API: Admin broadcast с фото ─────────────────────────
app.post('/api/admin/broadcast-photo', adminOnly, async (req, res) => {
  const { title, body, tag, audience, image_b64 } = req.body
  if (!image_b64) return res.sendStatus(400)

  const caption = [
    body || null,
    tag ? `🏷 ${tag}` : null,
  ].filter(Boolean).join('\n\n')

  // Сохранить пост в БД
  // Декодировать base64 → Buffer
  const base64 = image_b64.replace(/^data:image\/\w+;base64,/, '')
  const imgBuf = Buffer.from(base64, 'base64')

  // Получить подписчиков
  const planFilter = !audience || audience === 'all' ? ''
    : `AND subscription_plan = '${audience}'`
  let subscribers = []
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE subscribed = TRUE AND subscription_until > NOW() ${planFilter}`
      )
      subscribers = rows.map(r => r.id)
    } catch (e) { console.error('Get subs error:', e.message) }
  }

  let sent = 0, failed = 0, fileId = null, savedId = null
  for (const chatId of subscribers) {
    try {
      const fd = new FormData()
      fd.append('chat_id', String(chatId))
      fd.append('caption', caption)
      fd.append('parse_mode', 'Markdown')
      // После первой отправки можно переиспользовать file_id
      if (fileId) {
        fd.append('photo', fileId)
      } else {
        fd.append('photo', new Blob([imgBuf], { type: 'image/jpeg' }), 'banner.jpg')
      }

      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: 'POST', body: fd
      })
      const j = await r.json()
      if (j.ok) {
        sent++
        // Берём file_id из первого успешного ответа
        if (!fileId) {
          const photos = j.result?.photo || []
          fileId = photos[photos.length - 1]?.file_id || null
        }
      } else { failed++; console.error('sendPhoto error:', j.description) }
      await new Promise(r => setTimeout(r, 60))
    } catch (e) { failed++; console.error('sendPhoto exception:', e.message) }
  }

  // Сохраняем пост с file_id (не base64)
  const visibilityPhoto = !audience || audience === 'all' ? 'ALL' : audience
  if (pool && (sent > 0 || subscribers.length === 0)) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO app_posts (title, body, tag, file_id, visibility) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [title||null, body||null, tag||'АНАЛИТИКА', fileId, visibilityPhoto]
      )
      savedId = rows[0].id
    } catch (e) { console.error('Save post error:', e.message) }
  }

  res.json({ ok: true, savedId, sent, failed, total: subscribers.length })
})

// ─── API: Admin test-send (to admin only + save to feed) ──
app.post('/api/admin/test-send', adminOnly, async (req, res) => {
  const { title, body, tag, image_b64 } = req.body
  if (!image_b64) return res.sendStatus(400)

  const adminChatId = String(req.query.tg_id || req.body?.tg_id || '562914492')

  const caption = [
    body || null,
    tag ? `🏷 ${tag}` : null,
  ].filter(Boolean).join('\n\n')

  const base64 = image_b64.replace(/^data:image\/\w+;base64,/, '')
  const imgBuf = Buffer.from(base64, 'base64')

  let savedId = null, fileId = null

  try {
    // 1. Шлём фото в Telegram — берём file_id
    const fd = new FormData()
    fd.append('chat_id', adminChatId)
    fd.append('caption', caption)
    fd.append('parse_mode', 'Markdown')
    fd.append('photo', new Blob([imgBuf], { type: 'image/jpeg' }), 'banner.jpg')

    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST', body: fd
    })
    const j = await r.json()
    if (!j.ok) {
      console.error('test-send error:', j)
      return res.json({ ok: false, error: j.description })
    }
    // Берём file_id из ответа (самое большое фото)
    const photos = j.result?.photo || []
    fileId = photos[photos.length - 1]?.file_id || null

    // 2. Сохраняем пост в ленту с file_id (не base64!)
    if (pool) {
      const { rows } = await pool.query(
        `INSERT INTO app_posts (title, body, tag, file_id) VALUES ($1,$2,$3,$4) RETURNING id`,
        [title||null, body||null, tag||'ТЕСТ', fileId]
      ).catch(e => { console.error('Save test post error:', e.message); return { rows: [] } })
      savedId = rows[0]?.id || null
    }

    res.json({ ok: true, chat_id: adminChatId, savedId, fileId })
  } catch (e) {
    res.json({ ok: false, error: e.message, savedId })
  }
})

// ─── API: Admin news post (simple image + text, no banner) ──
app.post('/api/admin/news', adminOnly, async (req, res) => {
  const { title, body, audience, image_b64 } = req.body
  if (!body && !title && !image_b64) return res.sendStatus(400)

  const visibility = audience === 'PRO' ? 'PRO' : audience === 'STANDARD' ? 'STANDARD' : 'ALL'
  const planFilter = !audience || audience === 'all' ? ''
    : `AND subscription_plan = '${audience}'`

  let savedId = null, fileId = null, sent = 0, failed = 0

  // Получаем подписчиков
  let subscribers = []
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE subscribed = TRUE AND subscription_until > NOW() ${planFilter}`
      )
      subscribers = rows.map(r => r.id)
    } catch (e) { console.error('News get subs error:', e.message) }
  }

  const text = [title ? `*${title}*` : null, body || null, '\n📱 _IT v3_'].filter(Boolean).join('\n\n')
  const caption = [title ? `*${title}*` : null, body || null].filter(Boolean).join('\n\n')

  if (image_b64) {
    const base64 = image_b64.replace(/^data:image\/\w+;base64,/, '')
    const imgBuf = Buffer.from(base64, 'base64')

    for (const id of subscribers) {
      try {
        const fd = new FormData()
        fd.append('chat_id', String(id))
        fd.append('caption', caption)
        fd.append('parse_mode', 'Markdown')
        if (fileId) {
          fd.append('photo', fileId)
        } else {
          fd.append('photo', new Blob([imgBuf], { type: 'image/jpeg' }), 'news.jpg')
        }
        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd })
        const j = await r.json()
        if (j.ok) {
          sent++
          if (!fileId) fileId = j.result?.photo?.slice(-1)[0]?.file_id || null
        } else { failed++ }
        await new Promise(r => setTimeout(r, 60))
      } catch (e) { failed++ }
    }

    if (pool) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO app_posts (title, body, tag, file_id, visibility, post_type) VALUES ($1,$2,$3,$4,$5,'news') RETURNING id`,
          [title||null, body||null, 'НОВОСТЬ', fileId, visibility]
        )
        savedId = rows[0].id
      } catch (e) { console.error('Save news error:', e.message) }
    }
  } else {
    // Без фото — текст
    for (const id of subscribers) {
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: id, text, parse_mode: 'Markdown' })
        })
        sent++
        await new Promise(r => setTimeout(r, 50))
      } catch (_) { failed++ }
    }
    if (pool) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO app_posts (title, body, tag, visibility, post_type) VALUES ($1,$2,'НОВОСТЬ',$3,'news') RETURNING id`,
          [title||null, body||null, visibility]
        )
        savedId = rows[0].id
      } catch (e) { console.error('Save news error:', e.message) }
    }
  }

  res.json({ ok: true, savedId, sent, failed, total: subscribers.length })
})

// ─── API: Admin delete post ──────────────────────────────
app.delete('/api/admin/posts/:id', adminOnly, async (req, res) => {
  if (!pool) return res.sendStatus(503)
  const id = parseInt(req.params.id)
  if (!id) return res.sendStatus(400)
  try {
    await pool.query(`DELETE FROM app_posts WHERE id = $1`, [id])
    res.json({ ok: true })
  } catch (err) {
    console.error('Delete post error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Approve payment request ────────────────────────
app.post('/api/admin/payments/:id/approve', adminOnly, async (req, res) => {
  if (!pool) return res.sendStatus(503)
  const reqId = parseInt(req.params.id)
  const { days = 30 } = req.body
  try {
    const { rows } = await pool.query(`SELECT * FROM payment_requests WHERE id = $1`, [reqId])
    if (!rows.length) return res.sendStatus(404)
    const pr = rows[0]

    // Activate subscription
    await pool.query(`
      UPDATE users SET subscribed = TRUE, subscription_plan = $1,
        subscription_until = NOW() + ($2 || ' days')::INTERVAL
      WHERE id = $3
    `, [pr.plan || 'PRO', days, pr.user_id])

    await pool.query(`UPDATE payment_requests SET status = 'approved' WHERE id = $1`, [reqId])

    // Notify user
    if (BOT_TOKEN) {
      const planName = (pr.plan || 'PRO') === 'PRO' ? '💎 PRO' : '📊 STANDARD'
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: pr.user_id,
          text: `✅ Оплата подтверждена!\n\n${planName} — ${days} дней активировано 🚀`
        })
      }).catch(() => {})
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('Approve payment error:', err.message)
    res.sendStatus(500)
  }
})

// POST /api/admin/payments/:id/reject
app.post('/api/admin/payments/:id/reject', adminOnly, async (req, res) => {
  if (!pool) return res.sendStatus(503)
  const reqId = parseInt(req.params.id)
  try {
    const { rows } = await pool.query(`SELECT * FROM payment_requests WHERE id = $1`, [reqId])
    if (!rows.length) return res.sendStatus(404)
    const pr = rows[0]
    await pool.query(`UPDATE payment_requests SET status = 'rejected' WHERE id = $1`, [reqId])
    // Уведомить пользователя
    if (BOT_TOKEN) {
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: pr.user_id,
          text: `❌ Заявка на активацию отклонена.\n\nВозможные причины: транзакция не найдена, неверный хеш или сумма не совпадает.\n\nЕсли уверен что всё верно — напиши в поддержку.`,
          parse_mode: 'Markdown'
        })
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('Reject payment error:', err.message)
    res.sendStatus(500)
  }
})

// ─── API: Support messages ────────────────────────────────
// POST /api/support — пользователь отправляет сообщение
app.post('/api/support', async (req, res) => {
  const { user_id, username, first_name, message } = req.body
  if (!user_id || !message?.trim()) return res.status(400).json({ error: 'bad request' })
  try {
    if (pool) {
      await pool.query(
        `INSERT INTO support_messages (user_id, username, first_name, message) VALUES ($1,$2,$3,$4)`,
        [user_id, username || null, first_name || null, message.trim()]
      )
    }
    // Уведомление админу в Telegram
    const name = first_name ? `${first_name}${username ? ' @' + username : ''}` : `ID ${user_id}`
    const adminText = `💬 *Новое обращение*\n\nОт: ${name}\nID: \`${user_id}\`\n\n${message.trim()}`
    await sendToAdmin(adminText)
    res.json({ ok: true })
  } catch (e) {
    console.error('support error:', e.message)
    res.status(500).json({ error: 'server error' })
  }
})

// GET /api/support/history — история обращений пользователя
app.get('/api/support/history', async (req, res) => {
  const tgId = String(req.query.tg_id || '')
  if (!tgId) return res.status(400).json({ error: 'bad request' })
  if (!pool) return res.json([])
  try {
    const { rows } = await pool.query(
      `SELECT id, message, reply, status, created_at, replied_at
       FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC`,
      [tgId]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/support — список обращений (только для админа)
app.get('/api/admin/support', async (req, res) => {
  const tgId = String(req.query.tg_id || '')
  if (!ADMIN_IDS.includes(tgId)) return res.status(403).json({ error: 'forbidden' })
  try {
    if (!pool) return res.json([])
    const { rows } = await pool.query(
      `SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 50`
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/admin/support/:id/reply — ответ на обращение
app.post('/api/admin/support/:id/reply', async (req, res) => {
  const tgId = String(req.query.tg_id || '')
  if (!ADMIN_IDS.includes(tgId)) return res.status(403).json({ error: 'forbidden' })
  const { reply } = req.body
  if (!reply?.trim()) return res.status(400).json({ error: 'empty reply' })
  try {
    if (!pool) return res.status(500).json({ error: 'no db' })
    const { rows } = await pool.query(
      `UPDATE support_messages SET reply=$1, status='replied', replied_at=NOW() WHERE id=$2 RETURNING *`,
      [reply.trim(), req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    const msg = rows[0]
    // Отправить ответ пользователю через бота
    const text = `📬 *Ответ от поддержки:*\n\n${reply.trim()}`
    await bot_sendMessage(msg.user_id, text)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
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

// ─── Whoami ───────────────────────────────────────────────
app.get('/api/whoami', async (req, res) => {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)
    const j = await r.json()
    res.json({ ok: j.ok, bot: j.result || j.description, db: !!pool })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
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
