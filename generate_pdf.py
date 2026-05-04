from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ─── Регистрируем шрифты ──────────────────────────────────
FONT_REG  = '/System/Library/Fonts/Supplemental/Arial.ttf'
FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
pdfmetrics.registerFont(TTFont('Arial',     FONT_REG))
pdfmetrics.registerFont(TTFont('Arial-Bold', FONT_BOLD))

# ─── Цвета ────────────────────────────────────────────────
BG         = HexColor('#0d0d1a')
CARD_DARK  = HexColor('#12122a')
CARD_BUY   = HexColor('#0d2a1a')
CARD_SELL  = HexColor('#2a0d0d')
CARD_STRONG= HexColor('#1a1200')
CARD_INFO  = HexColor('#0d1a2a')
CARD_WARN  = HexColor('#1a1a0d')
CARD_LIQ   = HexColor('#0a1a2a')

GREEN      = HexColor('#4caf50')
RED        = HexColor('#f44336')
ORANGE     = HexColor('#ff9800')
YELLOW     = HexColor('#ffc107')
BLUE       = HexColor('#2196f3')
PURPLE     = HexColor('#9c27b0')
CYAN       = HexColor('#00bcd4')
WHITE      = HexColor('#ffffff')
GRAY       = HexColor('#8888aa')
LIGHTGRAY  = HexColor('#ccccdd')
GREEN2     = HexColor('#66ff88')

W, H = A4
OUTPUT = '/Users/maksimnovikov/indicator/IT_v3_Guide.pdf'
c = canvas.Canvas(OUTPUT, pagesize=A4)

# ─── Утилиты ──────────────────────────────────────────────
def draw_bg(cv):
    cv.setFillColor(BG)
    cv.rect(0, 0, W, H, fill=1, stroke=0)

def rr(cv, x, y, w, h, r, fill, stroke=None, sw=1):
    cv.setFillColor(fill)
    cv.setStrokeColor(stroke if stroke else fill)
    cv.setLineWidth(sw)
    cv.roundRect(x, y, w, h, r, fill=1, stroke=1 if stroke else 0)

def txt(cv, text, x, y, size=10, color=WHITE, bold=False, align='left'):
    cv.setFillColor(color)
    cv.setFont('Arial-Bold' if bold else 'Arial', size)
    if align == 'center': cv.drawCentredString(x, y, text)
    elif align == 'right': cv.drawRightString(x, y, text)
    else: cv.drawString(x, y, text)

def badge(cv, text, x, y, bg, fg=WHITE, size=8):
    cv.setFont('Arial-Bold', size)
    tw = cv.stringWidth(text, 'Arial-Bold', size)
    pad = 6
    rr(cv, x, y - 4, tw + pad*2, 14, 4, bg)
    cv.setFillColor(fg)
    cv.drawString(x + pad, y + 1, text)
    return tw + pad*2

def dot(cv, x, y, r, color):
    cv.setFillColor(color)
    cv.circle(x, y, r, fill=1, stroke=0)

def arrow(cv, x1, y, x2, color=GRAY):
    cv.setStrokeColor(color)
    cv.setLineWidth(1.5)
    cv.line(x1, y, x2 - 5, y)
    cv.setFillColor(color)
    p = cv.beginPath()
    p.moveTo(x2, y)
    p.lineTo(x2 - 7, y + 4)
    p.lineTo(x2 - 7, y - 4)
    p.close()
    cv.drawPath(p, fill=1, stroke=0)


# ═══════════════════════════════════════════════════════════
# СТРАНИЦА 1 — Обложка
# ═══════════════════════════════════════════════════════════
draw_bg(c)

# Шапка
rr(c, 0, H - 160, W, 160, 0, HexColor('#12122a'))
txt(c, 'IT v3', W/2, H - 65, size=54, color=WHITE, bold=True, align='center')
txt(c, 'Trading Signal System', W/2, H - 90, size=17, color=CYAN, align='center')
txt(c, 'Автоматические торговые сигналы  24/7  Telegram', W/2, H - 112, size=10, color=GRAY, align='center')
c.setStrokeColor(CYAN); c.setLineWidth(1)
c.line(60, H - 125, W - 60, H - 125)

