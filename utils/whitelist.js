// Whitelist management - loads from whitelist.json
const fs = require('fs');
const path = require('path');

const whitelistPath = path.join(__dirname, '..', 'whitelist.json');
const examplePath = path.join(__dirname, '..', 'whitelist.example.json');

let whitelist = {
  enabled: true,
  players: []
};

function loadWhitelist() {
  try {
    // Check if whitelist.json exists
    if (fs.existsSync(whitelistPath)) {
      const raw = fs.readFileSync(whitelistPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed) {
        whitelist = {
          enabled: parsed.enabled !== undefined ? parsed.enabled : true,
          players: Array.isArray(parsed.players) ? parsed.players : []
        };
      }
    } else {
      // If whitelist.json doesn't exist, create it from example
      console.log('whitelist.json not found. Creating from whitelist.example.json...');
      
      if (fs.existsSync(examplePath)) {
        // Copy example to whitelist.json
        const exampleContent = fs.readFileSync(examplePath, 'utf8');
        fs.writeFileSync(whitelistPath, exampleContent);
        
        // Load the newly created file
        const parsed = JSON.parse(exampleContent);
        whitelist = {
          enabled: parsed.enabled !== undefined ? parsed.enabled : true,
          players: Array.isArray(parsed.players) ? parsed.players : []
        };
        
        console.log('Created whitelist.json. Please edit it with your Minecraft username!');
      } else {
        console.warn('whitelist.example.json not found. Using default whitelist (enabled, empty).');
        // Save default whitelist
        saveWhitelist();
      }
    }
    
    console.log(`Whitelist loaded: ${whitelist.enabled ? 'ENABLED' : 'DISABLED'}, ${whitelist.players.length} player(s)`);
  } catch (e) {
    console.error('Failed to load whitelist.json:', e.message);
    console.warn('Using default whitelist (enabled, empty).');
  }
}

function saveWhitelist() {
  try {
    fs.writeFileSync(whitelistPath, JSON.stringify(whitelist, null, 2));
  } catch (e) {
    console.error('Failed to save whitelist.json:', e.message);
  }
}

function getWhitelist() {
  return whitelist;
}

function isWhitelisted(username) {
  // If whitelist is disabled, everyone is allowed
  if (!whitelist.enabled) {
    return true;
  }
  
  // Check if username is in the whitelist (case-insensitive)
  const userLower = username.toLowerCase();
  return whitelist.players.some(p => p.toLowerCase() === userLower);
}

function setEnabled(enabled) {
  whitelist.enabled = enabled;
  saveWhitelist();
}

function addPlayer(playerName) {
  const playerLower = playerName.toLowerCase();
  
  // Check if already in whitelist
  if (whitelist.players.some(p => p.toLowerCase() === playerLower)) {
    return false; // Already exists
  }
  
  whitelist.players.push(playerName);
  saveWhitelist();
  return true;
}

function removePlayer(playerName) {
  const playerLower = playerName.toLowerCase();
  const index = whitelist.players.findIndex(p => p.toLowerCase() === playerLower);
  
  if (index === -1) {
    return false; // Not found
  }
  
  whitelist.players.splice(index, 1);
  saveWhitelist();
  return true;
}

module.exports = {
  loadWhitelist,
  saveWhitelist,
  getWhitelist,
  isWhitelisted,
  setEnabled,
  addPlayer,
  removePlayer
};

