/*
 * SEMIIRA — life engine v1 (contract: docs/LIFE-CONTRACT.md, «Life v1 additive expansion»;
 * расширение: docs/EXPANSION-CONTRACT.md «Additive expansion10» — каталоги девайсов 24,
 * отдельный clothesCatalog и одежда Семиры petClothes + act('dress')).
 *
 * Чистый детерминированный движок состояния: потребности, уход, награды игр,
 * экономика, гардероб, целостные «сгенерированные» образы (docs/
 * GENERATED-LOOKS-CONTRACT.md — lookCatalog7 + petLook + act('look')), достижения,
 * сохранение/импорт/экспорт, подписки.
 * Без DOM, без отрисовки, без сети, без таймеров — всё время входит через
 * аргументы now (иначе Date.now()). Родитель владеет UI и интеграцией.
 *
 * API (window.TamaLife / module.exports):
 *   get()                        -> глубокая копия снапшота (чистая проекция, время НЕ двигает)
 *   act(type, args?, now?)       -> {ok, code?, snapshot, reward?}
 *   advance(now?)                -> двигает реальное время, автосейв не чаще 30s, возвращает снапшот
 *   subscribe(fn)                -> функция отписки; fn(snapshot) при изменениях, ошибки глотаются
 *   catalog                      -> замороженный массив из 24 предметов {id,slot,cost,level,name}
 *                                   (16 исходных + 8 новых моделей в конце)
 *   clothesCatalog               -> ОТДЕЛЬНЫЙ замороженный массив из 6 предметов одежды
 *                                   Семиры {id,slot:'neck'|'cape',cost,level,name};
 *                                   owned/buy общие, но каталоги выдаются раздельно
 *   lookCatalog                  -> ОТДЕЛЬНЫЙ замороженный массив из 7 целостных
 *                                   «сгенерированных» образов {id,name}; косметика без
 *                                   покупки: не входит в CATALOG/CLOTHES_CATALOG/owned,
 *                                   богатство/нужды не трогает (id 'moon' живёт в своём
 *                                   пространстве имён и не конфликтует с charm 'moon')
 *   exportSave()                 -> JSON-строка (только своё состояние)
 *   importSave(string)           -> {ok, code?}; валидация ДО мутации; лимит 64KB
 *   reset(now?)                  -> явный сброс на свежее состояние
 *
 * Зафиксированные решения на неоднозначностях контракта (для родителя):
 *   - get()/act() не двигают время: распад потребностей только в advance().
 *   - act() сохраняет сразу; advance() автосейв раз в 30s.
 *   - Порядок проверок feed: invalid -> asleep -> full(>=98) -> cooldown(20s).
 *   - full/clean>=98 у bath возвращает {ok:false, code:'full'}.
 *   - groom по аккуратному банту: ok, без эффектов, без careCount/XP, таймер не сбрасывает.
 *   - Все care-действия (feed/bath/groom/sleep) требуют awake; wake — нет (идемпотентен).
 *   - reward разрешён и во сне (в контракте запрета нет); abort-раунды родитель не награждает.
 *   - Care XP: +4 при benefit>=4, per-type кулдаун 60s, бакет floor(now/1h), максимум 40 XP/час.
 *   - Наградный XP игр (8+min(score,12)) под cap 40/час не подпадает.
 *   - benefit = сумма положительных применённых дельт (после клампа 0..100).
 *   - act(now) не двигает lastTime — распад непрерывен по стенному времени.
 *   - lastTime монотонен: часы назад не дают распада и не откатывают lastTime;
 *     один advance покрывает максимум 8 часов офлайна, излишек прощается.
 *   - lastGroomAt сдвигается вперёд на время сна: таймер «взъерошенности» (30 мин awake) мёрзнет во сне.
 *   - save-блоб содержит и внутренние поля (lastGroomAt, кулдауны, rewardIds, бакет XP);
 *     снапшот get() отдаёт только поля контракта.
 *   - Неизвестная версия сейва: свежая игра в режиме memory, блоб не перезаписывается
 *     до явного importSave/reset; битый JSON своего ключа перезаписывается валидным.
 *   - needs — дробные (родитель округляет для показа); счётчики — только целые.
 *   - notice (опционально): повреждение/версия > недоступное хранилище > низкие потребности (<=20).
 *   - Одежда Семиры: act('dress',{slot:'neck'|'cape', id:'<одежда>'|'none'}), только
 *     совместимые owned-предметы clothesCatalog (device-id -> invalid); act('equip')
 *     по-прежнему принимает только девайсы и отвергает одежду.
 *   - petClothes:{neck:'none',cape:'none'} в состоянии/снапшоте/экспорте; неизвестная/
 *     враждебная санитизация -> 'none'; старые сейвы без поля — none, монеты/xp/owned/needs
 *     сохраняются; бесплатные одежды (scarfRose, capeNight) owned по умолчанию.
 *   - Целостные образы: petLook 'none'|id(7) в состоянии/снапшоте/экспорте, свежая игра —
 *     'none', старые сейвы без поля — 'none'; неизвестное/враждебное значение -> 'none'
 *     без потери остальных данных (petClothes при санитизации сохраняется).
 *   - act('look',{id}) — точный allow-list lookCatalog или 'none'; все 7 образов бесплатны
 *     (без owned/уровня/монет), invalid — без мутаций. Надевание образа НЕ трогает
 *     wealth/needs/owned/petClothes — обратимый возврат к раздельной одежде через старый
 *     dress-UI. Спячка look не запрещает (косметика, как dress/equip/shell).
 *   - act('look',{id:'none'}) — «совсем без одежды»: petLook='none' И оба слота petClothes
 *     -> 'none', чтобы родитель не получил неявное «воскрешение» старой одежды.
 *   - Успешный act('dress') (включая slot->'none') сбрасывает petLook в 'none' —
 *     переключение на раздельную одежду; безуспешный dress petLook не трогает.
 *     buy/equip/reward образ не сбрасывают; id образа 'moon' не покупается как образ
 *     (buy 'moon' — это charm).
 *   - Коды ошибок: invalid, asleep, full, cooldown, duplicate, owned, level, coins,
 *     not-owned, unknown, version, too-large, egg, grave, paused, archive-full,
 *     not-found, not-ready, healthy, cap, no-benefit, not-visible.
 *
 * --- Lifecycle v2 (docs/LIFECYCLE-IMPLEMENTATION-CONTRACT.md, seam §§32–45) ---
 *   STATUS: PLANNED, NOT INTEGRATED in this session (RED harness:
 *   qa/lifecycle-unit.cjs fails by design; analysis in
 *   docs/LIFECYCLE-ENGINE-IMPLEMENTATION.md). Blocks below are the agreed seam.
 *   Биология делегирована TamaBiology (CommonJS require './biology.js'; в браузере
 *   biology.js подключается ДО life.js). Движок владеет хранилищем/экономикой/
 *   архивами и вызывает Bio.advance/command/reconcile/describe.
 *   Сейв v2: прежние плоские поля аккаунта + biology + archives + requestIds при
 *   v:2, тот же ключ semiira-tama-life-v1. Старый v1-блоб ДО перезаписи копируется
 *   в отдельный ключ semiira-tama-life-v1-legacy-backup; неудача бэкапа -> оригинал
 *   нетронут, режим памяти. Неизвестная будущая версия -> readonly-память, блоб
 *   не перезаписывается. Битый/невалидный v2 -> свежая игра (как в v1).
 *   get() добавляет biology (копия), archives (копия, максимум 20) и lifecycle
 *   (TamaBiology.describe). exportSave — полный v2; import принимает v1/v2,
 *   лимит 2MiB, невалидный (включая битые вложенные архивы/биологию) не мутирует.
 *   advance(now, activity?): без activity интервал OFFLINE (догоняющий прогон);
 *   act() сначала применяет прошедшее время с последней явной доступностью
 *   (изначально OFFLINE), потом команду; setActivity завершает старый интервал
 *   старой доступностью и только затем переключает.
 *   Новые act: hatch, medicine, pause{confirmed:true}, resume, critical-seen
 *   {visible:true, drawer:false}, new-life{mode,keepCollection,confirmed,
 *   backupExported,requestId}, archive-delete{lifeId,confirmed:true}.
 *   Яйцо/могила/пауза блокируют care/reward/sleep ('egg'/'grave'/'paused'),
 *   косметика (buy/equip/dress/look/shell) разрешена всегда. Легаси-жизнь живёт
 *   по старым правилам без биологических штрафов. Терминальная смерть архивируется
 *   атомарно один раз (полный снимок без рекурсии архивов); переполнение архива
 *   (20) блокирует новый архив кодом 'archive-full' без вытеснения.
 *   'stomach' делит сытостный эффект еды пополам; купание убирает нужду даже при
 *   полной чистоте; полезный уход даёт bond (кап 6/день внутри биологии).
 *   requestId дедуплицируется постоянным ограниченным реестром (100).
 */
