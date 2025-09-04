const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
// Removed tool auto-selection plugin and prismarine math import (not needed for MVP)
const mcDataLoader = require('minecraft-data');

const bot = mineflayer.createBot({
  host: 'localhost',     // server IP or hostname
  port: 62313,           // server port
  username: 'Buddy',     // for offline servers; use a unique name
  version: '1.21.1'   // highest widely-supported version; adjust if neededhttps://github.com/PrismarineJS/mineflayer
});

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);
bot.loadPlugin(collectBlock);

let mcData;
let defaultMovements;
let survivalEnabled = false;
let survivalInterval = null;

bot.once('spawn', () => {
  console.log('Bot spawned.');
  bot.chat('Hello! I am alive.');

  mcData = mcDataLoader(bot.version);
  defaultMovements = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMovements);
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

  // stop / cancel
  if (msg === 'stop' || msg === 'halt' || msg === 'cancel') {
    try { bot.pvp.stop(); } catch (_) {}
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    bot.chat('Stopped current actions.');
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

function startSurvivalLoop() {
  if (survivalInterval) return;
  survivalInterval = setInterval(() => {
    if (!survivalEnabled) return;
    const health = bot.health;
    const position = bot.entity.position;

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