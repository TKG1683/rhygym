/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 配信用に base を '/rhygym/' に固定。
// dev でも同じ base で動かして本番との差をなくす。
export default defineConfig({
  plugins: [react()],
  base: '/rhygym/',
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
