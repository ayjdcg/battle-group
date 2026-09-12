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
startCampaign(skirmish);

const startPosition = unitPosition(skirmish, attacker);
advance(skirmish, 0.2);
assert.notDeepEqual(
  unitPosition(skirmish, attacker),
  startPosition,
  'a started unit must visibly advance along its first edge',
);
advance(skirmish, 0.3);
assert.ok(
  attacker.engagementId,
  'opposing units on the same edge must stop for a meeting engagement',
);

for (let i = 0; i < 500; i++) advance(skirmish, 0.04);
assert.ok(
  skirmish.units.some((unit) => unit.destroyed),
  'units at the same node should actually resolve combat',
);
console.log('campaign-core: connectivity and movement-order tests passed');
