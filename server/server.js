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

    // Group squares by timing
    const timingGroups = {};
    pattern.squares.forEach(square => {
      const timing = square.timing || 0;
      if (!timingGroups[timing]) {
        timingGroups[timing] = [];
      }
      timingGroups[timing].push(square);
    });

    // Schedule each timing group
    Object.keys(timingGroups).forEach(timing => {
      const delay = parseFloat(timing) * 1000;

      setTimeout(() => {
        const squares = timingGroups[timing];

        // Add unique IDs to track these specific squares
        const squareIds = squares.map(s => `${s.row}-${s.col}-${Date.now()}-${Math.random()}`);

        // Warning phase (orange) - 1 second
        // Add to existing active squares instead of replacing
        const warningSquares = squares.map((s, idx) => ({
          row: s.row,
          col: s.col,
          phase: 'warning',
          id: squareIds[idx]
        }));

        gameState.activeSquares = [...gameState.activeSquares, ...warningSquares];
        broadcastGameState();

        // Damage phase (red) - 3 seconds
        setTimeout(() => {
          // Remove warning squares and add damage squares for this group
          gameState.activeSquares = gameState.activeSquares.filter(
            s => !squareIds.includes(s.id)
          );

          const damageSquares = squares.map((s, idx) => ({
            row: s.row,
            col: s.col,
            phase: 'damage',
            id: squareIds[idx]
          }));

          gameState.activeSquares = [...gameState.activeSquares, ...damageSquares];

          // Check for hits
          squares.forEach(square => {
            Object.keys(gameState.players).forEach(playerId => {
              const player = gameState.players[playerId];
              if (player.row === square.row && player.col === square.col) {
                player.hits++;
              }
            });
          });

          broadcastGameState();

          // Clear squares after damage phase
          setTimeout(() => {
            gameState.activeSquares = gameState.activeSquares.filter(
              s => !squareIds.includes(s.id)
            );
            broadcastGameState();
          }, 3000);
        }, 1000);
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
