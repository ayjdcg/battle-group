// 后勤指挥 · 战区态势图（交互原型）
//
// 目的：用“库存 → 在途 → 前线”的流量视角承载「点线调配比、点师调优先级」，
// 让玩家先看清物资和人员在哪里，再下达空间化命令。
// 节点坐标（NODE_POS）是本文件独有的展示层数据，不属于 GameState，不写回 core。

import './logistics-constants.js';
import './logistics-core.js';

const { createInitialState, advanceDay, ammoTierOf, computeEffectiveness, planConfiguredShipments } = window.LogisticsCore;
const { MAP, TOTAL_TRANSPORT_PER_DAY } = window.LogisticsConstants;

const state = createInitialState();
const app = document.querySelector('#app');

// ---- 展示层专用数据：布局坐标、中文标签、师的人设标签 ----
// 固定 6 节点小地图，坐标手工摆放，不做通用生成器（同尺子：demo 不需要）。
const VIEW_W = 900;
const VIEW_H = 600;
const NODE_POS = {
  base: { x: 110, y: 300 },
  'transit-a': { x: 400, y: 165 },
  'transit-b': { x: 400, y: 460 },
  'front-1': { x: 800, y: 90 },
  'front-2': { x: 800, y: 300 },
  'front-3': { x: 800, y: 510 },
};

const FRONT_NODE_OF_DIVISION = Object.fromEntries(MAP.divisions.map((d) => [d.id, d.frontNodeId]));
const LINE_PATH_NODES = Object.fromEntries(
  MAP.lines.map((line) => [line.id, ['base', line.via, FRONT_NODE_OF_DIVISION[line.divisionId]]]),
);

const POSTURE_LABEL = {
  refit: '休整', defend: '固守', dormant: '蛰伏',
  'active-defend': '积极防御', attack: '进攻', retreat: '撤退',
};

// 初始化顺序固定为 [冲锋型, 铁公鸡, 老实人]（见 logistics-core.js createInitialState），
// 这里只是把这套人设翻译成 UI 上能被认出来的标签，不影响任何数值。
const PERSONALITY_META = {
  'div-1': { code: '攻', label: '冲锋型', color: '#ee8067' },
  'div-2': { code: '囤', label: '铁公鸡', color: '#f1b36d' },
  'div-3': { code: '顺', label: '老实人', color: '#7fb8e0' },
};

const BASE_BAR_MAX = { ammo: 6, supply: 4 }; // 纯展示用的刻度上限，不影响数值结算

let selection = null; // { type: 'line' | 'division', id }
let dispatchPanelOpen = false;

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = (value, digits = 1) => Number(value || 0).toFixed(digits);

function segLen(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

function pointAlongPath(points, t) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) segments.push(segLen(points[i], points[i + 1]));
  const total = segments.reduce((sum, len) => sum + len, 0);
  let travelled = clamp(t, 0, 1) * total;
  for (let i = 0; i < segments.length; i += 1) {
    if (travelled <= segments[i] || i === segments.length - 1) {
      const ratio = segments[i] > 0 ? clamp(travelled / segments[i], 0, 1) : 1;
      const a = points[i]; const b = points[i + 1];
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    travelled -= segments[i];
  }
  return points[points.length - 1];
}

function effectivenessColor(pct) {
  if (pct >= 0.7) return '#70d59a';
  if (pct >= 0.4) return '#f1b36d';
  return '#ed6f63';
}

function sumQueue(queue, valueOf) {
  return queue.reduce((sum, item) => sum + valueOf(item), 0);
}

