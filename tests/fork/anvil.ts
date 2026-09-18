import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function anvilBinary(): string | undefined {
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;
  const foundry = join(homedir(), '.foundry', 'bin', 'anvil');
  if (existsSync(foundry)) return foundry;
  const onPath = (process.env.PATH ?? '').split(':').map((d) => join(d, 'anvil')).find(existsSync);
  return onPath;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export interface Anvil {
  url: string;
  stop(): void;
}

/** Start an anvil fork of `forkUrl` and resolve once it answers JSON-RPC. */
export async function startAnvilFork(bin: string, forkUrl: string): Promise<Anvil> {
  const port = await freePort();
  const child: ChildProcess = spawn(bin, ['--fork-url', forkUrl, '--port', String(port), '--silent'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d) => (stderr += d));
  const url = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`anvil exited early: ${stderr}`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return { url, stop: () => child.kill('SIGTERM') };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  child.kill('SIGKILL');
  throw new Error(`anvil did not become ready: ${stderr}`);
}
