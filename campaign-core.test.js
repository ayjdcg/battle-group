const assert = require('node:assert/strict');
const { generateMap } = require('./map-generator.js');
const { MAX_CORPS_SLOTS, DEFAULTS, shortestPath, reachableNodeIds, createCampaign, startCampaign, orderMove, advance, unitPosition, corpsStats, corpsSpeed, encounterOptions, resolveEncounter, setGarrison, battleAt } = require('./campaign-core.js');

for (const seed of ['alpha', 'river', 'campaign-42']) {
  const map = generateMap({ seed, playerCorps: 6 });
  assert.ok(shortestPath(map, 'blue-hq', 'red-hq'), `${seed}: HQs should connect`);
  assert.ok(reachableNodeIds(map, 'blue-hq').has('red-hq'));
  const campaign = createCampaign(map, DEFAULTS);
  assert.equal(campaign.corps.filter((corps) => corps.team === 'blue').length, 3);
  assert.ok(campaign.corps.filter((corps) => corps.team === 'red').length >= 3);
  assert.ok(campaign.corps.every((corps) => corps.slots.length === MAX_CORPS_SLOTS));
  assert.ok(campaign.corps.every((corps) => corps.units.length <= MAX_CORPS_SLOTS));
  startCampaign(campaign);
  assert.ok(campaign.corps.some((corps) => corps.team === 'red' && corps.path.length), `${seed}: enemy corps should receive an advance path`);
  const objective = map.nodes.find((node) => node.type === 'objective' && node.team === 'red');
  assert.equal(orderMove(campaign, campaign.corps.find((corps) => corps.team === 'blue').id, objective.id).ok, true);
}

const directedOnly = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b', directed: true }] };
assert.deepEqual(shortestPath(directedOnly, 'a', 'b'), ['a', 'b']);
assert.equal(shortestPath(directedOnly, 'b', 'a'), null, 'a directed edge must not be traversed backwards');

const movementMap = {
  nodes: [{ id: 'blue-hq', team: 'blue', x: 0, y: 0 }, { id: 'far', team: 'neutral', x: 100, y: 0 }],
  edges: [{ from: 'blue-hq', to: 'far', type: 'road', directed: false }],
  definitions: { edges: { road: { moveCost: 1 } } },
};
const movement = createCampaign(movementMap, [{ assault: 1 }, { assault: 3, mg: 1, grenadier: 1, tank: 1, at: 1, aa: 1, medic: 1 }]);
const [small, full] = movement.corps.filter((corps) => corps.team === 'blue');
assert.equal(corpsStats(full).size, 9);
assert.ok(corpsSpeed(full, movementMap) < corpsSpeed(small, movementMap), 'a full corps must be slower than a small corps');
assert.equal(corpsStats(full).slowestUnitSpeed, 0.78, 'the slowest constituent unit limits corps speed');
full.supply = 20; full.morale = 20;
assert.ok(corpsSpeed(full, movementMap) < 0.78 * 0.78, 'supply and morale must reduce movement speed');
full.supply = full.morale = 100;
assert.equal(orderMove(movement, small.id, 'far').ok, true);
movement.started = true;
const startPosition = unitPosition(movement, small);
advance(movement, 0.2);
assert.ok(small.segmentProgress > 0, 'movement should accumulate travel time before the next node');
assert.deepEqual(unitPosition(movement, small), startPosition, 'a corps marker remains at its current node until it arrives');
for (let i = 0; i < 30; i++) advance(movement, 0.04);
assert.equal(small.nodeId, 'far', 'a corps reaches its ordered node as one map object');

const contactMap = {
  nodes: [{ id: 'blue-hq', team: 'blue', x: 0, y: 0 }, { id: 'contact', team: 'red', type: 'objective', x: 100, y: 0 }],
  edges: [{ from: 'blue-hq', to: 'contact', type: 'road', directed: false }],
  definitions: { edges: { road: { moveCost: 1 } } },
};
const contact = createCampaign(contactMap, [{ assault: 1 }, { assault: 3, mg: 1, grenadier: 1, tank: 1, at: 1, aa: 1, medic: 1 }]);
const [contactCorps, reinforcement] = contact.corps.filter((corps) => corps.team === 'blue');
assert.equal(orderMove(contact, contactCorps.id, 'contact').ok, true);
assert.equal(orderMove(contact, reinforcement.id, 'contact').ok, true);
contact.started = true;
for (let i = 0; i < 30; i++) advance(contact, 0.04);
assert.equal(contactCorps.nodeId, 'contact');
assert.equal(contactCorps.pendingEncounter, true, 'P1 contact must pause for an encounter decision');
assert.ok(encounterOptions(contact, contactCorps.id).includes('battle'));
assert.equal(resolveEncounter(contact, contactCorps.id, 'battle').ok, true);
for (let i = 0; i < 15; i++) advance(contact, 0.04);
assert.equal(reinforcement.pendingEncounter, true, 'a second corps can reach the same node');
assert.equal(resolveEncounter(contact, reinforcement.id, 'join').ok, true, 'the second corps can join an existing node battle');
const battle = battleAt(contact, 'contact');
assert.equal(battle.blueIds.length, 2, 'two blue corps participate in one node battle');
assert.equal(contactCorps.status, '节点战斗中');
assert.equal(reinforcement.status, '节点战斗中');

for (const red of contact.corps.filter((corps) => corps.team === 'red')) for (const unit of red.units) { unit.hp = 0; unit.destroyed = true; }
advance(contact, 0.04);
assert.equal(battle.active, false, 'a battle resolves once one side has no surviving corps');
assert.equal(setGarrison(contact, contactCorps.id, true).ok, true, 'one winner may be assigned to occupy the node');
assert.equal(contact.nodeControl.contact, 'blue');
assert.equal(setGarrison(contact, contactCorps.id, false).ok, true, 'a garrison can be released to continue advancing');

console.log('campaign-core: corps structure and movement tests passed');