# Монеты
for i, (ico, name, col) in enumerate([('BTC', 'Bitcoin', GREEN), ('ETH', 'Ethereum', BLUE), ('SOL', 'Solana', PURPLE)]):
    bx = 70 + i * 165
    rr(c, bx, H - 157, 145, 28, 6, HexColor('#1a1a3a'), col, 1)
    dot(c, bx + 16, H - 143, 5, col)
    txt(c, ico, bx + 28, H - 148, size=12, color=col, bold=True)
    txt(c, name, bx + 65, H - 148, size=10, color=LIGHTGRAY)

# Таймфреймы
txt(c, 'Таймфреймы:', 60, H - 178, size=9.5, color=GRAY)
for i, tf in enumerate(['1D — День', '4H — 4 Часа', '1H — 1 Час']):
    txt(c, tf, 160 + i*130, H - 178, size=9.5, color=WHITE)

# Архитектура
rr(c, 30, H - 310, W - 60, 110, 10, CARD_DARK, HexColor('#2a2a5a'), 1)
txt(c, 'Как это работает', W/2, H - 215, size=13, color=WHITE, bold=True, align='center')

steps = [
    (45,  H - 295, 'TradingView', 'Индикатор IT v3\nслежу за ценой', CYAN),
    (205, H - 295, 'Railway',     'Node.js сервер\nобрабатывает сигнал', ORANGE),
    (365, H - 295, 'Telegram',    'Уведомление\nна телефон 1-2 сек', GREEN),
]
for bx, by, title, sub, col in steps:
    rr(c, bx, by - 48, 145, 55, 6, HexColor('#1a1a3a'), col, 1)
    txt(c, title, bx + 72, by - 16, size=11, color=col, bold=True, align='center')
    for j, line in enumerate(sub.split('\n')):
        txt(c, line, bx + 72, by - 30 - j*13, size=8, color=LIGHTGRAY, align='center')
    if bx < 365:
        arrow(c, bx + 150, by - 25, bx + 195, GRAY)

# Уровни SM
txt(c, 'Уровни системы', W/2, H - 330, size=13, color=WHITE, bold=True, align='center')
levels = [
    ('SM1', 'SELL 100%', RED,    'Верхняя зона — максимально дорого, выходи полностью'),
    ('SM2', 'SELL 50%',  ORANGE, 'Зона фиксации прибыли — продай половину позиции'),
    ('SM3', 'BUY 25%',   YELLOW, 'Текущая цена — осторожный вход, только на 1D'),
    ('SM4', 'BUY 50%',   GREEN,  'Хорошая зона покупки — входи на 50%'),
    ('SM5', 'BUY 100%',  GREEN2, 'Отличная зона покупки — максимальный вход'),
]
ly = H - 356
for lvl, sig, col, desc in levels:
    rr(c, 30, ly - 14, W - 60, 20, 4, HexColor('#111130'), col, 0.5)
    dot(c, 52, ly - 4, 4, col)
    txt(c, lvl, 62, ly - 9, size=9, color=col, bold=True)
    txt(c, sig, 108, ly - 9, size=9, color=col, bold=True)
    txt(c, desc, 190, ly - 9, size=8.5, color=LIGHTGRAY)
    ly -= 24

# Что такое STRONG
rr(c, 30, H - 565, W - 60, 60, 8, CARD_STRONG, YELLOW, 1)
dot(c, 50, H - 530, 6, YELLOW)
txt(c, 'STRONG сигнал — три фильтра одновременно', 65, H - 534, size=11, color=YELLOW, bold=True)
for i, f in enumerate(['Объём выше среднего', 'RSI в зоне перекупленности / перепроданности', 'Тренд совпадает с направлением сделки']):
    dot(c, 52, H - 550 - i * 14, 3, GREEN)
    txt(c, f, 62, H - 554 - i * 14, size=9, color=LIGHTGRAY)

