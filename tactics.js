// Tactical zones are deliberately independent from unit AI.  A zone describes
// a place and its meaning; the battle simulation decides how each role reacts.
(() => {
  const definitions = {
    rally: {
      label: '集结区', color: '#70caf4', fill: '#4fc3f722', radius: 92,
      hint: '地面单位在未交战时优先靠拢，并在此重整。'
    },
    suppress: {
      label: '压制区', color: '#bf8cff', fill: '#bf8cff22', radius: 108,
      hint: '机枪、榴弹与坦克优先压制区内敌人。'
    },
    fire: {
      label: '火力覆盖区', color: '#ffcf70', fill: '#ffcf7022', radius: 116,
      hint: '榴弹兵与坦克优先炮击区内目标；友军避免贴近。'
    },
    danger: {
      label: '危险区', color: '#ff8a7c', fill: '#ff8a7c20', radius: 96,
      hint: '地面单位会把这片区域当作风险地带并绕开。'
    }
  };

  class ZoneController {
    constructor() {
      this.zones = [];
      this.selectedType = 'rally';
      this.maxZones = 3;
    }

    select(type) { if (definitions[type]) this.selectedType = type; }
    clear() { this.zones.length = 0; }
    add(x, y) {
      if (this.zones.length >= this.maxZones) this.zones.shift();
      const def = definitions[this.selectedType];
      const zone = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, type: this.selectedType, x, y, radius: def.radius };
      this.zones.push(zone);
      return zone;
    }
    removeAt(x, y) {
      const index = this.zones.findIndex(zone => Math.hypot(zone.x - x, zone.y - y) < zone.radius);
      if (index >= 0) this.zones.splice(index, 1);
    }
    contains(zone, target) { return Math.hypot(zone.x - target.x, zone.y - target.y) <= zone.radius; }
    nearest(type, target) {
      const matches = this.zones.filter(zone => zone.type === type);
      return matches.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0] || null;
    }
    draw(ctx) {
      for (const zone of this.zones) {
        const def = definitions[zone.type];
        ctx.save();
        ctx.fillStyle = def.fill; ctx.strokeStyle = def.color; ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = def.color; ctx.font = '600 12px Inter, Microsoft YaHei';
        ctx.textAlign = 'center'; ctx.fillText(def.label, zone.x, zone.y - zone.radius - 8);
        ctx.restore();
      }
    }
  }

  window.Tactics = { definitions, ZoneController };
})();
