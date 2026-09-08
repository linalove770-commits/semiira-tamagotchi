/*
 * SEMIIRA — pure biology reducer (contract: docs/LIFECYCLE-IMPLEMENTATION-CONTRACT.md,
 * normative spec: docs/TAMAGOTCHI-SYSTEM.md §§3–14).
 *
 * Deterministic lifecycle physics, no storage/DOM/network/timers. All time enters
 * through `now` args. Integration is boundary-event driven: advance() splits the
 * (<=8h) interval at the exact millisecond of the next state boundary (need
 * thresholds 20/40 in the direction of motion, stage 12/48/108/228h, waste unit,
 * full pressure hour, illness 6/12h, attention 30min, critical 2h, health up
 * through 10 while recovering) and applies closed-form rates per segment. No
 * fixed 1s discretization: a <=8h interval split into arbitrary chunks gives the
 * identical result to one call.
 *
 * All meters are held internally as exact integers (1 point = SCALE sub-units,
 * rates are integer sub-units per ms), so arithmetic is associative and split
 * invariance is exact, not approximate. Fractional threshold crossings round to
 * a deterministic integer deadline (ceil for downward crossings, floor+1 for
 * upward), identical in every split.
 *
 * Field semantics per contract: pressureMs is CONTINUOUS low-physiology time
 * (reset only when all three needs leave <=20); pressureTicks counts applied
 * full-hour damage. careMistakeTimes store BIO-AGE ms (ageMs at the mistake), so
 * the 6h care-quality window is accredited time: offline catch-up and full pause
 * cannot forgive or penalize it.
 *
 * UMD: window.TamaBiology (browser, load BEFORE life.js) + CommonJS export.
 */