# Структура рынка
rr(c, 30, H - 660, W - 60, 75, 8, CARD_WARN, ORANGE, 1)
txt(c, 'Структура рынка — паттерны пиков и впадин', 50, H - 608, size=11, color=ORANGE, bold=True)
rows = [
    ('HH  Higher High', 'Новый максимум выше предыдущего — бычий тренд продолжается', GREEN),
    ('LL  Lower Low',   'Новый минимум ниже предыдущего — медвежий тренд продолжается', RED),
    ('LH  Lower High',  'Максимум ниже предыдущего — бычья структура СЛОМАНА', ORANGE),
    ('HL  Higher Low',  'Минимум выше предыдущего — медвежья структура СЛОМАНА', YELLOW),
]
ry = H - 624
for label, desc, col in rows:
    txt(c, label, 50, ry, size=8.5, color=col, bold=True)
    txt(c, desc, 165, ry, size=8.5, color=LIGHTGRAY)
    ry -= 13

# Стек
rr(c, 30, 28, W - 60, 40, 8, CARD_DARK, HexColor('#2a2a5a'), 1)
txt(c, 'Pine Script v5  +  Node.js  +  Railway  +  Telegram Bot API', W/2, 54, size=9, color=GRAY, align='center')
txt(c, 'BTC  |  ETH  |  SOL   x   1D  |  4H  |  1H', W/2, 38, size=9, color=WHITE, align='center')

c.showPage()


# ═══════════════════════════════════════════════════════════
# СТРАНИЦА 2 — Все сигналы
# ═══════════════════════════════════════════════════════════
draw_bg(c)
txt(c, 'Типы сигналов', W/2, H - 35, size=16, color=WHITE, bold=True, align='center')
txt(c, 'Все уведомления которые приходят в Telegram', W/2, H - 52, size=10, color=GRAY, align='center')
c.setStrokeColor(HexColor('#2a2a5a')); c.setLineWidth(0.5); c.line(30, H - 60, W - 30, H - 60)

def sig_card(cv, x, y, w, h, bg, border, mark_color, title, title_color, fields, btag=None, btag_col=None, note=None):
    rr(cv, x, y, w, h, 8, bg, border, 1)
    dot(cv, x + 16, y + h - 13, 5, mark_color)
    txt(cv, title, x + 28, y + h - 17, size=10.5, color=title_color, bold=True)
    if btag and btag_col:
        cv.setFont('Arial-Bold', 7.5)
        tw = cv.stringWidth(btag, 'Arial-Bold', 7.5)
        bx = x + w - tw - 22
        rr(cv, bx, y + h - 21, tw + 14, 13, 3, btag_col)
        cv.setFillColor(BG); cv.drawString(bx + 7, y + h - 17, btag)
    cv.setStrokeColor(HexColor('#2a2a4a')); cv.setLineWidth(0.4)
    cv.line(x + 8, y + h - 24, x + w - 8, y + h - 24)
    ry = y + h - 37
    for label, val, vcol in fields:
        txt(cv, label, x + 12, ry, size=8, color=GRAY)
        txt(cv, val, x + w - 12, ry, size=8, color=vcol, bold=True, align='right')
        ry -= 13
    if note:
        rr(cv, x + 8, y + 5, w - 16, 15, 3, HexColor('#1a1a00'))
        dot(cv, x + 18, y + 13, 3, YELLOW)
        txt(cv, note, x + 26, y + 9, size=7.5, color=YELLOW)

