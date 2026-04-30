# Trading Signal Bot

TradingView → Webhook → Telegram
Монеты: BTCUSDT, ETHUSDT, SOLUSDT

## Установка

```bash
npm install
cp .env.example .env
# Заполни BOT_TOKEN и CHAT_ID в .env
node index.js
```

## Как получить CHAT_ID

1. Напиши боту @userinfobot
2. Он пришлёт твой chat_id

## Настройка TradingView

Для каждого алерта в Pine Script:

1. Открой индикатор IT v2 на нужном тикере и таймфрейме
2. Нажми **Alert** → выбери условие (BUY 50%, BUY 100%, и т.д.)
3. В **Notifications** включи **Webhook URL**
4. Вставь: `https://твой-домен.com/webhook`
5. Повтори для каждого сигнала и каждого тикера

## Какие алерты создать (для каждой монеты × каждый TF)

| Алерт в TV         | Сигнал в боте    |
|--------------------|------------------|
| BUY 50% (SM4)      | buy50            |
| BUY 100% (SM5)     | buy100           |
| SELL 50% (SM2)     | sell50           |
| SELL 100% (SM1)    | sell100          |
| STRONG BUY 100%    | strong_buy100    |
| Тренд вверх        | trend_up         |
| Тренд вниз         | trend_down       |

Итого: 3 монеты × 3 таймфрейма × 7 алертов = **63 алерта**
(TradingView Pro позволяет до 20 алертов, Pro+ — до 100)

## Тест

```
GET https://твой-домен.com/test
```
Отправит тестовое сообщение в Telegram.

## Хостинг

Рекомендую: **Railway.app** или **Render.com** — бесплатный план, HTTPS из коробки.
