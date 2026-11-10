@echo off
title Dia a Dia English
cd /d "%~dp0"

py -3 --version >nul 2>nul
if %errorlevel%==0 goto run_py
python --version >nul 2>nul
if %errorlevel%==0 goto run_python

echo.
echo  Python 3 was not found on this computer.
echo.
echo  1. Open the Microsoft Store, search for "Python 3.13" and click Install
echo     (or download it from https://www.python.org/downloads/ and tick
echo     "Add python.exe to PATH" during the installation).
echo  2. Double-click start.bat again.
echo.
pause
exit /b 1

:run_py
py -3 server.py
goto done

:run_python
python server.py

:done
pause