function renderFlowOverview() {
  const plannedShipments = planConfiguredShipments(state);
  const plannedByLine = Object.fromEntries(plannedShipments.map((shipment) => [shipment.lineId, shipment]));
  const plannedTotal = sumQueue(plannedShipments, (shipment) => (shipment.cargo.ammo || 0) + (shipment.cargo.supply || 0));
  const baseTotal = state.base.ammo + state.base.supply;
  const sendableUpperBound = Math.min(TOTAL_TRANSPORT_PER_DAY, state.orders.dailyShipmentCap, baseTotal);
  const transitAmmo = sumQueue(state.transitQueue, (item) => item.cargo.ammo || 0);
  const transitSupply = sumQueue(state.transitQueue, (item) => item.cargo.supply || 0);
  const nextMaterialArrival = state.transitQueue.length > 0
    ? Math.min(...state.transitQueue.map((item) => item.arrivesDay))
    : null;
  const visibleDivisions = state.divisions.map((division) => ({
    id: division.id,
    visible: division.lastReportSnapshot || division,
  }));
  const ammoGap = visibleDivisions.reduce((sum, division) => (
    sum + Math.max(0, (state.orders.minReserveDays[division.id] || 0) - division.visible.ammoDays)
  ), 0);
  const supplyGap = visibleDivisions.reduce((sum, division) => (
    sum + Math.max(0, (state.orders.minReserveDays[division.id] || 0) - division.visible.supplyDays)
  ), 0);
  const training = sumQueue(state.personnel.trainingQueue, (item) => item.count || 0);
  const hospital = sumQueue(state.personnel.hospitalQueue, (item) => item.count || 0);
  const integrating = sumQueue(state.personnel.integrationQueue, (item) => item.count || 0);
  const nextPersonnelDay = [
    ...state.personnel.trainingQueue.map((item) => item.arrivesDay),
    ...state.personnel.hospitalQueue.map((item) => item.arrivesDay),
    ...state.personnel.integrationQueue.map((item) => item.arrivesDay),
  ].sort((a, b) => a - b)[0];
  const materialEta = nextMaterialArrival === null ? '尚无车队' : `最近 D${nextMaterialArrival} 抵达`;
  const personnelEta = nextPersonnelDay === undefined
    ? `下批动员 D${state.personnel.mobilization.nextArrivalDay}`
    : `最近 D${nextPersonnelDay} 转出`;

  if (!dispatchPanelOpen) {
    return `
      <section class="dispatch-summary-bar" aria-label="发运摘要">
        <div><span>可用库存</span><b>${num(baseTotal)} D</b><small>弹 ${num(state.base.ammo)} · 给 ${num(state.base.supply)}</small></div>
        <div><span>本日发运</span><b>${num(plannedTotal)} D</b><small>上限 ${num(sendableUpperBound)} D</small></div>
        <div><span>在途</span><b>${state.transitQueue.length} 批</b><small>${materialEta}</small></div>
        <div><span>前线缺口</span><b>弹 ${num(ammoGap)} · 给 ${num(supplyGap)}</b><small>相对最低储备线</small></div>
        <button type="button" data-toggle-dispatch>打开发运单</button>
      </section>
    `;
  }

  return `
    <section class="flow-overview" aria-label="后勤流动总览">
      <div class="flow-title">
        <div><strong>今日发运单</strong><span>不用填参数：看今天会装什么，直接增减各前线的发运份额</span></div>
        <button type="button" data-toggle-dispatch>收起发运单</button>
      </div>
      <div class="command-summary">
        <div class="question-card">
          <span class="question-label">可用库存</span>
          <span class="question-value">共 ${num(baseTotal)} D</span>
          <span class="question-detail">弹药 <strong>${num(state.base.ammo)} D</strong>　给养 <strong>${num(state.base.supply)} D</strong>　· 下批 D${state.quota.nextArrivalDay}</span>
        </div>
        <div class="question-card">
          <span class="question-label">今日发运上限</span>
          <span class="question-value">${num(sendableUpperBound)} D</span>
          <label class="cap-control">本日使用运力
            <input aria-label="今日发运上限" type="range" min="0" max="1" step="0.1" value="${state.orders.dailyShipmentCap === Infinity ? 1 : state.orders.dailyShipmentCap}" data-global="dailyShipmentCap">
          </label>
        </div>
        <div class="question-card plan">
          <span class="question-label">本日实际装载</span>
          <span class="question-value">${num(plannedTotal)} D</span>
          <span class="question-detail">${plannedTotal + 1e-6 < sendableUpperBound ? '<strong>尚有可用运力，可增加前线份额</strong>' : '已用满当日可发运量'}</span>
        </div>
      </div>
      <div class="dispatch-table" aria-label="今日预计发运去向">
        <div class="dispatch-head"><span>发给谁</span><span>前线现状（最新报告）</span><span>今天装载</span><span>预计抵达</span><span>增减份额</span></div>
        ${MAP.lines.map((line) => {
          const division = state.divisions.find((item) => item.id === line.divisionId);
          const visible = division.lastReportSnapshot || division;
          const shipment = plannedByLine[line.id];
          const amount = shipment ? (shipment.cargo.ammo || 0) + (shipment.cargo.supply || 0) : 0;
          return `
            <div class="dispatch-row">
              <span class="dispatch-target"><b>${esc(division.name)}</b><small>${line.type === 'rail' ? '铁路' : '公路'} · ${line.transitDays} 天</small></span>
              <span data-mobile-label="前线现状">弹 ${num(visible.ammoDays)}天　给 ${num(visible.supplyDays)}天</span>
              <span data-mobile-label="今天装载" class="dispatch-cargo ${amount <= 0 ? 'dispatch-empty' : ''}"><b class="dispatch-amount">${num(amount)} D</b><small>　弹 ${num(shipment?.cargo.ammo || 0)} / 给 ${num(shipment?.cargo.supply || 0)}</small></span>
              <span data-mobile-label="预计抵达">${amount > 0 ? `D${state.day + 1 + line.transitDays}` : '不发运'}</span>
              <span class="share-stepper" data-mobile-label="增减份额">
                <button type="button" aria-label="减少${esc(division.name)}发运份额" data-priority-step="-1" data-division="${division.id}" ${state.orders.divisionPriority[division.id] <= 0 ? 'disabled' : ''}>−</button>
                <b title="发运权重">${state.orders.divisionPriority[division.id]}</b>
                <button type="button" aria-label="增加${esc(division.name)}发运份额" data-priority-step="1" data-division="${division.id}">+</button>
              </span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="flow-lane material-lane">
        <div class="flow-card">
          <span class="flow-kicker">后方库存</span>
          <b>弹 ${num(state.base.ammo)}D · 给 ${num(state.base.supply)}D</b>
          <small>下批配额 D${state.quota.nextArrivalDay}</small>
        </div>
        <span class="flow-arrow" aria-hidden="true">→</span>
        <div class="flow-card flow-card-focus">
          <span class="flow-kicker">在途物资</span>
          <b>弹 ${num(transitAmmo)}D · 给 ${num(transitSupply)}D</b>
          <small>${materialEta} · ${state.transitQueue.length} 支车队</small>
        </div>
        <span class="flow-arrow" aria-hidden="true">→</span>
        <div class="flow-card">
          <span class="flow-kicker">前线缺口</span>
          <b>弹 ${num(ammoGap)}天 · 给 ${num(supplyGap)}天</b>
          <small>各师相对最低储备线的天数差额</small>
        </div>
      </div>
      <div class="personnel-lane">
        <span class="flow-kicker">人员流转</span>
        <span>训练中 <b>${num(training, 0)}</b></span>
        <span class="personnel-arrow">→</span>
        <span>人员池 <b>${num(state.personnel.pool, 0)}</b></span>
        <span class="personnel-arrow">→</span>
        <span>整编中 <b>${num(integrating, 0)}</b></span>
        <span class="personnel-separator"></span>
        <span>医院 <b>${num(hospital, 0)}</b></span>
        <small>${personnelEta}；人员不占物资车队运力</small>
      </div>
    </section>
  `;
}

function renderTransitBoard() {
  const shipments = [...state.transitQueue].sort((a, b) => a.arrivesDay - b.arrivesDay || a.id.localeCompare(b.id));
  const transitAmmo = sumQueue(shipments, (item) => item.cargo.ammo || 0);
  const transitSupply = sumQueue(shipments, (item) => item.cargo.supply || 0);
  const rows = shipments.map((shipment) => {
    const division = state.divisions.find((item) => item.id === shipment.divisionId);
    const line = MAP.lines.find((item) => item.id === shipment.lineId);
    const span = Math.max(1, shipment.arrivesDay - shipment.dispatchedDay);
    const elapsed = clamp(state.day - shipment.dispatchedDay, 0, span);
    const progress = elapsed / span;
    const remaining = Math.max(0, shipment.arrivesDay - state.day);
    return `
      <div class="transit-row">
        <span class="transit-target"><b>${esc(division?.name || shipment.divisionId)}</b><small>${line?.type === 'rail' ? '铁路' : '公路'} · ${esc(shipment.id)}</small></span>
        <span class="transit-cargo">弹 ${num(shipment.cargo.ammo)} D　给 ${num(shipment.cargo.supply)} D</span>
        <span class="transit-progress"><i><em style="width:${Math.round(progress * 100)}%"></em></i><small>${Math.round(progress * 100)}% · 还有 ${remaining} 天</small></span>
        <b class="transit-eta">D${shipment.arrivesDay} 抵达</b>
      </div>
    `;
  }).join('');
  return `
    <section class="transit-board" aria-label="全部在途运输">
      <header>
        <div><strong>全部在途运输</strong><span>${shipments.length} 批 · 弹 ${num(transitAmmo)} D · 给 ${num(transitSupply)} D</span></div>
        <small>${shipments.length > 0 ? '按预计抵达时间排序' : '发车后会在这里逐批跟踪'}</small>
      </header>
      <div class="transit-list">${rows || '<p class="transit-empty">目前没有在途物资。</p>'}</div>
    </section>
  `;
}

function effectivenessBreakdown(division) {
  const ammoTier = ammoTierOf(division);
  const fatigueFactor = 1 - division.fatigue;
  const integrationFactor = division.integrationEffPenalty || 1;
  return {
    effectiveness: computeEffectiveness(division),
    manpower: division.manpowerRatio,
    ammoDays: division.ammoDays,
    ammoFactor: ammoTier.combatMult,
    equipment: division.equipmentReady,
    fatigue: division.fatigue,
    fatigueFactor,
    integrationFactor,
  };
}

function renderFrontRequests() {
  const active = state.frontRequests.filter((request) => (
    state.day >= request.announcedDay && state.day <= request.battleDay
  ));
  const rows = active.map((request) => {
    const division = state.divisions.find((item) => item.id === request.divisionId);
    const line = MAP.lines.find((item) => item.divisionId === request.divisionId);
    const earliestArrival = state.day + 1 + line.transitDays;
    const canStillArrive = earliestArrival <= request.battleDay;
    const shortfall = Math.max(0, request.requestedAmmo - request.deliveredAmmo);
    return `
      <div class="request-row ${canStillArrive ? '' : 'window-closed'}">
        <div><b>${esc(division.name)} · D${request.battleDay} 交战</b><small>${canStillArrive ? `今日命令最早 D${earliestArrival} 到达` : '发运窗口已关闭'}</small></div>
        <span>申请 ${num(request.requestedAmmo)} D</span>
        <span>已到 ${num(request.deliveredAmmo)} D</span>
        <strong>${shortfall > 1e-6 ? `差额 ${num(shortfall)} D` : '已满足'}</strong>
      </div>
    `;
  }).join('');
  return `
    <section class="request-board" aria-label="前线公开请求">
      <header><strong>前线公开请求</strong><small>“申请”是战前弹药目标（D），不是配额或百分比；只记录当时已知的需求，不预判决策对错</small></header>
      ${rows || '<p class="request-empty">当前没有已公开的战前请求。</p>'}
    </section>
  `;
}

function renderCampaignResult() {
  if (!state.ended || !state.campaign.result) return '';
  return `
    <section class="campaign-result ${state.campaign.result.code}">
      <div><span>战役评价</span><strong>${esc(state.campaign.result.label)}</strong><p>${esc(state.campaign.reason)}</p></div>
      ${state.divisions.map((division) => `
        <div class="campaign-division"><b>${esc(division.name)}</b><span>战线 ${division.frontPosition >= 0 ? '+' : ''}${division.frontPosition} km</span><span>伤亡 ${num(division.casualtiesTotal)} 点</span><span>装备 ${Math.round(division.equipmentReady * 100)}%</span></div>
      `).join('')}
    </section>
  `;
}

// ---- SVG 片段：基地 ----
function renderBaseNode() {
  const pos = NODE_POS.base;
  const periodStart = state.quota.nextArrivalDay - state.quota.periodDays;
  const periodProgress = clamp((state.day - periodStart) / state.quota.periodDays, 0, 1);
  const ammoPct = clamp(state.base.ammo / BASE_BAR_MAX.ammo, 0, 1);
  const supplyPct = clamp(state.base.supply / BASE_BAR_MAX.supply, 0, 1);
  const barH = 90; const barY = pos.y - 40;
  const nextAmountText = state.quota.nextAmount === null ? '未公开' : `${num(state.quota.nextAmount)} D`;
  return `
    <g class="node-base" transform="translate(${pos.x - 70}, ${pos.y - 90})">
      <rect class="hull" x="0" y="0" width="140" height="160" rx="10"></rect>
      <text class="node-label" x="70" y="18" text-anchor="middle">后方基地</text>
      <text class="node-sub" x="70" y="32" text-anchor="middle">人员池 ${num(state.personnel.pool, 0)} 点</text>

      <rect class="bar-track" x="34" y="40" width="20" height="${barH}"></rect>
      <rect class="bar-fill-ammo" x="34" y="${40 + barH * (1 - ammoPct)}" width="20" height="${barH * ammoPct}"></rect>
      <text class="node-sub" x="44" y="145" text-anchor="middle">弹 ${num(state.base.ammo)}D</text>

      <rect class="bar-track" x="86" y="40" width="20" height="${barH}"></rect>
      <rect class="bar-fill-supply" x="86" y="${40 + barH * (1 - supplyPct)}" width="20" height="${barH * supplyPct}"></rect>
      <text class="node-sub" x="96" y="145" text-anchor="middle">给 ${num(state.base.supply)}D</text>

      <rect class="bar-track" x="20" y="0" width="100" height="6" transform="translate(0,-10)" style="opacity:0"></rect>
    </g>
    <g transform="translate(${pos.x - 70}, ${pos.y - 130})">
      <rect x="0" y="0" width="140" height="28" rx="6" fill="#0b1512" stroke="#33493d"></rect>
      <rect x="2" y="2" width="${136 * periodProgress}" height="24" rx="5" fill="#3a5a49"></rect>
      <text class="node-sub" x="70" y="18" text-anchor="middle">下批 D${state.quota.nextArrivalDay} · ${esc(nextAmountText)}</text>
    </g>
  `;
}

function renderTransitNode(id) {
  const pos = NODE_POS[id];
  const label = MAP.transitNodes.find((t) => t.id === id)?.name || id;
  return `
    <g transform="translate(${pos.x}, ${pos.y})">
      <rect class="transit-mark" x="-9" y="-9" width="18" height="18" transform="rotate(45)"></rect>
      <text class="transit-label" x="0" y="-16" text-anchor="middle">${esc(label)}</text>
    </g>
  `;
}

function renderLine(line) {
  const points = LINE_PATH_NODES[line.id].map((id) => NODE_POS[id]);
  const pathAttr = points.map((p) => `${p.x},${p.y}`).join(' ');
  const isRail = line.type === 'rail';
  const strokeWidth = isRail ? 7 : 3.5;
  const mid = pointAlongPath(points, 0.68);
  return `
    <g>
      <polyline id="edge-visible-${line.id}" class="edge-visible ${isRail ? 'edge-rail' : 'edge-road'}" points="${pathAttr}" stroke-width="${strokeWidth}"></polyline>
      <polyline class="edge-hit" data-select-line="${line.id}" points="${pathAttr}"></polyline>
      ${line.fragility === 'high' ? `<text class="hazard-mark" x="${mid.x}" y="${mid.y - 10}" text-anchor="middle">脆弱</text>` : ''}
    </g>
  `;
}

function renderConvoys() {
  return state.transitQueue.map((shipment) => {
    const line = MAP.lines.find((l) => l.id === shipment.lineId);
    if (!line) return '';
    const points = LINE_PATH_NODES[line.id].map((id) => NODE_POS[id]);
    const span = Math.max(1, shipment.arrivesDay - shipment.dispatchedDay);
    const t = clamp((state.day - shipment.dispatchedDay) / span, 0, 1);
    const pos = pointAlongPath(points, t);
    const badgePos = pointAlongPath(points, 0.56);
    const title = `${line.id} → ${shipment.divisionId} · 弹药${num(shipment.cargo.ammo)}/给养${num(shipment.cargo.supply)} · 预计 D${shipment.arrivesDay} 抵达`;
    const badgeWidth = 174;
    return `
      <g class="convoy-group">
        <circle class="convoy" cx="${pos.x}" cy="${pos.y}" r="5"><title>${esc(title)}</title></circle>
        <g class="convoy-badge" transform="translate(${badgePos.x - badgeWidth / 2}, ${badgePos.y + 11})">
          <rect width="${badgeWidth}" height="22" rx="5"></rect>
          <text x="${badgeWidth / 2}" y="15" text-anchor="middle">在途：弹 ${num(shipment.cargo.ammo)}D · 给 ${num(shipment.cargo.supply)}D · D${shipment.arrivesDay}到</text>
        </g>
      </g>
    `;
  }).join('');
}

function renderDivisionNode(division) {
  const nodeId = FRONT_NODE_OF_DIVISION[division.id];
  const pos = NODE_POS[nodeId];
  const visible = division.lastReportSnapshot || division;
  const breakdown = effectivenessBreakdown(visible);
  const effectiveness = breakdown.effectiveness;
  const r = 34; const circumference = 2 * Math.PI * r;
  const dash = effectiveness * circumference;
  const color = effectivenessColor(effectiveness);
  const meta = PERSONALITY_META[division.id];
  const delay = Math.max(0, state.day - visible.day);
  const opacity = clamp(1 - delay * 0.14, 0.45, 1);
  const grayscale = clamp(delay * 22, 0, 55);
  const staleNote = delay > 0 ? `情报滞后 ${delay} 天（D${visible.day} 的数据）` : `情报为当日（D${visible.day}）`;
  const effectivenessTip = `综合效能 = 满编 ${(breakdown.manpower * 100).toFixed(0)}% × 弹药系数 ${breakdown.ammoFactor.toFixed(2)}（${num(breakdown.ammoDays)} D） × 装备 ${(breakdown.equipment * 100).toFixed(0)}% × 抗疲劳 ${(breakdown.fatigueFactor * 100).toFixed(0)}% × 整编 ${breakdown.integrationFactor.toFixed(2)} = ${(effectiveness * 100).toFixed(0)}%\n点击查看逐项计算；${staleNote}`;
  return `
    <g class="division-node" data-select-division="${division.id}" transform="translate(${pos.x}, ${pos.y})"
       style="opacity:${opacity}; filter:grayscale(${grayscale}%)">
      <title>${esc(effectivenessTip)}</title>
      ${visible.underAttack ? `<circle class="attack-glow" r="${r + 8}"></circle>` : ''}
      <circle class="ring-bg" r="${r}"></circle>
      <circle class="ring-fg" r="${r}" stroke="${color}"
        stroke-dasharray="${dash} ${circumference - dash}"
        transform="rotate(-90)"></circle>
      <text class="division-pct" text-anchor="middle" y="5">效能 ${Math.round(effectiveness * 100)}%</text>
      <g class="personality-chip" transform="translate(-46, -${r + 26})">
        <rect width="22" height="16" fill="${meta.color}" fill-opacity="0.25" stroke="${meta.color}"></rect>
        <text x="11" y="12" text-anchor="middle" fill="${meta.color}">${esc(meta.code)}</text>
      </g>
      <text class="division-name" text-anchor="middle" y="-${r + 14}">${esc(division.name)}</text>
      <text class="division-posture" text-anchor="middle" y="${r + 20}">${esc(POSTURE_LABEL[visible.posture] || visible.posture)}${visible.underAttack ? ' · 交战中' : ''}</text>
      <text class="division-detail" text-anchor="middle" y="${r + 34}">弹${num(visible.ammoDays)}D 给${num(visible.supplyDays)}D 满编${Math.round(visible.manpowerRatio * 100)}%</text>
      <text class="front-position" text-anchor="middle" y="${r + 48}">战线 ${visible.frontPosition >= 0 ? '+' : ''}${visible.frontPosition} km${visible.collapsed ? ' · 已失去建制' : ''}</text>
      <text class="stale-note" text-anchor="middle" y="${r + 61}">${esc(staleNote)}</text>
    </g>
  `;
}

// ---- 弹出面板 ----
function lineNameOf(line) {
  const target = MAP.divisions.find((d) => d.id === line.divisionId)?.name || line.divisionId;
  return `${line.type === 'rail' ? '铁路' : '公路'} → ${target}`;
}

function renderLinePopover(lineId) {
  const line = MAP.lines.find((l) => l.id === lineId);
  const ratio = state.orders.lineRatios[lineId];
  const field = (key, label) => `
    <label>${label} <b style="float:right" data-ratio-label="${key}">${Math.round(ratio[key] * 100)}%</b></label>
    <input type="range" min="0" max="1" step="0.01" value="${ratio[key]}" data-ratio-input="${key}">
  `;
  return `
    <div id="popover" data-kind="line">
      <header><h3>${esc(lineNameOf(line))} · 今日待发车队</h3><button class="close" data-close type="button">×</button></header>
      <p class="pop-sub">吞吐 ${line.throughputPerDay}/日 · 在途 ${line.transitDays} 天 · 脆弱度 ${esc(line.fragility)}</p>
      ${field('ammo', '本日待发：弹药占装载量')}
      ${field('supply', '本日待发：给养占装载量')}
      <p class="pop-sub" style="margin-top:8px">两项恒为 100%，只决定这条线下一批发车的货物构成；不改变该线的发运份额、配额，也绝不改动已经在途的批次。人员通过训练、人员池和整编单独流转，不占物资车队运力。</p>
    </div>
  `;
}

function renderDivisionPopover(divisionId) {
  const division = state.divisions.find((d) => d.id === divisionId);
  const visible = division.lastReportSnapshot || division;
  const breakdown = effectivenessBreakdown(visible);
  const delay = Math.max(0, state.day - visible.day);
  const reportDay = delay > 0 ? `D${visible.day}（滞后 ${delay} 天）` : `D${visible.day}（当日）`;
  return `
    <div id="popover" data-kind="division">
      <header><h3>${esc(division.name)} 指令</h3><button class="close" data-close type="button">×</button></header>
      <p class="pop-sub">${esc(PERSONALITY_META[divisionId].label)} · 服从${num(division.personality.obedience * 100, 0)}% · 自知${num(division.personality.selfAwareness * 100, 0)}%</p>
      <section class="effectiveness-breakdown" aria-label="综合效能计算过程">
        <strong>综合效能 ${num(breakdown.effectiveness * 100, 0)}% <small>报告：${reportDay}</small></strong>
        <p>满编率 × 弹药档位 × 装备 × 抗疲劳 × 整编系数</p>
        <div><span>满编率</span><b>${num(breakdown.manpower * 100, 0)}%</b></div>
        <div><span>弹药档位（${num(breakdown.ammoDays)} D）</span><b>× ${num(breakdown.ammoFactor, 2)}</b></div>
        <div><span>装备完好率</span><b>${num(breakdown.equipment * 100, 0)}%</b></div>
        <div><span>疲劳 ${num(breakdown.fatigue * 100, 0)}%</span><b>抗疲劳 × ${num(breakdown.fatigueFactor, 2)}</b></div>
        <div><span>整编系数</span><b>× ${num(breakdown.integrationFactor, 2)}</b></div>
      </section>
      <label>补给优先级</label>
      <input type="number" min="0" step="1" value="${state.orders.divisionPriority[divisionId]}" data-order="priority" data-division="${divisionId}">
      <label>最低储备线（天）</label>
      <input type="number" min="0" step="1" value="${state.orders.minReserveDays[divisionId]}" data-order="reserve" data-division="${divisionId}">
      <label>本轮分配人员（池中还剩 ${num(state.personnel.pool, 0)} 点）</label>
      <input type="number" min="0" max="${Math.max(0, Math.floor(state.personnel.pool))}" step="1" value="${state.orders.personnelAssignment[divisionId] || 0}" data-order="personnel" data-division="${divisionId}">
      <div class="checkline">
        <input type="checkbox" id="truth-${divisionId}" ${state.orders.briefTruth[divisionId] ? 'checked' : ''} data-order="truth" data-division="${divisionId}">
        <label for="truth-${divisionId}" style="margin:0">回电告知真相（降低他的误判偏差）</label>
      </div>
    </div>
  `;
}

function currentAnchorPoint() {
  if (!selection) return null;
  if (selection.type === 'division') {
    const nodeId = FRONT_NODE_OF_DIVISION[selection.id];
    const pos = NODE_POS[nodeId];
    return { x: pos.x - 90, y: pos.y - 40 };
  }
  const points = LINE_PATH_NODES[selection.id].map((id) => NODE_POS[id]);
  const mid = pointAlongPath(points, 0.55);
  return { x: mid.x - 120, y: mid.y - 40 };
}

function positionPopover() {
  const svg = document.querySelector('#map-svg');
  const popover = document.querySelector('#popover');
  const anchor = currentAnchorPoint();
  if (!svg || !popover || !anchor) return;
  const rect = svg.getBoundingClientRect();
  const scaleX = rect.width / VIEW_W;
  const scaleY = rect.height / VIEW_H;
  let left = rect.left + anchor.x * scaleX;
  let top = rect.top + anchor.y * scaleY;
  left = clamp(left, 8, window.innerWidth - popover.offsetWidth - 8);
  top = clamp(top, 8, window.innerHeight - popover.offsetHeight - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

// ---- 侧栏：战报与总部指令 ----
function renderTicker() {
  const items = state.eventLog.slice(-24).reverse().map((event) => {
    const text = event.text
      || (event.type === 'dispatch' ? `已按规则发出 ${event.count} 支车队。`
        : event.type === 'training-complete' ? `${event.count} 名人员完成${event.track === 'urgent' ? '紧急' : '正常'}训练，进入待分配人员池。`
          : event.type === 'mobilization-arrived' ? `国家动员到位 ${event.count} 点，转入训练队列。`
            : event.type === 'quota-advance-rejected' ? `预支 ${num(event.requested)} D 被拒绝（可用额度仅 ${num(event.available)} D）。`
              : event.type);
    return `<div class="ticker-item ${event.type === 'request-context' ? 'request-context' : ''}"><span class="ticker-day">D${event.day}</span>${esc(text)}</div>`;
  }).join('');
  return items || '<p class="muted">尚无战报。</p>';
}

function render() {
  const lines = MAP.lines.map(renderLine).join('');
  const transitNodes = MAP.transitNodes.map((t) => renderTransitNode(t.id)).join('');
  const divisions = state.divisions.map(renderDivisionNode).join('');

  app.innerHTML = `
    <div class="topbar">
      <div>
        <h1>后勤指挥 · 战区态势图（交互原型）</h1>
        <div class="sub">第 ${state.day} / 30 天${state.ended ? ` · ${esc(state.campaign.result?.label || '战役结束')}` : ''}</div>
      </div>
      <button id="advance" ${state.ended ? 'disabled' : ''}>${state.ended ? (state.campaign.result?.label || '战役结束') : `执行发运单 · 进入 D${state.day + 1} →`}</button>
    </div>
    <div class="note"><b>这是一份交互语言实验</b>：数值规则与 logistics-core.js 完全一致，改的只是操作方式——点线调配比，点师调指令，不再是整页表格。</div>
    ${renderCampaignResult()}
    ${renderFlowOverview()}
    <div class="layout">
      <div id="map-wrap">
        <svg id="map-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}">
          ${lines}
          ${transitNodes}
          ${renderConvoys()}
          ${renderBaseNode()}
          ${divisions}
        </svg>
      </div>
      <div id="dock">
        <div class="dock-section request-dock">
          ${renderFrontRequests()}
        </div>
        <div class="dock-section transit-dock">
          ${renderTransitBoard()}
        </div>
        <div class="dock-section">
          <h2>总部指令（全局）</h2>
          <div class="hq-row"><span>训练档位</span>
            <select data-global="trainingTrack">
              <option value="normal" ${state.orders.trainingTrack === 'normal' ? 'selected' : ''}>正常 7 天</option>
              <option value="urgent" ${state.orders.trainingTrack === 'urgent' ? 'selected' : ''}>紧急 0 天</option>
            </select>
          </div>
          <div class="hq-row"><span>预支下期配额 D</span>
            <input type="number" min="0" max="3" step="0.1" value="0" data-global="advanceQuota">
          </div>
        </div>
        <div class="dock-section" style="flex:1; display:flex; flex-direction:column; min-height:0;">
          <h2>每日战报</h2>
          <div id="ticker">${renderTicker()}</div>
        </div>
        <div class="dock-section">
          <h2>图例</h2>
          <div class="legend-row"><span class="legend-swatch" style="background:#d98a5f"></span>铁路（高吞吐 · 脆弱）</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#5f9f86"></span>公路（低吞吐 · 韧性强）</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#70d59a"></span>效能 ≥70%　<span class="legend-swatch" style="background:#f1b36d"></span>40-70%　<span class="legend-swatch" style="background:#ed6f63"></span>&lt;40%</div>
          <div class="legend-row">节点变灰变暗 = 情报滞后天数越久</div>
        </div>
      </div>
    </div>
    ${selection ? (selection.type === 'line' ? renderLinePopover(selection.id) : renderDivisionPopover(selection.id)) : ''}
  `;

  bindEvents();
  if (selection) positionPopover();
}

function updateRatio(lineId, field, rawValue) {
  const ratio = state.orders.lineRatios[lineId];
  const value = clamp(Number(rawValue) || 0, 0, 1);
  const fields = ['ammo', 'supply'];
  const others = fields.filter((key) => key !== field);
  const remaining = 1 - value;
  const othersSum = others.reduce((sum, key) => sum + ratio[key], 0);
  if (othersSum <= 1e-6) {
    others.forEach((key) => { ratio[key] = remaining / others.length; });
  } else {
    others.forEach((key) => { ratio[key] = (ratio[key] / othersSum) * remaining; });
  }
  ratio[field] = value;

  // 直接改 DOM 同步另外两条滑条与百分比文字，不整页重渲染——
  // 避免拖动中途 innerHTML 被替换导致原生 range 控件丢失拖拽状态。
  const popover = document.querySelector('#popover');
  if (!popover) return;
  fields.forEach((key) => {
    const input = popover.querySelector(`[data-ratio-input="${key}"]`);
    const label = popover.querySelector(`[data-ratio-label="${key}"]`);
    if (input) input.value = ratio[key];
    if (label) label.textContent = `${Math.round(ratio[key] * 100)}%`;
  });
}

function bindEvents() {
  app.querySelector('[data-toggle-dispatch]')?.addEventListener('click', () => {
    dispatchPanelOpen = !dispatchPanelOpen;
    render();
  });

  app.querySelector('#advance')?.addEventListener('click', () => {
    advanceDay(state);
    render();
  });

  app.querySelectorAll('[data-select-line]').forEach((el) => {
    el.addEventListener('click', () => {
      selection = { type: 'line', id: el.dataset.selectLine };
      render();
    });
    el.addEventListener('mouseenter', () => document.getElementById(`edge-visible-${el.dataset.selectLine}`)?.classList.add('hovered'));
    el.addEventListener('mouseleave', () => document.getElementById(`edge-visible-${el.dataset.selectLine}`)?.classList.remove('hovered'));
  });

  app.querySelectorAll('[data-select-division]').forEach((el) => {
    el.addEventListener('click', () => {
      selection = { type: 'division', id: el.dataset.selectDivision };
      render();
    });
  });

  app.querySelector('[data-close]')?.addEventListener('click', () => { selection = null; render(); });

  app.querySelectorAll('[data-ratio-input]').forEach((input) => {
    input.addEventListener('input', () => updateRatio(selection.id, input.dataset.ratioInput, input.value));
  });

  app.querySelectorAll('[data-order]').forEach((input) => {
    input.addEventListener('change', () => {
      const divisionId = input.dataset.division;
      const field = input.dataset.order;
      if (field === 'priority') state.orders.divisionPriority[divisionId] = Math.max(0, Number(input.value) || 0);
      if (field === 'reserve') state.orders.minReserveDays[divisionId] = Math.max(0, Number(input.value) || 0);
      if (field === 'personnel') state.orders.personnelAssignment[divisionId] = Math.max(0, Number(input.value) || 0);
      if (field === 'truth') state.orders.briefTruth[divisionId] = input.checked;
    });
  });

  app.querySelectorAll('[data-priority-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const divisionId = button.dataset.division;
      state.orders.divisionPriority[divisionId] = Math.max(
        0,
        (state.orders.divisionPriority[divisionId] || 0) + Number(button.dataset.priorityStep),
      );
      render();
    });
  });

  app.querySelectorAll('[data-global]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.global;
      if (key === 'trainingTrack') state.orders.trainingTrack = input.value;
      if (key === 'dailyShipmentCap') {
        state.orders.dailyShipmentCap = Math.max(0, Number(input.value) || 0);
        render();
      }
      if (key === 'advanceQuota') state.orders.advanceQuota = Math.max(0, Number(input.value) || 0);
    });
  });

  window.onresize = () => { if (selection) positionPopover(); };
}

render();
