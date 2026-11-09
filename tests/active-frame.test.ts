import { afterEach, expect, it, vi } from 'vitest';
import { createActiveFrame } from '../src/ui/active-frame';

afterEach(() => vi.unstubAllGlobals());

it('reserves a single frame for active rendering and cancels it on leave', () => {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  function draw(time: number) {
    const [id, callback] = pending.entries().next().value!;
    pending.delete(id);
    callback(time);
  }

  const render = vi.fn((time: number) => {
    if (time === 32) frame.setActive(false);
  });
  const frame = createActiveFrame(render);
  expect(pending.size).toBe(0);
  frame.setActive(true);
  frame.setActive(true);
  expect(pending.size).toBe(1);
  draw(16);
  expect(pending.size).toBe(1);
  draw(32);
  expect(pending.size).toBe(0);
  frame.setActive(true);
  frame.setActive(false);
  expect(pending.size).toBe(0);
  expect(render.mock.calls).toEqual([[16], [32]]);
});
