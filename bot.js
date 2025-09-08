const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const crafter = require('mineflayer-crafting-util').plugin;
const { Vec3 } = require('vec3');
const mcDataLoader = require('minecraft-data');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const bot = mineflayer.createBot({
  host: 'localhost',     // server IP or hostname
  port: 62313,           // server port
  username: 'Buddy',     // for offline servers; use a unique name
  version: '1.21.1'  
});

// --- LLM Integration ---
const OLLAMA_BASE_URL = 'http://localhost:11434';
const LLM_MODEL = 'llama3.2:3b'; // Lightweight model for low latency
let conversationHistory = [];
const MAX_HISTORY = 5; // Keep only last 5 messages for minimal context

// OLLAMA API client
async function callOllama(prompt, stream = false) {
  try {
    // First check if OLLAMA is running
    await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 1000 });
    
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
      model: LLM_MODEL,
      prompt: prompt,
      stream: stream,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 50, // Keep responses short for speed
        stop: ['\n', 'Player:', 'Bot:']
      }
    }, {
      timeout: 5000 // Increased timeout to 5 seconds
    });
    
    return response.data.response.trim();
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('OLLAMA not running. Please start OLLAMA with: ollama serve');
    } else if (error.message.includes('timeout')) {
      console.log('OLLAMA timeout. Model may not be loaded. Try: ollama pull llama3.2:3b');
    } else {
      console.log('OLLAMA API Error:', error.message);
    }
    return 'ok'; // Fallback response
  }
}

// Create minimal context for LLM
function createMinimalContext(playerMessage, playerName) {
  const botState = {
    health: bot.health || 20,
    food: bot.food || 20,
    pos: bot.entity ? `${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}` : 'unknown',
    mode: getCurrentMode()
  };
  
  const lastResponse = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].response : 'none';
  
  // More conversational prompt
  const prompt = `You are MC Buddy, a helpful Minecraft bot. Be friendly and conversational.
Available commands: come, follow, fight, gather wood, give, guard, patrol, craft, sleep, eat, pickup, status, inventory
Only respond with a command if the player is asking for something specific. For greetings or casual chat, just say "ok".

Player: ${playerMessage}
Your last response: ${lastResponse}
Bot state: health:${botState.health} food:${botState.food} pos:${botState.pos} mode:${botState.mode}

Response:`;

  return prompt;
}

// Get current bot mode for context
function getCurrentMode() {
  if (patrolState.active) return 'patrol';
  if (guardState.active) return 'guard';
  if (roamState.active) return 'roam';
  if (survivalEnabled) return 'survival';
  return 'idle';
}

// Map LLM response to bot commands
function mapLLMResponseToCommand(response, playerName) {
  const resp = response.toLowerCase().trim();
  
  // Direct command mappings - be more specific
  const commandMap = {
    'come here': () => `come to me`,
    'come to me': () => `come to me`,
    'come': () => `come to me`,
    'follow me': () => `follow me`,
    'follow': () => `follow me`,
    'fight': () => `fight`,
    'gather wood': () => `gather wood`,
    'gather': () => `gather wood`,
    'wood': () => `gather wood`,
    'give me': () => `give me`,
    'give': () => `give me`,
    'guard here': () => `guard here`,
    'guard': () => `guard here`,
    'patrol': () => `patrol`,
    'craft': () => `craft`,
    'sleep': () => `sleep`,
    'eat now': () => `eat now`,
    'eat': () => `eat now`,
    'pickup': () => `pickup`,
    'status': () => `status`,
    'inventory': () => `inventory`,
    'inv': () => `inventory`,
    'ok': () => null, // No action needed
    'yes': () => null,
    'sure': () => null,
    'hello': () => null,
    'hi': () => null,
    'thanks': () => null,
    'thank you': () => null,
    'no': () => null,
    'stop': () => `stop`
  };
  
  // Check for exact matches first
  if (commandMap[resp]) {
    return commandMap[resp]();
  }
  
  // Check for partial matches - but be more careful
  for (const [key, action] of Object.entries(commandMap)) {
    if (resp.includes(key) && key.length > 2) { // Only match if key is longer than 2 chars
      return action();
    }
  }
  
  // Default fallback - don't assume follow
  return null;
}

// Process chat with LLM
async function processChatWithLLM(username, message) {
  try {
    const prompt = createMinimalContext(message, username);
    const llmResponse = await callOllama(prompt);
    
    // Store in conversation history
    conversationHistory.push({
      player: username,
      message: message,
      response: llmResponse,
      timestamp: Date.now()
    });
    
    // Keep only recent history
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }
    
    // Map response to command
    const command = mapLLMResponseToCommand(llmResponse, username);
    
    if (command) {
      console.log(`LLM Response: "${llmResponse}" -> Command: "${command}"`);
      return command;
    }
    
    return null;
  } catch (error) {
    console.error('LLM Processing Error:', error);
    return null;
  }
}

