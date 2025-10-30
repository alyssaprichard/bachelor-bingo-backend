// ============================================
// BACHELOR BINGO - MULTIPLAYER SERVER
// ============================================

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Allow all origins for development
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// ============================================
// DATA STORAGE
// ============================================

// Active game rooms (stored in memory)
const rooms = new Map();

// Room cleanup timers
const ROOM_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const roomTimers = new Map();

// Bachelor clichés library
const CLICHES = [
    "Here for the right reasons",
    "Can I steal you?",
    "Most dramatic season",
    "Journey",
    "Process",
    "Helicopter date",
    "Hot tub scene",
    "Someone cries",
    "Champagne toast",
    "Rose ceremony drama",
    "Awkward silence",
    "Group date drama",
    "I'm falling for you",
    "Fantasy suite card",
    "Hometown visit",
    "Meeting the parents",
    "Interrupted conversation",
    "Close-up of a rose",
    "Dramatic music swell",
    "Sunset walk on beach",
    "Will you accept this rose?",
    "Final rose tonight",
    "Connection",
    "Vulnerable moment",
    "Open up emotionally",
    "Trust the process",
    "Love triangle",
    "Cocktail party drama",
    "Tears during ITM",
    "Not here to make friends",
    "Leap of faith",
    "Take a chance on love",
    "Follow my heart",
    "Wife material",
    "Meet my family"
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a random 4-letter room code
 */
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Ensure code doesn't already exist
    return rooms.has(code) ? generateRoomCode() : code;
}

/**
 * Generate a unique bingo card (24 random clichés + FREE SPACE in center)
 */
function generateBingoCard() {
    const shuffled = [...CLICHES].sort(() => Math.random() - 0.5);
    const card = shuffled.slice(0, 24);
    card.splice(12, 0, "FREE SPACE"); // Insert at center position
    return card;
}

/**
 * Check if player has won in regular mode (5 in a row)
 */
function checkWin(markedSquares) {
    const size = 5;
    
    // Check rows
    for (let i = 0; i < size; i++) {
        const row = Array.from({ length: size }, (_, j) => markedSquares[i * size + j]);
        if (row.every(m => m)) return true;
    }
    
    // Check columns
    for (let i = 0; i < size; i++) {
        const col = Array.from({ length: size }, (_, j) => markedSquares[i + j * size]);
        if (col.every(m => m)) return true;
    }
    
    // Check diagonals
    const diag1 = [markedSquares[0], markedSquares[6], markedSquares[12], markedSquares[18], markedSquares[24]];
    const diag2 = [markedSquares[4], markedSquares[8], markedSquares[12], markedSquares[16], markedSquares[20]];
    
    return diag1.every(m => m) || diag2.every(m => m);
}

/**
 * Schedule room cleanup after timeout
 */
function scheduleRoomCleanup(roomCode) {
    // Clear existing timer if any
    if (roomTimers.has(roomCode)) {
        clearTimeout(roomTimers.get(roomCode));
    }
    
    // Schedule cleanup
    const timer = setTimeout(() => {
        const room = rooms.get(roomCode);
        if (room && room.players.length === 0) {
            console.log(`🧹 Cleaning up empty room: ${roomCode}`);
            rooms.delete(roomCode);
            roomTimers.delete(roomCode);
        }
    }, ROOM_TIMEOUT);
    
    roomTimers.set(roomCode, timer);
}

/**
 * Cancel scheduled room cleanup
 */
function cancelRoomCleanup(roomCode) {
    if (roomTimers.has(roomCode)) {
        clearTimeout(roomTimers.get(roomCode));
        roomTimers.delete(roomCode);
    }
}

/**
 * Create a new player object
 */
function createPlayer(socketId, username, isHost = false) {
    const player = {
        id: socketId,
        username: username,
        isHost: isHost,
        bingoCard: [],
        markedSquares: new Array(25).fill(false)
    };
    
    // Mark FREE SPACE as already marked
    player.markedSquares[12] = true;
    
    return player;
}

// ============================================
// HTTP ENDPOINTS
// ============================================

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        activeRooms: rooms.size,
        message: '🌹 Bachelor Bingo server is running!' 
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeRooms: rooms.size
    });
});

// ============================================
// SOCKET.IO EVENT HANDLERS
// ============================================

