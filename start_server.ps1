# Launched by the "MTL Leaderboards Tracker" scheduled task at logon.
# Runs the Flask app hidden, appending its output to server.log.
Set-Location $PSScriptRoot
& py -3 app.py *>> "$PSScriptRoot\server.log"
