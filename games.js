/* SEMIIRA — TamaGames: чистые движки мини-игр (snake / stars / memory).
 * Контракт: docs/LIFE-CONTRACT.md, раздел «games.js worker»;
 * расширение: docs/EXPANSION-CONTRACT.md «games snake» (pace/pause/буфер 2 поворотов).
 *
 * API (окно: window.TamaGames; тесты: CommonJS require('./games.js')):
 *   TamaGames.create(kind, seed, options) -> { input(key), tick(dtSeconds), get() }
 *     kind: 'snake' | 'stars' | 'memory' (иначе бросает Error)
 *     seed: конечное число, по умолчанию 1 (нечисловой/NaN/Infinity -> 1).
 *           Одинаковый seed -> одинаковые еда/полосы/перетасовка.
 *     options: третий необязательный аргумент (не-объект -> {}; для stars/memory игнорируется).
 *           snake: options.pace='cozy' (по умолчанию) | 'classic'; прочие значения -> cozy.
 *     input(key) и tick(dt) возвращают свежий снапшот (то же, что get()).
 *     get() — глубокая копия состояния; внешние мутации копии не влияют.
 *     Движки независимы; никакого DOM, рисования и хранилища.
 *
 *   Клавиши input: 'left','right','up','down','confirm'.
 *     snake дополнительно: 'turn-left','turn-right' (относительные повороты A/C)
 *     и 'pause' — тумблер паузы, только в playing (UI сам мапит B/центр/Space;
 *     'confirm' — no-op). Терминальная игра: любые input — no-op.
 *     memory дополнительно: объект {select: индекс0..11} — курсор сразу на клетку.
 *     input не мутирует завершённую игру (status playing|won|lost, терминально).
 *   tick(dt): dt ограничен [0..0.1] сек; нечисловой/NaN/Infinity/отрицательный -> 0.
 *
 * Снапшоты (общие поля kind/status/score/elapsed + специфика):
 *   snake : {kind,seed,status,score,elapsed,cols:12,rows:10,step:0.34|0.22,goal:8,
 *            timeout:120|90,pace:'cozy'|'classic',paused:boolean,
 *            dir:'right',queued:string|null,queuedTurns:string[0..2],
 *            snake:[{x,y}...] (индекс0 — голова),food:{x,y},announce}
 *   stars : {kind,seed,status,score,elapsed,lanes:3,speed:0.5,round(1..8),totalRounds:8,
 *            goal:5,lane(0..2),drops:[{lane,y0..1}] (активная капля, 0 после финала),announce}
 *   memory: {kind,seed,status,score,elapsed,cols:4,rows:3,timeout:90,
 *            cards:[{value0..5,faceUp,matched}] x12,cursor,moves,locked,lockRemaining,announce}
 *
 * Семантика (решения по контракту):
 *   snake: буфер максимум 2 поворотов (queuedTurns; queued = первый или null); кандидат
 *          валидируется против последнего буферизованного поворота (или dir, если буфер
 *          пуст): дубль/реверс игнорируются БЕЗ очистки буфера; на каждый шаг движения
 *          расходуется ровно один поворот; относительные повороты считаются от последнего
 *          буферизованного; pace cozy (по умолчанию): step 0.34с/таймаут 120с,
 *          classic: 0.22с/90с; автоускорения нет (step постоянен);
 *          'pause' — тумблер только в playing; на паузе tick заморожен целиком
 *          (включая elapsed и таймаут), повороты при паузе копятся, но не двигают;
 *          хвост освобождает клетку в тот же шаг (заход на хвост легален);
 *          еда только на пустых клетках, детерминирована seed; 8 еды -> won;
 *          стены/тело -> lost (счёт сохранён); таймаут -> lost (счёт сохранён).
 *   stars: 3 полосы, игрок с полосы 1; капля 0.5/сек; на y>=1 ловится при совпадении
 *          полосы, затем следующий раунд; после 8 капель won при счёте>=5, иначе lost.
 *   memory: ходы считаются по каждому ВТОРОМУ открытию (попытка пары = 1 ход);
 *           несовпадение: locked 0.8с, затем карточки скрываются; совпавшие остаются;
 *           все 6 пар -> won, score=max(1,24-moves); таймаут 90с -> lost, score=число пар.
 */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global) { global.TamaGames = api; }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  var VERSION = '1';

  // Константы контракта
  var SNAKE_COLS = 12, SNAKE_ROWS = 10, SNAKE_GOAL = 8;
  var SNAKE_PACES = { cozy: { step: 0.34, timeout: 120 }, classic: { step: 0.22, timeout: 90 } };
  var STARS_LANES = 3, STARS_SPEED = 0.5, STARS_ROUNDS = 8, STARS_GOAL = 5;
  var MEMORY_COLS = 4, MEMORY_ROWS = 3, MEMORY_PAIRS = 6, MEMORY_LOCK = 0.8, MEMORY_TIMEOUT = 90;
  var MAX_DT = 0.1;

  var ANNOUNCE = {
    snake: 'Стрелки — поворот, A/C — поворот влево/вправо',
    stars: '← → — выбрать коридор',
    memory: 'Стрелки — курсор, B/Enter — открыть карточку'
  };

  var DIRV = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  var OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  var ROT_L = { right: 'up', up: 'left', left: 'down', down: 'right' }; // A: против часовой (y вниз)
  var ROT_R = { right: 'down', down: 'left', left: 'up', up: 'right' }; // C: по часовой

  // Детерминированный ГПСЧ (mulberry32)
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clampDt(dt) {
    if (typeof dt !== 'number' || !isFinite(dt)) { return 0; }
    if (dt < 0) { return 0; }
    if (dt > MAX_DT) { return MAX_DT; }
    return dt;
  }

  function normalizeSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) { return Math.floor(seed) | 0; }
    return 1;
  }

  // Обёртка: input/tick не мутируют завершённую игру; оба возвращают снапшот.
  function makeEngine(state, inputFn, tickFn) {
    function snap() { return JSON.parse(JSON.stringify(state)); }
    return {
      input: function (key) {
        if (state.status === 'playing') { inputFn(key); }
        return snap();
      },
      tick: function (dt) {
        if (state.status === 'playing') { tickFn(dt); }
        return snap();
      },
      get: snap
    };
  }

  // ---------------------------------------------------------------- snake ---
  // pace 'cozy' (по умолчанию): шаг 0.34с, таймаут 120с; 'classic': 0.22с/90с.
  // Автоускорения нет. Пауза ('pause') — тумблер только в playing (гейт в makeEngine);
  // на паузе заморожены движение/elapsed/таймаут, очередь поворотов копится.
  function createSnake(seed, pace) {
    var rng = mulberry32(seed);
    var stepSec = pace === 'classic' ? SNAKE_PACES.classic.step : SNAKE_PACES.cozy.step;
    var timeoutSec = pace === 'classic' ? SNAKE_PACES.classic.timeout : SNAKE_PACES.cozy.timeout;
    var acc = 0;
    var state = {
      kind: 'snake', seed: seed, status: 'playing', score: 0, elapsed: 0,
      cols: SNAKE_COLS, rows: SNAKE_ROWS, step: stepSec, goal: SNAKE_GOAL, timeout: timeoutSec,
      pace: pace, paused: false,
      dir: 'right', queued: null, queuedTurns: [],
      snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], // индекс 0 — голова
      food: null,
      announce: ANNOUNCE.snake
    };

    function placeFood() {
      var occupied = {};
      var i;
      for (i = 0; i < state.snake.length; i++) { occupied[state.snake[i].x + ',' + state.snake[i].y] = true; }
      var empty = [];
      for (var y = 0; y < SNAKE_ROWS; y++) {
        for (var x = 0; x < SNAKE_COLS; x++) {
          if (!occupied[x + ',' + y]) { empty.push({ x: x, y: y }); }
        }
      }
      if (!empty.length) { return; } // недостижимо: победа на 8-й еде
      state.food = empty[Math.floor(rng() * empty.length)];
    }
    placeFood();

    function applyQueued() { // один буферизованный поворот на шаг движения
      if (state.queuedTurns.length) {
        state.dir = state.queuedTurns.shift();
        state.queued = state.queuedTurns.length ? state.queuedTurns[0] : null;
      }
    }

    function lastTurnBase() {
      return state.queuedTurns.length ? state.queuedTurns[state.queuedTurns.length - 1] : state.dir;
    }

    function step() {
      applyQueued();
      var v = DIRV[state.dir];
      var nx = state.snake[0].x + v.x;
      var ny = state.snake[0].y + v.y;
      if (nx < 0 || nx >= SNAKE_COLS || ny < 0 || ny >= SNAKE_ROWS) { state.status = 'lost'; return; }
      // тело без хвоста: хвост освобождает клетку в этот же шаг (заход на хвост легален)
      for (var i = 0; i < state.snake.length - 1; i++) {
        if (state.snake[i].x === nx && state.snake[i].y === ny) { state.status = 'lost'; return; }
      }
      state.snake.unshift({ x: nx, y: ny });
      if (state.food && nx === state.food.x && ny === state.food.y) {
        state.score += 1;
        if (state.score >= SNAKE_GOAL) { state.status = 'won'; return; }
        placeFood();
      } else {
        state.snake.pop();
      }
    }

    function input(key) {
      var d = null;
      if (typeof key === 'string') {
        if (key === 'pause') { state.paused = !state.paused; return; } // тумблер, только playing
        if (key === 'left' || key === 'right' || key === 'up' || key === 'down') { d = key; }
        else if (key === 'turn-left') { d = ROT_L[lastTurnBase()]; }
        else if (key === 'turn-right') { d = ROT_R[lastTurnBase()]; }
        // 'confirm' и неизвестные клавиши — no-op (пауза B/центр/Space мапится родителем)
      }
      if (!d) { return; }
      var base = lastTurnBase();
      if (d === base || d === OPP[base]) { return; } // дубль/реверс — игнор БЕЗ очистки буфера
      if (state.queuedTurns.length >= 2) { return; } // буфер максимум 2 поворота
      state.queuedTurns.push(d);
      state.queued = state.queuedTurns[0];
    }

    function tick(dt) {
      var d = clampDt(dt);
      if (state.status !== 'playing') { return; }
      if (state.paused) { return; } // пауза: elapsed/аккумулятор/таймаут заморожены
      state.elapsed += d;
      acc += d;
      while (acc >= stepSec && state.status === 'playing') {
        acc -= stepSec;
        step();
      }
      if (state.status === 'playing' && state.elapsed >= timeoutSec) {
        state.status = 'lost'; // счёт сохранён
      }
    }

    return makeEngine(state, input, tick);
  }

  // ---------------------------------------------------------------- stars ---
  function createStars(seed) {
    var rng = mulberry32(seed);
    var state = {
      kind: 'stars', seed: seed, status: 'playing', score: 0, elapsed: 0,
      lanes: STARS_LANES, speed: STARS_SPEED, round: 1, totalRounds: STARS_ROUNDS, goal: STARS_GOAL,
      lane: 1, drops: [],
      announce: ANNOUNCE.stars
    };

    function spawn() {
      state.drops = [{ lane: Math.floor(rng() * STARS_LANES), y: 0 }];
    }
    spawn();

    function input(key) {
      if (key === 'left') { state.lane = Math.max(0, state.lane - 1); }
      else if (key === 'right') { state.lane = Math.min(STARS_LANES - 1, state.lane + 1); }
      // up/down/confirm — no-op
    }

    function tick(dt) {
      var d = clampDt(dt);
      if (state.status !== 'playing') { return; }
      state.elapsed += d;
      var drop = state.drops[0];
      if (!drop) { return; }
      drop.y += STARS_SPEED * d;
      if (drop.y >= 1) {
        if (drop.lane === state.lane) { state.score += 1; }
        if (state.round >= STARS_ROUNDS) {
          state.drops = [];
          state.status = state.score >= STARS_GOAL ? 'won' : 'lost';
          return;
        }
        state.round += 1;
        spawn();
      }
    }

    return makeEngine(state, input, tick);
  }

  // --------------------------------------------------------------- memory ---
  function createMemory(seed) {
    var rng = mulberry32(seed);
    var values = [];
    for (var v = 0; v < MEMORY_PAIRS; v++) { values.push(v, v); }
    for (var i = values.length - 1; i > 0; i--) { // Фишер—Йетс, детерминирован seed
      var j = Math.floor(rng() * (i + 1));
      var t = values[i]; values[i] = values[j]; values[j] = t;
    }
    var cards = values.map(function (val) {
      return { value: val, faceUp: false, matched: false };
    });
    var revealed = []; // индексы открытых непарных карточек (0..2)
    var state = {
      kind: 'memory', seed: seed, status: 'playing', score: 0, elapsed: 0,
      cols: MEMORY_COLS, rows: MEMORY_ROWS, timeout: MEMORY_TIMEOUT,
      cards: cards, cursor: 0, moves: 0, locked: false, lockRemaining: 0,
      announce: ANNOUNCE.memory
    };

    function matchedPairs() {
      var n = 0;
      for (var k = 0; k < cards.length; k++) { if (cards[k].matched) { n++; } }
      return n / 2;
    }

    function reveal() {
      var c = cards[state.cursor];
      if (c.matched || c.faceUp) { return; }
      c.faceUp = true;
      revealed.push(state.cursor);
      if (revealed.length < 2) { return; }
      state.moves += 1; // ход считается по второму открытию
      var a = cards[revealed[0]];
      var b = cards[revealed[1]];
      if (a.value === b.value) {
        a.matched = true;
        b.matched = true;
        revealed = [];
        if (matchedPairs() === MEMORY_PAIRS) {
          state.status = 'won';
          state.score = Math.max(1, 24 - state.moves);
        }
      } else {
        state.locked = true;
        state.lockRemaining = MEMORY_LOCK;
      }
    }

    function input(key) {
      if (state.locked) { return; } // поле заблокировано до истечения 0.8с
      if (key && typeof key === 'object' && typeof key.select === 'number' && isFinite(key.select)) {
        var idx = Math.floor(key.select);
        if (idx >= 0 && idx < cards.length) { state.cursor = idx; }
        return;
      }
      if (key === 'left') { state.cursor = (state.cursor + cards.length - 1) % cards.length; }
      else if (key === 'right') { state.cursor = (state.cursor + 1) % cards.length; }
      else if (key === 'up') { state.cursor = (state.cursor + cards.length - MEMORY_COLS) % cards.length; }
      else if (key === 'down') { state.cursor = (state.cursor + MEMORY_COLS) % cards.length; }
      else if (key === 'confirm') { reveal(); }
    }

    function tick(dt) {
      var d = clampDt(dt);
      if (state.status !== 'playing') { return; }
      state.elapsed += d;
      if (state.locked) {
        state.lockRemaining -= d;
        if (state.lockRemaining <= 0) {
          state.locked = false;
          state.lockRemaining = 0;
          for (var r = 0; r < revealed.length; r++) { cards[revealed[r]].faceUp = false; }
          revealed = [];
        }
      }
      if (state.elapsed >= MEMORY_TIMEOUT) {
        state.status = 'lost';
        state.score = matchedPairs();
      }
    }

    return makeEngine(state, input, tick);
  }

  // ------------------------------------------------------------------ API ---
  function create(kind, seed, options) {
    var s = normalizeSeed(seed);
    var opts = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
    if (kind === 'snake') {
      return createSnake(s, opts.pace === 'classic' ? 'classic' : 'cozy');
    }
    if (kind === 'stars') { return createStars(s); }
    if (kind === 'memory') { return createMemory(s); }
    throw new Error('TamaGames.create: неизвестный kind "' + kind + '" (snake|stars|memory)');
  }

  return { create: create, version: VERSION, kinds: ['snake', 'stars', 'memory'] };
});
