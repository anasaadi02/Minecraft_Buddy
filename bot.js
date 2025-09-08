const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const crafter = require('mineflayer-crafting-util').plugin;
const { Vec3 } = require('vec3');
const mcDataLoader = require('minecraft-data');
const fs = require('fs');
const path = require('path');

const bot = mineflayer.createBot({
  host: 'localhost',     // server IP or hostname
  port: 62313,           // server port
  username: 'Buddy',     // for offline servers; use a unique name
  version: '1.21.1'  
});

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);
bot.loadPlugin(collectBlock);
bot.loadPlugin(crafter);

let mcData;
let defaultMovements;
let survivalEnabled = false;
let survivalInterval = null;
let autoEatEnabled = true;
let guardState = { active: false, pos: null, radius: 10, interval: null };
let patrolState = { active: false, names: [], idx: 0, interval: null };
let roamState = { active: false, interval: null, lastMoveTime: 0, currentTarget: null };

// --- Persistence ---
const statePath = path.join(__dirname, 'state.json');
let state = {
  waypoints: {
    home: null, // { x, y, z, dimension }
    marks: {}   // name -> { x, y, z, dimension }
  }
};

function loadState() {
  try {
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.waypoints) state = parsed;
    }
  } catch (e) {
    console.error('Failed to load state.json', e);
  }
}

function saveState() {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save state.json', e);
  }
}

bot.once('spawn', () => {
  console.log('Bot spawned.');
  bot.chat('Hello! I am alive.');

  mcData = mcDataLoader(bot.version);
  defaultMovements = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMovements);
  loadState();
});

// Helper: resolve requested item term to one or more mcData item ids
function resolveItemIdsFromTerm(term) {
  if (!mcData) mcData = mcDataLoader(bot.version);
  const normalized = term.replace(/\s+/g, '_');

  // 1) Exact item match
  if (mcData.itemsByName[normalized]) {
    return [mcData.itemsByName[normalized].id];
  }

  // 2) Category/alias handling
  const lower = normalized.toLowerCase();
  const candidates = [];

  // wood => any logs or planks
  if (lower === 'wood' || lower === 'log' || lower === 'logs' || lower === 'planks' || lower === 'wood_planks') {
    for (const name in mcData.itemsByName) {
      if (/(_log|_planks)$/.test(name)) candidates.push(mcData.itemsByName[name].id);
    }
    return candidates;
  }

  // food => common edible items
  if (lower === 'food') {
    const foodNames = ['bread','cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','baked_potato','carrot','apple'];
    for (const n of foodNames) if (mcData.itemsByName[n]) candidates.push(mcData.itemsByName[n].id);
    return candidates;
  }

  // fallback: partial name contains
  for (const name in mcData.itemsByName) {
    if (name.includes(lower)) candidates.push(mcData.itemsByName[name].id);
  }
  return candidates;
}

bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  const msg = message.toLowerCase().trim();

  // follow me | follow <player>
  if (msg === 'follow me' || msg.startsWith('follow ')) {
    const targetName = msg === 'follow me' ? username : msg.split(' ').slice(1).join(' ');
    const target = Object.values(bot.players).find(p => p.username.toLowerCase() === targetName.toLowerCase());
    if (!target || !target.entity) {
      bot.chat(`I can't see ${targetName}.`);
      return;
    }
    const goal = new goals.GoalFollow(target.entity, 2);
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(goal, true);
    bot.chat(`Following ${targetName}.`);
    return;
  }

  // survival on/off
  if (msg === 'survival on' || msg === 'survival off') {
    const turnOn = msg.endsWith('on');
    survivalEnabled = turnOn;
    if (turnOn) {
      startSurvivalLoop();
      bot.chat('Survival mode enabled.');
    } else {
      stopSurvivalLoop();
      bot.chat('Survival mode disabled.');
    }
    return;
  }

  // auto eat on/off
  if (msg === 'auto eat on' || msg === 'auto eat off') {
    const turnOn = msg.endsWith('on');
    autoEatEnabled = turnOn;
    bot.chat(`Auto-eat ${turnOn ? 'enabled' : 'disabled'}.`);
    return;
  }

  // eat now
  if (msg === 'eat' || msg === 'eat now') {
    (async () => {
      await autoEat();
    })();
    return;
  }

  // roam on/off
  if (msg === 'roam on' || msg === 'roam off') {
    const turnOn = msg.endsWith('on');
    if (turnOn) {
      startRoaming();
      bot.chat('Roaming mode enabled.');
    } else {
      stopRoaming();
      bot.chat('Roaming mode disabled.');
    }
    return;
  }

  // status
  if (msg === 'status') {
    const status = [
      `Survival: ${survivalEnabled ? 'ON' : 'OFF'}`,
      `Auto-eat: ${autoEatEnabled ? 'ON' : 'OFF'}`,
      `Roaming: ${roamState.active ? 'ON' : 'OFF'}`,
      `Guard: ${guardState.active ? 'ON' : 'OFF'}`,
      `Patrol: ${patrolState.active ? 'ON' : 'OFF'}`,
      `Health: ${bot.health}/20`,
      `Food: ${bot.food || 'N/A'}`,
      `Position: ${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)}`
    ];
    bot.chat(`Status: ${status.join(' | ')}`);
    return;
  }

  // guard here [radius]
  if (msg.startsWith('guard here')) {
    const parts = msg.split(/\s+/);
    let radius = 10;
    const maybe = parseInt(parts[2], 10);
    if (!Number.isNaN(maybe) && maybe > 1 && maybe <= 64) radius = maybe;

    const me = bot.entity.position;
    guardState.pos = me.clone();
    guardState.radius = radius;
    guardState.active = true;
    startGuardLoop();
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(guardState.pos.x, guardState.pos.y, guardState.pos.z, 1));
    bot.chat(`Guarding this spot (r=${radius}).`);
    return;
  }

  // stop guard
  if (msg === 'stop guard' || msg === 'guard stop') {
    stopGuardLoop();
    bot.chat('Stopped guarding.');
    return;
  }

  // stop / cancel
  if (msg === 'stop' || msg === 'halt' || msg === 'cancel') {
    try { bot.pvp.stop(); } catch (_) {}
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    stopPatrol();
    bot.chat('Stopped current actions.');
    return;
  }

  // set home
  if (msg === 'set home') {
    const p = bot.entity.position;
    state.waypoints.home = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: bot.game.dimension }; 
    saveState();
    bot.chat(`Home set at (${state.waypoints.home.x} ${state.waypoints.home.y} ${state.waypoints.home.z}).`);
    return;
  }

  // go home
  if (msg === 'go home') {
    const home = state.waypoints.home;
    if (!home) { bot.chat('Home is not set. Use "set home" first.'); return; }
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(home.x, home.y, home.z, 1));
    bot.chat('Heading home.');
    return;
  }

  // mark <name>
  if (msg.startsWith('mark ')) {
    const name = msg.substring(5).trim().toLowerCase();
    if (!name) { bot.chat('Give a name: mark <name>'); return; }
    const p = bot.entity.position;
    state.waypoints.marks[name] = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: bot.game.dimension };
    saveState();
    bot.chat(`Marked '${name}' at (${state.waypoints.marks[name].x} ${state.waypoints.marks[name].y} ${state.waypoints.marks[name].z}).`);
    return;
  }

  // go <name>
  if (msg.startsWith('go ')) {
    const name = msg.substring(3).trim().toLowerCase();
    if (!name) { bot.chat('Give a waypoint: go <name>'); return; }
    if (name === 'home') {
      const home = state.waypoints.home;
      if (!home) { bot.chat('Home is not set.'); return; }
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(home.x, home.y, home.z, 1));
      bot.chat('Heading home.');
      return;
    }
    const wp = state.waypoints.marks[name];
    if (!wp) { bot.chat(`No waypoint named '${name}'.`); return; }
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(wp.x, wp.y, wp.z, 1));
    bot.chat(`Heading to '${name}'.`);
    return;
  }

  // list waypoints
  if (msg === 'list waypoints' || msg === 'waypoints') {
    const names = Object.keys(state.waypoints.marks);
    const homeStr = state.waypoints.home ? `home@(${state.waypoints.home.x},${state.waypoints.home.y},${state.waypoints.home.z})` : 'home@unset';
    if (names.length === 0) {
      bot.chat(`${homeStr}; no marks.`);
    } else {
      bot.chat(`${homeStr}; marks: ${names.join(', ')}`);
    }
    return;
  }

  // deposit [all|<item>|category] into nearest chest
  if (msg.startsWith('deposit')) {
    const term = msg.split(/\s+/).slice(1).join(' ').trim();
    const chestBlock = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
    if (!chestBlock) { bot.chat('No chest nearby.'); return; }
    (async () => {
      try {
        // Path near chest first
        await goNearPosition(chestBlock.position, 1.6, 12000);
        await sleep(200);
        const chest = await bot.openChest(chestBlock);
        const inv = bot.inventory.items();
        let targets = inv;
        if (term && term !== 'all') {
          const ids = resolveItemIdsFromTerm(term);
          if (!ids || ids.length === 0) { bot.chat(`Unknown term '${term}'.`); chest.close(); return; }
          targets = inv.filter(i => ids.includes(i.type));
        }
        for (const it of targets) {
          await chest.deposit(it.type, null, it.count);
        }
        chest.close();
        bot.chat(term ? `Deposited '${term}'.` : 'Deposited all.');
      } catch (e) {
        console.error(e);
        bot.chat('Deposit failed.');
      }
    })();
    return;
  }

  // withdraw <item|category> [count]
  if (msg.startsWith('withdraw ')) {
    const rest = msg.substring('withdraw '.length).trim();
    const parts = rest.split(/\s+/);
    let reqCount = null;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
    const term = parts.join(' ');
    const chestBlock = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
    if (!chestBlock) { bot.chat('No chest nearby.'); return; }
    const ids = resolveItemIdsFromTerm(term);
    if (!ids || ids.length === 0) { bot.chat(`Unknown term '${term}'.`); return; }
    (async () => {
      try {
        await goNearPosition(chestBlock.position, 1.6, 12000);
        await sleep(200);
        const chest = await bot.openChest(chestBlock);
        // Pull whichever id exists in chest first
        let remaining = reqCount || Infinity;
        for (const id of ids) {
          if (remaining <= 0) break;
          const chestItems = chest.containerItems().filter(i => i.type === id);
          const total = chestItems.reduce((a, i) => a + i.count, 0);
          if (total > 0) {
            const take = Math.min(total, remaining);
            await chest.withdraw(id, null, take);
            remaining -= take;
          }
        }
        chest.close();
        bot.chat(`Withdrew '${term}'${reqCount ? ` x${reqCount}` : ''}.`);
      } catch (e) {
        console.error(e);
        bot.chat('Withdraw failed.');
      }
    })();
    return;
  }

  // patrol <wp1> <wp2> [wp3 ...]
  if (msg.startsWith('patrol ')) {
    const names = msg.substring('patrol '.length).trim().split(/\s+/).map(s => s.toLowerCase()).filter(Boolean);
    if (names.length < 2) { bot.chat('Provide at least two waypoints: patrol <wp1> <wp2>'); return; }
    // Validate
    const points = names.map(n => n === 'home' ? state.waypoints.home : state.waypoints.marks[n]);
    if (points.some(p => !p)) { bot.chat('One or more waypoints are unknown.'); return; }
    patrolState.active = true;
    patrolState.names = names;
    patrolState.idx = 0;
    startPatrol();
    bot.chat(`Patrolling: ${names.join(' -> ')}`);
    return;
  }

  if (msg === 'stop patrol') {
    stopPatrol();
    bot.chat('Stopped patrol.');
    return;
  }

  // delete waypoint <name>
  if (msg.startsWith('delete waypoint ') || msg.startsWith('del waypoint ') || msg.startsWith('unmark ')) {
    const key = msg.startsWith('unmark ') ? msg.substring('unmark '.length).trim().toLowerCase() : msg.split(' ').slice(2).join(' ').trim().toLowerCase();
    if (!key) { bot.chat('Specify a name to delete.'); return; }
    if (!state.waypoints.marks[key]) { bot.chat(`No waypoint named '${key}'.`); return; }
    delete state.waypoints.marks[key];
    saveState();
    bot.chat(`Deleted waypoint '${key}'.`);
    return;
  }

  // fight | fight <player>
  if (msg === 'fight' || msg.startsWith('fight ')) {
    const targetName = msg === 'fight' ? null : msg.split(' ').slice(1).join(' ');
    let targetEntity = null;

    if (targetName) {
      const player = Object.values(bot.players).find(p => p.username.toLowerCase() === targetName.toLowerCase());
      if (player && player.entity) targetEntity = player.entity;
    } else {
      const hostiles = Object.values(bot.entities).filter(e => {
        const isMob = e.type === 'mob';
        if (!isMob) return false;
        const mobName = e.name || e.displayName || '';
        return ['zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray','pillager'].includes(mobName);
      });
      hostiles.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      targetEntity = hostiles[0] || null;
    }

    if (!targetEntity) {
      bot.chat('No valid target to fight.');
      return;
    }

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}

    bot.chat('Engaging target.');
    bot.pvp.attack(targetEntity);
    return;
  }

  // gather wood
  if (msg === 'gather wood' || msg === 'wood' || msg === 'collect wood') {
    if (!mcData) mcData = mcDataLoader(bot.version);
    const logIds = [
      'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'
    ].map(name => mcData.blocksByName[name] && mcData.blocksByName[name].id).filter(Boolean);

    const targetBlock = bot.findBlock({
      matching: (blk) => logIds.includes(blk.type),
      maxDistance: 64
    });

    if (!targetBlock) {
      bot.chat('I cannot find any logs nearby.');
      return;
    }

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.pvp.stop(); } catch (_) {}

    (async () => {
      try {
        await bot.collectBlock.collect(targetBlock);
        bot.chat('Collected some wood.');
      } catch (err) {
        console.error(err);
        bot.chat('Failed to collect wood.');
      }
    })();
    return;
  }

  // gather <count> <block>
  if (msg.startsWith('gather ')) {
    const parts = msg.split(/\s+/);
    if (parts.length >= 3) {
      const countTarget = parseInt(parts[1], 10);
      const blockNameInput = parts.slice(2).join(' ');
      if (!Number.isNaN(countTarget) && countTarget > 0) {
        if (!mcData) mcData = mcDataLoader(bot.version);
        const normalized = blockNameInput.replace(/\s+/g, '_');
        const blockDef = mcData.blocksByName[normalized];
        if (!blockDef) {
          bot.chat(`I don't recognize the block '${blockNameInput}'.`);
          return;
        }

        const itemDef = mcData.itemsByName[normalized];
        const getInventoryCount = () => bot.inventory.items().filter(i => i.name === (itemDef ? itemDef.name : blockDef.name)).reduce((a, i) => a + i.count, 0);

        const have = getInventoryCount();
        if (have >= countTarget) {
          bot.chat(`I already have ${have} ${blockNameInput}.`);
          return;
        }

        try { bot.pathfinder.setGoal(null); } catch (_) {}
        try { bot.pvp.stop(); } catch (_) {}

        (async () => {
          try {
            while (getInventoryCount() < countTarget) {
              const positions = bot.findBlocks({ matching: blockDef.id, maxDistance: 96, count: 16 });
              if (!positions || positions.length === 0) {
                bot.chat(`Can't find more '${blockNameInput}' nearby.`);
                break;
              }
              const blocks = positions.map(pos => bot.blockAt(pos)).filter(Boolean);
              await bot.collectBlock.collect(blocks);
            }
            const finalCount = getInventoryCount();
            bot.chat(`I now have ${finalCount} ${blockNameInput}.`);
          } catch (err) {
            console.error(err);
            bot.chat(`Failed to gather '${blockNameInput}'.`);
          }
        })();
        return;
      }
    }
  }

  // kill <mob>
  if (msg.startsWith('kill ')) {
    const mobName = msg.split(' ').slice(1).join(' ').trim();
    if (!mobName) { bot.chat('Specify a mob to kill.'); return; }
    const wanted = mobName.toLowerCase();

    // Match any non-player entity whose name includes the requested term
    let candidates = Object.values(bot.entities).filter(e => {
      if (!e || e.type === 'player') return false;
      const name = (e.name || e.displayName || '').toLowerCase();
      return name.includes(wanted);
    });

    // Fallback: if nothing found, ignore type filter entirely
    if (candidates.length === 0) {
      candidates = Object.values(bot.entities).filter(e => {
        const name = (e && (e.name || e.displayName) || '').toLowerCase();
        return name.includes(wanted);
      });
    }

    if (candidates.length === 0) {
      bot.chat(`I don't see any '${mobName}'.`);
      return;
    }

    candidates.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
    const target = candidates[0];
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    bot.chat(`Engaging ${mobName}.`);
    bot.pvp.attack(target);
    return;
  }

  // give me <item> [count]
  if (msg.startsWith('give me ')) {
    const rest = msg.substring('give me '.length).trim();
    const parts = rest.split(/\s+/);
    let requestedCount = null;
    let itemName;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
      requestedCount = parseInt(parts.pop(), 10);
    }
    itemName = parts.join(' ');
    const itemIds = resolveItemIdsFromTerm(itemName);
    if (!itemIds || itemIds.length === 0) { bot.chat(`I don't recognize '${itemName}'.`); return; }

    // Find best available item among candidates (highest count)
    const inv = bot.inventory.items();
    let best = { id: null, total: 0 };
    for (const id of itemIds) {
      const count = inv.filter(i => i.type === id).reduce((a, i) => a + i.count, 0);
      if (count > best.total) best = { id, total: count };
    }

    if (!best.id || best.total <= 0) { bot.chat(`I don't have any '${itemName}'.`); return; }
    const toGive = requestedCount ? Math.min(requestedCount, best.total) : best.total;

    const player = bot.players[username] && bot.players[username].entity ? bot.players[username].entity : null;
    if (!player) { bot.chat("I can't see you right now."); return; }

    // Move near the player, then toss selected item
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 2));

    setTimeout(async () => {
      try {
        await bot.toss(best.id, null, toGive);
        bot.chat(`Gave you ${toGive} of your requested '${itemName}'.`);
      } catch (e) {
        console.error(e);
        bot.chat('Failed to toss items.');
      }
    }, 1500);
    return;
  }

  // come / come to me
  if (msg === 'come' || msg === 'come to me') {
    const player = bot.players[username] && bot.players[username].entity ? bot.players[username].entity : null;
    if (!player) { bot.chat("I can't see you right now."); return; }
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 1));
    bot.chat('On my way.');
    return;
  }

  // pickup [radius]
  if (msg.startsWith('pickup')) {
    const parts = msg.split(/\s+/);
    const r = parseInt(parts[1], 10);
    const radius = (!Number.isNaN(r) && r > 1 && r <= 64) ? r : 12;
    const drops = Object.values(bot.entities).filter(e => e.name === 'item');
    if (drops.length === 0) { bot.chat('No drops nearby.'); return; }
    drops.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
    const targets = drops.filter(d => bot.entity.position.distanceTo(d.position) <= radius);
    if (targets.length === 0) { bot.chat('No drops within range.'); return; }
    (async () => {
      try {
        for (const d of targets) {
          await goNearPosition(d.position, 1.2, 8000);
          await sleep(250);
        }
        bot.chat('Picked up nearby drops.');
      } catch (e) {
        console.error(e);
        bot.chat('Failed to pick up drops.');
      }
    })();
    return;
  }

  // inventory summary
  if (msg === 'inventory' || msg === 'inv') {
    const items = bot.inventory.items();
    if (items.length === 0) { bot.chat('Inventory empty.'); return; }
    const counts = {};
    for (const it of items) {
      counts[it.name] = (counts[it.name] || 0) + it.count;
    }
    const summary = Object.entries(counts).map(([k,v]) => `${k}:${v}`).slice(0, 15).join(', ');
    bot.chat(summary.length ? summary : 'Inventory empty.');
    return;
  }

  // toss all <item|category>
  if (msg.startsWith('toss all ')) {
    const term = msg.substring('toss all '.length).trim();
    const ids = resolveItemIdsFromTerm(term);
    if (!ids || ids.length === 0) { bot.chat(`Unknown term '${term}'.`); return; }
    const inv = bot.inventory.items();
    const types = new Set();
    for (const id of ids) for (const it of inv) if (it.type === id) types.add(id);
    if (types.size === 0) { bot.chat(`I don't have '${term}'.`); return; }
    (async () => {
      try {
        for (const id of types) {
          const count = inv.filter(i => i.type === id).reduce((a, i) => a + i.count, 0);
          if (count > 0) await bot.toss(id, null, count);
        }
        bot.chat(`Tossed all '${term}'.`);
      } catch (e) {
        console.error(e);
        bot.chat('Failed to toss.');
      }
    })();
    return;
  }

  // craft <item> [count]
  if (msg.startsWith('craft ')) {
    const rest = msg.substring('craft '.length).trim();
    const parts = rest.split(/\s+/);
    let reqCount = 1;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
    const itemName = parts.join(' ');
    if (!mcData) mcData = mcDataLoader(bot.version);
    const normalized = itemName.replace(/\s+/g, '_');
    const itemDef = mcData.itemsByName[normalized];
    if (!itemDef) { bot.chat(`Unknown item '${itemName}'.`); return; }
    (async () => {
      try {
        // Find or place crafting table
        let table = bot.findBlock({ matching: (b) => b && b.name === 'crafting_table', maxDistance: 8 });
        if (!table) {
          const tableItem = bot.inventory.findInventoryItem(mcData.itemsByName.crafting_table.id);
          if (!tableItem) { bot.chat('Need a crafting table and I don\'t have one.'); return; }
          
          // Try multiple positions around the bot
          const positions = [
            bot.entity.position.offset(1, 0, 0),
            bot.entity.position.offset(-1, 0, 0),
            bot.entity.position.offset(0, 0, 1),
            bot.entity.position.offset(0, 0, -1),
            bot.entity.position.offset(1, 1, 0),
            bot.entity.position.offset(-1, 1, 0),
            bot.entity.position.offset(0, 1, 1),
            bot.entity.position.offset(0, 1, -1)
          ];
          
          let placed = false;
          for (const pos of positions) {
            const targetBlock = bot.blockAt(pos);
            if (targetBlock && targetBlock.name === 'air') {
              try {
                await bot.placeBlock(tableItem, targetBlock, new Vec3(0, 1, 0));
                table = bot.blockAt(pos);
                placed = true;
                break;
              } catch (e) {
                // Try next position
                continue;
              }
            }
          }
          
          if (!placed) {
            bot.chat('No suitable place for crafting table nearby.');
            return;
          }
        }
        await goNearPosition(table.position, 1.6, 8000);
        await sleep(200);
        
        // Use the crafting util plugin
        const itemToCraft = { id: itemDef.id, count: reqCount };
        const plan = bot.planCraft(itemToCraft);
        
        if (!plan || plan.recipesToDo.length === 0) {
          bot.chat(`No recipe for '${itemName}'.`);
          return;
        }
        
        // Debug: Show what we're trying to craft and what we have
        bot.chat(`Trying to craft ${reqCount} ${itemName} (ID: ${itemDef.id})`);
        bot.chat(`Plan has ${plan.recipesToDo.length} recipes to execute`);
        
        // Show current inventory
        const items = bot.inventory.items();
        bot.chat(`Inventory: ${items.map(item => `${item.name}(${item.count})`).join(', ')}`);
        
        // Execute the crafting plan
        for (const info of plan.recipesToDo) {
          bot.chat(`Recipe structure: ${JSON.stringify(info, null, 2)}`);
          
          // Try different ways to access the recipe name
          let recipeName = 'Unknown';
          if (info.recipe && info.recipe.result && info.recipe.result.name) {
            recipeName = info.recipe.result.name;
          } else if (info.recipe && info.recipe.name) {
            recipeName = info.recipe.name;
          } else if (info.recipe && info.recipe.id) {
            recipeName = `Item ID: ${info.recipe.id}`;
          }
          
          bot.chat(`Executing recipe: ${recipeName} x${info.recipeApplications}`);
          try {
            await bot.craft(info.recipe, info.recipeApplications, table);
            bot.chat(`Successfully crafted ${recipeName}`);
          } catch (craftError) {
            bot.chat(`Crafting failed: ${craftError.message}`);
            // Show what ingredients are needed
            if (info.recipe && info.recipe.ingredients) {
              bot.chat(`Required ingredients: ${info.recipe.ingredients.map(ing => `${ing.name}(${ing.count})`).join(', ')}`);
            }
            throw craftError;
          }
        }
        
        bot.chat(`Crafted ${reqCount} ${itemName}.`);
      } catch (e) {
        console.error(e);
        bot.chat('Crafting failed.');
      }
    })();
    return;
  }

  // smelt <item> [count]
  if (msg.startsWith('smelt ')) {
    const rest = msg.substring('smelt '.length).trim();
    const parts = rest.split(/\s+/);
    let reqCount = 1;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
    const itemName = parts.join(' ');
    if (!mcData) mcData = mcDataLoader(bot.version);
    const normalized = itemName.replace(/\s+/g, '_');
    const itemDef = mcData.itemsByName[normalized];
    if (!itemDef) { bot.chat(`Unknown item '${itemName}'.`); return; }
    (async () => {
      try {
        // Find or place furnace
        let furnace = bot.findBlock({ matching: (b) => b && b.name === 'furnace', maxDistance: 8 });
        if (!furnace) {
          const furnaceItem = bot.inventory.findInventoryItem(mcData.itemsByName.furnace.id);
          if (!furnaceItem) { bot.chat('Need a furnace and I don\'t have one.'); return; }
          
          // Try multiple positions around the bot
          const positions = [
            bot.entity.position.offset(1, 0, 0),
            bot.entity.position.offset(-1, 0, 0),
            bot.entity.position.offset(0, 0, 1),
            bot.entity.position.offset(0, 0, -1),
            bot.entity.position.offset(1, 1, 0),
            bot.entity.position.offset(-1, 1, 0),
            bot.entity.position.offset(0, 1, 1),
            bot.entity.position.offset(0, 1, -1)
          ];
          
          let placed = false;
          for (const pos of positions) {
            const targetBlock = bot.blockAt(pos);
            if (targetBlock && targetBlock.name === 'air') {
              try {
                await bot.placeBlock(furnaceItem, targetBlock, new Vec3(0, 1, 0));
                furnace = bot.blockAt(pos);
                placed = true;
                break;
              } catch (e) {
                // Try next position
                continue;
              }
            }
          }
          
          if (!placed) {
            bot.chat('No suitable place for furnace nearby.');
            return;
          }
        }
        await goNearPosition(furnace.position, 1.6, 8000);
        await sleep(200);
        // Use rightClick to open the furnace
        await bot.activateBlock(furnace, new Vec3(0, 1, 0));
        await sleep(500);
        
        // Find the furnace window
        const furnaceWindow = bot.currentWindow || bot.window;
        if (!furnaceWindow) { 
          bot.chat('Could not open furnace window'); 
          return; 
        }
        
        const recipes = bot.recipesFor(itemDef.id, null, 1, furnaceWindow);
        if (!recipes || recipes.length === 0) { 
          bot.chat(`No smelting recipe for '${itemName}'.`); 
          furnaceWindow.close(); 
          return; 
        }
        const recipe = recipes[0];
        for (let i = 0; i < reqCount; i++) {
          await bot.craft(recipe, 1, furnaceWindow);
        }
        furnaceWindow.close();
        bot.chat(`Smelted ${reqCount} ${itemName}.`);
      } catch (e) {
        console.error(e);
        bot.chat('Smelting failed.');
      }
    })();
    return;
  }

  // check recipe
  if (msg.startsWith('check recipe ')) {
    const itemName = msg.substring('check recipe '.length).trim();
    if (!mcData) mcData = mcDataLoader(bot.version);
    const normalized = itemName.replace(/\s+/g, '_');
    const itemDef = mcData.itemsByName[normalized];
    if (!itemDef) { bot.chat(`Unknown item '${itemName}'.`); return; }
    
    const itemToCraft = { id: itemDef.id, count: 1 };
    const plan = bot.planCraft(itemToCraft);
    
    if (!plan || plan.recipesToDo.length === 0) {
      bot.chat(`No recipe found for '${itemName}'.`);
      return;
    }
    
    bot.chat(`Recipe for ${itemName}:`);
    for (const info of plan.recipesToDo) {
      bot.chat(`- Info structure: ${JSON.stringify(info, null, 2)}`);
      if (info.recipe && info.recipe.ingredients) {
        bot.chat(`  Ingredients: ${info.recipe.ingredients.map(ing => `${ing.name}(${ing.count})`).join(', ')}`);
      }
    }
    return;
  }

  // debug crafting
  if (msg === 'debug craft') {
    if (!mcData) mcData = mcDataLoader(bot.version);
    const stickDef = mcData.itemsByName.stick;
    if (!stickDef) { bot.chat('Stick not found in mcData'); return; }
    bot.chat(`Stick ID: ${stickDef.id}, Name: ${stickDef.name}`);
    
    const table = bot.findBlock({ matching: (b) => b && b.name === 'crafting_table', maxDistance: 8 });
    if (!table) { bot.chat('No crafting table nearby'); return; }
    
    (async () => {
      try {
        await goNearPosition(table.position, 1.6, 8000);
        await sleep(200);
        
        // Use the crafting util plugin
        const itemToCraft = { id: stickDef.id, count: 1 };
        const plan = bot.planCraft(itemToCraft);
        
        bot.chat(`Plan found: ${plan ? 'Yes' : 'No'}`);
        if (plan) {
          bot.chat(`Recipes to do: ${plan.recipesToDo.length}`);
          if (plan.recipesToDo.length > 0) {
            bot.chat(`First recipe: ${JSON.stringify(plan.recipesToDo[0])}`);
          }
        }
      } catch (e) {
        console.error(e);
        bot.chat('Debug failed: ' + e.message);
      }
    })();
    return;
  }

  // sleep
  if (msg === 'sleep') {
    const time = bot.time.timeOfDay;
    const isNight = time >= 13000 || time < 6000; // 13000-24000 is night, 0-6000 is dawn
    if (!isNight) { bot.chat('It\'s not night time.'); return; }
    (async () => {
      try {
        // Find or place bed
        let bed = bot.findBlock({ matching: (b) => b && b.name.includes('bed'), maxDistance: 16 });
        if (!bed) {
          const bedItem = bot.inventory.findInventoryItem(mcData.itemsByName.red_bed.id) || 
                         bot.inventory.findInventoryItem(mcData.itemsByName.white_bed.id);
          if (!bedItem) { bot.chat('Need a bed and I don\'t have one.'); return; }
          
          // Try multiple positions around the bot
          const positions = [
            bot.entity.position.offset(1, 0, 0),
            bot.entity.position.offset(-1, 0, 0),
            bot.entity.position.offset(0, 0, 1),
            bot.entity.position.offset(0, 0, -1),
            bot.entity.position.offset(1, 1, 0),
            bot.entity.position.offset(-1, 1, 0),
            bot.entity.position.offset(0, 1, 1),
            bot.entity.position.offset(0, 1, -1)
          ];
          
          let placed = false;
          for (const pos of positions) {
            const targetBlock = bot.blockAt(pos);
            if (targetBlock && targetBlock.name === 'air') {
              try {
                await bot.placeBlock(bedItem, targetBlock, new Vec3(0, 1, 0));
                bed = bot.blockAt(pos);
                placed = true;
                break;
              } catch (e) {
                // Try next position
                continue;
              }
            }
          }
          
          if (!placed) {
            bot.chat('No suitable place for bed nearby.');
            return;
          }
        }
        await goNearPosition(bed.position, 1.6, 8000);
        await sleep(200);
        await bot.sleep(bed);
        bot.chat('Slept until morning.');
      } catch (e) {
        console.error(e);
        bot.chat('Sleep failed.');
      }
    })();
    return;
  }

  bot.chat(`Hi ${username}, you said: ${message}`);
});

