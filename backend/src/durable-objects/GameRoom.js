export class GameRoom {
	constructor(controller, env) {
		this.controller = controller;
		this.env = env;
		this.sessions = new Map(); // sessionId -> WebSocket
		this.waitingPlayers = new Map(); // playerId -> {sessionId, userInfo}
		this.activeGames = new Map(); // gameId -> game data
		this.playerToGame = new Map(); // playerId -> gameId
		this.playerToSession = new Map(); // playerId -> sessionId
	}

	async fetch(request) {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.handleSession(server, request);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async handleSession(webSocket, request) {
		webSocket.accept();

		const sessionId = this.generateSessionId();
		this.sessions.set(sessionId, webSocket);

		let playerId = null;

		webSocket.addEventListener('message', async (event) => {
			try {
				const message = JSON.parse(event.data);

				switch (message.type) {
					case 'JOIN_QUEUE':
						playerId = message.playerId;
						this.playerToSession.set(playerId, sessionId);
						this.addWaitingPlayer(playerId, sessionId, message.userInfo);
						break;

					case 'LEAVE_QUEUE':
						if (playerId) {
							this.removeWaitingPlayer(playerId);
							this.playerToSession.delete(playerId);
						}
						break;

					case 'PLAYER_INPUT':
						if (playerId) {
							this.handlePlayerInput(playerId, message.input);
						}
						break;
				}
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
			}
		});

		webSocket.addEventListener('close', () => {
			this.sessions.delete(sessionId);
			if (playerId) {
				this.handlePlayerDisconnect(playerId);
				this.playerToSession.delete(playerId);
			}
		});

		webSocket.addEventListener('error', (error) => {
			console.error('WebSocket error:', error);
			this.sessions.delete(sessionId);
			if (playerId) {
				this.handlePlayerDisconnect(playerId);
				this.playerToSession.delete(playerId);
			}
		});
	}

	generateSessionId() {
		return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	addWaitingPlayer(playerId, sessionId, userInfo) {
		this.waitingPlayers.set(playerId, { sessionId, userInfo });
		console.log(`Player ${playerId} added to waiting queue. Queue size: ${this.waitingPlayers.size}`);

		this.tryToMatch();
	}

	removeWaitingPlayer(playerId) {
		this.waitingPlayers.delete(playerId);
		console.log(`Player ${playerId} removed from waiting queue`);
	}

	tryToMatch() {
		if (this.waitingPlayers.size >= 2) {
			const players = Array.from(this.waitingPlayers.entries()).slice(0, 2);
			const [player1Id, player1Data] = players[0];
			const [player2Id, player2Data] = players[1];

			this.waitingPlayers.delete(player1Id);
			this.waitingPlayers.delete(player2Id);

			this.createGame(player1Id, player1Data, player2Id, player2Data);
		}
	}

	createGame(player1Id, player1Data, player2Id, player2Data) {
		const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const words = this.generateWords(30); // Reduced to 30 words for better gameplay

		const game = {
			id: gameId,
			player1: {
				id: player1Id,
				sessionId: player1Data.sessionId,
				userInfo: player1Data.userInfo,
				score: 0,
				currentWordIndex: 0,
			},
			player2: {
				id: player2Id,
				sessionId: player2Data.sessionId,
				userInfo: player2Data.userInfo,
				score: 0,
				currentWordIndex: 0,
			},
			words,
			status: 'countdown',
			startTime: null,
			endTime: null,
			gameTimer: null,
		};

		this.activeGames.set(gameId, game);
		this.playerToGame.set(player1Id, gameId);
		this.playerToGame.set(player2Id, gameId);

		// Notify players that match is found
		this.sendToPlayer(player1Data.sessionId, {
			type: 'MATCH_FOUND',
			gameId,
			opponent: {
				username: player2Data.userInfo.username,
				rating: player2Data.userInfo.rating,
			},
		});

		this.sendToPlayer(player2Data.sessionId, {
			type: 'MATCH_FOUND',
			gameId,
			opponent: {
				username: player1Data.userInfo.username,
				rating: player1Data.userInfo.rating,
			},
		});

		this.startCountdown(gameId);
	}

	startCountdown(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		let count = 3;

		// Send initial countdown immediately
		this.sendToPlayers(game, {
			type: 'COUNTDOWN',
			count: count,
		});

		const countdown = setInterval(() => {
			count--;

			if (count > 0) {
				this.sendToPlayers(game, {
					type: 'COUNTDOWN',
					count: count,
				});
			} else {
				// Send GO! message
				this.sendToPlayers(game, {
					type: 'COUNTDOWN',
					count: 0,
				});

				clearInterval(countdown);

				// Start game after a brief delay
				setTimeout(() => {
					this.startGame(gameId);
				}, 500);
			}
		}, 1000);
	}

	startGame(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		game.status = 'playing';
		game.startTime = Date.now();
		game.endTime = game.startTime + 60 * 1000; // 1 minute game

		this.sendToPlayers(game, {
			type: 'GAME_START',
			words: game.words,
			duration: 60000,
			startTime: game.startTime,
		});

		// Set game end timer
		game.gameTimer = setTimeout(() => {
			this.endGame(gameId, 'timeout');
		}, 60000);
	}

	handlePlayerInput(playerId, input) {
		const gameId = this.playerToGame.get(playerId);
		if (!gameId) return;

		const game = this.activeGames.get(gameId);
		if (!game || game.status !== 'playing') return;

		const isPlayer1 = game.player1.id === playerId;
		const player = isPlayer1 ? game.player1 : game.player2;
		const opponent = isPlayer1 ? game.player2 : game.player1;

		const currentWord = game.words[player.currentWordIndex];

		if (input.trim().toLowerCase() === currentWord.toLowerCase()) {
			player.score++;
			player.currentWordIndex++;

			// Send update to both players with CORRECT data
			this.sendToPlayers(game, {
				type: 'PLAYER_PROGRESS',
				player1: {
					id: game.player1.id,
					score: game.player1.score,
					currentWordIndex: game.player1.currentWordIndex,
				},
				player2: {
					id: game.player2.id,
					score: game.player2.score,
					currentWordIndex: game.player2.currentWordIndex,
				},
			});

			// Check if player finished all words or time is up
			if (player.currentWordIndex >= game.words.length) {
				this.endGame(gameId, 'completed');
			}
		} else {
			// Send failed attempt (optional - for feedback)
			this.sendToPlayer(this.playerToSession.get(playerId), {
				type: 'WRONG_WORD',
			});
		}
	}

	endGame(gameId, reason = 'timeout') {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		// Clear the game timer if it exists
		if (game.gameTimer) {
			clearTimeout(game.gameTimer);
		}

		game.status = 'finished';

		// Determine winner based on score, then progress
		let winner = null;
		if (game.player1.score > game.player2.score) {
			winner = 'player1';
		} else if (game.player2.score > game.player1.score) {
			winner = 'player2';
		} else {
			// Same score, check who is further ahead
			if (game.player1.currentWordIndex > game.player2.currentWordIndex) {
				winner = 'player1';
			} else if (game.player2.currentWordIndex > game.player1.currentWordIndex) {
				winner = 'player2';
			}
			// If still tied, it's a draw (winner remains null)
		}

		const player1Won = winner === 'player1';
		const player2Won = winner === 'player2';
		const isDraw = winner === null;

		this.sendToPlayers(game, {
			type: 'GAME_END',
			results: {
				player1: {
					id: game.player1.id,
					username: game.player1.userInfo.username,
					score: game.player1.score,
					progress: game.player1.currentWordIndex,
					won: player1Won,
				},
				player2: {
					id: game.player2.id,
					username: game.player2.userInfo.username,
					score: game.player2.score,
					progress: game.player2.currentWordIndex,
					won: player2Won,
				},
				isDraw,
				reason,
			},
		});

		// Clean up
		this.playerToGame.delete(game.player1.id);
		this.playerToGame.delete(game.player2.id);
		this.activeGames.delete(gameId);
	}

	handlePlayerDisconnect(playerId) {
		this.removeWaitingPlayer(playerId);

		const gameId = this.playerToGame.get(playerId);
		if (gameId) {
			const game = this.activeGames.get(gameId);
			if (game) {
				// Clear game timer
				if (game.gameTimer) {
					clearTimeout(game.gameTimer);
				}

				const isPlayer1 = game.player1.id === playerId;
				const opponent = isPlayer1 ? game.player2 : game.player1;
				const opponentSessionId = opponent.sessionId;

				this.sendToPlayer(opponentSessionId, {
					type: 'OPPONENT_DISCONNECTED',
				});

				this.playerToGame.delete(game.player1.id);
				this.playerToGame.delete(game.player2.id);
				this.activeGames.delete(gameId);
			}
		}
	}

	generateWords(count) {
		const wordList = [
			'cat',
			'dog',
			'run',
			'jump',
			'play',
			'work',
			'home',
			'love',
			'life',
			'time',
			'good',
			'great',
			'best',
			'fast',
			'slow',
			'big',
			'small',
			'new',
			'old',
			'young',
			'red',
			'blue',
			'green',
			'white',
			'black',
			'light',
			'dark',
			'bright',
			'clear',
			'nice',
			'hot',
			'cold',
			'warm',
			'cool',
			'fire',
			'water',
			'earth',
			'wind',
			'tree',
			'rock',
			'book',
			'pen',
			'paper',
			'desk',
			'chair',
			'door',
			'window',
			'wall',
			'floor',
			'roof',
			'car',
			'bike',
			'walk',
			'road',
			'path',
			'way',
			'go',
			'come',
			'see',
			'look',
			'hear',
			'feel',
			'know',
			'think',
			'want',
			'need',
			'have',
			'get',
			'give',
			'take',
			'make',
			'do',
			'say',
			'tell',
			'ask',
			'try',
			'help',
			'find',
			'keep',
			'lose',
		];

		const words = [];
		for (let i = 0; i < count; i++) {
			const randomIndex = Math.floor(Math.random() * wordList.length);
			words.push(wordList[randomIndex]);
		}
		return words;
	}

	sendToPlayer(sessionId, message) {
		const webSocket = this.sessions.get(sessionId);
		if (webSocket && webSocket.readyState === WebSocket.READY_STATE_OPEN) {
			try {
				webSocket.send(JSON.stringify(message));
			} catch (error) {
				console.error('Error sending message:', error);
			}
		}
	}

	sendToPlayers(game, message) {
		this.sendToPlayer(game.player1.sessionId, message);
		this.sendToPlayer(game.player2.sessionId, message);
	}
}
