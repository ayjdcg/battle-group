/*
 * 战役地图生成器
 *
 * 无依赖、确定性：同一 seed 和配置永远生成同一张地图。
 * 浏览器：window.CampaignMapGenerator.generateMap(config)
 * Node：require('./map-generator.js').generateMap(config)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CampaignMapGenerator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NODE_TYPES = {
    headquarters: { label: '战区司令部', role: 'base', capacity: 2, effects: ['reinforce', 'command'] },
    deployment: { label: '展开地域', role: 'base', capacity: 2, effects: ['deploy', 'reorganize'] },
    town: { label: '城镇', role: 'objective', capacity: 2, effects: ['control', 'cover'] },
    urban: { label: '城区', role: 'objective', capacity: 2, effects: ['control', 'cover', 'slowArmor'] },
    industrial: { label: '工业区', role: 'objective', capacity: 2, effects: ['control', 'repair', 'cover'] },
    highland: { label: '高地', role: 'terrain', capacity: 1, effects: ['observe', 'fireAdvantage'] },
    woodland: { label: '林地', role: 'terrain', capacity: 1, effects: ['conceal', 'slowVehicles'] },
    lowland: { label: '低地', role: 'terrain', capacity: 1, effects: ['conceal', 'slowMovement'] },
    marsh: { label: '湿地', role: 'terrain', capacity: 1, effects: ['slowVehicles', 'exhaustion'] },
    chokepoint: { label: '隘口', role: 'terrain', capacity: 1, effects: ['narrowFront', 'defend'] },
    crossroads: { label: '交通枢纽', role: 'junction', capacity: 2, effects: ['routeChoice', 'control'] },
    railHub: { label: '铁路枢纽', role: 'junction', capacity: 2, effects: ['rapidReinforce', 'supply'] },
    bridgehead: { label: '桥头', role: 'crossing', capacity: 1, effects: ['riverCrossing', 'defend'] },
    riverCrossing: { label: '渡口', role: 'crossing', capacity: 1, effects: ['riverCrossing', 'slowCrossing'] },
    supply: { label: '补给站', role: 'support', capacity: 1, effects: ['resupply', 'repair'] },
    fieldHospital: { label: '野战医院', role: 'support', capacity: 1, effects: ['recover', 'evacuate'] },
    airfield: { label: '前线机场', role: 'support', capacity: 1, effects: ['airSupport', 'rearm'] },
    commandPost: { label: '前沿指挥所', role: 'support', capacity: 1, effects: ['command', 'recon'] },
    observationPost: { label: '观测哨', role: 'support', capacity: 1, effects: ['observe', 'artillerySpot'] },
    fortification: { label: '永备工事', role: 'defense', capacity: 2, effects: ['defend', 'cover', 'narrowFront'] },
    objective: { label: '战役目标', role: 'victory', capacity: 2, effects: ['victory', 'control'] }
  };

  const EDGE_TYPES = {
    road: { label: '道路', moveCost: 1, capacity: 2 },
    highway: { label: '高速路', moveCost: 0.7, capacity: 2 },
    trail: { label: '土路', moveCost: 1.45, capacity: 1 },
    bridge: { label: '桥梁', moveCost: 1.2, capacity: 1 },
    ford: { label: '渡河', moveCost: 1.8, capacity: 1 },
    pass: { label: '山口', moveCost: 1.55, capacity: 1 },
    oneWay: { label: '单向通道', moveCost: 0.9, capacity: 1 }
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const hashSeed = seed => {
    let h = 2166136261;
    for (const char of String(seed)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const random = seed => {
    let state = hashSeed(seed) || 1;
    return () => ((state = (state + 0x6D2B79F5) | 0), (state = Math.imul(state ^ state >>> 15, 1 | state)) ^ state + Math.imul(state ^ state >>> 7, 61 | state), ((state ^ state >>> 14) >>> 0) / 4294967296);
  };
  const pick = (rng, values) => values[Math.floor(rng() * values.length)];

  /** A map has three irregular fronts; its graph, not screen adjacency, defines movement. */
  function generateMap(options = {}) {
    const playerCorps = clamp(Number(options.playerCorps) || 6, 4, 8);
    const seed = options.seed == null ? `campaign-${Date.now()}` : String(options.seed);
    const rng = random(seed);
    const width = options.width || 1180, height = options.height || 700;
    // About 3.5 nodes per corps plus the two command areas.  Three front lines
    // require a multiple of three field nodes, so the public count is always exact.
    const requestedCount = Number(options.nodeCount) || (playerCorps * 3.5 + 2);
    // 20 is the smallest possible layout: two HQs plus 3 lanes × 6 columns.
    const targetNodeCount = clamp(2 + Math.ceil((requestedCount - 2) / 3) * 3, 20, 32);
    const laneCount = 3;
    const columns = Math.max(5, (targetNodeCount - 2) / laneCount);
    const nodes = [], edges = [], nodeByKey = new Map();
    const addNode = (node) => { nodes.push(node); nodeByKey.set(node.id, node); return node; };
    const addEdge = (from, to, type = 'road', extra = {}) => {
      if (edges.some(edge => edge.from === from && edge.to === to)) return;
      edges.push({ id: `e-${edges.length + 1}`, from, to, type, directed: false, ...extra });
    };

    addNode({ id: 'blue-hq', team: 'blue', type: 'headquarters', x: 74, y: height / 2, lane: null, column: -1, name: '蓝方司令部' });
    addNode({ id: 'red-hq', team: 'red', type: 'headquarters', x: width - 74, y: height / 2, lane: null, column: columns, name: '红方司令部' });
    const laneNames = ['北线', '中央线', '南线'];
    const laneY = lane => height * (.20 + lane * .30);
    const typeFor = (lane, column) => {
      if (column === 0) return 'deployment';
      if (column === columns - 1) return 'objective';
      // These are guaranteed anchors; random variation fills the rest.
      if (lane === 0 && column === 1) return 'highland';
      if (lane === 2 && column === 1) return 'lowland';
      if (column === Math.floor(columns / 2)) {
        if (lane === 0) return 'bridgehead';
        if (lane === 1) return 'crossroads';
        return 'riverCrossing';
      }
      // Near the enemy, defense and command locations make the last push different
      // from simply moving through another town.
      if (column === columns - 2) return lane === 0 ? 'observationPost' : lane === 1 ? 'fortification' : 'commandPost';
      const choices = lane === 0
        ? ['highland', 'woodland', 'town', 'chokepoint', 'supply', 'observationPost']
        : lane === 1 ? ['town', 'urban', 'industrial', 'lowland', 'crossroads', 'railHub', 'fieldHospital']
        : ['lowland', 'marsh', 'town', 'supply', 'airfield', 'highland'];
      return pick(rng, choices);
    };

    for (let column = 0; column < columns; column++) {
      for (let lane = 0; lane < laneCount; lane++) {
        const id = `n-${lane}-${column}`;
        const x = 156 + column * ((width - 312) / Math.max(1, columns - 1)) + (rng() - .5) * 25;
        const y = laneY(lane) + (rng() - .5) * 52;
        const type = typeFor(lane, column);
        addNode({ id, team: column === 0 ? 'blue' : column === columns - 1 ? 'red' : 'neutral', type, x, y, lane, column, name: `${laneNames[lane]}${NODE_TYPES[type].label}` });
      }
    }

    for (let lane = 0; lane < laneCount; lane++) {
      addEdge('blue-hq', `n-${lane}-0`, lane === 1 ? 'highway' : 'road');
      addEdge(`n-${lane}-${columns - 1}`, 'red-hq', lane === 1 ? 'highway' : 'road');
      for (let column = 0; column < columns - 1; column++) {
        let type = 'road';
        if (column === Math.floor(columns / 2) - 1 && lane !== 1) type = lane === 0 ? 'pass' : 'ford';
        else if (rng() < .18) type = 'trail';
        addEdge(`n-${lane}-${column}`, `n-${lane}-${column + 1}`, type);
      }
    }

    // Two to four staggered lateral links create flanking choices, never a mesh.
    const lateralColumns = new Set([1, Math.floor(columns / 2), columns - 2]);
    if (columns > 7) lateralColumns.add(2 + Math.floor(rng() * (columns - 4)));
    for (const column of lateralColumns) {
      const lane = column % 2;
      const other = lane + 1;
      const type = column === Math.floor(columns / 2) ? 'bridge' : 'trail';
      addEdge(`n-${lane}-${column}`, `n-${other}-${column}`, type);
    }
    // One marked directional shortcut rewards reading the map without breaking retreat paths.
    const shortcutColumn = clamp(Math.floor(columns * .62), 2, columns - 2);
    addEdge(`n-0-${shortcutColumn - 1}`, `n-1-${shortcutColumn + 1}`, 'oneWay', { directed: true, direction: 'blueToRed' });

    const map = { version: 1, seed, playerCorps, targetNodeCount, width, height, nodes, edges, definitions: { nodes: NODE_TYPES, edges: EDGE_TYPES } };
    map.validation = validateMap(map);
    if (!map.validation.valid) throw new Error(`生成地图未通过校验：${map.validation.errors.join('；')}`);
    return map;
  }

  function neighbors(map, nodeId, allowDirectedReverse = false) {
    const result = [];
    for (const edge of map.edges) {
      if (edge.from === nodeId) result.push(edge.to);
      else if (edge.to === nodeId && (!edge.directed || allowDirectedReverse)) result.push(edge.from);
    }
    return result;
  }

  function hasPath(map, start, goal) {
    const visited = new Set([start]), queue = [start];
    while (queue.length) {
      const current = queue.shift();
      if (current === goal) return true;
      for (const next of neighbors(map, current)) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    return false;
  }

  function validateMap(map) {
    const errors = [];
    if (map.playerCorps < 4 || map.playerCorps > 8) errors.push('可控兵团数必须在 4–8 之间');
    if (map.nodes.length < 20 || map.nodes.length > 32) errors.push('节点总数必须在 20–32 之间');
    if (!map.nodes.some(node => node.id === 'blue-hq') || !map.nodes.some(node => node.id === 'red-hq')) errors.push('缺少司令部');
    if (!hasPath(map, 'blue-hq', 'red-hq')) errors.push('蓝方无法到达红方司令部');
    for (const edge of map.edges) if (!map.nodes.some(n => n.id === edge.from) || !map.nodes.some(n => n.id === edge.to)) errors.push(`边 ${edge.id} 指向不存在的节点`);
    const types = new Set(map.nodes.map(node => node.type));
    if (!types.has('highland') || !types.has('lowland') || !types.has('crossroads') || !types.has('bridgehead') || !types.has('riverCrossing')) errors.push('缺少必要的地形或枢纽节点');
    if (!map.edges.some(edge => edge.type === 'bridge') || !map.edges.some(edge => edge.type === 'ford') || !map.edges.some(edge => edge.type === 'pass')) errors.push('缺少必要的地形通道');
    if (!map.edges.some(edge => edge.directed)) errors.push('缺少单向通道');
    return { valid: errors.length === 0, errors };
  }

  return { NODE_TYPES, EDGE_TYPES, generateMap, validateMap, neighbors, hasPath };
});