bot.on('kicked', console.log);
bot.on('error', console.error);

// --- Survival helpers ---
function isHostileEntity(e) {
  if (!e || e.type !== 'mob') return false;
  const name = (e.name || e.displayName || '').toLowerCase();
  return [
    'zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray','pillager','ravager','vindicator','evoker','phantom','slime','magma_cube'
  ].includes(name);
}

async function autoEat() {
  if (!autoEatEnabled) return;
  
  const food = bot.food || 20; // Default to 20 if not available
  const saturation = bot.foodSaturation || 0;
  
  // Eat if hunger is low or saturation is very low
  if (food < 15 || saturation < 2) {
    const foodItems = bot.inventory.items().filter(item => {
      const itemData = mcData.itemsByName[item.name];
      return itemData && itemData.food && itemData.food > 0;
    });
    
    if (foodItems.length > 0) {
      // Sort by food value (higher is better)
      foodItems.sort((a, b) => {
        const aFood = mcData.itemsByName[a.name].food || 0;
        const bFood = mcData.itemsByName[b.name].food || 0;
        return bFood - aFood;
      });
      
      const bestFood = foodItems[0];
      try {
        await bot.consume();
        bot.chat(`Eating ${bestFood.name} (hunger: ${food}, saturation: ${saturation})`);
      } catch (e) {
        // Try to equip the food first
        try {
          await bot.equip(bestFood, 'hand');
          await bot.consume();
          bot.chat(`Eating ${bestFood.name} (hunger: ${food}, saturation: ${saturation})`);
        } catch (e2) {
          console.log('Failed to eat:', e2.message);
        }
      }
    } else {
      bot.chat('Hungry but no food available!');
    }
  }
}

