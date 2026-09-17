import { defineConfig } from 'vite';

export default defineConfig({
  // 独立的后勤原型入口；不复用已移除的自动战斗原型页面。
  build: {
    rollupOptions: {
      input: { logistics: 'logistics-demo.html', 'logistics-map': 'logistics-map-demo.html' },
    },
  },
});
