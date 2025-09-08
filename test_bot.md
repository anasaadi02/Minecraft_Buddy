# MC Buddy Test Guide

## Test the Fixed Bot

### **1. Start the Bot**
```bash
# Make sure OLLAMA is running first
ollama serve

# Then start the bot
node bot.js
```

### **2. Test Conversational Chat**
Try these messages in-game:

**Greetings (should get friendly responses):**
- "Hello"
- "Hi there"
- "Hey buddy"

**Specific Commands (should execute actions):**
- "Come here" → Bot comes to you
- "What's your status?" → Shows status
- "Gather some wood" → Starts gathering wood
- "Follow me" → Starts following you
- "Stop" → Stops current actions

### **3. What's Fixed**

**✅ Conversational Chat**
- Bot now responds to greetings with friendly messages
- No more automatic following on every message
- More intelligent command recognition

**✅ Less Aggressive Proactive Behavior**
- Proactive monitoring reduced from every 5s to every 15s
- Actions only every 30s instead of 10s
- Smarter wood gathering (only when really needed)
- More conservative AI decision making

**✅ Better Command Mapping**
- More specific command matching
- Greetings and casual chat don't trigger actions
- Fallback responses for unclear commands

### **4. Expected Behavior**

**When you say "Hello":**
- Bot responds: "Hello! How can I help you?" (or similar)

**When you say "Come here":**
- Bot responds: "On my way." and comes to you

**When you say "What's your status?":**
- Bot shows detailed status information

**Proactive actions:**
- Should be much less frequent
- Only when actually needed (low health, hungry, etc.)

### **5. Troubleshooting**

If the bot is still too aggressive:
1. Check that OLLAMA is running: `ollama list`
2. Restart the bot to reset the proactive monitoring
3. The bot should be much more conversational now

The bot should now feel more like a helpful companion rather than an overly eager assistant!
