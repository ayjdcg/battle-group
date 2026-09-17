'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  advanceDay,
  advanceQueues,
  ammoTierOf,
  computeEffectiveness,
  consumeAndApplyPosture,
  createInitialState,
  decidePosture,
  dispatchShipments,
  dispatchConfiguredShipments,
  perceive,
  sendWoundedToHospital,
  generateDailyReport,
  refreshInfoSnapshot,
  resolveBattles,
  scheduleBattle,
} = require('./logistics-core.js');

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

const state = createInitialState();
const advanceDayWithoutDispatch = (gameState) => advanceDay(gameState, { dispatchConfigured: false });

assert.equal(state.day, 0);
assert.equal(state.divisions.length, 3);
assert.equal(state.transitQueue.length, 0);
assert.deepEqual(
  state.divisions.map((division) => division.id),
  ['div-1', 'div-2', 'div-3'],
);

console.log('logistics-core: M0 skeleton tests passed');

const transitState = createInitialState();
advanceDayWithoutDispatch(transitState);
dispatchShipments(transitState, [{
  lineId: 'line-rail',
  cargo: { ammo: 0.3, supply: 0.2, personnel: 0 },
}]);

assert.equal(transitState.day, 1);
assert.equal(transitState.transitQueue.length, 1);
assert.equal(transitState.divisions[0].ammoDays, 0);
assert.equal(transitState.divisions[0].supplyDays, 0);

transitState.divisions[0].posture = 'defend';
transitState.day = 2;
advanceQueues(transitState);

assert.equal(transitState.day, 2);
assert.equal(transitState.transitQueue.length, 0);
// M3 converts D cargo to the receiving division's current daily-use units.
assertClose(transitState.divisions[0].ammoDays, 0.15);
assertClose(transitState.divisions[0].supplyDays, 0.2);
assert.equal(transitState.divisions[1].ammoDays, 0);

console.log('logistics-core: M1 transit timing tests passed');

const quotaState = createInitialState();
for (let index = 0; index < 30; index += 1) {
  advanceDayWithoutDispatch(quotaState);
}

assert.equal(quotaState.day, 30);
assertClose(quotaState.base.ammo, 32 * 0.65);
assertClose(quotaState.base.supply, 32 * 0.35);
assert.equal(quotaState.quota.nextArrivalDay, 35);

const advanceState = createInitialState();
advanceState.orders.advanceQuota = 2;
advanceDayWithoutDispatch(advanceState);
assert.equal(advanceState.quota.pendingAdvanceDebt, 2);
assertClose(advanceState.base.ammo, (8 + 2) * 0.65);
for (let index = 0; index < 6; index += 1) {
  advanceDayWithoutDispatch(advanceState);
}
assert.equal(advanceState.day, 7);
assertClose(advanceState.base.ammo, (8 + 2 + 3) * 0.65);
assert.equal(advanceState.quota.pendingAdvanceDebt, 0);

console.log('logistics-core: M2 quota and limited inventory tests passed');

const tierState = createInitialState();
const tierDivision = tierState.divisions[0];
tierDivision.ammoDays = 10;
assert.equal(ammoTierOf(tierDivision).combatMult, 1.0);
tierDivision.ammoDays = 5;
assert.equal(ammoTierOf(tierDivision).combatMult, 1.0);
tierDivision.ammoDays = 4.999;
assert.equal(ammoTierOf(tierDivision).combatMult, 0.7);
tierDivision.ammoDays = 2;
assert.equal(ammoTierOf(tierDivision).combatMult, 0.7);
tierDivision.ammoDays = 1.999;
assert.equal(ammoTierOf(tierDivision).combatMult, 0.35);
tierDivision.ammoDays = 0.5;
assert.equal(ammoTierOf(tierDivision).combatMult, 0.35);
tierDivision.ammoDays = 0.499;
assert.equal(ammoTierOf(tierDivision).combatMult, 0.1);

const consumptionState = createInitialState();
for (const division of consumptionState.divisions) {
  division.posture = 'active-defend';
  division.ammoDays = 100;
  division.supplyDays = 100;
}
for (let index = 0; index < 30; index += 1) {
  for (const division of consumptionState.divisions) {
    consumeAndApplyPosture(consumptionState, division);
  }
}
const consumedAmmoDays = consumptionState.divisions.reduce(
  (sum, division) => sum + 100 - division.ammoDays,
  0,
);
const consumedSupplyDays = consumptionState.divisions.reduce(
  (sum, division) => sum + 100 - division.supplyDays,
  0,
);
// 3 divisions × 30 days × active-defend multiplier 3 / safe reserve 10 = 27 D.
assertClose(consumedAmmoDays, 27);
assertClose(consumedSupplyDays, 27);

