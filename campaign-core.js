/* Pure campaign rules. The map only ever moves corps; units live inside them. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CampaignCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_CORPS_SLOTS = 9;
  const UNIT_TYPES = ['assault', 'mg', 'grenadier', 'tank', 'at', 'heli', 'aa', 'medic'];
  const UNITS = {
    assault: { label: '突击步兵', hp: 118, damage: 12, cooldown: 0.62, speed: 1.05 },
    mg: { label: '机枪组', hp: 82, damage: 6, cooldown: 0.22, speed: 0.82 },
    grenadier: { label: '榴弹兵', hp: 72, damage: 19, cooldown: 1.45, speed: 0.9 },
    tank: { label: '坦克', hp: 330, damage: 29, cooldown: 1.35, speed: 1.2 },
    at: { label: '反坦克班', hp: 58, damage: 7, antiArmor: 120, cooldown: 1.2, speed: 0.78 },
    heli: { label: '攻击直升机', hp: 112, damage: 18, antiArmor: 108, cooldown: 1.38, speed: 1.65 },
    aa: { label: '防空班', hp: 70, damage: 0, antiAir: 34, cooldown: 0.58, speed: 0.8 },
    medic: { label: '医疗兵', hp: 68, damage: 0, heal: 9, cooldown: 0.46, speed: 0.88 },
  };

  // Each entry is one player corps, rather than one loose map unit.
  const DEFAULTS = [
    { assault: 3, mg: 1, grenadier: 1, medic: 1 },
    { assault: 2, mg: 1, grenadier: 1, tank: 1, medic: 1 },
    { assault: 3, grenadier: 1, at: 1, medic: 1 },
  ];

  function normalizeRoster(roster = {}) {
    let remaining = MAX_CORPS_SLOTS;
    return Object.fromEntries(UNIT_TYPES.map((type) => {
      const count = Math.max(0, Math.min(remaining, Math.floor(Number(roster[type]) || 0)));
      remaining -= count;
      return [type, count];
    }));
  }
  const rosterSize = (roster) => Object.values(normalizeRoster(roster)).reduce((total, count) => total + count, 0);
  const sizeSpeedFactor = (size) => size <= 3 ? 1 : size <= 6 ? 0.9 : 0.78;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function outgoingEdges(map, nodeId) {
    return map.edges.filter((edge) => edge.from === nodeId || (!edge.directed && edge.to === nodeId));
  }
  function nextNode(edge, nodeId) { return edge.from === nodeId ? edge.to : edge.from; }
  function edgeBetween(map, from, to) { return outgoingEdges(map, from).find((edge) => nextNode(edge, from) === to); }
  function shortestPath(map, from, to) {
    if (from === to) return [from];
    const queue = [from], previous = new Map([[from, null]]);
    while (queue.length) {
      const current = queue.shift();
      for (const edge of outgoingEdges(map, current)) {
        const next = nextNode(edge, current);
        if (previous.has(next)) continue;
        previous.set(next, current);
        if (next === to) {
          const path = [to];
          while (previous.get(path[0]) !== null) path.unshift(previous.get(path[0]));
          return path;
        }
        queue.push(next);
      }
    }
    return null;
  }
  function shortestPathAvoiding(map, from, to, blockedId) {
    if (from === to) return [from];
    const queue = [from], previous = new Map([[from, null]]);
    while (queue.length) {
      const current = queue.shift();
      for (const edge of outgoingEdges(map, current)) {
        const next = nextNode(edge, current);
        if (next === blockedId || previous.has(next)) continue;
        previous.set(next, current);
        if (next === to) {
          const path = [to];
          while (previous.get(path[0]) !== null) path.unshift(previous.get(path[0]));
          return path;
        }
        queue.push(next);
      }
    }
    return null;
  }
  function reachableNodeIds(map, from) {
    const visited = new Set([from]), queue = [from];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of outgoingEdges(map, current)) {
        const next = nextNode(edge, current);
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    return visited;
  }

  function makeUnit(id, team, type) {
    const spec = UNITS[type];
    return { id, team, type, label: spec.label, hp: spec.hp, maxHp: spec.hp, cooldown: 0, destroyed: false };
  }
  function makeCorps(id, team, label, roster, nodeId) {
    const units = [], normalized = normalizeRoster(roster);
    for (const type of UNIT_TYPES) for (let n = 0; n < normalized[type]; n++) units.push(makeUnit(`${id}-${type}-${n + 1}`, team, type));
    return { id, team, label, slots: [...units, ...Array(MAX_CORPS_SLOTS - units.length).fill(null)], units,
      morale: 100, supply: 100, nodeId, destinationId: null, path: [], segmentProgress: 0,
      status: '待命', destroyed: false, engagementId: null, garrisoning: false, pendingEncounter: false };
  }
  function activeUnits(corps) { return corps.units.filter((unit) => !unit.destroyed && unit.hp > 0); }
  function corpsStats(corps) {
    const units = activeUnits(corps);
    const hp = units.reduce((sum, unit) => sum + unit.hp, 0);
    const maxHp = units.reduce((sum, unit) => sum + unit.maxHp, 0);
    const slowestUnitSpeed = units.length ? Math.min(...units.map((unit) => UNITS[unit.type].speed)) : 0;
    return { size: units.length, hp, maxHp, slowestUnitSpeed, sizeFactor: sizeSpeedFactor(units.length) };
  }
  function terrainSpeedFactor(map, corps) {
    if (!corps.path.length) return 1;
    const edge = edgeBetween(map, corps.nodeId, corps.path[0]);
    const cost = edge && map.definitions && map.definitions.edges && map.definitions.edges[edge.type]
      ? map.definitions.edges[edge.type].moveCost : 1;
    return 1 / Math.max(0.1, cost);
  }
  function corpsSpeed(corps, map) {
    const stats = corpsStats(corps);
    const readiness = 0.6 + 0.4 * ((clamp(corps.supply, 0, 100) + clamp(corps.morale, 0, 100)) / 200);
    return stats.slowestUnitSpeed * stats.sizeFactor * readiness * (map ? terrainSpeedFactor(map, corps) : 1);
  }

  function createCampaign(map, playerRosters = DEFAULTS) {
    const corps = playerRosters.map((roster, index) => makeCorps(`blue-corps-${index + 1}`, 'blue', `第${index + 1}兵团`, roster, 'blue-hq'));
    const guards = [{ assault: 2, mg: 1, medic: 1 }, { assault: 2, tank: 1, at: 1 }, { assault: 2, grenadier: 1, aa: 1 }];
    map.nodes.filter((node) => node.team === 'red' && node.type === 'objective').forEach((node, index) => {
      corps.push(makeCorps(`red-corps-${index + 1}`, 'red', `红方第${index + 1}兵团`, guards[index % guards.length], node.id));
    });
    for (const guard of corps.filter((item) => item.team === 'red')) { guard.garrisoning = true; guard.status = '驻防待命'; }
    return { map, corps, elapsed: 0, started: false, log: '部署兵团并下达出击命令后，点击“开始战役”。', winner: null,
      nodeControl: Object.fromEntries(map.nodes.map((node) => [node.id, node.team])), engagements: [], nextEngagementId: 1 };
  }
  function corpsAt(campaign, corps) {
    return campaign.corps.filter((other) => !other.destroyed && other.team !== corps.team && other.nodeId === corps.nodeId);
  }
  const enemiesAt = corpsAt;
  function startCampaign(campaign) {
    if (campaign.started) return false;
    campaign.started = true;
    let advancing = 0;
    for (const corps of campaign.corps.filter((item) => item.team === 'red' && !item.destroyed)) {
      const path = shortestPath(campaign.map, corps.nodeId, 'blue-hq');
      if (path && path.length > 1) { corps.path = path.slice(1); corps.destinationId = 'blue-hq'; corps.status = '向蓝方司令部推进'; advancing++; }
      else corps.status = '等待命令';
    }
    campaign.log = `战役开始：敌军 ${advancing} 支兵团正向蓝方司令部推进。`;
    return true;
  }
  function orderMove(campaign, corpsId, destinationId) {
    const corps = campaign.corps.find((item) => item.id === corpsId && item.team === 'blue' && !item.destroyed);
    if (!corps) return { ok: false, reason: '请选择一支仍可行动的蓝方兵团。' };
    if (corps.garrisoning) return { ok: false, reason: '该兵团正在驻防；请先解除驻防。' };
    if (corps.engagementId || corps.pendingEncounter) return { ok: false, reason: '该兵团正在遭遇或战斗中，请先作出节点决策。' };
    const path = shortestPath(campaign.map, corps.nodeId, destinationId);
    if (!path) return { ok: false, reason: '该节点在当前通行方向下不可达。' };
    if (path.length === 1) return { ok: false, reason: '兵团已在该节点。' };
    corps.path = path.slice(1); corps.destinationId = destinationId; corps.segmentProgress = 0;
    const destination = campaign.map.nodes.find((node) => node.id === destinationId);
    corps.status = `行军至 ${destination.name}`;
    campaign.log = `${corps.label} 已下达行军命令（${path.length - 1} 段通路，速度 ${corpsSpeed(corps, campaign.map).toFixed(2)}）。`;
    return { ok: true, path };
  }
  function nodeDefinition(campaign, nodeId) {
    const node = campaign.map.nodes.find((item) => item.id === nodeId);
    return campaign.map.definitions && campaign.map.definitions.nodes && campaign.map.definitions.nodes[node.type] || { capacity: 1, effects: [] };
  }
  function nodeCapacity(campaign, nodeId) { return nodeDefinition(campaign, nodeId).capacity || 1; }
  function friendlyAt(campaign, corps) { return campaign.corps.filter((other) => !other.destroyed && other.team === corps.team && other.nodeId === corps.nodeId); }
  function battleAt(campaign, nodeId) { return campaign.engagements.find((item) => item.nodeId === nodeId && item.active); }
  function engagedIds(campaign, nodeId, team) {
    return campaign.corps.filter((item) => !item.destroyed && item.nodeId === nodeId && item.team === team).sort((a, b) => a.id.localeCompare(b.id)).map((item) => item.id);
  }
  function createBattle(campaign, nodeId) {
    const existing = battleAt(campaign, nodeId); if (existing) return existing;
    // A battle is shared by every corps at this node.  This makes local force
    // concentration meaningful without requiring global blue/red force parity.
    const battle = { id: `battle-${campaign.nextEngagementId++}`, nodeId, active: true, elapsed: 0, lastEvent: '交战双方正在展开。', blueIds: engagedIds(campaign, nodeId, 'blue'), redIds: engagedIds(campaign, nodeId, 'red') };
    campaign.engagements.push(battle);
    for (const corps of campaign.corps.filter((item) => battle.blueIds.includes(item.id) || battle.redIds.includes(item.id))) { corps.engagementId = battle.id; corps.pendingEncounter = false; corps.path = []; corps.destinationId = null; corps.status = '节点战斗中'; }
    return battle;
  }
  function availableByTeam(campaign, battle, team) {
    const ids = team === 'blue' ? battle.blueIds : battle.redIds;
    return ids.map((id) => campaign.corps.find((corps) => corps.id === id)).filter((corps) => corps && !corps.destroyed && corps.nodeId === battle.nodeId);
  }
  function combatPower(corps) {
    return activeUnits(corps).reduce((total, unit) => total + UNITS[unit.type].damage / UNITS[unit.type].cooldown, 0) * (0.55 + corps.morale / 200) * (0.55 + corps.supply / 200);
  }
  function applyDamage(corps, amount) {
    const units = activeUnits(corps); let remaining = amount;
    for (const unit of units) { const share = remaining / Math.max(1, units.filter((item) => !item.destroyed).length); unit.hp -= share; remaining -= share; if (unit.hp <= 0) { unit.hp = 0; unit.destroyed = true; } }
    if (!activeUnits(corps).length) corps.destroyed = true;
  }
  function retreatTarget(campaign, corps) {
    return outgoingEdges(campaign.map, corps.nodeId).map((edge) => nextNode(edge, corps.nodeId)).find((id) => campaign.nodeControl[id] === corps.team && !campaign.corps.some((item) => !item.destroyed && item.team !== corps.team && item.nodeId === id));
  }
  function removeFromBattle(campaign, corps) { corps.engagementId = null; corps.pendingEncounter = false; corps.status = corps.destroyed ? '兵团溃散' : '待命'; }
  function finishBattle(campaign, battle, winner) {
    battle.active = false; battle.winner = winner;
    for (const team of ['blue', 'red']) for (const corps of availableByTeam(campaign, battle, team)) {
      if (team === winner) { removeFromBattle(campaign, corps); corps.status = '战斗胜利，等待命令'; }
      else {
        const target = retreatTarget(campaign, corps);
        if (target) { corps.nodeId = target; corps.morale = Math.max(0, corps.morale - 25); corps.supply = Math.max(0, corps.supply - 15); removeFromBattle(campaign, corps); corps.status = '战斗失利，已撤退'; }
        else { corps.destroyed = true; removeFromBattle(campaign, corps); }
      }
    }
    battle.lastEvent = `${winner === 'blue' ? '蓝方' : '红方'}获胜；败方撤退或溃散。`;
    campaign.log = `${campaign.map.nodes.find((node) => node.id === battle.nodeId).name}：${battle.lastEvent} 请指定兵团驻防以占领节点。`;
  }
  function advanceBattles(campaign, dt) {
    for (const battle of campaign.engagements.filter((item) => item.active)) {
      battle.elapsed += dt;
      const blue = availableByTeam(campaign, battle, 'blue'), red = availableByTeam(campaign, battle, 'red');
      if (!blue.length || !red.length) { finishBattle(campaign, battle, blue.length ? 'blue' : 'red'); continue; }
      // Capacity applies per side: extra corps are reserves, not free damage.
      // Chokepoints can therefore let a smaller defender resist a larger force.
      const capacity = nodeCapacity(campaign, battle.nodeId), blueFront = blue.slice(0, capacity), redFront = red.slice(0, capacity);
      const defense = nodeDefinition(campaign, battle.nodeId).effects.includes('defend') || nodeDefinition(campaign, battle.nodeId).effects.includes('cover') ? 0.75 : 1;
      const bluePower = blueFront.reduce((sum, corps) => sum + combatPower(corps), 0);
      const redPower = redFront.reduce((sum, corps) => sum + combatPower(corps), 0) * (campaign.nodeControl[battle.nodeId] === 'red' ? defense : 1);
      for (const corps of redFront) applyDamage(corps, dt * bluePower / redFront.length * 0.33);
      for (const corps of blueFront) applyDamage(corps, dt * redPower / blueFront.length * 0.33);
      for (const corps of [...blueFront, ...redFront]) { corps.morale = Math.max(0, corps.morale - dt * 1.3); corps.supply = Math.max(0, corps.supply - dt * 0.8); }
      battle.lastEvent = `前线投入：蓝 ${blueFront.length}/${blue.length}，红 ${redFront.length}/${red.length}${blue.length > capacity || red.length > capacity ? '；其余为预备队' : ''}。`;
      if (!blueFront.some((corps) => !corps.destroyed) || !redFront.some((corps) => !corps.destroyed)) finishBattle(campaign, battle, blueFront.some((corps) => !corps.destroyed) ? 'blue' : 'red');
    }
  }
  function encounterOptions(campaign, corpsId) {
    const corps = campaign.corps.find((item) => item.id === corpsId);
    if (!corps || !corps.pendingEncounter) return [];
    const options = ['battle', 'wait'];
    if (corps.path.length) options.push('pass');
    if (corps.destinationId && findBypass(campaign, corps)) options.push('bypass');
    return options;
  }
  function findBypass(campaign, corps) {
    for (const edge of outgoingEdges(campaign.map, corps.nodeId)) {
      const next = nextNode(edge, corps.nodeId); if (enemiesAt(campaign, { ...corps, nodeId: next }).length) continue;
      const rest = shortestPathAvoiding(campaign.map, next, corps.destinationId, corps.nodeId);
      if (rest) return [next, ...rest.slice(1)];
    }
    return null;
  }
  function resolveEncounter(campaign, corpsId, choice) {
    const corps = campaign.corps.find((item) => item.id === corpsId && !item.destroyed);
    if (!corps || !corps.pendingEncounter) return { ok: false, reason: '当前没有待处理的节点遭遇。' };
    const place = campaign.map.nodes.find((node) => node.id === corps.nodeId).name;
    if (choice === 'battle' || choice === 'join') { const battle = createBattle(campaign, corps.nodeId); if (!battle.blueIds.includes(corps.id)) battle.blueIds.push(corps.id); corps.engagementId = battle.id; corps.pendingEncounter = false; corps.path = []; corps.destinationId = null; corps.status = '节点战斗中'; campaign.log = `${corps.label} 在${place}${choice === 'join' ? '加入战斗' : '发起战斗'}。`; return { ok: true }; }
    // P1's fixed pass-through loss is deliberately provisional.  P2 should
    // replace it with a context-sensitive interception rule so rushing cannot
    // dominate fighting for nodes and supply routes.
    if (choice === 'pass' && corps.path.length) { for (const unit of activeUnits(corps)) unit.hp *= 0.90; corps.morale = Math.max(0, corps.morale - 12); corps.supply = Math.max(0, corps.supply - 10); corps.pendingEncounter = false; corps.status = '强行通过战区'; campaign.log = `${corps.label} 强行通过${place}，承受 10% 兵力、12 士气和 10 补给损失。`; return { ok: true }; }
    if (choice === 'bypass') { const path = findBypass(campaign, corps); if (!path) return { ok: false, reason: '没有可用的绕路。' }; corps.path = path; corps.pendingEncounter = false; corps.status = '正在绕过敌军节点'; campaign.log = `${corps.label} 正绕过${place}。`; return { ok: true }; }
    if (choice === 'wait') { corps.path = []; corps.destinationId = null; corps.pendingEncounter = false; corps.status = '遭遇后等待'; campaign.log = `${corps.label} 在${place}停止等待。`; return { ok: true }; }
    return { ok: false, reason: '该遭遇选项当前不可用。' };
  }
  function setGarrison(campaign, corpsId, enabled) {
    const corps = campaign.corps.find((item) => item.id === corpsId && item.team === 'blue' && !item.destroyed);
    if (!corps) return { ok: false, reason: '请选择可行动的蓝方兵团。' };
    if (!enabled) { corps.garrisoning = false; corps.status = '解除驻防，待命'; return { ok: true }; }
    if (enemiesAt(campaign, corps).length || battleAt(campaign, corps.nodeId)) return { ok: false, reason: '节点仍有敌军或战斗，无法驻防。' };
    // Occupation is an explicit opportunity cost: one winner holds the node,
    // while the remaining corps are free to exploit a local breakthrough.
    corps.garrisoning = true; corps.path = []; corps.destinationId = null; corps.status = '驻防并占领节点'; campaign.nodeControl[corps.nodeId] = 'blue';
    const effects = nodeDefinition(campaign, corps.nodeId).effects;
    const supplyGain = effects.includes('resupply') || effects.includes('supply') ? 35 : effects.includes('control') ? 18 : 8;
    corps.supply = Math.min(100, corps.supply + supplyGain); if (effects.includes('recover') || effects.includes('repair')) corps.morale = Math.min(100, corps.morale + 12);
    campaign.log = `${corps.label} 驻防${campaign.map.nodes.find((node) => node.id === corps.nodeId).name}，节点已归蓝方控制（补给 +${supplyGain}）。`;
    return { ok: true };
  }
  function orderRetreat(campaign, corpsId) {
    const corps = campaign.corps.find((item) => item.id === corpsId && item.team === 'blue' && !item.destroyed);
    if (!corps || !corps.engagementId) return { ok: false, reason: '该兵团不在战斗中。' };
    const target = retreatTarget(campaign, corps); if (!target) return { ok: false, reason: '没有安全的己方相邻节点可撤退。' };
    corps.nodeId = target; corps.morale = Math.max(0, corps.morale - 15); removeFromBattle(campaign, corps); campaign.log = `${corps.label} 主动撤退。`; return { ok: true };
  }
  function advance(campaign, dt) {
    if (!campaign.started || campaign.winner) return;
    campaign.elapsed += dt;
    advanceBattles(campaign, dt);
    for (const corps of campaign.corps.filter((item) => !item.destroyed && item.path.length && !item.pendingEncounter && !item.engagementId)) {
      corps.segmentProgress += dt * corpsSpeed(corps, campaign.map);
      corps.status = '行军至下一节点';
    }
    for (const corps of campaign.corps.filter((item) => !item.destroyed && item.path.length && !item.pendingEncounter && !item.engagementId && item.segmentProgress >= 1)) {
      corps.nodeId = corps.path.shift(); corps.segmentProgress = 0;
      const enemies = corpsAt(campaign, corps);
      if (enemies.length) {
        if (corps.team === 'red') { createBattle(campaign, corps.nodeId); campaign.log = `${corps.label} 在${campaign.map.nodes.find((node) => node.id === corps.nodeId).name}发起进攻。`; continue; }
        corps.pendingEncounter = true;
        corps.status = '遭遇敌军，等待决策';
        campaign.log = `${corps.label} 抵达 ${campaign.map.nodes.find((node) => node.id === corps.nodeId).name}；请选择战斗、强行通过、绕路或等待。`;
      } else {
        corps.status = corps.path.length ? '抵达节点，继续行军' : '待命';
      }
    }
    if (campaign.corps.some((corps) => corps.team === 'red' && !corps.destroyed && corps.nodeId === 'blue-hq')) {
      campaign.winner = 'red'; campaign.log = '敌军已进入蓝方司令部，战役失败。';
    }
  }
  function unitPosition(campaign, corps) {
    const current = campaign.map.nodes.find((node) => node.id === corps.nodeId);
    return { x: current.x, y: current.y };
  }
  return { MAX_CORPS_SLOTS, UNIT_TYPES, UNITS, DEFAULTS, normalizeRoster, rosterSize, sizeSpeedFactor, corpsStats, corpsSpeed,
    shortestPath, shortestPathAvoiding, reachableNodeIds, createCampaign, startCampaign, orderMove, advance, unitPosition, enemiesAt, corpsAt, activeUnits,
    encounterOptions, resolveEncounter, setGarrison, orderRetreat, battleAt, nodeCapacity };
});
