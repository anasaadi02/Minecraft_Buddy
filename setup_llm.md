# MC Buddy LLM Setup Guide

## Prerequisites

1. **Install OLLAMA**: Download from https://ollama.ai/
2. **Install the lightweight model**:
   ```bash
   ollama pull llama3.2:3b
   ```

## Configuration

The bot is configured to use:
- **Model**: `llama3.2:3b` (3B parameters for low latency)
- **OLLAMA URL**: `http://localhost:11434`
- **Response timeout**: 3 seconds
- **Max tokens**: 50 (for quick responses)

## Features Added

### 🤖 **LLM-Powered Chat Processing**
- Natural language understanding
- Maps player messages to bot commands
- Maintains conversation context (last 5 messages)
- Sub-second response times

### 🧠 **Proactive AI Behaviors**
- **Auto-pickup**: Collects nearby items when inventory space available
- **Auto-eat**: Eats when hungry (health < 15)
- **Smart crafting**: Crafts torches when materials available
- **Chest management**: Deposits items when inventory full
- **Sleep management**: Sleeps at night automatically
- **Resource gathering**: Gathers wood when supplies low

### ⚡ **Performance Optimizations**
- Minimal context (only essential bot state)
- Short prompts for speed
- 3-second timeout for responsiveness
- Conversation history limited to 5 messages
- Proactive actions limited to every 10 seconds

## Usage

1. **Start OLLAMA**:
   ```bash
   ollama serve
   ```

2. **Run the bot**:
   ```bash
   node bot.js
   ```

3. **Chat naturally**:
   - "Hey buddy, can you come here?"
   - "I need some wood"
   - "Help me fight this zombie"
   - "What's your status?"

## Example Interactions

**Player**: "Hey buddy, can you come here?"
**Bot**: *Comes to player* "On my way."

**Player**: "I need some wood for building"
**Bot**: *Starts gathering wood* "Collected some wood."

**Player**: "What's your health like?"
**Bot**: *Shows status* "Status: Survival: OFF | Auto-eat: ON | Health: 20/20 | Food: 20 | Position: 100, 64, 200"

## Troubleshooting

### **OLLAMA API Error: timeout of 3000ms exceeded**
This means OLLAMA isn't running or the model isn't loaded. Follow these steps:

1. **Start OLLAMA**:
   ```bash
   ollama serve
   ```

2. **Download the model**:
   ```bash
   ollama pull llama3.2:3b
   ```

3. **Use the setup script** (Windows):
   ```bash
   start_ollama.bat
   ```

4. **Use the setup script** (Linux/Mac):
   ```bash
   ./start_ollama.sh
   ```

### **Other Issues**
- **Slow responses**: Ensure OLLAMA is running and model is loaded
- **No responses**: Check OLLAMA logs for errors
- **Wrong commands**: The LLM learns from context, try being more specific
- **Fallback mode**: If OLLAMA isn't available, the bot will use simple keyword matching

## Customization

To change the model, edit `LLM_MODEL` in `bot.js`:
```javascript
const LLM_MODEL = 'qwen2.5:3b'; // Alternative lightweight model
```

To adjust response time, modify the timeout:
```javascript
timeout: 5000 // 5 seconds instead of 3
```
