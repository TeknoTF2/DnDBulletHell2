const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 5e6 // 5MB max payload (default is 1MB)
});

let gameState = {
  gridRows: 10,
  gridCols: 10,
  players: {},
  dm: null,
  savedPatterns: [],
  activeSquares: [],
  backgroundImage: null
};

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
let colorIndex = 0;

function getNextColor() {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return color;
}

// Lightweight broadcast - strips out images to reduce bandwidth
function broadcastGameStateLightweight() {
  const lightState = {
    ...gameState,
    backgroundImage: null,
    players: Object.fromEntries(
      Object.entries(gameState.players).map(([id, player]) => [
        id,
        { ...player, tokenImage: null }
      ])
    )
  };
  io.emit('gameState', lightState);
}

// Coalesce broadcasts: callers mark the state dirty and a fixed-rate
// flusher emits at most once per tick. Keeps bursty pattern launches
// from producing hundreds of emits per second.
let stateDirty = false;
function broadcastGameState() {
  stateDirty = true;
}

const BROADCAST_TICK_MS = 50;
setInterval(() => {
  if (stateDirty) {
    stateDirty = false;
    broadcastGameStateLightweight();
  }
}, BROADCAST_TICK_MS);

// Movement cooldown system
setInterval(() => {
  let regenerated = false;
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    if (player.speedRemaining < player.speed) {
      player.speedRemaining = player.speed;
      regenerated = true;
    }
  });
  if (regenerated) broadcastGameState();
}, 6000);

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('createGame', (data) => {
    gameState.dm = socket.id;
    gameState.gridRows = data.rows;
    gameState.gridCols = data.cols;
    socket.emit('dmStatus', true);
    socket.emit('gameState', gameState);
    console.log('Game created by DM:', socket.id);
  });

  socket.on('joinGame', (data) => {
    const startRow = Math.floor(gameState.gridRows / 2);
    const startCol = Math.floor(gameState.gridCols / 2);

    gameState.players[socket.id] = {
      id: socket.id,
      name: data.name,
      row: startRow,
      col: startCol,
      color: getNextColor(),
      speed: 3,
      speedRemaining: 3,
      hits: 0,
      tokenImage: null
    };

    socket.emit('playerId', socket.id);

    // Send FULL state to the new joiner (includes all images)
    socket.emit('gameState', gameState);
    // Send lightweight update to everyone else
    broadcastGameStateLightweight();

    console.log('Player joined:', data.name);
  });

  socket.on('movePlayer', (data) => {
    const player = gameState.players[socket.id];
    if (player) {
      const distance = Math.abs(player.row - data.row) + Math.abs(player.col - data.col);
      
      if (distance <= player.speedRemaining) {
        player.row = data.row;
        player.col = data.col;
        player.speedRemaining -= distance;
        broadcastGameState();
      }
    }
  });

  socket.on('updateTokenImage', (imageData) => {
    const player = gameState.players[socket.id];
    if (player) {
      player.tokenImage = imageData;
      // Broadcast to everyone (new image needs to go out)
      io.emit('playerTokenUpdate', {
        playerId: socket.id,
        tokenImage: imageData
      });
    }
  });

  socket.on('updateSpeed', (data) => {
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized speed update attempt from:', socket.id);
      return;
    }

    const player = gameState.players[data.playerId];
    if (player) {
      player.speed = data.speed;
      player.speedRemaining = data.speed;
      broadcastGameState();
    }
  });

  socket.on('updateGridSize', (data) => {
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized grid size update attempt from:', socket.id);
      return;
    }

    gameState.gridRows = data.rows;
    gameState.gridCols = data.cols;
    broadcastGameState();
  });

  socket.on('updateBackground', (imageData) => {
    try {
      if (socket.id !== gameState.dm) {
        console.log('Unauthorized background update attempt from:', socket.id);
        return;
      }

      if (!imageData || imageData.length > 5 * 1024 * 1024) {
        console.log('Background image too large or invalid');
        socket.emit('error', 'Image too large');
        return;
      }

      gameState.backgroundImage = imageData;
      // Broadcast to everyone
      io.emit('backgroundUpdate', imageData);
      console.log('Background updated, size:', (imageData.length / 1024 / 1024).toFixed(2), 'MB');
    } catch (error) {
      console.error('Error updating background:', error);
      socket.emit('error', 'Failed to update background');
    }
  });

  socket.on('savePattern', (pattern) => {
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized pattern save attempt from:', socket.id);
      return;
    }

    gameState.savedPatterns.push(pattern);
    broadcastGameState();
    console.log('Pattern saved:', pattern.name);
  });

  socket.on('importPatterns', (patterns) => {
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized pattern import attempt from:', socket.id);
      return;
    }

    if (!Array.isArray(patterns)) {
      console.log('Invalid patterns data received');
      return;
    }

    gameState.savedPatterns = patterns;
    broadcastGameState();
    console.log(`Patterns imported: ${patterns.length} pattern(s)`);
  });

  socket.on('launchPattern', (pattern) => {
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized pattern launch attempt from:', socket.id);
      return;
    }

    console.log('Launching pattern:', pattern.name);

    // Process each square individually with its own timing, warning, and duration
    pattern.squares.forEach(square => {
      const timing = parseFloat(square.timing) || 0;
      const duration = parseFloat(square.duration) || 3;
      const warning = typeof square.warning === 'number' ? square.warning : (parseFloat(square.warning) || 1);
      const delay = timing * 1000;

      setTimeout(() => {
        // Generate unique ID for this square instance
        const squareId = `${square.row}-${square.col}-${Date.now()}-${Math.random()}`;

        // Warning phase (orange)
        gameState.activeSquares.push({
          row: square.row,
          col: square.col,
          phase: 'warning',
          id: squareId
        });
        broadcastGameState();

        // Damage phase (red) - variable duration
        setTimeout(() => {
          // Transition warning -> damage in place
          const idx = gameState.activeSquares.findIndex(s => s.id === squareId);
          const damageSquare = {
            row: square.row,
            col: square.col,
            phase: 'damage',
            id: squareId
          };
          if (idx !== -1) {
            gameState.activeSquares[idx] = damageSquare;
          } else {
            gameState.activeSquares.push(damageSquare);
          }
          broadcastGameState();

          // Only broadcast when someone actually got hit
          const checkHit = () => {
            let anyHit = false;
            Object.keys(gameState.players).forEach(playerId => {
              const player = gameState.players[playerId];
              if (player && player.row === square.row && player.col === square.col) {
                player.hits++;
                anyHit = true;
                console.log(`Player ${player.name} hit at (${square.row},${square.col})! Total hits: ${player.hits}`);
              }
            });
            if (anyHit) broadcastGameState();
          };

          // Check for hits immediately (at 0 seconds)
          checkHit();

          // Schedule hit checks every second for the duration
          const numChecks = Math.floor(duration);
          for (let i = 1; i < numChecks; i++) {
            setTimeout(checkHit, i * 1000);
          }

          // Clear square after duration
          setTimeout(() => {
            const clearIdx = gameState.activeSquares.findIndex(s => s.id === squareId);
            if (clearIdx !== -1) gameState.activeSquares.splice(clearIdx, 1);
            broadcastGameState();
          }, duration * 1000);
        }, warning * 1000); // Warning phase duration (per-square, defaults to 1s)
      }, delay);
    });
  });

  socket.on('deletePattern', (index) => {
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized pattern deletion attempt from:', socket.id);
      return;
    }

    if (index >= 0 && index < gameState.savedPatterns.length) {
      gameState.savedPatterns.splice(index, 1);
      broadcastGameState();
      console.log('Pattern deleted at index:', index);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    if (gameState.players[socket.id]) {
      delete gameState.players[socket.id];
      broadcastGameState();
    }
    
    if (gameState.dm === socket.id) {
      gameState.dm = null;
      console.log('DM disconnected, game reset');
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
