/**
 * Profanity filter for player names, room titles and chat. Pure and dependency-free (the relay runs it too).
 *
 * Text is normalised first (case, accents, leetspeak like "sh1t", separators like "f.u.c.k", stretched letters),
 * then checked two ways: long unambiguous words anywhere in the text, and short words only as whole words so
 * names like "Scunthorpe" or "Grape" survive. Nothing here is perfect; the server is the enforcement point and
 * the UI just tells people sooner.
 */

/** Matched anywhere inside the letters of the text (so "f u c k" and "xxfuckxx" are caught). */
const ANYWHERE = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dickhead', 'cocksucker', 'motherfuck', 'whore', 'slut', 'pussy', 'retard',
  'nigger', 'nigga', 'faggot', 'fagot', 'tranny', 'wetback', 'beaner', 'kike', 'chink', 'gook', 'spic', 'raghead', 'towelhead',
  'hitler', 'nazi', 'rapist', 'molest', 'pedo', 'blowjob', 'handjob', 'dildo', 'jizz', 'cumshot', 'masturbat', 'whitepower', 'kys',
];

/** Matched only as a whole word (plus common endings), because they sit inside harmless words. */
const WHOLE_WORD = [
  'cunt', 'dick', 'cock', 'ass', 'arse', 'tits', 'twat', 'fag', 'rape', 'kkk', 'porn', 'sex', 'coon', 'paki', 'dyke', 'wank',
  'piss', 'nig', 'negro', 'cum', 'anal', 'boob', 'boobs', 'penis', 'vagina', 'bollocks', 'prick', 'skank', 'hoe', 'jerkoff',
];
const ENDINGS = ['', 's', 'es', 'ed', 'er', 'ers', 'ing', 'y', 'ie', 'in'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i', '+': 't', '€': 'e', '|': 'i' };

/** Lowercase, strip accents, undo leetspeak. Keeps separators (spaces, dots…) as single spaces. */
function normalize(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKD').toLowerCase()) {
    if (/[̀-ͯ]/.test(ch)) continue;
    out += LEET[ch] ?? ch;
  }
  // Letters stretched past two ("fuuuuck") collapse to two.
  return out.replace(/(.)\1{2,}/g, '$1$1').replace(/[^a-z]+/g, ' ').trim();
}

const wholeWords = new Set(WHOLE_WORD.flatMap((w) => ENDINGS.map((e) => w + e)));
const dedupe = (s: string) => s.replace(/(.)\1+/g, '$1');
const anywhereSquashed = ANYWHERE.map(dedupe);

/** Does the text contain a blocked word? */
export function isBadText(text: string): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  const letters = norm.replace(/ /g, '');
  // Also test with doubled letters squeezed ("fuuck", "shiit") against equally squeezed terms.
  const squashed = dedupe(letters);
  if (ANYWHERE.some((w) => letters.includes(w)) || anywhereSquashed.some((w) => squashed.includes(w))) return true;
  return norm.split(' ').some((tok) => wholeWords.has(tok) || wholeWords.has(dedupe(tok)));
}

/** Replace each blocked word in free text (chat) with asterisks, leaving the rest alone. */
export function censorText(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => (part.trim() && isBadText(part) ? '*'.repeat(Math.min(part.length, 8)) : part))
    .join('');
}

/** Why a display name can't be used, or null if it's fine. */
export function nameProblem(name: string): string | null {
  const t = name.trim();
  if (!t) return null; // empty falls back to "Player"
  if (isBadText(t)) return 'That name isn’t allowed — please pick a different one';
  return null;
}