// Execute command directly without going through chat handler
async function executeCommand(command, username) {
  const msg = command.toLowerCase().trim();
  
  try {
    // follow me | follow <player>
    if (msg === 'come to me' || msg === 'come') {
      const player = bot.players[username] && bot.players[username].entity ? bot.players[username].entity : null;
      if (!player) { bot.chat("I can't see you right now."); return; }
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 1));
      bot.chat('On my way.');
      return;
    }
    
    // follow me | follow <player>
    if (msg === 'follow me' || msg.startsWith('follow ')) {
      const targetName = msg === 'follow me' ? username : msg.split(' ').slice(1).join(' ');
      const target = Object.values(bot.players).find(p => p.username.toLowerCase() === targetName.toLowerCase());
      if (!target || !target.entity) {
        bot.chat(`I can't see ${targetName}.`);
        return;
      }
      const goal = new goals.GoalFollow(target.entity, 2);
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(goal, true);
      bot.chat(`Following ${targetName}.`);
      return;
    }
    
    // status
    if (msg === 'status') {
      const status = [
        `Survival: ${survivalEnabled ? 'ON' : 'OFF'}`,
        `Auto-eat: ${autoEatEnabled ? 'ON' : 'OFF'}`,
        `Roaming: ${roamState.active ? 'ON' : 'OFF'}`,
        `Guard: ${guardState.active ? 'ON' : 'OFF'}`,
        `Patrol: ${patrolState.active ? 'ON' : 'OFF'}`,
        `Health: ${bot.health}/20`,
        `Food: ${bot.food || 'N/A'}`,
        `Position: ${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)}`
      ];
      bot.chat(`Status: ${status.join(' | ')}`);
      return;
    }
    
    // gather wood
    if (msg === 'gather wood' || msg === 'wood' || msg === 'collect wood') {
      if (!mcData) mcData = mcDataLoader(bot.version);
      const logIds = [
        'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'
      ].map(name => mcData.blocksByName[name] && mcData.blocksByName[name].id).filter(Boolean);

      const targetBlock = bot.findBlock({
        matching: (blk) => logIds.includes(blk.type),
        maxDistance: 64
      });

      if (!targetBlock) {
        bot.chat('I cannot find any logs nearby.');
        return;
      }

      try { bot.pathfinder.setGoal(null); } catch (_) {}
      try { bot.pvp.stop(); } catch (_) {}

      (async () => {
        try {
          await bot.collectBlock.collect(targetBlock);
          bot.chat('Collected some wood.');
        } catch (err) {
          console.error(err);
          bot.chat('Failed to collect wood.');
        }
      })();
      return;
    }
    
    // fight
    if (msg === 'fight') {
      const hostiles = Object.values(bot.entities).filter(e => {
        const isMob = e.type === 'mob';
        if (!isMob) return false;
        const mobName = e.name || e.displayName || '';
        return ['zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray','pillager'].includes(mobName);
      });
      hostiles.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      const targetEntity = hostiles[0] || null;

      if (!targetEntity) {
        bot.chat('No valid target to fight.');
        return;
      }

      try { bot.pathfinder.setGoal(null); } catch (_) {}
      try { bot.collectBlock.cancelTask(); } catch (_) {}

      bot.chat('Engaging target.');
      bot.pvp.attack(targetEntity);
      return;
    }
    
    // inventory
    if (msg === 'inventory' || msg === 'inv') {
      const items = bot.inventory.items();
      if (items.length === 0) { bot.chat('Inventory empty.'); return; }
      const counts = {};
      for (const it of items) {
        counts[it.name] = (counts[it.name] || 0) + it.count;
      }
      const summary = Object.entries(counts).map(([k,v]) => `${k}:${v}`).slice(0, 15).join(', ');
      bot.chat(summary.length ? summary : 'Inventory empty.');
      return;
    }
    
    // eat now
    if (msg === 'eat now' || msg === 'eat') {
      (async () => {
        await autoEat();
      })();
      return;
    }
    
    // pickup
    if (msg === 'pickup') {
      const drops = Object.values(bot.entities).filter(e => e.name === 'item');
      if (drops.length === 0) { bot.chat('No drops nearby.'); return; }
      drops.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      const targets = drops.filter(d => bot.entity.position.distanceTo(d.position) <= 12);
      if (targets.length === 0) { bot.chat('No drops within range.'); return; }
      (async () => {
        try {
          for (const d of targets) {
            await goNearPosition(d.position, 1.2, 8000);
            await sleep(250);
          }
          bot.chat('Picked up nearby drops.');
        } catch (e) {
          console.error(e);
          bot.chat('Failed to pick up drops.');
        }
      })();
      return;
    }
    
    // stop command
    if (msg === 'stop' || msg === 'halt' || msg === 'cancel') {
      try { bot.pvp.stop(); } catch (_) {}
      try { bot.pathfinder.setGoal(null); } catch (_) {}
      try { bot.collectBlock.cancelTask(); } catch (_) {}
      stopPatrol();
      bot.chat('Stopped current actions.');
      return;
    }
    
    // Default fallback
    bot.chat(`I understood: ${command}`);
    
  } catch (error) {
    console.error('Error executing command:', error);
    bot.chat('Sorry, I had trouble with that command.');
  }
}

// Load plugins
bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);
bot.loadPlugin(collectBlock);
bot.loadPlugin(crafter);

let mcData;
let defaultMovements;
let survivalEnabled = false;
let survivalInterval = null;
let autoEatEnabled = true;
let guardState = { active: false, pos: null, radius: 10, interval: null };
let patrolState = { active: false, names: [], idx: 0, interval: null };
let roamState = { active: false, interval: null, lastMoveTime: 0, currentTarget: null };
let actionQueue = [];
let isExecutingAction = false;

// --- Persistence ---
const statePath = path.join(__dirname, 'state.json');
let state = {
  waypoints: {
    home: null, // { x, y, z, dimension }
    marks: {}   // name -> { x, y, z, dimension }
  }
};

function loadState() {
  try {
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.waypoints) state = parsed;
    }
  } catch (e) {
    console.error('Failed to load state.json', e);
  }
}

function saveState() {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save state.json', e);
  }
}

bot.once('spawn', () => {
  console.log('Bot spawned.');
  bot.chat('Hello! I am alive and powered by AI!');

  mcData = mcDataLoader(bot.version);
  defaultMovements = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMovements);
  loadState();
  
  // Start proactive monitoring
  startProactiveMonitoring();
  console.log('LLM-powered proactive monitoring started.');
});

// Helper: resolve requested item term to one or more mcData item ids
function resolveItemIdsFromTerm(term) {
  if (!mcData) mcData = mcDataLoader(bot.version);
  const normalized = term.replace(/\s+/g, '_');

  // 1) Exact item match
  if (mcData.itemsByName[normalized]) {
    return [mcData.itemsByName[normalized].id];
  }

  // 2) Category/alias handling
  const lower = normalized.toLowerCase();
  const candidates = [];

  // wood => any logs or planks
  if (lower === 'wood' || lower === 'log' || lower === 'logs' || lower === 'planks' || lower === 'wood_planks') {
    for (const name in mcData.itemsByName) {
      if (/(_log|_planks)$/.test(name)) candidates.push(mcData.itemsByName[name].id);
    }
    return candidates;
  }

  // food => common edible items
  if (lower === 'food') {
    const foodNames = ['bread','cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','baked_potato','carrot','apple'];
    for (const n of foodNames) if (mcData.itemsByName[n]) candidates.push(mcData.itemsByName[n].id);
    return candidates;
  }

  // fallback: partial name contains
  for (const name in mcData.itemsByName) {
    if (name.includes(lower)) candidates.push(mcData.itemsByName[name].id);
  }
  return candidates;
}

