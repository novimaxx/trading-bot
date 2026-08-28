// ═══════════════════════════════════════════════════════════
//  Алерты по уровням SM
//  Пользователь ставит будильник на уровень из мини-аппа,
//  воркер раз в минуту проверяет пересечение и шлёт в Telegram.
// ═══════════════════════════════════════════════════════════

const { fetchKlines } = require('./binance')
const { compute } = require('./indicator')

const LEVEL_LABEL = {
  sm1: 'SELL 100%', sm2: 'SELL 50%', sm3: 'BUY 25%',
  sm4: 'BUY 50%',   sm5: 'BUY 100%',
}
// К уровням продаж цена подходит снизу, к уровням покупок — сверху
const CROSS_UP = new Set(['sm1', 'sm2'])

// Повторно по тому же алерту не пишем раньше, чем через это время
const COOLDOWN_MS = 6 * 60 * 60 * 1000

let pool = null
let sendTg = null
let timer = null

async function init(dbPool, sender) {
  pool = dbPool
  sendTg = sender
  if (!pool) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chart_alerts (
      id            SERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL,
      symbol        TEXT NOT NULL,
      interval      TEXT NOT NULL DEFAULT '1d',
      level         TEXT NOT NULL,
      active        BOOLEAN DEFAULT TRUE,
      created_at    TIMESTAMP DEFAULT NOW(),
      last_fired_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS chart_alerts_user ON chart_alerts(user_id);
  `)

  clearInterval(timer)
  timer = setInterval(() => tick().catch(e => console.error('alerts tick:', e.message)), 60_000)
  console.log('✓ Алерты по уровням запущены')
}

// ─── CRUD ─────────────────────────────────────────────────
const MAX_PER_USER = 30

async function list(userId) {
  const { rows } = await pool.query(
    `SELECT id, symbol, interval, level, active, created_at, last_fired_at
       FROM chart_alerts WHERE user_id = $1 ORDER BY created_at DESC`, [userId])
  return rows.map(r => ({ ...r, label: LEVEL_LABEL[r.level] || r.level }))
}

async function create(userId, symbol, interval, level) {
  if (!LEVEL_LABEL[level]) throw new Error('bad level')

  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM chart_alerts WHERE user_id = $1 AND active`, [userId])
  if (count >= MAX_PER_USER) throw new Error('limit')

  // Один и тот же уровень дважды не заводим
  const { rows: dup } = await pool.query(
    `SELECT id FROM chart_alerts
      WHERE user_id = $1 AND symbol = $2 AND interval = $3 AND level = $4 AND active`,
    [userId, symbol, interval, level])
  if (dup.length) return { id: dup[0].id, duplicate: true }

  const { rows } = await pool.query(
    `INSERT INTO chart_alerts (user_id, symbol, interval, level)
     VALUES ($1,$2,$3,$4) RETURNING id`, [userId, symbol, interval, level])
  return { id: rows[0].id }
}

async function remove(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM chart_alerts WHERE id = $1 AND user_id = $2`, [id, userId])
  return rowCount > 0
}

async function isActivePro(userId) {
  if (!pool) return false
  const { rowCount } = await pool.query(
    `SELECT 1 FROM users
      WHERE id = $1 AND subscribed = TRUE
        AND subscription_plan = 'PRO' AND subscription_until > NOW()`,
    [userId])
  return rowCount > 0
}

// ─── Воркер ───────────────────────────────────────────────
// Уровень достигнут: к SELL-уровням цена подходит снизу максимумом,
// к BUY-уровням — сверху минимумом. Прошлый бар уровня ещё не касался.
function crossed(level, bar, barPrev, lvl, lvlPrev) {
  return CROSS_UP.has(level)
    ? barPrev.high <  lvlPrev && bar.high >= lvl
    : barPrev.low  >  lvlPrev && bar.low  <= lvl
}

async function tick() {
  if (!pool || !sendTg) return

  const { rows: alerts } = await pool.query(
    `SELECT * FROM chart_alerts
      WHERE active AND (last_fired_at IS NULL OR last_fired_at < NOW() - INTERVAL '6 hours')`)
  if (!alerts.length) return

  // Группируем по паре свечей, чтобы не дёргать Binance на каждый алерт
  const groups = new Map()
  for (const a of alerts) {
    const key = `${a.symbol}|${a.interval}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(a)
  }

  for (const [key, group] of groups) {
    const [symbol, interval] = key.split('|')
    try {
      const candles = await fetchKlines(symbol, interval, 300)
      const daily = interval === '1d' ? candles : await fetchKlines(symbol, '1d', 400)
      const r = compute(candles, daily, interval)

      const n = r.levels.length
      const cur = r.levels[n - 1], prev = r.levels[n - 2]
      if (!cur || !prev) continue

      const bar = candles[n - 1], barPrev = candles[n - 2]

      for (const a of group) {
        const lvl = cur[a.level], lvlPrev = prev[a.level]
        if (lvl == null || lvlPrev == null) continue

        if (!crossed(a.level, bar, barPrev, lvl, lvlPrev)) continue

        await fire(a, lvl, bar.close)
      }
    } catch (err) {
      console.error(`alerts ${key}:`, err.message)
    }
  }
}

async function fire(alert, level, price) {
  const coin = alert.symbol.replace('USDT', '')
  const buy  = !CROSS_UP.has(alert.level)
  const text =
    `${buy ? '🟢' : '🔴'} *${LEVEL_LABEL[alert.level]}* — ${coin}\n\n` +
    `Цена достигла уровня *${alert.level.toUpperCase()}*\n` +
    `💰 Цена: \`${price}\`\n` +
    `📍 Уровень: \`${level.toFixed(price < 1 ? 8 : 2)}\`\n` +
    `🕐 ${alert.interval.toUpperCase()}`

  try {
    await sendTg(alert.user_id, text)
    await pool.query(`UPDATE chart_alerts SET last_fired_at = NOW() WHERE id = $1`, [alert.id])
  } catch (err) {
    console.error('alert send:', err.message)
  }
}

module.exports = { init, list, create, remove, isActivePro, tick, crossed, LEVEL_LABEL, MAX_PER_USER }
