// ═══════════════════════════════════════════════════════════
//  IT v3 — расчётное ядро
//  Порт логики SM-уровней и сигналов из indicator_v3.pine на JS.
//  Считает по свечам Binance, TradingView в цепочке не участвует.
// ═══════════════════════════════════════════════════════════

// Значения по умолчанию — 1:1 с inputs в indicator_v3.pine
const DEFAULTS = {
  smaLen:     12,     // база уровней (дневная SMA)
  perc1:      27.2020, // SM1 % выше базы — SELL 100%
  perc2:      12.7845, // SM2 % выше базы — SELL 50%
  perc4:       9.1156, // SM4 % ниже базы — BUY 50%
  perc5:      19.0250, // SM5 % ниже базы — BUY 100%
  trendLen:   50,     // оранжевая SMA — глобальный тренд
  rsiLen:     14,
  rsiBuyLvl:  35,
  rsiSellLvl: 65,
  volLen:     20,
  useTrend:   true,
  useVol:     true,
  useRSI:     true,
  // структура рынка и ликвидность
  pivotLen:   5,      // период пивота для HH/LH/HL/LL
  liqLen:     7,      // Detection Length зон ликвидности
  liqMargin:  6.9,    // Margin — ширина зоны в долях ATR
  liqZones:   3,      // сколько зон каждой стороны держим
}

const DAY_MS = 86_400_000

// ─── Базовые функции ──────────────────────────────────────

// ta.sma — простая скользящая. null пока не набралось length значений.
function sma(values, length) {
  const out = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= length) sum -= values[i - length]
    if (i >= length - 1) out[i] = sum / length
  }
  return out
}

// ta.rsi — сглаживание Уайлдера (RMA), как в Pine
function rsi(values, length) {
  const out = new Array(values.length).fill(null)
  if (values.length < length + 1) return out

  let gain = 0, loss = 0
  for (let i = 1; i <= length; i++) {
    const d = values[i] - values[i - 1]
    if (d > 0) gain += d
    else loss -= d
  }
  let avgGain = gain / length
  let avgLoss = loss / length
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = length + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    avgGain = (avgGain * (length - 1) + (d > 0 ?  d : 0)) / length
    avgLoss = (avgLoss * (length - 1) + (d < 0 ? -d : 0)) / length
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

// ta.crossover / ta.crossunder — пересечение на текущем баре
const crossover  = (a, b, aPrev, bPrev) =>
  a != null && b != null && aPrev != null && bPrev != null && aPrev <= bPrev && a > b
const crossunder = (a, b, aPrev, bPrev) =>
  a != null && b != null && aPrev != null && bPrev != null && aPrev >= bPrev && a < b

// ─── База уровней ─────────────────────────────────────────
// В Pine база берётся с дневного таймфрейма через request.security
// и интерполируется внутри дня. Здесь то же самое, но явно.
//
// ⚠️ Внутридневная интерполяция: в Pine progress считается от открытия
// ПРЕДЫДУЩЕГО дня, из-за чего внутри дня получается экстраполяция
// (progress > 1). Здесь progress нормирован в [0..1] внутри текущего
// дня — на границах дней результат совпадает, внутри дня линия идёт
// плавнее. На 1D расхождений нет вообще.
function levelBase(candles, daily, interval, cfg) {
  const n = candles.length

  // На дневном ТФ база — это ровно SMA(close, smaLen) по этим же свечам
  if (interval === '1d') {
    return sma(candles.map(c => c.close), cfg.smaLen)
  }

  const dClose = daily.map(c => c.close)
  const dSma   = sma(dClose, cfg.smaLen)

  // индекс дневной свечи по времени бара
  let d = 0
  const out = new Array(n).fill(null)

  for (let i = 0; i < n; i++) {
    const t = candles[i].openTime
    while (d + 1 < daily.length && daily[d + 1].openTime <= t) d++
    if (daily[d].openTime > t) { out[i] = null; continue }

    const prev = dSma[d - 1]
    if (prev == null) { out[i] = null; continue }

    // «Развивающаяся» дневная SMA: закрытие текущего дня = цена бара
    const win = dClose.slice(d - cfg.smaLen + 1, d)
    if (win.length !== cfg.smaLen - 1) { out[i] = null; continue }
    const today = (win.reduce((s, v) => s + v, 0) + candles[i].close) / cfg.smaLen

    const progress = Math.min(Math.max((t - daily[d].openTime) / DAY_MS, 0), 1)
    out[i] = prev + (today - prev) * progress
  }
  return out
}

// ─── Пивоты ───────────────────────────────────────────────
// ta.pivothigh(left, right): бар подтверждён, когда справа прошло `right` баров
function pivots(candles, left, right) {
  const hi = new Array(candles.length).fill(null)
  const lo = new Array(candles.length).fill(null)
  for (let i = left; i < candles.length - right; i++) {
    let isH = true, isL = true
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      if (candles[j].high >= candles[i].high) isH = false
      if (candles[j].low  <= candles[i].low)  isL = false
    }
    // подтверждается на баре i+right, как в Pine
    if (isH) hi[i + right] = { i, price: candles[i].high }
    if (isL) lo[i + right] = { i, price: candles[i].low }
  }
  return { hi, lo }
}

