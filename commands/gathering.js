// Gathering commands: gather wood (with axe), gather ore (with pickaxe), gather blocks (generic), pickup

const { goNearPosition, sleep } = require('../utils/helpers');
const { Vec3 } = require('vec3');
const { Movements } = require('mineflayer-pathfinder');

module.exports = function(bot, mcData, defaultMovements, goals, states) {
  
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
  
  // ========== FARMER MODE CONSTANTS ==========
  // Seed types that can be planted
  const SEED_TYPES = [
    'wheat_seeds', 'beetroot_seeds', 'carrot', 'potato', 
    'pumpkin_seeds', 'melon_seeds', 'nether_wart'
  ];
  
  // Crop blocks that can be harvested
  const CROP_TYPES = [
    'wheat', 'beetroot', 'carrots', 'potatoes',
    'pumpkin', 'melon', 'nether_wart'
  ];
  
  return {
    'gather wood': async () => await startGatherWood(),
    'wood': async () => await startGatherWood(),
    'collect wood': async () => await startGatherWood(),
    'stop gather wood': () => stopGatherWood(),
    'stop wood': () => stopGatherWood(),
    
    'woodcutter mode': async (username, message) => {
      const parts = message.split(/\s+/);
      const diameter = parseInt(parts[2]) || 32; // Default 32 blocks diameter
      await startWoodcutterMode(diameter);
    },
    
    'woodcutter': async (username, message) => {
      const parts = message.split(/\s+/);
      const diameter = parseInt(parts[1]) || 32; // Default 32 blocks diameter
      await startWoodcutterMode(diameter);
    },
    
    'stop woodcutter': () => stopWoodcutterMode(),
    'woodcutter stop': () => stopWoodcutterMode(),
    
    'farmer mode': async () => await startFarmerMode(),
    'farmer': async () => await startFarmerMode(),
    'stop farmer': () => stopFarmerMode(),
    'farmer stop': () => stopFarmerMode(),
    
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
  
  // Helper function to find logs nearby
  function findNearbyLogs(logIds, logNameSet, maxRadius = 96) {
    const logPositions = [];
    const botPos = bot.entity.position;
    const searchRadius = 32; // Start with 32 blocks
    
    let currentRadius = searchRadius;
    while (logPositions.length === 0 && currentRadius <= maxRadius) {
      // Scan in a cube around the bot
      const scanRange = Math.ceil(currentRadius);
      for (let x = -scanRange; x <= scanRange; x++) {
        for (let y = -scanRange; y <= scanRange; y++) {
          for (let z = -scanRange; z <= scanRange; z++) {
            const checkPos = botPos.offset(x, y, z);
            const dist = botPos.distanceTo(checkPos);
            if (dist > currentRadius) continue; // Skip if outside current radius
            
            const block = bot.blockAt(checkPos);
            if (!block) continue;
            
            let isLog = false;
            
            // Check by block ID first (fastest)
            if (logIds.includes(block.type)) {
              isLog = true;
            }
            // Check by block name
            else {
              const blockName = block.name || '';
              if (logNameSet.has(blockName)) {
                isLog = true;
              }
              // Pattern matching for log/wood variants
              else if ((blockName.includes('_log') || blockName.includes('_wood')) &&
                       !blockName.includes('leaves') && !blockName.includes('planks') && 
                       !blockName.includes('sapling') && !blockName.includes('fence') &&
                       !blockName.includes('door') && !blockName.includes('trapdoor') &&
                       !blockName.includes('slab') && !blockName.includes('stairs') &&
                       !blockName.includes('button') && !blockName.includes('pressure_plate')) {
                isLog = true;
              }
            }
            
            if (isLog && !isInWater(checkPos)) {
              logPositions.push(checkPos);
            }
          }
        }
      }
      
      if (logPositions.length === 0) {
        currentRadius += 16; // Expand search radius
      }
    }
    
    // Sort by distance (closest first)
    logPositions.sort((a, b) => {
      const distA = botPos.distanceTo(a);
      const distB = botPos.distanceTo(b);
      return distA - distB;
    });
    
    return logPositions;
  }
  
  async function collectOneLog(logIds, logNameSet) {
    const logPositions = findNearbyLogs(logIds, logNameSet);
    
    if (logPositions.length === 0) {
      return false; // No logs found
    }
    
    // Get the closest log
    const targetBlock = bot.blockAt(logPositions[0]);
    if (!targetBlock) {
      return false;
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
      return true; // Successfully collected
    } catch (err) {
      console.error('Failed to collect wood:', err.message);
      return false;
    }
  }
  
  async function startGatherWood() {
    // Initialize gatherWoodState if it doesn't exist
    if (!states.gatherWoodState) {
      states.gatherWoodState = { active: false, interval: null };
    }
    
    // Check if already gathering
    if (states.gatherWoodState.active) {
      bot.chat('I am already gathering wood. Say "stop wood" to stop.');
      return;
    }
    
    // Check for and equip axe
    const hasAxe = await equipAxe();
    if (!hasAxe) return;
    
    // Include all log variants: regular logs, stripped logs, and wood blocks
    const logNames = [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
      'mangrove_log', 'cherry_log', 'pale_oak_log',
      'stripped_oak_log', 'stripped_spruce_log', 'stripped_birch_log', 'stripped_jungle_log',
      'stripped_acacia_log', 'stripped_dark_oak_log', 'stripped_mangrove_log', 'stripped_cherry_log',
      'stripped_pale_oak_log',
      'oak_wood', 'spruce_wood', 'birch_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood',
      'mangrove_wood', 'cherry_wood', 'pale_oak_wood',
      'stripped_oak_wood', 'stripped_spruce_wood', 'stripped_birch_wood', 'stripped_jungle_wood',
      'stripped_acacia_wood', 'stripped_dark_oak_wood', 'stripped_mangrove_wood', 'stripped_cherry_wood',
      'stripped_pale_oak_wood'
    ];
    
    // Get all valid log block IDs
    const logIds = logNames
      .map(name => {
        const blockDef = mcData.blocksByName[name];
        return blockDef ? blockDef.id : null;
      })
      .filter(Boolean);
    
    // Create a set of log names for name-based matching
    const logNameSet = new Set(logNames);
    
    console.log(`[GATHER WOOD] Starting continuous wood gathering. Found ${logIds.length} log types to search for.`);
    bot.chat('Starting to gather wood. Say "stop wood" to stop.');
    
    states.gatherWoodState.active = true;
    states.gatherWoodState.logIds = logIds;
    states.gatherWoodState.logNameSet = logNameSet;
    
    // Start the gathering loop
    states.gatherWoodState.interval = setInterval(async () => {
      if (!states.gatherWoodState.active) {
        return;
      }
      
      // Check if we still have an axe
      const inventory = bot.inventory.items();
      const hasAxe = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe']
        .some(axeName => inventory.find(item => item.name === axeName));
      
      if (!hasAxe) {
        bot.chat('I lost my axe! Stopping wood gathering.');
        stopGatherWood();
        return;
      }
      
      // Try to collect one log
      const collected = await collectOneLog(logIds, logNameSet);
      
      if (!collected) {
        // No logs found, wait a bit and try again
        console.log('[GATHER WOOD] No logs found, will retry...');
      }
    }, 2000); // Check every 2 seconds
  }
  
  function stopGatherWood() {
    if (!states.gatherWoodState) {
      states.gatherWoodState = { active: false, interval: null };
    }
    
    if (states.gatherWoodState.interval) {
      clearInterval(states.gatherWoodState.interval);
      states.gatherWoodState.interval = null;
    }
    states.gatherWoodState.active = false;
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    bot.chat('Stopped gathering wood.');
  }
  
  // Woodcutter mode: Cut all wood in a defined area
  async function startWoodcutterMode(diameter) {
    // Initialize woodcutterState if it doesn't exist
    if (!states.woodcutterState) {
      states.woodcutterState = { active: false, center: null, radius: null, interval: null, finished: false };
    }
    
    // Check if already active
    if (states.woodcutterState.active) {
      bot.chat('Woodcutter mode is already active. Say "stop woodcutter" to stop.');
      return;
    }
    
    // Check for axe
    const hasAxe = await equipAxe();
    if (!hasAxe) {
      bot.chat('I need an axe to cut wood!');
      return;
    }
    
    // Set center position and radius
    const center = bot.entity.position.clone();
    const radius = diameter / 2; // Convert diameter to radius
    
    states.woodcutterState.active = true;
    states.woodcutterState.center = center;
    states.woodcutterState.radius = radius;
    states.woodcutterState.finished = false; // Reset finished flag
    
    bot.chat(`Starting woodcutter mode in area (diameter: ${diameter} blocks).`);
    console.log(`[WOODCUTTER] Starting mode - Center: ${center.x}, ${center.y}, ${center.z}, Radius: ${radius}`);
    
    // Start the woodcutter loop - optimized to reduce overhead
    let isCollecting = false; // Prevent concurrent collection attempts
    
    states.woodcutterState.interval = setInterval(async () => {
      if (!states.woodcutterState.active || isCollecting) {
        return;
      }
      
      // Don't collect if self-defense is active
      if (bot.selfDefense && bot.selfDefense.isDefending()) {
        console.log('[WOODCUTTER] Paused: Self-defense active');
        return;
      }
      
      // Quick checks first (lightweight)
      const emptySlots = bot.inventory.emptySlotCount();
      if (emptySlots === 0) {
        bot.chat('Inventory is full! Stopping woodcutter mode.');
        console.log('[WOODCUTTER] Stopped: Inventory full');
        await finishWoodcutterMode();
        return;
      }
      
      // Check if we still have an axe (only check inventory once)
      const inventory = bot.inventory.items();
      const hasAxe = ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe']
        .some(axeName => inventory.find(item => item.name === axeName));
      
      if (!hasAxe) {
        bot.chat('No axes left in inventory! Stopping woodcutter mode.');
        console.log('[WOODCUTTER] Stopped: No axes left');
        await finishWoodcutterMode();
        return;
      }
      
      // Find logs in the defined area (this is the expensive operation)
      const logsInArea = findLogsInArea(states.woodcutterState.center, states.woodcutterState.radius);
      
      if (logsInArea.length === 0) {
        // No more logs in area, finish up
        bot.chat('No more wood in area! Finishing woodcutter mode.');
        console.log('[WOODCUTTER] Stopped: No more wood in area');
        await finishWoodcutterMode();
        return;
      }
      
      // Cut the closest log
      const targetBlock = bot.blockAt(logsInArea[0]);
      if (!targetBlock) {
        return;
      }
      
      isCollecting = true; // Mark as collecting to prevent concurrent attempts
      
      // Check if log is below us and we need to dig
      const botY = Math.floor(bot.entity.position.y);
      const blockY = Math.floor(targetBlock.position.y);
      
      if (blockY < botY - 1) {
        await digStaircaseToBlock(targetBlock);
      }
      
      try { bot.pathfinder.setGoal(null); } catch (_) {}
      try { bot.pvp.stop(); } catch (_) {}
      
      try {
        bot.pathfinder.setMovements(gatheringMovements);
      } catch (_) {}
      
      try {
        await bot.collectBlock.collect(targetBlock);
        console.log(`[WOODCUTTER] Collected log. ${logsInArea.length - 1} logs remaining. Empty slots: ${emptySlots}`);
      } catch (err) {
        console.error('[WOODCUTTER] Failed to collect log:', err.message);
      } finally {
        isCollecting = false; // Reset flag after collection attempt
      }
    }, 4000); // Check every 4 seconds (balanced between responsiveness and performance)
  }
  
  // Find all logs within a circular area
  function findLogsInArea(center, radius) {
    const logNames = [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
      'mangrove_log', 'cherry_log', 'pale_oak_log',
      'stripped_oak_log', 'stripped_spruce_log', 'stripped_birch_log', 'stripped_jungle_log',
      'stripped_acacia_log', 'stripped_dark_oak_log', 'stripped_mangrove_log', 'stripped_cherry_log',
      'stripped_pale_oak_log',
      'oak_wood', 'spruce_wood', 'birch_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood',
      'mangrove_wood', 'cherry_wood', 'pale_oak_wood',
      'stripped_oak_wood', 'stripped_spruce_wood', 'stripped_birch_wood', 'stripped_jungle_wood',
      'stripped_acacia_wood', 'stripped_dark_oak_wood', 'stripped_mangrove_wood', 'stripped_cherry_wood',
      'stripped_pale_oak_wood'
    ];
    
    const logIds = logNames
      .map(name => {
        const blockDef = mcData.blocksByName[name];
        return blockDef ? blockDef.id : null;
      })
      .filter(Boolean);
    
    const logNameSet = new Set(logNames);
    const logPositions = [];
    
    // Scan in a cube around the center
    const scanRange = Math.ceil(radius);
    for (let x = -scanRange; x <= scanRange; x++) {
      for (let y = -scanRange; y <= scanRange; y++) {
        for (let z = -scanRange; z <= scanRange; z++) {
          const checkPos = center.offset(x, y, z);
          const dist = center.distanceTo(checkPos);
          
          // Check if within radius (circular area)
          if (dist > radius) continue;
          
          const block = bot.blockAt(checkPos);
          if (!block) continue;
          
          let isLog = false;
          
          // Check by block ID
          if (logIds.includes(block.type)) {
            isLog = true;
          } else {
            const blockName = block.name || '';
            if (logNameSet.has(blockName)) {
              isLog = true;
            } else if ((blockName.includes('_log') || blockName.includes('_wood')) &&
                       !blockName.includes('leaves') && !blockName.includes('planks') && 
                       !blockName.includes('sapling') && !blockName.includes('fence') &&
                       !blockName.includes('door') && !blockName.includes('trapdoor') &&
                       !blockName.includes('slab') && !blockName.includes('stairs') &&
                       !blockName.includes('button') && !blockName.includes('pressure_plate')) {
              isLog = true;
            }
          }
          
          if (isLog && !isInWater(checkPos)) {
            logPositions.push(checkPos);
          }
        }
      }
    }
    
    // Sort by distance from bot's current position
    const botPos = bot.entity.position;
    logPositions.sort((a, b) => {
      const distA = botPos.distanceTo(a);
      const distB = botPos.distanceTo(b);
      return distA - distB;
    });
    
    return logPositions;
  }
  
  // Finish woodcutter mode and deposit wood in chest if available
  async function finishWoodcutterMode() {
    // Prevent multiple calls
    if (states.woodcutterState?.finished) {
      return;
    }
    
    // Mark as finished first to prevent re-entry
    if (states.woodcutterState) {
      states.woodcutterState.finished = true;
    }
    
    // Stop the loop first
    stopWoodcutterMode();
    
    // Find chest in the area
    const center = states.woodcutterState?.center || bot.entity.position;
    const radius = states.woodcutterState?.radius || 32;
    
    const chest = bot.findBlock({
      matching: (block) => block && (block.name === 'chest' || block.name === 'trapped_chest'),
      maxDistance: radius * 2 // Search in the area
    });
    
    if (chest) {
      bot.chat('Found chest in area. Depositing wood...');
      
      try {
        // Get all wood items from inventory
        const inventory = bot.inventory.items();
        const woodItems = inventory.filter(item => {
          const name = item.name || '';
          return name.includes('log') || name.includes('wood') || 
                 name.includes('planks') || name.includes('stripped');
        });
        
        if (woodItems.length === 0) {
          bot.chat('No wood items to deposit.');
          bot.chat('Woodcutter mode completed!');
          return;
        }
        
        // Go to chest
        await goNearPosition(bot, defaultMovements, goals, chest.position, 1.6, 8000);
        await sleep(500);
        
        // Open chest
        const chestBlock = bot.blockAt(chest.position);
        if (!chestBlock) {
          bot.chat('Chest not found.');
          bot.chat('Woodcutter mode completed!');
          return;
        }
        
        const chestWindow = await bot.openChest(chestBlock);
        
        if (!chestWindow) {
          bot.chat('Failed to open chest.');
          bot.chat('Woodcutter mode completed!');
          return;
        }
        
        // Deposit wood items
        let deposited = 0;
        for (const item of woodItems) {
          try {
            await chestWindow.deposit(item.type, null, item.count);
            deposited += item.count;
          } catch (e) {
            // Item might not fit, continue with next
            continue;
          }
        }
        
        // Close chest
        chestWindow.close();
        
        bot.chat(`Deposited ${deposited} wood items in chest.`);
      } catch (err) {
        console.error('[WOODCUTTER] Failed to deposit wood:', err.message);
        bot.chat('Failed to deposit wood in chest.');
      }
    } else {
      bot.chat('No chest found in area. Wood remains in inventory.');
    }
    
    bot.chat('Woodcutter mode completed!');
  }
  
  function stopWoodcutterMode() {
    if (!states.woodcutterState) {
      states.woodcutterState = { active: false, center: null, radius: null, interval: null, finished: false };
    }
    
    if (states.woodcutterState.interval) {
      clearInterval(states.woodcutterState.interval);
      states.woodcutterState.interval = null;
    }
    states.woodcutterState.active = false;
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    
    // Only send message if not finished (finished mode will send its own message)
    if (!states.woodcutterState.finished) {
      bot.chat('Stopped woodcutter mode.');
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
  
  // ========== FARMER MODE ==========
  
  // Find all farmland blocks in the area and determine boundaries
  function findFarmlandArea() {
    const botPos = bot.entity.position;
    const searchRadius = 30; // 60 block diameter (30 block radius)
    const farmlandBlocks = [];
    
    // Scan for farmland blocks
    const scanRange = Math.ceil(searchRadius);
    for (let x = -scanRange; x <= scanRange; x++) {
      for (let y = -scanRange; y <= scanRange; y++) {
        for (let z = -scanRange; z <= scanRange; z++) {
          const checkPos = botPos.offset(x, y, z);
          const dist = botPos.distanceTo(checkPos);
          
          if (dist > searchRadius) continue;
          
          const block = bot.blockAt(checkPos);
          if (!block) continue;
          
          // Check if it's farmland (only actual farmland blocks, not dirt/grass)
          if (block.name === 'farmland') {
            // Check if there's air or a crop above (not a solid block)
            const blockAbove = bot.blockAt(checkPos.offset(0, 1, 0));
            if (blockAbove && (blockAbove.name === 'air' || CROP_TYPES.some(crop => blockAbove.name.includes(crop)))) {
              farmlandBlocks.push(checkPos);
            }
          }
        }
      }
    }
    
    if (farmlandBlocks.length === 0) {
      return null;
    }
    
    // Calculate boundaries (min/max x, z)
    let minX = farmlandBlocks[0].x;
    let maxX = farmlandBlocks[0].x;
    let minZ = farmlandBlocks[0].z;
    let maxZ = farmlandBlocks[0].z;
    let minY = farmlandBlocks[0].y;
    let maxY = farmlandBlocks[0].y;
    
    for (const pos of farmlandBlocks) {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minZ = Math.min(minZ, pos.z);
      maxZ = Math.max(maxZ, pos.z);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }
    
    // Calculate center
    const center = new Vec3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );
    
    return {
      center,
      bounds: { minX, maxX, minZ, maxZ, minY, maxY },
      blocks: farmlandBlocks
    };
  }
  
  // Check if a position is within the farmer area bounds
  function isWithinFarmerArea(pos, bounds) {
    if (!bounds) return false;
    return pos.x >= bounds.minX && pos.x <= bounds.maxX &&
           pos.z >= bounds.minZ && pos.z <= bounds.maxZ &&
           pos.y >= bounds.minY - 2 && pos.y <= bounds.maxY + 2;
  }
  
  // Find empty farmland blocks (farmland with air above)
  function findEmptyFarmland(bounds) {
    const emptyFarmland = [];
    
    if (!bounds) return emptyFarmland;
    
    // Get all farmland positions from the initial scan (stored in farmerState if available)
    // Otherwise, scan the bounds
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        // Check Y levels within bounds
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
          const pos = new Vec3(x, y, z);
          const block = bot.blockAt(pos);
          
          if (!block) continue;
          
          // Check if it's farmland
          if (block.name === 'farmland') {
            // Check if there's air above (empty farmland)
            const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
            if (blockAbove && blockAbove.name === 'air') {
              emptyFarmland.push(pos);
            }
          }
        }
      }
    }
    
    // Sort by distance from bot
    const botPos = bot.entity.position;
    emptyFarmland.sort((a, b) => {
      const distA = botPos.distanceTo(a);
      const distB = botPos.distanceTo(b);
      return distA - distB;
    });
    
    return emptyFarmland;
  }
  
  // Find seeds in inventory
  function findSeedsInInventory() {
    const inventory = bot.inventory.items();
    const seeds = [];
    
    for (const item of inventory) {
      const itemName = item.name || '';
      // Check if it's a seed type
      if (SEED_TYPES.some(seed => itemName.includes(seed) || itemName === seed)) {
        seeds.push(item);
      }
    }
    
    return seeds;
  }
  
  // Plant a seed on farmland
  async function plantSeed(seedItem, farmlandPos) {
    try {
      // Equip the seed
      await bot.equip(seedItem, 'hand');
      await sleep(200);
      
      // Go near the farmland
      await goNearPosition(bot, defaultMovements, goals, farmlandPos, 1.5, 8000);
      await sleep(300);
      
      // Get the farmland block
      const farmlandBlock = bot.blockAt(farmlandPos);
      if (!farmlandBlock || farmlandBlock.name !== 'farmland') {
        return false;
      }
      
      // Check if there's still air above
      const blockAbove = bot.blockAt(farmlandPos.offset(0, 1, 0));
      if (!blockAbove || blockAbove.name !== 'air') {
        return false;
      }
      
      // Plant the seed by right-clicking on the farmland
      // We need to look at the block and activate it
      await bot.lookAt(farmlandPos.offset(0, 1, 0));
      await sleep(100);
      
      // Use activateBlock to plant (right-click)
      await bot.activateBlock(farmlandBlock, new Vec3(0, 1, 0));
      await sleep(200);
      
      return true;
    } catch (err) {
      console.error('[FARMER] Failed to plant seed:', err.message);
      return false;
    }
  }
  
  // Find mature crops ready to harvest
  function findMatureCrops(bounds) {
    const matureCrops = [];
    
    if (!bounds) return matureCrops;
    
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        for (let y = bounds.minY; y <= bounds.maxY + 1; y++) {
          const pos = new Vec3(x, y, z);
          const block = bot.blockAt(pos);
          
          if (!block) continue;
          
          // Check if it's a crop block
          const blockName = block.name || '';
          let isCrop = false;
          let isMature = false;
          
          // Check crop types
          if (blockName.includes('wheat') || blockName === 'wheat') {
            isCrop = true;
            // Wheat is mature when metadata.age >= 7
            isMature = (block.metadata !== undefined && block.metadata >= 7) || 
                       (block.state !== undefined && block.state.age >= 7);
          } else if (blockName.includes('carrot') || blockName === 'carrots') {
            isCrop = true;
            isMature = (block.metadata !== undefined && block.metadata >= 7) ||
                       (block.state !== undefined && block.state.age >= 7);
          } else if (blockName.includes('potato') || blockName === 'potatoes') {
            isCrop = true;
            isMature = (block.metadata !== undefined && block.metadata >= 7) ||
                       (block.state !== undefined && block.state.age >= 7);
          } else if (blockName.includes('beetroot') || blockName === 'beetroot') {
            isCrop = true;
            isMature = (block.metadata !== undefined && block.metadata >= 3) ||
                       (block.state !== undefined && block.state.age >= 3);
          } else if (blockName === 'pumpkin' || blockName === 'melon') {
            isCrop = true;
            isMature = true; // Pumpkins and melons are always harvestable
          } else if (blockName.includes('nether_wart')) {
            isCrop = true;
            isMature = (block.metadata !== undefined && block.metadata >= 3) ||
                       (block.state !== undefined && block.state.age >= 3);
          }
          
          // For crops without metadata, assume they're mature if they exist
          if (isCrop && (isMature || block.metadata === undefined)) {
            matureCrops.push(pos);
          }
        }
      }
    }
    
    // Sort by distance from bot
    const botPos = bot.entity.position;
    matureCrops.sort((a, b) => {
      const distA = botPos.distanceTo(a);
      const distB = botPos.distanceTo(b);
      return distA - distB;
    });
    
    return matureCrops;
  }
  
  // Pick up dropped crops and seeds in the farmer area
  async function pickupFarmerItems(bounds) {
    if (!bounds) return;
    
    try {
      // Find all item entities (dropped items)
      const drops = Object.values(bot.entities).filter(e => e.name === 'item');
      if (drops.length === 0) return;
      
      // Filter items within the farmer area bounds
      const farmerItems = drops.filter(drop => {
        const dropPos = drop.position;
        return isWithinFarmerArea(dropPos, bounds);
      });
      
      if (farmerItems.length === 0) return;
      
      // Sort by distance (closest first)
      const botPos = bot.entity.position;
      farmerItems.sort((a, b) => {
        const distA = botPos.distanceTo(a.position);
        const distB = botPos.distanceTo(b.position);
        return distA - distB;
      });
      
      // Pick up items (just move near them - mineflayer auto-collects nearby items)
      for (const item of farmerItems) {
        try {
          // Check if item still exists
          if (!bot.entities[item.id]) continue;
          
          // Check if drop is in water - if so, skip it
          const dropBlock = bot.blockAt(item.position);
          if (dropBlock && (dropBlock.name === 'water' || dropBlock.name === 'flowing_water' || 
              dropBlock.name === 'lava' || dropBlock.name === 'flowing_lava')) {
            continue; // Skip items in water/lava
          }
          
          // Move near the item (within pickup range - mineflayer auto-collects within ~1 block)
          await goNearPosition(bot, defaultMovements, goals, item.position, 1.2, 5000);
          await sleep(200); // Wait for auto-pickup
        } catch (err) {
          // Item might have been picked up or moved, continue
          continue;
        }
      }
    } catch (err) {
      console.error('[FARMER] Failed to pickup items:', err.message);
    }
  }
  
  // Harvest a crop
  async function harvestCrop(cropPos) {
    try {
      // Go near the crop
      await goNearPosition(bot, defaultMovements, goals, cropPos, 1.5, 8000);
      await sleep(300);
      
      // Get the crop block
      const cropBlock = bot.blockAt(cropPos);
      if (!cropBlock) {
        return false;
      }
      
      // Check if it's still a crop
      const blockName = cropBlock.name || '';
      if (!CROP_TYPES.some(crop => blockName.includes(crop))) {
        return false;
      }
      
      // Break the crop
      try {
        await bot.dig(cropBlock);
        await sleep(300);
        
        // Wait a bit for items to drop
        await sleep(500);
        
        return true;
      } catch (err) {
        console.error('[FARMER] Failed to dig crop:', err.message);
        return false;
      }
    } catch (err) {
      console.error('[FARMER] Failed to harvest crop:', err.message);
      return false;
    }
  }
  
  // Deposit crops in nearby chest
  async function depositCropsInChest(bounds) {
    if (!bounds) return;
    
    // Find chest in the area
    const chest = bot.findBlock({
      matching: (block) => block && (block.name === 'chest' || block.name === 'trapped_chest'),
      maxDistance: 32
    });
    
    if (!chest) {
      return; // No chest found
    }
    
    try {
      bot.chat('Found chest. Depositing crops...');
      
      // Get all crop items from inventory (but NOT seeds - keep seeds for replanting)
      const inventory = bot.inventory.items();
      const cropItems = inventory.filter(item => {
        const name = item.name || '';
        // Check if it's a seed type - if so, exclude it
        const isSeed = SEED_TYPES.some(seed => {
          // Exact match or name includes the seed name
          return name === seed || name.includes(seed);
        });
        if (isSeed) {
          return false; // Don't deposit seeds
        }
        // Only deposit crops (harvested items), not seeds
        return CROP_TYPES.some(crop => name.includes(crop));
      });
      
      if (cropItems.length === 0) {
        return; // No crops to deposit
      }
      
      // Go to chest
      await goNearPosition(bot, defaultMovements, goals, chest.position, 1.6, 8000);
      await sleep(500);
      
      // Open chest
      const chestBlock = bot.blockAt(chest.position);
      if (!chestBlock) {
        return;
      }
      
      const chestWindow = await bot.openChest(chestBlock);
      if (!chestWindow) {
        return;
      }
      
      // Deposit crop items
      let deposited = 0;
      for (const item of cropItems) {
        try {
          await chestWindow.deposit(item.type, null, item.count);
          deposited += item.count;
        } catch (e) {
          // Item might not fit, continue with next
          continue;
        }
      }
      
      // Close chest
      chestWindow.close();
      
      if (deposited > 0) {
        bot.chat(`Deposited ${deposited} crop items in chest.`);
      }
    } catch (err) {
      console.error('[FARMER] Failed to deposit crops:', err.message);
    }
  }
  
  // Phase 1: Plant seeds
  async function phase1Planting() {
    const bounds = states.farmerState.bounds;
    if (!bounds) return false;
    
    // Find seeds in inventory
    const seeds = findSeedsInInventory();
    if (seeds.length === 0) {
      return false; // No seeds to plant
    }
    
    // Find empty farmland
    const emptyFarmland = findEmptyFarmland(bounds);
    if (emptyFarmland.length === 0) {
      return false; // No empty farmland
    }
    
    // Plant seeds until we run out of seeds or empty farmland
    let planted = 0;
    for (const farmlandPos of emptyFarmland) {
      // Check if we still have seeds
      const remainingSeeds = findSeedsInInventory();
      if (remainingSeeds.length === 0) {
        break; // No more seeds
      }
      
      // Use the first available seed
      const seed = remainingSeeds[0];
      
      // Check if we're still in the farmer area
      if (!isWithinFarmerArea(bot.entity.position, bounds)) {
        // Try to return to center
        await goNearPosition(bot, defaultMovements, goals, states.farmerState.center, 2, 8000);
      }
      
      // Plant the seed
      const success = await plantSeed(seed, farmlandPos);
      if (success) {
        planted++;
        await sleep(200); // Small delay between plantings
      }
      
      // Check if farmer mode is still active
      if (!states.farmerState.active) {
        break;
      }
    }
    
    if (planted > 0) {
      bot.chat(`Planted ${planted} seeds.`);
    }
    
    return planted > 0;
  }
  
  // Phase 2: Harvest crops
  async function phase2Harvesting() {
    const bounds = states.farmerState.bounds;
    if (!bounds) return false;
    
    // Find mature crops
    const matureCrops = findMatureCrops(bounds);
    if (matureCrops.length === 0) {
      return false; // No crops to harvest
    }
    
    // Harvest crops
    let harvested = 0;
    for (const cropPos of matureCrops) {
      // Check if we're still in the farmer area
      if (!isWithinFarmerArea(bot.entity.position, bounds)) {
        // Try to return to center
        await goNearPosition(bot, defaultMovements, goals, states.farmerState.center, 2, 8000);
      }
      
      // Harvest the crop
      const success = await harvestCrop(cropPos);
      if (success) {
        harvested++;
        await sleep(300); // Small delay between harvests
        
        // Pick up dropped items after each harvest
        await pickupFarmerItems(bounds);
      }
      
      // Check if farmer mode is still active
      if (!states.farmerState.active) {
        break;
      }
      
      // Check if inventory is getting full
      if (bot.inventory.emptySlotCount() < 3) {
        bot.chat('Inventory getting full. Depositing crops...');
        await depositCropsInChest(bounds);
        await sleep(500);
      }
    }
    
    // Final pickup pass to catch any missed items
    if (harvested > 0) {
      await pickupFarmerItems(bounds);
      bot.chat(`Harvested ${harvested} crops.`);
      
      // After harvesting, deposit in chest if available
      await depositCropsInChest(bounds);
    }
    
    return harvested > 0;
  }
  
  // Start farmer mode
  async function startFarmerMode() {
    // Initialize farmerState if it doesn't exist
    if (!states.farmerState) {
      states.farmerState = { active: false, center: null, bounds: null, phase: 'planting', interval: null, waiting: false };
    }
    
    // Check if already active
    if (states.farmerState.active) {
      bot.chat('Farmer mode is already active. Say "stop farmer" to stop.');
      return;
    }
    
    // Find farmland area
    bot.chat('Scanning for farmland...');
    const farmlandArea = findFarmlandArea();
    
    if (!farmlandArea || farmlandArea.blocks.length === 0) {
      bot.chat('No farmland found in the area!');
      return;
    }
    
    // Set up farmer state
    states.farmerState.active = true;
    states.farmerState.center = farmlandArea.center;
    states.farmerState.bounds = farmlandArea.bounds;
    states.farmerState.phase = 'planting';
    states.farmerState.waiting = false;
    
    bot.chat(`Starting farmer mode! Found ${farmlandArea.blocks.length} farmland blocks.`);
    console.log(`[FARMER] Starting mode - Center: ${farmlandArea.center.x}, ${farmlandArea.center.y}, ${farmlandArea.center.z}`);
    console.log(`[FARMER] Bounds: X[${farmlandArea.bounds.minX}, ${farmlandArea.bounds.maxX}], Z[${farmlandArea.bounds.minZ}, ${farmlandArea.bounds.maxZ}]`);
    
    // Start the farmer loop
    let isWorking = false; // Prevent concurrent operations
    
    states.farmerState.interval = setInterval(async () => {
      if (!states.farmerState.active || isWorking) {
        return;
      }
      
      // Don't work if self-defense is active
      if (bot.selfDefense && bot.selfDefense.isDefending()) {
        console.log('[FARMER] Paused: Self-defense active');
        return;
      }
      
      // Check if bot is still in the farmer area
      if (!isWithinFarmerArea(bot.entity.position, states.farmerState.bounds)) {
        // Return to center
        console.log('[FARMER] Bot left area, returning to center...');
        try {
          await goNearPosition(bot, defaultMovements, goals, states.farmerState.center, 2, 8000);
        } catch (e) {
          console.error('[FARMER] Failed to return to center:', e.message);
        }
        return;
      }
      
      isWorking = true;
      
      try {
        // Alternate between phases
        if (states.farmerState.phase === 'planting') {
          const planted = await phase1Planting();
          
          if (planted) {
            // Successfully planted, switch to harvesting
            states.farmerState.phase = 'harvesting';
            states.farmerState.waiting = false;
          } else {
            // No seeds or no empty farmland, check for crops to harvest
            const hasCrops = findMatureCrops(states.farmerState.bounds).length > 0;
            if (hasCrops) {
              states.farmerState.phase = 'harvesting';
              states.farmerState.waiting = false;
            } else {
              // Nothing to do, wait
              states.farmerState.waiting = true;
              console.log('[FARMER] Waiting: No seeds to plant and no crops to harvest');
            }
          }
        } else if (states.farmerState.phase === 'harvesting') {
          const harvested = await phase2Harvesting();
          
          if (harvested) {
            // Successfully harvested, switch to planting
            states.farmerState.phase = 'planting';
            states.farmerState.waiting = false;
          } else {
            // No crops to harvest, check for empty farmland
            const emptyFarmland = findEmptyFarmland(states.farmerState.bounds);
            const hasSeeds = findSeedsInInventory().length > 0;
            
            if (emptyFarmland.length > 0 && hasSeeds) {
              states.farmerState.phase = 'planting';
              states.farmerState.waiting = false;
            } else {
              // Nothing to do, wait
              states.farmerState.waiting = true;
              console.log('[FARMER] Waiting: No crops to harvest and no seeds/empty farmland');
            }
          }
        }
      } catch (err) {
        console.error('[FARMER] Error in farmer loop:', err.message);
      } finally {
        isWorking = false;
      }
    }, 3000); // Check every 3 seconds
  }
  
  // Stop farmer mode
  function stopFarmerMode() {
    if (!states.farmerState) {
      states.farmerState = { active: false, center: null, bounds: null, phase: 'planting', interval: null, waiting: false };
    }
    
    if (states.farmerState.interval) {
      clearInterval(states.farmerState.interval);
      states.farmerState.interval = null;
    }
    
    states.farmerState.active = false;
    states.farmerState.waiting = false;
    
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    
    bot.chat('Stopped farmer mode.');
  }
};
