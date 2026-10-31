import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/application/errors.js';
import { createDeps, resolveStateDir } from '../../src/composition/container.js';
import { VERSION } from '../../src/composition/version.js';
import { ROOT } from '../support/analysis.js';

describe('composition', () => {
  it('resolves the state directory in the documented order', () => {
    expect(resolveStateDir('/explicit', { PROPOSAL_DESK_STATE: '/env' }, '/home/u')).toBe('/explicit');
    expect(resolveStateDir(undefined, { PROPOSAL_DESK_STATE: '/env', XDG_STATE_HOME: '/xdg' }, '/home/u')).toBe('/env');
    expect(resolveStateDir(undefined, { XDG_STATE_HOME: '/xdg' }, '/home/u')).toBe('/xdg/proposal-desk');
    expect(resolveStateDir(undefined, { XDG_STATE_HOME: 'relative/path' }, '/home/u')).toBe('/home/u/.local/state/proposal-desk');
    expect(resolveStateDir(undefined, { PROPOSAL_DESK_STATE: '' }, '/home/u')).toBe('/home/u/.local/state/proposal-desk');
    expect(resolveStateDir(undefined, {}, '/home/u')).toBe('/home/u/.local/state/proposal-desk');
  });

  it('creates a private state directory and refuses a symbolic link or an open one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proposal-desk-comp-'));
    const terminal = { input: new PassThrough(), output: new PassThrough() };
    const state = join(root, 'a', 'b', 'state');
    const deps = await createDeps({ state, env: {}, terminal });
    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(deps.facts(undefined).store.location).toBe(join(state, 'facts.json'));
    expect(deps.facts('relative/facts.json').store.location).toMatch(/relative\/facts\.json$/);
    expect(deps.clock.now()).toMatch(/^\d{4}-\d\d-\d\dT/);
    mkdirSync(join(root, 'real'), { mode: 0o700 });
    symlinkSync(join(root, 'real'), join(root, 'link'));
    await expect(createDeps({ state: join(root, 'link'), env: {}, terminal })).rejects.toThrow('symbolic link');
    writeFileSync(join(root, 'file'), '');
    await expect(createDeps({ state: join(root, 'file'), env: {}, terminal })).rejects.toBeInstanceOf(AppError);
  });

  it('keeps the version constant equal to package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string; engines: { node: string } };
    expect(VERSION).toBe(pkg.version);
    expect(pkg.engines.node).toBe('>=22.12');
  });
});
