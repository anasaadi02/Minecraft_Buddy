// Inventory commands: inventory, give, toss

const { resolveItemIdsFromTerm } = require('../utils/helpers');

module.exports = function(bot, mcData, defaultMovements, goals) {
  
  return {
    'inventory': () => handleInventory(),
    'inv': () => handleInventory(),
    
    'give me': (username, message) => {
      const rest = message.substring('give me '.length).trim();
      const parts = rest.split(/\s+/);
      let requestedCount = null;
      let itemName;
      if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
        requestedCount = parseInt(parts.pop(), 10);
      }
      itemName = parts.join(' ');
      handleGive(username, itemName, requestedCount);
    },
    
    'toss all': (username, message) => {
      const term = message.substring('toss all '.length).trim();
      handleTossAll(term);
    }
  };
  
  function handleInventory() {
    const items = bot.inventory.items();
    if (items.length === 0) { bot.chat('Inventory empty.'); return; }
    const counts = {};
    for (const it of items) {
      counts[it.name] = (counts[it.name] || 0) + it.count;
    }
    const summary = Object.entries(counts).map(([k,v]) => `${k}:${v}`).slice(0, 15).join(', ');
    bot.chat(summary.length ? summary : 'Inventory empty.');
  }
  
  function handleGive(username, itemName, requestedCount) {
    const itemIds = resolveItemIdsFromTerm(mcData, itemName);
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
  }
  
  function handleTossAll(term) {
    const ids = resolveItemIdsFromTerm(mcData, term);
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
  }
};

