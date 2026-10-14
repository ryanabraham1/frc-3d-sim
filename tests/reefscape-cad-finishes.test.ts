import * as THREE from 'three';
import { expect, it } from 'vitest';
import { finishReefscapeCad } from '../src/engine/robot/reefscapeCadFinishes';

it('distinguishes pale aluminum from actual white paint, team colors, rubber and clear sheets', () => {
  const aluminum = new THREE.MeshStandardMaterial({ color: new THREE.Color(.91, .91, .91) });
  finishReefscapeCad(aluminum, 'sublime-1678', 'frame');
  expect(aluminum.metalness).toBeGreaterThan(.8);
  expect(aluminum.color.r).toBeLessThan(.7);
  const white = new THREE.MeshStandardMaterial({ color: new THREE.Color(.72, .74, .77) });
  finishReefscapeCad(white, 'firefly-118', 'arm');
  expect(white.color.r).toBe(.72);
  expect(white.metalness).toBeLessThan(.2);
  for (const m of [new THREE.MeshStandardMaterial({ color: 0x52c52e }), new THREE.MeshStandardMaterial({ color: 0x181818 }), new THREE.MeshStandardMaterial({ color: 0xeeeeee, transparent: true, opacity: .25 })]) {
    const before = m.color.clone();
    finishReefscapeCad(m, 'sublime-1678', 'frame');
    expect(m.color.equals(before)).toBe(true);
  }
});

it('Citrus has a clear head and dark arm without changing the aluminum frame', () => {
  const head = new THREE.MeshStandardMaterial({ color: new THREE.Color(.81, .86, .90) });
  finishReefscapeCad(head, 'sublime-1678', 'effector');
  expect(head.transparent).toBe(true);
  expect(head.opacity).toBeLessThan(.4);
  const arm = new THREE.MeshStandardMaterial({ color: new THREE.Color(.91, .91, .91) });
  finishReefscapeCad(arm, 'sublime-1678', 'arm');
  expect(arm.color.r).toBeLessThan(.2);
});
