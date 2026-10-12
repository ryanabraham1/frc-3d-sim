import { Color } from 'three';

/** Named parts in FE-2026, rather than the Onshape export's uniformly opaque grayscale appearance. */
export function fieldCadFinish(name, rgba = [1, 1, 1, 1], blueSide = true) {
  const paint = (rgba[0] > .9 && rgba[1] < .1 && rgba[2] < .1) || (rgba[0] < .1 && rgba[1] < .1 && rgba[2] > .9);
  if (/Vinyl|Sponsor Panel/.test(name)) return { role: 'vinyl', color: 0x17191c, metal: 0, rough: .78, opacity: 1 };
  if (/Driver Station Acrylic|Field Plastic|Tower Upper Plastic$|Outpost Upper Panel$/.test(name)) {
    return { role: 'clear', color: 0xd9e8ed, metal: 0, rough: .12, opacity: .12 };
  }
  if (/Diamond Plate/.test(name)) return { role: 'diamond', color: 0x929aa2, metal: .72, rough: .43, opacity: 1 };
  if (paint) return { role: 'paint', color: blueSide ? 0x1e62d0 : 0xd32f2f, metal: .08, rough: .58, opacity: 1,
    name: blueSide ? 'alliance-blue' : 'alliance-red' };
  if (/Tower Lower Plastic|Shelf Support Plastic|Upright Plug/.test(name)) return { role: 'plastic', color: 0x262a2e, metal: 0, rough: .67, opacity: 1 };
  if (/Aluminum|606[13]|Tube|Rod|Gusset|Brace|Bracket|Angle|Mount|Rail|Frame|Support|Plate|Riser|Ramp|Chute|Outpost Lower Panel|^FE-000(?:0[1-7]|14)-/.test(name)) {
    return { role: 'metal', color: 0xa0a7ae, metal: .65, rough: .4, opacity: 1 };
  }
  const c = new Color().setRGB(rgba[0], rgba[1], rgba[2], 'srgb');
  return { role: 'plastic', color: c.getHex(), metal: 0, rough: .65, opacity: 1 };
}

export function finishRgba(f) {
  const c = new Color(f.color);
  return [c.r, c.g, c.b, f.opacity];
}
