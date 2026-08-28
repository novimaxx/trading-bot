const crypto = require('crypto')

const secret = () => process.env.CHART_SECRET || process.env.BOT_TOKEN || process.env.API_KEY || ''

function safeEqualHex(a, b) {
  if (!/^[a-f0-9]+$/i.test(a || '') || !/^[a-f0-9]+$/i.test(b || '')) return false
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function signUserId(userId) {
  const key = secret()
  if (!key || !userId) return null
  return crypto.createHmac('sha256', key).update(String(userId)).digest('hex')
}

function verifySignedUserId(userId, signature) {
  const expected = signUserId(userId)
  return Boolean(expected && safeEqualHex(expected, String(signature || '')))
}

// Telegram Mini App initData verification:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function userIdFromInitData(initData, maxAgeSeconds = 24 * 60 * 60) {
  if (!initData || !process.env.BOT_TOKEN) return null

  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')

    const authDate = Number(params.get('auth_date'))
    if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) return null

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const webAppKey = crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest()
    const expected = crypto.createHmac('sha256', webAppKey)
      .update(dataCheckString)
      .digest('hex')
    if (!safeEqualHex(expected, hash)) return null

    const user = JSON.parse(params.get('user') || '{}')
    const id = Number(user.id)
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

function userIdFromRequest(req) {
  const initData = req.query?.tg_data || req.body?.tg_data
  const telegramId = userIdFromInitData(initData)
  if (telegramId) return telegramId

  const rawId = req.query?.uid || req.body?.uid
  const id = Number(rawId)
  const signature = req.query?.token || req.body?.token
  return Number.isSafeInteger(id) && id > 0 && verifySignedUserId(id, signature) ? id : null
}

module.exports = { signUserId, verifySignedUserId, userIdFromInitData, userIdFromRequest }
