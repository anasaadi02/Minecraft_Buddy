// Survival commands: survival on/off, guard, auto eat, eat, status, stop

module.exports = function(bot, mcData, defaultMovements, goals, survivalEnabled, survivalInterval, autoEatEnabled, guardState) {
  
  const state = {
    survivalEnabled,
    survivalInterval,
    autoEatEnabled,
    noFoodWarned: false,  // Track if we've already warned about no food
    hasEquippedWeapon: false,  // Track if we equipped a weapon for combat
    combatRange: 16  // Only engage hostiles within this range
  };
  
  return {
    'survival on': () => {
      state.survivalEnabled = true;
      startSurvivalLoop();
      bot.chat('Survival mode enabled.');
    },
    
    'survival off': () => {
      state.survivalEnabled = false;
      stopSurvivalLoop();
      bot.chat('Survival mode disabled.');
    },
    
    'auto eat on': () => {
      state.autoEatEnabled = true;
      bot.chat('Auto-eat enabled.');
    },
    
    'auto eat off': () => {
      state.autoEatEnabled = false;
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
      guardState.pos = me.clone();
      guardState.radius = radius;
      guardState.active = true;
      startGuardLoop();
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(guardState.pos.x, guardState.pos.y, guardState.pos.z, 1));
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
      bot.chat(`Guard: ${guardState.active ? `ON (r=${guardState.radius}m)` : 'OFF'}`);
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
    'cancel': () => handleStop()
  };
  
  function handleStop() {
    try { bot.pvp.stop(); } catch (_) {}
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    if (bot.stopPatrol) bot.stopPatrol();
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
    if (!state.autoEatEnabled) return;
    
    const food = bot.food || 20; // Default to 20 if not available
    const saturation = bot.foodSaturation || 0;
    
    // Eat if hunger is low or saturation is very low (increased threshold to 18)
    if (food < 18 || saturation < 3) {
      const foodItems = bot.inventory.items().filter(item => isFood(item.name));
      
      if (foodItems.length > 0) {
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
        
        if (food > 10) {
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
          await bot.equip(chosenFood, 'hand');
          await bot.consume();
          // Don't spam chat with eating messages
        } catch (e) {
          console.log('Failed to eat:', e.message);
        }
      } else {
        // Only warn about no food ONCE, not repeatedly
        if (!state.noFoodWarned) {
          bot.chat('Hungry but no food available!');
          state.noFoodWarned = true;
        }
      }
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
    if (!e || e.type !== 'mob') return false;
    const name = (e.name || e.displayName || '').toLowerCase();
    return [
      'zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray','pillager','ravager','vindicator','evoker','phantom','slime','magma_cube','wither_skeleton','blaze','ghast','hoglin','piglin_brute','zoglin'
    ].includes(name);
  }
  
  function startSurvivalLoop() {
    if (state.survivalInterval) return;
    state.survivalInterval = setInterval(async () => {
      if (!state.survivalEnabled) return;
      const health = bot.health;
      const position = bot.entity.position;

      // Auto-eat when hungry
      await autoEat();

      // Check if in immediate danger (lava, cliff)
      if (isInDanger()) {
        try { bot.pvp.stop(); } catch (_) {}
        try { bot.collectBlock.cancelTask(); } catch (_) {}
        const safePos = findSafeFleePosition();
        bot.pathfinder.setMovements(defaultMovements);
        bot.pathfinder.setGoal(new goals.GoalNear(safePos.x, safePos.y, safePos.z, 2));
        bot.chat('Danger detected! Fleeing to safety!');
        return;
      }

      // Flee when low health
      if (health <= 8) { // 4 hearts
        try { bot.pvp.stop(); } catch (_) {}
        try { bot.collectBlock.cancelTask(); } catch (_) {}
        const safePos = findSafeFleePosition();
        bot.pathfinder.setMovements(defaultMovements);
        bot.pathfinder.setGoal(new goals.GoalNear(safePos.x, safePos.y, safePos.z, 2));
        bot.chat('Low health! Retreating!');
        return;
      }

      // Engage nearest hostile ONLY within combat range
      const hostiles = Object.values(bot.entities)
        .filter(isHostileEntity)
        .filter(e => position.distanceTo(e.position) <= state.combatRange); // Only nearby hostiles
      
      if (hostiles.length === 0) return;
      
      hostiles.sort((a, b) => position.distanceTo(a.position) - position.distanceTo(b.position));
      const target = hostiles[0];
      if (!target) return;

      // Equip weapon before combat if not already equipped
      if (!state.hasEquippedWeapon) {
        await equipBestWeapon();
      }

      try { bot.collectBlock.cancelTask(); } catch (_) {}
      bot.pvp.attack(target);
    }, 1000);
  }
  
  function stopSurvivalLoop() {
    if (state.survivalInterval) clearInterval(state.survivalInterval);
    state.survivalInterval = null;
  }
  
  function startGuardLoop() {
    if (guardState.interval) return;
    guardState.interval = setInterval(async () => {
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
    guardState.active = false;
    guardState.pos = null;
    guardState.radius = 10;
    if (guardState.interval) clearInterval(guardState.interval);
    guardState.interval = null;
  }
  
};


