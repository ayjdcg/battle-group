/* Rendering and DOM input only. Campaign rules remain in campaign-core.js. */
(() => {
  'use strict';
  const { DEFAULTS, MAX_CORPS_SLOTS, UNIT_TYPES, UNITS, normalizeRoster, rosterSize, createCampaign, startCampaign, orderMove, advance, unitPosition, reachableNodeIds, corpsStats, corpsSpeed, enemiesAt, encounterOptions, resolveEncounter, setGarrison, orderRetreat, battleAt, nodeCapacity, activeUnits, formationRow, FORMATION_ROWS } = CampaignCore;
  const canvas = document.querySelector('#map');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.querySelector(id);
  let campaign, selectedCorpsId = null, selectedNodeId = null, last = 0;
  let draftRosters = DEFAULTS.map((roster) => ({ ...roster }));
  let plannedDestinations = [];
  const colors = { blue: '#66c9ee', red: '#f17b76', neutral: '#d9c87f' };
  const symbols = { headquarters: '◆', deployment: '●', town: '■', urban: '▦', industrial: '▤', highland: '▲', woodland: '♣', lowland: '▽', marsh: '≈', crossroads: '✦', railHub: '⊞', supply: '✚', fieldHospital: '✛', airfield: '✈', commandPost: '⚑', observationPost: '◉', fortification: '▰', bridgehead: '⌁', riverCrossing: '≋', chokepoint: '◈', objective: '★' };
  const unitSymbols = { assault: '●', mg: '▰', grenadier: '◆', tank: '▣', at: '△', heli: '✦', aa: '⊕', medic: '✚' };
  const node = (id) => campaign.map.nodes.find((item) => item.id === id);
  const selectedCorps = () => campaign.corps.find((item) => item.id === selectedCorpsId);
  const percent = (value) => Math.round(value);

  function visualPosition(corps) {
    const position = unitPosition(campaign, corps);
    const peers = campaign.corps.filter((item) => !item.destroyed && item.nodeId === corps.nodeId);
    const index = peers.findIndex((item) => item.id === corps.id);
    return { x: position.x + ((index % 3) - 1) * 18, y: position.y - 28 - Math.floor(index / 3) * 16 };
  }
  function rosterText(corps) {
    return corps.slots.map((unit) => unit ? unit.label : '空').join(' · ');
  }
  function generate() {
    const playerCorps = Math.max(4, Math.min(8, Number(el('#corps').value) || 6));
    el('#corps').value = playerCorps;
    plannedDestinations = [];
    campaign = createCampaign(CampaignMapGenerator.generateMap({ seed: el('#seed').value || 'frontier-01', playerCorps }), draftRosters);
    el('#start').disabled = false;
    selectedCorpsId = campaign.corps.find((corps) => corps.team === 'blue').id;
    selectedNodeId = null; last = 0;
    renderCorps(); renderTestSetup(); updatePanel(); draw();
  }
  function rebuildForSetup() {
    if (campaign && campaign.started) return;
    const map = campaign ? campaign.map : CampaignMapGenerator.generateMap({ seed: el('#seed').value || 'frontier-01', playerCorps: Math.max(4, Math.min(8, Number(el('#corps').value) || 6)) });
    campaign = createCampaign(map, draftRosters);
    selectedCorpsId = campaign.corps.find((corps) => corps.team === 'blue').id;
    plannedDestinations = plannedDestinations.slice(0, draftRosters.length);
    plannedDestinations.forEach((destinationId, index) => { if (destinationId) orderMove(campaign, `blue-corps-${index + 1}`, destinationId); });
    renderCorps(); renderTestSetup(); updatePanel(); draw();
  }
  function renderTestSetup() {
    const locked = campaign.started ? 'disabled' : '';
    const targetOptions = campaign.map.nodes.filter((item) => item.id !== 'blue-hq')
      .map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
    el('#test-setup').innerHTML = draftRosters.map((roster, index) => {
      const normalized = normalizeRoster(roster), count = rosterSize(normalized);
      const rows = UNIT_TYPES.map((type) => `<label class="unit-step"><span>${UNITS[type].label}</span><button type="button" data-roster="${index}" data-type="${type}" data-delta="-1" aria-label="减少${UNITS[type].label}" ${locked}>−</button><b>${normalized[type]}</b><button type="button" data-roster="${index}" data-type="${type}" data-delta="1" aria-label="增加${UNITS[type].label}" ${locked}>+</button></label>`).join('');
      return `<section class="setup-corps"><div><strong>第${index + 1}兵团 · ${count}/${MAX_CORPS_SLOTS} 槽</strong>${draftRosters.length > 1 ? `<button class="remove-corps" type="button" data-remove="${index}" ${locked}>移除</button>` : ''}</div><div class="unit-steps">${rows}</div><label class="route-plan">开战前目标 <select data-destination="${index}" ${locked}><option value="">不预设路线</option>${targetOptions}</select></label></section>`;
    }).join('');
    draftRosters.forEach((_, index) => { const select = el('#test-setup').querySelector(`[data-destination="${index}"]`); if (select) select.value = plannedDestinations[index] || ''; });
    el('#add-corps').disabled = draftRosters.length >= 6 || campaign.started;
  }
  el('#test-setup').onclick = (event) => {
    const button = event.target.closest('[data-roster], [data-remove]'); if (!button || campaign.started) return;
    if (button.dataset.remove !== undefined) { draftRosters.splice(Number(button.dataset.remove), 1); plannedDestinations.splice(Number(button.dataset.remove), 1); rebuildForSetup(); return; }
    const index = Number(button.dataset.roster), type = button.dataset.type, delta = Number(button.dataset.delta);
    const current = normalizeRoster(draftRosters[index]);
    if (delta > 0 && rosterSize(current) >= MAX_CORPS_SLOTS) return;
    if (delta < 0 && !current[type]) return;
    draftRosters[index] = { ...current, [type]: current[type] + delta };
    rebuildForSetup();
  };
  el('#test-setup').onchange = (event) => {
    const select = event.target.closest('[data-destination]'); if (!select || campaign.started) return;
    plannedDestinations[Number(select.dataset.destination)] = select.value || null;
    rebuildForSetup();
  };
  el('#add-corps').onclick = () => { if (campaign.started || draftRosters.length >= 6) return; draftRosters.push({ assault: 2, mg: 1, medic: 1 }); plannedDestinations.push(null); rebuildForSetup(); };
  function renderCorps() {
    el('#groups').innerHTML = campaign.corps.filter((corps) => corps.team === 'blue').map((corps) => {
      const stats = corpsStats(corps);
      return `<div class="group ${corps.id === selectedCorpsId ? 'selected' : ''} ${corps.destroyed ? 'destroyed' : ''}" data-corps="${corps.id}">
        <strong>${corps.label} · ${stats.size}/${MAX_CORPS_SLOTS} 槽</strong>
        <small>${node(corps.nodeId).name} · ${corps.status}</small>
        <small>兵力 ${Math.ceil(stats.hp)}/${stats.maxHp} · 士气 ${percent(corps.morale)} · 速度 ${corpsSpeed(corps, campaign.map).toFixed(2)}</small>
        <small class="roster">${rosterText(corps)}</small>
      </div>`;
    }).join('');
  }
  el('#groups').onclick = (event) => {
    const card = event.target.closest('[data-corps]'); if (!card) return;
    const corps = campaign.corps.find((item) => item.id === card.dataset.corps);
    if (!corps.destroyed) { selectedCorpsId = corps.id; campaign.log = `已选择：${corps.label}。`; renderCorps(); updatePanel(); draw(); }
  };
  function updatePanel() {
    const corps = selectedCorps();
    const blue = campaign.corps.filter((item) => item.team === 'blue' && !item.destroyed).length;
    const red = campaign.corps.filter((item) => item.team === 'red' && !item.destroyed).length;
    el('#status').textContent = campaign.winner === 'red' ? '战役失败：敌军进入司令部' : campaign.log;
    el('#stats').textContent = `蓝方 ${blue} 支兵团 · 红方 ${red} 支兵团 · ${campaign.elapsed.toFixed(1)} 秒`;
    el('#log').textContent = corps ? `${corps.label}：${corps.status}${enemiesAt(campaign, corps).length ? '，节点有敌军' : ''}` : campaign.log;
    renderActions(corps);
    renderBattles();
    if (!selectedNodeId) return;
    const selected = node(selectedNodeId), definition = campaign.map.definitions.nodes[selected.type];
    el('#properties').innerHTML = `<dt>ID</dt><dd>${selected.id}</dd><dt>名称</dt><dd>${selected.name}</dd><dt>初始阵营</dt><dd>${selected.team}</dd><dt>当前控制</dt><dd>${campaign.nodeControl[selected.id]}</dd><dt>类型</dt><dd>${definition.label} (${selected.type})</dd><dt>容量</dt><dd>${definition.capacity}</dd><dt>效果标签</dt><dd>${definition.effects.join(', ')}</dd><dt>可达节点数</dt><dd>${reachableNodeIds(campaign.map, selected.id).size - 1}</dd>`;
  }
  function renderActions(corps) {
    if (!corps || corps.destroyed) { el('#actions').innerHTML = ''; return; }
    const buttons = [];
    if (corps.pendingEncounter) {
      const labels = { battle: battleAt(campaign, corps.nodeId) ? '加入战斗' : '发起战斗', pass: '强行通过（损失）', bypass: '绕路', wait: '停止等待' };
      for (const action of encounterOptions(campaign, corps.id)) buttons.push(`<button data-action="encounter:${action}">${labels[action]}</button>`);
    } else if (corps.engagementId) {
      buttons.push('<button class="danger" data-action="retreat">主动撤退</button>');
    } else if (corps.garrisoning) {
      buttons.push('<button data-action="ungarrison">解除驻防</button>');
    } else if (!enemiesAt(campaign, corps).length && !battleAt(campaign, corps.nodeId)) {
      buttons.push('<button data-action="garrison">驻防并占领当前节点</button>');
    }
    el('#actions').innerHTML = buttons.join('');
  }
  el('#actions').onclick = (event) => {
    const button = event.target.closest('[data-action]'), corps = selectedCorps(); if (!button || !corps) return;
    const action = button.dataset.action;
    let result;
    if (action.startsWith('encounter:')) result = resolveEncounter(campaign, corps.id, action.slice('encounter:'.length));
    else if (action === 'garrison') result = setGarrison(campaign, corps.id, true);
    else if (action === 'ungarrison') result = setGarrison(campaign, corps.id, false);
    else result = orderRetreat(campaign, corps.id);
    if (!result.ok) campaign.log = result.reason;
    renderCorps(); updatePanel(); draw();
  };
  function renderBattles() {
    const battles = campaign.engagements.filter((battle) => battle.active);
    const frontUnits = (battle, team) => {
      const ids = team === 'blue' ? battle.blueIds : battle.redIds;
      return ids.map((id) => campaign.corps.find((corps) => corps.id === id))
        .filter((corps) => corps && !corps.destroyed && corps.nodeId === battle.nodeId)
        .slice(0, nodeCapacity(campaign, battle.nodeId))
        .flatMap((corps) => activeUnits(corps).map((unit) => ({ ...unit, corps })));
    };
    const unitMarkup = (item, point, team) => {
      const hp = Math.max(0, item.hp / item.maxHp), color = team === 'blue' ? '#66c9ee' : '#f17b76';
      return `<g transform="translate(${point.x} ${point.y})"><title>${item.label} · ${item.corps.label} · 自动部署：${FORMATION_ROWS[formationRow(item)].label} · ${Math.ceil(item.hp)}/${item.maxHp}</title><circle class="battle-unit-outline" r="15" stroke="${color}"/><circle r="11" fill="${color}" opacity=".22"/><text class="battle-unit-symbol" y="1">${unitSymbols[item.type]}</text><rect class="battle-unit-hp-bg" x="-15" y="19" width="30" height="4" rx="2"/><rect class="battle-unit-hp" x="-15" y="19" width="${30 * hp}" height="4" rx="2"/><text class="battle-unit-label" y="34">${item.label}</text></g>`;
    };
    const arenaMarkup = (battle) => {
      const blue = frontUnits(battle, 'blue'), red = frontUnits(battle, 'red'), points = new Map();
      const rowX = { blue: { frontline: 238, support: 160, rear: 82, air: 176 }, red: { frontline: 342, support: 420, rear: 498, air: 404 } };
      const positionSide = (units, team) => Object.keys(FORMATION_ROWS).flatMap((row) => {
        const inRow = units.filter((item) => formationRow(item) === row);
        return inRow.map((item, index) => {
          const y = row === 'air' ? 58 + index * 35 : inRow.length === 1 ? 157 : 104 + index * (106 / Math.max(1, inRow.length - 1));
          const point = { x: rowX[team][row], y }; points.set(item.id, point); return { item, point };
        });
      });
      const bluePoints = positionSide(blue, 'blue'), redPoints = positionSide(red, 'red');
      const effects = (battle.visualEvents || []).map((event) => {
        const from = points.get(event.attackerId), to = points.get(event.targetId); if (!from || !to) return '';
        const width = Math.max(1.5, Math.min(8, event.power / 16));
        return `<line class="${event.kind === 'heal' ? 'battle-heal' : 'battle-fire'}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke-width="${width}"/>`;
      }).join('');
      return `<div class="battle-arena"><svg viewBox="0 0 580 260" role="img" aria-label="按职责自动展开的实时战斗视图"><text class="battle-side-label" x="25" y="25">蓝方自动展开</text><text class="battle-side-label" x="555" y="25" text-anchor="end">红方自动展开</text><text class="battle-row-label" x="238" y="91" text-anchor="middle">前列</text><text class="battle-row-label" x="160" y="91" text-anchor="middle">支援</text><text class="battle-row-label" x="82" y="91" text-anchor="middle">后卫</text><text class="battle-row-label" x="342" y="91" text-anchor="middle">前列</text><text class="battle-row-label" x="420" y="91" text-anchor="middle">支援</text><text class="battle-row-label" x="498" y="91" text-anchor="middle">后卫</text><path d="M290 34 V234" stroke="#d3aa5b" stroke-width="1" stroke-dasharray="4 6" opacity=".35"/>${effects}${bluePoints.map(({ item, point }) => unitMarkup(item, point, 'blue')).join('')}${redPoints.map(({ item, point }) => unitMarkup(item, point, 'red')).join('')}</svg></div>`;
    };
    el('#battle-window').hidden = !battles.length;
    el('#battle-window').innerHTML = battles.map((battle) => `<section class="battle-card"><div class="battle-title"><span>${node(battle.nodeId).name} · 节点战斗</span><small>每方前线 ${nodeCapacity(campaign, battle.nodeId)} 支兵团</small></div>${arenaMarkup(battle)}<p>坦克与突击步兵自动进入前列；机枪、榴弹与反坦克班进入支援列；医疗与防空留在后卫，直升机位于空中层。前列未被击溃前，会掩护后方地面单位。</p></section>`).join('');
  }
  function drawEdge(edge) {
    const from = node(edge.from), to = node(edge.to), special = ['bridge', 'ford', 'pass'].includes(edge.type);
    ctx.strokeStyle = special ? '#7bb8cc' : '#657b6d'; ctx.lineWidth = special ? 5 : 2; ctx.setLineDash(edge.type === 'trail' ? [7, 5] : []);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
    if (edge.directed) { const x = (from.x + to.x) / 2, y = (from.y + to.y) / 2, angle = Math.atan2(to.y - from.y, to.x - from.x); ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.fill(); ctx.restore(); }
  }
  function draw() {
    if (!campaign) return;
    ctx.fillStyle = '#203128'; ctx.fillRect(0, 0, canvas.width, canvas.height); campaign.map.edges.forEach(drawEdge);
    const corps = selectedCorps(), reachable = corps && !corps.destroyed ? reachableNodeIds(campaign.map, corps.nodeId) : new Set();
    for (const currentNode of campaign.map.nodes) {
      const active = reachable.has(currentNode.id); ctx.beginPath(); ctx.arc(currentNode.x, currentNode.y, currentNode.type === 'headquarters' ? 20 : 15, 0, Math.PI * 2);
      ctx.fillStyle = colors[campaign.nodeControl[currentNode.id] || currentNode.team]; ctx.fill(); ctx.strokeStyle = currentNode.id === selectedNodeId ? '#fff' : active ? '#8ee9ff' : '#0d1a1c'; ctx.lineWidth = currentNode.id === selectedNodeId ? 4 : active ? 3 : 2; ctx.stroke();
      ctx.fillStyle = '#102128'; ctx.font = 'bold 14px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(symbols[currentNode.type], currentNode.x, currentNode.y + 1);
      ctx.fillStyle = '#edf5e8'; ctx.font = '12px Microsoft YaHei'; ctx.fillText(currentNode.name, currentNode.x, currentNode.y + 30);
    }
    for (const current of campaign.corps.filter((item) => !item.destroyed)) {
      const position = visualPosition(current), stats = corpsStats(current); ctx.beginPath(); ctx.arc(position.x, position.y, 11, 0, Math.PI * 2); ctx.fillStyle = colors[current.team]; ctx.fill(); ctx.strokeStyle = current.id === selectedCorpsId ? '#fff' : '#081216'; ctx.lineWidth = current.id === selectedCorpsId ? 3 : 2; ctx.stroke();
      ctx.fillStyle = '#061116'; ctx.font = 'bold 10px Inter'; ctx.fillText(String(stats.size), position.x, position.y + 1);
      ctx.fillStyle = '#edf5e8'; ctx.font = '10px Microsoft YaHei'; ctx.fillText(current.label.replace('红方', '红').replace('第', '#').replace('兵团', ''), position.x, position.y - 16);
    }
  }
  function clickMap(event) {
    const rect = canvas.getBoundingClientRect(), x = ((event.clientX - rect.left) * canvas.width) / rect.width, y = ((event.clientY - rect.top) * canvas.height) / rect.height;
    const clicked = campaign.corps.filter((corps) => corps.team === 'blue' && !corps.destroyed).map((corps) => ({ corps, distance: Math.hypot(visualPosition(corps).x - x, visualPosition(corps).y - y) })).filter((item) => item.distance < 15).sort((a, b) => a.distance - b.distance)[0];
    if (clicked) { selectedCorpsId = clicked.corps.id; campaign.log = `已选择：${clicked.corps.label}。`; renderCorps(); updatePanel(); draw(); return; }
    const picked = campaign.map.nodes.find((currentNode) => Math.hypot(currentNode.x - x, currentNode.y - y) < 23); if (!picked) return;
    selectedNodeId = picked.id; const corps = selectedCorps();
    if (corps && !corps.destroyed) { const result = orderMove(campaign, corps.id, picked.id); if (!result.ok) campaign.log = result.reason; }
    updatePanel(); renderCorps(); draw();
  }
  function frame(time) { const dt = Math.min(0.04, (time - last) / 1000 || 0); last = time; if (campaign) { advance(campaign, dt); updatePanel(); draw(); } requestAnimationFrame(frame); }
  el('#generate').onclick = generate;
  el('#start').onclick = () => { if (campaign.started) return; if (!campaign.corps.some((corps) => corps.team === 'blue' && corps.path.length)) { campaign.log = '请先至少给一支蓝方兵团下达出击命令。'; updatePanel(); return; } startCampaign(campaign); el('#start').disabled = true; renderTestSetup(); updatePanel(); };
  canvas.addEventListener('click', clickMap); generate(); requestAnimationFrame(frame);
})();
