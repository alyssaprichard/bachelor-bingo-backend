const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", // Allow all origins (you can restrict this later)
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// Store active rooms
const rooms = new Map();

// Bachelor clichés library (same as frontend)
const CLICHES = [
    "Mel references or apologizes for his earlier comments about age",
    "Someone interrupts another person mid-sentence",
    "“I didn’t get closure” or “You never answered my question” line",
    "Mel hugs a contestant when she walks on stage",
    "Mel says “chemistry” or “connection” as a reason for being drawn to someone",
    "A flashback clip to a previous date or limo entrance",
    "Audience gasps loudly",
    "A woman says she wants “authenticity” or “someone real”",
    "A contestant admits she “fell harder than expected.”",
    "A woman gets a standing ovation from the audience.",
    "A woman says “I discovered things about myself”",
    "Blooper real with farts",
    "“That’s not how it happened!”",
    "A woman says she was “blindsided.”",
    "Someone mentions social media or “the internet.”",
    "Jesse Palmer steps in to calm things down.",
    "A contestant jokes about hot flashes or memory loss.",
    "Reaction shot of someone visibly rolling their eyes.",
    "Tears of any kind",
    "Jesse says, “America fell in love with you.”",
    "A contestant references faith or fate.",
    "Awkward silence after a dramatic reveal.",
    "Someone says “I wish you the best, truly.”",
    "Someone mentions “closure” more than once.",
    "A contestant says she’s “dating again” or “met someone new.”",
    "Audience chants or claps mid-argument.",
    "A “villain” contestant gets applause or redemption moment.",
    "Mel says, “You’re an amazing woman.”",
    "Someone says, “I have no regrets.”",
    "Jesse Palmer makes a joke that’s cheesy or doesn’t land.",
    "A contestant flirts with Jesse.",
    "Someone forgets another contestant’s name.",
    "Fantasy suite reference",
    "Someone references a private conversation that clearly wasn’t private.",
    "Someone says, “You deserve happiness.”",
    "Jesse or a contestant asks Mel if he regrets his final choice.",
    "A surprise guest.",
    "Everyone hugs at the end like nothing happened."
        ];

// Generate a random 4-letter room code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Make sure code doesn't already exist
    return rooms.has(code) ? generateRoomCode() : code;
}

// Generate a unique bingo card (24 random clichés + FREE SPACE in middle)
function generateBingoCard() {
    // Shuffle the clichés
    const shuffled = [...CLICHES].sort(() => Math.random() - 0.5);
    
    // Take first 24
    const card = shuffled.slice(0, 24);
    
    // Insert FREE SPACE at position 12 (middle)
    card.splice(12, 0, "FREE SPACE");
    
    return card;
}

