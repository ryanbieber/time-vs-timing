import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const reportedBasePath = process.env.BASE_PATH

export default defineConfig({
  plugins: [react()],
  base: reportedBasePath ? `${reportedBasePath.replace(/\/$/, '')}/` : '/',
  build: {
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: ['src/engine/types.ts'],
      thresholds: {
        lines: 90,
        branches: 90,
      },
    },
  },
})
