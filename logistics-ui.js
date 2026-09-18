import './logistics-constants.js';
import './logistics-core.js';

const { createInitialState, advanceDay, computeEffectiveness } = window.LogisticsCore;
const state = createInitialState();
const app = document.querySelector('#app');

const number = (value, digits = 1) => Number(value || 0).toFixed(digits);
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function readOrders() {
  for (const division of state.divisions) {
    state.orders.divisionPriority[division.id] = Math.max(0, Number(app.querySelector(`[name="priority-${division.id}"]`).value) || 0);
    state.orders.minReserveDays[division.id] = Math.max(0, Number(app.querySelector(`[name="reserve-${division.id}"]`).value) || 0);
    const personnelInput = app.querySelector(`[name="personnel-${division.id}"]`);
    if (personnelInput.value === '') {
      delete state.orders.personnelAssignment[division.id];
    } else {
      state.orders.personnelAssignment[division.id] = Math.max(0, Number(personnelInput.value) || 0);
    }
    state.orders.rotationOrder[division.id] = Math.max(0, Number(app.querySelector(`[name="rotation-${division.id}"]`).value) || 0);
    state.orders.briefTruth[division.id] = app.querySelector(`[name="truth-${division.id}"]`).checked;
  }
  for (const [lineId, ratios] of Object.entries(state.orders.lineRatios)) {
    for (const type of ['ammo', 'supply', 'personnel']) ratios[type] = Math.max(0, Number(app.querySelector(`[name="${lineId}-${type}"]`).value) || 0);
  }
  state.orders.trainingTrack = app.querySelector('[name="trainingTrack"]').value;
  state.orders.dailyShipmentCap = Math.max(0, Number(app.querySelector('[name="shipmentCap"]').value) || 0);
  state.orders.advanceQuota = Math.max(0, Number(app.querySelector('[name="advanceQuota"]').value) || 0);
}

function divisionCard(division) {
  const visible = division.lastReportSnapshot || division;
  const effectiveness = computeEffectiveness(visible);
  const danger = visible.ammoDays < 2 ? 'danger' : '';
  const eta = state.transitQueue.filter((shipment) => shipment.divisionId === division.id).sort((a, b) => a.arrivesDay - b.arrivesDay)[0];
  const depletion = visible.ammoDays <= 0 ? '已告罄' : `D${number(state.day + visible.ammoDays)}`;
  return `<section class="division ${division.underAttack ? 'combat' : ''}"><div class="panel-title"><strong>${esc(division.name)} ${division.underAttack ? '· 交战中' : ''}</strong><small>情报更新：D${visible.day}</small></div><div class="bar ${danger}"><i style="width:${Math.round(effectiveness * 100)}%"></i></div><small>可见效能 ${Math.round(effectiveness * 100)}% · 姿态 ${esc(visible.posture)}</small><div class="stats"><span>弹药<b>${number(visible.ammoDays)} 天</b></span><span>给养<b>${number(visible.supplyDays)} 天</b></span><span>满编<b>${Math.round(visible.manpowerRatio * 100)}%</b></span></div><p class="line-note">弹药预计 ${depletion} 耗尽 · ${eta ? `最近车队 D${eta.arrivesDay} 抵达` : '暂无在途车队'}</p></section>`;
}

