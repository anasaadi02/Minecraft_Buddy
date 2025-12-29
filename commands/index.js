// Command handler - loads and manages all command modules

module.exports = function(bot, mcData, defaultMovements, goals, states) {
  const commands = {};
  
  // Load all command modules
  const movementCommands = require('./movement')(bot, mcData, defaultMovements, goals, states.roamState);
  const combatCommands = require('./combat')(bot, mcData, defaultMovements, goals);
  const gatheringCommands = require('./gathering')(bot, mcData, defaultMovements, goals);
  const inventoryCommands = require('./inventory')(bot, mcData, defaultMovements, goals);
  const waypointCommands = require('./waypoints')(bot, mcData, defaultMovements, goals, states.patrolState);
  const survivalModule = require('./survival')(bot, mcData, defaultMovements, goals, states.survivalEnabled, states.survivalInterval, states.autoEatEnabled, states.guardState);
  const utilityCommands = require('./utility')(bot, mcData, defaultMovements, goals);
  
  // Merge all commands into one object
  Object.assign(commands,
    movementCommands,
    combatCommands,
    gatheringCommands,
    inventoryCommands,
    waypointCommands,
    survivalModule,
    utilityCommands
  );
  
  // Command handler function
  async function handleCommand(username, message) {
    const msg = message.toLowerCase().trim();
    
    // Check if message starts with bot's name (case-insensitive)
    const botNameLower = bot.username.toLowerCase();
    if (!msg.startsWith(botNameLower + ' ') && msg !== botNameLower) {
      return; // Ignore messages that don't start with bot's name
    }
    
    // Extract command after bot's name
    const command = msg === botNameLower ? '' : msg.substring(botNameLower.length + 1).trim();
    
    // Check for exact matches first
    if (commands[command]) {
      try {
        await commands[command](username, command);
      } catch (err) {
        console.error('Command error:', err);
      }
      return true;
    }
    
    // Check for commands that start with a certain prefix
    for (const cmd in commands) {
      if (command.startsWith(cmd + ' ') || (command === cmd)) {
        try {
          await commands[cmd](username, command);
        } catch (err) {
          console.error('Command error:', err);
        }
        return true;
      }
    }
    
    return false; // Command not found
  }
  
  return {
    handleCommand,
    commands
  };
};

