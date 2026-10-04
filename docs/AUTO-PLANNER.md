# Planned autonomous routines

On Single player → Match, use **Plan your auto** below the starting-position map. Actions are saved on this device for each season. Editing or choosing **Run this plan** turns off manual AUTO and selects **My planned auto**. Existing preset routines remain available.

- **2025:** Select a reef branch and L1–L4, a coral station, then another branch. Click the map targets or use the Target selector and Add target button. The controller targets the chosen branch exactly; occupied, algae-blocked, unreachable, or unsupported levels are skipped.
- **2024:** Select wing or center notes in order, and choose Shoot here before clicking a shooting spot. Pickup follows the actual selected note; if another robot takes it, that action is skipped.
- **2026:** Click Drive here waypoints or drag to draw a route. Add Intake here and Shoot here stops. Crossing the hub row uses the existing bump/trench routing, respecting robot height. Drawn paths stay on your half during AUTO.

Use the numbered list to reorder/remove actions, Undo last, or Clear. Stop time limits a stop after arrival; intake and shooting finish early when the robot has collected or emptied its pieces. Travel has a timeout so a blocked action cannot stall the whole routine. Only actions reached before AUTO ends execute. Test the sequence in Solo practice: lines are a waypoint preview, not a collision-free trajectory or a guarantee of scoring.

## Multiplayer

The host chooses **Plan autos & positions**. Each driver places their robot, edits their auto, sees their alliance's custom routes, and chooses **Lock in position & auto**. The match starts after all seated drivers lock in. Changes unlock the driver. Play again returns through this planning stage. Multiplayer AUTO always runs autonomously.

The host sends each client only that client's alliance plans; spectators receive no plans. Full plans are removed from client match-start messages. The host runs the physical match and therefore receives both alliances' plans; privacy assumes a trusted host. Plans are not sent to opposing clients merely hidden in their UI.