// Check if a player has won (5 in a row: horizontal, vertical, or diagonal)
function checkWin(markedSquares) {
    const size = 5;
    
    // Check rows
    for (let i = 0; i < size; i++) {
        let row = [];
        for (let j = 0; j < size; j++) {
            row.push(markedSquares[i * size + j]);
        }
        if (row.every(m => m)) return true;
    }
    
    // Check columns
    for (let i = 0; i < size; i++) {
        let col = [];
        for (let j = 0; j < size; j++) {
            col.push(markedSquares[i + j * size]);
        }
        if (col.every(m => m)) return true;
    }
    
    // Check diagonals
    let diag1 = [markedSquares[0], markedSquares[6], markedSquares[12], markedSquares[18], markedSquares[24]];
    if (diag1.every(m => m)) return true;
    
    let diag2 = [markedSquares[4], markedSquares[8], markedSquares[12], markedSquares[16], markedSquares[20]];
    if (diag2.every(m => m)) return true;
    
    return false;
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Create a new room
    socket.on('create-room', (data) => {
        const roomCode = generateRoomCode();
        const player = {
            id: socket.id,
            username: data.username,
            isHost: true,
            bingoCard: [], // Will be assigned when game starts
            markedSquares: new Array(25).fill(false)
        };
        
        // Mark FREE SPACE (index 12) as already marked
        player.markedSquares[12] = true;
        
        rooms.set(roomCode, {
            code: roomCode,
            host: socket.id,
            players: [player],
            gameStarted: false,
            gameMode: 'regular' // 'regular' or 'blackout'
        });
        
        socket.join(roomCode);
        
        console.log(`Room ${roomCode} created by ${data.username}`);
        
        socket.emit('room-created', {
            roomCode: roomCode,
            players: rooms.get(roomCode).players
        });
    });

    // Join an existing room
    socket.on('join-room', (data) => {
        const roomCode = data.roomCode.toUpperCase();
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.gameStarted) {
            socket.emit('error', { message: 'Game already in progress' });
            return;
        }
        
        const player = {
            id: socket.id,
            username: data.username,
            isHost: false,
            bingoCard: [], // Will be assigned when game starts
            markedSquares: new Array(25).fill(false)
        };
        
        // Mark FREE SPACE (index 12) as already marked
        player.markedSquares[12] = true;
        
        room.players.push(player);
        socket.join(roomCode);
        
        console.log(`${data.username} joined room ${roomCode}`);
        
        // Tell the joiner they successfully joined
        socket.emit('room-joined', {
            roomCode: roomCode,
            players: room.players
        });
        
        // Tell everyone else in the room that a new player joined
        socket.to(roomCode).emit('player-joined', {
            player: player,
            players: room.players
        });
    });

    // Host starts the game
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
        
        // Generate unique bingo card for each player
        room.players.forEach(player => {
            player.bingoCard = generateBingoCard();
        });
        
        room.gameStarted = true;
        
        console.log(`Game started in room ${roomCode}`);
        
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

    // Player marks a square
    socket.on('mark-square', (data) => {
        const { roomCode, index } = data;
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        // Find the player
        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            socket.emit('error', { message: 'Player not in room' });
            return;
        }
        
        // Toggle the square
        player.markedSquares[index] = !player.markedSquares[index];
        
        console.log(`${player.username} marked square ${index} in room ${roomCode}`);
        
        // Broadcast to all players in the room (including sender)
        io.to(roomCode).emit('square-marked', {
            playerId: socket.id,
            username: player.username,
            index: index,
            marked: player.markedSquares[index]
        });
        
        // Check if this player won
        const hasWon = room.gameMode === 'blackout' 
            ? player.markedSquares.every(m => m) // Blackout: all 25 squares
            : checkWin(player.markedSquares); // Regular: 5 in a row
            
        if (hasWon) {
            const markedCount = player.markedSquares.filter(m => m).length;
            console.log(`${player.username} won in room ${roomCode}! (${room.gameMode} mode, ${markedCount} squares)`);
            
            // Announce winner to everyone in the room
            io.to(roomCode).emit('player-won', {
                playerId: socket.id,
                username: player.username,
                gameMode: room.gameMode,
                markedCount: markedCount
            });
        }
    });

    // Host starts a new round (clear boards, new cards, regular mode)
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
        
        // Generate new unique cards for each player
        room.players.forEach(player => {
            player.bingoCard = generateBingoCard();
            player.markedSquares = new Array(25).fill(false);
            player.markedSquares[12] = true; // Mark FREE SPACE
        });
        
        room.gameMode = 'regular';
        
        console.log(`New round started in room ${roomCode}`);
        
        // Send each player their new unique card
        room.players.forEach(player => {
            io.to(player.id).emit('new-round-started', {
                bingoCard: player.bingoCard,
                gameMode: 'regular'
            });
        });
    });

    // Host continues to blackout mode (keep marked squares, try to fill all 25)
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
        
        console.log(`Blackout mode started in room ${roomCode}`);
        
        // Tell everyone we're now in blackout mode
        io.to(roomCode).emit('blackout-mode-started', {
            gameMode: 'blackout'
        });
    });

    // Host finishes the blackout game (find winner with most squares)
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
        
        // Find player with most marked squares
        let winner = room.players[0];
        let maxMarked = winner.markedSquares.filter(m => m).length;
        
        room.players.forEach(player => {
            const markedCount = player.markedSquares.filter(m => m).length;
            if (markedCount > maxMarked) {
                maxMarked = markedCount;
                winner = player;
            }
        });
        
        console.log(`Game finished in room ${roomCode}. Winner: ${winner.username} with ${maxMarked} squares`);
        
        // Announce winner to everyone
        io.to(roomCode).emit('game-finished', {
            playerId: winner.id,
            username: winner.username,
            markedCount: maxMarked
        });
    });

    // Player leaves/disconnects
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Find which room they were in
        rooms.forEach((room, roomCode) => {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                room.players.splice(playerIndex, 1);
                
                console.log(`${player.username} left room ${roomCode}`);
                
                // If room is empty, delete it
                if (room.players.length === 0) {
                    rooms.delete(roomCode);
                    console.log(`Room ${roomCode} deleted (empty)`);
                } else {
                    // If the host left, assign new host
                    if (player.isHost) {
                        room.players[0].isHost = true;
                        room.host = room.players[0].id;
                        
                        // Notify everyone of new host
                        io.to(roomCode).emit('new-host', {
                            players: room.players
                        });
                    } else {
                        // Just notify that a player left
                        io.to(roomCode).emit('player-left', {
                            players: room.players
                        });
                    }
                }
            }
        });
    });
});

// Start server
http.listen(PORT, () => {
    console.log(`🌹 Bachelor Bingo server running on port ${PORT}`);
});