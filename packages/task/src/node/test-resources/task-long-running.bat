
@echo off
REM TODO: adapt 'task-long-running' bash script to windows

@echo off
for /l %%x in (1,1,300) do (
   echo tasking... %%x
   SLEEP 1
)