bot.on('chat', async (username, message) => {
  if (username === bot.username) return;
  
  // Handle queue management commands first
  const msg = message.toLowerCase().trim();
  if (msg === 'queue' || msg === 'show queue') {
    bot.chat(getQueueStatus());
    return;
  }
  if (msg === 'clear queue' || msg === 'clear') {
    clearQueue();
    return;
  }
  if (msg === 'stop queue' || msg === 'pause queue') {
    isExecutingAction = false;
    bot.chat('Action queue paused.');
    return;
  }
  if (msg === 'resume queue' || msg === 'continue queue') {
    if (actionQueue.length > 0) {
      processActionQueue();
    } else {
      bot.chat('No actions in queue to resume.');
    }
    return;
  }
  
  // Process with LLM first (only if OLLAMA is available)
  if (ollamaAvailable) {
    const llmCommand = await processChatWithLLM(username, message);
    
    // If LLM provided a command, add it to queue
    if (llmCommand) {
      console.log(`LLM command queued: ${llmCommand}`);
      addToQueue(llmCommand, username);
      return;
    } else {
      // LLM didn't provide a command, give a friendly response
      const friendlyResponses = [
        "Hello! How can I help you?",
        "Hi there! What would you like me to do?",
        "Hey! I'm here to help. What do you need?",
        "Greetings! I'm ready to assist you.",
        "Hi! I can help with gathering, fighting, following, and more!"
      ];
      const randomResponse = friendlyResponses[Math.floor(Math.random() * friendlyResponses.length)];
      bot.chat(randomResponse);
      return;
    }
  } else {
    // Simple fallback for common phrases when OLLAMA is not available
    if (msg.includes('come') || msg.includes('here')) {
      addToQueue('come to me', username);
      return;
    } else if (msg.includes('follow')) {
      addToQueue('follow me', username);
      return;
    } else if (msg.includes('wood') || msg.includes('gather')) {
      addToQueue('gather wood', username);
      return;
    } else if (msg.includes('status') || msg.includes('health')) {
      addToQueue('status', username);
      return;
    }
  }
  
  // Fallback to original command processing for direct commands
  // Add direct commands to queue instead of executing immediately
  addToQueue(message, username);

  // All commands are now handled by the queue system


  // guard here [radius]
  if (msg.startsWith('guard here')) {
    const parts = msg.split(/\s+/);
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
    return;
  }

  // stop guard
  if (msg === 'stop guard' || msg === 'guard stop') {
    stopGuardLoop();
    bot.chat('Stopped guarding.');
    return;
  }

  // stop / cancel
  if (msg === 'stop' || msg === 'halt' || msg === 'cancel') {
    try { bot.pvp.stop(); } catch (_) {}
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    stopPatrol();
    bot.chat('Stopped current actions.');
    return;
  }

  // set home
  if (msg === 'set home') {
    const p = bot.entity.position;
    state.waypoints.home = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: bot.game.dimension }; 
    saveState();
    bot.chat(`Home set at (${state.waypoints.home.x} ${state.waypoints.home.y} ${state.waypoints.home.z}).`);
    return;
  }

  // go home
  if (msg === 'go home') {
    const home = state.waypoints.home;
    if (!home) { bot.chat('Home is not set. Use "set home" first.'); return; }
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(home.x, home.y, home.z, 1));
    bot.chat('Heading home.');
    return;
  }

  // mark <name>
  if (msg.startsWith('mark ')) {
    const name = msg.substring(5).trim().toLowerCase();
    if (!name) { bot.chat('Give a name: mark <name>'); return; }
    const p = bot.entity.position;
    state.waypoints.marks[name] = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: bot.game.dimension };
    saveState();
    bot.chat(`Marked '${name}' at (${state.waypoints.marks[name].x} ${state.waypoints.marks[name].y} ${state.waypoints.marks[name].z}).`);
    return;
  }

  // go <name>
  if (msg.startsWith('go ')) {
    const name = msg.substring(3).trim().toLowerCase();
    if (!name) { bot.chat('Give a waypoint: go <name>'); return; }
    if (name === 'home') {
      const home = state.waypoints.home;
      if (!home) { bot.chat('Home is not set.'); return; }
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(home.x, home.y, home.z, 1));
      bot.chat('Heading home.');
      return;
    }
    const wp = state.waypoints.marks[name];
    if (!wp) { bot.chat(`No waypoint named '${name}'.`); return; }
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(wp.x, wp.y, wp.z, 1));
    bot.chat(`Heading to '${name}'.`);
    return;
  }

  // list waypoints
  if (msg === 'list waypoints' || msg === 'waypoints') {
    const names = Object.keys(state.waypoints.marks);
    const homeStr = state.waypoints.home ? `home@(${state.waypoints.home.x},${state.waypoints.home.y},${state.waypoints.home.z})` : 'home@unset';
    if (names.length === 0) {
      bot.chat(`${homeStr}; no marks.`);
    } else {
      bot.chat(`${homeStr}; marks: ${names.join(', ')}`);
    }
    return;
  }

  // deposit [all|<item>|category] into nearest chest
  if (msg.startsWith('deposit')) {
    const term = msg.split(/\s+/).slice(1).join(' ').trim();
    const chestBlock = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
    if (!chestBlock) { bot.chat('No chest nearby.'); return; }
    (async () => {
      try {
        // Path near chest first
        await goNearPosition(chestBlock.position, 1.6, 12000);
        await sleep(200);
        const chest = await bot.openChest(chestBlock);
        const inv = bot.inventory.items();
        let targets = inv;
        if (term && term !== 'all') {
          const ids = resolveItemIdsFromTerm(term);
          if (!ids || ids.length === 0) { bot.chat(`Unknown term '${term}'.`); chest.close(); return; }
          targets = inv.filter(i => ids.includes(i.type));
        }
        for (const it of targets) {
          await chest.deposit(it.type, null, it.count);
        }
        chest.close();
        bot.chat(term ? `Deposited '${term}'.` : 'Deposited all.');
      } catch (e) {
        console.error(e);
        bot.chat('Deposit failed.');
      }
    })();
    return;
  }

  // withdraw <item|category> [count]
  if (msg.startsWith('withdraw ')) {
    const rest = msg.substring('withdraw '.length).trim();
    const parts = rest.split(/\s+/);
    let reqCount = null;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
    const term = parts.join(' ');
    const chestBlock = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
    if (!chestBlock) { bot.chat('No chest nearby.'); return; }
    const ids = resolveItemIdsFromTerm(term);
    if (!ids || ids.length === 0) { bot.chat(`Unknown term '${term}'.`); return; }
    (async () => {
      try {
        await goNearPosition(chestBlock.position, 1.6, 12000);
        await sleep(200);
        const chest = await bot.openChest(chestBlock);
        // Pull whichever id exists in chest first
        let remaining = reqCount || Infinity;
        for (const id of ids) {
          if (remaining <= 0) break;
          const chestItems = chest.containerItems().filter(i => i.type === id);
          const total = chestItems.reduce((a, i) => a + i.count, 0);
          if (total > 0) {
            const take = Math.min(total, remaining);
            await chest.withdraw(id, null, take);
            remaining -= take;
          }
        }
        chest.close();
        bot.chat(`Withdrew '${term}'${reqCount ? ` x${reqCount}` : ''}.`);
      } catch (e) {
        console.error(e);
        bot.chat('Withdraw failed.');
      }
    })();
    return;
  }

  // patrol <wp1> <wp2> [wp3 ...]
  if (msg.startsWith('patrol ')) {
    const names = msg.substring('patrol '.length).trim().split(/\s+/).map(s => s.toLowerCase()).filter(Boolean);
    if (names.length < 2) { bot.chat('Provide at least two waypoints: patrol <wp1> <wp2>'); return; }
    // Validate
    const points = names.map(n => n === 'home' ? state.waypoints.home : state.waypoints.marks[n]);
    if (points.some(p => !p)) { bot.chat('One or more waypoints are unknown.'); return; }
    patrolState.active = true;
    patrolState.names = names;
    patrolState.idx = 0;
    startPatrol();
    bot.chat(`Patrolling: ${names.join(' -> ')}`);
    return;
  }

  if (msg === 'stop patrol') {
    stopPatrol();
    bot.chat('Stopped patrol.');
    return;
  }

  // delete waypoint <name>
  if (msg.startsWith('delete waypoint ') || msg.startsWith('del waypoint ') || msg.startsWith('unmark ')) {
    const key = msg.startsWith('unmark ') ? msg.substring('unmark '.length).trim().toLowerCase() : msg.split(' ').slice(2).join(' ').trim().toLowerCase();
    if (!key) { bot.chat('Specify a name to delete.'); return; }
    if (!state.waypoints.marks[key]) { bot.chat(`No waypoint named '${key}'.`); return; }
    delete state.waypoints.marks[key];
    saveState();
    bot.chat(`Deleted waypoint '${key}'.`);
    return;
  }

  // fight | fight <player>
  if (msg === 'fight' || msg.startsWith('fight ')) {
    const targetName = msg === 'fight' ? null : msg.split(' ').slice(1).join(' ');
    let targetEntity = null;

    if (targetName) {
      const player = Object.values(bot.players).find(p => p.username.toLowerCase() === targetName.toLowerCase());
      if (player && player.entity) targetEntity = player.entity;
    } else {
      const hostiles = Object.values(bot.entities).filter(e => {
        const isMob = e.type === 'mob';
        if (!isMob) return false;
        const mobName = e.name || e.displayName || '';
        return ['zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray','pillager'].includes(mobName);
      });
      hostiles.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
      targetEntity = hostiles[0] || null;
    }

    if (!targetEntity) {
      bot.chat('No valid target to fight.');
      return;
    }

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}

    bot.chat('Engaging target.');
    bot.pvp.attack(targetEntity);
    return;
  }

  // gather wood
  if (msg === 'gather wood' || msg === 'wood' || msg === 'collect wood') {
    if (!mcData) mcData = mcDataLoader(bot.version);
    const logIds = [
      'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log'
    ].map(name => mcData.blocksByName[name] && mcData.blocksByName[name].id).filter(Boolean);

    const targetBlock = bot.findBlock({
      matching: (blk) => logIds.includes(blk.type),
      maxDistance: 64
    });

    if (!targetBlock) {
      bot.chat('I cannot find any logs nearby.');
      return;
    }

    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.pvp.stop(); } catch (_) {}

    (async () => {
      try {
        await bot.collectBlock.collect(targetBlock);
        bot.chat('Collected some wood.');
      } catch (err) {
        console.error(err);
        bot.chat('Failed to collect wood.');
      }
    })();
    return;
  }

  // gather <count> <block>
  if (msg.startsWith('gather ')) {
    const parts = msg.split(/\s+/);
    if (parts.length >= 3) {
      const countTarget = parseInt(parts[1], 10);
      const blockNameInput = parts.slice(2).join(' ');
      if (!Number.isNaN(countTarget) && countTarget > 0) {
        if (!mcData) mcData = mcDataLoader(bot.version);
        const normalized = blockNameInput.replace(/\s+/g, '_');
        const blockDef = mcData.blocksByName[normalized];
        if (!blockDef) {
          bot.chat(`I don't recognize the block '${blockNameInput}'.`);
          return;
        }

        const itemDef = mcData.itemsByName[normalized];
        const getInventoryCount = () => bot.inventory.items().filter(i => i.name === (itemDef ? itemDef.name : blockDef.name)).reduce((a, i) => a + i.count, 0);

        const have = getInventoryCount();
        if (have >= countTarget) {
          bot.chat(`I already have ${have} ${blockNameInput}.`);
          return;
        }

        try { bot.pathfinder.setGoal(null); } catch (_) {}
        try { bot.pvp.stop(); } catch (_) {}

        (async () => {
          try {
            while (getInventoryCount() < countTarget) {
              const positions = bot.findBlocks({ matching: blockDef.id, maxDistance: 96, count: 16 });
              if (!positions || positions.length === 0) {
                bot.chat(`Can't find more '${blockNameInput}' nearby.`);
                break;
              }
              const blocks = positions.map(pos => bot.blockAt(pos)).filter(Boolean);
              await bot.collectBlock.collect(blocks);
            }
            const finalCount = getInventoryCount();
            bot.chat(`I now have ${finalCount} ${blockNameInput}.`);
          } catch (err) {
            console.error(err);
            bot.chat(`Failed to gather '${blockNameInput}'.`);
          }
        })();
        return;
      }
    }
  }

  // kill <mob>
  if (msg.startsWith('kill ')) {
    const mobName = msg.split(' ').slice(1).join(' ').trim();
    if (!mobName) { bot.chat('Specify a mob to kill.'); return; }
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
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    try { bot.collectBlock.cancelTask(); } catch (_) {}
    bot.chat(`Engaging ${mobName}.`);
    bot.pvp.attack(target);
    return;
  }

  // give me <item> [count]
  if (msg.startsWith('give me ')) {
    const rest = msg.substring('give me '.length).trim();
    const parts = rest.split(/\s+/);
    let requestedCount = null;
    let itemName;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
      requestedCount = parseInt(parts.pop(), 10);
    }
    itemName = parts.join(' ');
    const itemIds = resolveItemIdsFromTerm(itemName);
    if (!itemIds || itemIds.length === 0) { bot.chat(`I don't recognize '${itemName}'.`); return; }

    // Find best available item among candidates (highest count)
    const inv = bot.inventory.items();
    let best = { id: null, total: 0 };
    for (const id of itemIds) {
      const count = inv.filter(i => i.type === id).reduce((a, i) => a + i.count, 0);
      if (count > best.total) best = { id, total: count };
    }

    if (!best.id || best.total <= 0) { bot.chat(`I don't have any '${itemName}'.`); return; }
    const toGive = requestedCount ? Math.min(requestedCount, best.total) : best.total;

    const player = bot.players[username] && bot.players[username].entity ? bot.players[username].entity : null;
    if (!player) { bot.chat("I can't see you right now."); return; }

    // Move near the player, then toss selected item
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 2));

    setTimeout(async () => {
      try {
        await bot.toss(best.id, null, toGive);
        bot.chat(`Gave you ${toGive} of your requested '${itemName}'.`);
      } catch (e) {
        console.error(e);
        bot.chat('Failed to toss items.');
      }
    }, 1500);
    return;
  }

  // come / come to me
  if (msg === 'come' || msg === 'come to me') {
    const player = bot.players[username] && bot.players[username].entity ? bot.players[username].entity : null;
    if (!player) { bot.chat("I can't see you right now."); return; }
    bot.pathfinder.setMovements(defaultMovements);
    bot.pathfinder.setGoal(new goals.GoalNear(player.position.x, player.position.y, player.position.z, 1));
    bot.chat('On my way.');
    return;
  }

  // pickup [radius]
  if (msg.startsWith('pickup')) {
    const parts = msg.split(/\s+/);
    const r = parseInt(parts[1], 10);
    const radius = (!Number.isNaN(r) && r > 1 && r <= 64) ? r : 12;
    const drops = Object.values(bot.entities).filter(e => e.name === 'item');
    if (drops.length === 0) { bot.chat('No drops nearby.'); return; }
    drops.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
    const targets = drops.filter(d => bot.entity.position.distanceTo(d.position) <= radius);
    if (targets.length === 0) { bot.chat('No drops within range.'); return; }
    (async () => {
      try {
        for (const d of targets) {
          await goNearPosition(d.position, 1.2, 8000);
          await sleep(250);
        }
        bot.chat('Picked up nearby drops.');
      } catch (e) {
        console.error(e);
        bot.chat('Failed to pick up drops.');
      }
    })();
    return;
  }

  // inventory summary
  if (msg === 'inventory' || msg === 'inv') {
    const items = bot.inventory.items();
    if (items.length === 0) { bot.chat('Inventory empty.'); return; }
    const counts = {};
    for (const it of items) {
      counts[it.name] = (counts[it.name] || 0) + it.count;
    }
    const summary = Object.entries(counts).map(([k,v]) => `${k}:${v}`).slice(0, 15).join(', ');
    bot.chat(summary.length ? summary : 'Inventory empty.');
    return;
  }

  // toss all <item|category>
  if (msg.startsWith('toss all ')) {
    const term = msg.substring('toss all '.length).trim();
    const ids = resolveItemIdsFromTerm(term);
    if (!ids || ids.length === 0) { bot.chat(`Unknown term '${term}'.`); return; }
    const inv = bot.inventory.items();
    const types = new Set();
    for (const id of ids) for (const it of inv) if (it.type === id) types.add(id);
    if (types.size === 0) { bot.chat(`I don't have '${term}'.`); return; }
    (async () => {
      try {
        for (const id of types) {
          const count = inv.filter(i => i.type === id).reduce((a, i) => a + i.count, 0);
          if (count > 0) await bot.toss(id, null, count);
        }
        bot.chat(`Tossed all '${term}'.`);
      } catch (e) {
        console.error(e);
        bot.chat('Failed to toss.');
      }
    })();
    return;
  }

  // craft <item> [count]
  if (msg.startsWith('craft ')) {
    const rest = msg.substring('craft '.length).trim();
    const parts = rest.split(/\s+/);
    let reqCount = 1;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
    const itemName = parts.join(' ');
    if (!mcData) mcData = mcDataLoader(bot.version);
    const normalized = itemName.replace(/\s+/g, '_');
    const itemDef = mcData.itemsByName[normalized];
    if (!itemDef) { bot.chat(`Unknown item '${itemName}'.`); return; }
    (async () => {
      try {
        // Find or place crafting table
        let table = bot.findBlock({ matching: (b) => b && b.name === 'crafting_table', maxDistance: 8 });
        if (!table) {
          const tableItem = bot.inventory.findInventoryItem(mcData.itemsByName.crafting_table.id);
          if (!tableItem) { bot.chat('Need a crafting table and I don\'t have one.'); return; }
          
          // Try multiple positions around the bot
          const positions = [
            bot.entity.position.offset(1, 0, 0),
            bot.entity.position.offset(-1, 0, 0),
            bot.entity.position.offset(0, 0, 1),
            bot.entity.position.offset(0, 0, -1),
            bot.entity.position.offset(1, 1, 0),
            bot.entity.position.offset(-1, 1, 0),
            bot.entity.position.offset(0, 1, 1),
            bot.entity.position.offset(0, 1, -1)
          ];
          
          let placed = false;
          for (const pos of positions) {
            const targetBlock = bot.blockAt(pos);
            if (targetBlock && targetBlock.name === 'air') {
              try {
                await bot.placeBlock(tableItem, targetBlock, new Vec3(0, 1, 0));
                table = bot.blockAt(pos);
                placed = true;
                break;
              } catch (e) {
                // Try next position
                continue;
              }
            }
          }
          
          if (!placed) {
            bot.chat('No suitable place for crafting table nearby.');
            return;
          }
        }
        await goNearPosition(table.position, 1.6, 8000);
        await sleep(200);
        
        // Use the crafting util plugin
        const itemToCraft = { id: itemDef.id, count: reqCount };
        const plan = bot.planCraft(itemToCraft);
        
        if (!plan || plan.recipesToDo.length === 0) {
          bot.chat(`No recipe for '${itemName}'.`);
          return;
        }
        
        // Debug: Show what we're trying to craft and what we have
        bot.chat(`Trying to craft ${reqCount} ${itemName} (ID: ${itemDef.id})`);
        bot.chat(`Plan has ${plan.recipesToDo.length} recipes to execute`);
        
        // Show current inventory
        const items = bot.inventory.items();
        bot.chat(`Inventory: ${items.map(item => `${item.name}(${item.count})`).join(', ')}`);
        
        // Execute the crafting plan
        for (const info of plan.recipesToDo) {
          bot.chat(`Recipe structure: ${JSON.stringify(info, null, 2)}`);
          
          // Try different ways to access the recipe name
          let recipeName = 'Unknown';
          if (info.recipe && info.recipe.result && info.recipe.result.name) {
            recipeName = info.recipe.result.name;
          } else if (info.recipe && info.recipe.name) {
            recipeName = info.recipe.name;
          } else if (info.recipe && info.recipe.id) {
            recipeName = `Item ID: ${info.recipe.id}`;
          }
          
          bot.chat(`Executing recipe: ${recipeName} x${info.recipeApplications}`);
          try {
            await bot.craft(info.recipe, info.recipeApplications, table);
            bot.chat(`Successfully crafted ${recipeName}`);
          } catch (craftError) {
            bot.chat(`Crafting failed: ${craftError.message}`);
            // Show what ingredients are needed
            if (info.recipe && info.recipe.ingredients) {
              bot.chat(`Required ingredients: ${info.recipe.ingredients.map(ing => `${ing.name}(${ing.count})`).join(', ')}`);
            }
            throw craftError;
          }
        }
        
        bot.chat(`Crafted ${reqCount} ${itemName}.`);
      } catch (e) {
        console.error(e);
        bot.chat('Crafting failed.');
      }
    })();
    return;
  }

  // smelt <item> [count]
  if (msg.startsWith('smelt ')) {
    const rest = msg.substring('smelt '.length).trim();
    const parts = rest.split(/\s+/);
    let reqCount = 1;
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) reqCount = parseInt(parts.pop(), 10);
    const itemName = parts.join(' ');
    if (!mcData) mcData = mcDataLoader(bot.version);
    const normalized = itemName.replace(/\s+/g, '_');
    const itemDef = mcData.itemsByName[normalized];
    if (!itemDef) { bot.chat(`Unknown item '${itemName}'.`); return; }
    (async () => {
      try {
        // Find or place furnace
        let furnace = bot.findBlock({ matching: (b) => b && b.name === 'furnace', maxDistance: 8 });
        if (!furnace) {
          const furnaceItem = bot.inventory.findInventoryItem(mcData.itemsByName.furnace.id);
          if (!furnaceItem) { bot.chat('Need a furnace and I don\'t have one.'); return; }
          
          // Try multiple positions around the bot
          const positions = [
            bot.entity.position.offset(1, 0, 0),
            bot.entity.position.offset(-1, 0, 0),
            bot.entity.position.offset(0, 0, 1),
            bot.entity.position.offset(0, 0, -1),
            bot.entity.position.offset(1, 1, 0),
            bot.entity.position.offset(-1, 1, 0),
            bot.entity.position.offset(0, 1, 1),
            bot.entity.position.offset(0, 1, -1)
          ];
          
          let placed = false;
          for (const pos of positions) {
            const targetBlock = bot.blockAt(pos);
            if (targetBlock && targetBlock.name === 'air') {
              try {
                await bot.placeBlock(furnaceItem, targetBlock, new Vec3(0, 1, 0));
                furnace = bot.blockAt(pos);
                placed = true;
                break;
              } catch (e) {
                // Try next position
                continue;
              }
            }
          }
          
          if (!placed) {
            bot.chat('No suitable place for furnace nearby.');
            return;
          }
        }
        await goNearPosition(furnace.position, 1.6, 8000);
        await sleep(200);
        // Use rightClick to open the furnace
        await bot.activateBlock(furnace, new Vec3(0, 1, 0));
        await sleep(500);
        
        // Find the furnace window
        const furnaceWindow = bot.currentWindow || bot.window;
        if (!furnaceWindow) { 
          bot.chat('Could not open furnace window'); 
          return; 
        }
        
        const recipes = bot.recipesFor(itemDef.id, null, 1, furnaceWindow);
        if (!recipes || recipes.length === 0) { 
          bot.chat(`No smelting recipe for '${itemName}'.`); 
          furnaceWindow.close(); 
          return; 
        }
        const recipe = recipes[0];
        for (let i = 0; i < reqCount; i++) {
          await bot.craft(recipe, 1, furnaceWindow);
        }
        furnaceWindow.close();
        bot.chat(`Smelted ${reqCount} ${itemName}.`);
      } catch (e) {
        console.error(e);
        bot.chat('Smelting failed.');
      }
    })();
    return;
  }

  // check recipe
  if (msg.startsWith('check recipe ')) {
    const itemName = msg.substring('check recipe '.length).trim();
    if (!mcData) mcData = mcDataLoader(bot.version);
    const normalized = itemName.replace(/\s+/g, '_');
    const itemDef = mcData.itemsByName[normalized];
    if (!itemDef) { bot.chat(`Unknown item '${itemName}'.`); return; }
    
    const itemToCraft = { id: itemDef.id, count: 1 };
    const plan = bot.planCraft(itemToCraft);
    
    if (!plan || plan.recipesToDo.length === 0) {
      bot.chat(`No recipe found for '${itemName}'.`);
      return;
    }
    
    bot.chat(`Recipe for ${itemName}:`);
    for (const info of plan.recipesToDo) {
      bot.chat(`- Info structure: ${JSON.stringify(info, null, 2)}`);
      if (info.recipe && info.recipe.ingredients) {
        bot.chat(`  Ingredients: ${info.recipe.ingredients.map(ing => `${ing.name}(${ing.count})`).join(', ')}`);
      }
    }
    return;
  }

  // debug crafting
  if (msg === 'debug craft') {
    if (!mcData) mcData = mcDataLoader(bot.version);
    const stickDef = mcData.itemsByName.stick;
    if (!stickDef) { bot.chat('Stick not found in mcData'); return; }
    bot.chat(`Stick ID: ${stickDef.id}, Name: ${stickDef.name}`);
    
    const table = bot.findBlock({ matching: (b) => b && b.name === 'crafting_table', maxDistance: 8 });
    if (!table) { bot.chat('No crafting table nearby'); return; }
    
    (async () => {
      try {
        await goNearPosition(table.position, 1.6, 8000);
        await sleep(200);
        
        // Use the crafting util plugin
        const itemToCraft = { id: stickDef.id, count: 1 };
        const plan = bot.planCraft(itemToCraft);
        
        bot.chat(`Plan found: ${plan ? 'Yes' : 'No'}`);
        if (plan) {
          bot.chat(`Recipes to do: ${plan.recipesToDo.length}`);
          if (plan.recipesToDo.length > 0) {
            bot.chat(`First recipe: ${JSON.stringify(plan.recipesToDo[0])}`);
          }
        }
      } catch (e) {
        console.error(e);
        bot.chat('Debug failed: ' + e.message);
      }
    })();
    return;
  }

  // sleep
  if (msg === 'sleep') {
    const time = bot.time.timeOfDay;
    const isNight = time >= 13000 || time < 6000; // 13000-24000 is night, 0-6000 is dawn
    if (!isNight) { bot.chat('It\'s not night time.'); return; }
    (async () => {
      try {
        // Find or place bed
        let bed = bot.findBlock({ matching: (b) => b && b.name.includes('bed'), maxDistance: 16 });
        if (!bed) {
          const bedItem = bot.inventory.findInventoryItem(mcData.itemsByName.red_bed.id) || 
                         bot.inventory.findInventoryItem(mcData.itemsByName.white_bed.id);
          if (!bedItem) { bot.chat('Need a bed and I don\'t have one.'); return; }
          
          // Try multiple positions around the bot
          const positions = [
            bot.entity.position.offset(1, 0, 0),
            bot.entity.position.offset(-1, 0, 0),
            bot.entity.position.offset(0, 0, 1),
            bot.entity.position.offset(0, 0, -1),
            bot.entity.position.offset(1, 1, 0),
            bot.entity.position.offset(-1, 1, 0),
            bot.entity.position.offset(0, 1, 1),
            bot.entity.position.offset(0, 1, -1)
          ];
          
          let placed = false;
          for (const pos of positions) {
            const targetBlock = bot.blockAt(pos);
            if (targetBlock && targetBlock.name === 'air') {
              try {
                await bot.placeBlock(bedItem, targetBlock, new Vec3(0, 1, 0));
                bed = bot.blockAt(pos);
                placed = true;
                break;
              } catch (e) {
                // Try next position
                continue;
              }
            }
          }
          
          if (!placed) {
            bot.chat('No suitable place for bed nearby.');
            return;
          }
        }
        await goNearPosition(bed.position, 1.6, 8000);
        await sleep(200);
        await bot.sleep(bed);
        bot.chat('Slept until morning.');
      } catch (e) {
        console.error(e);
        bot.chat('Sleep failed.');
      }
    })();
    return;
  }

  bot.chat(`Hi ${username}, you said: ${message}`);
});