function startRoaming() {
  if (roamState.interval) return;
  
  roamState.active = true;
  roamState.interval = setInterval(async () => {
    if (!roamState.active) return;
    
    // Stop other activities when roaming
    try { bot.pvp.stop(); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    
    const now = Date.now();
    const timeSinceLastMove = now - roamState.lastMoveTime;
    
    // Move every 3-8 seconds
    if (timeSinceLastMove > 3000 + Math.random() * 5000) {
      const currentPos = bot.entity.position;
      
      // Generate random target within 20-50 blocks
      const distance = 20 + Math.random() * 30;
      const angle = Math.random() * Math.PI * 2;
      const heightVariation = (Math.random() - 0.5) * 10;
      
      const targetX = currentPos.x + Math.cos(angle) * distance;
      const targetZ = currentPos.z + Math.sin(angle) * distance;
      const targetY = Math.max(currentPos.y + heightVariation, 60); // Don't go too low
      
      roamState.currentTarget = { x: targetX, y: targetY, z: targetZ };
      
      // Set pathfinding goal
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(targetX, targetY, targetZ, 3));
      
      roamState.lastMoveTime = now;
      
      // Occasionally announce what we're doing
      if (Math.random() < 0.3) {
        const actions = [
          'Exploring the area...',
          'Looking around...',
          'Wandering about...',
          'Checking things out...',
          'Going for a walk...'
        ];
        bot.chat(actions[Math.floor(Math.random() * actions.length)]);
      }
    }
    
    // Occasionally look around
    if (Math.random() < 0.1) {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI / 3; // Look up/down a bit
      bot.look(yaw, pitch);
    }
    
  }, 1000); // Check every second
}

