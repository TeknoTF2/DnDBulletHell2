// Socket.IO connection - connects to the same origin that served this page
const socket = io();

// Game state
let gameState = null;
let myPlayerId = null;
let isDM = false;
let currentPattern = [];
let canvas, ctx;
let cellSize = 50;
let backgroundImage = null;
let tokenImageCache = {}; // Cache for player token images
let dmControlsSetup = false; // Track if DM controls have been initialized
let playerControlsSetup = false; // Track if player controls have been initialized

// DOM Elements
const connectionScreen = document.getElementById('connectionScreen');
const gameScreen = document.getElementById('gameScreen');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const dmControls = document.getElementById('dmControls');
const playerControls = document.getElementById('playerControls');

// Initialize
createGameBtn.addEventListener('click', createGame);
joinGameBtn.addEventListener('click', joinGame);

// Socket event listeners
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('gameState', (state) => {
    gameState = state;

    // Clean up token image cache for disconnected players
    Object.keys(tokenImageCache).forEach(playerId => {
        if (!gameState.players[playerId]) {
            delete tokenImageCache[playerId];
        }
    });

    renderGame();
});

socket.on('dmStatus', (status) => {
    isDM = status;
    if (isDM) {
        dmControls.style.display = 'block';
        playerControls.style.display = 'none';
        // Setup will happen when gameState is received
    }
});

socket.on('playerId', (id) => {
    myPlayerId = id;
    playerControls.style.display = 'block';
    dmControls.style.display = 'none';
    // Setup will happen when gameState is received
});

// Create Game (DM)
function createGame() {
    const rows = parseInt(document.getElementById('gridRows').value);
    const cols = parseInt(document.getElementById('gridCols').value);

    socket.emit('createGame', { rows, cols });

    connectionScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    initCanvas();
}

// Join Game (Player)
function joinGame() {
    const name = document.getElementById('playerName').value.trim();

    if (!name) {
        alert('Please enter your name');
        return;
    }

    socket.emit('joinGame', { name });

    connectionScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    initCanvas();
}

// Initialize Canvas
function initCanvas() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    // Canvas click handler for DM pattern creation
    canvas.addEventListener('click', (e) => {
        if (!isDM) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const col = Math.floor(x / cellSize);
        const row = Math.floor(y / cellSize);

        if (row >= 0 && row < gameState.gridRows && col >= 0 && col < gameState.gridCols) {
            togglePatternSquare(row, col);
        }
    });

    // Arrow key controls
    document.addEventListener('keydown', handleKeyPress);
}

// Toggle pattern square for DM
function togglePatternSquare(row, col) {
    const existingIndex = currentPattern.findIndex(s => s.row === row && s.col === col);

    if (existingIndex >= 0) {
        // If square exists, prompt for timing
        const timing = prompt(`Set timing for square (${row}, ${col}) in seconds:`, currentPattern[existingIndex].timing || 0);
        if (timing !== null) {
            currentPattern[existingIndex].timing = parseFloat(timing);
        }
    } else {
        // Add new square with default timing of 0
        currentPattern.push({ row, col, timing: 0 });
    }

    renderPatternSquares();
    renderGame();
}

// Render pattern squares list
function renderPatternSquares() {
    const container = document.getElementById('patternSquares');
    if (!container) return;

    container.innerHTML = '';

    currentPattern.forEach((square, index) => {
        const div = document.createElement('div');
        div.className = 'pattern-square-item';
        div.innerHTML = `
            <span>(${square.row}, ${square.col})</span>
            <input type="number" value="${square.timing}" step="0.1" min="0"
                   onchange="updateSquareTiming(${index}, this.value)">
            <button onclick="removePatternSquare(${index})">Remove</button>
        `;
        container.appendChild(div);
    });
}

// Update square timing
window.updateSquareTiming = function(index, value) {
    currentPattern[index].timing = parseFloat(value) || 0;
};

// Remove pattern square
window.removePatternSquare = function(index) {
    currentPattern.splice(index, 1);
    renderPatternSquares();
    renderGame();
};

// Setup DM Controls
function setupDMControls() {
    if (dmControlsSetup) return; // Only setup once
    dmControlsSetup = true;

    console.log('Setting up DM controls');

    // Grid size controls
    document.getElementById('updateGridBtn').addEventListener('click', () => {
        const rows = parseInt(document.getElementById('dmGridRows').value);
        const cols = parseInt(document.getElementById('dmGridCols').value);
        socket.emit('updateGridSize', { rows, cols });
    });

    // Background image upload
    document.getElementById('bgImageUpload').addEventListener('change', handleBackgroundUpload);

    // Pattern controls
    document.getElementById('savePatternBtn').addEventListener('click', savePattern);
    document.getElementById('clearPatternBtn').addEventListener('click', () => {
        currentPattern = [];
        renderPatternSquares();
        renderGame();
    });

    // Update grid size fields if gameState exists
    if (gameState) {
        document.getElementById('dmGridRows').value = gameState.gridRows;
        document.getElementById('dmGridCols').value = gameState.gridCols;
    }
}

