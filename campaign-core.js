/* Pure campaign rules. Coordinates and DOM are deliberately absent. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.CampaignCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const UNIT_TYPES = [
    'assault',
    'mg',
    'grenadier',
    'tank',
    'at',
    'heli',
    'aa',
    'medic',
  ];

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

  const DEFAULTS = [
    { assault: 3, mg: 1, grenadier: 1, tank: 0, at: 0, heli: 0, aa: 0, medic: 1 },
    { assault: 2, mg: 1, grenadier: 1, tank: 1, at: 0, heli: 0, aa: 0, medic: 1 },
    { assault: 3, mg: 0, grenadier: 1, tank: 0, at: 1, heli: 0, aa: 0, medic: 1 },
  ];

  const normalizeRoster = (roster) =>
    Object.fromEntries(
      UNIT_TYPES.map((type) => [
        type,
        Math.max(0, Math.min(10, Number(roster[type]) || 0)),
      ]),
    );

  const rosterSize = (roster) =>
    Object.values(normalizeRoster(roster)).reduce(
      (total, count) => total + count,
      0,
    );

  function outgoingEdges(map, nodeId) {
    return map.edges.filter(
      (edge) => edge.from === nodeId || (!edge.directed && edge.to === nodeId),
    );
  }

  function nextNode(edge, nodeId) {
    return edge.from === nodeId ? edge.to : edge.from;
  }

  function shortestPath(map, from, to) {
    if (from === to) return [from];

    const queue = [from];
    const previous = new Map([[from, null]]);

    while (queue.length) {
      const current = queue.shift();
      for (const edge of outgoingEdges(map, current)) {
        const next = nextNode(edge, current);
        if (previous.has(next)) continue;

        previous.set(next, current);
        if (next === to) {
          const path = [to];
          while (previous.get(path[0]) !== null) {
            path.unshift(previous.get(path[0]));
          }
          return path;
        }
        queue.push(next);
      }
    }

    return null;
  }

  function reachableNodeIds(map, from) {
    const visited = new Set([from]);
    const queue = [from];

    while (queue.length) {
      const current = queue.shift();
      for (const edge of outgoingEdges(map, current)) {
        const next = nextNode(edge, current);
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    return visited;
  }

  function makeUnit(id, team, type, nodeId) {
    const spec = UNITS[type];
    return {
      id,
      team,
      type,
      label: spec.label,
      hp: spec.hp,
      maxHp: spec.hp,
      nodeId,
      path: [],
      destinationId: null,
      passingBattleNodeId: null,
      segmentProgress: 0,
      cooldown: 0,
      status: '驻守',
      destroyed: false,
      engagementId: null,
    };
  }

  function expandRoster(team, roster, startNodeId, prefix) {
    const result = [];
    let index = 1;
    const normalized = normalizeRoster(roster);

    for (const type of UNIT_TYPES) {
      for (let n = 0; n < normalized[type]; n++) {
        result.push(makeUnit(`${prefix}-${type}-${index++}`, team, type, startNodeId));
      }
    }

    return result;
  }

  function createCampaign(map, playerRosters) {
    const units = playerRosters.flatMap((roster, index) =>
      expandRoster('blue', roster, 'blue-hq', `blue-${index + 1}`),
    );
    const guards = [
      { assault: 2, mg: 1, medic: 1 },
      { assault: 2, tank: 1, at: 1 },
      { assault: 2, grenadier: 1, aa: 1 },
    ];

    map.nodes
      .filter((node) => node.team === 'red' && node.type === 'objective')
      .forEach((node, index) => {
        units.push(
          ...expandRoster(
            'red',
            guards[index % guards.length],
            node.id,
            `red-${node.id}`,
          ),
        );
      });

    return {
      map,
      units,
      elapsed: 0,
      started: false,
      log: '部署单位并下达出击命令后，点击“开始战役”。',
      winner: null,
      nodeControl: Object.fromEntries(map.nodes.map((node) => [node.id, node.team])),
      battleEvents: [],
    };
  }

  function startCampaign(campaign) {
    if (campaign.started) return false;
    campaign.started = true;
    let advancing = 0;

    for (const unit of campaign.units.filter(
      (item) => item.team === 'red' && !item.destroyed,
    )) {
      const path = shortestPath(campaign.map, unit.nodeId, 'blue-hq');
      if (path && path.length > 1) {
        unit.path = path.slice(1);
        unit.destinationId = 'blue-hq';
        unit.status = '向蓝方司令部推进';
        advancing++;
      } else {
        unit.status = '等待命令';
      }
    }

    campaign.log = `战役开始：敌军 ${advancing} 个单位正向蓝方司令部推进。`;
    return true;
  }

  function battleNodeId(unit) {
    return unit.engagementId && unit.engagementId.startsWith('battle:')
      ? unit.engagementId.slice('battle:'.length)
      : null;
  }

  function enemiesAt(campaign, unit) {
    return campaign.units.filter(
      (other) =>
        !other.destroyed &&
        other.team !== unit.team &&
        (other.nodeId === unit.nodeId ||
          (unit.engagementId && other.engagementId === unit.engagementId)),
    );
  }

  function alliesAt(campaign, unit) {
    return campaign.units.filter(
      (other) =>
        !other.destroyed &&
        other.team === unit.team &&
        (other.nodeId === unit.nodeId ||
          (unit.engagementId && other.engagementId === unit.engagementId)) &&
        other !== unit,
    );
  }

  function orderMove(campaign, unitId, destinationId) {
    const unit = campaign.units.find(
      (item) => item.id === unitId && item.team === 'blue' && !item.destroyed,
    );
    if (!unit) return { ok: false, reason: '请选择一个仍可行动的蓝方单位。' };
    if (enemiesAt(campaign, unit).length) {
      return { ok: false, reason: '单位正在交战，不能改令。' };
    }

    const path = shortestPath(campaign.map, unit.nodeId, destinationId);
    if (!path) return { ok: false, reason: '该节点在当前通行方向下不可达。' };
    if (path.length === 1) return { ok: false, reason: '单位已在该节点。' };

    unit.path = path.slice(1);
    unit.destinationId = destinationId;
    unit.segmentProgress = 0;
    unit.status = `出击至 ${campaign.map.nodes.find((node) => node.id === destinationId).name}`;
    campaign.log = `${unit.label} 已出击（${path.length - 1} 段通路）。`;
    return { ok: true, path };
  }

  function damage(source, target) {
    const spec = UNITS[source.type];
    if (source.type === 'medic') return 0;
    if (target.type === 'heli' && !spec.antiAir) return 0;
    if (source.type === 'aa') return target.type === 'heli' ? spec.antiAir : 0;
    if (target.type === 'tank') {
      return spec.antiArmor ||
        (source.type === 'grenadier' ? spec.damage * 0.35 : spec.damage * 0.18);
    }
    return spec.damage;
  }

  function recordBattleEvent(campaign, source, target, amount, kind) {
    const nodeId = battleNodeId(source);
    if (!nodeId) return;
    campaign.battleEvents.unshift({
      time: campaign.elapsed,
      nodeId,
      source: source.label,
      target: target.label,
      amount: Math.round(amount),
      kind,
    });
    campaign.battleEvents.length = Math.min(campaign.battleEvents.length, 80);
  }

  function beginNodeBattle(campaign, nodeId) {
    const participants = campaign.units.filter(
      (unit) => !unit.destroyed && unit.nodeId === nodeId,
    );
    if (new Set(participants.map((unit) => unit.team)).size < 2) return false;

    const id = `battle:${nodeId}`;
    for (const unit of participants) {
      unit.engagementId = id;
      unit.path = [];
      unit.segmentProgress = 0;
      unit.status = '节点战斗中';
    }
    campaign.log = `${campaign.map.nodes.find((node) => node.id === nodeId).name} 爆发战斗。`;
    return true;
  }

  function nodeHasBattle(campaign, nodeId) {
    return campaign.units.some(
      (unit) => !unit.destroyed && battleNodeId(unit) === nodeId,
    );
  }

  function resolveNodeCombat(campaign, unit, dt) {
    const enemies = unit.engagementId
      ? campaign.units.filter(
          (other) => !other.destroyed && other.team !== unit.team && other.engagementId === unit.engagementId,
        )
      : enemiesAt(campaign, unit);
    if (!enemies.length) return;

    unit.status = '交战中';
    unit.cooldown -= dt;
    const spec = UNITS[unit.type];

    if (unit.type === 'medic') {
      const wounded = (unit.engagementId
        ? campaign.units.filter((ally) => !ally.destroyed && ally.team === unit.team && ally.engagementId === unit.engagementId && ally !== unit)
        : alliesAt(campaign, unit))
        .filter((ally) => ally.hp < ally.maxHp)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (wounded && unit.cooldown <= 0) {
        wounded.hp = Math.min(wounded.maxHp, wounded.hp + spec.heal);
        recordBattleEvent(campaign, unit, wounded, spec.heal, 'heal');
        unit.cooldown = spec.cooldown;
      }
      return;
    }

    const target = enemies.sort((a, b) => damage(unit, b) - damage(unit, a))[0];
    if (target && unit.cooldown <= 0) {
      const hit = damage(unit, target);
      if (hit) {
        target.hp -= hit;
        recordBattleEvent(campaign, unit, target, hit, 'damage');
      }
      unit.cooldown = spec.cooldown;
      if (target.hp <= 0) {
        target.hp = 0;
        target.destroyed = true;
        target.path = [];
        target.destinationId = null;
        target.status = '已被击毁';
        campaign.log = `${unit.label} 击毁了敌方${target.label}。`;
      }
    }
  }

  function advance(campaign, dt) {
    if (!campaign.started || campaign.winner) return;
    campaign.elapsed += dt;
    for (const unit of campaign.units.filter(
      (item) =>
        !item.destroyed &&
        !item.engagementId &&
        item.path.length &&
        (!enemiesAt(campaign, item).length || item.passingBattleNodeId === item.nodeId),
    )) {
      const crossingBattle = nodeHasBattle(campaign, unit.path[0]) && unit.path.length > 1;
      unit.segmentProgress += dt * UNITS[unit.type].speed * (crossingBattle ? 0.35 : 1);
      unit.status = crossingBattle ? '穿越战区（减速）' : '行军至下一节点';
    }

    for (const unit of campaign.units.filter((item) => !item.destroyed && !item.engagementId && item.path.length)) {
      if (unit.segmentProgress < 1) continue;
      unit.nodeId = unit.path.shift();
      unit.segmentProgress = 0;
      if (nodeHasBattle(campaign, unit.nodeId) && unit.path.length) {
        const loss = Math.max(1, Math.round(unit.maxHp * 0.1));
        unit.hp = Math.max(1, unit.hp - loss);
        unit.passingBattleNodeId = unit.nodeId;
        unit.status = '已穿越战区';
        campaign.log = `${unit.label} 穿越战斗中的节点，行军受阻并损失 ${loss} HP。`;
      } else if (beginNodeBattle(campaign, unit.nodeId)) {
        // The arriving unit and the units already occupying this point now fight.
      } else {
        unit.passingBattleNodeId = null;
        campaign.nodeControl[unit.nodeId] = unit.team;
        unit.status = unit.path.length ? '抵达节点，继续行军' : '驻守';
      }
    }

    for (const unit of campaign.units.filter((item) => !item.destroyed)) {
      resolveNodeCombat(campaign, unit, dt);
    }

    for (const id of new Set(
      campaign.units.map((unit) => unit.engagementId).filter(Boolean),
    )) {
      const participants = campaign.units.filter(
        (unit) => !unit.destroyed && unit.engagementId === id,
      );
      if (new Set(participants.map((unit) => unit.team)).size < 2) {
        for (const unit of participants) {
          unit.engagementId = null;
          campaign.nodeControl[unit.nodeId] = unit.team;
          unit.status = unit.path.length ? '行军至下一节点' : '驻守';
        }
      }
    }

    const objectives = campaign.map.nodes.filter(
      (node) => node.team === 'red' && node.type === 'objective',
    );
    if (
      objectives.some((objective) =>
        campaign.units.some(
          (unit) =>
            unit.team === 'blue' &&
            !unit.destroyed &&
            unit.nodeId === objective.id &&
            !enemiesAt(campaign, unit).length,
        ),
      )
    ) {
      campaign.winner = 'blue';
      campaign.log = '战役目标已被夺取。';
    }
    if (
      campaign.units.some(
        (unit) =>
          unit.team === 'red' &&
          !unit.destroyed &&
          unit.nodeId === 'blue-hq' &&
          !enemiesAt(campaign, unit).length,
      )
    ) {
      campaign.winner = 'red';
      campaign.log = '敌军已进入蓝方司令部，战役失败。';
    }
    if (!campaign.units.some((unit) => unit.team === 'blue' && !unit.destroyed)) {
      campaign.winner = 'red';
      campaign.log = '所有蓝方单位均已损失，战役失败。';
    }
  }

  function unitPosition(campaign, unit) {
    const current = campaign.map.nodes.find((node) => node.id === unit.nodeId);
    if (battleNodeId(unit)) return { x: current.x, y: current.y };
    // Movement is resolved over time, but represented as an order progressing
    // between discrete map points. The marker jumps only after arrival.
    return { x: current.x, y: current.y };
  }

  return {
    UNIT_TYPES,
    UNITS,
    DEFAULTS,
    normalizeRoster,
    rosterSize,
    shortestPath,
    reachableNodeIds,
    createCampaign,
    startCampaign,
    orderMove,
    advance,
    unitPosition,
    enemiesAt,
    battleNodeId,
    nodeHasBattle,
  };
});
