// Utility commands: deposit, withdraw, craft, smelt, sleep

const { resolveItemIdsFromTerm } = require('../utils/helpers');
const { goNearPosition, sleep } = require('../utils/helpers');
const { Vec3 } = require('vec3');

module.exports = function(bot, mcData, defaultMovements, goals) {
  
  return {
    'deposit': (username, message) => {
      const term = message.split(/\s+/).slice(1).join(' ').trim();
      handleDeposit(term);
    },
    
    'withdraw': (username, message) => {
      const rest = message.substring('withdraw '.length).trim();
      const parts = rest.split(/\s+/);
      let reqCount = null;
      if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
      const term = parts.join(' ');
      handleWithdraw(term, reqCount);
    },
    
    'craft': (username, message) => {
      const rest = message.substring('craft '.length).trim();
      const parts = rest.split(/\s+/);
      let reqCount = 1;
      if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
      const itemName = parts.join(' ');
      handleCraft(itemName, reqCount);
    },
    
    'smelt': (username, message) => {
      const rest = message.substring('smelt '.length).trim();
      const parts = rest.split(/\s+/);
      let reqCount = 1;
      if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
      const itemName = parts.join(' ');
      handleSmelt(itemName, reqCount);
    },
    
    'sleep': () => {
      handleSleep();
    }
  };
  
  function handleDeposit(term) {
    const chestBlock = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
    if (!chestBlock) { bot.chat('No chest nearby.'); return; }
    (async () => {
      try {
        // Path near chest first
        await goNearPosition(bot, defaultMovements, goals, chestBlock.position, 1.6, 12000);
        await sleep(200);
        const chest = await bot.openChest(chestBlock);
        const inv = bot.inventory.items();
        let targets = inv;
        if (term && term !== 'all') {
          const ids = resolveItemIdsFromTerm(mcData, term);
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
  }
  
  function handleWithdraw(term, reqCount) {
    const chestBlock = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
    if (!chestBlock) { bot.chat('No chest nearby.'); return; }
    const ids = resolveItemIdsFromTerm(mcData, term);
    if (!ids || ids.length === 0) { bot.chat(`Unknown term '${term}'.`); return; }
    (async () => {
      try {
        await goNearPosition(bot, defaultMovements, goals, chestBlock.position, 1.6, 12000);
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
  }
  
  function handleCraft(itemName, reqCount) {
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
        await goNearPosition(bot, defaultMovements, goals, table.position, 1.6, 8000);
        await sleep(200);
        
        // Use the crafting util plugin
        const itemToCraft = { id: itemDef.id, count: reqCount };
        const plan = bot.planCraft(itemToCraft);
        
        if (!plan || plan.recipesToDo.length === 0) {
          bot.chat(`No recipe for '${itemName}'.`);
          return;
        }
        
        // Execute the crafting plan
        for (const info of plan.recipesToDo) {
          await bot.craft(info.recipe, info.recipeApplications, table);
        }
        
        bot.chat(`Crafted ${reqCount} ${itemName}.`);
      } catch (e) {
        console.error(e);
        bot.chat('Crafting failed.');
      }
    })();
  }
  
  function handleSmelt(itemName, reqCount) {
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
        await goNearPosition(bot, defaultMovements, goals, furnace.position, 1.6, 8000);
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
  }
  
  function handleSleep() {
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
        await goNearPosition(bot, defaultMovements, goals, bed.position, 1.6, 8000);
        await sleep(200);
        await bot.sleep(bed);
        bot.chat('Slept until morning.');
      } catch (e) {
        console.error(e);
        bot.chat('Sleep failed.');
      }
    })();
  }
};

