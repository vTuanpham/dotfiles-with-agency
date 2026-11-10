# The crew: designs and engine

Each family has a design for each place, in four classes. The sprite modules own the art;
`design.ts` owns facing, motion, habitat, turns, passages and escorts.

`depth: 'far'` places a crew behind terrain and buildings, including its passage
effects. Constellations, the mountain airship and sky lanterns use this layer.
Nearby crews draw in front. Surface lights are projected separately onto the
nearest roof, ground or water; their intensity falls with height, and they are
not captured in the moving sprite. Distant crews cast no local surface light.

| Place | Codex | Claude | agy | OpenCode |
| --- | --- | --- | --- | --- |
| City | dragon | bat | crown | origami crane |
| Harbor | tug | crab | sail | paper boat |
| Beach | saucer | flamingo | starfish | kite |
| Mountains | airship | eagle | condor | sky lantern |
| Countryside | crop drone | butterfly | plough | carp streamer |
| Forest | probe | owl | tree | lantern string |
| Desert | sun skiff | fox | scorpion | flying carpet |
| Tundra | snowcat | puffin | aurora arch | paper star |

The tug and paper boat ride harbor water; the crab walks its quay. The
snowcat and fox walk the ground; the flamingo flies the shoreline and stands on one leg to rest; the sun skiff and crop drone cruise low. Other designs
fly. A surface worker rests when stale or its pace falls to 0.15 or below. Air
designs marked `rests` settle at an available perch: the dragon, bat (hanging by its feet), owl,
puffin and lantern string. `rest` is an optional sprite-module map of place to
class to rows; missing entries use flight frame 0. An optional `restContact` map
identifies a supporting pixel when a tail hangs below the feet. Perches and surface spans come
from the scene, and Mochi and her laptop remain hard boundaries.

The dragon coils to turn. Headed designs bank or use the optional `turnPose` map
(place → class → rows); a missing pose falls back to a bank. Face-on designs do
not turn. The supplied poses cover the Codex airship, crop drone, skiff and snowcat;
Claude flamingo, eagle, fox and puffin; and OpenCode crane, kite, carp and
carpet. `flex.ts` bends loose parts between strokes, creatures may have an
intermediate stroke, and the saucer's rim lamps chase across its frames. Constellations
keep their star arrangement while drifting; their light moves within that figure.
Star lighting cross-fades between beats; connecting lines stay faint while the
nodes bloom softly into the sky.

`fx.ts` describes streams, lights and the family message style. Night mixes body
colours toward the dark sky, keeps emissive cells bright and blooms them by one
cell; night-only effects use the optional `night` table cell. Beaks and feathers reflect
ambient light; machine lamps and paper windows emit it. agy uses `e` for
links that tint the existing sky rather than cover it. Effects draw before solid
body cells. On the water, workers bob, wake and reflect; ground workers disturb
their footing.

Messages use Codex `packet`, Claude `song`, agy `starfall` and OpenCode `ember`.
The sender charges and aims from its visible body. Each projectile freezes its route
at release; only crossed cells leave residue, which fades in place. A burst records
separate launches. Codex harbor darts rise from the tug before curving toward their
recipient. Flights pass above atmospheric effects. A worker turns when its heading
requires it and may keep its new heading after a message. Face-on workers direct
light from their node or lamp. The receiver has its own reaction.

Passages follow the body and habitat. The dragon charges and warps, the saucer and
probe lift through a beam, the airship climbs and the skiff accelerates away. Boats
travel on water; ground creatures and machines walk or drive out. Birds use their
scene's flight path. Constellations assemble from streaking stars; folded paper
opens on arrival, while floating lanterns rise and disperse. `enter` and `leave`
can select a shared style; otherwise `exit-styles.ts` supplies the scene's style.
Interrupts use the family's strike and debris.

Escorts are explicit in `design.ts`, not automatic for large classes: the dragon
has whelps, the bat, butterfly and puffin flock, and the sky lantern and
paper star have sisters. Other designs, including every agy constellation, have
none. Each escort follows the patrol with its own wing clock and bounded lateral
and vertical drift; its heading follows that path.

`crew.ts` places and paints bodies, `gait.ts` owns movement and clocks,
`particles.ts` draws effects, `peer-messages.ts` tracks messages, and
`passage-styles.ts` and `exit-styles.ts` supply passages to `exits.ts`. To review,
use `bun dev/cast.ts all`, `bun dev/passages.ts <place> <class>`, and scene
renders at day, night and narrow widths; `bun dev/perf.ts` measures painted frames.
`dev/review-server.ts` serves the interactive review; `dev/review-sheet.ts` renders
the same continuously stepped timelines as contact sheets. Review silhouettes first,
then complete motion and passage sequences, then mixed crews at terminal width.
Keep scene texture, readable small forms and a clear main action in each effect.
