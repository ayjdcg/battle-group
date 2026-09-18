/* global window */
(function (root, factory) {
  const constants = typeof module === 'object' && module.exports
    ? require('./logistics-constants.js')
    : root.LogisticsConstants;
  const core = factory(constants);
  if (typeof module === 'object' && module.exports) {
    module.exports = core;
  }
  root.LogisticsCore = core;
}(typeof window !== 'undefined' ? window : globalThis, function (constants) {
  'use strict';

  const {
    MAP,
    INITIAL_BASE_INVENTORY,
    TOTAL_TRANSPORT_PER_DAY,
    QUOTA_PERIOD_DAYS,
    QUOTA_PER_PERIOD,
    QUOTA_COMPOSITION,
    QUOTA_ADVANCE_MAX_RATIO,
    QUOTA_ADVANCE_INTEREST,
    QUOTA_PREVIEW_LEAD_DAYS,
    MOBILIZATION_INTERVAL_DAYS,
    MOBILIZATION_BATCH_SIZE,
    PERSONNEL_FULL_STRENGTH,
    PERSONNEL_PER_D,
    EVAC_WINDOW_EXTRA_DAYS,
    ROTATION_REST_DAYS,
    TRAINING_DAYS,
    CASUALTY_SPLIT,
    MEDIC_RECOVERY_RATE,
    HOSPITAL_DAILY_QUOTA,
    HOSPITAL_OVERFLOW_DEATH_MULT,
    INTEGRATION_LADDER,
    DIVISION_SAFE_RESERVE_DAYS,
    POSTURE_CONSUMPTION_MULT,
    AMMO_TIER,
    SPIKE_EXTRA_DAYS_EQUIVALENT,
    POSTURE_FATIGUE_CHANGE,
    REFIT_FATIGUE_THRESHOLD,
    OBEDIENCE_FORCED_ATTACK_THRESHOLD,
    AUTONOMOUS_ATTACK_AGGRESSION_THRESHOLD,
    BATTLE_PREVIEW_LEAD_DAYS,
    INFO_DELAY_DAYS,
    GAME_LENGTH_DAYS,
    INITIAL_FRONT_RESERVE_DAYS,
    CRITICAL_FRONT_POSITION,
    BREAKTHROUGH_FRONT_POSITION,
    FAILED_FRONTS_FOR_DEFEAT,
    DIVISION_COLLAPSE_MANPOWER_RATIO,
    CAMPAIGN_BATTLE_SCRIPT,
    ENEMY_EFFECTIVENESS,
    BATTLE_OUTCOME_TABLE,
    DIVISION_PERSONALITY_PRESETS,
  } = constants;

  function createDivision(definition, personality) {
    return {
      id: definition.id,
      name: definition.name,
      personality: { ...personality },
      posture: 'defend',
      manpowerRatio: 1,
      ammoDays: INITIAL_FRONT_RESERVE_DAYS.ammo,
      supplyDays: INITIAL_FRONT_RESERVE_DAYS.supply,
      fatigue: 0,
      equipmentReady: 1,
      integrationEffPenalty: 1,
      underAttack: false,
      frontMovement: 0,
      frontPosition: 0,
      casualtiesTotal: 0,
      battles: [],
      collapsed: false,
      lowAmmoDays: 0,
      quietDays: 0,
      lastReportDay: 0,
      lastReportSnapshot: null,
      reportHistory: [],
      perceivedSelf: null,
      evacQueue: [],
    };
  }

  function createInitialState() {
    const baseAmmo = INITIAL_BASE_INVENTORY * QUOTA_COMPOSITION.ammo;
    const baseSupply = INITIAL_BASE_INVENTORY * QUOTA_COMPOSITION.supply;

    const state = {
      day: 0,
      ended: false,
      base: { ammo: baseAmmo, supply: baseSupply },
      quota: {
        periodDays: QUOTA_PERIOD_DAYS,
        nextArrivalDay: QUOTA_PERIOD_DAYS,
        nextAmount: null,
        pendingAdvanceDebt: 0,
      },
      personnel: {
        pool: 0,
        recoveredVeterans: 0,
        permanentLosses: 0,
        mobilization: { intervalDays: MOBILIZATION_INTERVAL_DAYS, nextArrivalDay: MOBILIZATION_INTERVAL_DAYS, nextAmount: MOBILIZATION_BATCH_SIZE },
        trainingQueue: [],
        hospitalQueue: [],
        integrationQueue: [],
      },
      transitQueue: [],
      divisions: [
        createDivision(MAP.divisions[0], DIVISION_PERSONALITY_PRESETS.aggressive),
        createDivision(MAP.divisions[1], DIVISION_PERSONALITY_PRESETS.hoarder),
        createDivision(MAP.divisions[2], DIVISION_PERSONALITY_PRESETS.obedient),
      ],
      orders: {
        lineRatios: {
          'line-rail': { ammo: 0.6, supply: 0.3, personnel: 0.1 },
          'line-road-1': { ammo: 0.6, supply: 0.3, personnel: 0.1 },
          'line-road-2': { ammo: 0.6, supply: 0.3, personnel: 0.1 },
        },
        divisionPriority: { 'div-1': 1, 'div-2': 1, 'div-3': 1 },
        minReserveDays: { 'div-1': 3, 'div-2': 3, 'div-3': 3 },
        trainingTrack: 'normal',
        personnelAssignment: {},
        returnPriority: { wounded: 1, rotation: 0 },
        rotationOrder: { 'div-1': 0, 'div-2': 0, 'div-3': 0 },
        cancelRotation: { 'div-1': 0, 'div-2': 0, 'div-3': 0 },
        briefTruth: {},
        dailyShipmentCap: Infinity,
        advanceQuota: 0,
      },
      battlePreview: [],
      eventLog: [],
      frontRequests: [],
      campaign: {
        status: 'ongoing',
        result: null,
        reason: null,
        endedDay: null,
      },
    };
    refreshInfoSnapshot(state);
    return state;
  }

  function reportSnapshotFor(division, day) {
    return {
      day,
      posture: division.posture,
      manpowerRatio: division.manpowerRatio,
      ammoDays: division.ammoDays,
      supplyDays: division.supplyDays,
      fatigue: division.fatigue,
      equipmentReady: division.equipmentReady,
      integrationEffPenalty: division.integrationEffPenalty,
      underAttack: division.underAttack,
      frontMovement: division.frontMovement,
      frontPosition: division.frontPosition,
      casualtiesTotal: division.casualtiesTotal,
      collapsed: division.collapsed,
      lowAmmoDays: division.lowAmmoDays,
      evacWounded: evacCount(division, 'wounded'),
      evacRotation: evacCount(division, 'rotation'),
    };
  }

  function refreshInfoSnapshot(state) {
    for (const division of state.divisions) {
      division.reportHistory.push(reportSnapshotFor(division, state.day));
      const delay = division.underAttack ? INFO_DELAY_DAYS.inCombat : INFO_DELAY_DAYS.normal;
      const visibleDay = Math.max(0, state.day - delay);
      const visibleSnapshot = division.reportHistory.find((snapshot) => snapshot.day === visibleDay)
        || division.reportHistory[0];
      division.lastReportSnapshot = { ...visibleSnapshot };
      division.lastReportDay = division.lastReportSnapshot.day;
    }

    const isPreviewVisible = state.day + QUOTA_PREVIEW_LEAD_DAYS >= state.quota.nextArrivalDay;
    state.quota.nextAmount = isPreviewVisible
      ? Math.max(0, QUOTA_PER_PERIOD - state.quota.pendingAdvanceDebt * QUOTA_ADVANCE_INTEREST)
      : null;
  }

  function getLineById(lineId) {
    const line = MAP.lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      throw new Error(`Unknown logistics line: ${lineId}`);
    }
    return line;
  }

  function getDivisionById(state, divisionId) {
    const division = state.divisions.find((candidate) => candidate.id === divisionId);
    if (!division) {
      throw new Error(`Unknown division: ${divisionId}`);
    }
    return division;
  }

  function cargoTotal(cargo) {
    return (cargo.ammo || 0) + (cargo.supply || 0) + (cargo.personnel || 0);
  }

  function evacCount(division, kind) {
    return (division.evacQueue || []).reduce((sum, batch) => (
      batch.kind === kind ? sum + batch.count : sum
    ), 0);
  }

  function personnelPointsToD(points) {
    return points / PERSONNEL_PER_D;
  }

  function personnelDToPoints(amount) {
    return amount * PERSONNEL_PER_D;
  }

  function lineOutboundToday(state, lineId) {
    return state.transitQueue.reduce((sum, shipment) => (
      shipment.lineId === lineId && shipment.leg !== 'return' && shipment.dispatchedDay === state.day
        ? sum + (shipment.fleetSize || cargoTotal(shipment.cargo))
        : sum
    ), 0);
  }

  function occupiedFleet(state) {
    return state.transitQueue.reduce((sum, shipment) => (
      sum + (shipment.fleetSize || cargoTotal(shipment.cargo))
    ), 0);
  }

  function availableTransport(state) {
    return Math.max(0, TOTAL_TRANSPORT_PER_DAY - occupiedFleet(state));
  }

  function lineForDivision(divisionId) {
    return MAP.lines.find((line) => line.divisionId === divisionId);
  }

  function evacWindowDays(divisionId) {
    const line = lineForDivision(divisionId);
    return (line ? line.transitDays : 1) + EVAC_WINDOW_EXTRA_DAYS;
  }

  function returnKindOrder(state) {
    const priority = state.orders.returnPriority || { wounded: 1, rotation: 0 };
    return (priority.wounded || 0) >= (priority.rotation || 0)
      ? ['wounded', 'rotation']
      : ['rotation', 'wounded'];
  }

  function takeFromEvacQueue(division, kind, maxPoints) {
    if (maxPoints <= 0) {
      return 0;
    }
    let taken = 0;
    const remaining = [];
    for (const batch of division.evacQueue || []) {
      if (batch.kind !== kind || taken >= maxPoints) {
        remaining.push(batch);
        continue;
      }
      const take = Math.min(batch.count, maxPoints - taken);
      taken += take;
      if (batch.count > take) {
        remaining.push({ ...batch, count: batch.count - take });
      }
    }
    division.evacQueue = remaining;
    return taken;
  }

  function previewReturnLoad(state, division, fleetSize) {
    const remaining = { wounded: evacCount(division, 'wounded'), rotation: evacCount(division, 'rotation') };
    const loaded = { wounded: 0, rotation: 0 };
    let capacity = personnelDToPoints(fleetSize);
    for (const kind of returnKindOrder(state)) {
      const take = Math.min(remaining[kind], capacity);
      loaded[kind] = take;
      remaining[kind] -= take;
      capacity -= take;
    }
    return loaded;
  }

  function loadReturnCargo(state, division, fleetSize) {
    const loaded = { wounded: 0, rotation: 0 };
    let capacity = personnelDToPoints(fleetSize);
    for (const kind of returnKindOrder(state)) {
      const take = takeFromEvacQueue(division, kind, capacity);
      loaded[kind] = take;
      capacity -= take;
      if (kind === 'rotation' && take > 0) {
        division.manpowerRatio = clamp(
          division.manpowerRatio - take / PERSONNEL_FULL_STRENGTH,
          0,
          1,
        );
      }
    }
    return loaded;
  }

  function enqueueEvac(division, kind, count, day) {
    if (count > 0) {
      division.evacQueue.push({
        id: `evac-${kind}-${day}-${division.evacQueue.length + 1}`,
        count,
        kind,
        sinceDay: day,
      });
    }
  }

  function applyRotationOrders(state) {
    for (const division of state.divisions) {
      const cancel = Math.max(0, (state.orders.cancelRotation || {})[division.id] || 0);
      if (cancel > 0) {
        takeFromEvacQueue(division, 'rotation', cancel);
      }
      const requested = Math.max(0, state.orders.rotationOrder[division.id] || 0);
      if (requested > 0) {
        const current = evacCount(division, 'rotation');
        const fightingPoints = division.manpowerRatio * PERSONNEL_FULL_STRENGTH - current;
        enqueueEvac(division, 'rotation', Math.min(requested, Math.max(0, fightingPoints)), state.day);
      }
      state.orders.rotationOrder[division.id] = 0;
      if (!state.orders.cancelRotation) {
        state.orders.cancelRotation = {};
      }
      state.orders.cancelRotation[division.id] = 0;
    }
  }

  function expireEvacQueues(state) {
    for (const division of state.divisions) {
      const windowDays = evacWindowDays(division.id);
      const remaining = [];
      for (const batch of division.evacQueue) {
        if (batch.kind === 'wounded' && state.day - batch.sinceDay > windowDays) {
          state.personnel.permanentLosses += batch.count;
          state.eventLog.push({
            day: state.day,
            type: 'evac-expired',
            divisionId: division.id,
            count: batch.count,
            text: `${division.name}待后送伤员 ${batch.count.toFixed(1)} 点超过时间窗，彻底损失。`,
          });
        } else {
          remaining.push(batch);
        }
      }
      division.evacQueue = remaining;
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function ammoTierOf(division) {
    const reserveRatio = clamp(division.ammoDays / DIVISION_SAFE_RESERVE_DAYS, 0, Infinity);
    return AMMO_TIER.find((tier) => reserveRatio >= tier.min);
  }

  function computeEffectiveness(division) {
    return clamp(
      division.manpowerRatio
        * ammoTierOf(division).combatMult
        * division.equipmentReady
        * (1 - division.fatigue)
        * (division.integrationEffPenalty || 1),
      0,
      1,
    );
  }

  function dailyConsumptionOf(division) {
    const consumption = POSTURE_CONSUMPTION_MULT[division.posture];
    if (!consumption) {
      throw new Error(`Unknown division posture: ${division.posture}`);
    }
    return consumption;
  }

  function perceive(state, division) {
    const bias = state.orders.briefTruth[division.id]
      ? 0
      : (1 - division.personality.selfAwareness) * 0.3;
    division.perceivedSelf = {
      manpowerRatio: clamp(division.manpowerRatio * (1 + bias), 0, 1),
      ammoDays: Math.max(0, division.ammoDays * (1 + bias)),
      supplyDays: Math.max(0, division.supplyDays * (1 + bias)),
      fatigue: clamp(division.fatigue * (1 - bias), 0, 1),
      equipmentReady: clamp(division.equipmentReady * (1 + bias), 0, 1),
    };
    return division.perceivedSelf;
  }

  function attackReserveThreshold(division) {
    // Aggressive commanders will act with about 3 days of ammo; cautious ones
    // wait for roughly 8. The exact mapping is an M4 calibration starting point.
    return 2 + (1 - division.personality.aggression) * 6;
  }

  function hasAttackOrder(state, division) {
    return state.battlePreview.some((preview) => (
      preview.divisionId === division.id
      && preview.day === state.day
      && preview.source === 'orders-known'
    ));
  }

  function decidePosture(state, division) {
    const perceived = division.perceivedSelf || perceive(state, division);
    const attackOrdered = hasAttackOrder(state, division);
    const reserveThreshold = attackReserveThreshold(division);

    if (perceived.ammoDays < 2 && !division.underAttack) {
      return 'dormant';
    }
    if (perceived.ammoDays < 1 && division.underAttack) {
      return 'retreat';
    }
    if (perceived.fatigue > REFIT_FATIGUE_THRESHOLD) {
      return 'refit';
    }
    if (attackOrdered && perceived.ammoDays >= reserveThreshold) {
      return 'attack';
    }
    if (attackOrdered) {
      return division.personality.obedience >= OBEDIENCE_FORCED_ATTACK_THRESHOLD
        ? 'attack'
        : division.posture;
    }
    if (
      division.personality.aggression >= AUTONOMOUS_ATTACK_AGGRESSION_THRESHOLD
      && division.quietDays >= 2
      && perceived.ammoDays >= reserveThreshold * 1.5
    ) {
      return 'attack';
    }
    return 'defend';
  }

  function consumeAndApplyPosture(state, division) {
    const consumption = dailyConsumptionOf(division);
    const ammoTier = ammoTierOf(division);
    const spike = division.underAttack ? SPIKE_EXTRA_DAYS_EQUIVALENT : 0;
    const ammoConsumed = consumption.ammo * ammoTier.combatMult + spike;
    const supplyConsumed = consumption.supply + spike;

    division.ammoDays = Math.max(0, division.ammoDays - ammoConsumed / DIVISION_SAFE_RESERVE_DAYS);
    division.supplyDays = Math.max(0, division.supplyDays - supplyConsumed / DIVISION_SAFE_RESERVE_DAYS);
    division.fatigue = clamp(
      division.fatigue + POSTURE_FATIGUE_CHANGE[division.posture],
      0,
      1,
    );
    division.lowAmmoDays = ammoTierOf(division).collapseAfterDays
      ? division.lowAmmoDays + 1
      : 0;
    if (division.lowAmmoDays >= 3) {
      division.collapsed = true;
    }

    return { ammo: ammoConsumed, supply: supplyConsumed, spike: division.underAttack };
  }

  function scheduleBattle(state, divisionId, source = 'enemy-signal', certainty = 1, details = {}) {
    getDivisionById(state, divisionId);
    const preview = {
      divisionId,
      day: state.day + BATTLE_PREVIEW_LEAD_DAYS,
      source,
      certainty,
      ...details,
    };
    state.battlePreview.push(preview);
    return preview;
  }

  function announceCampaignPressure(state) {
    for (const scripted of CAMPAIGN_BATTLE_SCRIPT) {
      if (scripted.announcedDay !== state.day) {
        continue;
      }
      const division = getDivisionById(state, scripted.divisionId);
      scheduleBattle(state, scripted.divisionId, 'campaign-script', 1, {
        id: scripted.id,
        day: scripted.day,
        announcedDay: scripted.announcedDay,
        requestedAmmo: scripted.requestedAmmo,
      });
      state.frontRequests.push({
        id: scripted.id,
        divisionId: scripted.divisionId,
        announcedDay: scripted.announcedDay,
        battleDay: scripted.day,
        requestedAmmo: scripted.requestedAmmo,
        deliveredAmmo: 0,
        shipmentIds: [],
      });
      state.eventLog.push({
        day: state.day,
        type: 'front-request',
        divisionId: division.id,
        text: `${division.name}预告 D${scripted.day}将遭遇强攻，战前公开申请弹药 ${scripted.requestedAmmo.toFixed(1)} D。`,
      });
    }
  }

  function activateScheduledBattles(state) {
    for (const division of state.divisions) {
      division.underAttack = state.battlePreview.some((preview) => (
        preview.divisionId === division.id && preview.day === state.day
      ));
    }
  }

  function battleOutcomeFor(effectiveness) {
    const ratio = effectiveness / ENEMY_EFFECTIVENESS;
    const outcome = BATTLE_OUTCOME_TABLE.find((candidate) => ratio >= candidate.minRatio);
    return { ...outcome, ratio };
  }

  function resolveBattles(state) {
    const results = [];
    for (const division of state.divisions) {
      if (!division.underAttack) {
        continue;
      }
      const effectiveness = computeEffectiveness(division);
      const outcome = battleOutcomeFor(effectiveness);
      const before = {
        frontPosition: division.frontPosition,
        manpowerRatio: division.manpowerRatio,
        equipmentReady: division.equipmentReady,
        ammoDays: division.ammoDays,
      };
      const casualties = division.manpowerRatio * PERSONNEL_FULL_STRENGTH * outcome.casualtyRate;
      const kia = casualties * CASUALTY_SPLIT.kia;
      const wounded = casualties * CASUALTY_SPLIT.wounded;
      division.manpowerRatio = clamp(
        division.manpowerRatio - casualties / PERSONNEL_FULL_STRENGTH,
        0,
        1,
      );
      division.frontMovement = outcome.frontMovement;
      division.frontPosition += outcome.frontMovement;
      division.casualtiesTotal += casualties;
      division.equipmentReady = clamp(division.equipmentReady - outcome.equipmentLossRate, 0, 1);
      state.personnel.permanentLosses += kia;
      enqueueEvac(division, 'wounded', wounded, state.day);
      const preview = state.battlePreview.find((candidate) => (
        candidate.divisionId === division.id && candidate.day === state.day
      ));
      const request = preview?.id
        ? state.frontRequests.find((candidate) => candidate.id === preview.id)
        : null;
      const after = {
        frontPosition: division.frontPosition,
        manpowerRatio: division.manpowerRatio,
        equipmentReady: division.equipmentReady,
        ammoDays: division.ammoDays,
      };
      const result = { divisionId: division.id, effectiveness, outcome, casualties, kia, wounded, request, before, after };
      division.battles.push({ day: state.day, ...result });
      results.push(result);
    }
    return results;
  }

  function generateDailyReport(state, battleResults) {
    for (const result of battleResults) {
      const division = getDivisionById(state, result.divisionId);
      const exhausted = division.ammoDays <= 0;
      const movement = result.outcome.frontMovement >= 0
        ? `战线前进 ${result.outcome.frontMovement} 公里`
        : `战线后退 ${Math.abs(result.outcome.frontMovement)} 公里`;
      state.eventLog.push({
        day: state.day,
        type: 'battle-report',
        divisionId: division.id,
        text: `${division.name}于交战日遭遇敌军，${exhausted ? '弹药于交战第 1 日耗尽；' : ''}${result.outcome.label}，${movement}，累计战线 ${division.frontPosition >= 0 ? '+' : ''}${division.frontPosition} 公里，伤亡 ${result.casualties.toFixed(1)} 点，装备完好率降至 ${Math.round(division.equipmentReady * 100)}%。`,
        result,
      });
      if (result.request) {
        const shortfall = Math.max(0, result.request.requestedAmmo - result.request.deliveredAmmo);
        const contextText = shortfall > 1e-6
          ? `${division.name}战前公开申请弹药 ${result.request.requestedAmmo.toFixed(1)} D，请求窗口内实际到达 ${result.request.deliveredAmmo.toFixed(1)} D，差额 ${shortfall.toFixed(1)} D。战报仅记录请求满足情况，不判定调度对错。`
          : `${division.name}战前公开申请弹药 ${result.request.requestedAmmo.toFixed(1)} D，请求窗口内实际到达 ${result.request.deliveredAmmo.toFixed(1)} D，请求已满足。`;
        state.eventLog.push({
          day: state.day,
          type: 'request-context',
          divisionId: division.id,
          text: contextText,
          result: result.request,
        });
      }
    }
  }

  function addQuotaToBase(state, amount) {
    state.base.ammo += amount * QUOTA_COMPOSITION.ammo;
    state.base.supply += amount * QUOTA_COMPOSITION.supply;
  }

  function settleQuota(state) {
    if (state.day === state.quota.nextArrivalDay) {
      const arrival = Math.max(
        0,
        QUOTA_PER_PERIOD - state.quota.pendingAdvanceDebt * QUOTA_ADVANCE_INTEREST,
      );
      addQuotaToBase(state, arrival);
      state.quota.pendingAdvanceDebt = 0;
      state.quota.nextArrivalDay += QUOTA_PERIOD_DAYS;
      state.quota.nextAmount = null;
    }

    const advance = state.orders.advanceQuota;
    if (advance <= 0) {
      return;
    }

    const availableAdvance = QUOTA_PER_PERIOD * QUOTA_ADVANCE_MAX_RATIO
      - state.quota.pendingAdvanceDebt;
    if (advance <= availableAdvance) {
      addQuotaToBase(state, advance);
      state.quota.pendingAdvanceDebt += advance;
    } else {
      state.eventLog.push({
        day: state.day,
        type: 'quota-advance-rejected',
        requested: advance,
        available: Math.max(0, availableAdvance),
      });
    }
    state.orders.advanceQuota = 0;
  }

  function enqueueTraining(state, count, track = state.orders.trainingTrack) {
    if (!Object.prototype.hasOwnProperty.call(TRAINING_DAYS, track)) {
      throw new Error(`Unknown training track: ${track}`);
    }
    if (count > 0) {
      state.personnel.trainingQueue.push({
        id: `training-${state.day}-${state.personnel.trainingQueue.length + 1}`,
        count,
        track,
        arrivesDay: state.day + TRAINING_DAYS[track],
      });
    }
  }

  function settleMobilization(state) {
    if (state.day === state.personnel.mobilization.nextArrivalDay) {
      const count = state.personnel.mobilization.nextAmount;
      enqueueTraining(state, count);
      state.eventLog.push({ day: state.day, type: 'mobilization-arrived', count });
      state.personnel.mobilization.nextArrivalDay += MOBILIZATION_INTERVAL_DAYS;
    }
  }

  function sendWoundedToHospital(state, count, arrivesDay = state.day) {
    if (count > 0) {
      state.personnel.hospitalQueue.push({
        id: `hospital-${state.day}-${state.personnel.hospitalQueue.length + 1}`,
        count,
        arrivesDay,
        overflowDays: 0,
      });
    }
  }

  function integrationRuleFor(division) {
    return INTEGRATION_LADDER.find((rule) => division.manpowerRatio >= rule.min);
  }

  function assignPersonnel(state) {
    // Standing assignment only caps who boards outbound trucks.
    // People leave the pool in dispatchShipments, not here.
    return state.orders.personnelAssignment;
  }

  function lineCapacityPerDay(line) {
    const totalRawThroughput = MAP.lines.reduce(
      (sum, candidate) => sum + candidate.throughputPerDay,
      0,
    );
    return TOTAL_TRANSPORT_PER_DAY * line.throughputPerDay / totalRawThroughput;
  }

  // M1 temporary dispatch interface. Later milestones will derive these batches
  // from player orders, inventory and division priorities.
  function dispatchShipments(state, shipmentOrders) {
    const usedCapacity = new Map();
    let fleetUsed = occupiedFleet(state);

    for (const shipment of shipmentOrders) {
      const line = getLineById(shipment.lineId);
      if (!usedCapacity.has(line.id)) {
        usedCapacity.set(line.id, lineOutboundToday(state, line.id));
      }
      const cargo = {
        ammo: shipment.cargo.ammo || 0,
        supply: shipment.cargo.supply || 0,
        personnel: shipment.cargo.personnel || 0,
        wounded: 0,
        rotation: 0,
      };
      const fleetSize = shipment.fleetSize || cargoTotal(cargo);
      const capacityUsed = (usedCapacity.get(line.id) || 0) + fleetSize;

      if (fleetSize <= 0) {
        throw new Error(`Shipment on ${line.id} must occupy a positive fleet`);
      }
      if (capacityUsed > lineCapacityPerDay(line) + Number.EPSILON * 8) {
        throw new Error(`Shipment on ${line.id} exceeds its daily capacity`);
      }
      if (fleetUsed + fleetSize > TOTAL_TRANSPORT_PER_DAY + Number.EPSILON * 8) {
        throw new Error(`Shipment on ${line.id} exceeds dispatchable fleet`);
      }
      if (cargo.ammo > state.base.ammo + Number.EPSILON * 8
        || cargo.supply > state.base.supply + Number.EPSILON * 8) {
        throw new Error(`Shipment on ${line.id} exceeds available base inventory`);
      }
      const personnelPoints = personnelDToPoints(cargo.personnel);
      if (personnelPoints > state.personnel.pool + Number.EPSILON * 8) {
        throw new Error(`Shipment on ${line.id} exceeds available personnel pool`);
      }

      usedCapacity.set(line.id, capacityUsed);
      fleetUsed += fleetSize;
      state.base.ammo -= cargo.ammo;
      state.base.supply -= cargo.supply;
      state.personnel.pool = Math.max(0, state.personnel.pool - personnelPoints);
      state.transitQueue.push({
        id: `shipment-${state.day}-${state.transitQueue.length + 1}`,
        lineId: line.id,
        divisionId: line.divisionId,
        leg: 'outbound',
        fleetSize,
        cargo,
        dispatchedDay: state.day,
        arrivesDay: state.day + line.transitDays,
      });
    }
  }

  // Pure preview of the batches that the standing orders would dispatch today.
  // The UI uses this exact function so "today's plan" cannot drift from settlement.
  function planConfiguredShipments(state) {
    const priorityOf = (division) => {
      const basePriority = Math.max(0, state.orders.divisionPriority[division.id] || 0);
      const reserve = Math.max(0, state.orders.minReserveDays[division.id] || 0);
      const shortfall = Math.max(0, reserve - division.ammoDays);
      return basePriority * (1 + shortfall / Math.max(1, reserve));
    };
    const totalPriority = state.divisions.reduce(
      (sum, division) => sum + priorityOf(division),
      0,
    );
    const dailyCap = Math.max(0, Math.min(availableTransport(state), state.orders.dailyShipmentCap));
    if (totalPriority <= 0 || dailyCap <= 0) {
      return [];
    }

    const shipments = [];
    let availableAmmo = state.base.ammo;
    let availableSupply = state.base.supply;
    let availablePersonnelPoints = state.personnel.pool;
    let remainingFleet = dailyCap;
    for (const line of MAP.lines) {
      const division = getDivisionById(state, line.divisionId);
      const priority = priorityOf(division);
      const allocation = Math.min(
        Math.max(0, lineCapacityPerDay(line) - lineOutboundToday(state, line.id)),
        dailyCap * priority / totalPriority,
        remainingFleet,
      );
      const ratio = state.orders.lineRatios[line.id] || {};
      const ammoRatio = Math.max(0, ratio.ammo || 0);
      const supplyRatio = Math.max(0, ratio.supply || 0);
      const personnelRatio = Math.max(0, ratio.personnel || 0);
      const ratioSum = ammoRatio + supplyRatio + personnelRatio;
      if (allocation <= 0 || ratioSum <= 0) {
        continue;
      }
      const desiredAmmo = allocation * ammoRatio / ratioSum;
      const desiredSupply = allocation * supplyRatio / ratioSum;
      const desiredPersonnelD = allocation * personnelRatio / ratioSum;
      const materialScale = Math.min(
        1,
        desiredAmmo > 0 ? availableAmmo / desiredAmmo : 1,
        desiredSupply > 0 ? availableSupply / desiredSupply : 1,
      );
      const assigned = state.orders.personnelAssignment[division.id];
      const assignmentCapPoints = assigned === undefined ? Infinity : Math.max(0, assigned);
      const personnelD = Math.min(
        desiredPersonnelD,
        personnelPointsToD(availablePersonnelPoints),
        personnelPointsToD(assignmentCapPoints),
      );
      const cargo = {
        ammo: desiredAmmo * materialScale,
        supply: desiredSupply * materialScale,
        personnel: personnelD,
        wounded: 0,
        rotation: 0,
      };
      const expectedReturn = previewReturnLoad(state, division, allocation);
      shipments.push({
        lineId: line.id,
        fleetSize: allocation,
        cargo,
        expectedReturn,
        outboundArrivesDay: state.day + line.transitDays,
        fleetReturnsDay: state.day + line.transitDays * 2,
      });
      remainingFleet -= allocation;
      availableAmmo -= cargo.ammo;
      availableSupply -= cargo.supply;
      availablePersonnelPoints -= personnelDToPoints(personnelD);
    }
    return shipments;
  }

  // Converts the player's standing distribution rules into today's shipments.
  // Lines are still dispatched as a batch: the player never selects a convoy.
  function dispatchConfiguredShipments(state) {
    const shipments = planConfiguredShipments(state);
    if (shipments.length > 0) {
      dispatchShipments(state, shipments);
      state.eventLog.push({ day: state.day, type: 'dispatch', count: shipments.length });
    }
    return shipments;
  }

  function enqueueRestingRotation(state, count) {
    if (count > 0) {
      state.personnel.trainingQueue.push({
        id: `rest-${state.day}-${state.personnel.trainingQueue.length + 1}`,
        count,
        track: 'rest',
        recoveredVeteran: true,
        arrivesDay: state.day + ROTATION_REST_DAYS,
      });
    }
  }

  function unloadOutbound(state, shipment) {
    const division = getDivisionById(state, shipment.divisionId);
    const dailyConsumption = dailyConsumptionOf(division);
    division.ammoDays += shipment.cargo.ammo / dailyConsumption.ammo;
    division.supplyDays += shipment.cargo.supply / dailyConsumption.supply;
    const replacementPoints = personnelDToPoints(shipment.cargo.personnel || 0);
    if (replacementPoints > 0) {
      const rule = integrationRuleFor(division);
      state.personnel.integrationQueue.push({
        id: `integration-${state.day}-${state.personnel.integrationQueue.length + 1}`,
        divisionId: division.id,
        count: replacementPoints,
        arrivesDay: state.day + Math.ceil(rule.delayDays),
        effPenalty: rule.effPenalty,
      });
    }
    for (const request of state.frontRequests) {
      if (
        request.divisionId === division.id
        && state.day >= request.announcedDay
        && state.day <= request.battleDay
      ) {
        request.deliveredAmmo += shipment.cargo.ammo;
        request.shipmentIds.push(shipment.id);
      }
    }
    const line = getLineById(shipment.lineId);
    const loaded = loadReturnCargo(state, division, shipment.fleetSize || cargoTotal(shipment.cargo));
    return {
      id: `return-${shipment.id}`,
      lineId: shipment.lineId,
      divisionId: shipment.divisionId,
      leg: 'return',
      fleetSize: shipment.fleetSize || cargoTotal(shipment.cargo),
      cargo: {
        ammo: 0,
        supply: 0,
        personnel: 0,
        wounded: loaded.wounded,
        rotation: loaded.rotation,
      },
      dispatchedDay: state.day,
      arrivesDay: state.day + line.transitDays,
      outboundId: shipment.id,
    };
  }

  function unloadReturn(state, shipment) {
    sendWoundedToHospital(state, shipment.cargo.wounded || 0, state.day);
    enqueueRestingRotation(state, shipment.cargo.rotation || 0);
  }

  function advanceQueues(state) {
    const remainingShipments = [];
    const newReturns = [];

    for (const shipment of state.transitQueue) {
      if (shipment.arrivesDay !== state.day) {
        remainingShipments.push(shipment);
        continue;
      }
      if (shipment.leg === 'return') {
        unloadReturn(state, shipment);
        continue;
      }
      newReturns.push(unloadOutbound(state, shipment));
    }

    state.transitQueue = remainingShipments.concat(newReturns);

    const remainingTraining = [];
    for (const batch of state.personnel.trainingQueue) {
      if (batch.arrivesDay > state.day) {
        remainingTraining.push(batch);
      } else {
        state.personnel.pool += batch.count;
        if (batch.recoveredVeteran && batch.track !== 'rest') {
          state.personnel.recoveredVeterans += batch.count;
        }
        state.eventLog.push({
          day: state.day,
          type: 'training-complete',
          count: batch.count,
          track: batch.track,
        });
      }
    }
    state.personnel.trainingQueue = remainingTraining;

    let hospitalCapacity = HOSPITAL_DAILY_QUOTA;
    const remainingHospital = [];
    for (const batch of state.personnel.hospitalQueue) {
      if (batch.arrivesDay > state.day) {
        remainingHospital.push(batch);
        continue;
      }
      const processed = Math.min(batch.count, hospitalCapacity);
      if (processed > 0) {
        const mortality = Math.min(1, (1 - MEDIC_RECOVERY_RATE) * (
          batch.overflowDays > 0 ? HOSPITAL_OVERFLOW_DEATH_MULT : 1
        ));
        const recovered = processed * (1 - mortality);
        state.personnel.pool += recovered;
        state.personnel.recoveredVeterans += recovered;
        state.personnel.permanentLosses += processed - recovered;
        hospitalCapacity -= processed;
      }
      if (batch.count > processed) {
        remainingHospital.push({
          ...batch,
          count: batch.count - processed,
          arrivesDay: state.day + 1,
          overflowDays: batch.overflowDays + 1,
        });
      }
    }
    state.personnel.hospitalQueue = remainingHospital;

    const remainingIntegration = [];
    for (const batch of state.personnel.integrationQueue) {
      if (batch.arrivesDay > state.day) {
        remainingIntegration.push(batch);
      } else {
        const division = getDivisionById(state, batch.divisionId);
        division.manpowerRatio = clamp(division.manpowerRatio + batch.count / PERSONNEL_FULL_STRENGTH, 0, 1);
        division.integrationEffPenalty = batch.effPenalty;
      }
    }
    state.personnel.integrationQueue = remainingIntegration;
    expireEvacQueues(state);
  }

  function finishCampaign(state, code, label, reason) {
    state.ended = true;
    state.campaign.status = code === 'defeat' ? 'defeat' : 'completed';
    state.campaign.result = { code, label };
    state.campaign.reason = reason;
    state.campaign.endedDay = state.day;
    state.eventLog.push({
      day: state.day,
      type: 'campaign-end',
      text: `战役结算：${label}。${reason}`,
    });
  }

  function evaluateCampaign(state) {
    if (state.ended) {
      return state.campaign.result;
    }
    const collapsed = state.divisions.find((division) => (
      division.collapsed || division.manpowerRatio <= DIVISION_COLLAPSE_MANPOWER_RATIO
    ));
    if (collapsed) {
      collapsed.collapsed = true;
      finishCampaign(state, 'defeat', '战役失败', `${collapsed.name}失去建制，战区无法继续组织防御。`);
      return state.campaign.result;
    }
    const failedFronts = state.divisions.filter((division) => (
      division.frontPosition <= CRITICAL_FRONT_POSITION
    ));
    const breakthrough = state.divisions.find((division) => (
      division.frontPosition <= BREAKTHROUGH_FRONT_POSITION
    ));
    if (breakthrough) {
      finishCampaign(state, 'defeat', '战役失败', `${breakthrough.name}防区被突破，战线累计后退 ${Math.abs(breakthrough.frontPosition)} 公里。`);
      return state.campaign.result;
    }
    if (failedFronts.length >= FAILED_FRONTS_FOR_DEFEAT) {
      finishCampaign(
        state,
        'defeat',
        '战役失败',
        `${failedFronts.map((division) => division.name).join('、')}退至关键防线之后。`,
      );
      return state.campaign.result;
    }
    if (state.day < GAME_LENGTH_DAYS) {
      return null;
    }
    const costly = state.divisions.some((division) => division.frontPosition <= -8)
      || state.personnel.permanentLosses >= 40;
    if (costly) {
      finishCampaign(state, 'costly-victory', '惨胜', '指定防区仍在我方控制，但阵地和人员损失过高。');
    } else {
      finishCampaign(state, 'victory', '胜利', '三个师均保持建制，且未有两条战线丢失关键防区。');
    }
    return state.campaign.result;
  }

  // M3 adds local consumption after all arrivals have been received for the day.
  function advanceDay(state, { dispatchConfigured = true, campaignScript = true } = {}) {
    if (state.ended) {
      return;
    }
    state.day += 1;
    settleQuota(state);
    settleMobilization(state);
    applyRotationOrders(state);
    advanceQueues(state);
    if (campaignScript) {
      announceCampaignPressure(state);
    }
    activateScheduledBattles(state);
    for (const division of state.divisions) {
      perceive(state, division);
      division.posture = decidePosture(state, division);
      consumeAndApplyPosture(state, division);
      division.quietDays = division.underAttack ? 0 : division.quietDays + 1;
    }
    const battleResults = resolveBattles(state);
    if (dispatchConfigured) {
      dispatchConfiguredShipments(state);
    }
    generateDailyReport(state, battleResults);
    evaluateCampaign(state);
    refreshInfoSnapshot(state);
  }

  return {
    createInitialState,
    dispatchShipments,
    planConfiguredShipments,
    dispatchConfiguredShipments,
    settleQuota,
    settleMobilization,
    advanceQueues,
    advanceDay,
    lineCapacityPerDay,
    occupiedFleet,
    availableTransport,
    previewReturnLoad,
    applyRotationOrders,
    ammoTierOf,
    computeEffectiveness,
    dailyConsumptionOf,
    consumeAndApplyPosture,
    perceive,
    decidePosture,
    attackReserveThreshold,
    enqueueTraining,
    sendWoundedToHospital,
    assignPersonnel,
    integrationRuleFor,
    scheduleBattle,
    announceCampaignPressure,
    activateScheduledBattles,
    battleOutcomeFor,
    resolveBattles,
    generateDailyReport,
    evaluateCampaign,
    refreshInfoSnapshot,
  };
}));
