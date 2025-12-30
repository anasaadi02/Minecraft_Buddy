// Self-defense system: automatically fight back when attacked

module.exports = function(bot) {
  let isDefending = false;
  let currentAttacker = null;
  let previousTask = null;
  
  // Track what task the bot was doing before being attacked
  function saveCurrentTask() {
    previousTask = {
      gatheringWood: bot.states?.gatherWoodState?.active || false,
      patrolling: bot.patrolState?.active || false,
      roaming: bot.roamState?.active || false,
    };
  }
  
  // Resume the task the bot was doing before combat
  function resumePreviousTask() {
    if (!previousTask) return;
    
    // Note: Tasks will continue automatically if their intervals are still running
    if (previousTask.gatheringWood) {
      console.log('[SELF-DEFENSE] Resuming wood gathering...');
    } else if (previousTask.patrolling) {
      console.log('[SELF-DEFENSE] Resuming patrol...');
    } else if (previousTask.roaming) {
      console.log('[SELF-DEFENSE] Resuming roaming...');
    }
    
    previousTask = null;
  }
  
  // Find and equip the best weapon
  async function equipBestWeapon() {
    const inventory = bot.inventory.items();
    
    const weaponTypes = {
      sword: ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword'],
      axe: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'],
      trident: ['trident'],
    };
    
    let bestWeapon = null;
    
    // Try swords first (best melee)
    for (const swordName of weaponTypes.sword) {
      const sword = inventory.find(item => item.name === swordName);
      if (sword) {
        bestWeapon = sword;
        break;
      }
    }
    
    // Try axes
    if (!bestWeapon) {
      for (const axeName of weaponTypes.axe) {
        const axe = inventory.find(item => item.name === axeName);
        if (axe) {
          bestWeapon = axe;
          break;
        }
      }
    }
    
    // Try trident
    if (!bestWeapon) {
      for (const tridentName of weaponTypes.trident) {
        const trident = inventory.find(item => item.name === tridentName);
        if (trident) {
          bestWeapon = trident;
          break;
        }
      }
    }
    
    // Equip the weapon if found
    if (bestWeapon) {
      try {
        await bot.equip(bestWeapon, 'hand');
        console.log(`[SELF-DEFENSE] Equipped ${bestWeapon.name}`);
        return true;
      } catch (e) {
        console.error('[SELF-DEFENSE] Failed to equip weapon:', e.message);
        return false;
      }
    }
    
    return false;
  }
  
  // Start defending against an attacker
  async function startDefense(attacker) {
    if (isDefending || !attacker) return;
    
    isDefending = true;
    currentAttacker = attacker;
    
    console.log(`[SELF-DEFENSE] Attacked by ${attacker.name || attacker.username || attacker.displayName || 'unknown'}!`);
    bot.chat('I\'m under attack! Fighting back!');
    
    // Save current task
    saveCurrentTask();
    
    // Equip best weapon
    await equipBestWeapon();
    
    // Attack the attacker
    try {
      bot.pvp.attack(attacker);
      console.log('[SELF-DEFENSE] Counter-attacking...');
    } catch (e) {
      console.error('[SELF-DEFENSE] Failed to attack:', e.message);
      isDefending = false;
      currentAttacker = null;
    }
  }
  
  // Stop defending (called when attacker is defeated or out of range)
  function stopDefense() {
    console.log('[SELF-DEFENSE] stopDefense called, isDefending:', isDefending);
    
    // Reset state FIRST before stopping actions
    isDefending = false;
    currentAttacker = null;
    
    // Stop attacking
    try {
      bot.pvp.stop();
    } catch (e) {
      // Ignore errors
    }
    
    // Resume previous task
    resumePreviousTask();
    
    console.log('[SELF-DEFENSE] Combat ended. Ready for next attack.');
  }
  
  // Listen for when the bot takes damage
  bot.on('entityHurt', (entity) => {
    // Only react if the bot itself was hurt
    if (entity !== bot.entity) return;
    
    // Don't react if already defending
    if (isDefending) return;
    
    // Find who/what attacked the bot
    const nearbyEntities = Object.values(bot.entities).filter(e => {
      if (!e || e === bot.entity) return false;
      const dist = bot.entity.position.distanceTo(e.position);
      return dist <= 16; // Within 16 blocks
    });
    
    // Debug: log nearby entities
    console.log('[SELF-DEFENSE] Nearby entities:', nearbyEntities.map(e => ({
      type: e.type,
      name: e.name,
      displayName: e.displayName,
      username: e.username,
      kind: e.kind,
      mobType: e.mobType,
      hasTarget: !!e.target,
      targetIsBot: e.target?.id === bot.entity.id,
      distance: Math.round(bot.entity.position.distanceTo(e.position))
    })));
    
    let attacker = null;
    
    // First priority: Check for entities that are actively targeting the bot
    const targetingBot = nearbyEntities.filter(e => {
      // Check if this entity has the bot as its target
      if (e.target && e.target.id === bot.entity.id) return true;
      // Also check for players who are very close (likely attacking)
      if (e.type === 'player') {
        const dist = bot.entity.position.distanceTo(e.position);
        if (dist <= 3) return true; // Very close player is likely attacking
      }
      return false;
    });
    
    if (targetingBot.length > 0) {
      // Prioritize players over mobs if both are targeting
      const targetingPlayers = targetingBot.filter(e => e.type === 'player');
      const targetToUse = targetingPlayers.length > 0 ? targetingPlayers : targetingBot;
      
      // Find closest entity that's targeting the bot
      targetToUse.sort((a, b) => 
        bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
      );
      attacker = targetToUse[0];
      console.log(`[SELF-DEFENSE] Detected attacker: ${attacker.name || attacker.username || attacker.displayName} (targeting bot)`);
    }
    
    // Second priority: Check for nearby hostile mobs (they're likely the attacker)
    if (!attacker) {
      const hostileMobs = nearbyEntities.filter(e => {
        // Check if entity type is 'hostile' or 'mob'
        if (e.type !== 'mob' && e.type !== 'hostile') return false;
        const name = e.name || '';
        // Common hostile mob names
        const hostileNames = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 
                             'witch', 'pillager', 'vindicator', 'evoker', 'phantom',
                             'blaze', 'ghast', 'hoglin', 'piglin_brute', 'wither_skeleton',
                             'drowned', 'husk', 'stray', 'cave_spider', 'silverfish', 'zoglin',
                             'ravager', 'vex', 'guardian', 'elder_guardian', 'shulker'];
        return hostileNames.includes(name);
      });
      
      if (hostileMobs.length > 0) {
        // Find closest hostile mob
        hostileMobs.sort((a, b) => 
          bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
        );
        attacker = hostileMobs[0];
        console.log(`[SELF-DEFENSE] Detected attacker: ${attacker.name || attacker.displayName} (closest hostile mob)`);
      }
    }
    
    // Third priority: Check for players who might be attacking (only if no mobs found)
    // This is the last resort to avoid targeting innocent nearby players
    if (!attacker) {
      const nearbyPlayers = nearbyEntities.filter(e => e.type === 'player');
      if (nearbyPlayers.length > 0) {
        // Only target a player if they're very close (within 4 blocks) - likely attacking
        const closePlayers = nearbyPlayers.filter(p => 
          bot.entity.position.distanceTo(p.position) <= 4
        );
        if (closePlayers.length > 0) {
          closePlayers.sort((a, b) => 
            bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
          );
          attacker = closePlayers[0];
          console.log(`[SELF-DEFENSE] Detected attacker: ${attacker.username} (close player)`);
        }
      }
    }
    
    // If we found an attacker, defend
    if (attacker) {
      startDefense(attacker);
    } else {
      console.log('[SELF-DEFENSE] Took damage but could not identify attacker (possibly environmental damage)');
    }
  });
  
  // Listen for when the target is killed or out of range
  bot.on('physicsTick', () => {
    if (!isDefending || !currentAttacker) return;
    
    // Check if attacker is still alive and nearby
    const attacker = bot.entities[currentAttacker.id];
    
    if (!attacker || attacker.isValid === false) {
      // Attacker is dead or despawned
      stopDefense();
      return;
    }
    
    const distance = bot.entity.position.distanceTo(attacker.position);
    if (distance > 32) {
      // Attacker is too far away
      console.log('[SELF-DEFENSE] Attacker out of range.');
      stopDefense();
      return;
    }
    
    // Check if attacker's health is 0 (dead)
    if (attacker.health !== undefined && attacker.health <= 0) {
      stopDefense();
      return;
    }
  });
  
  // Export control functions
  return {
    isDefending: () => isDefending,
    stopDefense: stopDefense,
  };
};