// Setup Player Controls
function setupPlayerControls() {
    if (playerControlsSetup) return; // Only setup once
    playerControlsSetup = true;

    console.log('Setting up player controls');

    // Token image upload
    document.getElementById('tokenImageUpload').addEventListener('change', handleTokenUpload);

    // Name update (future feature)
    document.getElementById('updateNameBtn').addEventListener('click', () => {
        const newName = document.getElementById('playerNameInput').value.trim();
        if (newName) {
            alert('Name update feature coming soon! Rejoin with new name for now.');
        }
    });
}

// Handle background image upload
function handleBackgroundUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file is an image
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }

    // Validate file size (max 50MB for large D&D maps)
    if (file.size > 50 * 1024 * 1024) {
        alert('Image too large. Please select an image under 50MB');
        return;
    }

    console.log('Uploading background image:', file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
        socket.emit('updateBackground', event.target.result);
        console.log('Background image uploaded successfully');
    };
    reader.onerror = () => {
        alert('Error reading image file');
    };
    reader.readAsDataURL(file);
}

// Handle token image upload
function handleTokenUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file is an image
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }

    // Validate file size (max 50MB for large D&D maps)
    if (file.size > 50 * 1024 * 1024) {
        alert('Image too large. Please select an image under 50MB');
        return;
    }

    console.log('Uploading token image:', file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
        socket.emit('updateTokenImage', event.target.result);
        console.log('Token image uploaded successfully');
    };
    reader.onerror = () => {
        alert('Error reading image file');
    };
    reader.readAsDataURL(file);
}

// Save pattern
function savePattern() {
    const name = document.getElementById('patternName').value.trim();

    if (!name) {
        alert('Please enter a pattern name');
        return;
    }

    if (currentPattern.length === 0) {
        alert('Please add at least one square to the pattern');
        return;
    }

    const pattern = {
        name,
        squares: [...currentPattern]
    };

    socket.emit('savePattern', pattern);

    currentPattern = [];
    document.getElementById('patternName').value = '';
    renderPatternSquares();
    renderGame();
}

// Handle arrow key press
function handleKeyPress(e) {
    if (!myPlayerId || !gameState || !gameState.players[myPlayerId]) return;

    const player = gameState.players[myPlayerId];
    let newRow = player.row;
    let newCol = player.col;

    switch(e.key) {
        case 'ArrowUp':
            newRow = Math.max(0, player.row - 1);
            e.preventDefault();
            break;
        case 'ArrowDown':
            newRow = Math.min(gameState.gridRows - 1, player.row + 1);
            e.preventDefault();
            break;
        case 'ArrowLeft':
            newCol = Math.max(0, player.col - 1);
            e.preventDefault();
            break;
        case 'ArrowRight':
            newCol = Math.min(gameState.gridCols - 1, player.col + 1);
            e.preventDefault();
            break;
        default:
            return;
    }

    if (newRow !== player.row || newCol !== player.col) {
        socket.emit('movePlayer', { row: newRow, col: newCol });
    }
}

