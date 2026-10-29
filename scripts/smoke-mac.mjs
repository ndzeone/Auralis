import { _electron } from '@playwright/test';
import path from 'node:path';

const executablePath = path.resolve('apps/launcher/release/mac-arm64/Auralis.app/Contents/MacOS/Auralis');
const app = await _electron.launch({ executablePath, timeout: 45000 });
try {
  const window = await app.firstWindow({ timeout: 30000 });
  await window.waitForFunction(() => typeof window.auralis?.getState === 'function');
  const state = await window.evaluate(() => window.auralis.getState());
  if (!state.profiles?.length || state.platform !== 'darwin') throw new Error('Packaged macOS launcher failed its IPC readiness check.');
  console.log(`Packaged macOS launcher opened, renderer and IPC ready: ${state.appVersion}`);
} finally {
  await app.close();
}