// ta.atr
function atr(candles, length) {
  const out = new Array(candles.length).fill(null)
  let prev = null, sum = 0
  const trs = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const tr = i === 0 ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i-1].close), Math.abs(c.low - candles[i-1].close))
    trs.push(tr)
    if (i < length) { sum += tr; if (i === length - 1) { prev = sum / length; out[i] = prev } }
    else { prev = (prev * (length - 1) + tr) / length; out[i] = prev }
  }
  return out
}

// ─── Структура рынка: HH / LH / HL / LL ───────────────────
// Плюс слом структуры: LH после HH и HL после LL.
function marketStructure(candles, pivotLen) {
  const { hi, lo } = pivots(candles, pivotLen, pivotLen)
  const points = []
  let prevSwingHigh = null, prevSwingLow = null
  let prevHighWasHH = false, prevLowWasLL = false
  let structureLH = false, structureHL = false

  for (let i = 0; i < candles.length; i++) {
    if (hi[i]) {
      const isHH = prevSwingHigh == null || hi[i].price > prevSwingHigh
      structureLH = !isHH && prevHighWasHH
      prevHighWasHH = isHH
      prevSwingHigh = hi[i].price
      points.push({ t: candles[hi[i].i].openTime, price: hi[i].price, type: isHH ? 'HH' : 'LH', side: 'high' })
    }
    if (lo[i]) {
      const isHL = prevSwingLow == null || lo[i].price > prevSwingLow
      structureHL = isHL && prevLowWasLL
      prevLowWasLL = !isHL
      prevSwingLow = lo[i].price
      points.push({ t: candles[lo[i].i].openTime, price: lo[i].price, type: isHL ? 'HL' : 'LL', side: 'low' })
    }
  }
  points.sort((a, b) => a.t - b.t)
  return { points, structureLH, structureHL, hi, lo }
}

// ─── Зоны Фибоначчи ───────────────────────────────────────
// Автомат из Pine: LL → HH → LL, зелёное Фибо считается от HH вниз,
// красное — от последнего LL вверх.
const FIB = [0.236, 0.382, 0.5, 0.618, 0.786]

function fibonacci(candles, hi, lo) {
  let state = 0, ll1 = null, hh = null, ll2 = null
  // время опорных точек — чтобы показать, от какого свинга построено
  let ll1t = null, hht = null, ll2t = null
  const T = idx => candles[idx].openTime

  for (let i = 0; i < candles.length; i++) {
    if (lo[i]) {
      const t = T(lo[i].i)
      if (state === 0 || state === 3) { ll1 = lo[i].price; ll1t = t; hh = null; ll2 = null; state = 1 }
      else if (state === 2)           { ll2 = lo[i].price; ll2t = t; state = 3 }
    }
    if (hi[i]) {
      const t = T(hi[i].i)
      if (state === 1)      { hh = hi[i].price; hht = t; ll2 = null; state = 2 }
      else if (state === 3) { ll1 = ll2; ll1t = ll2t; hh = hi[i].price; hht = t; ll2 = null; state = 2 }
    }
  }

  const rangeUp = state >= 2 && ll1 != null && hh != null ? hh - ll1 : null
  const rangeDn = state === 3 && hh != null && ll2 != null ? hh - ll2 : null

  const mk = (base, range, sign) => range == null ? null
    : Object.fromEntries(FIB.map(f => [String(f), base + sign * range * f]))

  return {
    state, hh, ll1, ll2, hhTime: hht, ll1Time: ll1t, ll2Time: ll2t,
    // зелёное: откат вниз от HH
    bull: mk(hh, rangeUp, -1),
    // красное: отскок вверх от LL
    bear: mk(ll2, rangeDn, +1),
  }
}

