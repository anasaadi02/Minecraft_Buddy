// Load environment variables
require('dotenv').config();

// Debug: Check if env vars are loaded
console.log('[CONFIG] Environment variables loaded:');
console.log('  MINECRAFT_HOST:', process.env.MINECRAFT_HOST || 'NOT SET');
console.log('  MINECRAFT_PORT:', process.env.MINECRAFT_PORT || 'NOT SET');
console.log('  MINECRAFT_USERNAME:', process.env.MINECRAFT_USERNAME || 'NOT SET');
console.log('  MINECRAFT_VERSION:', process.env.MINECRAFT_VERSION || 'NOT SET');
console.log('  MINECRAFT_AUTH:', process.env.MINECRAFT_AUTH || 'NOT SET');

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const crafter = require('mineflayer-crafting-util').plugin;
const mcDataLoader = require('minecraft-data');

// Load utilities and command handler
const { loadState, saveState } = require('./utils/state');
const { loadWhitelist } = require('./utils/whitelist');
const commandHandler = require('./commands');
const initSelfDefense = require('./utils/selfDefense');

// Configuration from environment variables
const botConfig = {
  host: process.env.MINECRAFT_HOST || 'localhost',
  port: parseInt(process.env.MINECRAFT_PORT) || 25565,
  username: process.env.MINECRAFT_USERNAME || 'Bot',
  version: process.env.MINECRAFT_VERSION || '1.21.8',
  auth: process.env.MINECRAFT_AUTH || 'offline'
};

console.log('[CONFIG] Bot configuration:', botConfig);

const bot = mineflayer.createBot(botConfig);

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);
bot.loadPlugin(collectBlock);
bot.loadPlugin(crafter);

// Global state
let mcData;
let defaultMovements;

// Bot state for commands
const states = {
  survivalEnabled: false,
  survivalInterval: null,
  autoEatEnabled: true,
  guardState: { active: false, pos: null, radius: 10, interval: null },
  patrolState: { active: false, names: [], idx: 0, interval: null },
  roamState: { active: false, interval: null, lastMoveTime: 0, currentTarget: null },
  gatherWoodState: { active: false, interval: null },
  woodcutterState: { active: false, center: null, radius: null, interval: null }
};

// Make states accessible from bot object
bot.states = states;
bot.roamState = states.roamState;
bot.patrolState = states.patrolState;

// Add error handlers to prevent crashes from protocol mismatches
bot.on('error', (err) => {
  console.error('Bot error:', err.message);
});

bot._client.on('error', (err) => {
  console.error('Client error:', err.message);
});

// Suppress partial read errors (common with protocol version mismatches)
process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && reason.message.includes('PartialReadError')) {
    console.warn('Ignoring protocol parsing error (version mismatch)');
  } else {
    console.error('Unhandled rejection:', reason);
  }
});

bot.once('spawn', () => {
  console.log('Bot spawned successfully!');
  console.log(`Connected to server version ${bot.version}`);
  setTimeout(() => {
    try {
    } catch (e) {
      console.error('Failed to send chat:', e.message);
    }
  }, 1000);

  try {
  mcData = mcDataLoader(bot.version);
  defaultMovements = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMovements);
  loadState();
  loadWhitelist();
    
    // Initialize command handler
    const { handleCommand } = commandHandler(bot, mcData, defaultMovements, goals, states);
    
    // Initialize self-defense system
    const selfDefense = initSelfDefense(bot);
    bot.selfDefense = selfDefense;
    console.log('Self-defense system enabled.');
    
    // Initialize water floating system
    initWaterFloating(bot, mcData);
    console.log('Water floating system enabled.');
    
    // Set up chat listener
    bot.on('chat', async (username, message) => {
  if (username === bot.username) return;
      await handleCommand(username, message);
    });
    
      } catch (e) {
    console.error('Error during spawn setup:', e.message);
  }
});

bot.on('kicked', (reason) => {
  console.log('Bot was kicked:', reason);
});

bot.on('end', (reason) => {
  console.log('Bot disconnected:', reason);
});

bot.on('login', () => {
  console.log('Bot logged in successfully!');
});

bot.on('death', () => {
  console.log('Bot died!');
});

// Water floating system - keeps bot afloat when in water and idle
function initWaterFloating(bot, mcData) {
  let lastJumpTime = 0;
  const jumpCooldown = 500; // Minimum time between jumps (ms)
  
  bot.on('physicsTick', () => {
    // Only float if bot is not actively doing something
    const hasActiveGoal = bot.pathfinder.goal !== null;
    const isCollecting = bot.collectBlock.task !== null;
    const isFighting = bot.pvp.target !== null;
    
    // Skip if bot is actively doing something
    if (hasActiveGoal || isCollecting || isFighting) {
      return;
    }
    
    // Check if bot is in water
    const botPos = bot.entity.position;
    const blockAtFeet = bot.blockAt(botPos);
    const blockAtBody = bot.blockAt(botPos.offset(0, 1, 0));
    
    const isInWater = (block) => {
      if (!block) return false;
      const name = block.name || '';
      return name === 'water' || name === 'flowing_water';
    };
    
    if (isInWater(blockAtFeet) || isInWater(blockAtBody)) {
      // Bot is in water, make it jump to float
      const now = Date.now();
      if (now - lastJumpTime > jumpCooldown) {
        bot.setControlState('jump', true);
        lastJumpTime = now;
        
        // Release jump after a short time (continuous jumping)
        setTimeout(() => {
          bot.setControlState('jump', false);
        }, 100);
      }
    } else {
      // Not in water, make sure jump is released
      bot.setControlState('jump', false);
    }
  });
}

