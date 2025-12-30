// Survival commands: survival on/off, guard, auto eat, eat, status, stop

const { isWhitelisted } = require('../utils/whitelist');

module.exports = function(bot, mcData, defaultMovements, goals, states) {
  
  // Use the shared states object instead of creating a local copy
  const state = states;
  
  // Add survival-specific properties if they don't exist
  if (state.noFoodWarned === undefined) state.noFoodWarned = false;
  if (state.hasEquippedWeapon === undefined) state.hasEquippedWeapon = false;
  if (state.combatRange === undefined) state.combatRange = 16;
  if (state.isEating === undefined) state.isEating = false;
  if (state.autoEatInterval === undefined) state.autoEatInterval = null;
  
  // Start auto-eat loop if enabled (works independently of survival mode)
  if (state.autoEatEnabled && !state.autoEatInterval) {
    startAutoEatLoop();
  }
  
  return {
    'survival on': () => {
      state.survivalEnabled = true;
      console.log('[SURVIVAL] Enabling survival mode...');
      console.log('[SURVIVAL] State before:', { survivalEnabled: state.survivalEnabled, hasInterval: !!state.survivalInterval });
      startSurvivalLoop();
      console.log('[SURVIVAL] State after:', { survivalEnabled: state.survivalEnabled, hasInterval: !!state.survivalInterval });
      bot.chat('Survival mode enabled.');
    },
    
    'survival off': () => {
      state.survivalEnabled = false;
      stopSurvivalLoop();
      bot.chat('Survival mode disabled.');
    },
    
    'auto eat on': () => {
      state.autoEatEnabled = true;
      startAutoEatLoop();
      bot.chat('Auto-eat enabled.');
    },
    
    'auto eat off': () => {
      state.autoEatEnabled = false;
      stopAutoEatLoop();
      bot.chat('Auto-eat disabled.');
    },
    
    'eat': async () => {
      await forceEat();
    },
    
    'eat now': async () => {
      await forceEat();
    },
    
    'guard here': (username, message) => {
      const parts = message.split(/\s+/);
      let radius = 10;
      const maybe = parseInt(parts[2], 10);
      if (!Number.isNaN(maybe) && maybe > 1 && maybe <= 64) radius = maybe;

      const me = bot.entity.position;
      state.guardState.pos = me.clone();
      state.guardState.radius = radius;
      state.guardState.active = true;
      startGuardLoop();
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(state.guardState.pos.x, state.guardState.pos.y, state.guardState.pos.z, 1));
      bot.chat(`Guarding this spot (r=${radius}).`);
    },
    
    'stop guard': () => {
      stopGuardLoop();
      bot.chat('Stopped guarding.');
    },
    
    'guard stop': () => {
      stopGuardLoop();
      bot.chat('Stopped guarding.');
    },
    
    'guard off': () => {
      stopGuardLoop();
      bot.chat('Guard mode disabled.');
    },
    
    'combat range': (username, message) => {
      const parts = message.split(/\s+/);
      const range = parseInt(parts[2], 10);
      if (!Number.isNaN(range) && range > 0 && range <= 64) {
        state.combatRange = range;
        bot.chat(`Combat range set to ${range} blocks.`);
      } else {
        bot.chat(`Current combat range: ${state.combatRange} blocks. Usage: combat range <1-64>`);
      }
    },
    
    'threats': () => {
      const position = bot.entity.position;
      const hostiles = Object.values(bot.entities)
        .filter(isHostileEntity)
        .map(e => ({
          name: e.name || e.displayName || 'unknown',
          distance: Math.round(position.distanceTo(e.position))
        }))
        .sort((a, b) => a.distance - b.distance);
      
      if (hostiles.length === 0) {
        bot.chat('No threats detected nearby.');
      } else {
        const nearby = hostiles.filter(h => h.distance <= state.combatRange);
        const far = hostiles.filter(h => h.distance > state.combatRange);
        
        if (nearby.length > 0) {
          bot.chat(`Threats in range (${state.combatRange}m): ${nearby.map(h => `${h.name}(${h.distance}m)`).join(', ')}`);
        }
        if (far.length > 0 && far.length <= 3) {
          bot.chat(`Threats beyond range: ${far.slice(0, 3).map(h => `${h.name}(${h.distance}m)`).join(', ')}`);
        }
      }
    },
    
    'check food': () => {
      // Debug command to check food item properties
      const items = bot.inventory.items();
      console.log('\n=== Checking all inventory items for food properties ===');
      items.forEach(item => {
        const foodData = mcData.foodsByName && mcData.foodsByName[item.name];
        console.log(`\n${item.name} (${item.count}x):`);
        if (foodData) {
          console.log('  IS FOOD! ✓');
          console.log('  Food points:', foodData.foodPoints);
          console.log('  Saturation:', foodData.saturation);
          console.log('  Saturation ratio:', foodData.saturationRatio);
        } else {
          console.log('  Not food');
        }
      });
      
      const foodItems = items.filter(item => isFood(item.name));
      bot.chat(`Found ${foodItems.length} food items: ${foodItems.map(i => i.name).join(', ')}`);
    },
    
    'status': () => {
      // Get actual health and food values with proper fallbacks
      const health = bot.health !== undefined ? Math.round(bot.health * 10) / 10 : 'N/A';
      const maxHealth = 20;
      const food = bot.food !== undefined ? bot.food : 'N/A';
      const saturation = bot.foodSaturation !== undefined ? Math.round(bot.foodSaturation * 10) / 10 : 'N/A';
      
      // Get weapon info
      const heldItem = bot.heldItem;
      const weapon = heldItem ? heldItem.name.replace(/_/g, ' ') : 'none';
      
      // Count nearby threats
      const position = bot.entity.position;
      const nearbyThreats = Object.values(bot.entities)
        .filter(isHostileEntity)
        .filter(e => position.distanceTo(e.position) <= state.combatRange)
        .length;
      
      const status = [
        `Survival: ${state.survivalEnabled ? 'ON' : 'OFF'}`,
        `Auto-eat: ${state.autoEatEnabled ? 'ON' : 'OFF'}`,
        `Health: ${health}/${maxHealth}`,
        `Food: ${food}/20`,
        `Weapon: ${weapon}`,
        `Threats: ${nearbyThreats}`,
        `Range: ${state.combatRange}m`
      ];
      bot.chat(`Status: ${status.join(' | ')}`);
    },
    
    'status full': () => {
      // Detailed multi-line status
      const health = bot.health !== undefined ? Math.round(bot.health * 10) / 10 : 'N/A';
      const food = bot.food !== undefined ? bot.food : 'N/A';
      const saturation = bot.foodSaturation !== undefined ? Math.round(bot.foodSaturation * 10) / 10 : 'N/A';
      
      // Get weapon and armor info
      const heldItem = bot.heldItem;
      const weapon = heldItem ? heldItem.name.replace(/_/g, ' ') : 'none';
      
      // Count inventory items
      const inventory = bot.inventory.items();
      const foodCount = inventory.filter(item => isFood(item.name)).reduce((sum, item) => sum + item.count, 0);
      
      // Count nearby threats
      const position = bot.entity.position;
      const nearbyThreats = Object.values(bot.entities)
        .filter(isHostileEntity)
        .filter(e => position.distanceTo(e.position) <= state.combatRange);
      
      bot.chat('=== Bot Status ===');
      bot.chat(`Health: ${health}/20 | Food: ${food}/20 (Sat: ${saturation})`);
      bot.chat(`Weapon: ${weapon} | Food items: ${foodCount}`);
      bot.chat(`Survival: ${state.survivalEnabled ? 'ON' : 'OFF'} | Auto-eat: ${state.autoEatEnabled ? 'ON' : 'OFF'}`);
      bot.chat(`Combat range: ${state.combatRange}m | Threats: ${nearbyThreats.length}`);
      bot.chat(`Guard: ${state.guardState.active ? `ON (r=${state.guardState.radius}m)` : 'OFF'}`);
      bot.chat(`Roaming: ${bot.roamState?.active ? 'ON' : 'OFF'} | Patrol: ${bot.patrolState?.active ? 'ON' : 'OFF'}`);
      bot.chat(`Position: X=${Math.round(bot.entity.position.x)}, Y=${Math.round(bot.entity.position.y)}, Z=${Math.round(bot.entity.position.z)}`);
      
      if (nearbyThreats.length > 0) {
        const threatList = nearbyThreats.slice(0, 3).map(e => {
          const dist = Math.round(position.distanceTo(e.position));
          return `${e.name}(${dist}m)`;
        }).join(', ');
        bot.chat(`Nearby threats: ${threatList}`);
      }
    },
    
    'stop': () => handleStop(),
    'halt': () => handleStop(),
    'cancel': () => handleStop(),
    
    'self defense on': () => {
      // Self-defense is always on by default, this is just for user feedback
      bot.chat('Self-defense is always enabled. I will fight back when attacked.');
    },
    
    'self defense off': () => {
      bot.chat('Self-defense cannot be disabled. I will always defend myself.');
    },
    
    'self defense status': () => {
      if (bot.selfDefense && bot.selfDefense.isDefending()) {
        bot.chat('Currently in self-defense mode!');
      } else {
        bot.chat('Self-defense: Active. Ready to defend if attacked.');
      }
    },
    
    'debug survival': () => {
      console.log('[SURVIVAL DEBUG]');
      console.log('  survivalEnabled:', state.survivalEnabled);
      console.log('  survivalInterval:', !!state.survivalInterval);
      console.log('  autoEatEnabled:', state.autoEatEnabled);
      console.log('  autoEatInterval:', !!state.autoEatInterval);
      console.log('  combatRange:', state.combatRange);
      console.log('  isEating:', state.isEating);
      console.log('  hasEquippedWeapon:', state.hasEquippedWeapon);
      console.log('  food:', bot.food, '/ 20');
      console.log('  saturation:', bot.foodSaturation?.toFixed(1));
      
      const position = bot.entity.position;
      const hostiles = Object.values(bot.entities)
        .filter(isHostileEntity)
        .map(e => ({
          name: e.name,
          distance: Math.round(position.distanceTo(e.position))
        }));
      
      console.log('  Hostile mobs detected:', hostiles.length);
      if (hostiles.length > 0) {
        console.log('  Hostiles:', hostiles);
      }
      
      bot.chat('Debug info logged to console.');
    }
  };
  
  function handleStop() {
    try { bot.pvp.stop(); } catch (_) {}
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    if (bot.stopPatrol) bot.stopPatrol();
    
    // Stop wood gathering if active
    if (state.gatherWoodState && state.gatherWoodState.active) {
      if (state.gatherWoodState.interval) {
        clearInterval(state.gatherWoodState.interval);
        state.gatherWoodState.interval = null;
      }
      state.gatherWoodState.active = false;
    }
    
    // Reset self-defense state if active
    if (bot.selfDefense && bot.selfDefense.isDefending()) {
      bot.selfDefense.stopDefense();
      console.log('[STOP] Reset self-defense state');
    }
    
    // Stop woodcutter mode if active
    if (state.woodcutterState && state.woodcutterState.active) {
      if (state.woodcutterState.interval) {
        clearInterval(state.woodcutterState.interval);
        state.woodcutterState.interval = null;
      }
      state.woodcutterState.active = false;
      try { bot.collectBlock.cancelTask(); } catch (_) {}
      console.log('[STOP] Stopped woodcutter mode');
    }
    
    bot.chat('Stopped current actions.');
  }
  
  // Helper function to check if an item is food
  function isFood(itemName) {
    // Check if the item exists in the foods data
    return mcData.foodsByName && mcData.foodsByName[itemName] !== undefined;
  }
  
  // Helper function to get food value
  function getFoodValue(itemName) {
    const foodData = mcData.foodsByName && mcData.foodsByName[itemName];
    return foodData ? foodData.foodPoints || 0 : 0;
  }
  
  // Force eat (for manual "eat now" command) - eats regardless of hunger
  async function forceEat() {
    const food = bot.food || 20;
    const saturation = bot.foodSaturation || 0;
    
    bot.chat(`Current hunger: ${food}/20, saturation: ${Math.round(saturation * 10) / 10}`);
    
    const foodItems = bot.inventory.items().filter(item => isFood(item.name));
    
    console.log('Food items found:', foodItems.map(i => `${i.name}(${i.count})`).join(', '));
    
    if (foodItems.length === 0) {
      bot.chat('I have no food in my inventory!');
      return;
    }
    
    // Sort by food value (highest first)
    foodItems.sort((a, b) => {
      return getFoodValue(b.name) - getFoodValue(a.name);
    });
    
    const chosenFood = foodItems[0];
    const foodValue = getFoodValue(chosenFood.name);
    
    try {
      await bot.equip(chosenFood, 'hand');
      bot.chat(`Eating ${chosenFood.name} (+${foodValue} food)...`);
      await bot.consume();
      bot.chat(`Ate ${chosenFood.name}!`);
    } catch (e) {
      console.error('Failed to eat:', e.message);
      bot.chat(`Failed to eat: ${e.message}`);
    }
  }
  
  async function autoEat() {
    if (!state.autoEatEnabled) {
      console.log('[AUTO-EAT] Disabled');
      return;
    }
    if (state.isEating) {
      console.log('[AUTO-EAT] Already eating');
      return;
    }
    
    const food = bot.food !== undefined ? bot.food : 20;
    const saturation = bot.foodSaturation !== undefined ? bot.foodSaturation : 5;
    
    console.log(`[AUTO-EAT] Food: ${food}/20, Saturation: ${saturation.toFixed(1)}`);
    
    // Only eat if food is below 16 (lowered threshold to prevent spam)
    // Don't consider saturation for auto-eat to avoid constant eating
    if (food >= 16) {
      console.log('[AUTO-EAT] Food is sufficient');
      return;
    }
    
    const foodItems = bot.inventory.items().filter(item => isFood(item.name));
    
    console.log(`[AUTO-EAT] Found ${foodItems.length} food items: ${foodItems.map(i => `${i.name}(${i.count})`).join(', ')}`);
    
    if (foodItems.length === 0) {
      // Only warn about no food ONCE, not repeatedly
      if (!state.noFoodWarned) {
        bot.chat('Hungry but no food available!');
        state.noFoodWarned = true;
      }
      return;
    }
    
    // Reset the warning flag since we have food now
    state.noFoodWarned = false;
    
    // Smart food selection: don't waste good food on small hunger
    const hungerNeeded = 20 - food;
    
    // Sort by food value (lower to higher for efficiency)
    foodItems.sort((a, b) => {
      return getFoodValue(a.name) - getFoodValue(b.name);
    });
    
    // Find the most efficient food (smallest that satisfies hunger need)
    let chosenFood = foodItems[foodItems.length - 1]; // Default to best if critical
    
    if (food > 8) {
      // Not critical, use efficient food
      for (const item of foodItems) {
        const itemFood = getFoodValue(item.name);
        if (itemFood >= hungerNeeded) {
          chosenFood = item;
          break;
        }
      }
    } else {
      // Critical hunger, use best food available
      chosenFood = foodItems[foodItems.length - 1];
    }
    
    try {
      state.isEating = true;
      console.log(`[AUTO-EAT] Attempting to eat ${chosenFood.name} (+${getFoodValue(chosenFood.name)} food)`);
      await bot.equip(chosenFood, 'hand');
      await bot.consume();
      console.log(`[AUTO-EAT] Successfully ate ${chosenFood.name}`);
      // Don't spam chat with eating messages
    } catch (e) {
      // Only log real errors, not "food is full" or "cancelled" messages
      if (!e.message.includes('Food is full') && !e.message.includes('cancelled')) {
        console.log('[AUTO-EAT] Failed to eat:', e.message);
      }
    } finally {
      state.isEating = false;
    }
  }
  
  // Equip best weapon for combat
  async function equipBestWeapon() {
    const inventory = bot.inventory.items();
    
    // Weapon priority: sword > axe > pickaxe > shovel > nothing
    const weaponPriority = [
      // Swords (best)
      { names: ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword'], type: 'sword' },
      // Axes (good damage)
      { names: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'], type: 'axe' },
      // Pickaxes (better than nothing)
      { names: ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'], type: 'pickaxe' }
    ];
    
    for (const weaponGroup of weaponPriority) {
      for (const weaponName of weaponGroup.names) {
        const weapon = inventory.find(item => item.name === weaponName);
        if (weapon) {
          try {
            await bot.equip(weapon, 'hand');
            state.hasEquippedWeapon = true;
            return true;
          } catch (e) {
            console.error('Failed to equip weapon:', e.message);
          }
        }
      }
    }
    
    state.hasEquippedWeapon = false;
    return false;
  }
  
  // Check if bot is in a dangerous position (near lava, cliff, etc.)
  function isInDanger() {
    const pos = bot.entity.position;
    
    // Check blocks around for lava
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const block = bot.blockAt(pos.offset(x, y, z));
          if (block && (block.name === 'lava' || block.name === 'flowing_lava')) {
            return true;
          }
        }
      }
    }
    
    // Check if standing over a cliff (no blocks below within 3 blocks)
    let hasGroundNearby = false;
    for (let y = -1; y >= -3; y--) {
      const blockBelow = bot.blockAt(pos.offset(0, y, 0));
      if (blockBelow && blockBelow.name !== 'air') {
        hasGroundNearby = true;
        break;
      }
    }
    
    return !hasGroundNearby;
  }
  
  // Find safer position to flee to
  function findSafeFleePosition() {
    const pos = bot.entity.position;
    const candidates = [];
    
    // Check 8 directions
    const directions = [
      { x: 16, z: 0 },   // East
      { x: -16, z: 0 },  // West
      { x: 0, z: 16 },   // South
      { x: 0, z: -16 },  // North
      { x: 12, z: 12 },  // Southeast
      { x: 12, z: -12 }, // Northeast
      { x: -12, z: 12 }, // Southwest
      { x: -12, z: -12 } // Northwest
    ];
    
    for (const dir of directions) {
      const testPos = pos.offset(dir.x, 0, dir.z);
      const block = bot.blockAt(testPos);
      
      // Check if it's safe (not lava, has ground)
      if (block) {
        let isSafe = true;
        
        // Check for lava nearby
        for (let x = -2; x <= 2; x++) {
          for (let z = -2; z <= 2; z++) {
            const checkBlock = bot.blockAt(testPos.offset(x, 0, z));
            if (checkBlock && (checkBlock.name === 'lava' || checkBlock.name === 'flowing_lava')) {
              isSafe = false;
              break;
            }
          }
          if (!isSafe) break;
        }
        
        if (isSafe) {
          candidates.push(testPos);
        }
      }
    }
    
    // Return random safe position, or fallback to random if none found
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    
    // Fallback to random direction
    return pos.offset((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16);
  }
  
  function isHostileEntity(e) {
    // Check if entity type is 'hostile' or 'mob' (same as self-defense logic)
    if (!e || (e.type !== 'mob' && e.type !== 'hostile')) return false;
    const name = (e.name || e.displayName || '').toLowerCase();
    // Common hostile mob names
    return [
      'zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray',
      'pillager','ravager','vindicator','evoker','phantom','slime','magma_cube',
      'wither_skeleton','blaze','ghast','hoglin','piglin_brute','zoglin',
      'cave_spider','silverfish','vex','guardian','elder_guardian','shulker'
    ].includes(name);
  }
  
  function startSurvivalLoop() {
    if (state.survivalInterval) {
      console.log('[SURVIVAL] Loop already running');
      return;
    }
    
    console.log('[SURVIVAL] Starting survival loop...');
    state.survivalInterval = setInterval(async () => {
      if (!state.survivalEnabled) {
        console.log('[SURVIVAL] Loop running but survival disabled');
        return;
      }
      
      const health = bot.health;
      const position = bot.entity.position;

      // Note: Auto-eat runs in its own loop now, not here

      // Check if in immediate danger (lava, cliff) - flee immediately
      if (isInDanger()) {
        try { bot.pvp.stop(); } catch (_) {}
        try { bot.collectBlock.cancelTask(); } catch (_) {}
        const safePos = findSafeFleePosition();
        bot.pathfinder.setMovements(defaultMovements);
        bot.pathfinder.setGoal(new goals.GoalNear(safePos.x, safePos.y, safePos.z, 2));
        bot.chat('Danger detected! Fleeing to safety!');
        return;
      }

      // Find all nearby hostiles FIRST
      const allEntities = Object.values(bot.entities);
      const hostiles = allEntities
        .filter(isHostileEntity)
        .filter(e => position.distanceTo(e.position) <= state.combatRange)
        // NEVER attack whitelisted players
        .filter(e => {
          if (e.type === 'player') {
            const username = e.username || '';
            return !isWhitelisted(username);
          }
          return true; // Mobs are always valid targets
        });
      
      console.log(`[SURVIVAL] Checking for threats - Total entities: ${allEntities.length}, Hostiles in range: ${hostiles.length}, Health: ${health}/20`);
      
      // If critically low health (2 hearts or less) AND no hostiles very close, flee
      if (health <= 4 && hostiles.length === 0) {
        try { bot.pvp.stop(); } catch (_) {}
        try { bot.collectBlock.cancelTask(); } catch (_) {}
        const safePos = findSafeFleePosition();
        bot.pathfinder.setMovements(defaultMovements);
        bot.pathfinder.setGoal(new goals.GoalNear(safePos.x, safePos.y, safePos.z, 2));
        bot.chat('Critical health! Retreating!');
        return;
      }
      
      // If low health but hostiles are nearby, FIGHT BACK instead of fleeing
      // This prevents the bot from running away when being attacked
      if (hostiles.length === 0) return;
      
      hostiles.sort((a, b) => position.distanceTo(a.position) - position.distanceTo(b.position));
      const target = hostiles[0];
      if (!target) return;
      
      // Double-check: Never attack whitelisted players
      if (target.type === 'player' && isWhitelisted(target.username || '')) {
        console.log('[SURVIVAL] Target is whitelisted, skipping attack');
        return;
      }
      
      const distance = Math.round(position.distanceTo(target.position));
      console.log(`[SURVIVAL] Engaging ${target.name} at ${distance} blocks`);

      // Equip weapon before combat if not already equipped
      if (!state.hasEquippedWeapon) {
        await equipBestWeapon();
      }

      try { bot.collectBlock.cancelTask(); } catch (_) {}
      bot.pvp.attack(target);
    }, 2000); // Check every 2 seconds instead of 1 to reduce spam
    
    console.log('[SURVIVAL] Loop started successfully');
  }
  
  function stopSurvivalLoop() {
    if (state.survivalInterval) clearInterval(state.survivalInterval);
    state.survivalInterval = null;
  }
  
  function startAutoEatLoop() {
    if (state.autoEatInterval) {
      console.log('[AUTO-EAT] Loop already running');
      return;
    }
    
    console.log('[AUTO-EAT] Starting auto-eat loop...');
    state.autoEatInterval = setInterval(async () => {
      await autoEat();
    }, 3000); // Check every 3 seconds
    
    console.log('[AUTO-EAT] Loop started successfully');
  }
  
  function stopAutoEatLoop() {
    if (state.autoEatInterval) {
      clearInterval(state.autoEatInterval);
      state.autoEatInterval = null;
      console.log('[AUTO-EAT] Loop stopped');
    }
  }
  
  function startGuardLoop() {
    if (state.guardState.interval) return;
    state.guardState.interval = setInterval(async () => {
      if (!state.guardState.active || !state.guardState.pos) return;

      // Stay near guard position if drifted
      const dist = bot.entity.position.distanceTo(state.guardState.pos);
      if (dist > 2) {
        bot.pathfinder.setMovements(defaultMovements);
        bot.pathfinder.setGoal(new goals.GoalNear(state.guardState.pos.x, state.guardState.pos.y, state.guardState.pos.z, 1));
      }

      // Attack nearest hostile within radius (but NEVER whitelisted players)
      const hostiles = Object.values(bot.entities)
        .filter(e => isHostileEntity(e))
        .filter(e => {
          // NEVER attack whitelisted players
          if (e.type === 'player') {
            const username = e.username || '';
            return !isWhitelisted(username);
          }
          return true; // Mobs are always valid targets
        });
      hostiles.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      const target = hostiles.find(h => h.position.distanceTo(state.guardState.pos) <= state.guardState.radius);
      if (target) {
        // Double-check: Never attack whitelisted players
        if (target.type === 'player' && isWhitelisted(target.username || '')) {
          return; // Skip whitelisted players
        }
        // Equip weapon before combat if not already equipped
        if (!state.hasEquippedWeapon) {
          await equipBestWeapon();
        }
        try { bot.collectBlock.cancelTask(); } catch (_) {}
        bot.pvp.attack(target);
      }
    }, 800);
  }
  
  function stopGuardLoop() {
    state.guardState.active = false;
    state.guardState.pos = null;
    state.guardState.radius = 10;
    if (state.guardState.interval) clearInterval(state.guardState.interval);
    state.guardState.interval = null;
  }
  
};


