// State management for persistence
const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, '..', 'state.json');

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

function getState() {
  return state;
}

module.exports = {
  loadState,
  saveState,
  getState
};

