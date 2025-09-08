MC Buddy — Commands and Actions

Overview
- This bot is built with Mineflayer and a few plugins (pathfinder, pvp, collectblock).
- Works on Minecraft Java. Open your singleplayer world to LAN and use the shown port in `bot.js`.
- Reference: Mineflayer docs and examples: https://github.com/PrismarineJS/mineflayer

Getting Started
1) Install deps (done earlier): `npm i`
2) Set your LAN port in `bot.js` and correct version if needed.
3) Run: `node bot.js`

General Controls
- stop | halt | cancel — cancel current actions (also stops patrol)
- come | come to me — path to the player who issued the command
- pickup [radius] — collect nearby drops (default 12 blocks)
- inventory | inv — show a brief inventory summary
- toss all <item|category> — toss all matching items (supports categories like wood, food)
- status — show bot status (health, food, active modes, position)

Following and Movement
- follow me — follow the speaker
- follow <player> — follow a specific player
- roam on — enable roaming mode (bot explores randomly)
- roam off — disable roaming mode

Combat
- fight — attack nearest hostile
- fight <player> — attack a player by name (careful!)
- kill <mob> — attack a mob whose name contains the given term (e.g., kill sheep)

Gathering and Mining
- gather wood | wood | collect wood — collect any nearby log block
- gather <count> <block> — collect until inventory meets <count> (block id, e.g., oak_log)

Give Items
- give me <item> [count] — give items to the speaker; accepts categories (wood, food) and partial names

Survival Mode
- survival on — enable auto‑defend and flee on low health (≤ 4 hearts)
- survival off — disable survival mode
- auto eat on — enable automatic eating when hungry
- auto eat off — disable automatic eating
- eat / eat now — force eat food immediately

Guarding
- guard here [radius] — hold position and auto‑defend within radius (default 10)
- stop guard | guard stop — stop guarding

Waypoints and Patrol
- set home — save current position as home (persisted to state.json)
- go home — path to home
- mark <name> — save a named waypoint (persisted)
- go <name> — path to a named waypoint
- list waypoints | waypoints — list home and all marks
- delete waypoint <name> | del waypoint <name> | unmark <name> — remove a waypoint
- patrol <wp1> <wp2> [wp3 ...] — loop through waypoints (names or home)
- stop patrol — stop patrolling

Chests (Nearest Chest within ~16 blocks)
- deposit [all|<item>|category] — deposit items into nearest chest
- withdraw <item|category> [count] — withdraw from nearest chest

Crafting and Survival
- craft <item> [count] — craft items (auto-places crafting table if needed)
- smelt <item> [count] — smelt items (auto-places furnace if needed)
- sleep — sleep at night (auto-places bed if needed)

Notes
- Item/category resolution: supports exact ids (e.g., oak_log), categories like wood (any *_log or *_planks), food (common foods), and partial matches.
- Waypoints are stored in `state.json` with x, y, z, and dimension.
- Patrol/Guard/Survival run periodic loops; issuing stop or specific stop commands halts them.
- Ensure versions are compatible; set `version` in `bot.js` to a Mineflayer‑supported game version.


