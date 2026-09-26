(function () {
  'use strict';

  const WIDTH = 400;
  const HEIGHT = 300;
  const WHITE = 0;
  const BLACK = 1;
  const RED = 2;

  const DEFAULT_QUOTA = {
    status: 'ok',
    updated_at: '2026-09-25T20:32:00+08:00',
    plan_type: 'plus',
    five_hour: { remaining_percent: 72 },
    seven_day: { remaining_percent: 77 },
  };

  const FESTIVAL_LABELS = Object.freeze({
    'solar-01-01': '元旦',
    'solar-02-14': '情人',
    'solar-03-08': '妇女',
    'solar-03-12': '植树',
    'solar-04-01': '愚人',
    'solar-05-01': '劳动',
    'solar-05-04': '青年',
    'solar-06-01': '儿童',
    'solar-07-01': '建党',
    'solar-08-01': '建军',
    'solar-09-10': '教师',
    'solar-10-01': '国庆',
    'solar-10-31': '万圣',
    'solar-12-25': '圣诞',
    'lunar-1-1': '春节',
    'lunar-1-15': '元宵',
    'lunar-5-5': '端午',
    'lunar-7-7': '七夕',
    'lunar-8-15': '中秋',
    'lunar-9-9': '重阳',
    'lunar-12-8': '腊八',
    'lunar-12-23': '小年',
    'lunar-12-24': '小年',
  });

  const SPECIAL_SOLAR_FESTIVALS = Object.freeze({
    '2026-04-05': '清明',
  });

  const CHINESE_NUMBERS = Object.freeze({
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    十一: 11, 十二: 12,
  });

  function localDate(year, monthIndex, day) {
    return new Date(year, monthIndex, day, 12, 0, 0, 0);
  }

  function lunarDayLabel(day) {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (day < 10) return `初${digits[day]}`;
    if (day === 10) return '初十';
    if (day < 20) return `十${digits[day - 10]}`;
    if (day === 20) return '二十';
    if (day < 30) return `廿${digits[day - 20]}`;
    return '三十';
  }

  function chineseMonthNumber(monthName) {
    if (String(monthName).includes('正月')) return 1;
    if (String(monthName).includes('冬月')) return 11;
    if (String(monthName).includes('腊月')) return 12;
    const match = String(monthName).match(/([一二三四五六七八九十]+)月/);
    return match ? CHINESE_NUMBERS[match[1]] || null : null;
  }

  function lunarDateFor(inputDate) {
    const date = new Date(inputDate);
    const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    const monthPart = parts.find(part => part.type === 'month');
    const dayPart = parts.find(part => part.type === 'day');
    const yearPart = parts.find(part => part.type === 'yearName');
    const dayNumber = dayPart ? Number(dayPart.value) : NaN;
    const monthNumber = monthPart ? chineseMonthNumber(monthPart.value) : NaN;
    if (!monthPart || !yearPart || !Number.isInteger(monthNumber) || !Number.isInteger(dayNumber)) {
      throw new Error('无法读取本地农历');
    }
    return {
      yearName: yearPart.value,
      monthName: monthPart.value,
      monthNumber,
      dayNumber,
      dayLabel: lunarDayLabel(dayNumber),
    };
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function festivalLabelFor(inputDate, lunar = lunarDateFor(inputDate)) {
    const date = new Date(inputDate);
    const solarKey = `solar-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const special = SPECIAL_SOLAR_FESTIVALS[dateKey(date)];
    if (special) return special;
    if (FESTIVAL_LABELS[solarKey]) return FESTIVAL_LABELS[solarKey];
    if (lunar.monthNumber === 12 && lunar.dayNumber >= 29) return '除夕';
    return FESTIVAL_LABELS[`lunar-${lunar.monthNumber}-${lunar.dayNumber}`] || null;
  }

  function calendarForMonth(inputDate) {
    const date = new Date(inputDate);
    const year = date.getFullYear();
    const monthIndex = date.getMonth();
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const weekCount = Math.ceil((firstWeekday + dayCount) / 7);
    const days = [];
    for (let day = 1; day <= dayCount; day++) {
      const dayDate = localDate(year, monthIndex, day);
      const position = firstWeekday + day - 1;
      const lunar = lunarDateFor(dayDate);
      days.push({
        day,
        column: position % 7,
        row: Math.floor(position / 7),
        lunar,
        festival: festivalLabelFor(dayDate, lunar),
      });
    }
    return { year, month: monthIndex + 1, firstWeekday, weekCount, days };
  }

  function dashboardQuota(quota) {
    const source = quota === undefined ? DEFAULT_QUOTA : (quota && quota.status === 'ok' ? quota : {
      updated_at: null,
      plan_type: null,
      five_hour: null,
      seven_day: null,
    });
    const percent = window => {
      if (!window || typeof window !== 'object') return null;
      const value = Number(window && window.remaining_percent);
      return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
    };
    return {
      updated_at: source.updated_at || null,
      plan_type: typeof source.plan_type === 'string' ? source.plan_type : null,
      five_hour: percent(source.five_hour),
      seven_day: percent(source.seven_day),
    };
  }

  function planLabel(planType) {
    return ({ plus: 'Premium', pro: 'Pro', promax: 'Pro Max', team: 'Team', business: 'Business' }[planType]) || 'Codex';
  }

  function refreshLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--刷新';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}刷新`;
  }

  function measureStampText(text, size) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.font = `600 ${size}px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`;
    return Math.ceil(context.measureText(String(text)).width);
  }

  function browserStampText({ text, x, y, size, color, point }) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const font = `600 ${size}px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`;
    const padding = Math.max(2, Math.ceil(size * 0.28));
    context.font = font;
    canvas.width = Math.max(1, Math.ceil(context.measureText(text).width) + 2);
    canvas.height = Math.max(1, Math.ceil(size * 1.55) + padding);
    context.font = font;
    context.textBaseline = 'top';
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.fillText(text, 0, padding);
    const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const yOffset = alpha.length >= canvas.width * canvas.height * 4 ? padding : 0;
    const mask = new Uint8Array(canvas.width * canvas.height);
    for (let yy = 0; yy < canvas.height; yy++) {
      for (let xx = 0; xx < canvas.width; xx++) {
        const alphaIndex = (yy * canvas.width + xx) * 4 + 3;
        if (alphaIndex < alpha.length && alpha[alphaIndex] >= 96) mask[yy * canvas.width + xx] = 1;
      }
    }

    // Keep the thresholded glyphs at their native rasterized width. Expanding
    // neighboring pixels makes Chinese strokes merge on a 400 x 300 panel.
    const neighbors = [[0, 0]];
    for (let yy = 0; yy < canvas.height; yy++) {
      for (let xx = 0; xx < canvas.width; xx++) {
        if (mask[yy * canvas.width + xx] !== 1) continue;
        for (const [dx, dy] of neighbors) point(x + xx + dx, y + yy - yOffset + dy, color);
      }
    }
  }

  function createPixels(stampText = browserStampText, quota = DEFAULT_QUOTA, now = new Date()) {
    const displayQuota = dashboardQuota(quota);
    const currentDate = new Date(now);
    const calendar = calendarForMonth(currentDate);
    const currentLunar = lunarDateFor(currentDate);
    const pixels = new Uint8Array(WIDTH * HEIGHT);
    function point(x, y, color) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
      if (color !== WHITE && color !== BLACK && color !== RED) return;
      const index = y * WIDTH + x;
      if (color !== BLACK || pixels[index] !== RED) pixels[index] = color;
    }
    function rect(x, y, width, height, color) {
      for (let yy = y; yy < y + height; yy++) {
        for (let xx = x; xx < x + width; xx++) point(xx, yy, color);
      }
    }
    function text(value, x, y, size, color = BLACK, kind) {
      stampText({ text: String(value), x, y, size, color, point, kind });
    }
    function centeredText(value, centerX, y, size, color = BLACK, kind, fallbackX = centerX) {
      if (stampText === browserStampText) {
        text(value, Math.round(centerX - measureStampText(value, size) / 2), y, size, color, kind);
      } else {
        text(value, fallbackX, y, size, color, kind);
      }
    }

    function headerCellCenter(column) {
      return Math.round(11 + ((column + 0.5) * 198) / 7);
    }
    function pixelArt(rows, x, y, scale = 2) {
      rows.forEach((row, iy) => {
        [...row].forEach((symbol, ix) => {
          if (symbol === '#') rect(x + ix * scale, y + iy * scale, scale, scale, BLACK);
          if (symbol === 'R') rect(x + ix * scale, y + iy * scale, scale, scale, RED);
        });
      });
    }

    // Screen coordinates are fixed. A fresh buffer is built on every call.
    text(String(currentDate.getFullYear()), 13, 9, 22, RED);
    text('年', 76, 15, 10);
    const monthText = String(calendar.month);
    const monthX = monthText.length === 1 ? 97 : 91;
    const monthLabelX = monthText.length === 1 ? 116 : 121;
    text(monthText, monthX, 9, 22, RED);
    text('月', monthLabelX, 15, 10);
    // Align the lunar-date row with the small 年/月 glyphs, not with the
    // cap-height of the large year and month numerals.
    text(`${currentLunar.yearName}年${currentLunar.monthName}${currentLunar.dayLabel}`, 151, 15, 9);

    rect(214, 35, 1, 257, BLACK);
    rect(11, 36, 198, 22, BLACK);
    rect(149, 36, 60, 22, RED);
    ['一', '二', '三', '四', '五', '六', '日'].forEach((label, column) => {
      centeredText(label, headerCellCenter(column), 40, 13, WHITE, undefined, headerCellCenter(column));
    });

    const rowHeight = calendar.weekCount === 6 ? 37 : 44;
    for (const entry of calendar.days) {
      const centerX = headerCellCenter(entry.column);
      const y = 66 + entry.row * rowHeight;
      const isWeekend = entry.column >= 5;
      const selected = entry.day === currentDate.getDate();
      const color = selected ? WHITE : isWeekend ? RED : BLACK;
      const lunarLabel = entry.festival || entry.lunar.dayLabel;
      if (selected) rect(centerX - 11, y - 6, 23, rowHeight - 3, RED);
      centeredText(entry.day, centerX, y, rowHeight === 37 ? 15 : 17, color, 'day', centerX - 7);
      centeredText(lunarLabel, centerX, y + (rowHeight === 37 ? 18 : 21), rowHeight === 37 ? 9 : 10, color, 'lunar', centerX - 11);
    }

    text('Codex', 222, 40, 19, RED);
    text('余量', 222, 78, 14);
    text('Premium', 268, 79, 11);
    rect(296, 42, 90, 16, WHITE);
    text(refreshLabel(currentDate), 298, 44, 12);
    rect(266, 77, 50, 16, WHITE);
    text(planLabel(displayQuota.plan_type), 268, 79, 11);
    for (const [label, percent, y] of [['5h', displayQuota.five_hour, 101], ['7d', displayQuota.seven_day, 124]]) {
      text(label, 223, y + 2, 12);
      rect(250, y, 100, 11, BLACK);
      rect(251, y + 1, 98, 9, WHITE);
      if (percent !== null) rect(251, y + 1, Math.round(98 * percent / 100), 9, BLACK);
      text(percent === null ? '--' : `${percent}%`, 357, y + 1, 11);
    }
    rect(218, 163, 171, 1, BLACK);
    text('努力搬砖ing', 222, 172, 19, RED);

    pixelArt([
      '.............######.........',
      '...........##########.......',
      '...........###########......',
      '..........############......',
      '..........############......',
      '..........##.#########......',
      '..........############......',
      '..........############......',
      '..........###########.......',
      '..........########..........',
      '..........##########........',
      '.........########...........',
      '.........#######............',
      '........########............',
      '.......########.............',
      '......#########.............',
      '##....########..............',
      '###..#########..............',
      '##############..............',
      '.############...............',
      '..###########...............',
      '...##########...............',
      '....########................',
      '.....######.................',
      '......####..................',
      '......##.##.................',
      '......##..##................',
      '......##..##................',
    ], 226, 216);
    pixelArt([
      '.......##.......', '.......##.......', '..##...##...##..', '..##...##...##..',
      '..###..##...##..', '..###..##..###..', '...##..##..##...', '...##########...',
      '....########....', '.......##.......', '.......##.......', '.......##.......',
      '.......##.......', '.......##.......',
    ], 333, 246);
    pixelArt([
      '....##....', '....##....', '##..##..##', '##..##..##', '##########',
      '..######..', '....##....', '....##....', '....##....',
    ], 316, 258);
    rect(220, 266, 15, 1, BLACK);
    rect(283, 266, 46, 1, BLACK);
    rect(361, 266, 28, 1, BLACK);
    for (const x of [254, 258, 295, 299, 382]) rect(x, 271, 2, 2, BLACK);
    return pixels;
  }

  function validatePixels(pixels) {
    return Object.prototype.toString.call(pixels) === '[object Uint8Array]' &&
      pixels.length === WIDTH * HEIGHT &&
      pixels.every(value => value === WHITE || value === BLACK || value === RED);
  }

  function toImageData(pixels, ImageDataCtor = ImageData) {
    if (!validatePixels(pixels)) throw new TypeError('无效的三色点阵');
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let i = 0; i < pixels.length; i++) {
      const offset = i * 4;
      const color = pixels[i];
      rgba[offset] = color === BLACK ? 0 : 255;
      rgba[offset + 1] = color === WHITE ? 255 : 0;
      rgba[offset + 2] = color === WHITE ? 255 : 0;
      rgba[offset + 3] = 255;
    }
    return new ImageDataCtor(rgba, WIDTH, HEIGHT);
  }

  globalThis.EpdStaticDashboard = {
    createPixels,
    validatePixels,
    toImageData,
    browserStampText,
    lunarDateFor,
    festivalLabelFor,
    calendarForMonth,
    lunarDayLabelFor: lunarDayLabel,
    FESTIVAL_LABELS,
  };
})();
