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

// Configuration for Aternos or other online servers
const bot = mineflayer.createBot({
  host: 'localhost', 
  port: 1111,
  username: 'Buddy',
  version: '1.21.8',
  //auth: 'offline'
});

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
  roamState: { active: false, interval: null, lastMoveTime: 0, currentTarget: null }
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
  bot.chat('Hello! I am alive.');
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

