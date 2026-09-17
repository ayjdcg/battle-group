/* global window */
(function (root, factory) {
  const constants = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = constants;
  }
  root.LogisticsConstants = constants;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MAP = {
    base: { id: 'base', name: '后方基地' },
    transitNodes: [
      { id: 'transit-a', name: '中转站甲' },
      { id: 'transit-b', name: '中转站乙' },
    ],
    divisions: [
      { id: 'div-1', name: '第一师', frontNodeId: 'front-1' },
      { id: 'div-2', name: '第二师', frontNodeId: 'front-2' },
      { id: 'div-3', name: '第三师', frontNodeId: 'front-3' },
    ],
    lines: [
      { id: 'line-rail', type: 'rail', divisionId: 'div-1', via: 'transit-a', throughputPerDay: 100, transitDays: 1, fragility: 'high' },
      { id: 'line-road-1', type: 'road', divisionId: 'div-2', via: 'transit-a', throughputPerDay: 40, transitDays: 2, fragility: 'low' },
      { id: 'line-road-2', type: 'road', divisionId: 'div-3', via: 'transit-b', throughputPerDay: 40, transitDays: 2, fragility: 'low' },
    ],
  };

  const TOTAL_TRANSPORT_PER_DAY = 1.0;
  const INITIAL_BASE_INVENTORY = 8.0;
  const QUOTA_PERIOD_DAYS = 7;
  const QUOTA_PER_PERIOD = 6.0;
  const QUOTA_COMPOSITION = { ammo: 0.65, supply: 0.35 };
  const QUOTA_ADVANCE_MAX_RATIO = 0.5;
  const QUOTA_ADVANCE_INTEREST = 1.5;
  const QUOTA_PREVIEW_LEAD_DAYS = 3;
  const MOBILIZATION_INTERVAL_DAYS = 21;
  const MOBILIZATION_BATCH_SIZE = 30;
  const PERSONNEL_FULL_STRENGTH = 100;
  const TRAINING_DAYS = { urgent: 0, normal: 7 };
  const TRAINING_COMBAT_MULT = { urgent: 0.5, normal: 1.0 };
  const TRAINING_CASUALTY_MULT = { urgent: 1.3, normal: 1.0 };
  const CASUALTY_SPLIT = { kia: 0.3, wounded: 0.7 };
  const MEDIC_RECOVERY_RATE = 0.7;
  const HOSPITAL_DAILY_QUOTA_RATIO = 0.2;
  const HOSPITAL_DAILY_QUOTA = PERSONNEL_FULL_STRENGTH * HOSPITAL_DAILY_QUOTA_RATIO;
  const HOSPITAL_OVERFLOW_DEATH_MULT = 1.2;
  const INTEGRATION_LADDER = [
    { min: 0.5, delayDays: 0, effPenalty: 1.0 },
    { min: 0.2, delayDays: 2.5, effPenalty: 1.0 },
    { min: 0, delayDays: 5, effPenalty: 0.8 },
  ];
  const GAME_LENGTH_DAYS = 30;

  // A division's local stock is displayed in days, while shipments and base
  // inventory use D. This is the fixed conversion baseline for the demo.
  const DIVISION_SAFE_RESERVE_DAYS = 10;
  const POSTURE_CONSUMPTION_MULT = {
    refit: { ammo: 0.8, supply: 0.8 },
    defend: { ammo: 2.0, supply: 1.0 },
    dormant: { ammo: 1.2, supply: 1.2 },
    'active-defend': { ammo: 3.0, supply: 3.0 },
    attack: { ammo: 7.0, supply: 7.0 },
    retreat: { ammo: 1.0, supply: 1.0 },
  };
  const AMMO_TIER = [
    { min: 0.5, combatMult: 1.0, canAttack: true },
    { min: 0.2, combatMult: 0.7, canAttack: false },
    { min: 0.05, combatMult: 0.35, canAttack: false },
    { min: 0, combatMult: 0.1, canAttack: false, collapseAfterDays: 3 },
  ];
  const SPIKE_EXTRA_DAYS_EQUIVALENT = 3;
  const REFIT_FATIGUE_THRESHOLD = 0.75;
  const OBEDIENCE_FORCED_ATTACK_THRESHOLD = 0.7;
  const AUTONOMOUS_ATTACK_AGGRESSION_THRESHOLD = 0.7;
  const BATTLE_PREVIEW_LEAD_DAYS = 3;
  const INFO_DELAY_DAYS = { normal: 1, inCombat: 2 };
  const ENEMY_EFFECTIVENESS = 0.7;
  const BATTLE_OUTCOME_TABLE = [
    { minRatio: 1.5, label: '大胜', frontMovement: 8, casualtyRate: 0.02 },
    { minRatio: 1.0, label: '小胜', frontMovement: 3, casualtyRate: 0.04 },
    { minRatio: 0.7, label: '小败', frontMovement: -3, casualtyRate: 0.08 },
    { minRatio: 0, label: '大败', frontMovement: -8, casualtyRate: 0.15 },
  ];
  // Temporary linear curve from the implementation plan's M3 assumptions.
  const POSTURE_FATIGUE_CHANGE = {
    refit: -0.12,
    defend: 0.01,
    dormant: -0.03,
    'active-defend': 0.035,
    attack: 0.07,
    retreat: 0.04,
  };

  const DIVISION_PERSONALITY_PRESETS = {
    aggressive: { aggression: 0.8, hoarding: 0.2, obedience: 0.5, selfAwareness: 0.6 },
    hoarder: { aggression: 0.2, hoarding: 0.85, obedience: 0.5, selfAwareness: 0.6 },
    obedient: { aggression: 0.4, hoarding: 0.4, obedience: 0.9, selfAwareness: 0.2 },
  };

  return {
    MAP,
    TOTAL_TRANSPORT_PER_DAY,
    INITIAL_BASE_INVENTORY,
    QUOTA_PERIOD_DAYS,
    QUOTA_PER_PERIOD,
    QUOTA_COMPOSITION,
    QUOTA_ADVANCE_MAX_RATIO,
    QUOTA_ADVANCE_INTEREST,
    QUOTA_PREVIEW_LEAD_DAYS,
    MOBILIZATION_INTERVAL_DAYS,
    MOBILIZATION_BATCH_SIZE,
    PERSONNEL_FULL_STRENGTH,
    TRAINING_DAYS,
    TRAINING_COMBAT_MULT,
    TRAINING_CASUALTY_MULT,
    CASUALTY_SPLIT,
    MEDIC_RECOVERY_RATE,
    HOSPITAL_DAILY_QUOTA_RATIO,
    HOSPITAL_DAILY_QUOTA,
    HOSPITAL_OVERFLOW_DEATH_MULT,
    INTEGRATION_LADDER,
    GAME_LENGTH_DAYS,
    DIVISION_SAFE_RESERVE_DAYS,
    POSTURE_CONSUMPTION_MULT,
    AMMO_TIER,
    SPIKE_EXTRA_DAYS_EQUIVALENT,
    REFIT_FATIGUE_THRESHOLD,
    OBEDIENCE_FORCED_ATTACK_THRESHOLD,
    AUTONOMOUS_ATTACK_AGGRESSION_THRESHOLD,
    BATTLE_PREVIEW_LEAD_DAYS,
    INFO_DELAY_DAYS,
    ENEMY_EFFECTIVENESS,
    BATTLE_OUTCOME_TABLE,
    POSTURE_FATIGUE_CHANGE,
    DIVISION_PERSONALITY_PRESETS,
  };
}));