// ─── Зоны ликвидности BSL / SSL ───────────────────────────
// Порт логики из Pine: держим зигзаг пивотов, и если рядом с новым
// пивотом набирается 3+ старых на расстоянии меньше atr/margin —
// это скопление стопов, рисуем зону.
function liquidity(candles, opts) {
  const len    = opts.liqLen ?? 7
  const margin = 10 / (opts.liqMargin ?? 6.9)
  const maxZones = opts.liqZones ?? 3

  const { hi, lo } = pivots(candles, len, 1)
  const atrArr = atr(candles, 10)

  // зигзаг: 1 = вершина, -1 = впадина
  const zz = []
  const zones = { buy: [], sell: [] }

  for (let i = 0; i < candles.length; i++) {
    const a = atrArr[i]
    if (a == null) continue

    for (const [piv, dir, side] of [[hi[i], 1, 'buy'], [lo[i], -1, 'sell']]) {
      if (!piv) continue
      const price = piv.price

      // обновляем зигзаг: подряд идущие однонаправленные точки схлопываем
      const head = zz[0]
      if (!head || head.d !== dir) zz.unshift({ d: dir, i: piv.i, y: price })
      else if ((dir === 1 && price > head.y) || (dir === -1 && price < head.y)) {
        head.i = piv.i; head.y = price
      }

      // ищем кластер одноимённых пивотов рядом по цене
      const tol = a / margin
      let count = 0, startIdx = null, startPrice = null, minP = -Infinity, maxP = Infinity
      for (const p of zz.slice(0, 50)) {
        if (p.d !== dir) continue
        if (dir === 1  ? p.y > price + tol : p.y < price - tol) break
        if (p.y > price - tol && p.y < price + tol) {
          count++
          startIdx = p.i; startPrice = p.y
          if (p.y > minP) minP = p.y
          if (p.y < maxP) maxP = p.y
        }
      }

      if (count > 2 && startIdx != null) {
        const mid = (minP + maxP) / 2
        const list = zones[side]
        const last = list[0]
        if (last && last.fromIdx === startIdx) {
          last.top = mid + tol; last.bottom = mid - tol; last.toIdx = i
        } else {
          list.unshift({
            side, level: startPrice, top: mid + tol, bottom: mid - tol,
            fromIdx: startIdx, toIdx: i,
          })
          if (list.length > maxZones) list.pop()
        }
      }
    }
  }

  const toTime = z => ({
    side: z.side, level: z.level, top: z.top, bottom: z.bottom,
    from: candles[z.fromIdx].openTime,
    to:   candles[candles.length - 1].openTime,
  })
  return [...zones.buy.map(toTime), ...zones.sell.map(toTime)]
}

// ─── Свечные паттерны ─────────────────────────────────────
function patternAt(c, p) {
  const body  = Math.abs(c.close - c.open)
  const range = c.high - c.low
  const ratio = range > 0 ? body / range : 0

  const isHammer       = c.close > c.open && (c.open - c.low)  > body * 2.0 && (c.high - c.close) < body * 0.5
  const isShootingStar = c.open > c.close && (c.high - c.open) > body * 2.0 && (c.close - c.low)  < body * 0.5
  const isPinBull      = (c.open - c.low)  > (c.high - c.close) * 2.5 && ratio < 0.4
  const isPinBear      = (c.high - c.open) > (c.close - c.low)  * 2.5 && ratio < 0.4
  const isBullEngulf   = p && c.close > c.open && p.close < p.open && c.close > p.open && c.open < p.close
  const isBearEngulf   = p && c.close < c.open && p.close > p.open && c.close < p.open && c.open > p.close

  if (isHammer)       return { dir: 'bull', name: '🔨 Молот' }
  if (isBullEngulf)   return { dir: 'bull', name: '🟢 Поглощение' }
  if (isPinBull)      return { dir: 'bull', name: '📌 Пин-бар' }
  if (isShootingStar) return { dir: 'bear', name: '⭐ Shooting Star' }
  if (isBearEngulf)   return { dir: 'bear', name: '🔴 Поглощение' }
  if (isPinBear)      return { dir: 'bear', name: '📌 Пин-бар' }
  return null
}

