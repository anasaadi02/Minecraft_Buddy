// Admin commands: whitelist management

const { getWhitelist, setEnabled, addPlayer, removePlayer } = require('../utils/whitelist');

module.exports = function(bot, mcData, defaultMovements, goals) {
  
  return {
    'whitelist on': (username) => {
      setEnabled(true);
      
      // Auto-add the player who enabled it if not already in list
      addPlayer(username);
      
      const whitelist = getWhitelist();
      bot.chat(`Whitelist enabled. I will only respond to: ${whitelist.players.join(', ')}`);
    },
    
    'whitelist off': () => {
      setEnabled(false);
      bot.chat('Whitelist disabled. I will respond to everyone.');
    },
    
    'whitelist add': (username, message) => {
      const playerName = message.substring('whitelist add '.length).trim();
      if (!playerName) {
        bot.chat('Usage: whitelist add <player>');
        return;
      }
      
      const added = addPlayer(playerName);
      if (added) {
        bot.chat(`Added ${playerName} to whitelist.`);
      } else {
        bot.chat(`${playerName} is already whitelisted.`);
      }
    },
    
    'whitelist remove': (username, message) => {
      const playerName = message.substring('whitelist remove '.length).trim();
      if (!playerName) {
        bot.chat('Usage: whitelist remove <player>');
        return;
      }
      
      const removed = removePlayer(playerName);
      if (removed) {
        bot.chat(`Removed ${playerName} from whitelist.`);
      } else {
        bot.chat(`${playerName} is not in the whitelist.`);
      }
    },
    
    'whitelist list': () => {
      const whitelist = getWhitelist();
      if (whitelist.players.length === 0) {
        bot.chat('Whitelist is empty. Use "whitelist add <player>" to add players.');
      } else {
        bot.chat(`Whitelisted players: ${whitelist.players.join(', ')}`);
      }
    },
    
    'whitelist': () => {
      const whitelist = getWhitelist();
      const status = whitelist.enabled ? 'enabled' : 'disabled';
      bot.chat(`Whitelist is ${status}. Players: ${whitelist.players.length > 0 ? whitelist.players.join(', ') : 'none'}`);
    }
  };
};

