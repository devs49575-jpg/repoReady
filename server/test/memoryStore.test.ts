import { afterEach, describe, expect, it } from 'vitest';
import { MemoryAnalysisStore } from '../src/stores/memoryStore';

const doc = {
  owner: 'acme',
  repo: 'secret',
  fullName: 'acme/secret',
  commitSha: 'abc',
  step: 'Waiting in queue',
  progress: 0,
};

let store: MemoryAnalysisStore;
afterEach(() => store?.close());

function makeStore(maxEntries = 3) {
  let now = 1_000_000;
  store = new MemoryAnalysisStore({ ttlMinutes: 60, maxEntries, now: () => now });
  return { store, advance: (ms: number) => (now += ms) };
}

describe('MemoryAnalysisStore', () => {
  it('issues unguessable p_ ids of 32 random characters', async () => {
    const { store } = makeStore(100);
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add((await store.create(doc)).id);
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^p_[A-Za-z0-9_-]{32}$/);
  });

  it('stores, updates and deletes private analyses', async () => {
    const { store } = makeStore();
    const created = await store.create(doc);
    expect(created).toMatchObject({ visibility: 'private', status: 'queued' });
    expect(created.expiresAt.getTime() - created.createdAt.getTime()).toBe(60 * 60_000);
    await store.update(created.id, { status: 'running', progress: 30 });
    expect(await store.get(created.id)).toMatchObject({ status: 'running', progress: 30 });
    expect(await store.delete(created.id)).toBe(true);
    expect(await store.get(created.id)).toBeNull();
    expect(await store.delete(created.id)).toBe(false);
  });

  it('treats an expired entry as missing even before the sweep runs', async () => {
    const { store, advance } = makeStore();
    const created = await store.create(doc);
    advance(60 * 60_000 - 1);
    expect(await store.get(created.id)).not.toBeNull();
    advance(1);
    expect(await store.get(created.id)).toBeNull();
  });

  it('sweeps expired entries', async () => {
    const { store, advance } = makeStore();
    await store.create(doc);
    await store.create(doc);
    advance(61 * 60_000);
    expect(store.sweep()).toBe(2);
    expect(store.size).toBe(0);
  });

  it('evicts the oldest entry when full, so memory stays bounded', async () => {
    const { store } = makeStore(3);
    const first = await store.create(doc);
    const second = await store.create(doc);
    await store.create(doc);
    await store.create(doc);
    expect(store.size).toBe(3);
    expect(await store.get(first.id)).toBeNull();
    expect(await store.get(second.id)).not.toBeNull();
  });

  it('ignores updates to deleted reports instead of resurrecting them', async () => {
    const { store } = makeStore();
    const created = await store.create(doc);
    await store.delete(created.id);
    await store.update(created.id, { status: 'done' });
    expect(await store.get(created.id)).toBeNull();
    expect(store.size).toBe(0);
  });
});