function stopRoaming() {
  if (roamState.interval) {
    clearInterval(roamState.interval);
    roamState.interval = null;
  }
  roamState.active = false;
  roamState.currentTarget = null;
  bot.pathfinder.setGoal(null);
}

function startSurvivalLoop() {
  if (survivalInterval) return;
  survivalInterval = setInterval(async () => {
    if (!survivalEnabled) return;
    const health = bot.health;
    const position = bot.entity.position;

    // Auto-eat when hungry
    await autoEat();
    
    // Also auto-eat when roaming
    if (roamState.active) {
      await autoEat();
    }

    // Flee when low health
    if (health <= 8) { // 4 hearts
      try { bot.pvp.stop(); } catch (_) {}
      try { bot.collectBlock.cancelTask(); } catch (_) {}
      const away = position.offset((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16);
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(away.x, away.y, away.z, 2));
      return;
    }

    // Engage nearest hostile within range
    const hostiles = Object.values(bot.entities).filter(isHostileEntity);
    if (hostiles.length === 0) return;
    hostiles.sort((a, b) => position.distanceTo(a.position) - position.distanceTo(b.position));
    const target = hostiles[0];
    if (!target) return;

    try { bot.collectBlock.cancelTask(); } catch (_) {}
    bot.pvp.attack(target);
  }, 1000);
}