(function () {
  'use strict';

  // ---------------- constants ----------------
  var STORAGE_KEY = 'semiira-tama-life-v1';
  var BACKUP_KEY = 'semiira-tama-life-v1-legacy-backup';
  var SAVE_VERSION = 2;
  var LEGACY_VERSION = 1;
  var MAX_IMPORT_CHARS = 2 * 1024 * 1024;
  var Bio = (typeof TamaBiology !== 'undefined' && TamaBiology) ||
    (typeof window !== 'undefined' && window.TamaBiology) ||
    (typeof require === 'function' ? require('./biology.js') : null);
  var LIFE_ID_SEQ = 0;
  function newLifeId(now) {
    var id;
    do {
      LIFE_ID_SEQ += 1;
      id = 'life-' + String(now) + '-' + String(LIFE_ID_SEQ);
    } while (S && (S.biology && S.biology.lifeId === id || S.archives && S.archives.some(function (a) { return a.lifeId === id; })));
    return id;
  }
  function isV2(raw) { return isPlainObject(raw) && raw.v === SAVE_VERSION; }
  function biologyFrame() { return {biology:S.biology, needs:S.needs, sleeping:S.sleeping, bowNeat:S.bowNeat, lastGroomAt:S.lastGroomAt}; }
  function copyBioFrame(frame) { S.biology=frame.biology; S.needs=frame.needs; S.sleeping=frame.sleeping; S.bowNeat=frame.bowNeat; S.lastGroomAt=frame.lastGroomAt; }
  function createBiology(now, mode, parent, generation) {
    return Bio.create({now:now, mode:mode || 'safe', lifeId:newLifeId(now), parentLifeId:parent || null, generation:generation || 1});
  }
  var HOUR_MS = 3600000;
  var OFFLINE_CAP_MS = 8 * HOUR_MS;
  var FEED_COOLDOWN_MS = 20000;
  var CARE_XP_COOLDOWN_MS = 60000;
  var CARE_XP_AMOUNT = 4;
  var CARE_XP_HOUR_CAP = 40;
  var CARE_BENEFIT_MIN = 4;
  var BOW_MESSY_MS = 30 * 60000;
  var AUTOSAVE_MS = 30000;
  var MAX_LEVEL = 20;

  var MAX_REWARD_IDS = 100;
  var MAX_ARCHIVES = 20;
  var MAX_REQUEST_IDS = 100;
  var MAX_SCORE = 1000000;
  var MAX_COINS = 1000000;
  var MAX_XP = 1000000000;
  var MAX_COUNTER = 1000000000;
  var HUNGER_FULL = 98;
  var CLEAN_FULL = 98;
  var LOW_NEED = 20;

  var DECAY_AWAKE = { hunger: 6, joy: 4, energy: 5, clean: 3 };   // за час
  var DECAY_ASLEEP = { hunger: 3, joy: 1, clean: 1 };             // за час
  var SLEEP_ENERGY_PER_HOUR = 18;

  var NEED_KEYS = ['hunger', 'joy', 'energy', 'clean'];
  var GAME_KEYS = ['snake', 'stars', 'memory'];
  var SLOT_KEYS = ['strap', 'beads', 'charm'];
  var CLOTHES_SLOT_KEYS = ['neck', 'cape'];
  var CARE_TYPES = ['feed', 'bath', 'groom'];
  var SHELL_IDS = ['smoke', 'milk', 'rose', 'lilac', 'cherry'];

  var DEFAULT_NEEDS = { hunger: 80, joy: 75, energy: 85, clean: 85 };
  var DEFAULT_EQUIPPED = { strap: 'ribbon', beads: 'pearl', charm: 'heart' };
  var START_COINS = 40;

  var FOODS = Object.assign(Object.create(null), {
    cookie: { hunger: 12, joy: 4, energy: 5, clean: -2 },
    soup: { hunger: 25, energy: 12 },
    berry: { hunger: 8, energy: 4 }
  });

  var SHELL_SET = Object.assign(Object.create(null), {
    smoke: 1, milk: 1, rose: 1, lilac: 1, cherry: 1
  });

  var CATALOG = Object.freeze([
    { id: 'ribbon',    slot: 'strap', cost: 0,  level: 1, name: 'Розовая лента' },
    { id: 'lace',      slot: 'strap', cost: 18, level: 1, name: 'Кружевной ремешок' },
    { id: 'cord',      slot: 'strap', cost: 15, level: 1, name: 'Плетёный шнур' },
    { id: 'chain',     slot: 'strap', cost: 30, level: 2, name: 'Серебряная цепь' },
    { id: 'pearl',     slot: 'beads', cost: 0,  level: 1, name: 'Жемчуг' },
    { id: 'candy',     slot: 'beads', cost: 16, level: 1, name: 'Конфетные бусины' },
    { id: 'crystal',   slot: 'beads', cost: 24, level: 2, name: 'Лиловые кристаллы' },
    { id: 'stars',     slot: 'beads', cost: 30, level: 3, name: 'Звёздная нить' },
    { id: 'heart',     slot: 'charm', cost: 0,  level: 1, name: 'Сердце' },
    { id: 'star',      slot: 'charm', cost: 0,  level: 1, name: 'Звезда' },
    { id: 'bow',       slot: 'charm', cost: 0,  level: 1, name: 'Бант' },
    { id: 'moon',      slot: 'charm', cost: 18, level: 1, name: 'Месяц' },
    { id: 'paw',       slot: 'charm', cost: 20, level: 2, name: 'Лапка' },
    { id: 'ghost',     slot: 'charm', cost: 28, level: 2, name: 'Мини-Семира' },
    { id: 'controller', slot: 'charm', cost: 34, level: 3, name: 'Геймпад' },
    { id: 'cherry',    slot: 'charm', cost: 18, level: 1, name: 'Вишенки' },
    // --- expansion10: +8 моделей девайсов (в конце, первые 16 не тронуты) ---
    { id: 'velvet',     slot: 'strap', cost: 20, level: 1, name: 'Бархатный ремешок' },
    { id: 'mintCord',   slot: 'strap', cost: 18, level: 1, name: 'Мятный шнур' },
    { id: 'roseQuartz', slot: 'beads', cost: 24, level: 2, name: 'Розовый кварц' },
    { id: 'onyx',       slot: 'beads', cost: 24, level: 2, name: 'Чёрный жемчуг' },
    { id: 'butterfly',  slot: 'charm', cost: 22, level: 1, name: 'Бабочка' },
    { id: 'key',        slot: 'charm', cost: 25, level: 2, name: 'Сказочный ключ' },
    { id: 'bell',       slot: 'charm', cost: 18, level: 1, name: 'Колокольчик' },
    { id: 'planet',     slot: 'charm', cost: 30, level: 3, name: 'Сатурн' }
  ].map(function (item) { return Object.freeze(item); }));

  // Одежда Семиры — отдельный каталог (6 предметов; слоты neck и cape).
  var CLOTHES_CATALOG = Object.freeze([
    { id: 'scarfRose',   slot: 'neck', cost: 0,  level: 1, name: 'Розовый шарфик' },
    { id: 'scarfMint',   slot: 'neck', cost: 12, level: 1, name: 'Мятный шарфик' },
    { id: 'collarPearl', slot: 'neck', cost: 18, level: 2, name: 'Жемчужный воротничок' },
    { id: 'capeNight',   slot: 'cape', cost: 0,  level: 1, name: 'Звёздная накидка' },
    { id: 'capeRose',    slot: 'cape', cost: 20, level: 1, name: 'Розовая пелерина' },
    { id: 'capeRain',    slot: 'cape', cost: 22, level: 2, name: 'Лавандовый дождевик' }
  ].map(function (item) { return Object.freeze(item); }));

  var CATALOG_BY_ID = Object.create(null);
  for (var ci = 0; ci < CATALOG.length; ci++) CATALOG_BY_ID[CATALOG[ci].id] = CATALOG[ci];

  var CLOTHES_BY_ID = Object.create(null);
  for (var cli = 0; cli < CLOTHES_CATALOG.length; cli++) {
    CLOTHES_BY_ID[CLOTHES_CATALOG[cli].id] = CLOTHES_CATALOG[cli];
  }

  // Целостные «сгенерированные» образы Семиры — отдельная косметическая коллекция
  // (7 образов, только {id,name}). НЕ девайсы и НЕ одежда: в CATALOG, CLOTHES_CATALOG,
  // ITEM_BY_ID и owned не попадают; все доступны бесплатно (user-approved tryout).
  // id 'moon' сознательно живёт в собственном пространстве имён petLook и не даёт
  // конфликта с charm 'moon' (тот покупается/надевается как девайс, как и раньше).
  var LOOK_CATALOG = Object.freeze([
    { id: 'cozy',       name: 'Розовый уют' },
    { id: 'moon',       name: 'Лунная вышивка' },
    { id: 'berry',      name: 'Вишнёвое кружево' },
    { id: 'mint',       name: 'Мятный жемчуг' },
    { id: 'goth',       name: 'Готическое кружево' },
    { id: 'strawberry', name: 'Клубничный кардиган' },
    { id: 'sky',        name: 'Небесная пелерина' }
  ].map(function (it) { return Object.freeze(it); }));

  var LOOK_SET = Object.create(null);
  for (var lki = 0; lki < LOOK_CATALOG.length; lki++) LOOK_SET[LOOK_CATALOG[lki].id] = 1;

  // Общий lookup для owned/buy: девайсы + одежда в одном пространстве id.
  var ITEM_BY_ID = Object.create(null);
  var itemAll = CATALOG.concat(CLOTHES_CATALOG);
  for (var iai = 0; iai < itemAll.length; iai++) ITEM_BY_ID[itemAll[iai].id] = itemAll[iai];

  var FREE_IDS = [];
  var fi;
  for (fi = 0; fi < CATALOG.length; fi++) if (CATALOG[fi].cost === 0) FREE_IDS.push(CATALOG[fi].id);
  for (fi = 0; fi < CLOTHES_CATALOG.length; fi++) if (CLOTHES_CATALOG[fi].cost === 0) FREE_IDS.push(CLOTHES_CATALOG[fi].id);

  var MILESTONES = [
    { id: 'care3',      coins: 10, done: function (s) { return s.careCount >= 3; } },
    { id: 'first-game', coins: 10, done: function (s) { return s.gamesPlayed >= 1; } },
    { id: 'wins3',      coins: 20, done: function (s) { return s.wins >= 3; } },
    { id: 'level3',     coins: 20, done: function (s) { return levelOf(s.xp) >= 3; } }
  ];
  var MILESTONE_SET = Object.create(null);
  for (var mi = 0; mi < MILESTONES.length; mi++) MILESTONE_SET[MILESTONES[mi].id] = 1;

  var REWARD_ID_RE = /^[\x20-\x7E]{1,80}$/;

  var NOTICE_MEMORY =
    'localStorage недоступен — прогресс в памяти. Сохраняйте через экспорт.';
  var NOTICE_VERSION =
    'Найдено сохранение новой версии — оно не тронуто, игра начата заново. Импорт или сброс перезапишут его.';
  var NOTICE_CORRUPT = 'Сохранение повреждено — начата новая игра.';

  // ---------------- utils ----------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function sanitizeNow(now) {
    if (now === undefined) return Date.now();
    return typeof now === 'number' && isFinite(now) ? now : null;
  }
  function intOr(v, def, lo, hi) { return Number.isInteger(v) ? clamp(v, lo, hi) : def; }
  function numOr(v, def, lo, hi) {
    return typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : def;
  }
  function levelOf(xp) { return Math.min(MAX_LEVEL, 1 + Math.floor(xp / 100)); }

  // ---------------- runtime state ----------------
  var S = null;                 // внутреннее состояние (включая внутренние поля сейва)
  var storageRef = null;        // localStorage или null
  var storageMode = 'memory';   // 'local' | 'memory'
  var lastSaveAt = 0;
  var sessionNotice = null;     // повреждение / неизвестная версия
  var subscribers = [];
  var lastActivity = {visible:false, drawer:false};
  var lastActivityAt = 0;

  // ---------------- state shapes ----------------
  function freshState(now) {
    return {
      v: SAVE_VERSION,
      createdAt: now,
      lastTime: now,
      biology: createBiology(now, 'safe', null, 1),
      archives: [],
      requestIds: [],
      needs: { hunger: DEFAULT_NEEDS.hunger, joy: DEFAULT_NEEDS.joy, energy: DEFAULT_NEEDS.energy, clean: DEFAULT_NEEDS.clean },
      sleeping: false,
      bowNeat: true,
      xp: 0,
      coins: START_COINS,
      careCount: 0,
      gamesPlayed: 0,
      wins: 0,
      bests: { snake: 0, stars: 0, memory: 0 },
      owned: FREE_IDS.slice(),
      equipped: { strap: DEFAULT_EQUIPPED.strap, beads: DEFAULT_EQUIPPED.beads, charm: DEFAULT_EQUIPPED.charm },
      petClothes: { neck: 'none', cape: 'none' },
      petLook: 'none',
      shell: 'smoke',
      achievements: [],
      lastGroomAt: now,
      lastFeedAt: 0,
      lastCareXpAt: { feed: 0, bath: 0, groom: 0 },
      careXpBucket: Math.floor(now / HOUR_MS),
      careXpInBucket: 0,
      rewardIds: []
    };
  }

  // Строгая белая списочная санитизация: неизвестные ключи отбрасываются,
  // прототипное загрязнение невозможно (никаких прямых присваиваний из raw).
  function sanitizeState(raw, now) {
    if (!isPlainObject(raw)) throw new Error('not a plain object');
    var s = freshState(now);

    s.createdAt = intOr(raw.createdAt, now, 0, now);
    s.lastTime = intOr(raw.lastTime, s.createdAt, 0, now);
    if (Bio) {
      var br = raw.biology;
      if (!isPlainObject(br)) throw new Error('missing biology');
      s.biology = Bio.sanitize(br, now);
    }
    s.archives = [];
    if (raw.archives !== undefined && !Array.isArray(raw.archives)) throw new Error('bad archives');
    if (Array.isArray(raw.archives)) {
      if (raw.archives.length > MAX_ARCHIVES) throw new Error('archive cap');
      for (var ar = 0; ar < raw.archives.length; ar++) {
        var entry = raw.archives[ar];
        if (!isPlainObject(entry) || typeof entry.lifeId !== 'string' || !REWARD_ID_RE.test(entry.lifeId) || !isPlainObject(entry.biology) || entry.archives !== undefined || entry.requestIds !== undefined) throw new Error('bad archive');
        var archivedBio = Bio ? Bio.sanitize(entry.biology, now) : entry.biology;
        var archiveNeeds = isPlainObject(entry.needs) ? {hunger:numOr(entry.needs.hunger,80,0,100),joy:numOr(entry.needs.joy,75,0,100),energy:numOr(entry.needs.energy,85,0,100),clean:numOr(entry.needs.clean,85,0,100)} : null;
        if (!archiveNeeds || typeof entry.sleeping !== 'boolean' || typeof entry.bowNeat !== 'boolean' || !Array.isArray(entry.rewardIds) || !isPlainObject(entry.account)) throw new Error('bad archive');
        var aa = entry.account;
        var allowedAccount = ['coins','xp','owned','equipped','petClothes','petLook','shell','achievements','bests','careCount','gamesPlayed','wins','lastGroomAt','lastFeedAt','lastCareXpAt','careXpBucket','careXpInBucket'];
        Object.keys(aa).forEach(function (ak) { if (allowedAccount.indexOf(ak) < 0) throw new Error('bad archive account'); });
        var acc = sanitizeState(Object.assign({}, aa, {v:SAVE_VERSION, biology:archivedBio, needs:archiveNeeds, sleeping:entry.sleeping, bowNeat:entry.bowNeat, rewardIds:entry.rewardIds, archives:[], requestIds:[]}), now);
        s.archives.push({lifeId:entry.lifeId, reason:typeof entry.reason === 'string' && REWARD_ID_RE.test(entry.reason) ? entry.reason : 'archive', archivedAt:numOr(entry.archivedAt, now, 0, now), biology:acc.biology, needs:acc.needs, sleeping:acc.sleeping, bowNeat:acc.bowNeat, rewardIds:acc.rewardIds, account:{coins:acc.coins,xp:acc.xp,owned:acc.owned,equipped:acc.equipped,petClothes:acc.petClothes,petLook:acc.petLook,shell:acc.shell,achievements:acc.achievements,bests:acc.bests,careCount:acc.careCount,gamesPlayed:acc.gamesPlayed,wins:acc.wins,lastGroomAt:acc.lastGroomAt,lastFeedAt:acc.lastFeedAt,lastCareXpAt:acc.lastCareXpAt,careXpBucket:acc.careXpBucket,careXpInBucket:acc.careXpInBucket}});
      }
    }
    s.requestIds = Array.isArray(raw.requestIds) ? raw.requestIds.filter(function(id){return typeof id === 'string' && REWARD_ID_RE.test(id);}).slice(-MAX_REQUEST_IDS) : [];

    var needs = isPlainObject(raw.needs) ? raw.needs : {};
    for (var i = 0; i < NEED_KEYS.length; i++) {
      var k = NEED_KEYS[i];
      s.needs[k] = numOr(needs[k], DEFAULT_NEEDS[k], 0, 100);
    }

    s.sleeping = raw.sleeping === true;
    s.bowNeat = raw.bowNeat !== false;
    s.xp = intOr(raw.xp, 0, 0, MAX_XP);
    s.coins = intOr(raw.coins, START_COINS, 0, MAX_COINS);
    s.careCount = intOr(raw.careCount, 0, 0, MAX_COUNTER);
    s.gamesPlayed = intOr(raw.gamesPlayed, 0, 0, MAX_COUNTER);
    s.wins = intOr(raw.wins, 0, 0, MAX_COUNTER);

    var bests = isPlainObject(raw.bests) ? raw.bests : {};
    for (var g = 0; g < GAME_KEYS.length; g++) {
      var gk = GAME_KEYS[g];
      s.bests[gk] = intOr(bests[gk], 0, 0, MAX_SCORE);
    }

    // owned: только известные id каталога, без дублей; бесплатные всегда в собственности.
    var seenOwned = Object.create(null);
    var owned = [];
    if (Array.isArray(raw.owned)) {
      for (var oi = 0; oi < raw.owned.length; oi++) {
        var it = raw.owned[oi];
        if (typeof it === 'string' && ITEM_BY_ID[it] && !seenOwned[it]) {
          seenOwned[it] = 1;
          owned.push(it);
        }
      }
    }
    for (var ffi = 0; ffi < FREE_IDS.length; ffi++) {
      if (!seenOwned[FREE_IDS[ffi]]) { seenOwned[FREE_IDS[ffi]] = 1; owned.push(FREE_IDS[ffi]); }
    }
    s.owned = owned;

    var eq = isPlainObject(raw.equipped) ? raw.equipped : {};
    for (var sl = 0; sl < SLOT_KEYS.length; sl++) {
      var slot = SLOT_KEYS[sl];
      var val = eq[slot];
      if (val === 'none') { s.equipped[slot] = 'none'; continue; }
      var item = typeof val === 'string' ? CATALOG_BY_ID[val] : null;
      s.equipped[slot] = (item && item.slot === slot && seenOwned[val]) ? val : DEFAULT_EQUIPPED[slot];
    }

    // petClothes: только известные owned-совместимые одежды или 'none';
    // чужие/device-id/не-owned значения -> 'none'. Отсутствие поля — none/none.
    var pcRaw = isPlainObject(raw.petClothes) ? raw.petClothes : {};
    for (var pcs = 0; pcs < CLOTHES_SLOT_KEYS.length; pcs++) {
      var pcSlot = CLOTHES_SLOT_KEYS[pcs];
      var pcVal = pcRaw[pcSlot];
      if (pcVal === 'none') { s.petClothes[pcSlot] = 'none'; continue; }
      var pcItem = typeof pcVal === 'string' ? CLOTHES_BY_ID[pcVal] : null;
      s.petClothes[pcSlot] = (pcItem && pcItem.slot === pcSlot && seenOwned[pcVal]) ? pcVal : 'none';
    }

    // petLook: только точные id lookCatalog или 'none'; отсутствие поля (старые сейвы)
    // и неизвестное/враждебное значение -> 'none'. Остальные данные не трогаются:
    // petClothes сохраняются как есть (миграция без потерь).
    s.petLook = (typeof raw.petLook === 'string' && LOOK_SET[raw.petLook]) ? raw.petLook : 'none';

    s.shell = typeof raw.shell === 'string' && SHELL_SET[raw.shell] ? raw.shell : 'smoke';

    var achSeen = Object.create(null);
    var ach = [];
    if (Array.isArray(raw.achievements)) {
      for (var ai = 0; ai < raw.achievements.length; ai++) {
        var a = raw.achievements[ai];
        if (typeof a === 'string' && MILESTONE_SET[a] && !achSeen[a]) { achSeen[a] = 1; ach.push(a); }
      }
    }
    s.achievements = ach;

    s.lastGroomAt = numOr(raw.lastGroomAt, s.createdAt, 0, now);
    s.lastFeedAt = numOr(raw.lastFeedAt, 0, 0, now);
    var lcx = isPlainObject(raw.lastCareXpAt) ? raw.lastCareXpAt : {};
    for (var ct = 0; ct < CARE_TYPES.length; ct++) {
      var t = CARE_TYPES[ct];
      s.lastCareXpAt[t] = numOr(lcx[t], 0, 0, now);
    }
    s.careXpBucket = intOr(raw.careXpBucket, Math.floor(now / HOUR_MS), 0, 9007199254740991);
    s.careXpInBucket = intOr(raw.careXpInBucket, 0, 0, CARE_XP_HOUR_CAP);

    var seenIds = Object.create(null);
    var ids = [];
    if (Array.isArray(raw.rewardIds)) {
      for (var ri = 0; ri < raw.rewardIds.length; ri++) {
        var id = raw.rewardIds[ri];
        if (typeof id === 'string' && REWARD_ID_RE.test(id) && !seenIds[id]) {
          seenIds[id] = 1;
          ids.push(id);
        }
      }
    }
    s.rewardIds = ids.length > MAX_REWARD_IDS ? ids.slice(-MAX_REWARD_IDS) : ids;

    return s;
  }

  function buildPayload(s) {
    return {
      v: SAVE_VERSION,
      createdAt: s.createdAt,
      lastTime: s.lastTime,
      biology: s.biology,
      archives: s.archives,
      requestIds: s.requestIds,
      needs: { hunger: s.needs.hunger, joy: s.needs.joy, energy: s.needs.energy, clean: s.needs.clean },
      sleeping: s.sleeping,
      bowNeat: s.bowNeat,
      xp: s.xp,
      coins: s.coins,
      careCount: s.careCount,
      gamesPlayed: s.gamesPlayed,
      wins: s.wins,
      bests: { snake: s.bests.snake, stars: s.bests.stars, memory: s.bests.memory },
      owned: s.owned.slice(),
      equipped: { strap: s.equipped.strap, beads: s.equipped.beads, charm: s.equipped.charm },
      petClothes: { neck: s.petClothes.neck, cape: s.petClothes.cape },
      petLook: s.petLook,
      shell: s.shell,
      achievements: s.achievements.slice(),
      lastGroomAt: s.lastGroomAt,
      lastFeedAt: s.lastFeedAt,
      lastCareXpAt: { feed: s.lastCareXpAt.feed, bath: s.lastCareXpAt.bath, groom: s.lastCareXpAt.groom },
      careXpBucket: s.careXpBucket,
      careXpInBucket: s.careXpInBucket,
      rewardIds: s.rewardIds.slice()
    };
  }

  // ---------------- storage ----------------
  function probeStorage() {
    try {
      if (typeof window === 'undefined' || !window) return null;
      var ls = window.localStorage;
      if (!ls) return null;
      ls.getItem(STORAGE_KEY); // проба доступа; бросок => отказ
      return ls;
    } catch (err) {
      return null;
    }
  }

  function save(now) {
    if (!storageRef) return;
    try {
      storageRef.setItem(STORAGE_KEY, JSON.stringify(buildPayload(S)));
      if (typeof now === 'number' && isFinite(now)) lastSaveAt = now;
    } catch (err) {
      // Do not advertise persistence after quota/write denial.
      storageRef = null;
      storageMode = 'memory';
    }
  }

  function startFresh(now, notice) {
    S = freshState(now);
    lastSaveAt = now;
    sessionNotice = notice || null;
    save(now);
  }

  function migrateV1(obj, raw, now) {
    var legacy = sanitizeState(Object.assign({}, obj, {v:SAVE_VERSION, biology:Bio.create({now:now, mode:'legacyNoDeath', lifeId:newLifeId(now), parentLifeId:null, generation:1}), archives:[], requestIds:[]}), now);
    legacy.biology.lifeState = 'legacyLiving';
    // Preserve the first legacy backup byte-for-byte; repeated boots must not
    // replace it with a later/normalized payload.
    try {
      if (!storageRef.getItem(BACKUP_KEY)) storageRef.setItem(BACKUP_KEY, raw);
    }
    catch (err) { storageRef = null; storageMode = 'memory'; sessionNotice = 'Не удалось создать резервную копию старого сохранения — исходный файл не тронут.'; return legacy; }
    // v1's wall-clock cursor is part of the physiology contract.  The
    // migration-created biology object must continue from that cursor rather
    // than silently starting at the migration time.
    legacy.biology.lastLifeTime = intOr(obj.lastTime, now, 0, now);
    return legacy;
  }

  function initLoad() {
    storageRef = probeStorage();
    storageMode = storageRef ? 'local' : 'memory';
    var now = Date.now();
    var raw = null;
    if (storageRef) {
      try { raw = storageRef.getItem(STORAGE_KEY); }
      catch (err) { storageRef = null; storageMode = 'memory'; }
    }
    if (typeof raw !== 'string' || raw === '') {
      startFresh(now, null);
      return;
    }
    var obj;
    try { obj = JSON.parse(raw); } catch (err) { obj = undefined; }
    if (obj === undefined || !isPlainObject(obj)) {
      // собственный ключ бит — перезаписываем валидным свежим сейвом
      startFresh(now, NOTICE_CORRUPT);
      return;
    }
    if (obj.v === LEGACY_VERSION) {
      var migrated = migrateV1(obj, raw, now);
      if (!migrated) { S = freshState(now); lastSaveAt = now; return; }
      S = migrated; sessionNotice = null; lastSaveAt = now; save(now); return;
    }
    if (obj.v !== SAVE_VERSION) {
      S = freshState(now);
      lastSaveAt = now;
      sessionNotice = NOTICE_VERSION;
      storageRef = null;
      storageMode = 'memory';
      return;
    }
    try { S = sanitizeState(obj, now); }
    catch (err) { startFresh(now, NOTICE_CORRUPT); return; }
    sessionNotice = null;
    lastSaveAt = now;
    save(now); // нормализованный блоб
  }

  // ---------------- needs / time ----------------
  function gainNeed(key, amount) {
    var before = S.needs[key];
    var after = clamp(before + amount, 0, 100);
    S.needs[key] = after;
    return after - before;
  }

  function advanceBiology(now, activity) {
    if (!Bio || !S.biology) return;
    var next = Bio.advance(biologyFrame(), now, activity);
    copyBioFrame(next);
  }

  function applyElapsed(ms, now) {
    if (!(ms > 0)) return false;
    var hours = ms / HOUR_MS;
    if (S.sleeping) {
      gainNeed('hunger', -DECAY_ASLEEP.hunger * hours);
      gainNeed('joy', -DECAY_ASLEEP.joy * hours);
      gainNeed('clean', -DECAY_ASLEEP.clean * hours);
      gainNeed('energy', SLEEP_ENERGY_PER_HOUR * hours);
      if (isFinite(S.lastGroomAt)) S.lastGroomAt += ms; // таймер банта мёрзнет во сне
    } else {
      gainNeed('hunger', -DECAY_AWAKE.hunger * hours);
      gainNeed('joy', -DECAY_AWAKE.joy * hours);
      gainNeed('energy', -DECAY_AWAKE.energy * hours);
      gainNeed('clean', -DECAY_AWAKE.clean * hours);
      if (isFinite(S.lastGroomAt) && now - S.lastGroomAt >= BOW_MESSY_MS) S.bowNeat = false;
    }
    return true;
  }

  function advance(now, activity) {
    now = sanitizeNow(now);
    if (now === null) return get();
    var changed = false;
    if (now > S.lastTime) {
      if (S.biology) {
        advanceBiology(now, activity);
        S.lastTime = Math.max(S.lastTime, now, S.biology.lastLifeTime);
      } else { var applied = Math.min(now - S.lastTime, OFFLINE_CAP_MS); applyElapsed(applied, now); S.lastTime = Math.max(S.lastTime, now); }
      changed = true;
    }
    if (archiveTerminal(now)) changed = true;
    if (now - lastSaveAt >= AUTOSAVE_MS) save(now);
    if (changed) notify();
    if (S.biology && S.biology.lifeState === 'grave') save(now);
    lastActivity = activity && typeof activity === 'object' ? {visible:activity.visible === true, drawer:activity.drawer === true} : {visible:false,drawer:false};
    lastActivityAt = now;
    return get();
  }

  // ---------------- xp / milestones ----------------
  function grantCareXp(type, now, benefit) {
    if (benefit < CARE_BENEFIT_MIN) return false;
    if (now - S.lastCareXpAt[type] < CARE_XP_COOLDOWN_MS) return false;
    var bucket = Math.floor(now / HOUR_MS);
    if (bucket !== S.careXpBucket) { S.careXpBucket = bucket; S.careXpInBucket = 0; }
    if (S.careXpInBucket + CARE_XP_AMOUNT > CARE_XP_HOUR_CAP) return false;
    S.careXpInBucket += CARE_XP_AMOUNT;
    S.lastCareXpAt[type] = now;
    S.xp = clamp(S.xp + CARE_XP_AMOUNT, 0, MAX_XP);
    return true;
  }

  function checkMilestones(grant) {
    for (var i = 0; i < MILESTONES.length; i++) {
      var m = MILESTONES[i];
      if (S.achievements.indexOf(m.id) >= 0) continue;
      if (!m.done(S)) continue;
      S.achievements.push(m.id);
      S.coins = clamp(S.coins + m.coins, 0, MAX_COINS);
      grant.coins = (grant.coins || 0) + m.coins;
      grant.milestones.push(m.id);
    }
  }

  // ---------------- acts ----------------
  function actFeed(args, now) {
    if (S.sleeping) return { ok: false, code: 'asleep' };
    var food = typeof args.food === 'string' ? args.food : '';
    var f = FOODS[food] || null; // FOODS с null-прототипом — безопасный lookup
    if (!f) return { ok: false, code: 'invalid' };
    if (S.needs.hunger >= HUNGER_FULL) return { ok: false, code: 'full' };
    if (now - S.lastFeedAt < FEED_COOLDOWN_MS) return { ok: false, code: 'cooldown' };
    var benefit = 0;
    var hungerEffect = f.hunger;
    if (S.biology && S.biology.illness === 'stomach') hungerEffect /= 2;
    benefit += Math.max(0, gainNeed('hunger', hungerEffect));
    if (f.joy) benefit += Math.max(0, gainNeed('joy', f.joy));
    if (f.clean) benefit += Math.max(0, gainNeed('clean', f.clean));
    if (f.energy) benefit += Math.max(0, gainNeed('energy', f.energy));
    S.lastFeedAt = now;
    S.careCount += 1;
    var rewarded = grantCareXp('feed', now, benefit);
    return { ok: true, changed: true, grant: rewarded ? { xp: CARE_XP_AMOUNT, milestones: [] } : null };
  }

  function actBath(args, now) {
    if (S.sleeping) return { ok: false, code: 'asleep' };
    // Bath also removes waste.  A dirty pet can therefore be bathed at a
    // full cleanliness meter; only a genuinely clean, waste-free bath is full.
    if (S.needs.clean >= CLEAN_FULL && (!S.biology || S.biology.waste <= 0)) return { ok: false, code: 'full' };
    var applied = gainNeed('clean', 35);
    if (S.biology && S.biology.waste > 0) {
      var frame = Bio.reconcile(biologyFrame());
      frame.biology.waste = 0;
      frame.biology.wasteProgress = 0;
      copyBioFrame(frame);
    }
    S.careCount += 1;
    var rewarded = grantCareXp('bath', now, applied);
    return { ok: true, changed: true, grant: rewarded ? { xp: CARE_XP_AMOUNT, milestones: [] } : null, benefit: applied };
  }

  function actGroom(args, now) {
    if (S.sleeping) return { ok: false, code: 'asleep' };
    if (S.bowNeat) return { ok: true, changed: false }; // родитель может анимировать, движку нечего менять
    var joyApplied = gainNeed('joy', 5);
    S.bowNeat = true;
    S.lastGroomAt = now;
    S.careCount += 1;
    var rewarded = grantCareXp('groom', now, joyApplied);
    return { ok: true, changed: true, grant: rewarded ? { xp: CARE_XP_AMOUNT, milestones: [] } : null, benefit: joyApplied, groomed: true };
  }

  function actSleep() {
    if (S.sleeping) return { ok: false, code: 'asleep' };
    S.sleeping = true;
    return { ok: true, changed: true };
  }

  function actWake() {
    if (!S.sleeping) return { ok: true, changed: false }; // идемпотентен
    S.sleeping = false;
    return { ok: true, changed: true };
  }

  function actReward(args) {
    var id = args.id;
    if (typeof id !== 'string' || !REWARD_ID_RE.test(id)) return { ok: false, code: 'invalid' };
    var game = args.game;
    if (typeof game !== 'string' || GAME_KEYS.indexOf(game) < 0) return { ok: false, code: 'invalid' };
    var score = args.score;
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return { ok: false, code: 'invalid' };
    var won = args.won;
    if (typeof won !== 'boolean') return { ok: false, code: 'invalid' };
    if (S.rewardIds.indexOf(id) >= 0) return { ok: false, code: 'duplicate' };

    S.rewardIds.push(id);
    if (S.rewardIds.length > MAX_REWARD_IDS) S.rewardIds = S.rewardIds.slice(-MAX_REWARD_IDS);

    S.gamesPlayed += 1;
    if (score > S.bests[game]) S.bests[game] = score;

    var coins;
    if (game === 'snake') coins = 4 + Math.min(score, 12);
    else if (game === 'stars') coins = 4 + Math.min(score, 6) * 2;
    else coins = won ? 12 : 4;
    var xpGain = 8 + Math.min(score, 12);

    S.coins = clamp(S.coins + coins, 0, MAX_COINS);
    S.xp = clamp(S.xp + xpGain, 0, MAX_XP);
    gainNeed('energy', -4);
    gainNeed('joy', Math.min(12, score + 3));
    gainNeed('hunger', -2);
    if (won) S.wins += 1;

    return { ok: true, changed: true, grant: { coins: coins, xp: xpGain, milestones: [] } };
  }

  function actBuy(args) {
    var item = typeof args.id === 'string' ? ITEM_BY_ID[args.id] : null; // девайсы + одежда
    if (!item) return { ok: false, code: 'invalid' };
    if (S.owned.indexOf(item.id) >= 0) return { ok: false, code: 'owned' };
    if (levelOf(S.xp) < item.level) return { ok: false, code: 'level' };
    if (S.coins < item.cost) return { ok: false, code: 'coins' };
    S.coins -= item.cost;
    S.owned.push(item.id);
    return { ok: true, changed: true };
  }

  function actEquip(args) {
    var slot = args.slot;
    if (typeof slot !== 'string' || SLOT_KEYS.indexOf(slot) < 0) return { ok: false, code: 'invalid' };
    var id = args.id;
    if (id === 'none') { S.equipped[slot] = 'none'; return { ok: true, changed: true }; }
    var item = typeof id === 'string' ? CATALOG_BY_ID[id] : null;
    if (!item || item.slot !== slot) return { ok: false, code: 'invalid' };
    if (S.owned.indexOf(id) < 0) return { ok: false, code: 'not-owned' };
    S.equipped[slot] = id;
    return { ok: true, changed: true };
  }

  // Одежда Семиры: только clothesCatalog-слоты и owned-совместимые одежды (или 'none').
  // Любой успешный dress сбрасывает petLook — переключение на раздельную одежду;
  // безуспешный (invalid/not-owned) petLook не трогает.
  function actDress(args) {
    var slot = args.slot;
    if (typeof slot !== 'string' || CLOTHES_SLOT_KEYS.indexOf(slot) < 0) return { ok: false, code: 'invalid' };
    var id = args.id;
    if (id === 'none') { S.petClothes[slot] = 'none'; S.petLook = 'none'; return { ok: true, changed: true }; }
    var item = typeof id === 'string' ? CLOTHES_BY_ID[id] : null;
    if (!item || item.slot !== slot) return { ok: false, code: 'invalid' }; // device-id/чужой слот
    if (S.owned.indexOf(id) < 0) return { ok: false, code: 'not-owned' };
    S.petClothes[slot] = id;
    S.petLook = 'none';
    return { ok: true, changed: true };
  }

  // Целостный «сгенерированный» образ: точный allow-list lookCatalog или 'none'.
  // Все образы бесплатны — без owned/уровня/монет; wealth/needs/owned/petClothes при
  // надевании образа не меняются (обратимый возврат через старый dress-UI). Спячка не
  // мешает (косметика). 'none' — «совсем без одежды»: petLook='none' И оба слота
  // petClothes -> 'none' (родителю запрещено неявно воскресать в старой одежде).
  // invalid (не строка / не из allow-list) — без мутаций.
  function actLook(args) {
    var id = args.id;
    if (typeof id !== 'string') return { ok: false, code: 'invalid' };
    if (id === 'none') {
      S.petLook = 'none';
      S.petClothes.neck = 'none';
      S.petClothes.cape = 'none';
      return { ok: true, changed: true };
    }
    if (!LOOK_SET[id]) return { ok: false, code: 'invalid' };
    S.petLook = id;
    return { ok: true, changed: true };
  }

  function actShell(args) {
    var id = args.id;
    if (typeof id !== 'string' || !SHELL_SET[id]) return { ok: false, code: 'invalid' };
    S.shell = id;
    return { ok: true, changed: true };
  }

  function lifecycleBlocked(type) {
    if (!S.biology) return false;
    if (type === 'reward' && S.biology.mode === 'legacyNoDeath') return false;
    if (type === 'reward' || type === 'feed' || type === 'bath' || type === 'groom' || type === 'sleep') {
      return S.biology.lifeState === 'egg' ? 'egg' : (S.biology.lifeState === 'grave' ? 'grave' : (S.biology.paused ? 'paused' : false));
    }
    return false;
  }
  function archiveCurrent(reason, now) {
    if (reason === 'death' && S.biology.lifeState !== 'grave') return false;
    for (var existing = 0; existing < S.archives.length; existing++) {
      if (S.archives[existing].lifeId === S.biology.lifeId) return true;
    }
    if (S.archives.length >= MAX_ARCHIVES) return false;
    S.archives.push({lifeId:S.biology.lifeId, reason:reason, archivedAt:now, biology:JSON.parse(JSON.stringify(S.biology)), needs:{hunger:S.needs.hunger,joy:S.needs.joy,energy:S.needs.energy,clean:S.needs.clean}, sleeping:S.sleeping, bowNeat:S.bowNeat, rewardIds:S.rewardIds.slice(), account:{coins:S.coins,xp:S.xp,owned:S.owned.slice(),equipped:{strap:S.equipped.strap,beads:S.equipped.beads,charm:S.equipped.charm},petClothes:{neck:S.petClothes.neck,cape:S.petClothes.cape},petLook:S.petLook,shell:S.shell,achievements:S.achievements.slice(),bests:{snake:S.bests.snake,stars:S.bests.stars,memory:S.bests.memory},careCount:S.careCount,gamesPlayed:S.gamesPlayed,wins:S.wins,lastGroomAt:S.lastGroomAt,lastFeedAt:S.lastFeedAt,lastCareXpAt:{feed:S.lastCareXpAt.feed,bath:S.lastCareXpAt.bath,groom:S.lastCareXpAt.groom},careXpBucket:S.careXpBucket,careXpInBucket:S.careXpInBucket}});
    return true;
  }
  function archiveTerminal(now) {
    if (!S.biology || S.biology.lifeState !== 'grave') return false;
    var before = S.archives.length;
    archiveCurrent('death', now);
    return S.archives.length !== before;
  }
  function act(type, args, now) {
    now = sanitizeNow(now);
    if (now === null) return {ok:false, code:'invalid', snapshot:get()};
    if (!isPlainObject(args)) args = {};
    if (S.biology && S.biology.lifeState !== 'grave') {
      var beforeBioTime = S.biology.lastLifeTime;
      advanceBiology(now, lastActivity);
      S.lastTime = Math.max(S.lastTime, S.biology.lastLifeTime, now);
      if (S.biology.lastLifeTime < now) S.biology.lastLifeTime = now;
    } else { S.lastTime = Math.max(S.lastTime, now); }
    var terminalAdded = archiveTerminal(now);
    if (terminalAdded || (S.biology && S.biology.lifeState === 'grave')) save(now);
    var blocked = lifecycleBlocked(type); if (blocked) { save(now); return {ok:false,code:blocked,snapshot:get()}; }
    var res;
    switch (type) {
      case 'feed': res = actFeed(args, now); break;
      case 'bath': res = actBath(args, now); break;
      case 'groom': res = actGroom(args, now); break;
      case 'sleep': res = actSleep(); break;
      case 'wake': res = actWake(); break;
      case 'reward': res = actReward(args); break;
      case 'buy': res = actBuy(args); break;
      case 'equip': res = actEquip(args); break;
      case 'dress': res = actDress(args); break;
      case 'look': res = actLook(args); break;
      case 'shell': res = actShell(args); break;
      case 'hatch':
        res = Bio.command(biologyFrame(), 'hatch', args, now); if (res.ok) { copyBioFrame(res.frame); res.changed=true; } break;
      case 'medicine':
        var healthBefore = S.biology ? S.biology.health : 0;
        res = Bio.command(biologyFrame(), 'medicine', args, now); if (res.ok) { copyBioFrame(res.frame); res.changed=true; res.benefit=Math.max(0, S.biology.health-healthBefore); } break;
      case 'pause':
        if (args.confirmed !== true) res = {ok:false,code:'invalid'}; else { res = Bio.command(biologyFrame(), 'pause', args, now); if (res.ok) { copyBioFrame(res.frame); res.changed=true; } } break;
      case 'resume':
        res = Bio.command(biologyFrame(), 'resume', args, now); if (res.ok) { copyBioFrame(res.frame); res.changed=true; } break;
      case 'critical-seen':
        res = Bio.command(biologyFrame(), 'critical-seen', args, now); if (res.ok) { copyBioFrame(res.frame); res.changed=true; } break;
      case 'new-life':
        if (args.confirmed !== true || args.backupExported !== true || (args.mode !== 'safe' && args.mode !== 'classic') || typeof args.requestId !== 'string' || !REWARD_ID_RE.test(args.requestId) || typeof args.keepCollection !== 'boolean') { res={ok:false,code:'invalid'}; break; }
        if (S.requestIds.indexOf(args.requestId)>=0) { res={ok:false,code:'duplicate'}; break; }
        var parent=S.biology.lifeId, gen=S.biology.generation+1, keep=args.keepCollection;
        var oldArchives=S.archives.slice();
        var account={coins:S.coins,xp:S.xp,owned:S.owned,equipped:S.equipped,petClothes:S.petClothes,petLook:S.petLook,shell:S.shell,achievements:S.achievements,bests:S.bests};
        if (S.archives.length >= MAX_ARCHIVES) { res={ok:false,code:'archive-full'}; break; }
        if (!archiveCurrent('new-life',now)) { res={ok:false,code:'archive-full'}; break; }
        oldArchives=S.archives.slice();
        var priorRequests=S.requestIds.slice(); S=freshState(now); S.archives=oldArchives; S.requestIds=priorRequests; if(S.requestIds.indexOf(args.requestId)<0) S.requestIds.push(args.requestId); if(S.requestIds.length>MAX_REQUEST_IDS) S.requestIds.shift(); S.biology=createBiology(now,args.mode,parent,gen); if(keep){S.coins=account.coins;S.xp=account.xp;S.owned=account.owned;S.equipped=account.equipped;S.petClothes=account.petClothes;S.petLook=account.petLook;S.shell=account.shell;S.achievements=account.achievements;S.bests=account.bests;} res={ok:true,changed:true}; break;
      case 'archive-delete':
        if(args.confirmed!==true||typeof args.lifeId!=='string'){res={ok:false,code:'invalid'};break;} var idx=S.archives.findIndex(function(a){return a.lifeId===args.lifeId;}); if(idx<0){res={ok:false,code:'not-found'};break;} S.archives.splice(idx,1); res={ok:true,changed:true}; break;
      default:
        return { ok: false, code: 'unknown', snapshot: get() };
    }
    var result = { ok: res.ok, snapshot: get() };
    if (res.code) result.code = res.code;
    if (res.ok && res.changed && S.biology && (type === 'feed' || type === 'bath' || type === 'groom' || type === 'medicine')) {
      var bondResult = Bio.command(biologyFrame(), 'bond', {benefit:res.benefit || 0, groomed:res.groomed === true}, now);
      if (bondResult.ok) copyBioFrame(Bio.reconcile(bondResult.frame));
      else copyBioFrame(Bio.reconcile(biologyFrame()));
    }
    if (res.changed) {
      var grant = res.grant || { milestones: [] };
      if (!Array.isArray(grant.milestones)) grant.milestones = [];
      checkMilestones(grant);
      if (grant.coins || grant.xp || grant.milestones.length) {
        var reward = {};
        if (grant.coins) reward.coins = grant.coins;
        if (grant.xp) reward.xp = grant.xp;
        if (grant.milestones.length) reward.milestones = grant.milestones.slice();
        result.reward = reward;
      }
      save(now);
      notify();
    }
    result.snapshot = get(); // Include milestone bonuses and actual save status.
    return result;
  }

  // ---------------- snapshot ----------------
  function get() {
    var snap = {
      v: SAVE_VERSION,
      createdAt: S.createdAt,
      lastTime: S.lastTime,
      needs: { hunger: S.needs.hunger, joy: S.needs.joy, energy: S.needs.energy, clean: S.needs.clean },
      sleeping: S.sleeping,
      bowNeat: S.bowNeat,
      xp: S.xp,
      level: levelOf(S.xp),
      coins: S.coins,
      careCount: S.careCount,
      gamesPlayed: S.gamesPlayed,
      wins: S.wins,
      bests: { snake: S.bests.snake, stars: S.bests.stars, memory: S.bests.memory },
      owned: S.owned.slice(),
      equipped: { strap: S.equipped.strap, beads: S.equipped.beads, charm: S.equipped.charm },
      petClothes: { neck: S.petClothes.neck, cape: S.petClothes.cape },
      petLook: S.petLook,
      shell: S.shell,
      achievements: S.achievements.slice(),
      storage: storageMode,
      biology: JSON.parse(JSON.stringify(S.biology)),
      archives: JSON.parse(JSON.stringify(S.archives)),
      lifecycle: Bio ? Bio.describe(biologyFrame()) : null
    };
    var notice = computeNotice(snap);
    if (notice) snap.notice = notice;
    return snap;
  }

  function computeNotice(snap) {
    if (sessionNotice) return sessionNotice;
    if (storageMode === 'memory') return NOTICE_MEMORY;
    var low = [];
    for (var i = 0; i < NEED_KEYS.length; i++) {
      if (snap.needs[NEED_KEYS[i]] <= LOW_NEED) low.push(NEED_KEYS[i]);
    }
    if (low.length) { var names = {hunger:'сытость',joy:'радость',energy:'бодрость',clean:'чистота'}; return 'Низкие потребности: ' + low.map(function(k){return names[k];}).join(', '); }
    return null;
  }

  // ---------------- subscriptions ----------------
  function setActivity(activity, now) {
    now = sanitizeNow(now);
    if (now === null) return get();
    // Flush the interval using the old eligibility before switching activity.
    advance(now, lastActivity);
    lastActivity = activity && typeof activity === 'object' ? {visible:activity.visible === true, drawer:activity.drawer === true} : {visible:false, drawer:false};
    lastActivityAt = now;
    return get();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function unsubscribe() {};
    subscribers.push(fn);
    var done = false;
    return function unsubscribe() {
      if (done) return;
      done = true;
      var i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  function notify() {
    var snap = get();
    var list = subscribers.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](snap); } catch (err) { /* подписчик не ломает движок */ }
    }
  }

  // ---------------- export / import / reset ----------------
  function exportSave() {
    return JSON.stringify(buildPayload(S));
  }

  function importSave(text) {
    if (typeof text !== 'string') return { ok: false, code: 'invalid' };
    if (text.length > MAX_IMPORT_CHARS) return { ok: false, code: 'too-large' };
    var obj;
    try { obj = JSON.parse(text); } catch (err) { return { ok: false, code: 'invalid' }; }
    if (!isPlainObject(obj)) return { ok: false, code: 'invalid' };
    var now = Date.now();
    var next;
    try {
      if (obj.v === LEGACY_VERSION) {
        var legacyRaw = text;
        var legacyObj = Object.assign({}, obj, {v:SAVE_VERSION, biology:Bio.create({now:now, mode:'legacyNoDeath', lifeId:newLifeId(now), parentLifeId:null, generation:1}), archives:[], requestIds:[]});
        next = sanitizeState(legacyObj, now);
        next.biology.lifeState = 'legacyLiving';
        next.biology.lastLifeTime = next.lastTime; // v1 cursor is part of physiology
        if (storageRef) {
          try {
            if (!storageRef.getItem(BACKUP_KEY)) storageRef.setItem(BACKUP_KEY, legacyRaw);
          } catch (backupErr) {
            storageRef = null; storageMode = 'memory';
            return {ok:false, code:'invalid'};
          }
        }
      } else if (obj.v === SAVE_VERSION) {
        next = sanitizeState(obj, now);
      } else return { ok: false, code: 'version' };
    } catch (err) { return { ok: false, code: 'invalid' }; }
    // мутация только после полной валидации
    S = next;
    sessionNotice = null;
    storageRef = probeStorage(); // явный импорт возвращает local после unknown-version
    storageMode = storageRef ? 'local' : 'memory';
    lastSaveAt = now;
    save(now);
    notify();
    return { ok: true };
  }

  function reset(now) {
    now = sanitizeNow(now);
    if (now === null) return get();
    S = freshState(now);
    sessionNotice = null;
    storageRef = probeStorage();
    storageMode = storageRef ? 'local' : 'memory';
    lastSaveAt = now;
    save(now);
    notify();
    return get();
  }

  // ---------------- init + export ----------------
  initLoad();

  var api = {
    get: get,
    act: act,
    advance: advance,
    subscribe: subscribe,
    catalog: CATALOG,
    clothesCatalog: CLOTHES_CATALOG,
    lookCatalog: LOOK_CATALOG,
    exportSave: exportSave,
    importSave: importSave,
    reset: reset,
    setActivity: setActivity
  };
  try { Object.freeze(api); } catch (err) { /* ignore */ }

  if (typeof window !== 'undefined' && window) {
    try { window.TamaLife = api; } catch (err) { /* ignore */ }
  }
  if (typeof module !== 'undefined' && module && module.exports !== undefined) {
    module.exports = api;
  }
  return api;
})();
