Check the status of all development services.

Run these commands in parallel:
1. `docker ps --filter "name=egm" --filter "name=ea-mvp" --format "{{.Names}}\t{{.Status}}"`
2. `curl -s -o /dev/null -w "Backend (4001): %{http_code}\n" http://localhost:4001/api/health`
3. `curl -s -o /dev/null -w "Frontend (3001): %{http_code}\n" http://localhost:3001/`

Report which services are up and which are down.
