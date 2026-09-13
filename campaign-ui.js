/* Rendering and DOM input only. Campaign rules remain in campaign-core.js. */
(() => {
  'use strict';

  const {
    UNITS,
    DEFAULTS,
    createCampaign,
    startCampaign,
    orderMove,
    advance,
    unitPosition,
    reachableNodeIds,
    enemiesAt,
    battleNodeId,
  } = CampaignCore;
  const canvas = document.querySelector('#map');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.querySelector(id);

  let campaign;
  let selectedUnitId = null;
  let selectedNodeId = null;
  let last = 0;

  const colors = {
    blue: '#66c9ee',
    red: '#f17b76',
    neutral: '#d9c87f',
  };
  const symbols = {
    headquarters: '◆',
    deployment: '●',
    town: '■',
    urban: '▦',
    industrial: '▤',
    highland: '▲',
    woodland: '♣',
    lowland: '▽',
    marsh: '≈',
    crossroads: '✦',
    railHub: '⊞',
    supply: '✚',
    fieldHospital: '✛',
    airfield: '✈',
    commandPost: '⚑',
    observationPost: '◉',
    fortification: '▰',
    bridgehead: '⌁',
    riverCrossing: '≋',
    chokepoint: '◈',
    objective: '★',
  };

  const node = (id) => campaign.map.nodes.find((item) => item.id === id);
  const selectedUnit = () =>
    campaign.units.find((item) => item.id === selectedUnitId);

  function visualPosition(unit) {
    const position = unitPosition(campaign, unit);
    if (unit.engagementId) {
      const peers = campaign.units.filter(
        (item) =>
          !item.destroyed &&
          item.engagementId === unit.engagementId &&
          item.team === unit.team,
      );
      const index = peers.findIndex((item) => item.id === unit.id);
      const offset = (index - (peers.length - 1) / 2) * 13;
      return {
        x: position.x + offset,
        y: position.y - 28 - (index % 2) * 13,
      };
    }
    const peers = campaign.units.filter(
      (item) =>
        !item.destroyed &&
        item.nodeId === unit.nodeId &&
        !item.engagementId,
    );
    const index = peers.findIndex((item) => item.id === unit.id);
    return {
      x: position.x + ((index % 4) - 1.5) * 15,
      y: position.y - 25 - Math.floor(index / 4) * 14,
    };
  }

  function generate() {
    const playerCorps = Math.max(
      4,
      Math.min(8, Number(el('#corps').value) || 6),
    );
    el('#corps').value = playerCorps;
    campaign = createCampaign(
      CampaignMapGenerator.generateMap({
        seed: el('#seed').value || 'frontier-01',
        playerCorps,
      }),
      [{ ...DEFAULTS[0] }],
    );
    el('#start').disabled = false;
    selectedUnitId = campaign.units.find((unit) => unit.team === 'blue').id;
    selectedNodeId = null;
    last = 0;
    renderUnits();
    updatePanel();
    draw();
  }

  function renderUnits() {
    el('#groups').innerHTML = campaign.units
      .filter((unit) => unit.team === 'blue')
      .map(
        (unit) => `
          <div class="group ${unit.id === selectedUnitId ? 'selected' : ''} ${unit.destroyed ? 'destroyed' : ''}" data-unit="${unit.id}">
            <strong>${unit.label} · ${Math.ceil(unit.hp)}/${unit.maxHp} HP</strong>
            <small>${unit.destroyed ? '已损失' : `${node(unit.nodeId).name} · ${unit.status}`}</small>
          </div>
        `,
      )
      .join('');
  }

  el('#groups').onclick = (event) => {
    const card = event.target.closest('[data-unit]');
    if (!card) return;

    const unit = campaign.units.find((item) => item.id === card.dataset.unit);
    if (!unit.destroyed) {
      selectedUnitId = unit.id;
      renderUnits();
      updatePanel();
      draw();
    }
  };

  function updatePanel() {
    const unit = selectedUnit();
    const blue = campaign.units.filter(
      (item) => item.team === 'blue' && !item.destroyed,
    ).length;
    const red = campaign.units.filter(
      (item) => item.team === 'red' && !item.destroyed,
    ).length;

    el('#status').textContent =
      campaign.winner === 'blue'
        ? '战役胜利：已夺取敌方目标'
        : campaign.winner === 'red'
          ? '战役失败：蓝方单位全损'
          : campaign.log;
    el('#stats').textContent = `蓝方 ${blue} 单位 · 红方 ${red} 单位 · ${campaign.elapsed.toFixed(1)} 秒`;
    el('#log').textContent = unit
      ? `${unit.label}：${unit.status}${enemiesAt(campaign, unit).length ? '，正在自动交战' : ''}`
      : campaign.log;

    renderBattleWindow();

    if (!selectedNodeId) return;
    const selected = node(selectedNodeId);
    const definition = campaign.map.definitions.nodes[selected.type];
    el('#properties').innerHTML = `
      <dt>ID</dt><dd>${selected.id}</dd>
      <dt>名称</dt><dd>${selected.name}</dd>
      <dt>阵营</dt><dd>${selected.team}</dd>
      <dt>类型</dt><dd>${definition.label} (${selected.type})</dd>
      <dt>容量</dt><dd>${definition.capacity}</dd>
      <dt>效果标签</dt><dd>${definition.effects.join(', ')}</dd>
      <dt>可达节点数</dt><dd>${reachableNodeIds(campaign.map, selected.id).size - 1}</dd>
    `;
  }

  function renderBattleWindow() {
    const battles = [...new Set(
      campaign.units.map(battleNodeId).filter(Boolean),
    )];
    const panel = el('#battle-window');
    if (!battles.length) {
      panel.hidden = true;
      return;
    }
    const role = (unit) => {
      const spec = UNITS[unit.type];
      if (spec.heal) return `医疗 ${spec.heal}/${spec.cooldown}s`;
      if (spec.antiAir) return `防空 ${spec.antiAir}/${spec.cooldown}s`;
      if (spec.antiArmor) return `反装甲 ${spec.antiArmor}/${spec.cooldown}s`;
      return `火力 ${spec.damage}/${spec.cooldown}s`;
    };
    const card = (nodeId) => {
      const participants = campaign.units.filter(
        (unit) => !unit.destroyed && battleNodeId(unit) === nodeId,
      );
      const side = (team) => participants.filter((unit) => unit.team === team);
      const roster = (team) => side(team).map((unit) => {
        const hp = Math.max(0, unit.hp / unit.maxHp * 100);
        return `<div class="combatant"><span>${unit.label}</span><b>${Math.ceil(unit.hp)}</b><i><em style="width:${hp}%"></em></i><small>${role(unit)}</small></div>`;
      }).join('') || '<div class="combatant empty">无参战单位</div>';
      const event = campaign.battleEvents.find((item) => item.nodeId === nodeId);
      const latest = !event
        ? '双方正在接敌，等待首轮射击。'
        : event.kind === 'heal'
          ? `${event.source} 为 ${event.target} 恢复了 ${event.amount} HP`
          : `${event.source} 命中 ${event.target}，造成 ${event.amount} 伤害`;
      return `
        <article class="battle-card">
          <div class="battle-title">⚔ 节点战斗 · ${node(nodeId).name}</div>
          <div class="battle-layout">
            <section class="battle-team blue-team"><strong>蓝方 · ${side('blue').length} 支</strong>${roster('blue')}</section>
            <div class="battle-center"><span>交战中</span><b>VS</b><small>自动攻击<br>按单位克制结算</small></div>
            <section class="battle-team red-team"><strong>红方 · ${side('red').length} 支</strong>${roster('red')}</section>
          </div>
          <div class="battle-event">最新：${latest}</div>
          <p>命令终点为此节点：加入战斗；只是途经：减速并损失 10% 最大生命。</p>
        </article>`;
    };
    panel.hidden = false;
    panel.innerHTML = battles.map(card).join('');
  }

  function drawEdge(edge) {
    const from = node(edge.from);
    const to = node(edge.to);
    const special = ['bridge', 'ford', 'pass'].includes(edge.type);

    ctx.strokeStyle = special ? '#7bb8cc' : '#657b6d';
    ctx.lineWidth = special ? 5 : 2;
    ctx.setLineDash(edge.type === 'trail' ? [7, 5] : []);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (edge.directed) {
      const x = (from.x + to.x) / 2;
      const y = (from.y + to.y) / 2;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-5, -5);
      ctx.lineTo(-5, 5);
      ctx.fill();
      ctx.restore();
    }
  }

  function draw() {
    if (!campaign) return;
    ctx.fillStyle = '#203128';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    campaign.map.edges.forEach(drawEdge);

    const unit = selectedUnit();
    const reachable =
      unit && !unit.destroyed
        ? reachableNodeIds(campaign.map, unit.nodeId)
        : new Set();

    for (const currentNode of campaign.map.nodes) {
      const active = reachable.has(currentNode.id);
      ctx.beginPath();
      ctx.arc(
        currentNode.x,
        currentNode.y,
        currentNode.type === 'headquarters' ? 20 : 15,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = colors[campaign.nodeControl[currentNode.id] || currentNode.team];
      ctx.fill();
      ctx.strokeStyle =
        currentNode.id === selectedNodeId
          ? '#fff'
          : active
            ? '#8ee9ff'
            : '#0d1a1c';
      ctx.lineWidth =
        currentNode.id === selectedNodeId ? 4 : active ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = '#102128';
      ctx.font = 'bold 14px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbols[currentNode.type], currentNode.x, currentNode.y + 1);
      ctx.fillStyle = '#edf5e8';
      ctx.font = '12px Microsoft YaHei';
      ctx.fillText(currentNode.name, currentNode.x, currentNode.y + 30);
    }

    for (const current of campaign.units.filter((item) => !item.destroyed)) {
      const position = visualPosition(current);
      ctx.beginPath();
      ctx.arc(position.x, position.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = current.team === 'blue' ? colors.blue : colors.red;
      ctx.fill();
      ctx.strokeStyle = current.id === selectedUnitId ? '#fff' : '#081216';
      ctx.lineWidth = current.id === selectedUnitId ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = '#061116';
      ctx.font = 'bold 9px Inter';
      ctx.fillText(
        current.type === 'tank'
          ? 'T'
          : current.type === 'medic'
            ? '＋'
            : current.type === 'mg'
              ? 'M'
              : '•',
        position.x,
        position.y + 1,
      );
      if (enemiesAt(campaign, current).length) {
        const barWidth = 22;
        const hpRatio = Math.max(0, current.hp / current.maxHp);
        ctx.fillStyle = '#081216';
        ctx.fillRect(position.x - barWidth / 2, position.y - 20, barWidth, 4);
        ctx.fillStyle = hpRatio > 0.5 ? '#8ee58b' : hpRatio > 0.25 ? '#ffd166' : '#ff665f';
        ctx.fillRect(position.x - barWidth / 2, position.y - 20, barWidth * hpRatio, 4);
        ctx.fillStyle = '#fff4c7';
        ctx.font = '14px serif';
        ctx.fillText('⚔', position.x, position.y - 27);
      }
    }
  }

  function clickMap(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((event.clientY - rect.top) * canvas.height) / rect.height;
    const clickedUnit = campaign.units
      .filter((unit) => unit.team === 'blue' && !unit.destroyed)
      .map((unit) => {
        const position = visualPosition(unit);
        return {
          unit,
          distance: Math.hypot(position.x - x, position.y - y),
        };
      })
      .filter((item) => item.distance < 13)
      .sort((a, b) => a.distance - b.distance)[0];

    if (clickedUnit) {
      selectedUnitId = clickedUnit.unit.id;
      campaign.log = `已选择：${clickedUnit.unit.label}。`;
      renderUnits();
      updatePanel();
      draw();
      return;
    }

    const picked = campaign.map.nodes.find(
      (currentNode) => Math.hypot(currentNode.x - x, currentNode.y - y) < 23,
    );
    if (!picked) return;

    selectedNodeId = picked.id;
    const unit = selectedUnit();
    if (unit && !unit.destroyed) {
      const result = orderMove(campaign, unit.id, picked.id);
      if (!result.ok) campaign.log = result.reason;
    }
    updatePanel();
    renderUnits();
    draw();
  }

  // Do not rebuild the selectable list inside the animation loop. Replacing a card
  // between pointer-down and pointer-up cancels the browser's click event.
  function frame(time) {
    const dt = Math.min(0.04, (time - last) / 1000 || 0);
    last = time;
    if (campaign) {
      advance(campaign, dt);
      updatePanel();
      draw();
    }
    requestAnimationFrame(frame);
  }

  el('#generate').onclick = generate;
  el('#start').onclick = () => {
    if (campaign.started) return;
    const deployed = campaign.units.some(
      (unit) => unit.team === 'blue' && unit.path.length,
    );
    if (!deployed) {
      campaign.log = '请先至少给一个蓝方单位下达出击命令。';
      updatePanel();
      return;
    }
    startCampaign(campaign);
    el('#start').disabled = true;
    updatePanel();
  };

  canvas.addEventListener('click', clickMap);
  generate();
  requestAnimationFrame(frame);
})();
