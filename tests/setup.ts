import { beforeEach } from 'vitest';

// Robot models pick hopper/feed positions with Math.random, which feeds back into the sim (launch points, packing), so
// two identical matches differed by 10-30% and threshold tests flapped. Reseed before every test so runs repeat.
beforeEach(() => {
  let s = 0x2f6e2b1;
  Math.random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
});
