@echo off
set SA_DATA=%~dp0data
dotnet run -c Release --no-launch-profile --project "%~dp0src" --urls http://localhost:5080
