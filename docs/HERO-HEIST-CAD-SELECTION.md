# Hero Heist CADathon import selection

Source: [CADathon Submissions](https://docs.google.com/spreadsheets/d/1puhGmcSgHVSIsmb2TWnyxC6fqbZaQrJXKUxNsb7Mt-s/edit?gid=0), read October 8, 2026.
Gadgeteer, Multiclass, and Mystic selections have gold/yellow (`#FFD966`) backgrounds. The user also authorized three unhighlighted Commanders.
Selection favors established teams; 6800 is explicitly required by the user.

| Archetype in sheet | Team | Sheet row | Bubbles | Panels | Climb listed | CAD |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Gadgeteer | 111 | 19 | 4 | 2 | Park | [Assembly](https://cad.onshape.com/documents/fbbdb961babf0a02d25ecf15/w/82d586cacc8e0cda582d1ec3/e/3e9140408338efb7bd1e8042?renderMode=0&uiState=691c28affcd6df538c9e62f1) |
| Gadgeteer | 971 | 21 | 3 | 2 | Park | [Assembly](https://frc971.onshape.com/documents/521aac32de0567851dcb8025/w/1248ccaa842a00e541318d41/e/ea091188a1b9b0dfaa933e55?aa=true) |
| Gadgeteer | 3476 | 33 | 3 | 1 | Park | [Assembly](https://cad.onshape.com/documents/f5617d78ac77622b9df45290/w/8d5a9fd2cbbe05a7408e85e1/e/755aee821bbdd170698f1b8c) |
| Multiclass | 4561 | 44 | 6 | 2 | Park | [Assembly](https://cad.onshape.com/documents/441fa09943ba9c5da62543bf/w/59217d236cae8a2a65852cab/e/a78a7ab6b7655f8235679beb?renderMode=0&uiState=691bffcade7088662f1e7b41) |
| Multiclass | 3928 | 46 | 6 | 1 | Park | [Assembly](https://cad.onshape.com/documents/acb2fc0002712cc2d6922a15/w/d0a12cd9e4ac6ea2252f0992/e/3b0c232fb1ed692e34ba506c?renderMode=1&uiState=691c12951319d8c34d6aec12) |
| Multiclass | 5800 | 47 | 6 | 1 | Park | [Assembly](https://cad.onshape.com/documents/c2dc8ce89390e85cfb5cc7c0/w/6edfacad0375c29c51ee8642/e/1e2cf780d4393e634018fd90?renderMode=0&uiState=691c24f0afd7f98507e68872) |
| Mystic | 6800 | 51 | 6 | 0 | High | [Assembly](https://cad.onshape.com/documents/e4397ae1ed0ebe3445466e8a/w/dc22b6503a48cdc0a163c772/e/579f1fa8cfef57db8f7205ca) |
| Mystic | 2767 | 52 | 6 | 0 | High | [Assembly](https://cad.onshape.com/documents/d5947b2876d81c7735bb5d78/w/174eb13814b99c715092503d/e/4201850657b737ebb71af671?renderMode=0&uiState=691c1f9161f161aafdcdc13c) |
| Mystic | 1318 | 55 | 6 | 0 | High | [Assembly](https://cad.onshape.com/documents/34bba2a1872e9254fdab9bc0/w/fb4e5e9e34fc3f6a78a07f49/e/849abb67fbd36e9b8f4f4969) |

## Additional Commanders authorized by the user

| Archetype in sheet | Team | Sheet row | Bubbles | Panels | Climb listed | CAD |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Commander | 3506 | 5 | 0 | 3 | Park | [Assembly](https://cad.onshape.com/documents/76460e17df9efb3405f52b86/w/783334092808a111157f7c41/e/b36a79fe9586069480d516d4) |
| Commander | 1683 | 6 | 0 | 3 | Park | [Assembly](https://cad.onshape.com/documents/9ff4708b687c49783687d86f/w/333b7fdc4afb17b19ae97979/e/dbfa660c72f32054d086c5eb?renderMode=0&uiState=691d3205b07ff8049904b3bc) |
| Commander | 1153 | 7 | 0 | 3 | Park | [Assembly](https://cad.onshape.com/documents/81c4ebfe60f8ebf83f2ea0cb/w/b02c800bc5451f7f533d9d9a/e/ffbcc50d96981b22879e93e5?renderMode=0&uiState=691d072e8c4bf6ed5bfce08c) |

## Source availability

6800 **Mantis** was downloaded after the user enabled a signed-in Onshape session with export access. Source: `/Users/ryanabraham/Downloads/hero-mantis-6800-source.glb`, 112,421,496 bytes. This is distinct from the existing 2026 **Downpour** model.

Prepared asset: `public/models/robots/wcp-hero-heist/hero-mantis-6800.glb`, 6,948,020 bytes and 494,846 triangles (source 5,488,024 triangles). Its generated report records 831 omitted occurrences. Coordinate mapping is `(-Y,Z,-X)` in meters. Eight source assemblies remain separate: frame, spindexer, left/right intake, climber, shooter, magazine mount, and magazine. Generic bumpers will replace the omitted source bumpers; electrical internals and small hardware were removed. Meshopt compression preserves positions without position quantization.

Reproduce: `npm run cad:prepare -- /Users/ryanabraham/Downloads hero-mantis-6800`. The prepared file was decoded and checked for finite geometry, nonempty assemblies, and matching report bounds. **It is not yet registered as a playable robot or an articulated gallery model.**

The [Valor binder](https://drive.google.com/file/d/13vtXk3quJwtnLouwWYrYYzpjj4qm8j8W/view) confirms six-bubble Mystic storage, a turret/adjustable hood shooter, dual non-parallel four-bar side intakes, spindexer and vertical magazine, a folding shooter for a 27-inch climb pose, and a telescoping suction climber. Published 6-bubble/2-second throughput and about 5-second climb are design claims, not demonstrated performance. Source export contains one match pose; animation needs measured joints and fitted travel before runtime registration.

111 and 3476 currently load signed-in as documents "shared via a link" with no Export command. Their CAD has not been downloaded. The user was asked to make those downloadable in the same way as 6800; other selected links still need export checks.

The other selected CAD links come directly from the sheet; export availability has not been confirmed. No Commander row is highlighted; 3506, 1683, and 1153 were selected after the user authorized adding three Commanders.

## Integration constraints

- Import into the standalone `wcp-hero-heist` game, not the 2025 REEFSCAPE roster.
- Multiclass is a design category in this sheet, not a fourth legal match class. The author's submission post identifies these designs as Gadgeteer/Mystic hybrids. Verify each binder's selectable configurations before registration.
- Sheet capacities are source claims, not validated gameplay settings. The sheet author notes some entries use assumed class capacities where documentation omitted them. Verify binders, especially capacities that exceed the declared class limits.
- Inspect and partition each source before reducing it. Preserve actual shooter, panel mechanism, intake, storage, and climber joints.
- Keep Hero Heist's generic presets and unrelated working changes intact.
- Complete per-team runtime registration, source reports, articulated rigs, legal configurations, procedural fallback, mechanism checks, and browser gallery validation only after obtaining the source assets.

Public submission reference: [WCP CADathon thread, posts 190, 194, and 201](https://www.chiefdelphi.com/t/wcp-2025-cadathon-hero-heist/507753?page=10).
