// Combat commands: fight, kill

module.exports = function(bot, mcData, defaultMovements, goals) {
  
  return {
    'fight': async (username, message) => {
      const targetName = message === 'fight' ? null : message.split(' ').slice(1).join(' ');
      await handleFight(targetName);
    },
    
    'kill': async (username, message) => {
      const mobName = message.split(' ').slice(1).join(' ').trim();
      if (!mobName) { bot.chat('Specify a mob to kill.'); return; }
      await handleKill(mobName);
    }
  };
  
  // Find and equip the best weapon available
  async function equipBestWeapon() {
    const inventory = bot.inventory.items();
    
    // Weapon priority: sword > axe > trident > bow (if has arrows) > other melee
    // Material priority within each type: netherite > diamond > iron > stone > golden > wooden
    const weaponTypes = {
      sword: ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword'],
      axe: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'],
      trident: ['trident'],
      bow: ['bow', 'crossbow'],
      other: ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'golden_shovel', 'wooden_shovel']
    };
    
    // Check for arrows (needed for bow)
    const hasArrows = inventory.some(item => 
      item.name === 'arrow' || item.name === 'spectral_arrow' || item.name === 'tipped_arrow'
    );
    
    // Find best weapon by priority
    let bestWeapon = null;
    let weaponType = null;
    
    // 1. Try swords (best melee) - prioritize better materials
    for (const swordName of weaponTypes.sword) {
      const sword = inventory.find(item => item.name === swordName);
      if (sword) {
        bestWeapon = sword;
        weaponType = 'sword';
        break;
      }
    }
    
    // 2. Try axes (good melee) - prioritize better materials
    if (!bestWeapon) {
      for (const axeName of weaponTypes.axe) {
        const axe = inventory.find(item => item.name === axeName);
        if (axe) {
          bestWeapon = axe;
          weaponType = 'axe';
          break;
        }
      }
    }
    
    // 3. Try trident
    if (!bestWeapon) {
      for (const tridentName of weaponTypes.trident) {
        const trident = inventory.find(item => item.name === tridentName);
        if (trident) {
          bestWeapon = trident;
          weaponType = 'trident';
          break;
        }
      }
    }
    
    // 4. Try bow (only if has arrows)
    if (!bestWeapon && hasArrows) {
      for (const bowName of weaponTypes.bow) {
        const bow = inventory.find(item => item.name === bowName);
        if (bow) {
          bestWeapon = bow;
          weaponType = 'bow';
          break;
        }
      }
    }
    
    // 5. Try other melee weapons as last resort
    if (!bestWeapon) {
      for (const otherName of weaponTypes.other) {
        const other = inventory.find(item => item.name === otherName);
        if (other) {
          bestWeapon = other;
          weaponType = 'other';
          break;
        }
      }
    }
    
    // Equip the weapon if found
    if (bestWeapon) {
      try {
        await bot.equip(bestWeapon, 'hand');
        bot.chat(`Equipped ${bestWeapon.name}${weaponType === 'bow' ? ' (with arrows)' : ''}.`);
        return true;
      } catch (e) {
        console.error('Failed to equip weapon:', e.message);
        return false;
      }
    } else {
      bot.chat('No weapon found in inventory. Fighting with bare hands!');
      return false;
    }
  }
  
  async function handleFight(targetName) {
    let targetEntity = null;

    if (targetName) {
      const player = Object.values(bot.players).find(p => p.username.toLowerCase() === targetName.toLowerCase());
      if (player && player.entity) targetEntity = player.entity;
    } else {
      const hostiles = Object.values(bot.entities).filter(e => {
        // Check if entity type is 'hostile' or 'mob' (same as self-defense and survival logic)
        const isMob = e.type === 'mob' || e.type === 'hostile';
        if (!isMob) return false;
        const mobName = e.name || e.displayName || '';
        // Common hostile mob names
        return ['zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray',
                'pillager','vindicator','evoker','phantom','blaze','ghast','hoglin','piglin_brute',
                'wither_skeleton','cave_spider','silverfish','ravager','vex','guardian','elder_guardian',
                'shulker','zoglin'].includes(mobName);
      });
      hostiles.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      targetEntity = hostiles[0] || null;
    }

    if (!targetEntity) {
      bot.chat('No valid target to fight.');
      return;
    }

    // Equip best weapon before engaging
    try {
      await equipBestWeapon();
    } catch (e) {
      console.error('Error equipping weapon:', e);
      // Continue even if weapon equipping fails
    }

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}

    bot.chat('Engaging target.');
    bot.pvp.attack(targetEntity);
  }
  
  async function handleKill(mobName) {
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
    
    // Equip best weapon before engaging
    await equipBestWeapon();
    
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    bot.chat(`Engaging ${mobName}.`);
    bot.pvp.attack(target);
  }
};

