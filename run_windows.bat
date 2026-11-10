@echo off
cd /d "%~dp0"
py wallpc_agent.py
if errorlevel 1 python wallpc_agent.py
pause
