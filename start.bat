@echo off
start "Udyam Backend" powershell.exe -NoExit -Command "Set-Location '%~dp0backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload"
start "Udyam Frontend" powershell.exe -NoExit -Command "Set-Location '%~dp0frontend'; npm run dev"