const effectivenessState = createInitialState();
const effectivenessDivision = effectivenessState.divisions[0];
effectivenessDivision.ammoDays = 10;
effectivenessDivision.manpowerRatio = 0.8;
effectivenessDivision.equipmentReady = 0.75;
effectivenessDivision.fatigue = 0.25;
assertClose(computeEffectiveness(effectivenessDivision), 0.45);
effectivenessDivision.ammoDays = 1;
assertClose(computeEffectiveness(effectivenessDivision), 0.1575);

console.log('logistics-core: M3 consumption, ammo tiers, and effectiveness tests passed');

const aiState = createInitialState();
for (const division of aiState.divisions) {
  division.ammoDays = 6;
  division.supplyDays = 6;
  division.quietDays = 2;
}
aiState.day = 1;
aiState.battlePreview = aiState.divisions.map((division) => ({
  divisionId: division.id,
  day: 1,
  source: 'orders-known',
  certainty: 1,
}));
for (const division of aiState.divisions) {
  perceive(aiState, division);
}
assert.equal(decidePosture(aiState, aiState.divisions[0]), 'attack');
assert.equal(decidePosture(aiState, aiState.divisions[1]), 'defend');
assert.equal(decidePosture(aiState, aiState.divisions[2]), 'attack');

const autonomousState = createInitialState();
const aggressiveDivision = autonomousState.divisions[0];
aggressiveDivision.ammoDays = 8;
aggressiveDivision.quietDays = 2;
perceive(autonomousState, aggressiveDivision);
assert.equal(decidePosture(autonomousState, aggressiveDivision), 'attack');

const lowAmmoState = createInitialState();
const lowAmmoDivision = lowAmmoState.divisions[1];
lowAmmoDivision.ammoDays = 1.5;
perceive(lowAmmoState, lowAmmoDivision);
assert.equal(decidePosture(lowAmmoState, lowAmmoDivision), 'dormant');
lowAmmoDivision.underAttack = true;
lowAmmoDivision.ammoDays = 0.5;
perceive(lowAmmoState, lowAmmoDivision);
assert.equal(decidePosture(lowAmmoState, lowAmmoDivision), 'retreat');

console.log('logistics-core: M4 personality and posture-state tests passed');

const hospitalState = createInitialState();
sendWoundedToHospital(hospitalState, 40, 1);
advanceDayWithoutDispatch(hospitalState);
assertClose(hospitalState.personnel.recoveredVeterans, 14);
assertClose(hospitalState.personnel.permanentLosses, 6);
assert.equal(hospitalState.personnel.hospitalQueue.length, 1);
assert.equal(hospitalState.personnel.hospitalQueue[0].overflowDays, 1);
advanceDayWithoutDispatch(hospitalState);
assertClose(hospitalState.personnel.recoveredVeterans, 26.8);
assertClose(hospitalState.personnel.permanentLosses, 13.2);
assert.equal(hospitalState.personnel.hospitalQueue.length, 0);

const mobilizationState = createInitialState();
mobilizationState.orders.trainingTrack = 'normal';
for (let index = 0; index < 21; index += 1) {
  advanceDayWithoutDispatch(mobilizationState);
}
assert.equal(mobilizationState.personnel.trainingQueue.length, 1);
for (let index = 0; index < 7; index += 1) {
  advanceDayWithoutDispatch(mobilizationState);
}
assertClose(mobilizationState.personnel.pool, 30);
assert.equal(mobilizationState.personnel.trainingQueue.length, 0);

const integrationState = createInitialState();
integrationState.personnel.pool = 10;
integrationState.divisions[0].manpowerRatio = 0.4;
integrationState.orders.personnelAssignment = { 'div-1': 10 };
advanceDayWithoutDispatch(integrationState);
assert.equal(integrationState.personnel.integrationQueue.length, 1);
for (let index = 0; index < 3; index += 1) {
  advanceDayWithoutDispatch(integrationState);
}
assertClose(integrationState.divisions[0].manpowerRatio, 0.5);
assertClose(integrationState.divisions[0].integrationEffPenalty, 1);

