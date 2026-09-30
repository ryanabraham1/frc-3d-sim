# 2024 CRESCENDO implementation

Select **2024 CRESCENDO** in the season dropdown (single player or as the multiplayer host).

## Manual source

The only source is **`2024GameManual.pdf`** in the repo root: the 2024 FRC Game Manual, kickoff
release **V0** (149 pages, created 2024-01-02). It was downloaded from a public GitHub mirror
(`DeLaSalle-Robotics/DLS-Robot-2024`) because FIRST's own download host was blocked by this build
environment's network policy. **No Team Updates, field drawings, CAD, or WPILib AprilTag layout were
used** — so anything changed by later Team Updates (e.g. AMPLIFICATION ending early after 4 NOTES) is
deliberately *not* modeled.

Page numbers are the manual's printed pages.

| Feature | Manual reference | Implementation |
|---|---|---|
| Field | §5.1 p21–22 | 54 ft 3¼ in × 26 ft 11¼ in; 20 in guardrails; mirror-symmetric (red = L − x) |
| Zones & markings | §5.2 p23–25 | ROBOT STARTING ZONE 76⅛ × 284⅛ in; AMP ZONE 130 × 17¾ in; SOURCE ZONE parallelogram 18¾ in deep; WING line; STAGE ZONE hexagon; CENTER LINE; STARTING LINE 2 ft behind the wall |
| AMP | §5.3 p25–26 | Pocket 24 × 18 × 3⅞ in, bottom 26 in; 49½ in from the wall; 2 ALLIANCE lights + amber Coopertition light with the manual's on/blink/off meanings |
| SOURCE | §5.4 p26–27 | 75¼ × 6 in opening, bottom 36¾ in; 50° CHUTE (visual) |
| STAGE | §5.5 p27–29 | 3 truss legs, 10 ft 1 in from the wall; core underside 27⅞ in (gussets); chains anchored at 4 ft, drooping to 28¼ in, 16⅝ in from the core; TRAP openings at 56½ in; MICROPHONES 12 in, 1.66 in OD, top at 88¼ in; PODIUM 17¾ × 10 in |
| SPEAKER / SUBWOOFER | §5.6.1 p31–32 | Opening 41⅜ in wide, 78 in (wall top) → 82⅞ in (lip, 18 in out), 14°; hood + cavity; SUBWOOFER 37 in tall, 36⅛ in deep, 8⅜ in vertical panels; AMPLIFIED light strings + 10-segment receding SUBWOOFER bar |
| DRIVER STATIONS | §5.6.2 p32–34 | 36¾ in base + 42 in polycarbonate |
| NOTES / HIGH NOTES | §5.7 p34 | Foam torus 14 in OD, 10 in ID, 2 in thick, 235 g; HIGH NOTES with 3 white tape bands |
| AprilTags | §5.8 p35–39 | IDs 1–16 at the depicted structures and stated heights/offsets (visual) |
| Staging | §6.3.4 p45 | 107 NOTES: 45 per SOURCE AREA, 3 per WING (9 ft 6 in from the wall, 4 ft 9 in apart), 5 on the CENTER LINE (5 ft 6 in apart), 1 preload per robot (unused preloads join the SOURCE); 3 HIGH NOTES on each AMP |
| Timing | §6.4–6.5 p45–46 | 15 s AUTO, 3 s pause, 2:15 TELEOP (last 20 s = END GAME); SPEAKER NOTES counted 3 s after each 0:00; STAGE assessed 5 s after the end |
| Scoring | Table 6-2 p48 | LEAVE 2 · AMP 2/1 · SPEAKER 5/2, AMPLIFIED 5 · PARK 1 · ONSTAGE 3, SPOTLIT 4 · HARMONY 2 per extra robot · TRAP 5 (1 per TRAP) |
| AMPLIFICATION | §6.5.3 p47 | 2 banked AMP NOTES → HUMAN PLAYER button → 10 s (+ grace); NOTES delivered while AMPLIFIED score but don't bank |
| SPOTLIGHT | §6.5.4 p47 | A HIGH NOTE ringing a MICROPHONE makes that chain's ONSTAGE robots worth 4 |
| Coopertition | §6.5.5 p48 | Both alliances press with a banked NOTE in the first 45 s of TELEOP → 1 Coopertition point each, MELODY threshold 15 |
| RP | Table 6-2 p48 | MELODY (18 / 15 NOTES), ENSEMBLE (≥10 STAGE pts and ≥2 ONSTAGE), Win 2, Tie 1 |
| Penalties | Table 6-3 p48 | FOUL 2, TECH FOUL 5, credited to the opponent |
| Robot limits | R104/R105 p74, G409 p62 | 4 ft starting height, 120 in frame perimeter; one NOTE at a time |

