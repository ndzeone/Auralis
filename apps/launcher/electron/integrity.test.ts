import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecksumValidator } from '@xmcl/file-transfer';
import { DownloadTask } from '@xmcl/installer';
import { MockAgent, interceptors } from 'undici';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'auralis-integrity-'));
  directories.push(directory);
  const path = join(directory, 'client.jar');
  const trusted = Buffer.from('trusted-client-artifact');
  const checksum = { algorithm: 'sha1', hash: createHash('sha1').update(trusted).digest('hex') };
  return { path, trusted, checksum };
}
describe('Minecraft installer artifact integrity', () => {
  it('rejects a corrupt cached artifact even when its size matches', async () => {
    const { path, trusted, checksum } = await fixture();
    await writeFile(path, Buffer.alloc(trusted.length, 'x'));
    await expect(new ChecksumValidator(checksum).validate(path, 'https://example.invalid/client.jar')).rejects.toThrow();
    await writeFile(path, trusted);
    await expect(new ChecksumValidator(checksum).validate(path, 'https://example.invalid/client.jar')).resolves.toBeUndefined();
  });
  it('repairs same-size corruption through the actual installer download task', async () => {
    const { path, trusted, checksum } = await fixture();
    await writeFile(path, Buffer.alloc(trusted.length, 'x'));
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.get('https://example.invalid').intercept({ path: '/client.jar', method: 'GET' }).reply(200, trusted, { headers: { 'content-length': String(trusted.length) } });
    try {
      const task = new DownloadTask({ url: 'https://example.invalid/client.jar', destination: path, validator: checksum, dispatcher: agent.compose(interceptors.redirect({ maxRedirections: 5 })) });
      await task.startAndWait();
      expect(await readFile(path)).toEqual(trusted);
      expect(task.isDone).toBe(true);
    } finally { await agent.close(); }
  });
  it('rejects a newly downloaded artifact with the wrong checksum', async () => {
    const { path, trusted, checksum } = await fixture();
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.get('https://example.invalid').intercept({ path: '/client.jar', method: 'GET' }).reply(200, Buffer.alloc(trusted.length, 'x'), { headers: { 'content-length': String(trusted.length) } });
    try {
      const task = new DownloadTask({ url: 'https://example.invalid/client.jar', destination: path, validator: checksum, dispatcher: agent.compose(interceptors.redirect({ maxRedirections: 5 })) });
      await expect(task.startAndWait()).rejects.toMatchObject({ name: 'ChecksumNotMatchError' });
    } finally { await agent.close(); }
  });

});