bot.on('kicked', console.log);
bot.on('error', console.error);

// --- Survival helpers ---
function isHostileEntity(e) {
  if (!e || e.type !== 'mob') return false;
  const name = (e.name || e.displayName || '').toLowerCase();
  return [
    'zombie','skeleton','spider','creeper','witch','enderman','drowned','husk','stray','pillager','ravager','vindicator','evoker','phantom','slime','magma_cube'
  ].includes(name);
}

async function autoEat() {
  if (!autoEatEnabled) return;
  
  const food = bot.food || 20; // Default to 20 if not available
  const saturation = bot.foodSaturation || 0;
  
  // Eat if hunger is low or saturation is very low
  if (food < 15 || saturation < 2) {
    const foodItems = bot.inventory.items().filter(item => {
      const itemData = mcData.itemsByName[item.name];
      return itemData && itemData.food && itemData.food > 0;
    });
    
    if (foodItems.length > 0) {
      // Sort by food value (higher is better)
      foodItems.sort((a, b) => {
        const aFood = mcData.itemsByName[a.name].food || 0;
        const bFood = mcData.itemsByName[b.name].food || 0;
        return bFood - aFood;
      });
      
      const bestFood = foodItems[0];
      try {
        await bot.consume();
        bot.chat(`Eating ${bestFood.name} (hunger: ${food}, saturation: ${saturation})`);
      } catch (e) {
        // Try to equip the food first
        try {
          await bot.equip(bestFood, 'hand');
          await bot.consume();
          bot.chat(`Eating ${bestFood.name} (hunger: ${food}, saturation: ${saturation})`);
        } catch (e2) {
          console.log('Failed to eat:', e2.message);
        }
      }
    } else {
      bot.chat('Hungry but no food available!');
    }
  }
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

function startSurvivalLoop() {
  if (survivalInterval) return;
  survivalInterval = setInterval(async () => {
    if (!survivalEnabled) return;
    const health = bot.health;
    const position = bot.entity.position;

    // Auto-eat when hungry
    await autoEat();
    
    // Also auto-eat when roaming
    if (roamState.active) {
      await autoEat();
    }

    // Flee when low health
    if (health <= 8) { // 4 hearts
      try { bot.pvp.stop(); } catch (_) {}
      try { bot.collectBlock.cancelTask(); } catch (_) {}
      const away = position.offset((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16);
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(away.x, away.y, away.z, 2));
      return;
    }

    // Engage nearest hostile within range
    const hostiles = Object.values(bot.entities).filter(isHostileEntity);
    if (hostiles.length === 0) return;
    hostiles.sort((a, b) => position.distanceTo(a.position) - position.distanceTo(b.position));
    const target = hostiles[0];
    if (!target) return;

    try { bot.collectBlock.cancelTask(); } catch (_) {}
    bot.pvp.attack(target);
  }, 1000);
}

function stopSurvivalLoop() {
  if (survivalInterval) clearInterval(survivalInterval);
  survivalInterval = null;
}

// --- Action Queue System ---
function addToQueue(command, username, priority = false) {
  const action = {
    command: command,
    username: username,
    timestamp: Date.now(),
    priority: priority
  };
  
  if (priority) {
    actionQueue.unshift(action); // Add to front for priority
    bot.chat(`Priority action queued: ${command}`);
  } else {
    actionQueue.push(action); // Add to back for normal queue
    bot.chat(`Action queued: ${command} (${actionQueue.length} in queue)`);
  }
  
  // Start processing if not already running
  if (!isExecutingAction) {
    processActionQueue();
  }
}

async function processActionQueue() {
  if (isExecutingAction || actionQueue.length === 0) return;
  
  isExecutingAction = true;
  
  while (actionQueue.length > 0) {
    const action = actionQueue.shift();
    const { command, username } = action;
    
    try {
      bot.chat(`Executing: ${command}`);
      await executeCommand(command, username);
      
      // Wait a bit between actions to avoid overwhelming the bot
      await sleep(1000);
    } catch (error) {
      console.error('Error executing queued action:', error);
      bot.chat(`Failed to execute: ${command}`);
    }
  }
  
  isExecutingAction = false;
  bot.chat('All queued actions completed.');
}

function clearQueue() {
  actionQueue = [];
  bot.chat('Action queue cleared.');
}

function getQueueStatus() {
  if (actionQueue.length === 0) {
    return 'No actions in queue.';
  }
  
  const queueList = actionQueue.map((action, index) => 
    `${index + 1}. ${action.command} (by ${action.username})`
  ).join('\n');
  
  return `Queue (${actionQueue.length} actions):\n${queueList}`;
}

// --- Proactive LLM Behaviors ---
let proactiveInterval = null;
let lastProactiveAction = 0;
const PROACTIVE_COOLDOWN = 30000; // 30 seconds between proactive actions
let ollamaAvailable = false;

function startProactiveMonitoring() {
  if (proactiveInterval) return;
  
  // Check if OLLAMA is available first
  checkOllamaAvailability();
  
  proactiveInterval = setInterval(async () => {
    const now = Date.now();
    if (now - lastProactiveAction < PROACTIVE_COOLDOWN) return;
    
    // Only run proactive monitoring if OLLAMA is available
    if (ollamaAvailable) {
      const proactiveAction = await checkProactiveOpportunities();
      if (proactiveAction) {
        lastProactiveAction = now;
        console.log(`Proactive action: ${proactiveAction}`);
      }
    }
  }, 15000); // Check every 15 seconds instead of 5
}

async function checkOllamaAvailability() {
  try {
    await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 2000 });
    ollamaAvailable = true;
    console.log('OLLAMA is available. LLM features enabled.');
  } catch (error) {
    ollamaAvailable = false;
    console.log('OLLAMA not available. Running in fallback mode.');
  }
}

