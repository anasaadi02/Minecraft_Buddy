@echo off
echo Starting OLLAMA for MC Buddy...
echo.

REM Check if OLLAMA is already running
curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% == 0 (
    echo OLLAMA is already running!
    goto :check_model
)

echo Starting OLLAMA server...
start "OLLAMA Server" ollama serve

REM Wait a moment for OLLAMA to start
timeout /t 3 /nobreak >nul

:check_model
echo Checking if llama3.2:3b model is available...
ollama list | findstr "llama3.2:3b" >nul
if %errorlevel% == 0 (
    echo Model is available!
) else (
    echo Model not found. Downloading llama3.2:3b...
    ollama pull llama3.2:3b
)

echo.
echo OLLAMA is ready! You can now run: node bot.js
echo Press any key to exit...
pause >nul
