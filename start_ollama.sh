#!/bin/bash

echo "Starting OLLAMA for MC Buddy..."
echo

# Check if OLLAMA is already running
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "OLLAMA is already running!"
else
    echo "Starting OLLAMA server..."
    ollama serve &
    sleep 3
fi

# Check if model is available
if ollama list | grep -q "llama3.2:3b"; then
    echo "Model is available!"
else
    echo "Model not found. Downloading llama3.2:3b..."
    ollama pull llama3.2:3b
fi

echo
echo "OLLAMA is ready! You can now run: node bot.js"