function stopSurvivalLoop() {
  if (survivalInterval) clearInterval(survivalInterval);
  survivalInterval = null;
}

// --- Guard helpers ---
function startGuardLoop() {
  if (guardState.interval) return;
  guardState.interval = setInterval(() => {
    if (!guardState.active || !guardState.pos) return;

    // Stay near guard position if drifted
    const dist = bot.entity.position.distanceTo(guardState.pos);
    if (dist > 2) {
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(guardState.pos.x, guardState.pos.y, guardState.pos.z, 1));
    }

    // Attack nearest hostile within radius
    const hostiles = Object.values(bot.entities).filter(e => isHostileEntity(e));
    hostiles.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
    const target = hostiles.find(h => h.position.distanceTo(guardState.pos) <= guardState.radius);
    if (target) {
      try { bot.collectBlock.cancelTask(); } catch (_) {}
      bot.pvp.attack(target);
    }
  }, 800);
}

function stopGuardLoop() {
  guardState.active = false;
  guardState.pos = null;
  guardState.radius = 10;
  if (guardState.interval) clearInterval(guardState.interval);
  guardState.interval = null;
}

// --- Patrol helpers ---
function startPatrol() {
  if (patrolState.interval) return;
  patrolState.interval = setInterval(() => {
    if (!patrolState.active || patrolState.names.length < 2) return;
    const currentName = patrolState.names[patrolState.idx];
    const wp = currentName === 'home' ? state.waypoints.home : state.waypoints.marks[currentName];
    if (!wp) return;
    const dist = bot.entity.position.distanceTo({ x: wp.x, y: wp.y, z: wp.z });
    if (dist > 2) {
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(wp.x, wp.y, wp.z, 1));
    } else {
      patrolState.idx = (patrolState.idx + 1) % patrolState.names.length;
    }
  }, 800);
}

function stopPatrol() {
  patrolState.active = false;
  patrolState.names = [];
  patrolState.idx = 0;
  if (patrolState.interval) clearInterval(patrolState.interval);
  patrolState.interval = null;
}

// --- Navigation helpers ---
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function goNearPosition(targetPos, radius = 1.2, timeoutMs = 15000) {
  try { bot.pathfinder.setMovements(defaultMovements); } catch (_) {}
  const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, Math.max(1, Math.floor(radius)));
  bot.pathfinder.setGoal(goal);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = bot.entity.position.distanceTo(targetPos);
    if (d <= radius) return true;
    await sleep(150);
  }
  return false;
}