// Render the game
function renderGame() {
    if (!gameState || !canvas || !ctx) return;

    // Setup controls once we have gameState
    if (isDM) {
        setupDMControls();
    } else if (myPlayerId) {
        setupPlayerControls();
    }

    // Calculate canvas size
    const maxWidth = window.innerWidth - (isDM || myPlayerId ? 600 : 300);
    const maxHeight = window.innerHeight - 200;

    cellSize = Math.min(
        Math.floor(maxWidth / gameState.gridCols),
        Math.floor(maxHeight / gameState.gridRows),
        80
    );

    canvas.width = gameState.gridCols * cellSize;
    canvas.height = gameState.gridRows * cellSize;

    // Draw background
    if (gameState.backgroundImage) {
        if (!backgroundImage || backgroundImage.src !== gameState.backgroundImage) {
            backgroundImage = new Image();
            backgroundImage.src = gameState.backgroundImage;
        }
        if (backgroundImage.complete) {
            ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
        }
    } else {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    for (let row = 0; row <= gameState.gridRows; row++) {
        ctx.beginPath();
        ctx.moveTo(0, row * cellSize);
        ctx.lineTo(canvas.width, row * cellSize);
        ctx.stroke();
    }

    for (let col = 0; col <= gameState.gridCols; col++) {
        ctx.beginPath();
        ctx.moveTo(col * cellSize, 0);
        ctx.lineTo(col * cellSize, canvas.height);
        ctx.stroke();
    }

    // Draw active attack squares
    if (gameState.activeSquares) {
        gameState.activeSquares.forEach(square => {
            const x = square.col * cellSize;
            const y = square.row * cellSize;

            if (square.phase === 'warning') {
                ctx.fillStyle = 'rgba(255, 165, 0, 0.6)'; // Orange
            } else if (square.phase === 'damage') {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.7)'; // Red
            }

            ctx.fillRect(x, y, cellSize, cellSize);
        });
    }

    // Draw current pattern (DM only)
    if (isDM && currentPattern.length > 0) {
        currentPattern.forEach(square => {
            const x = square.col * cellSize;
            const y = square.row * cellSize;

            ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'; // Yellow preview
            ctx.fillRect(x, y, cellSize, cellSize);

            // Draw timing label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${square.timing}s`, x + cellSize / 2, y + cellSize / 2);
        });
    }

    // Draw players
    Object.values(gameState.players).forEach(player => {
        const x = player.col * cellSize;
        const y = player.row * cellSize;

        if (player.tokenImage) {
            // Use cached image or create new one
            if (!tokenImageCache[player.id] || tokenImageCache[player.id].src !== player.tokenImage) {
                tokenImageCache[player.id] = new Image();
                tokenImageCache[player.id].src = player.tokenImage;
                tokenImageCache[player.id].onload = () => renderGame();
            }

            const img = tokenImageCache[player.id];
            if (img.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, x + 2, y + 2, cellSize - 4, cellSize - 4);
            } else {
                // Draw placeholder while image loads
                ctx.fillStyle = player.color;
                ctx.beginPath();
                ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize / 3, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            // Draw colored circle as default token
            ctx.fillStyle = player.color;
            ctx.beginPath();
            ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize / 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw player name
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.strokeText(player.name, x + cellSize / 2, y + cellSize - 5);
        ctx.fillText(player.name, x + cellSize / 2, y + cellSize - 5);

        // Highlight if current player
        if (player.id === myPlayerId) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
        }
    });

    // Update player list
    updatePlayersList();
    updateSavedPatternsList();
    updateDMPlayersList();
}

// Update players list
function updatePlayersList() {
    const container = document.getElementById('playersList');
    if (!container || !gameState) return;

    container.innerHTML = '';

    Object.values(gameState.players).forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.style.borderLeftColor = player.color;
        div.innerHTML = `
            <div class="name">${player.name}</div>
            <div class="stats">
                <span>Speed: ${player.speedRemaining}/${player.speed}</span>
                <span>Hits: ${player.hits}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

// Update saved patterns list
function updateSavedPatternsList() {
    const container = document.getElementById('savedPatternsList');
    if (!container || !gameState || !isDM) return;

    container.innerHTML = '';

    gameState.savedPatterns.forEach((pattern, index) => {
        const div = document.createElement('div');
        div.className = 'pattern-item';

        const timings = pattern.squares.map(s => s.timing).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);

        div.innerHTML = `
            <div class="pattern-name">${pattern.name}</div>
            <div class="pattern-info">${pattern.squares.length} squares</div>
            <div class="pattern-info">Timings: ${timings.join(', ')}s</div>
            <button onclick="launchPattern(${index})">Launch</button>
            <button onclick="deletePattern(${index})">Delete</button>
        `;
        container.appendChild(div);
    });
}

// Launch pattern
window.launchPattern = function(index) {
    if (!isDM) return;
    const pattern = gameState.savedPatterns[index];
    socket.emit('launchPattern', pattern);
};

// Delete pattern
window.deletePattern = function(index) {
    if (!isDM) return;
    if (confirm('Delete this pattern?')) {
        socket.emit('deletePattern', index);
    }
};

// Update DM players list
function updateDMPlayersList() {
    const container = document.getElementById('dmPlayersList');
    if (!container || !gameState || !isDM) return;

    container.innerHTML = '';

    Object.values(gameState.players).forEach(player => {
        const div = document.createElement('div');
        div.className = 'dm-player-item';
        div.innerHTML = `
            <div class="dm-player-name">${player.name}</div>
            <label>Speed:</label>
            <input type="number" value="${player.speed}" min="1" max="20"
                   onchange="updatePlayerSpeed('${player.id}', this.value)">
        `;
        container.appendChild(div);
    });
}

// Update player speed
window.updatePlayerSpeed = function(playerId, speed) {
    if (!isDM) return;
    socket.emit('updateSpeed', { playerId, speed: parseInt(speed) });
};

// Update player stats display
function updatePlayerStats() {
    const container = document.getElementById('playerStats');
    if (!container || !myPlayerId || !gameState) return;

    const player = gameState.players[myPlayerId];
    if (!player) return;

    container.innerHTML = `
        <div style="margin-top: 15px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px;">
            <div><strong>Speed:</strong> ${player.speedRemaining}/${player.speed} tiles</div>
            <div><strong>Hits:</strong> ${player.hits}</div>
            <div style="margin-top: 8px; font-size: 0.85em; color: #c0c0c0;">
                Speed regenerates every 6 seconds
            </div>
        </div>
    `;
}

// Update stats periodically
setInterval(() => {
    if (myPlayerId && gameState) {
        updatePlayerStats();
    }
}, 1000);