function stopProactiveMonitoring() {
  if (proactiveInterval) clearInterval(proactiveInterval);
  proactiveInterval = null;
}

async function checkProactiveOpportunities() {
  try {
    const context = createProactiveContext();
    const prompt = `You are MC Buddy. Analyze the situation and suggest ONE proactive action.
Available: pickup, auto-eat, craft torches, deposit items, sleep, gather wood
Only suggest an action if it's really needed. Be conservative.
Respond with ONLY the action or "none".

Context: ${context}`;
    
    const response = await callOllama(prompt);
    const action = response.toLowerCase().trim();
    
    if (action === 'none' || action === 'ok' || action === 'no') return null;
    
    // Execute proactive action
    return await executeProactiveAction(action);
  } catch (error) {
    console.error('Proactive monitoring error:', error);
    return null;
  }
}

function createProactiveContext() {
  const health = bot.health || 20;
  const food = bot.food || 20;
  const time = bot.time ? bot.time.timeOfDay : 12000;
  const isNight = time >= 13000 || time < 6000;
  const pos = bot.entity ? `${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}` : 'unknown';
  
  // Check for nearby items
  const drops = Object.values(bot.entities).filter(e => e.name === 'item');
  const nearbyDrops = drops.filter(d => bot.entity.position.distanceTo(d.position) <= 8).length;
  
  // Check inventory space
  const invItems = bot.inventory.items();
  const invSpace = 36 - invItems.length; // Assuming 36 slot inventory
  
  // Check for chest nearby
  const chest = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
  
  return `health:${health} food:${food} night:${isNight} pos:${pos} drops:${nearbyDrops} invSpace:${invSpace} chest:${chest ? 'yes' : 'no'}`;
}

