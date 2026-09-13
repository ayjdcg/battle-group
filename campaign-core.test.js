const assert = require('node:assert/strict');
const { generateMap } = require('./map-generator.js');
const {
  shortestPath,
  reachableNodeIds,
  createCampaign,
  startCampaign,
  orderMove,
  advance,
  unitPosition,
  DEFAULTS,
} = require('./campaign-core.js');

for (const seed of ['alpha', 'river', 'campaign-42']) {
  const map = generateMap({ seed, playerCorps: 6 });
  assert.ok(shortestPath(map, 'blue-hq', 'red-hq'), `${seed}: HQs should connect`);
  assert.ok(reachableNodeIds(map, 'blue-hq').has('red-hq'));

  const campaign = createCampaign(map, DEFAULTS.slice(0, 3));
  startCampaign(campaign);
  assert.ok(
    campaign.units.some((unit) => unit.team === 'red' && unit.path.length),
    `${seed}: enemy should receive an advance path`,
  );

  const objective = map.nodes.find(
    (node) => node.type === 'objective' && node.team === 'red',
  );
  assert.equal(
    orderMove(
      campaign,
      campaign.units.find((unit) => unit.team === 'blue').id,
      objective.id,
    ).ok,
    true,
  );
}

const directedOnly = {
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ from: 'a', to: 'b', directed: true }],
};
assert.deepEqual(shortestPath(directedOnly, 'a', 'b'), ['a', 'b']);
assert.equal(
  shortestPath(directedOnly, 'b', 'a'),
  null,
  'a directed edge must not be traversed backwards',
);

const skirmishMap = {
  nodes: [
    { id: 'blue-hq', team: 'blue', x: 0, y: 0 },
    { id: 'objective', team: 'red', type: 'objective', x: 100, y: 0 },
  ],
  edges: [{ from: 'blue-hq', to: 'objective', directed: false }],
};
const skirmish = createCampaign(skirmishMap, [{ assault: 1 }]);
const attacker = skirmish.units.find((unit) => unit.team === 'blue');
assert.equal(orderMove(skirmish, attacker.id, 'objective').ok, true);
skirmish.started = true;

const startPosition = unitPosition(skirmish, attacker);
advance(skirmish, 0.2);
assert.equal(
  attacker.segmentProgress > 0,
  true,
  'movement should accumulate travel time before the next node is reached',
);
assert.deepEqual(
  unitPosition(skirmish, attacker),
  startPosition,
  'a moving unit should remain displayed at its current node until it arrives',
);
for (let i = 0; i < 30; i++) advance(skirmish, 0.04);
assert.ok(
  attacker.engagementId,
  'an arriving unit must start a battle at an occupied node',
);
const defender = skirmish.units.find(
  (unit) => unit.team === 'red' && !unit.destroyed,
);
assert.equal(attacker.engagementId, defender.engagementId);

for (let i = 0; i < 500; i++) advance(skirmish, 0.04);
assert.ok(
  skirmish.units.some((unit) => unit.destroyed),
  'units at the same node should actually resolve combat',
);

const transitMap = {
  nodes: [
    { id: 'blue-hq', team: 'blue', x: 0, y: 0 },
    { id: 'battle', team: 'red', type: 'objective', x: 100, y: 0 },
    { id: 'far', team: 'neutral', x: 200, y: 0 },
  ],
  edges: [
    { from: 'blue-hq', to: 'battle', directed: false },
    { from: 'battle', to: 'far', directed: false },
  ],
};
const transit = createCampaign(transitMap, [{ assault: 3 }]);
const [lead, reinforcer, passer] = transit.units.filter((unit) => unit.team === 'blue');
lead.hp = lead.maxHp = 10000; // Keep this fixture's battle active while the other unit crosses it.
assert.equal(orderMove(transit, lead.id, 'battle').ok, true);
transit.started = true;
for (let i = 0; i < 30; i++) advance(transit, 0.04);
assert.ok(lead.engagementId, 'the lead unit should be fighting at the node');
assert.equal(orderMove(transit, reinforcer.id, 'battle').ok, true);
for (let i = 0; i < 30; i++) advance(transit, 0.04);
assert.equal(reinforcer.engagementId, lead.engagementId, 'a unit ordered to the battle node should reinforce it');
assert.equal(orderMove(transit, passer.id, 'far').ok, true);
const hpBeforeTransit = passer.hp;
for (let i = 0; i < 130 && passer.nodeId !== 'far'; i++) advance(transit, 0.04);
assert.equal(passer.nodeId, 'far', 'a unit ordered beyond a battle should pass through it');
assert.ok(passer.hp < hpBeforeTransit, 'passing a battle should cause losses');
console.log('campaign-core: connectivity and movement-order tests passed');
