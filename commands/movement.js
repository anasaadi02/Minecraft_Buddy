// Movement commands: follow, come, roam

module.exports = function(bot, mcData, defaultMovements, goals, roamState) {
  
  return {
    'follow me': (username) => {
      return handleFollow(username, username);
    },
    
    'follow': (username, message) => {
      const targetName = message.split(' ').slice(1).join(' ');
      return handleFollow(username, targetName);
    },
    
    'come': (username) => {
      return handleCome(username);
    },
    
    'come to me': (username) => {
      return handleCome(username);
    },
    
    'roam on': () => {
      startRoaming();
      bot.chat('Roaming mode enabled.');
    },
    
    'roam off': () => {
      stopRoaming();
      bot.chat('Roaming mode disabled.');
    }
  };
  
  function handleFollow(username, targetName) {
    const target = Object.values(bot.players).find(p => p.username.toLowerCase() === targetName.toLowerCase());
    if (!target || !target.entity) {
      bot.chat(`I can't see ${targetName}.`);
      return;
    }
    const goal = new goals.GoalFollow(target.entity, 2);
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(goal, true);
    bot.chat(`Following ${targetName}.`);
  }
  
  function handleCome(username) {
    const player = bot.players[username] && bot.players[username].entity ? bot.players[username].entity : null;
    if (!player) { bot.chat("I can't see you right now."); return; }
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 1));
    bot.chat('On my way.');
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
};

