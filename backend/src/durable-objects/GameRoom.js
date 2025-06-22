export class GameRoom {
	constructor(controller, env) {
		this.controller = controller;
		this.env = env;
		this.sessions = new Map(); // sessionId -> WebSocket
		this.waitingPlayers = new Map(); // playerId -> {sessionId, userInfo}
		this.activeGames = new Map(); // gameId -> game data
		this.playerToGame = new Map(); // playerId -> gameId
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
						this.addWaitingPlayer(playerId, sessionId, message.userInfo);
						break;

					case 'LEAVE_QUEUE':
						if (playerId) {
							this.removeWaitingPlayer(playerId);
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
			}
		});

		webSocket.addEventListener('error', (error) => {
			console.error('WebSocket error:', error);
			this.sessions.delete(sessionId);
			if (playerId) {
				this.handlePlayerDisconnect(playerId);
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
		const words = this.generateWords(50);

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
		const countdown = setInterval(() => {
			this.sendToPlayers(game, {
				type: 'COUNTDOWN',
				count,
			});

			count--;

			if (count < 0) {
				clearInterval(countdown);
				this.startGame(gameId);
			}
		}, 1000);
	}

	startGame(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		game.status = 'playing';
		game.startTime = Date.now();
		game.endTime = game.startTime + 60 * 1000;

		this.sendToPlayers(game, {
			type: 'GAME_START',
			words: game.words,
			duration: 60000,
			startTime: game.startTime,
		});

		setTimeout(() => {
			this.endGame(gameId);
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

			this.sendToPlayers(game, {
				type: 'PLAYER_PROGRESS',
				playerId,
				score: player.score,
				currentWordIndex: player.currentWordIndex,
				opponentScore: opponent.score,
				opponentCurrentWordIndex: opponent.currentWordIndex,
			});

			if (player.currentWordIndex >= game.words.length) {
				this.endGame(gameId);
			}
		}
	}

	endGame(gameId) {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		game.status = 'finished';
		const player1Won = game.player1.score > game.player2.score;
		const player2Won = game.player2.score > game.player1.score;

		this.sendToPlayers(game, {
			type: 'GAME_END',
			results: {
				player1: {
					id: game.player1.id,
					username: game.player1.userInfo.username,
					score: game.player1.score,
					won: player1Won,
				},
				player2: {
					id: game.player2.id,
					username: game.player2.userInfo.username,
					score: game.player2.score,
					won: player2Won,
				},
				isDraw: game.player1.score === game.player2.score,
			},
		});

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
				const opponentSessionId = game.player1.id === playerId ? game.player2.sessionId : game.player1.sessionId;

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
			'the',
			'quick',
			'brown',
			'fox',
			'jumps',
			'over',
			'lazy',
			'dog',
			'hello',
			'world',
			'javascript',
			'python',
			'react',
			'node',
			'server',
			'client',
			'database',
			'api',
			'function',
			'variable',
			'array',
			'object',
			'string',
			'number',
			'boolean',
			'null',
			'undefined',
			'promise',
			'async',
			'await',
			'fetch',
			'response',
			'request',
			'method',
			'class',
			'component',
			'props',
			'state',
			'hook',
			'effect',
			'context',
			'reducer',
			'action',
			'dispatch',
			'store',
			'middleware',
			'router',
			'route',
			'path',
			'query',
			'typing',
			'speed',
			'accuracy',
			'words',
			'minute',
			'test',
			'challenge',
			'practice',
			'keyboard',
			'fingers',
			'position',
			'touch',
			'method',
			'skill',
			'improve',
			'learn',
			'fast',
			'slow',
			'medium',
			'easy',
			'hard',
			'difficult',
			'simple',
			'complex',
			'game',
			'player',
			'opponent',
			'match',
			'score',
			'winner',
			'loser',
			'draw',
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
			webSocket.send(JSON.stringify(message));
		}
	}

	sendToPlayers(game, message) {
		this.sendToPlayer(game.player1.sessionId, message);
		this.sendToPlayer(game.player2.sessionId, message);
	}
}
