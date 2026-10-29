import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('DMG must be built on macOS.');
const env = { ...process.env };
const args = ['pnpm', 'exec', 'electron-builder', '--mac', 'dmg', 'zip', '--arm64', '--publish', 'never'];
if (!env.CSC_LINK?.trim()) {
  delete env.CSC_LINK;
  delete env.CSC_KEY_PASSWORD;
  args.push('--config.mac.identity=-', '--config.mac.entitlements=build/entitlements.adhoc.plist', '--config.mac.entitlementsInherit=build/entitlements.adhoc.plist', '--config.mac.notarize=false');
  console.log('Local ad-hoc signing: integrity protection only, not Apple Developer ID or notarization.');
}
const result = spawnSync('corepack', args, { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