async function executeProactiveAction(action) {
  try {
    switch (action) {
      case 'pickup':
        if (Object.values(bot.entities).filter(e => e.name === 'item').length > 0) {
          await executeCommand('pickup', 'system');
          return 'Picking up nearby items';
        }
        break;
        
      case 'auto-eat':
        if (bot.food < 15) {
          await executeCommand('eat now', 'system');
          return 'Eating due to low hunger';
        }
        break;
        
      case 'craft torches':
        if (bot.inventory.findInventoryItem(mcData.itemsByName.coal?.id) && 
            bot.inventory.findInventoryItem(mcData.itemsByName.stick?.id)) {
          // For now, just gather wood instead of crafting
          await executeCommand('gather wood', 'system');
          return 'Gathering resources for crafting';
        }
        break;
        
      case 'deposit items':
        const chest = bot.findBlock({ matching: (b) => b && b.name === 'chest', maxDistance: 16 });
        if (chest && bot.inventory.items().length > 20) {
          // Use the original deposit logic
          (async () => {
            try {
              await goNearPosition(chest.position, 1.6, 12000);
              await sleep(200);
              const chestBlock = await bot.openChest(chest);
              const inv = bot.inventory.items();
              for (const it of inv) {
                await chestBlock.deposit(it.type, null, it.count);
              }
              chestBlock.close();
              bot.chat('Deposited all items.');
            } catch (e) {
              console.error(e);
              bot.chat('Deposit failed.');
            }
          })();
          return 'Depositing items to chest';
        }
        break;
        
      case 'sleep':
        const time = bot.time ? bot.time.timeOfDay : 12000;
        const isNight = time >= 13000 || time < 6000;
        if (isNight) {
          // Use the original sleep logic
          (async () => {
            try {
              let bed = bot.findBlock({ matching: (b) => b && b.name.includes('bed'), maxDistance: 16 });
              if (!bed) {
                const bedItem = bot.inventory.findInventoryItem(mcData.itemsByName.red_bed.id) || 
                               bot.inventory.findInventoryItem(mcData.itemsByName.white_bed.id);
                if (!bedItem) { bot.chat('Need a bed and I don\'t have one.'); return; }
                
                const positions = [
                  bot.entity.position.offset(1, 0, 0),
                  bot.entity.position.offset(-1, 0, 0),
                  bot.entity.position.offset(0, 0, 1),
                  bot.entity.position.offset(0, 0, -1)
                ];
                
                let placed = false;
                for (const pos of positions) {
                  const targetBlock = bot.blockAt(pos);
                  if (targetBlock && targetBlock.name === 'air') {
                    try {
                      await bot.placeBlock(bedItem, targetBlock, new Vec3(0, 1, 0));
                      bed = bot.blockAt(pos);
                      placed = true;
                      break;
                    } catch (e) {
                      continue;
                    }
                  }
                }
                
                if (!placed) {
                  bot.chat('No suitable place for bed nearby.');
                  return;
                }
              }
              await goNearPosition(bed.position, 1.6, 8000);
              await sleep(200);
              await bot.sleep(bed);
              bot.chat('Slept until morning.');
            } catch (e) {
              console.error(e);
              bot.chat('Sleep failed.');
            }
          })();
          return 'Sleeping for the night';
        }
        break;
        
      case 'gather wood':
        const woodCount = bot.inventory.items().filter(i => i.name.includes('log')).length;
        const totalItems = bot.inventory.items().length;
        // Only gather wood if we have very little wood AND inventory space
        if (woodCount < 3 && totalItems < 30) {
          await executeCommand('gather wood', 'system');
          return 'Gathering wood for supplies';
        }
        break;
    }
  } catch (error) {
    console.error('Error executing proactive action:', error);
  }
  
  return null;
}

