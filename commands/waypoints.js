// Waypoint commands: set home, go home, mark, go, list waypoints, delete waypoint, patrol

const { getState, saveState } = require('../utils/state');

module.exports = function(bot, mcData, defaultMovements, goals, patrolState) {
  
  return {
    'set home': () => {
      const state = getState();
      const p = bot.entity.position;
      state.waypoints.home = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: bot.game.dimension }; 
      saveState();
      bot.chat(`Home set at (${state.waypoints.home.x} ${state.waypoints.home.y} ${state.waypoints.home.z}).`);
    },
    
    'go home': () => {
      const state = getState();
      const home = state.waypoints.home;
      if (!home) { bot.chat('Home is not set. Use "set home" first.'); return; }
      bot.pathfinder.setMovements(defaultMovements);
      bot.pathfinder.setGoal(new goals.GoalNear(home.x, home.y, home.z, 1));
      bot.chat('Heading home.');
    },
    
    'mark': (username, message) => {
      const name = message.substring(5).trim().toLowerCase();
      if (!name) { bot.chat('Give a name: mark <name>'); return; }
      const state = getState();
      const p = bot.entity.position;
      state.waypoints.marks[name] = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: bot.game.dimension };
      saveState();
      bot.chat(`Marked '${name}' at (${state.waypoints.marks[name].x} ${state.waypoints.marks[name].y} ${state.waypoints.marks[name].z}).`);
    },
    
    'go': (username, message) => {
      const name = message.substring(3).trim().toLowerCase();
      if (!name) { bot.chat('Give a waypoint: go <name>'); return; }
      const state = getState();
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
    },
    
    'list waypoints': () => handleListWaypoints(),
    'waypoints': () => handleListWaypoints(),
    
    'delete waypoint': (username, message) => handleDeleteWaypoint(message.split(' ').slice(2).join(' ').trim().toLowerCase()),
    'del waypoint': (username, message) => handleDeleteWaypoint(message.split(' ').slice(2).join(' ').trim().toLowerCase()),
    'unmark': (username, message) => handleDeleteWaypoint(message.substring('unmark '.length).trim().toLowerCase()),
    
    'patrol': (username, message) => {
      const names = message.substring('patrol '.length).trim().split(/\s+/).map(s => s.toLowerCase()).filter(Boolean);
      if (names.length < 2) { bot.chat('Provide at least two waypoints: patrol <wp1> <wp2>'); return; }
      handlePatrol(names);
    },
    
    'stop patrol': () => {
      stopPatrol();
      bot.chat('Stopped patrol.');
    }
  };
  
  function handleListWaypoints() {
    const state = getState();
    const names = Object.keys(state.waypoints.marks);
    const homeStr = state.waypoints.home ? `home@(${state.waypoints.home.x},${state.waypoints.home.y},${state.waypoints.home.z})` : 'home@unset';
    if (names.length === 0) {
      bot.chat(`${homeStr}; no marks.`);
    } else {
      bot.chat(`${homeStr}; marks: ${names.join(', ')}`);
    }
  }
  
  function handleDeleteWaypoint(key) {
    if (!key) { bot.chat('Specify a name to delete.'); return; }
    const state = getState();
    if (!state.waypoints.marks[key]) { bot.chat(`No waypoint named '${key}'.`); return; }
    delete state.waypoints.marks[key];
    saveState();
    bot.chat(`Deleted waypoint '${key}'.`);
  }
  
  function handlePatrol(names) {
    const state = getState();
    // Validate
    const points = names.map(n => n === 'home' ? state.waypoints.home : state.waypoints.marks[n]);
    if (points.some(p => !p)) { bot.chat('One or more waypoints are unknown.'); return; }
    patrolState.active = true;
    patrolState.names = names;
    patrolState.idx = 0;
    startPatrol();
    bot.chat(`Patrolling: ${names.join(' -> ')}`);
  }
  
  function startPatrol() {
    if (patrolState.interval) return;
    patrolState.interval = setInterval(() => {
      if (!patrolState.active || patrolState.names.length < 2) return;
      const state = getState();
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
};

