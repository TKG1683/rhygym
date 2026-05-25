/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 配信用に base を '/rhygym/' に固定。
// dev でも同じ base で動かして本番との差をなくす。
export default defineConfig({
  plugins: [react()],
  base: '/rhygym/',
  server: {
    // 0.0.0.0 にバインドして LAN 上の端末 (スマホ実機) から
    // http://<PC の LAN IP>:5173/rhygym/ で確認できるようにする。
    host: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'test/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
    ],
    passWithNoTests: true,
  },
});
