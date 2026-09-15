/* Pure campaign rules. The map only ever moves corps; units live inside them. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CampaignCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_CORPS_SLOTS = 9;
  // Deliberately cinematic rather than real-time: the battle view needs enough
  // time for players to read target selection and role counters.
  const BATTLE_DAMAGE_SCALE = 0.65;
  const BATTLE_COOLDOWN_SCALE = 1.8;
  const BATTLE_EFFECT_DURATION = 0.42;
  const FORMATION_ROWS = {
    frontline: { label: '前列', rank: 0 },
    support: { label: '支援列', rank: 1 },
    rear: { label: '后卫', rank: 2 },
    air: { label: '空中层', rank: -1 },
  };
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
      morale: 100, nodeId, destinationId: null, path: [], segmentProgress: 0,
      status: '待命', destroyed: false, engagementId: null, garrisoning: false, pendingEncounter: false };
  }
  function activeUnits(corps) { return corps.units.filter((unit) => !unit.destroyed && unit.hp > 0); }
  // Slots are roster capacity, not player-authored coordinates. This role map is
  // the single source of truth for both combat screening and battle rendering.
  function formationRow(unit) {
    if (unit.type === 'heli') return 'air';
    if (unit.type === 'tank' || unit.type === 'assault') return 'frontline';
    if (unit.type === 'mg' || unit.type === 'grenadier' || unit.type === 'at') return 'support';
    return 'rear';
  }
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
    // P1 deliberately has no logistics layer. Morale represents a corps' immediate
    // cohesion only; ammunition and resupply return when the logistics loop exists.
    const readiness = 0.7 + 0.3 * (clamp(corps.morale, 0, 100) / 100);
    return stats.slowestUnitSpeed * stats.sizeFactor * readiness * (map ? terrainSpeedFactor(map, corps) : 1);
  }

  function createCampaign(map, playerRosters = DEFAULTS) {
    const corps = playerRosters.map((roster, index) => makeCorps(`blue-corps-${index + 1}`, 'blue', `第${index + 1}兵团`, roster, 'blue-hq'));
    const guards = [{ assault: 2, mg: 1, medic: 1 }, { assault: 2, tank: 1, at: 1 }, { assault: 2, grenadier: 1, aa: 1 }];
    map.nodes.filter((node) => node.team === 'red' && node.type === 'objective').forEach((node, index) => {
      corps.push(makeCorps(`red-corps-${index + 1}`, 'red', `红方第${index + 1}兵团`, guards[index % guards.length], node.id));
    });
    for (const guard of corps.filter((item) => item.team === 'red')) { guard.garrisoning = true; guard.status = '驻防待命'; }
    return { map, corps, enemyMode: 'centerline-test', elapsed: 0, started: false, log: '配置测试兵团并下达行军命令后，点击“开始战役”。', winner: null,
      nodeControl: Object.fromEntries(map.nodes.map((node) => [node.id, node.team])), engagements: [], nextEngagementId: 1 };
  }
  function corpsAt(campaign, corps) {
    return campaign.corps.filter((other) => !other.destroyed && other.team !== corps.team && other.nodeId === corps.nodeId);
  }
  const enemiesAt = corpsAt;
  // Test mode deliberately removes the AI's cross-lane choices. All red corps
  // deploy at the central objective and use this authored corridor, so a combat
  // test cannot be ended by an accidental side-lane breakthrough.
  function centerlinePath(map) {
    const middle = map.nodes.filter((node) => node.lane === 1).sort((a, b) => b.column - a.column);
    if (!middle.length) return null;
    return { deploymentId: middle[0].id, path: [...middle.slice(1).map((node) => node.id), 'blue-hq'] };
  }
  function startCampaign(campaign) {
    if (campaign.started) return false;
    campaign.started = true;
    let advancing = 0;
    const centerline = campaign.enemyMode === 'centerline-test' ? centerlinePath(campaign.map) : null;
    for (const corps of campaign.corps.filter((item) => item.team === 'red' && !item.destroyed)) {
      if (centerline) corps.nodeId = centerline.deploymentId;
      const path = centerline ? [corps.nodeId, ...centerline.path] : shortestPath(campaign.map, corps.nodeId, 'blue-hq');
      if (path && path.length > 1) { corps.path = path.slice(1); corps.destinationId = 'blue-hq'; corps.status = '向蓝方司令部推进'; advancing++; }
      else corps.status = '等待命令';
    }
    campaign.log = centerline
      ? `测试战役开始：敌军 ${advancing} 支兵团已在中央线集结，将沿中路直进。`
      : `战役开始：敌军 ${advancing} 支兵团正向蓝方司令部推进。`;
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
    const battle = { id: `battle-${campaign.nextEngagementId++}`, nodeId, active: true, elapsed: 0, blueIds: engagedIds(campaign, nodeId, 'blue'), redIds: engagedIds(campaign, nodeId, 'red'), visualEvents: [] };
    campaign.engagements.push(battle);
    for (const corps of campaign.corps.filter((item) => battle.blueIds.includes(item.id) || battle.redIds.includes(item.id))) { corps.engagementId = battle.id; corps.pendingEncounter = false; corps.path = []; corps.destinationId = null; corps.status = '节点战斗中'; }
    return battle;
  }
  function availableByTeam(campaign, battle, team) {
    const ids = team === 'blue' ? battle.blueIds : battle.redIds;
    return ids.map((id) => campaign.corps.find((corps) => corps.id === id)).filter((corps) => corps && !corps.destroyed && corps.nodeId === battle.nodeId);
  }
  function destroyIfEmpty(corps) { if (!activeUnits(corps).length) corps.destroyed = true; }
  function canTarget(attacker, target) {
    if (attacker.type === 'medic') return false;
    if (target.type === 'heli') return attacker.type === 'aa';
    return attacker.type !== 'aa';
  }
  function damageAgainst(attacker, target) {
    const spec = UNITS[attacker.type];
    if (!canTarget(attacker, target)) return 0;
    if (target.type === 'heli') return spec.antiAir || 0;
    if (target.type === 'tank') return spec.antiArmor || (spec.damage * 0.3);
    return spec.damage;
  }
  function exposedTargets(attacker, defenders) {
    const candidates = defenders.flatMap((corps) => activeUnits(corps).map((unit) => ({ corps, unit, damage: damageAgainst(attacker, unit) })))
      .filter((item) => item.damage > 0);
    if (!candidates.length) return [];
    if (attacker.type === 'aa') return candidates;
    const ground = candidates.filter((item) => formationRow(item.unit) !== 'air');
    if (!ground.length) return [];
    // Ground formations screen their own support and rear units. Helicopters
    // can look over that screen to hunt armor, but otherwise hit the front.
    if (attacker.type === 'heli') {
      const armored = ground.filter((item) => item.unit.type === 'tank');
      return armored.length ? armored : ground;
    }
    const closestRank = Math.min(...ground.map((item) => FORMATION_ROWS[formationRow(item.unit)].rank));
    return ground.filter((item) => FORMATION_ROWS[formationRow(item.unit)].rank === closestRank);
  }
  function unitCorps(campaign, battle, team) {
    // Reserves remain at the node but do not enter the formation until front
    // capacity opens; they therefore cannot deal or receive battle damage.
    return availableByTeam(campaign, battle, team).slice(0, nodeCapacity(campaign, battle.nodeId));
  }
  function terrainDamageFactor(campaign, battle, attacker, defender) {
    const effects = nodeDefinition(campaign, battle.nodeId).effects;
    const defenderControlsNode = campaign.nodeControl[battle.nodeId] === defender.team;
    let factor = 1;
    if (defenderControlsNode && effects.includes('cover')) factor *= 0.86;
    if (defenderControlsNode && effects.includes('defend')) factor *= 0.76;
    if (campaign.nodeControl[battle.nodeId] === attacker.team && effects.includes('fireAdvantage')) factor *= 1.15;
    return factor;
  }
  function fireAtTarget(campaign, battle, attackerCorps, attacker, defenders) {
    const candidates = exposedTargets(attacker, defenders)
      .sort((a, b) => b.damage - a.damage || (a.unit.hp / a.unit.maxHp) - (b.unit.hp / b.unit.maxHp) || a.unit.id.localeCompare(b.unit.id));
    if (!candidates.length) return null;
    const target = candidates[0];
    const moraleFactor = 0.55 + clamp(attackerCorps.morale, 0, 100) / 200;
    const damage = target.damage * moraleFactor * terrainDamageFactor(campaign, battle, attackerCorps, target.corps) * BATTLE_DAMAGE_SCALE;
    target.unit.hp = Math.max(0, target.unit.hp - damage);
    target.corps.morale = Math.max(0, target.corps.morale - (damage / target.unit.maxHp) * 10);
    if (target.unit.hp === 0) target.unit.destroyed = true;
    destroyIfEmpty(target.corps);
    return { kind: 'attack', attackerId: attacker.id, targetId: target.unit.id, power: damage };
  }
  function healFriendly(medicCorps, medic, friendlies) {
    // Medical units intentionally ignore formation rows: they represent a
    // corps-level casualty response rather than a ranged attack through ranks.
    const target = friendlies.flatMap((corps) => activeUnits(corps).filter((unit) => unit.id !== medic.id && unit.hp < unit.maxHp).map((unit) => ({ corps, unit })))
      .sort((a, b) => (a.unit.hp / a.unit.maxHp) - (b.unit.hp / b.unit.maxHp) || a.unit.id.localeCompare(b.unit.id))[0];
    if (!target) return null;
    target.unit.hp = Math.min(target.unit.maxHp, target.unit.hp + UNITS.medic.heal);
    return { kind: 'heal', attackerId: medic.id, targetId: target.unit.id, power: UNITS.medic.heal };
  }
  function advanceFront(campaign, battle, team, events) {
    const friends = unitCorps(campaign, battle, team), enemies = unitCorps(campaign, battle, team === 'blue' ? 'red' : 'blue');
    for (const corps of friends) for (const unit of activeUnits(corps)) unit.cooldown -= battle.step;
    for (const corps of friends) for (const unit of activeUnits(corps)) {
      if (unit.cooldown > 0) continue;
      const event = unit.type === 'medic' ? healFriendly(corps, unit, friends) : fireAtTarget(campaign, battle, corps, unit, enemies);
      unit.cooldown += UNITS[unit.type].cooldown * BATTLE_COOLDOWN_SCALE;
      if (event) events.push(event);
    }
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
        if (target) { corps.nodeId = target; corps.morale = Math.max(0, corps.morale - 25); removeFromBattle(campaign, corps); corps.status = '战斗失利，已撤退'; }
        else { corps.destroyed = true; removeFromBattle(campaign, corps); }
      }
    }
    campaign.log = `${campaign.map.nodes.find((node) => node.id === battle.nodeId).name}：${winner === 'blue' ? '蓝方' : '红方'}获胜；败方撤退或溃散。请指定兵团驻防以占领节点。`;
  }
  function advanceBattles(campaign, dt) {
    for (const battle of campaign.engagements.filter((item) => item.active)) {
      battle.elapsed += dt;
      const blue = availableByTeam(campaign, battle, 'blue'), red = availableByTeam(campaign, battle, 'red');
      for (const corps of [...blue, ...red]) destroyIfEmpty(corps);
      const livingBlue = blue.filter((corps) => !corps.destroyed), livingRed = red.filter((corps) => !corps.destroyed);
      if (!livingBlue.length || !livingRed.length) { finishBattle(campaign, battle, livingBlue.length ? 'blue' : 'red'); continue; }
      // Capacity applies per side: extra corps are reserves, not free damage.
      // Chokepoints can therefore let a smaller defender resist a larger force.
      const capacity = nodeCapacity(campaign, battle.nodeId), blueFront = livingBlue.slice(0, capacity), redFront = livingRed.slice(0, capacity);
      battle.step = dt;
      const events = [];
      advanceFront(campaign, battle, 'blue', events);
      advanceFront(campaign, battle, 'red', events);
      // Rule events are retained briefly as render data. The UI never derives
      // combat outcomes itself, so effects and health always agree.
      battle.visualEvents = [
        ...battle.visualEvents.filter((event) => event.until > battle.elapsed),
        ...events.map((event) => ({ ...event, until: battle.elapsed + BATTLE_EFFECT_DURATION })),
      ].slice(-30);
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
    // Passing a hostile node is a tactical decision, not a logistics tax.
    if (choice === 'pass' && corps.path.length) { for (const unit of activeUnits(corps)) unit.hp *= 0.90; corps.morale = Math.max(0, corps.morale - 12); corps.pendingEncounter = false; corps.status = '强行通过战区'; campaign.log = `${corps.label} 强行通过${place}，承受 10% 兵力与 12 士气损失。`; return { ok: true }; }
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
    const moraleGain = effects.includes('recover') || effects.includes('repair') ? 12 : effects.includes('control') ? 6 : 3;
    corps.morale = Math.min(100, corps.morale + moraleGain);
    campaign.log = `${corps.label} 驻防${campaign.map.nodes.find((node) => node.id === corps.nodeId).name}，节点已归蓝方控制（士气 +${moraleGain}）。`;
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
  return { MAX_CORPS_SLOTS, UNIT_TYPES, UNITS, DEFAULTS, BATTLE_DAMAGE_SCALE, BATTLE_COOLDOWN_SCALE, FORMATION_ROWS, normalizeRoster, rosterSize, sizeSpeedFactor, corpsStats, corpsSpeed,
    shortestPath, shortestPathAvoiding, reachableNodeIds, centerlinePath, createCampaign, startCampaign, orderMove, advance, unitPosition, enemiesAt, corpsAt, activeUnits,
    formationRow, encounterOptions, resolveEncounter, setGarrison, orderRetreat, battleAt, nodeCapacity };
});
