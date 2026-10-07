import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { writeTone } from './e2e/tone.js';

// End-to-end tests: the built app in Chromium, sized and behaving like an iPhone.
// The fake microphone plays a generated tone, so the recorder and tuner have something to hear.
const tone = path.join(os.tmpdir(), 'woodshed-e2e-tone.wav');
writeTone(tone);

const PORT = 4173;
const phone = (name) => ({ ...devices[name], browserName: 'chromium', defaultBrowserType: 'chromium' });

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    permissions: ['microphone', 'camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${tone}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone-13', use: phone('iPhone 13') },
    // The narrowest phone: layout checks, on the specs tagged @narrow.
    { name: 'iphone-se', use: phone('iPhone SE'), grep: /@narrow/ },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