// --- Guard helpers ---
function startGuardLoop() {
  if (guardState.interval) return;
  guardState.interval = setInterval(() => {
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

// --- Patrol helpers ---
function startPatrol() {
  if (patrolState.interval) return;
  patrolState.interval = setInterval(() => {
    if (!patrolState.active || patrolState.names.length < 2) return;
    const currentName = patrolState.names[patrolState.idx];
    const wp = currentName === 'home' ? state.waypoints.home : state.waypoints.marks[currentName];
    if (!wp) return;
    const dist = bot.entity.position.distanceTo({ x: wp.x, y: wp.y, z: wp.z });
    if (dist > 2) {
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(wp.x, wp.y, wp.z, 1));
    } else {
      patrolState.idx = (patrolState.idx + 1) % patrolState.names.length;
    }
  }, 800);
}

function stopPatrol() {
  patrolState.active = false;
  patrolState.names = [];
  patrolState.idx = 0;
  if (patrolState.interval) clearInterval(patrolState.interval);
  patrolState.interval = null;
}

// --- Navigation helpers ---
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function goNearPosition(targetPos, radius = 1.2, timeoutMs = 15000) {
  try { bot.pathfinder.setMovements(defaultMovements); } catch (_) {}
  const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, Math.max(1, Math.floor(radius)));
  bot.pathfinder.setGoal(goal);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = bot.entity.position.distanceTo(targetPos);
    if (d <= radius) return true;
    await sleep(150);
  }
  return false;
}