io.on('connection', (socket) => {
    console.log('✅ New client connected:', socket.id);

    // ----------------------------------------
    // CREATE ROOM
    // ----------------------------------------
    socket.on('create-room', (data) => {
        const roomCode = generateRoomCode();
        const player = createPlayer(socket.id, data.username, true);
        
        rooms.set(roomCode, {
            code: roomCode,
            host: socket.id,
            players: [player],
            gameStarted: false,
            gameMode: 'regular'
        });
        
        socket.join(roomCode);
        console.log(`🏠 Room ${roomCode} created by ${data.username}`);
        
        socket.emit('room-created', {
            roomCode: roomCode,
            players: rooms.get(roomCode).players
        });
    });

    // ----------------------------------------
    // JOIN ROOM
    // ----------------------------------------
    socket.on('join-room', (data) => {
        const roomCode = data.roomCode.toUpperCase();
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        // Cancel any pending cleanup
        cancelRoomCleanup(roomCode);
        
        if (room.gameStarted) {
            socket.emit('error', { message: 'Game already in progress' });
            return;
        }
        
        const player = createPlayer(socket.id, data.username, false);
        room.players.push(player);
        socket.join(roomCode);
        
        console.log(`👋 ${data.username} joined room ${roomCode}`);
        
        // Notify the joiner
        socket.emit('room-joined', {
            roomCode: roomCode,
            players: room.players
        });
        
        // Notify others in the room
        socket.to(roomCode).emit('player-joined', {
            player: player,
            players: room.players
        });
    });

    // ----------------------------------------
    // START GAME
    // ----------------------------------------
    socket.on('start-game', (data) => {
        const roomCode = data.roomCode;
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Only host can start the game' });
            return;
        }
        
        // Generate unique bingo cards
        room.players.forEach(player => {
            player.bingoCard = generateBingoCard();
        });
        
        room.gameStarted = true;
        console.log(`🎮 Game started in room ${roomCode}`);
        
        // Send each player their unique card
        room.players.forEach(player => {
            io.to(player.id).emit('game-started', {
                bingoCard: player.bingoCard,
                players: room.players.map(p => ({
                    id: p.id,
                    username: p.username,
                    isHost: p.isHost
                }))
            });
        });
    });

    // ----------------------------------------
    // MARK SQUARE
    // ----------------------------------------
    socket.on('mark-square', (data) => {
        const { roomCode, index } = data;
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            socket.emit('error', { message: 'Player not in room' });
            return;
        }
        
        // Toggle the square
        player.markedSquares[index] = !player.markedSquares[index];
        
        // Broadcast to all players
        io.to(roomCode).emit('square-marked', {
            playerId: socket.id,
            username: player.username,
            index: index,
            marked: player.markedSquares[index]
        });
        
        // Check for win
        const hasWon = room.gameMode === 'blackout' 
            ? player.markedSquares.every(m => m) 
            : checkWin(player.markedSquares);
            
        if (hasWon) {
            const markedCount = player.markedSquares.filter(m => m).length;
            console.log(`🎉 ${player.username} won in room ${roomCode}! (${room.gameMode} mode, ${markedCount} squares)`);
            
            io.to(roomCode).emit('player-won', {
                playerId: socket.id,
                username: player.username,
                gameMode: room.gameMode,
                markedCount: markedCount
            });
        }
    });

    // ----------------------------------------
    // NEW ROUND
    // ----------------------------------------
    socket.on('new-round', (data) => {
        const roomCode = data.roomCode;
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Only host can start new round' });
            return;
        }
        
        // Reset game state
        room.players.forEach(player => {
            player.bingoCard = generateBingoCard();
            player.markedSquares = new Array(25).fill(false);
            player.markedSquares[12] = true; // FREE SPACE
        });
        
        room.gameMode = 'regular';
        console.log(`🔄 New round started in room ${roomCode}`);
        
        // Send new cards to players
        room.players.forEach(player => {
            io.to(player.id).emit('new-round-started', {
                bingoCard: player.bingoCard,
                gameMode: 'regular'
            });
        });
    });

    // ----------------------------------------
    // CONTINUE TO BLACKOUT
    // ----------------------------------------
    socket.on('continue-to-blackout', (data) => {
        const roomCode = data.roomCode;
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Only host can continue to blackout' });
            return;
        }
        
        room.gameMode = 'blackout';
        console.log(`⚡ Blackout mode started in room ${roomCode}`);
        
        io.to(roomCode).emit('blackout-mode-started', {
            gameMode: 'blackout'
        });
    });

    // ----------------------------------------
    // FINISH GAME
    // ----------------------------------------
    socket.on('finish-game', (data) => {
        const roomCode = data.roomCode;
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.host !== socket.id) {
            socket.emit('error', { message: 'Only host can finish game' });
            return;
        }
        
        // Find winner with most squares
        let winner = room.players[0];
        let maxMarked = winner.markedSquares.filter(m => m).length;
        
        room.players.forEach(player => {
            const markedCount = player.markedSquares.filter(m => m).length;
            if (markedCount > maxMarked) {
                maxMarked = markedCount;
                winner = player;
            }
        });
        
        console.log(`🏁 Game finished in room ${roomCode}. Winner: ${winner.username} with ${maxMarked} squares`);
        
        io.to(roomCode).emit('game-finished', {
            playerId: winner.id,
            username: winner.username,
            markedCount: maxMarked
        });
    });

    // ----------------------------------------
    // DISCONNECT
    // ----------------------------------------
    socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
        
        rooms.forEach((room, roomCode) => {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                room.players.splice(playerIndex, 1);
                
                console.log(`👋 ${player.username} left room ${roomCode}`);
                
                if (room.players.length === 0) {
                    // Schedule cleanup for empty room
                    console.log(`⏰ Room ${roomCode} is empty, scheduling cleanup in 30 minutes`);
                    scheduleRoomCleanup(roomCode);
                } else {
                    // Cancel cleanup if room still has players
                    cancelRoomCleanup(roomCode);
                    
                    // Reassign host if needed
                    if (player.isHost) {
                        room.players[0].isHost = true;
                        room.host = room.players[0].id;
                        
                        io.to(roomCode).emit('new-host', {
                            players: room.players
                        });
                    } else {
                        io.to(roomCode).emit('player-left', {
                            players: room.players
                        });
                    }
                }
            }
        });
    });
});

// ============================================
// START SERVER
// ============================================

http.listen(PORT, () => {
    console.log(`🌹 Bachelor Bingo server running on port ${PORT}`);
    console.log(`📡 WebSocket server ready for connections`);
});