// ─── Главная функция ──────────────────────────────────────
// candles — свечи запрошенного ТФ, daily — дневные свечи того же тикера
function compute(candles, daily, interval, options = {}) {
  const cfg = { ...DEFAULTS, ...options }
  const n   = candles.length

  const closes = candles.map(c => c.close)
  const base   = levelBase(candles, daily, interval, cfg)
  const trend  = sma(closes, cfg.trendLen)
  const rsiArr = rsi(closes, cfg.rsiLen)
  const volArr = sma(candles.map(c => c.volume), cfg.volLen)

  const levels = base.map(b => b == null ? null : {
    sm1: b * (1 + cfg.perc1 / 100),
    sm2: b * (1 + cfg.perc2 / 100),
    sm3: b,
    sm4: b * (1 - cfg.perc4 / 100),
    sm5: b * (1 - cfg.perc5 / 100),
  })

  const signals = []
  for (let i = 1; i < n; i++) {
    const L = levels[i], P = levels[i - 1]
    if (!L || !P) continue

    const c = candles[i], p = candles[i - 1]
    const trendUp     = cfg.useTrend ? (trend[i] != null && c.close > trend[i]) : true
    const volOk       = cfg.useVol   ? (volArr[i] != null && c.volume > volArr[i]) : true
    const oversold    = cfg.useRSI   ? (rsiArr[i] != null && rsiArr[i] < cfg.rsiBuyLvl)  : true
    const overbought  = cfg.useRSI   ? (rsiArr[i] != null && rsiArr[i] > cfg.rsiSellLvl) : true

    const fire = (type, strong) =>
      signals.push({ time: c.openTime, type, strong, price: c.close })

    // Кроссы — 1:1 с Pine: buy25 по close, buy50/100 по low, sell по high
    if (crossunder(c.close, L.sm3, p.close, P.sm3) && trendUp)
      fire('buy25',   volOk && oversold)
    if (crossunder(c.low,   L.sm4, p.low,   P.sm4) && trendUp)
      fire('buy50',   volOk && oversold)
    if (crossunder(c.low,   L.sm5, p.low,   P.sm5) && trendUp)
      fire('buy100',  volOk && oversold)
    if (crossover (c.high,  L.sm2, p.high,  P.sm2))
      fire('sell50',  volOk && overbought)
    if (crossover (c.high,  L.sm1, p.high,  P.sm1))
      fire('sell100', volOk && overbought)
  }

  // ─── Текущее состояние — для таблицы в мини-аппе ────────
  const i    = n - 1
  const last = candles[i]
  const L    = levels[i]

  let state = null
  if (L) {
    const rows = [
      { key: 'sm1', label: 'SELL 100%', price: L.sm1 },
      { key: 'sm2', label: 'SELL 50%',  price: L.sm2 },
      { key: 'sm3', label: 'BUY 25%',   price: L.sm3 },
      { key: 'sm4', label: 'BUY 50%',   price: L.sm4 },
      { key: 'sm5', label: 'BUY 100%',  price: L.sm5 },
    ].map(r => ({ ...r, distPct: (r.price - last.close) / last.close * 100 }))

    let nearest = rows[0]
    for (const r of rows) if (Math.abs(r.distPct) < Math.abs(nearest.distPct)) nearest = r

    const pat  = patternAt(last, candles[i - 1])
    const rsiV = rsiArr[i]
    const lastSignal = signals.length ? signals[signals.length - 1] : null

    state = {
      price:   last.close,
      time:    last.openTime,
      rows,
      nearest: nearest.key,
      trend:   trend[i] == null ? null : (last.close > trend[i] ? 'up' : 'down'),
      trendSma: trend[i],
      rsi:     rsiV,
      rsiZone: rsiV == null ? null : rsiV < cfg.rsiBuyLvl ? 'oversold' : rsiV > cfg.rsiSellLvl ? 'overbought' : 'neutral',
      volOk:   volArr[i] != null && last.volume > volArr[i],
      pattern: pat,
      // сигнал считаем актуальным, если он на последней свече
      signal:  lastSignal && lastSignal.time === last.openTime ? lastSignal : null,
    }
  }

  // ─── Структура, Фибо, ликвидность ──────────────────────
  const ms  = marketStructure(candles, cfg.pivotLen)
  const fib = fibonacci(candles, ms.hi, ms.lo)
  const liq = liquidity(candles, cfg)

  if (state) {
    state.structureLH = ms.structureLH
    state.structureHL = ms.structureHL
  }

  return {
    levels, trend, rsi: rsiArr, signals, state, config: cfg,
    pivots: ms.points, fib, liquidity: liq,
  }
}

module.exports = { compute, sma, rsi, DEFAULTS }
