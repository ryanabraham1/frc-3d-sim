import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { InputManager } from '@engine/input/input';

vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });

describe('virtual (touch) input', () => {
  it('held actions persist, taps fire once, and the analog stick overrides keys', () => {
    const im = new InputManager();
    im.virtual.held.add('shoot');
    im.virtual.pressed.add('pause');
    im.virtual.forward = 0.5;
    im.virtual.left = -1;
    const a = im.read();
    expect(a.shoot).toBe(true);
    expect(a.pause).toBe(true);
    expect([a.forward, a.left]).toEqual([0.5, -1]);
    const b = im.read();
    expect(b.shoot).toBe(true);
    expect(b.pause).toBe(false);
    im.dispose();
  });
});

it('suspends driving and shooting while typing, then clears stale controls on return', () => {
  const im = new InputManager();
  im.virtual.forward = 1;
  im.virtual.held.add('shoot');
  im.virtual.pressed.add('pause');
  im.setTyping(true);
  // A held controller/touch action must not move the robot while entering a message.
  im.virtual.forward = 1;
  im.virtual.held.add('shoot');
  im.virtual.pressed.add('cameraNext');
  const typing = im.read();
  expect(typing.forward).toBe(0);
  expect(typing.shoot).toBe(false);
  expect(typing.pause).toBe(false);
  expect(typing.cameraNext).toBe(false);
  im.setTyping(false);
  const returned = im.read();
  expect(returned.forward).toBe(0);
  expect(returned.shoot).toBe(false);
  expect(returned.cameraNext).toBe(false);
  im.dispose();
});
