// Gathering commands: gather wood (with axe), gather ore (with pickaxe), gather blocks (generic), pickup

const { goNearPosition, sleep } = require('../utils/helpers');
const { Vec3 } = require('vec3');
const { Movements } = require('mineflayer-pathfinder');

module.exports = function(bot, mcData, defaultMovements, goals) {
  
  // Create custom movements that avoid water for gathering
  const gatheringMovements = new Movements(bot, mcData);
  
  // Configure movements to avoid water
  // Water blocks should be treated as obstacles
  gatheringMovements.blocksToAvoid = new Set([
    mcData.blocksByName.water?.id,
    mcData.blocksByName.flowing_water?.id,
    mcData.blocksByName.lava?.id,
    mcData.blocksByName.flowing_lava?.id
  ].filter(Boolean));
  
  // Override the getBlockCost function to make water very expensive
  const originalGetBlockCost = gatheringMovements.getBlockCost;
  gatheringMovements.getBlockCost = (pos) => {
    const block = bot.blockAt(pos);
    if (block && (block.name === 'water' || block.name === 'flowing_water' || 
        block.name === 'lava' || block.name === 'flowing_lava')) {
      return 999999; // Very high cost = avoid
    }
    return originalGetBlockCost ? originalGetBlockCost(pos) : 1;
  };
  
  return {
    'gather wood': async () => await handleGatherWood(),
    'wood': async () => await handleGatherWood(),
    'collect wood': async () => await handleGatherWood(),
    
    'gather ore': async (username, message) => {
      const parts = message.split(/\s+/);
      let oreName = 'stone'; // default
      let count = 64; // default
      
      // Parse: "gather ore stone" or "gather ore 32 iron" or "gather ore iron 32"
      if (parts.length >= 3) {
        const part2 = parts[2];
        const part3 = parts[3];
        
        // Check if part2 is a number
        if (/^\d+$/.test(part2)) {
          count = parseInt(part2, 10);
          oreName = part3 || 'stone';
        } else {
          oreName = part2;
          if (part3 && /^\d+$/.test(part3)) {
            count = parseInt(part3, 10);
          }
        }
      } else if (parts.length === 3) {
        oreName = parts[2];
      }
      
      await handleGatherOre(oreName, count);
    },
    
    'gather': async (username, message) => {
      const parts = message.split(/\s+/);
      if (parts.length >= 3) {
        const countTarget = parseInt(parts[1], 10);
        const blockNameInput = parts.slice(2).join(' ');
        if (!Number.isNaN(countTarget) && countTarget > 0) {
          await handleGatherBlocks(blockNameInput, countTarget);
        }
      }
    },
    
    'pickup': async (username, message) => {
      const parts = message.split(/\s+/);
      const r = parseInt(parts[1], 10);
      const radius = (!Number.isNaN(r) && r > 1 && r <= 64) ? r : 12;
      await handlePickup(radius);
    }
  };
  
  // Create a simple staircase path to reach blocks below
  async function createStaircaseToBlock(targetBlock) {
    const botPos = bot.entity.position;
    const targetPos = targetBlock.position;
    
    // If target is at or above bot level (within 2 blocks), no staircase needed
    if (targetPos.y >= botPos.y - 2) {
      return null;
    }
    
    const depth = Math.floor(botPos.y - targetPos.y);
    if (depth <= 2) return null; // Too shallow for stairs
    
    // Simple staircase: 1 forward, 1 down, repeat (diagonal down)
    const direction = {
      x: targetPos.x - botPos.x,
      z: targetPos.z - botPos.z
    };
    const horizontalDist = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    
    // Normalize direction to get step direction
    let stepX = 0, stepZ = 0;
    if (horizontalDist > 0.5) {
      // Move towards target
      stepX = Math.sign(direction.x);
      stepZ = Math.sign(direction.z);
    } else {
      // Target directly below - pick a direction
      stepX = 1;
      stepZ = 0;
    }
    
    const steps = [];
    let currentX = Math.floor(botPos.x);
    let currentY = Math.floor(botPos.y) - 1; // Start one block down
    let currentZ = Math.floor(botPos.z);
    
    // Create simple diagonal staircase (1 forward, 1 down, repeat)
    for (let i = 0; i < depth && currentY > targetPos.y - 1; i++) {
      // Step forward
      currentX += stepX;
      currentZ += stepZ;
      steps.push(new Vec3(currentX, currentY, currentZ));
      // Step down
      currentY -= 1;
      if (currentY >= targetPos.y - 1) {
        steps.push(new Vec3(currentX, currentY, currentZ));
      }
    }
    
    return steps;
  }
  
  // Helper function to go near position avoiding water
  async function goNearPositionAvoidWater(targetPos, radius = 1.5, timeoutMs = 5000) {
    // Set movements to water-avoiding movements
    try { 
      bot.pathfinder.setMovements(gatheringMovements); 
    } catch (_) {}
    
    const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, Math.max(1, Math.floor(radius)));
    bot.pathfinder.setGoal(goal);
    
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const d = bot.entity.position.distanceTo(targetPos);
      if (d <= radius) return true;
      
      // Check if we're stuck in water - try to escape
      const currentBlock = bot.blockAt(bot.entity.position);
      if (currentBlock && (currentBlock.name === 'water' || currentBlock.name === 'flowing_water')) {
        // Try to escape water by moving up and away
        const escapePos = bot.entity.position.offset(0, 2, 0);
        bot.pathfinder.setGoal(new goals.GoalNear(escapePos.x, escapePos.y, escapePos.z, 1));
        await sleep(500);
        // After escaping, retry original goal
        bot.pathfinder.setGoal(goal);
      }
      
      await sleep(150);
    }
    return false;
  }
  
  // Dig staircase to reach a block below
  async function digStaircaseToBlock(targetBlock) {
    const steps = await createStaircaseToBlock(targetBlock);
    if (!steps || steps.length === 0) return true;
    
    bot.chat('Creating staircase to reach the blocks...');
    
    for (const stepPos of steps) {
      // Check if step position is in water - if so, skip or find alternative
      const stepBlock = bot.blockAt(stepPos);
      if (stepBlock && (stepBlock.name === 'water' || stepBlock.name === 'flowing_water' || 
          stepBlock.name === 'lava' || stepBlock.name === 'flowing_lava')) {
        // Skip water blocks, try to go around
        continue;
      }
      
      const block = bot.blockAt(stepPos);
      if (block && block.name !== 'air') {
        try {
          // Check if we can break this block
          const canBreak = bot.canDigBlock(block);
          if (canBreak) {
            await bot.dig(block);
            await sleep(100); // Small delay between digs
          } else {
            // Can't break, try to path around (avoiding water)
            await goNearPositionAvoidWater(stepPos, 1.5, 5000);
          }
        } catch (e) {
          // If digging fails, try to path to the position (avoiding water)
          await goNearPositionAvoidWater(stepPos, 1.5, 5000);
        }
      } else {
        // Already air, just move there (avoiding water)
        await goNearPositionAvoidWater(stepPos, 1.5, 5000);
      }
    }
    
    return true;
  }
  
  // Check if a position is in or surrounded by water
  function isInWater(pos) {
    const block = bot.blockAt(pos);
    if (block && (block.name === 'water' || block.name === 'flowing_water' || 
        block.name === 'lava' || block.name === 'flowing_lava')) {
      return true;
    }
    // Check blocks around (including above and below)
    const checkPositions = [
      pos.offset(0, 0, 0),  // Current
      pos.offset(0, 1, 0),  // Above
      pos.offset(0, -1, 0), // Below
      pos.offset(1, 0, 0),  // East
      pos.offset(-1, 0, 0), // West
      pos.offset(0, 0, 1),  // South
      pos.offset(0, 0, -1)  // North
    ];
    
    for (const checkPos of checkPositions) {
      const checkBlock = bot.blockAt(checkPos);
      if (checkBlock && (checkBlock.name === 'water' || checkBlock.name === 'flowing_water')) {
        // If surrounded by water, consider it inaccessible
        return true;
      }
    }
    
    return false;
  }
  
  // Find blocks in a reasonable radius (expanding search), avoiding water
  function findBlocksInRadius(matching, startRadius = 32, maxRadius = 128) {
    let radius = startRadius;
    let positions = [];
    
    while (positions.length === 0 && radius <= maxRadius) {
      let foundPositions = [];
      if (typeof matching === 'function') {
        // Matching function (for wood logs)
        foundPositions = bot.findBlocks({ 
          matching: matching, 
          maxDistance: radius, 
          count: 64 
        });
      } else {
        // Block ID (for ores and other blocks)
        foundPositions = bot.findBlocks({ 
          matching: matching, 
          maxDistance: radius, 
          count: 64 
        });
      }
      
      // Filter out blocks that are in water
      positions = foundPositions.filter(pos => !isInWater(pos));
      
      radius += 16; // Expand search radius
    }
    
    // Sort by distance (closest first)
    positions.sort((a, b) => {
      const distA = bot.entity.position.distanceTo(a);
      const distB = bot.entity.position.distanceTo(b);
      return distA - distB;
    });
    
    return positions;
  }
  
  // Equip the best axe available
  async function equipAxe() {
    const inventory = bot.inventory.items();
    const axes = [
      'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'
    ];
    
    for (const axeName of axes) {
      const axe = inventory.find(item => item.name === axeName);
      if (axe) {
        try {
          await bot.equip(axe, 'hand');
          bot.chat(`Equipped ${axe.name} for chopping.`);
          return true;
        } catch (e) {
          console.error('Failed to equip axe:', e.message);
          return false;
        }
      }
    }
    
    bot.chat('I don\'t have an axe! I need an axe to gather wood.');
    return false;
  }
  
  // Get required pickaxe tier for an ore
  function getRequiredPickaxeTier(oreName) {
    const ore = oreName.toLowerCase();
    
    // Tier 0: Any pickaxe (wood/gold minimum)
    if (ore.includes('stone') || ore.includes('coal') || ore.includes('cobblestone')) {
      return 0; // Any pickaxe
    }
    
    // Tier 1: Stone pickaxe or better
    if (ore.includes('iron') || ore.includes('lapis')) {
      return 1; // Stone pickaxe minimum
    }
    
    // Tier 2: Iron pickaxe or better
    if (ore.includes('gold') || ore.includes('redstone') || ore.includes('diamond') || ore.includes('emerald')) {
      return 2; // Iron pickaxe minimum
    }
    
    // Tier 3: Diamond pickaxe or better
    if (ore.includes('obsidian') || ore.includes('ancient') || ore.includes('debris')) {
      return 3; // Diamond pickaxe minimum
    }
    
    // Default: any pickaxe
    return 0;
  }
  
  // Equip the right pickaxe for the ore type
  async function equipPickaxeForOre(oreName) {
    const inventory = bot.inventory.items();
    const requiredTier = getRequiredPickaxeTier(oreName);
    
    // Pickaxe tiers: 0=wood/gold, 1=stone, 2=iron, 3=diamond, 4=netherite
    const pickaxesByTier = {
      0: ['wooden_pickaxe', 'golden_pickaxe'],
      1: ['stone_pickaxe'],
      2: ['iron_pickaxe'],
      3: ['diamond_pickaxe'],
      4: ['netherite_pickaxe']
    };
    
    // Find pickaxes that meet the requirement (tier >= required)
    const suitablePickaxes = [];
    for (let tier = requiredTier; tier <= 4; tier++) {
      if (pickaxesByTier[tier]) {
        for (const pickaxeName of pickaxesByTier[tier]) {
          const pickaxe = inventory.find(item => item.name === pickaxeName);
          if (pickaxe) {
            suitablePickaxes.push({ pickaxe, tier });
          }
        }
      }
    }
    
    if (suitablePickaxes.length === 0) {
      const tierNames = ['any pickaxe', 'stone pickaxe', 'iron pickaxe', 'diamond pickaxe'];
      bot.chat(`I don't have a ${tierNames[requiredTier]}! I need a ${tierNames[requiredTier]} to mine ${oreName}.`);
      return false;
    }
    
    // Use the best pickaxe available (lowest tier number = best)
    suitablePickaxes.sort((a, b) => a.tier - b.tier);
    const bestPickaxe = suitablePickaxes[0].pickaxe;
    
    try {
      await bot.equip(bestPickaxe, 'hand');
      bot.chat(`Equipped ${bestPickaxe.name} for mining ${oreName}.`);
      return true;
    } catch (e) {
      console.error('Failed to equip pickaxe:', e.message);
      return false;
    }
  }
  
  async function handleGatherWood() {
    // Check for and equip axe
    const hasAxe = await equipAxe();
    if (!hasAxe) return;
    
    const logIds = [
      'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'
    ].map(name => mcData.blocksByName[name] && mcData.blocksByName[name].id).filter(Boolean);

    // Use improved radius search for wood
    const logPositions = findBlocksInRadius(
      (blk) => {
        const block = bot.blockAt(blk);
        return block && logIds.includes(block.type);
      },
      32,
      96
    );
    
    if (!logPositions || logPositions.length === 0) {
      bot.chat('I cannot find any logs nearby (searched up to 96 blocks).');
      return;
    }
    
    // Get the closest log
    const targetBlock = bot.blockAt(logPositions[0]);
    if (!targetBlock) {
      bot.chat('I cannot find any logs nearby.');
      return;
    }
    
    // Check if log is below us and we need to dig
    const botY = Math.floor(bot.entity.position.y);
    const blockY = Math.floor(targetBlock.position.y);
    
    if (blockY < botY - 1) {
      // Log is below, create staircase
      await digStaircaseToBlock(targetBlock);
    }

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.pvp.stop(); } catch (_) {}
    
    // Set water-avoiding movements before collecting
    try {
      bot.pathfinder.setMovements(gatheringMovements);
    } catch (_) {}

    try {
      await bot.collectBlock.collect(targetBlock);
      bot.chat('Collected some wood.');
    } catch (err) {
      console.error(err);
      bot.chat('Failed to collect wood.');
    }
  }
  
  async function handleGatherOre(oreName, countTarget) {
    // Check for and equip appropriate pickaxe
    const hasPickaxe = await equipPickaxeForOre(oreName);
    if (!hasPickaxe) return;
    
    // Map ore names to block names
    const oreMap = {
      'stone': 'stone',
      'cobblestone': 'cobblestone',
      'coal': 'coal_ore',
      'iron': 'iron_ore',
      'gold': 'gold_ore',
      'lapis': 'lapis_ore',
      'redstone': 'redstone_ore',
      'diamond': 'diamond_ore',
      'emerald': 'emerald_ore',
      'obsidian': 'obsidian',
      'ancient': 'ancient_debris',
      'debris': 'ancient_debris'
    };
    
    const normalizedOre = oreName.toLowerCase();
    let blockName = normalizedOre;
    
    // Try to find matching ore name
    for (const [key, value] of Object.entries(oreMap)) {
      if (normalizedOre.includes(key)) {
        blockName = value;
        break;
      }
    }
    
    // Also try direct match
    const normalized = blockName.replace(/\s+/g, '_');
    const blockDef = mcData.blocksByName[normalized];
    
    if (!blockDef) {
      bot.chat(`I don't recognize the ore '${oreName}'. Try: stone, coal, iron, gold, lapis, redstone, diamond, emerald, obsidian.`);
      return;
    }

    const itemDef = mcData.itemsByName[normalized];
    const getInventoryCount = () => {
      const items = bot.inventory.items();
      // Try to match by name (ore might drop as different item)
      return items.filter(i => {
        const itemName = i.name.toLowerCase();
        return itemName.includes(normalizedOre) || 
               itemName === normalized ||
               (itemDef && i.name === itemDef.name);
      }).reduce((a, i) => a + i.count, 0);
    };

    const startCount = getInventoryCount();
    if (startCount >= countTarget) {
      bot.chat(`I already have ${startCount} ${oreName}.`);
      return;
    }

    bot.chat(`Looking for ${countTarget} ${oreName}. I have ${startCount} now.`);

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.pvp.stop(); } catch (_) {}
    
    // Set water-avoiding movements before collecting
    try {
      bot.pathfinder.setMovements(gatheringMovements);
    } catch (_) {}

    let collected = 0;
    try {
      while (getInventoryCount() < countTarget && collected < countTarget) {
        // Use improved radius search
        const positions = findBlocksInRadius(blockDef.id, 32, 128);
        if (!positions || positions.length === 0) {
          bot.chat(`Can't find more '${oreName}' nearby (searched up to 128 blocks).`);
          break;
        }
        
        // Sort blocks: prioritize blocks on same level or above, then by distance
        const botY = Math.floor(bot.entity.position.y);
        positions.sort((posA, posB) => {
          const depthA = botY - posA.y;
          const depthB = botY - posB.y;
          
          // Prioritize blocks that don't need staircase (depth <= 2)
          const needsStairA = depthA > 2;
          const needsStairB = depthB > 2;
          
          if (needsStairA && !needsStairB) return 1;
          if (!needsStairA && needsStairB) return -1;
          
          // If both need or don't need stairs, sort by distance
          const distA = bot.entity.position.distanceTo(posA);
          const distB = bot.entity.position.distanceTo(posB);
          return distA - distB;
        });
        
        // Process blocks one by one
        let foundInThisIteration = false;
        for (const pos of positions) {
          // Check if we already have enough
          const currentCount = getInventoryCount();
          if (currentCount >= countTarget) {
            bot.chat(`Reached target! I now have ${currentCount} ${oreName}.`);
            return;
          }
          
          const block = bot.blockAt(pos);
          if (!block || block.type !== blockDef.id) continue;
          
          // Check if block is deep below us and we need to dig stairs
          const botY = Math.floor(bot.entity.position.y);
          const blockY = Math.floor(pos.y);
          
          if (blockY < botY - 2) {
            // Block is deep below, create staircase
            bot.chat(`Block is ${botY - blockY} blocks below. Creating stairs...`);
            await digStaircaseToBlock(block);
          }
          
          // Now collect the block
          try {
            await bot.collectBlock.collect(block);
            collected++;
            foundInThisIteration = true;
            await sleep(300); // Delay to let items drop and be collected
            
            // Check count after each collection
            const afterCount = getInventoryCount();
            bot.chat(`Collected! Now have ${afterCount}/${countTarget} ${oreName}.`);
            
            if (afterCount >= countTarget) {
              bot.chat(`Done! I have ${afterCount} ${oreName}.`);
              return;
            }
          } catch (err) {
            console.error('Failed to collect block:', err.message);
            // Try to path closer and try again (avoiding water)
            try {
              await goNearPositionAvoidWater(pos, 2, 5000);
              await bot.collectBlock.collect(block);
              collected++;
              foundInThisIteration = true;
              await sleep(300);
              
              const afterCount = getInventoryCount();
              bot.chat(`Collected! Now have ${afterCount}/${countTarget} ${oreName}.`);
              
              if (afterCount >= countTarget) {
                bot.chat(`Done! I have ${afterCount} ${oreName}.`);
                return;
              }
            } catch (e2) {
              // Skip this block if still failing
              continue;
            }
          }
          
          // Break after collecting one block to re-evaluate positions
          if (foundInThisIteration) break;
        }
        
        // If we didn't find any blocks in this iteration, stop
        if (!foundInThisIteration) {
          bot.chat(`Couldn't collect any more blocks. I have ${getInventoryCount()} ${oreName}.`);
          break;
        }
      }
      
      const finalCount = getInventoryCount();
      bot.chat(`Finished gathering. I now have ${finalCount} ${oreName}.`);
    } catch (err) {
      console.error(err);
      bot.chat(`Failed to gather '${oreName}'.`);
    }
  }
  
  async function handleGatherBlocks(blockNameInput, countTarget) {
    const normalized = blockNameInput.replace(/\s+/g, '_');
    const blockDef = mcData.blocksByName[normalized];
    if (!blockDef) {
      bot.chat(`I don't recognize the block '${blockNameInput}'.`);
      return;
    }

    const itemDef = mcData.itemsByName[normalized];
    const getInventoryCount = () => bot.inventory.items().filter(i => i.name === (itemDef ? itemDef.name : blockDef.name)).reduce((a, i) => a + i.count, 0);

    const startCount = getInventoryCount();
    if (startCount >= countTarget) {
      bot.chat(`I already have ${startCount} ${blockNameInput}.`);
      return;
    }

    bot.chat(`Looking for ${countTarget} ${blockNameInput}. I have ${startCount} now.`);

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.pvp.stop(); } catch (_) {}
    
    // Set water-avoiding movements before collecting
    try {
      bot.pathfinder.setMovements(gatheringMovements);
    } catch (_) {}

    let collected = 0;
    try {
      while (getInventoryCount() < countTarget && collected < countTarget) {
        // Use improved radius search
        const positions = findBlocksInRadius(blockDef.id, 32, 128);
        if (!positions || positions.length === 0) {
          bot.chat(`Can't find more '${blockNameInput}' nearby (searched up to 128 blocks).`);
          break;
        }
        
        // Sort blocks: prioritize blocks on same level or above, then by distance
        const botY = Math.floor(bot.entity.position.y);
        positions.sort((posA, posB) => {
          const depthA = botY - posA.y;
          const depthB = botY - posB.y;
          
          // Prioritize blocks that don't need staircase (depth <= 2)
          const needsStairA = depthA > 2;
          const needsStairB = depthB > 2;
          
          if (needsStairA && !needsStairB) return 1;
          if (!needsStairA && needsStairB) return -1;
          
          // If both need or don't need stairs, sort by distance
          const distA = bot.entity.position.distanceTo(posA);
          const distB = bot.entity.position.distanceTo(posB);
          return distA - distB;
        });
        
        // Process blocks one by one
        let foundInThisIteration = false;
        for (const pos of positions) {
          // Check if we already have enough
          const currentCount = getInventoryCount();
          if (currentCount >= countTarget) {
            bot.chat(`Reached target! I now have ${currentCount} ${blockNameInput}.`);
            return;
          }
          
          const block = bot.blockAt(pos);
          if (!block || block.type !== blockDef.id) continue;
          
          // Check if block is deep below us and we need to dig stairs
          const botY = Math.floor(bot.entity.position.y);
          const blockY = Math.floor(pos.y);
          
          if (blockY < botY - 2) {
            // Block is deep below, create staircase
            bot.chat(`Block is ${botY - blockY} blocks below. Creating stairs...`);
            await digStaircaseToBlock(block);
          }
          
          // Now collect the block
          try {
            await bot.collectBlock.collect(block);
            collected++;
            foundInThisIteration = true;
            await sleep(300); // Delay to let items drop and be collected
            
            // Check count after each collection
            const afterCount = getInventoryCount();
            bot.chat(`Collected! Now have ${afterCount}/${countTarget} ${blockNameInput}.`);
            
            if (afterCount >= countTarget) {
              bot.chat(`Done! I have ${afterCount} ${blockNameInput}.`);
              return;
            }
          } catch (err) {
            console.error('Failed to collect block:', err.message);
            // Try to path closer and try again (avoiding water)
            try {
              await goNearPositionAvoidWater(pos, 2, 5000);
              await bot.collectBlock.collect(block);
              collected++;
              foundInThisIteration = true;
              await sleep(300);
              
              const afterCount = getInventoryCount();
              bot.chat(`Collected! Now have ${afterCount}/${countTarget} ${blockNameInput}.`);
              
              if (afterCount >= countTarget) {
                bot.chat(`Done! I have ${afterCount} ${blockNameInput}.`);
                return;
              }
            } catch (e2) {
              // Skip this block if still failing
              continue;
            }
          }
          
          // Break after collecting one block to re-evaluate positions
          if (foundInThisIteration) break;
        }
        
        // If we didn't find any blocks in this iteration, stop
        if (!foundInThisIteration) {
          bot.chat(`Couldn't collect any more blocks. I have ${getInventoryCount()} ${blockNameInput}.`);
          break;
        }
      }
      
      const finalCount = getInventoryCount();
      bot.chat(`Finished gathering. I now have ${finalCount} ${blockNameInput}.`);
    } catch (err) {
      console.error(err);
      bot.chat(`Failed to gather '${blockNameInput}'.`);
    }
  }
  
  async function handlePickup(radius) {
    const drops = Object.values(bot.entities).filter(e => e.name === 'item');
    if (drops.length === 0) { bot.chat('No drops nearby.'); return; }
    drops.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
    const targets = drops.filter(d => bot.entity.position.distanceTo(d.position) <= radius);
    if (targets.length === 0) { bot.chat('No drops within range.'); return; }
    try {
      for (const d of targets) {
        // Check if drop is in water - if so, skip it
        const dropBlock = bot.blockAt(d.position);
        if (dropBlock && (dropBlock.name === 'water' || dropBlock.name === 'flowing_water' || 
            dropBlock.name === 'lava' || dropBlock.name === 'flowing_lava')) {
          continue; // Skip items in water/lava
        }
        await goNearPositionAvoidWater(d.position, 1.2, 8000);
        await sleep(250);
      }
      bot.chat('Picked up nearby drops.');
    } catch (e) {
      console.error(e);
      bot.chat('Failed to pick up drops.');
    }
  }
};
