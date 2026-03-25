# Carrom Multiplayer Game (Web MVP)

A browser-based Carrom game prototype implementing the provided software specification:

- Single-player mode (vs AI)
- Local multiplayer mode
- Online multiplayer (simulated rival)
- Physics-based striker/coin movement with collisions, friction, and pocket detection
- Leaderboard panels (global/weekly/friends)
- Achievements and reward coin progression
- Basic profile/stat persistence with `localStorage`
- Theme customization

## Run

Open `index.html` directly in a browser, or run a static file server:

```bash
python3 -m http.server 8080
```

Then navigate to `http://localhost:8080`.

## Notes

This is an MVP implementation focused on gameplay and UX foundation. Online mode is simulated client-side and does not include a real matchmaking server or backend database yet.