function render() {
  const reports = state.eventLog.slice().reverse().map((event) => `<article class="report"><span class="tag">D${event.day}</span> ${esc(event.text || (event.type === 'dispatch' ? `已按规则发出 ${event.count} 支车队。` : event.type))}</article>`).join('') || '<p class="muted">尚无战报。</p>';
  const convoys = state.transitQueue.map((shipment) => {
    const isReturn = shipment.leg === 'return';
    const cargo = isReturn
      ? `回程 伤 ${number(shipment.cargo.wounded || 0, 0)} / 轮 ${number(shipment.cargo.rotation || 0, 0)}`
      : `去程 弹药 ${number(shipment.cargo.ammo)} / 给养 ${number(shipment.cargo.supply)}`;
    return `<div><span class="tag">${esc(shipment.lineId)}</span> → ${esc(shipment.divisionId)} · ${cargo} · ETA D${shipment.arrivesDay}</div>`;
  }).join('') || '<span class="muted">没有在途车队</span>';
  const orderRows = state.divisions.map((division) => `<div class="command-row"><strong>${esc(division.name)}</strong><label>派车<input name="priority-${division.id}" type="number" min="0" value="${state.orders.divisionPriority[division.id]}"></label><label>最低储备<input name="reserve-${division.id}" type="number" min="0" value="${state.orders.minReserveDays[division.id]}"></label><label>去程补员<input name="personnel-${division.id}" type="number" min="0" value="${state.orders.personnelAssignment[division.id] ?? ''}"></label><label>轮换<input name="rotation-${division.id}" type="number" min="0" value="${state.orders.rotationOrder[division.id] || 0}"></label><label>回电<input name="truth-${division.id}" type="checkbox" ${state.orders.briefTruth[division.id] ? 'checked' : ''}></label></div>`).join('');
  const lineRows = Object.entries(state.orders.lineRatios).map(([lineId, ratio]) => `<div class="command-row"><strong>${esc(lineId)}</strong><label>弹药<input name="${lineId}-ammo" type="number" min="0" step=".1" value="${ratio.ammo}"></label><label>给养<input name="${lineId}-supply" type="number" min="0" step=".1" value="${ratio.supply}"></label><label>人员预留<input name="${lineId}-personnel" type="number" min="0" step=".1" value="${ratio.personnel}"></label></div>`).join('');
  const baseRate = Math.min(1, state.orders.dailyShipmentCap);
  const baseEta = baseRate > 0 ? `D${number(state.day + state.base.ammo / baseRate)}` : '未设发运';
  app.innerHTML = `<header><div><h1>后勤指挥 · 监护仪</h1><small>第 ${state.day} / 30 天</small></div><button id="advance" ${state.ended ? 'disabled' : ''}>${state.ended ? '战役结束' : '按规则派车并推进一天'}</button></header><div class="grid"><section class="panel"><h2>前线态势</h2>${state.divisions.map(divisionCard).join('')}</section><section class="panel"><h2>后方与预告</h2><div class="metric"><span>基地弹药</span><b>${number(state.base.ammo)} D</b></div><div class="metric"><span>基地给养</span><b>${number(state.base.supply)} D</b></div><div class="metric"><span>当前发运速度耗尽</span><b>${baseEta}</b></div><div class="metric"><span>下批配额</span><b>D${state.quota.nextArrivalDay} · ${state.quota.nextAmount === null ? '未公开' : `${number(state.quota.nextAmount)} D`}</b></div><div class="metric"><span>人员池</span><b>${number(state.personnel.pool)} 点</b></div><h2 style="margin-top:18px">在途车队</h2><div id="convoys">${convoys}</div></section><section class="panel wide"><h2>今日命令 · 师级规则</h2>${orderRows}<h2 style="margin-top:16px">线路物资配比</h2>${lineRows}<div class="command-row"><strong>全局</strong><label>训练<select name="trainingTrack"><option value="normal" ${state.orders.trainingTrack === 'normal' ? 'selected' : ''}>正常（7天）</option><option value="urgent" ${state.orders.trainingTrack === 'urgent' ? 'selected' : ''}>紧急（当天）</option></select></label><label>发运上限 D<input name="shipmentCap" type="number" min="0" max="1" step=".1" value="${state.orders.dailyShipmentCap}"></label><label>预支配额 D<input name="advanceQuota" type="number" min="0" max="3" step=".1" value="0"></label></div><p class="line-note">补员占去程载荷；回程按规则自动装伤员或轮换，不另填后送单。</p></section><section class="panel wide"><h2>每日战报</h2><div id="reports">${reports}</div></section></div>`;
  app.querySelector('#advance')?.addEventListener('click', () => { readOrders(); advanceDay(state); render(); });
}

render();