console.log('logistics-core: M5 personnel-loop tests passed');

const battleState = createInitialState();
const battleDivision = battleState.divisions[0];
battleDivision.ammoDays = 0;
battleDivision.supplyDays = 5;
battleDivision.underAttack = true;
const battleResults = resolveBattles(battleState);
assert.equal(battleResults.length, 1);
assert.ok(battleResults[0].casualties > 0);
assert.ok(battleResults[0].counterfactual);
assert.ok(battleResults[0].counterfactual.casualtyRateReduction > 0);
generateDailyReport(battleState, battleResults);
assert.match(battleState.eventLog[0].text, /弹药于交战第 1 日耗尽/);
assert.match(battleState.eventLog[1].text, /若多留 2 天弹药储备/);

const previewState = createInitialState();
previewState.day = 4;
const preview = scheduleBattle(previewState, 'div-2');
assert.equal(preview.day, 7);
assert.equal(previewState.battlePreview.length, 1);

console.log('logistics-core: M6 battle, attribution, and counterfactual tests passed');

const infoState = createInitialState();
assert.equal(infoState.divisions[0].lastReportSnapshot.day, 0);
infoState.divisions[0].ammoDays = 9;
advanceDayWithoutDispatch(infoState);
assert.equal(infoState.divisions[0].lastReportSnapshot.day, 0);
assert.equal(infoState.divisions[0].lastReportSnapshot.ammoDays, 0);
advanceDayWithoutDispatch(infoState);
assert.equal(infoState.divisions[0].lastReportSnapshot.day, 1);
assertClose(infoState.divisions[0].lastReportSnapshot.ammoDays, 8.8);

const combatInfoState = createInitialState();
combatInfoState.divisions[0].ammoDays = 8;
advanceDayWithoutDispatch(combatInfoState);
combatInfoState.battlePreview.push({
  divisionId: 'div-1', day: 2, source: 'enemy-signal', certainty: 1,
});
advanceDayWithoutDispatch(combatInfoState);
assert.equal(combatInfoState.divisions[0].lastReportSnapshot.day, 0);

const previewQuotaState = createInitialState();
for (let index = 0; index < 3; index += 1) {
  advanceDayWithoutDispatch(previewQuotaState);
}
assert.equal(previewQuotaState.quota.nextAmount, null);
advanceDayWithoutDispatch(previewQuotaState);
assertClose(previewQuotaState.quota.nextAmount, 6);
previewQuotaState.orders.advanceQuota = 2;
advanceDayWithoutDispatch(previewQuotaState);
assertClose(previewQuotaState.quota.nextAmount, 3);

console.log('logistics-core: M7 delayed information and quota-preview tests passed');

const configuredDispatchState = createInitialState();
assert.deepEqual(Object.keys(configuredDispatchState.orders.lineRatios['line-rail']).sort(), ['ammo', 'supply']);
configuredDispatchState.orders.dailyShipmentCap = 1;
configuredDispatchState.orders.divisionPriority = { 'div-1': 3, 'div-2': 0, 'div-3': 0 };
const configuredShipments = dispatchConfiguredShipments(configuredDispatchState);
assert.equal(configuredShipments.length, 1);
assert.equal(configuredShipments[0].lineId, 'line-rail');
assertClose(configuredShipments[0].cargo.ammo + configuredShipments[0].cargo.supply, 100 / 180);

const truthState = createInitialState();
const truthDivision = truthState.divisions[2];
truthDivision.ammoDays = 4;
truthState.orders.briefTruth[truthDivision.id] = true;
assertClose(perceive(truthState, truthDivision).ammoDays, 4);

const playableState = createInitialState();
for (let index = 0; index < 30; index += 1) {
  advanceDay(playableState);
}
assert.equal(playableState.day, 30);
assert.equal(playableState.ended, true);

console.log('logistics-core: M8 rule-based dispatch tests passed');

const mapUiSource = fs.readFileSync(require.resolve('./logistics-map-ui.js'), 'utf8');
assert.match(mapUiSource, /后勤流动总览/);
assert.match(mapUiSource, /在途物资/);
assert.match(mapUiSource, /人员流转/);
assert.match(mapUiSource, /人员不占物资车队运力/);
assert.doesNotMatch(mapUiSource, /人员预留占比/);

console.log('logistics-map-ui: transit-first information hierarchy contract tests passed');
