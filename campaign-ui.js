/* Rendering and DOM input only. Campaign rules remain in campaign-core.js. */
(() => {
  'use strict';
  const { DEFAULTS, MAX_CORPS_SLOTS, createCampaign, startCampaign, orderMove, advance, unitPosition, reachableNodeIds, corpsStats, corpsSpeed, enemiesAt, encounterOptions, resolveEncounter, setGarrison, orderRetreat, battleAt, nodeCapacity } = CampaignCore;
  const canvas = document.querySelector('#map');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.querySelector(id);
  let campaign, selectedCorpsId = null, selectedNodeId = null, last = 0;
  const colors = { blue: '#66c9ee', red: '#f17b76', neutral: '#d9c87f' };
  const symbols = { headquarters: '◆', deployment: '●', town: '■', urban: '▦', industrial: '▤', highland: '▲', woodland: '♣', lowland: '▽', marsh: '≈', crossroads: '✦', railHub: '⊞', supply: '✚', fieldHospital: '✛', airfield: '✈', commandPost: '⚑', observationPost: '◉', fortification: '▰', bridgehead: '⌁', riverCrossing: '≋', chokepoint: '◈', objective: '★' };
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
    campaign = createCampaign(CampaignMapGenerator.generateMap({ seed: el('#seed').value || 'frontier-01', playerCorps }), DEFAULTS);
    el('#start').disabled = false;
    selectedCorpsId = campaign.corps.find((corps) => corps.team === 'blue').id;
    selectedNodeId = null; last = 0;
    renderCorps(); updatePanel(); draw();
  }
  function renderCorps() {
    el('#groups').innerHTML = campaign.corps.filter((corps) => corps.team === 'blue').map((corps) => {
      const stats = corpsStats(corps);
      return `<div class="group ${corps.id === selectedCorpsId ? 'selected' : ''} ${corps.destroyed ? 'destroyed' : ''}" data-corps="${corps.id}">
        <strong>${corps.label} · ${stats.size}/${MAX_CORPS_SLOTS} 槽</strong>
        <small>${node(corps.nodeId).name} · ${corps.status}</small>
        <small>兵力 ${Math.ceil(stats.hp)}/${stats.maxHp} · 士气 ${percent(corps.morale)} · 补给 ${percent(corps.supply)} · 速度 ${corpsSpeed(corps, campaign.map).toFixed(2)}</small>
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
    const combatants = (battle, team) => {
      const ids = team === 'blue' ? battle.blueIds : battle.redIds, capacity = nodeCapacity(campaign, battle.nodeId);
      const list = ids.map((id) => campaign.corps.find((corps) => corps.id === id)).filter((corps) => corps && !corps.destroyed && corps.nodeId === battle.nodeId);
      return list.length ? list.map((corps, index) => { const stats = corpsStats(corps), hp = stats.maxHp ? Math.max(0, stats.hp / stats.maxHp * 100) : 0; return `<div class="combatant"><span>${corps.label}${index >= capacity ? '（预备）' : ''}</span><b>${Math.ceil(hp)}%</b><i><em style="width:${hp}%"></em></i><small>${stats.size} 槽 · 士气 ${percent(corps.morale)} · 补给 ${percent(corps.supply)}</small></div>`; }).join('') : '<div class="combatant empty">无参战兵团</div>';
    };
    el('#battle-window').hidden = !battles.length;
    el('#battle-window').innerHTML = battles.map((battle) => `<section class="battle-card"><div class="battle-title">${node(battle.nodeId).name} · 节点战斗</div><div class="battle-layout"><div class="battle-team blue-team"><strong>蓝方</strong>${combatants(battle, 'blue')}</div><div class="battle-center"><small>有效容量</small><b>${nodeCapacity(campaign, battle.nodeId)}</b><small>每方兵团</small></div><div class="battle-team red-team"><strong>红方</strong>${combatants(battle, 'red')}</div></div><div class="battle-event">${battle.lastEvent}</div><p>容量外兵团为预备队，暂不承受或造成前线伤害。</p></section>`).join('');
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
  el('#start').onclick = () => { if (campaign.started) return; if (!campaign.corps.some((corps) => corps.team === 'blue' && corps.path.length)) { campaign.log = '请先至少给一支蓝方兵团下达出击命令。'; updatePanel(); return; } startCampaign(campaign); el('#start').disabled = true; updatePanel(); };
  canvas.addEventListener('click', clickMap); generate(); requestAnimationFrame(frame);
})();
