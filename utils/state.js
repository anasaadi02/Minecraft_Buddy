// State management for persistence
const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, '..', 'state.json');

let state = {
  waypoints: {
    home: null, // { x, y, z, dimension }
    marks: {}   // name -> { x, y, z, dimension }
  },
  whitelist: {
    enabled: false,  // If false, bot responds to everyone
    players: []      // Array of player names (case-insensitive)
  }
};

function loadState() {
  try {
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed) {
        // Merge with default state structure to handle missing fields
        state = {
          waypoints: parsed.waypoints || state.waypoints,
          whitelist: parsed.whitelist || state.whitelist
        };
      }
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

function getState() {
  return state;
}

module.exports = {
  loadState,
  saveState,
  getState
};