### Rules enforced automatically

- **G404** — AUTO shot from a robot completely outside its WING: TECH FOUL.
- **G405** — AUTO, robot fully across the CENTER LINE touching an opponent robot or a NOTE still on an
  opponent WING SPIKE MARK: TECH FOUL.
- **G414** — shooting at your SPEAKER with any bumper in the opponent's WING: FOUL, then TECH FOULs.
  (Passes from there land in the NEUTRAL ZONE, so they're legal.)
- **G422** — before the last 20 s, contact with an opponent touching its PODIUM: TECH FOUL.
- **G423** — contact while either robot is in the opponent's SOURCE ZONE or AMP ZONE: TECH FOUL.
- **G424** — contact with an opponent that's off the carpet, or in the opponent's STAGE ZONE in the last
  20 s: 2 TECH FOULS + the opponent gets the ENSEMBLE RP.
- **G430** — HIGH NOTES can only be thrown in the last 20 s.
- **G403 / G409** — impossible by construction (1-NOTE capacity).
- NOTES that leave the FIELD are not returned to play (§6.8).

Not enforced (referee judgement or intent): G406/G407 intent, G410, G411–G413, G415–G421 (pins,
tipping, damage, collusion), G425–G429 (humans).

## How each action is simulated

| Action | Model |
|---|---|
| SPEAKER shots | **Physical.** A flat ring flies through the real hood geometry. The aim solver passes *under* the lip (ceilings) and accepts rising entries; a high lob hits the hood. Shots from far off the opening's axis (≳50°) mostly bounce off the hood cheeks — that's intended ("some shots are impossible"). |
| Passing (G away from the AMP) | Physical lob into your WING (or into the NEUTRAL ZONE when you're in the opponent's WING), arcing over a STAGE in the way. |
| AMP | **Assisted.** Drive against your AMP and press G: the NOTE animates into the pocket (a flat ring can't physically fit a 3⅞ in pocket in this engine). |
| SOURCE | Physical drop through the opening when one of your robots waits nearby in TELEOP (no drops in AUTO: SOURCE human players stand behind the STARTING LINE). |
| Chain climb | **Assisted** kinematic climb to the nearest free spot on the chain you're under (inside your STAGE ZONE), facing the core. Two robots can share a chain (HARMONY). |
| TRAP | **Assisted.** While hanging with a NOTE and a "Chain + TRAP" climber, press Space. |
| HIGH NOTE | Physical throw from behind the wall by the AMP human player at a MICROPHONE (≈80 % success); a ring falling over the pipe top SPOTLIGHTS that chain. |

**Known gap:** the STAGE chains are static visuals (climbs snap to them). Per `CLAUDE.md`, hung elements
should be dynamic (`src/engine/field/hanging.ts`); converting the chains is a follow-up.

## Figure-derived (undimensioned) values

The manual gives sizes but not most *positions*. These were measured from the top-view figures
(Figure 5-4, 6-2; ~1.2 px/in, ±2 in) and are tagged `[FIG]` / `[EST]` in `constants.ts`:
SPEAKER center (in line with the middle WING SPIKE MARK, 57 in above the field center line), SUBWOOFER
footprint widths, DRIVER STATION spans (DS 1 assumed on the AMP side), AMP housing width, SOURCE wall
corner (0, 41.3 in)–(68 in, 0), WING line (229½ in), STAGE leg radius (58.7 in) and STAGE ZONE vertices.
Structure heights the manual doesn't give (STAGE trusses, hood roof, AMP top, SOURCE wall) are estimates.

## Controls

| Key | Action |
|---|---|
| Space | Shoot at the SPEAKER · while ONSTAGE: place the NOTE in the TRAP |
| G | At your AMP: score in the AMP · elsewhere: pass |
| C / X | Climb the chain you're under (TELEOP) / descend |
| H / B / N | AMP human player: AMPLIFY / Coopertition / throw a HIGH NOTE (last 20 s) |
| Gamepad | RB = AMP/pass, X = AMPLIFY, LB = Coopertition |

With **Human player: Auto** (default) your AMP human player presses Coopertition when possible,
AMPLIFIES at 2 NOTES and throws the 3 HIGH NOTES in the last 20 s.

AUTO routines: *Speaker + 3 wing notes* (scores 4 NOTES + LEAVE = 22 pts), *Amp + wing note*,
*Shoot + leave*, *Leave only*, *Do nothing* — or drive AUTO yourself.