cards = [
    (28, H-175, 252, 107, CARD_BUY,    GREEN,   GREEN,   'BUY 100% — SM5',       GREEN2,
     [('Уровень','SM5',GREEN2),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Действие','Максимальный вход',WHITE),('Подтверждение','Цена достигла SM5',GRAY)],
     'ПОКУПКА', HexColor('#1a4a1a'), None),

    (292, H-175, 252, 107, CARD_BUY,   HexColor('#4a7a2a'), HexColor('#8bc34a'), 'BUY 50% — SM4', HexColor('#8bc34a'),
     [('Уровень','SM4',HexColor('#8bc34a')),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Действие','Хорошая зона входа',WHITE),('Подтверждение','Цена достигла SM4',GRAY)],
     'ПОКУПКА', HexColor('#2a4a10'), None),

    (28, H-300, 252, 107, CARD_SELL,   RED,     RED,     'SELL 100% — SM1',      RED,
     [('Уровень','SM1',RED),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Действие','Полный выход из позиции',WHITE),('Подтверждение','Цена достигла SM1',GRAY)],
     'ПРОДАЖА', HexColor('#4a1010'), None),

    (292, H-300, 252, 107, CARD_SELL,  ORANGE,  ORANGE,  'SELL 50% — SM2',       ORANGE,
     [('Уровень','SM2',ORANGE),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Действие','Фиксация прибыли',WHITE),('Подтверждение','Цена достигла SM2',GRAY)],
     'ПРОДАЖА', HexColor('#4a2a10'), None),

    (28, H-430, 252, 122, CARD_STRONG, YELLOW,  YELLOW,  'STRONG BUY 100%',      YELLOW,
     [('Уровень','SM5',GREEN2),('Объём','OK — выше среднего',GREEN),('RSI','OVERSOLD < 30',GREEN),('Тренд','Совпадает с покупкой',GREEN),('Вес','Максимальный',YELLOW)],
     'СИЛЬНЫЙ', HexColor('#4a3a00'), 'Все 3 фильтра совпали — действуй!'),

    (292, H-430, 252, 122, CARD_STRONG, HexColor('#ff5722'), HexColor('#ff5722'), 'STRONG SELL 100%', HexColor('#ff5722'),
     [('Уровень','SM1',RED),('Объём','OK — выше среднего',GREEN),('RSI','OVERBOUGHT > 70',RED),('Тренд','Совпадает с продажей',GREEN),('Вес','Максимальный',YELLOW)],
     'СИЛЬНЫЙ', HexColor('#4a1a00'), 'Все 3 фильтра совпали — действуй!'),

    (28, H-540, 252, 102, CARD_INFO,   CYAN,    CYAN,    'Тренд вверх',          CYAN,
     [('Сигнал','Закрытие выше SMA50',CYAN),('Смысл','Бычий рынок активен',WHITE),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Рекомендация','Искать покупки',GREEN)],
     'ТРЕНД', HexColor('#003a4a'), None),

    (292, H-540, 252, 102, CARD_INFO,  HexColor('#e91e63'), HexColor('#e91e63'), 'Тренд вниз', HexColor('#e91e63'),
     [('Сигнал','Закрытие ниже SMA50',HexColor('#e91e63')),('Смысл','Медвежий рынок активен',WHITE),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Рекомендация','Искать продажи',RED)],
     'ТРЕНД', HexColor('#4a0028'), None),

    (28, H-655, 252, 107, CARD_WARN,   ORANGE,  ORANGE,  'Слом структуры LH',    ORANGE,
     [('Паттерн','LH после HH',ORANGE),('Смысл','Бычья структура сломана',WHITE),('Таймфреймы','1D · 4H',LIGHTGRAY),('Сигнал','Возможный разворот вниз',RED)],
     'СТРУКТУРА', HexColor('#4a2a00'), None),

    (292, H-655, 252, 107, CARD_WARN,  HexColor('#cddc39'), HexColor('#cddc39'), 'Разворот HL', HexColor('#cddc39'),
     [('Паттерн','HL после LL',HexColor('#cddc39')),('Смысл','Медвежья структура сломана',WHITE),('Таймфреймы','1D · 4H',LIGHTGRAY),('Сигнал','Возможный разворот вверх',GREEN)],
     'СТРУКТУРА', HexColor('#3a4a00'), None),

    (28, H-760, 252, 97, CARD_LIQ,    GREEN,   GREEN,   'Buyside зона НАЙДЕНА', GREEN,
     [('Тип','Ликвидность',CYAN),('Уровень','Скопление покупок',WHITE),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Смысл','Стопы покупателей выше зоны',GRAY)],
     'ЛИКВИДНОСТЬ', HexColor('#003a1a'), None),

    (292, H-760, 252, 97, CARD_LIQ,   HexColor('#ff5252'), HexColor('#ff5252'), 'Buyside зона ПРОБИТА', HexColor('#ff5252'),
     [('Тип','Пробой ликвидности',CYAN),('Уровень','Стопы выбиты',WHITE),('Таймфреймы','1D · 4H · 1H',LIGHTGRAY),('Сигнал','Возможный разворот вниз',RED)],
     'ЛИКВИДНОСТЬ', HexColor('#3a0a0a'), None),
]
for card in cards:
    sig_card(c, *card)

# Пивоты
rr(c, 28, 28, W - 56, 52, 8, CARD_DARK, HexColor('#4a3a00'), 1)
dot(c, 46, 60, 5, YELLOW)
txt(c, 'Пивоты HH / LL + Фибоначчи', 58, 56, size=11, color=YELLOW, bold=True)
badge(c, 'ТОЛЬКО 1D', W - 95, 52, HexColor('#4a3a00'), YELLOW)
txt(c, 'При каждом новом максимуме (HH) или минимуме (LL) автоматически рассчитываются уровни коррекции:', 40, 42, size=8, color=LIGHTGRAY)
txt(c, '0.382  |  0.500  |  0.618  — зоны возможного отката или отскока цены', 40, 30, size=8, color=GRAY)

c.showPage()


# ═══════════════════════════════════════════════════════════
# СТРАНИЦА 3 — Примеры сообщений
# ═══════════════════════════════════════════════════════════
draw_bg(c)
txt(c, 'Примеры уведомлений в Telegram', W/2, H - 35, size=16, color=WHITE, bold=True, align='center')
c.setStrokeColor(HexColor('#2a2a5a')); c.setLineWidth(0.5); c.line(30, H - 48, W - 30, H - 48)

def tg_msg(cv, x, y, w, lines, accent):
    total_h = sum(14 if t else 7 for t, *_ in lines) + 18
    rr(cv, x, y - total_h, w, total_h, 8, HexColor('#151528'), accent, 1.5)
    # цветная полоска слева
    cv.setFillColor(accent)
    cv.roundRect(x, y - total_h, 3, total_h, 1, fill=1, stroke=0)
    ry = y - 14
    for row in lines:
        if not row[0]:
            ry -= 4; continue
        text, size, color, bold = row
        txt(cv, text, x + 12, ry, size=size, color=color, bold=bold)
        ry -= 14
    return total_h

msgs = [
    (28, H - 60, 248, [
        ('BUY 100%', 11, GREEN2, True),
        ('', 0,0,0),
        ('BTC  x  1 День', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       77 335', 9, LIGHTGRAY, False),
        ('Уровень:    SM5', 9, LIGHTGRAY, False),
        ('', 0,0,0),
        ('01.05.2026, 11:35', 8, GRAY, False),
    ], GREEN2),

    (290, H - 60, 248, [
        ('STRONG BUY 100%', 11, YELLOW, True),
        ('', 0,0,0),
        ('BTC  x  4 Часа', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       62 200', 9, LIGHTGRAY, False),
        ('Уровень:    SM5', 9, LIGHTGRAY, False),
        ('Объём подтвержден', 8.5, GREEN, False),
        ('RSI в зоне', 8.5, GREEN, False),
        ('Тренд совпадает', 8.5, GREEN, False),
        ('', 0,0,0),
        ('Все три фильтра совпали', 8.5, YELLOW, True),
        ('01.05.2026, 09:00', 8, GRAY, False),
    ], YELLOW),

    (28, H - 310, 248, [
        ('SELL 50%', 11, RED, True),
        ('', 0,0,0),
        ('ETH  x  1 День', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       2 606', 9, LIGHTGRAY, False),
        ('Уровень:    SM2', 9, LIGHTGRAY, False),
        ('', 0,0,0),
        ('01.05.2026, 14:00', 8, GRAY, False),
    ], RED),

    (290, H - 310, 248, [
        ('Тренд вверх', 11, CYAN, True),
        ('', 0,0,0),
        ('SOL  x  4 Часа', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       142.5', 9, LIGHTGRAY, False),
        ('', 0,0,0),
        ('Закрытие выше SMA50', 8.5, CYAN, False),
        ('Бычий тренд', 8.5, CYAN, False),
        ('', 0,0,0),
        ('01.05.2026, 16:00', 8, GRAY, False),
    ], CYAN),

    (28, H - 515, 248, [
        ('Слом структуры', 11, ORANGE, True),
        ('', 0,0,0),
        ('BTC  x  1 День', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       77 268', 9, LIGHTGRAY, False),
        ('', 0,0,0),
        ('LH после HH', 8.5, ORANGE, False),
        ('Бычья структура сломана', 8.5, ORANGE, False),
        ('', 0,0,0),
        ('01.05.2026, 18:00', 8, GRAY, False),
    ], ORANGE),

    (290, H - 515, 248, [
        ('HH — локальный хай', 11, GREEN2, True),
        ('', 0,0,0),
        ('BTC  x  1 День', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       88 500', 9, LIGHTGRAY, False),
        ('', 0,0,0),
        ('Фибо коррекция вниз', 9, LIGHTGRAY, True),
        ('0.382  ->  79 400', 8.5, GREEN2, False),
        ('0.500  ->  75 000', 8.5, YELLOW, False),
        ('0.618  ->  70 600', 8.5, RED, False),
        ('', 0,0,0),
        ('01.05.2026, 20:00', 8, GRAY, False),
    ], GREEN2),

    (28, H - 720, 248, [
        ('Buyside ликвидность НАЙДЕНА', 10, GREEN, True),
        ('', 0,0,0),
        ('BTC  x  4 Часа', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       77 450', 9, LIGHTGRAY, False),
        ('Уровень:    77 450', 9, LIGHTGRAY, False),
        ('', 0,0,0),
        ('Скопление покупок выше зоны', 8.5, CYAN, False),
        ('', 0,0,0),
        ('01.05.2026, 12:00', 8, GRAY, False),
    ], GREEN),

    (290, H - 720, 248, [
        ('Buyside ликвидность ПРОБИТА', 10, HexColor('#ff5252'), True),
        ('', 0,0,0),
        ('BTC  x  4 Часа', 9, WHITE, True),
        ('', 0,0,0),
        ('Цена:       78 100', 9, LIGHTGRAY, False),
        ('Уровень:    77 450', 9, LIGHTGRAY, False),
        ('', 0,0,0),
        ('Стопы выбиты', 8.5, HexColor('#ff5252'), False),
        ('Возможный разворот вниз', 8.5, HexColor('#ff5252'), False),
        ('', 0,0,0),
        ('01.05.2026, 15:10', 8, GRAY, False),
    ], HexColor('#ff5252')),
]

for x, y, w, lines, accent in msgs:
    tg_msg(c, x, y, w, lines, accent)

c.setStrokeColor(HexColor('#2a2a5a')); c.setLineWidth(0.5); c.line(30, 30, W - 30, 30)
txt(c, 'IT v3 Trading Signal System  |  TradingView + Railway + Telegram', W/2, 18, size=8, color=GRAY, align='center')

c.showPage()
c.save()
print(f'PDF создан: {OUTPUT}')