(function () {
  'use strict';

  var HOUR = 3600000;
  var MIN = 60000;
  var OFFLINE_CAP = 8 * HOUR;
  var EGG_MS = 15 * MIN;
  var SCALE = 3600000; // 1 meter point = SCALE sub-units; rate[points/h] * dt[ms] = sub-units

  var STAGE_START = { baby: 0, child: 12 * HOUR, teen: 48 * HOUR, adult: 108 * HOUR, elder: 228 * HOUR };
  var STAGE_ORDER = ['baby', 'child', 'teen', 'adult', 'elder'];
  var WASTE_PERIOD = { baby: 2 * HOUR, child: 3 * HOUR, teen: 3 * HOUR, adult: 4 * HOUR, elder: 4 * HOUR };

  var AWAKE_RATE = { hunger: 6, joy: 4, energy: 5, clean: 3 }; // per hour
  var ASLEEP_RATE = { hunger: 3, joy: 1, clean: 1 }; // per hour; energy +18/h
  var SLEEP_ENERGY_PER_HOUR = 18;

  var PRESSURE_DAMAGE = 4; // single penalty per full pressure hour, never per-need
  var STABLE_RECOVERY = 2; // per hour when hunger/energy/clean all > 40 and healthy
  var MEDICINE_HEALTH = 20;
  var MEDICINE_COOLDOWN = 30 * MIN;
  var ATTENTION_MS = 30 * MIN;
  var MISTAKE_WINDOW = 6 * HOUR; // of bio-age, not wall clock
  var CRITICAL_MS = 2 * HOUR;
  var ILLNESS_HELP_AGE = 6 * HOUR;
  var ILLNESS_CRITICAL_AGE = 12 * HOUR;
  var BOW_MESSY_MS = 30 * MIN;
  var MAX_MISTAKES = 100;
  var MAX_GUARDS = 4096; // event-loop safety, far above any real event count in 8h

  // Strict own-property allowlists: prototype names ('constructor', 'toString')
  // are values on these objects' prototype chain and must not be accepted.
  var MODES = { safe: 1, classic: 1, legacyNoDeath: 1 };
  var STAGES = { egg: 1, baby: 1, child: 1, teen: 1, adult: 1, elder: 1, grave: 1, legacyLiving: 1 };
  var ILLNESSES = { fever: 1, stomach: 1, cold: 1 };
  var PERSONALITIES = { calm: 1, curious: 1, shy: 1 };
  var LIVING = { baby: 1, child: 1, teen: 1, adult: 1, elder: 1 };

  function owns(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function intOr(v, def, lo, hi) {
    if (typeof v !== 'number' || !isFinite(v)) return def;
    v = Math.floor(v);
    return clamp(v, lo, hi);
  }
  function numOr(v, def, lo, hi) {
    if (typeof v !== 'number' || !isFinite(v)) return def;
    return clamp(v, lo, hi);
  }

  function defaultBiology(now, mode, lifeId, parentLifeId, generation) {
    return {
      lifeId: lifeId,
      parentLifeId: parentLifeId,
      generation: generation,
      mode: mode,
      lifeState: mode === 'legacyNoDeath' ? 'legacyLiving' : 'egg',
      ageMs: 0,
      stageMs: 0,
      eggReady: false,
      health: 100,
      waste: 0,
      wasteProgress: 0,
      pressureMs: 0,
      pressureTicks: 0,
      illness: null,
      illnessAgeMs: 0,
      medicineCooldownMs: 0,
      criticalPending: false,
      criticalSeen: false,
      criticalActiveMs: 0,
      paused: false,
      attentionCauses: [],
      attentionActiveMs: 0,
      careMistakeTimes: [],
      bond: 0,
      bondDayBucket: 0,
      bondDailyCount: 0,
      lastLifeTime: now,
      personality: 'calm',
      deathReason: null,
      diedAt: null
    };
  }

  function create(options) {
    var o = isObj(options) ? options : {};
    var now = (typeof o.now === 'number' && isFinite(o.now)) ? Math.floor(o.now) : Date.now();
    var mode = o.mode || 'safe';
    if (!owns(MODES, mode)) throw new Error('biology: unknown mode');
    if (typeof o.lifeId !== 'string' || !o.lifeId) throw new Error('biology: lifeId required');
    if (o.parentLifeId !== null && o.parentLifeId !== undefined && typeof o.parentLifeId !== 'string') {
      throw new Error('biology: bad parentLifeId');
    }
    var generation = o.generation === undefined ? 1 : o.generation;
    if (!Number.isInteger(generation) || generation < 1) throw new Error('biology: bad generation');
    return defaultBiology(now, mode, o.lifeId, o.parentLifeId || null, generation);
  }

  function sanitizeCause(c) {
    return (c === 'hunger' || c === 'joy' || c === 'energy' || c === 'clean' || c === 'illness') ? c : null;
  }

  function sanitize(raw, now) {
    if (!isObj(raw)) throw new Error('biology: not an object');
    var t = (typeof now === 'number' && isFinite(now)) ? Math.floor(now) : Date.now();
    if (!owns(MODES, raw.mode)) throw new Error('biology: unknown mode');
    if (!owns(STAGES, raw.lifeState)) throw new Error('biology: unknown lifeState');
    if (typeof raw.lifeId !== 'string' || !raw.lifeId) throw new Error('biology: bad lifeId');
    if (raw.parentLifeId !== null && raw.parentLifeId !== undefined && typeof raw.parentLifeId !== 'string') {
      throw new Error('biology: bad parentLifeId');
    }
    if (!Number.isInteger(raw.generation) || raw.generation < 1) throw new Error('biology: bad generation');
    if (raw.mode === 'legacyNoDeath' && raw.lifeState !== 'legacyLiving') throw new Error('biology: legacy must be legacyLiving');
    if (raw.mode !== 'legacyNoDeath' && raw.lifeState === 'legacyLiving') throw new Error('biology: legacyLiving needs legacyNoDeath');
    if (raw.illness !== null && raw.illness !== undefined && !owns(ILLNESSES, raw.illness)) throw new Error('biology: bad illness');
    var b = defaultBiology(t, raw.mode, raw.lifeId, raw.parentLifeId || null, raw.generation);
    b.lifeState = raw.lifeState;
    b.ageMs = intOr(raw.ageMs, 0, 0, 9007199254740991);
    b.stageMs = intOr(raw.stageMs, 0, 0, 9007199254740991);
    b.eggReady = raw.eggReady === true;
    b.health = numOr(raw.health, 100, 0, 100);
    // Safe/classic living health can never enter below 1, even via import:
    // death in classic comes from the seen-critical timer, not from health 0.
    if (owns(LIVING, b.lifeState) && b.mode !== 'legacyNoDeath' && b.health < 1) b.health = 1;
    b.waste = intOr(raw.waste, 0, 0, 3);
    b.wasteProgress = numOr(raw.wasteProgress, 0, 0, 1);
    b.pressureMs = intOr(raw.pressureMs, 0, 0, 9007199254740991);
    b.pressureTicks = intOr(raw.pressureTicks, 0, 0, 9007199254740991);
    b.illness = owns(ILLNESSES, raw.illness) ? raw.illness : null;
    b.illnessAgeMs = intOr(raw.illnessAgeMs, 0, 0, 9007199254740991);
    b.medicineCooldownMs = intOr(raw.medicineCooldownMs, 0, 0, 9007199254740991);
    b.paused = raw.paused === true;
    // Derived/eligibility state is recomputed, never trusted from import.
    b.attentionCauses = [];
    if (Array.isArray(raw.attentionCauses) && owns(LIVING, b.lifeState)) {
      for (var i = 0; i < raw.attentionCauses.length && b.attentionCauses.length < 5; i++) {
        var c = sanitizeCause(raw.attentionCauses[i]);
        if (c && b.attentionCauses.indexOf(c) < 0) b.attentionCauses.push(c);
      }
    }
    b.attentionActiveMs = owns(LIVING, b.lifeState) ? intOr(raw.attentionActiveMs, 0, 0, 9007199254740991) : 0;
    b.careMistakeTimes = [];
    if (Array.isArray(raw.careMistakeTimes)) {
      for (var j = 0; j < raw.careMistakeTimes.length; j++) {
        if (typeof raw.careMistakeTimes[j] === 'number' && isFinite(raw.careMistakeTimes[j])) {
          b.careMistakeTimes.push(Math.floor(raw.careMistakeTimes[j]));
        }
      }
      if (b.careMistakeTimes.length > MAX_MISTAKES) {
        b.careMistakeTimes = b.careMistakeTimes.slice(-MAX_MISTAKES);
      }
    }
    if (b.mode === 'classic' && owns(LIVING, b.lifeState)) {
      b.criticalPending = raw.criticalPending === true;
      b.criticalSeen = raw.criticalSeen === true;
      b.criticalActiveMs = intOr(raw.criticalActiveMs, 0, 0, 9007199254740991);
    }
    b.bond = intOr(raw.bond, 0, 0, 100);
    b.bondDayBucket = intOr(raw.bondDayBucket, 0, 0, 9007199254740991);
    b.bondDailyCount = intOr(raw.bondDailyCount, 0, 0, 6);
    b.lastLifeTime = (typeof raw.lastLifeTime === 'number' && isFinite(raw.lastLifeTime)) ? Math.floor(raw.lastLifeTime) : t;
    b.personality = owns(PERSONALITIES, raw.personality) ? raw.personality : 'calm';
    b.deathReason = (typeof raw.deathReason === 'string' && raw.deathReason) ? raw.deathReason.slice(0, 80) : null;
    b.diedAt = (typeof raw.diedAt === 'number' && isFinite(raw.diedAt)) ? Math.floor(raw.diedAt) : null;
    return b;
  }

  function normActivity(a) {
    return { visible: !!(a && a.visible === true), drawer: !!(a && a.drawer === true) };
  }

  function isLiving(bio) { return !!LIVING[bio.lifeState]; }

  // Double-space predicates for reconcile/describe on raw frame needs.
  function lowPhysio(needs) {
    return needs.hunger <= 20 || needs.energy <= 20 || needs.clean <= 20;
  }

  // N-space predicates (exact integers).
  function lowN(n) {
    return n.hunger <= 20 * SCALE || n.energy <= 20 * SCALE || n.clean <= 20 * SCALE;
  }
  function stableN(n) {
    return n.hunger > 40 * SCALE && n.energy > 40 * SCALE && n.clean > 40 * SCALE;
  }
  function causesFromN(n, bio) {
    var causes = [];
    if (n.hunger <= 20 * SCALE) causes.push('hunger');
    if (n.joy <= 20 * SCALE) causes.push('joy');
    if (n.energy <= 20 * SCALE) causes.push('energy');
    if (n.clean <= 20 * SCALE) causes.push('clean');
    if (bio.illness) causes.push('illness');
    return causes;
  }
  function currentCauses(frame) {
    var causes = [];
    var n = frame.needs;
    if (n.hunger <= 20) causes.push('hunger');
    if (n.joy <= 20) causes.push('joy');
    if (n.energy <= 20) causes.push('energy');
    if (n.clean <= 20) causes.push('clean');
    if (frame.biology.illness) causes.push('illness');
    return causes;
  }
  // Critical condition is purely physiological (classic living): pause or
  // hidden tab must freeze the episode, never clear it.
  function criticalConditionN(bio, healthN) {
    if (!isLiving(bio) || bio.mode !== 'classic') return false;
    if (healthN <= 10 * SCALE) return true;
    if (bio.illness && bio.illnessAgeMs >= ILLNESS_CRITICAL_AGE) return true;
    return false;
  }
  function criticalCondition(bio) {
    return criticalConditionN(bio, Math.round(bio.health * SCALE));
  }

  // careMistakeTimes hold bio-age ms: the 6h window is accredited time, so
  // offline forgiveness and pause can neither prune nor extend mistakes.
  function pruneMistakes(bio) {
    var cutoff = bio.ageMs - MISTAKE_WINDOW;
    var kept = [];
    for (var i = 0; i < bio.careMistakeTimes.length; i++) {
      if (bio.careMistakeTimes[i] > cutoff) kept.push(bio.careMistakeTimes[i]);
    }
    bio.careMistakeTimes = kept;
  }
  function careQualityOf(bio) {
    pruneMistakes(bio);
    return Math.max(0, 100 - 10 * bio.careMistakeTimes.length);
  }
  function personalityFor(q) {
    return q >= 80 ? 'calm' : (q >= 50 ? 'curious' : 'shy');
  }
  function wastePeriod(bio) {
    return WASTE_PERIOD[bio.lifeState] || WASTE_PERIOD.baby;
  }
  function needsToN(needs) {
    return {
      hunger: Math.round(numOr(needs.hunger, 80, 0, 100) * SCALE),
      joy: Math.round(numOr(needs.joy, 75, 0, 100) * SCALE),
      energy: Math.round(numOr(needs.energy, 85, 0, 100) * SCALE),
      clean: Math.round(numOr(needs.clean, 85, 0, 100) * SCALE)
    };
  }
  function writeNeeds(needs, n) {
    needs.hunger = n.hunger / SCALE;
    needs.joy = n.joy / SCALE;
    needs.energy = n.energy / SCALE;
    needs.clean = n.clean / SCALE;
  }

  /*
   * Boundary-event integrator for one living interval [startMs, endMs] under a
   * single activity/sleeping regime. Deterministic; exact integer state.
   */
  function integrate(out, startMs, endMs, act) {
    var bio = out.biology;
    var sleeping = out.sleeping === true;
    var eligibleAttention = act.visible && !act.drawer && !sleeping; // paused/living guaranteed by caller
    var n = needsToN(out.needs);
    var healthN = Math.round(numOr(bio.health, 100, 0, 100) * SCALE);

    // Waste remainder in exact ms of the current stage's period; a pending
    // unit from a fractional import is emitted here, once, deterministically.
    var period = wastePeriod(bio);
    var wasteRem = Math.round(clamp(numOr(bio.wasteProgress, 0, 0, 1), 0, 1) * period);
    while (wasteRem >= period) {
      wasteRem -= period;
      if (bio.waste < 3) {
        bio.waste += 1;
        n.clean = Math.max(0, n.clean - 8 * SCALE);
      }
    }

    var t = startMs;
    var guard = 0;
    var dead = false;

    function condCritical() { return criticalConditionN(bio, healthN); }

    function syncAttention() {
      var causes = causesFromN(n, bio);
      if (causes.length === 0) {
        bio.attentionCauses = [];
        bio.attentionActiveMs = 0;
      } else {
        if (bio.attentionCauses.length === 0) bio.attentionActiveMs = 0; // new call opens at zero
        bio.attentionCauses = causes;
      }
    }

    function maybeOnset() {
      if (!bio.illness && healthN <= 35 * SCALE && bio.pressureTicks >= 2) {
        bio.illness = n.clean <= 20 * SCALE ? 'fever' : (n.hunger <= 20 * SCALE ? 'stomach' : 'cold');
        bio.illnessAgeMs = 0; // onset now: the illness does not age before it exists
      }
    }

    function applySegment(dt) {
      // Conditions are frozen at the START of the segment: nextEvent() guarantees
      // no low/stable/health-10/illness-age threshold is crossed strictly inside
      // it, so the start state holds throughout. Attributing the end state to the
      // whole segment would mis-charge the crossing interval itself.
      var lowNow = lowN(n);
      var stableNow = stableN(n);
      var critNow = condCritical();
      bio.ageMs += dt;
      bio.stageMs += dt;
      if (sleeping) {
        n.hunger -= ASLEEP_RATE.hunger * dt;
        n.joy -= ASLEEP_RATE.joy * dt;
        n.energy += SLEEP_ENERGY_PER_HOUR * dt;
        n.clean -= ASLEEP_RATE.clean * dt;
      } else {
        n.hunger -= AWAKE_RATE.hunger * dt;
        n.joy -= (AWAKE_RATE.joy + (bio.illness === 'cold' ? 1 : 0)) * dt;
        n.energy -= (bio.illness === 'fever' ? 10 : AWAKE_RATE.energy) * dt;
        n.clean -= AWAKE_RATE.clean * dt;
        wasteRem += dt;
      }
      n.hunger = clamp(n.hunger, 0, 100 * SCALE);
      n.joy = clamp(n.joy, 0, 100 * SCALE);
      n.energy = clamp(n.energy, 0, 100 * SCALE);
      n.clean = clamp(n.clean, 0, 100 * SCALE);
      if (lowNow) {
        bio.pressureMs += dt; // continuous low-physiology pressure
      } else {
        bio.pressureMs = 0;
        bio.pressureTicks = 0;
      }
      if (!lowNow && stableNow && !bio.illness) {
        healthN = Math.min(100 * SCALE, healthN + STABLE_RECOVERY * dt);
      }
      if (bio.illness) bio.illnessAgeMs += dt;
      if (bio.medicineCooldownMs > 0) bio.medicineCooldownMs = Math.max(0, bio.medicineCooldownMs - dt);
      if (bio.attentionCauses.length > 0 && eligibleAttention) bio.attentionActiveMs += dt;
      if (bio.criticalSeen && act.visible && !act.drawer && critNow) bio.criticalActiveMs += dt;
    }

    // Earliest boundary at or before endMs; ties resolved by normative order:
    // needs -> age/stage -> waste -> pressure/health -> illness -> attention -> deadline.
    function nextEvent() {
      var best = null;
      function consider(rem, prio, kind) {
        if (rem < 0) rem = 0;
        if (t + rem > endMs) return;
        if (best === null || rem < best.rem || (rem === best.rem && prio < best.prio)) {
          best = { rem: rem, prio: prio, kind: kind };
        }
      }
      var r;
      if (sleeping) {
        if (n.hunger > 20 * SCALE) consider(Math.ceil((n.hunger - 20 * SCALE) / ASLEEP_RATE.hunger), 1, 'need20');
        if (n.hunger > 40 * SCALE) consider(Math.ceil((n.hunger - 40 * SCALE) / ASLEEP_RATE.hunger), 2, 'need40');
        if (n.clean > 20 * SCALE) consider(Math.ceil((n.clean - 20 * SCALE) / ASLEEP_RATE.clean), 1, 'need20');
        // joy boundary like awake: without it, sleeping event times between
        // joy20 crossings would differ from the awake schedule.
        if (n.joy > 20 * SCALE) consider(Math.ceil((n.joy - 20 * SCALE) / ASLEEP_RATE.joy), 1, 'need20');
        if (n.clean > 40 * SCALE) consider(Math.ceil((n.clean - 40 * SCALE) / ASLEEP_RATE.clean), 2, 'need40');
        if (n.energy <= 20 * SCALE) consider(Math.floor((20 * SCALE - n.energy) / SLEEP_ENERGY_PER_HOUR) + 1, 1, 'need20up');
        if (n.energy <= 40 * SCALE) consider(Math.floor((40 * SCALE - n.energy) / SLEEP_ENERGY_PER_HOUR) + 1, 2, 'need40up');
      } else {
        var eRate = bio.illness === 'fever' ? 10 : AWAKE_RATE.energy;
        var jRate = AWAKE_RATE.joy + (bio.illness === 'cold' ? 1 : 0);
        if (n.hunger > 20 * SCALE) consider(Math.ceil((n.hunger - 20 * SCALE) / AWAKE_RATE.hunger), 1, 'need20');
        if (n.hunger > 40 * SCALE) consider(Math.ceil((n.hunger - 40 * SCALE) / AWAKE_RATE.hunger), 2, 'need40');
        if (n.joy > 20 * SCALE) consider(Math.ceil((n.joy - 20 * SCALE) / jRate), 1, 'need20');
        if (n.energy > 20 * SCALE) consider(Math.ceil((n.energy - 20 * SCALE) / eRate), 1, 'need20');
        if (n.energy > 40 * SCALE) consider(Math.ceil((n.energy - 40 * SCALE) / eRate), 2, 'need40');
        if (n.clean > 20 * SCALE) consider(Math.ceil((n.clean - 20 * SCALE) / AWAKE_RATE.clean), 1, 'need20');
        if (n.clean > 40 * SCALE) consider(Math.ceil((n.clean - 40 * SCALE) / AWAKE_RATE.clean), 2, 'need40');
      }
      if (bio.lifeState !== 'elder') {
        var idx = STAGE_ORDER.indexOf(bio.lifeState);
        var next = idx >= 0 ? STAGE_ORDER[idx + 1] : undefined;
        if (next) consider(Math.max(0, STAGE_START[next] - bio.ageMs), 3, 'stage');
      }
      if (!sleeping) consider(wastePeriod(bio) - wasteRem, 4, 'waste');
      if (lowN(n)) consider((bio.pressureTicks + 1) * HOUR - bio.pressureMs, 5, 'pressure');
      if (bio.illness) {
        if (bio.illnessAgeMs < ILLNESS_HELP_AGE) consider(ILLNESS_HELP_AGE - bio.illnessAgeMs, 6, 'illness6');
        if (bio.illnessAgeMs < ILLNESS_CRITICAL_AGE) consider(ILLNESS_CRITICAL_AGE - bio.illnessAgeMs, 7, 'illness12');
      }
      if (bio.attentionCauses.length > 0 && eligibleAttention) {
        consider(ATTENTION_MS - bio.attentionActiveMs, 8, 'attention');
      }
      // Recovery through health 10 is a boundary: critical eligibility must stop
      // at the exact crossing instead of letting a deadline event consume the
      // whole segment using the start-of-segment critical state.
      if (!lowN(n) && stableN(n) && !bio.illness && healthN < 10 * SCALE) {
        consider(Math.ceil((10 * SCALE - healthN) / STABLE_RECOVERY), 8, 'health10up');
      }
      if (bio.criticalSeen && act.visible && !act.drawer && condCritical()) {
        consider(CRITICAL_MS - bio.criticalActiveMs, 9, 'critical');
      }
      return best;
    }

    // Events exactly at endMs fire (normative order: integration completes at
    // `now`, a command in the same timestamp applies afterwards), so the loop
    // runs to t == endMs and exits when no pending event remains.
    while (t <= endMs) {
      if (++guard > MAX_GUARDS) break;
      syncAttention();
      maybeOnset();
      var ev = nextEvent();
      if (!ev && t >= endMs) break;
      var segEnd = ev ? t + ev.rem : endMs;
      if (segEnd > t) applySegment(segEnd - t);
      t = segEnd;
      if (!ev) break;
      if (ev.kind === 'stage') {
        var oldP = wastePeriod(bio);
        var idx = STAGE_ORDER.indexOf(bio.lifeState);
        var next = STAGE_ORDER[idx + 1];
        bio.lifeState = next;
        bio.stageMs = bio.ageMs - STAGE_START[next];
        var newP = wastePeriod(bio);
        if (newP !== oldP) wasteRem = Math.max(0, Math.round(wasteRem * newP / oldP));
        // Exact fraction is preserved including full periods: if the rescaled
        // remainder is already >= newP, the due unit must stay due NOW. The next
        // loop turn orders same-timestamp events normatively (stage first, then
        // waste), so the unit emits at the boundary, never 1ms later.
        bio.personality = personalityFor(careQualityOf(bio));
      } else if (ev.kind === 'waste') {
        wasteRem -= wastePeriod(bio);
        if (wasteRem < 0) wasteRem = 0;
        if (bio.waste < 3) {
          bio.waste += 1;
          n.clean = Math.max(0, n.clean - 8 * SCALE);
        }
      } else if (ev.kind === 'pressure') {
        bio.pressureTicks += 1; // one applied full hour of continuous pressure
        healthN -= PRESSURE_DAMAGE * SCALE;
        healthN = bio.mode === 'safe' ? Math.max(SCALE, healthN) : Math.max(0, healthN);
      } else if (ev.kind === 'attention') {
        bio.attentionActiveMs = 0; // the reset is itself the next 30min interval
        bio.careMistakeTimes.push(bio.ageMs);
        if (bio.careMistakeTimes.length > MAX_MISTAKES) bio.careMistakeTimes.shift();
      } else if (ev.kind === 'health10up') {
        // The critical condition has ended at this exact instant. Reset the
        // episode before any same-timestamp deadline can be considered.
        bio.criticalPending = false;
        bio.criticalSeen = false;
        bio.criticalActiveMs = 0;
      } else if (ev.kind === 'critical') {
        bio.lifeState = 'grave';
        bio.deathReason = bio.illness ? ('illness:' + bio.illness) : 'neglect';
        bio.diedAt = t;
        dead = true;
        break;
      }
      // need20/need40/need20up/need40up/illness6/illness12: pure segment
      // splitters — the crossed condition takes effect from the next segment.
    }

    if (!dead) {
      syncAttention();
      maybeOnset();
    }
    writeNeeds(out.needs, n);
    bio.health = healthN / SCALE;
    bio.wasteProgress = wasteRem / wastePeriod(bio);
    if (!dead) {
      if (criticalConditionN(bio, healthN)) {
        bio.criticalPending = true;
      } else {
        // Episode resets only when the physiological condition itself resolved.
        bio.criticalPending = false;
        bio.criticalSeen = false;
        bio.criticalActiveMs = 0;
      }
    }
  }

  function advance(frame, now, activity) {
    if (!isObj(frame) || !isObj(frame.biology) || !isObj(frame.needs)) return clone(frame);
    var bio0 = frame.biology;
    if (typeof now !== 'number' || !isFinite(now)) return clone(frame);
    now = Math.floor(now);
    if (now <= bio0.lastLifeTime) return clone(frame);
    var act = normActivity(activity);
    var out = clone(frame);
    var bio = out.biology;
    var fullElapsed = now - bio.lastLifeTime;
    var elapsed = Math.min(fullElapsed, OFFLINE_CAP);
    bio.lastLifeTime = now; // wall clock is always consumed; excess is forgiven

    // Bow: wall-clock cosmetic. Full pause and sleep freeze the 30min window by
    // shifting lastGroomAt (neither counts toward messy, no resume debt); grave
    // never changes it. Runs only after the paused/grave early-returns matter,
    // so pause/grave can no longer flip bowNeat.
    if (bio.lifeState !== 'grave') {
      // The 30min bow window is frozen for the ENTIRE pause by shifting
      // lastGroomAt by fullElapsed, not the 8h-capped elapsed: a 24h pause
      // would otherwise leave real lastGroomAt 16h in the past and be messy at
      // once after resume. Ordinary legacy sleep keeps prior cap semantics.
      if (bio.paused || out.sleeping === true) {
        if (typeof out.lastGroomAt === 'number' && isFinite(out.lastGroomAt)) out.lastGroomAt += fullElapsed;
      } else if (typeof out.lastGroomAt === 'number' && isFinite(out.lastGroomAt) && now - out.lastGroomAt >= BOW_MESSY_MS) {
        out.bowNeat = false;
      }
    }

    if (bio.paused) return out; // full pause freezes everything else
    if (bio.lifeState === 'grave') return out;

    if (bio.lifeState === 'egg') {
      bio.stageMs += elapsed;
      if (bio.stageMs >= EGG_MS) {
        bio.stageMs = EGG_MS;
        bio.eggReady = true;
      }
      return out; // egg freezes needs
    }

    if (bio.lifeState === 'legacyLiving') {
      legacyElapsed(out, elapsed);
      return out;
    }

    // Living: exact boundary-event integration over the accredited interval.
    integrate(out, now - elapsed, now, act);
    return out;
  }

  // Original v1 physiology for legacyLiving: exact legacy rates, no bio penalties.
  function legacyElapsed(out, ms) {
    if (!(ms > 0)) return;
    var hours = ms / HOUR;
    var needs = out.needs;
    if (out.sleeping === true) {
      needs.hunger = clamp(needs.hunger - 3 * hours, 0, 100);
      needs.joy = clamp(needs.joy - 1 * hours, 0, 100);
      needs.clean = clamp(needs.clean - 1 * hours, 0, 100);
      needs.energy = clamp(needs.energy + 18 * hours, 0, 100);
    } else {
      needs.hunger = clamp(needs.hunger - 6 * hours, 0, 100);
      needs.joy = clamp(needs.joy - 4 * hours, 0, 100);
      needs.energy = clamp(needs.energy - 5 * hours, 0, 100);
      needs.clean = clamp(needs.clean - 3 * hours, 0, 100);
    }
  }

  function fail(code, frame) { return { ok: false, code: code, frame: frame }; }

  function command(frame, type, args, now) {
    if (!isObj(frame) || !isObj(frame.biology)) return { ok: false, code: 'invalid', frame: clone(frame) };
    var a = isObj(args) ? args : {};
    var out = clone(frame);
    var bio = out.biology;

    if (type === 'hatch') {
      if (bio.paused) return fail('paused', out);
      if (bio.lifeState !== 'egg') return fail('invalid', out);
      if (!bio.eggReady) return fail('not-ready', out);
      bio.lifeState = 'baby';
      bio.ageMs = 0;
      bio.stageMs = 0;
      bio.eggReady = false;
      return { ok: true, frame: out };
    }

    if (type === 'medicine') {
      if (!isLiving(bio)) return fail('invalid', out);
      if (bio.paused) return fail('paused', out);
      if (out.sleeping === true) return fail('asleep', out);
      if (!bio.illness) return fail('healthy', out);
      if (bio.medicineCooldownMs > 0) return fail('cooldown', out);
      bio.illness = null;
      bio.illnessAgeMs = 0;
      bio.health = Math.min(100, bio.health + MEDICINE_HEALTH);
      bio.medicineCooldownMs = MEDICINE_COOLDOWN;
      bio.pressureMs = 0;
      bio.pressureTicks = 0;
      bio.criticalPending = false;
      bio.criticalSeen = false;
      bio.criticalActiveMs = 0;
      var after = reconcile(out);
      return { ok: true, frame: after };
    }

    if (type === 'pause') {
      if (bio.lifeState === 'grave') return fail('invalid', out);
      if (bio.lifeState === 'legacyLiving') return fail('invalid', out);
      if (bio.paused) return fail('duplicate', out);
      bio.paused = true;
      return { ok: true, frame: out };
    }

    if (type === 'resume') {
      if (!bio.paused) return fail('duplicate', out);
      bio.paused = false;
      return { ok: true, frame: out };
    }

    if (type === 'critical-seen') {
      if (!bio.criticalPending) return fail('invalid', out);
      if (bio.paused) return fail('paused', out);
      if (!(a.visible === true) || a.drawer === true) return fail('not-visible', out);
      bio.criticalSeen = true; // no retroactive accrual: timer only runs in advance()
      return { ok: true, frame: out };
    }

    if (type === 'bond') {
      if (!isLiving(bio)) return fail('invalid', out);
      if (bio.paused) return fail('paused', out);
      var bucket = Math.floor(bio.ageMs / (24 * HOUR));
      if (bucket !== bio.bondDayBucket) {
        bio.bondDayBucket = bucket;
        bio.bondDailyCount = 0;
      }
      if (bio.bondDailyCount >= 6) return fail('cap', out);
      if (!((typeof a.benefit === 'number' && a.benefit >= 4) || a.groomed === true)) {
        return fail('no-benefit', out);
      }
      bio.bond = Math.min(100, bio.bond + 1);
      bio.bondDailyCount += 1;
      return { ok: true, frame: out };
    }

    return { ok: false, code: 'unknown', frame: out };
  }

  // Recompute episode/attention state after external care changed needs.
  // No elapsed, no rewards, no medicine effects. Full pause freezes everything:
  // the critical episode is preserved, never cleared, while paused.
  function reconcile(frame) {
    if (!isObj(frame) || !isObj(frame.biology)) return clone(frame);
    var out = clone(frame);
    var bio = out.biology;
    if (bio.paused) return out;
    if (!isLiving(bio)) return out;
    if (!lowPhysio(out.needs)) {
      bio.pressureMs = 0;
      bio.pressureTicks = 0;
    }
    var causes = currentCauses(out);
    if (causes.length === 0) {
      bio.attentionCauses = [];
      bio.attentionActiveMs = 0;
    } else if (bio.attentionCauses.length === 0) {
      bio.attentionCauses = causes;
      bio.attentionActiveMs = 0;
    } else {
      bio.attentionCauses = causes;
    }
    if (!criticalCondition(bio)) {
      bio.criticalPending = false;
      bio.criticalSeen = false;
      bio.criticalActiveMs = 0;
    } else {
      bio.criticalPending = true;
    }
    return out;
  }

  var STAGE_RU = {
    egg: 'Яйцо', baby: 'Малыш', child: 'Ребёнок', teen: 'Подросток',
    adult: 'Взрослая', elder: 'Старшая', grave: 'Звёздочка', legacyLiving: 'Семира'
  };
  var ILLNESS_RU = { fever: 'Температура', stomach: 'Живот', cold: 'Простуда' };

  function describe(frame) {
    if (!isObj(frame) || !isObj(frame.biology)) {
      return { stageLabel: '?', ageLabel: '', warning: 'none', careQuality: 100, happiness: 50, illnessLabel: null, attentionCauses: [], canPlay: false, canCare: false, canHatch: false };
    }
    var bio = clone(frame.biology);
    var needs = frame.needs || { hunger: 80, joy: 75, energy: 85, clean: 85 };
    var q = careQualityOf(bio);
    var joy = typeof needs.joy === 'number' ? needs.joy : 75;
    var happiness = Math.round(0.5 * joy + 0.3 * bio.health + 0.2 * q);
    var warning = 'none';
    if (isLiving(bio)) {
      if (bio.health <= 10 || (bio.illness && bio.illnessAgeMs >= ILLNESS_CRITICAL_AGE)) warning = 'critical';
      else if (bio.health <= 20 || (bio.illness && bio.illnessAgeMs >= ILLNESS_HELP_AGE)) warning = 'help';
      else if (bio.health <= 35 || bio.illness) warning = 'warning';
    }
    var ageLabel;
    if (bio.lifeState === 'egg') {
      var left = Math.max(0, EGG_MS - bio.stageMs);
      ageLabel = bio.eggReady ? 'готово к вылуплению' : ('вылупление через ' + Math.ceil(left / MIN) + ' мин');
    } else if (bio.lifeState === 'legacyLiving' || bio.lifeState === 'grave') {
      ageLabel = '';
    } else {
      ageLabel = 'возраст ' + Math.floor(bio.ageMs / HOUR) + ' ч';
    }
    // legacyLiving stays playable: it is a living pet with old rules.
    var playable = (isLiving(bio) || bio.lifeState === 'legacyLiving') && !bio.paused;
    var sleeping = frame.sleeping === true;
    return {
      stageLabel: STAGE_RU[bio.lifeState] || bio.lifeState,
      ageLabel: ageLabel,
      warning: warning,
      careQuality: q,
      happiness: happiness,
      illnessLabel: bio.illness ? (ILLNESS_RU[bio.illness] || bio.illness) : null,
      attentionCauses: bio.attentionCauses.slice(),
      canPlay: playable && !sleeping,
      canCare: playable && !sleeping,
      canHatch: bio.lifeState === 'egg' && bio.eggReady && !bio.paused
    };
  }

  var api = {
    create: create,
    sanitize: sanitize,
    advance: advance,
    command: command,
    describe: describe,
    reconcile: reconcile
  };
  try { Object.freeze(api); } catch (err) { /* ignore */ }

  if (typeof window !== 'undefined' && window) {
    try { window.TamaBiology = api; } catch (err) { /* ignore */ }
  }
  if (typeof module !== 'undefined' && module && module.exports !== undefined) {
    module.exports = api;
  }
  return api;
})();
