declare const __BUILD_ID__: string | undefined;

/**
 * Reloads the page when a newer build has been deployed, so nobody keeps playing an old version.
 * Checks on load, every minute and when the tab regains focus; never reloads mid-match or in a multiplayer room
 * (`busy`), it waits until the player is back at the menu.
 */
export function startUpdateCheck(busy: () => boolean): void {
  const mine = typeof __BUILD_ID__ === 'undefined' ? null : __BUILD_ID__;
  if (!mine) return; // dev server
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { id } = (await res.json()) as { id?: string };
      if (id && id !== mine && !busy()) window.location.reload();
    } catch { /* offline: try again next time */ } finally { checking = false; }
  };
  void check();
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
}
