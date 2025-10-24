# Bullet Hell D&D Game

A browser-based multiplayer bullet hell game for D&D campaigns! Instead of rolling dice, players dodge attacks in real-time.

## Features

### Core Gameplay
- **Customizable Grid**: Create any grid size for your battlefield
- **Multiplayer**: Players connect and appear as tokens on the grid in real-time
- **Movement System**: Arrow key controls with a speed-based movement system
  - Each player has a "speed" value (tiles they can move per 6 seconds)
  - After moving, remaining speed decreases
  - Speed fully regenerates every 6 seconds
- **Hit Tracking**: Tracks how many times each player gets hit by attacks

### Customization
- **Custom Tokens**: Upload images for player tokens
- **Background Images**: Set a background image that resizes with the grid
- **Player Names**: Each player can set their own name
- **Speed Adjustment**: DM can modify each player's movement speed

### DM Attack System
- **Pattern Creation**: Click grid squares to create attack patterns
- **Timing Controls**: Set individual timing for each square in a pattern
  - All squares can trigger at once (timing = 0)
  - Stagger squares (e.g., 0s, 1s, 2s for sequential)
  - Complex patterns (e.g., 0s, 0s, 2s, 5s for grouped timing)
- **Attack Phases**:
  - Orange warning (1 second) - shows where attack will hit
  - Red damage (3 seconds) - players in these squares get hit
- **Saved Patterns**: Save and reuse patterns throughout the session

## How to Run

### Start the Server
```bash
cd server
npm start
```

Server runs on `http://localhost:3001`

### Access the Game
1. Open your browser to `http://localhost:3001`
2. The DM should click "Create Game" first and set the grid size
3. Players can then join by entering their name and clicking "Join Game"

## How to Play

### For the DM
1. **Create the Game**: Set grid dimensions and click "Create Game"
2. **Customize the Field**:
   - Upload a background image for ambiance
   - Adjust grid size during the game
   - Modify player speeds as needed
3. **Create Attack Patterns**:
   - Click squares on the grid to add them to your pattern
   - Click a square again to set its timing (in seconds)
   - Give the pattern a name
   - Click "Save Pattern"
4. **Launch Attacks**:
   - Select a saved pattern from the list
   - Click "Launch" to activate it
   - Watch as squares turn orange (warning) then red (damage)

### For Players
1. **Join**: Enter your name and click "Join Game"
2. **Customize**: Upload a token image to represent your character
3. **Move**: Use arrow keys to move around the grid
4. **Dodge**: Watch for orange squares (incoming attack) and move before they turn red!
5. **Monitor**: Keep an eye on your speed remaining and hit count

## Tips

### Creating Good Attack Patterns
- Use timing to create "waves" of attacks
- Mix simultaneous and sequential squares
- Create safe zones then eliminate them with delayed squares
- Test patterns before using them in important moments

### For Players
- Don't waste all your speed at once
- Plan your movement path ahead
- Watch your speed regeneration timer
- Communicate with other players to avoid collision confusion

## Technical Details

- **Backend**: Node.js with Express and Socket.IO
- **Frontend**: Vanilla JavaScript with HTML5 Canvas
- **Real-time**: All game state synchronized via WebSocket
- **Movement**: Manhattan distance calculation (no diagonal movement)

## Port Configuration

Default port is 3001. To change it, set the PORT environment variable:
```bash
PORT=3000 npm start
```

## Browser Requirements

Works best in modern browsers with HTML5 Canvas and WebSocket support:
- Chrome/Edge (recommended)
- Firefox
- Safari

---

Have fun dodging those attacks! 🎲🎮
