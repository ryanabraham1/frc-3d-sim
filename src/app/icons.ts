/** Minimal inline stroke icons (lucide-style), so the app has no icon dependency. */
const svg = (body: string, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icon = {
  logo: (s = 22) => svg('<rect x="4" y="6" width="16" height="12" rx="3"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><path d="M12 6V3"/><circle cx="12" cy="2.5" r=".6"/><path d="M4 12H2M22 12h-2"/>', s),
  play: (s?: number) => svg('<polygon points="7 4 20 12 7 20 7 4"/>', s),
  gamepad: (s?: number) => svg('<path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r=".8"/><circle cx="17.5" cy="13" r=".8"/><path d="M17.3 5H6.7a4 4 0 0 0-3.96 3.43l-.9 6.3A2.5 2.5 0 0 0 4.3 17.6c.8 0 1.5-.4 2-1l1.7-2.1h8l1.7 2.1c.5.6 1.2 1 2 1a2.5 2.5 0 0 0 2.47-2.87l-.9-6.3A4 4 0 0 0 17.3 5Z"/>', s),
  book: (s?: number) => svg('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>', s),
  calendar: (s?: number) => svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', s),
  check: (s?: number) => svg('<path d="M20 6 9 17l-5-5"/>', s),
  clock: (s?: number) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
  shield: (s?: number) => svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>', s),
  target: (s?: number) => svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', s),
  flag: (s?: number) => svg('<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>', s),
  route: (s?: number) => svg('<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>', s),
  ruler: (s?: number) => svg('<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>', s),
  gauge: (s?: number) => svg('<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>', s),
  box: (s?: number) => svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>', s),
  arrowUp: (s?: number) => svg('<path d="M12 19V5M5 12l7-7 7 7"/>', s),
  sliders: (s?: number) => svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>', s),
  user: (s?: number) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', s),
  reset: (s?: number) => svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', s),
  pause: (s?: number) => svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', s),
  home: (s?: number) => svg('<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>', s),
  users: (s?: number) => svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', s),
};
