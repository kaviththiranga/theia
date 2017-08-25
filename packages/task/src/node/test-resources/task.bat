@echo off
REM TODO: adapt 'task' bash script to windows

REM SET @var="GREG"
REM ::instead of SET @var = "GREG"
REM ECHO %@var%

for /l %%x in (1,1,3) do (
   echo tasking... %*
   sleep 1
)
