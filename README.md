# MC Buddy — Commands and Actions

## Overview
- This bot is built with Mineflayer and a few plugins (pathfinder, pvp, collectblock).
- Works on Minecraft Java. Open your singleplayer world to LAN or use an Aternos server.
- **NEW**: Modular command structure for easier maintenance and customization!
- Reference: Mineflayer docs and examples: https://github.com/PrismarineJS/mineflayer

## Project Structure

```
Minecraft_Buddy/
├── bot.js                 # Main bot file (simplified)
├── state.json             # Persistent data (waypoints, etc.)
├── whitelist.json         # Whitelist config (git-ignored)
├── whitelist.example.json # Example whitelist file
├── commands/              # Command modules
│   ├── index.js          # Command handler
│   ├── movement.js       # Follow, come, roam commands
│   ├── combat.js         # Fight, kill commands
│   ├── gathering.js      # Gather, pickup commands
│   ├── inventory.js      # Inventory, give, toss commands
│   ├── waypoints.js      # Waypoint and patrol commands
│   ├── survival.js       # Survival, guard, auto eat commands
│   ├── utility.js        # Chest, craft, smelt, sleep commands
│   └── admin.js          # Whitelist management commands
└── utils/                 # Utility modules
    ├── helpers.js        # Helper functions
    ├── state.js          # State management
    └── whitelist.js      # Whitelist management
```

## Getting Started
1) Install deps (done earlier): `npm i`
2) Configure your server in `bot.js` (host, port, username, version)
3) **Setup whitelist** (IMPORTANT):
   - Copy `whitelist.example.json` to `whitelist.json`
   - Add your Minecraft username to the `players` array
   - Whitelist is **enabled by default** for security
4) Run: `node bot.js`

## Important: Command Prefix
All commands must start with the bot's name!

Example: If the bot's name is "Buddy", use:
- `Buddy follow me` instead of `follow me`
- `Buddy status` instead of `status`
- `Buddy gather wood` instead of `gather wood`

## General Controls
- **stop** | **halt** | **cancel** — cancel current actions (also stops patrol)
- **come** | **come to me** — path to the player who issued the command
- **pickup [radius]** — collect nearby drops (default 12 blocks)
- **inventory** | **inv** — show a brief inventory summary
- **toss all <item|category>** — toss all matching items (supports categories like wood, food)
- **status** — show bot status (health, food, active modes, position)

## Following and Movement
- **follow me** — follow the speaker
- **follow <player>** — follow a specific player
- **roam on** — enable roaming mode (bot explores randomly)
- **roam off** — disable roaming mode

## Combat
- **fight** — attack nearest hostile
- **fight <player>** — attack a player by name (careful!)
- **kill <mob>** — attack a mob whose name contains the given term (e.g., kill sheep)

## Gathering and Mining
- **gather wood** | **wood** | **collect wood** — collect any nearby log block
- **gather <count> <block>** — collect until inventory meets <count> (block id, e.g., oak_log)

## Give Items
- **give me <item> [count]** — give items to the speaker; accepts categories (wood, food) and partial names

## Survival Mode
- **survival on** — enable auto‑defend and flee on low health (≤ 4 hearts)
- **survival off** — disable survival mode
- **auto eat on** — enable automatic eating when hungry
- **auto eat off** — disable automatic eating
- **eat** / **eat now** — force eat food immediately

## Guarding
- **guard here [radius]** — hold position and auto‑defend within radius (default 10)
- **stop guard** | **guard stop** — stop guarding

## Waypoints and Patrol
- **set home** — save current position as home (persisted to state.json)
- **go home** — path to home
- **mark <name>** — save a named waypoint (persisted)
- **go <name>** — path to a named waypoint
- **list waypoints** | **waypoints** — list home and all marks
- **delete waypoint <name>** | **del waypoint <name>** | **unmark <name>** — remove a waypoint
- **patrol <wp1> <wp2> [wp3 ...]** — loop through waypoints (names or home)
- **stop patrol** — stop patrolling

## Chests (Nearest Chest within ~16 blocks)
- **deposit [all|<item>|category]** — deposit items into nearest chest
- **withdraw <item|category> [count]** — withdraw from nearest chest

## Crafting and Survival
- **craft <item> [count]** — craft items (auto-places crafting table if needed)
- **smelt <item> [count]** — smelt items (auto-places furnace if needed)
- **sleep** — sleep at night (auto-places bed if needed)

## Whitelist (Admin Commands)
**NOTE: Whitelist is ENABLED by default. Configure `whitelist.json` before running the bot!**

- **whitelist** — show whitelist status and players
- **whitelist on** — enable whitelist (bot only responds to whitelisted players)
- **whitelist off** — disable whitelist (bot responds to everyone)
- **whitelist add <player>** — add a player to the whitelist
- **whitelist remove <player>** — remove a player from the whitelist
- **whitelist list** — list all whitelisted players

The whitelist is stored in `whitelist.json` (git-ignored for security).

## Notes
- Item/category resolution: supports exact ids (e.g., oak_log), categories like wood (any *_log or *_planks), food (common foods), and partial matches.
- Waypoints are stored in `state.json` with x, y, z, and dimension.
- Patrol/Guard/Survival run periodic loops; issuing stop or specific stop commands halts them.
- Ensure versions are compatible; set `version` in `bot.js` to a Mineflayer‑supported game version.

## Adding New Commands

To add a new command:

1. **Choose the appropriate command file** in `commands/` directory
2. **Add your command** to the returned object:
```javascript
'your command': (username, message) => {
  // Your command logic here
  bot.chat('Command executed!');
}
```
3. Commands are automatically loaded by the command handler

Example adding a "wave" command to `movement.js`:
```javascript
'wave': (username) => {
  bot.chat(`*waves at ${username}*`);
}
```

## Customization

- **Bot configuration**: Edit connection settings in `bot.js`
- **Command behavior**: Modify individual command files in `commands/`
- **Helper functions**: Add utilities in `utils/helpers.js`
- **State management**: Modify `utils/state.js` for custom persistence

