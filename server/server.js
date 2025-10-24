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
  }
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

function broadcastGameState() {
  io.emit('gameState', gameState);
}

// Movement cooldown system
setInterval(() => {
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    if (player.speedRemaining < player.speed) {
      player.speedRemaining = player.speed;
    }
  });
  broadcastGameState();
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
    broadcastGameState();
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
      broadcastGameState();
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
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized background update attempt from:', socket.id);
      return;
    }

    gameState.backgroundImage = imageData;
    broadcastGameState();
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

  socket.on('launchPattern', (pattern) => {
    if (socket.id !== gameState.dm) {
      console.log('Unauthorized pattern launch attempt from:', socket.id);
      return;
    }

    console.log('Launching pattern:', pattern.name);

    // Process each square individually with its own timing and duration
    pattern.squares.forEach(square => {
      const timing = parseFloat(square.timing) || 0;
      const duration = parseFloat(square.duration) || 3;
      const delay = timing * 1000;

      setTimeout(() => {
        // Generate unique ID for this square instance
        const squareId = `${square.row}-${square.col}-${Date.now()}-${Math.random()}`;

        // Warning phase (orange) - 1 second
        const warningSquare = {
          row: square.row,
          col: square.col,
          phase: 'warning',
          id: squareId
        };

        gameState.activeSquares = [...gameState.activeSquares, warningSquare];
        broadcastGameState();

        // Damage phase (red) - variable duration
        setTimeout(() => {
          // Remove warning square and add damage square
          gameState.activeSquares = gameState.activeSquares.filter(s => s.id !== squareId);

          const damageSquare = {
            row: square.row,
            col: square.col,
            phase: 'damage',
            id: squareId
          };

          gameState.activeSquares = [...gameState.activeSquares, damageSquare];
          broadcastGameState();

          // Function to check for hits on this specific square
          const checkHit = () => {
            Object.keys(gameState.players).forEach(playerId => {
              const player = gameState.players[playerId];
              if (player && player.row === square.row && player.col === square.col) {
                player.hits++;
                console.log(`Player ${player.name} hit at (${square.row},${square.col})! Total hits: ${player.hits}`);
              }
            });
            broadcastGameState();
          };

          // Check for hits immediately (at 0 seconds)
          checkHit();

          // Schedule hit checks every second for the duration
          const hitCheckIntervals = [];
          const numChecks = Math.floor(duration);

          for (let i = 1; i < numChecks; i++) {
            hitCheckIntervals.push(setTimeout(() => {
              checkHit();
            }, i * 1000));
          }

          // Clear square after duration
          setTimeout(() => {
            gameState.activeSquares = gameState.activeSquares.filter(s => s.id !== squareId);
            broadcastGameState();
          }, duration * 1000);
        }, 1000); // Warning phase is always 1 second
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
