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
		return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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
		const gameId = `game_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
		const words = this.generateWords(30); 

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
		game.endTime = game.startTime + 60 * 1000;

		this.sendToPlayers(game, {
			type: 'GAME_START',
			words: game.words,
			duration: 60000,
			startTime: game.startTime,
		});

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

			if (player.currentWordIndex >= game.words.length) {
				this.endGame(gameId, 'completed');
			}
		} else {
			this.sendToPlayer(this.playerToSession.get(playerId), {
				type: 'WRONG_WORD',
			});
		}
	}

	endGame(gameId, reason = 'timeout') {
		const game = this.activeGames.get(gameId);
		if (!game) return;

		if (game.gameTimer) {
			clearTimeout(game.gameTimer);
		}

		game.status = 'finished';

		let winner = null;
		if (game.player1.score > game.player2.score) {
			winner = 'player1';
		} else if (game.player2.score > game.player1.score) {
			winner = 'player2';
		} else {
			if (game.player1.currentWordIndex > game.player2.currentWordIndex) {
				winner = 'player1';
			} else if (game.player2.currentWordIndex > game.player1.currentWordIndex) {
				winner = 'player2';
			}
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
		const shortWords = [
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
			'hand',
			'head',
			'eye',
			'face',
			'place',
			'right',
			'left',
			'high',
			'low',
			'here',
			'there',
			'where',
			'when',
			'what',
			'who',
			'why',
			'how',
			'all',
			'any',
			'each',
			'every',
			'some',
			'many',
			'few',
			'more',
			'most',
			'other',
			'such',
			'no',
			'nor',
			'not',
			'only',
			'own',
			'same',
			'so',
			'than',
			'too',
			'very',
			'can',
			'will',
			'just',
			'should',
			'now',
		];

		const mediumWords = [
			'window',
			'bright',
			'clear',
			'strong',
			'happy',
			'simple',
			'quiet',
			'quick',
			'smooth',
			'rough',
			'sharp',
			'soft',
			'hard',
			'empty',
			'full',
			'open',
			'close',
			'start',
			'begin',
			'finish',
			'end',
			'middle',
			'center',
			'around',
			'between',
			'during',
			'before',
			'after',
			'above',
			'below',
			'under',
			'over',
			'inside',
			'outside',
			'beside',
			'behind',
			'front',
			'back',
			'near',
			'far',
			'close',
			'public',
			'private',
			'secret',
			'hidden',
			'visible',
			'clear',
			'dark',
			'bright',
			'morning',
			'evening',
			'night',
			'today',
			'tomorrow',
			'yesterday',
			'week',
			'month',
			'year',
			'season',
			'spring',
			'summer',
			'autumn',
			'winter',
			'weather',
			'sunny',
			'cloudy',
			'rainy',
			'snowy',
			'windy',
			'stormy',
			'peaceful',
			'busy',
			'active',
			'quiet',
			'noisy',
			'silent',
			'loud',
			'soft',
			'gentle',
			'rough',
			'smooth',
		];

		const longWords = [
			'beautiful',
			'wonderful',
			'amazing',
			'incredible',
			'fantastic',
			'excellent',
			'outstanding',
			'remarkable',
			'extraordinary',
			'magnificent',
			'spectacular',
			'impressive',
			'brilliant',
			'marvelous',
			'splendid',
			'superb',
			'terrific',
			'tremendous',
			'phenomenal',
			'exceptional',
			'breathtaking',
			'stunning',
			'captivating',
			'enchanting',
			'fascinating',
			'intriguing',
			'mysterious',
			'adventure',
			'challenge',
			'opportunity',
			'experience',
			'knowledge',
			'understanding',
			'intelligence',
			'creativity',
			'imagination',
			'inspiration',
			'motivation',
			'determination',
			'perseverance',
			'achievement',
			'accomplishment',
			'development',
			'improvement',
			'progress',
			'advancement',
			'innovation',
			'technology',
			'information',
			'communication',
			'transportation',
			'education',
			'entertainment',
			'celebration',
			'organization',
			'relationship',
			'friendship',
			'partnership',
			'leadership',
			'membership',
			'scholarship',
			'championship',
			'performance',
			'appearance',
			'disappearance',
			'independence',
			'dependence',
			'confidence',
			'difference',
			'preference',
			'reference',
			'interference',
		];

		const challengingWords = [
			'psychology',
			'philosophy',
			'mathematics',
			'architecture',
			'engineering',
			'photography',
			'biography',
			'geography',
			'democracy',
			'vocabulary',
			'laboratory',
			'observatory',
			'contemporary',
			'revolutionary',
			'evolutionary',
			'extraordinary',
			'constitutional',
			'international',
			'environmental',
			'experimental',
			'fundamental',
			'instrumental',
			'governmental',
			'developmental',
			'educational',
			'professional',
			'traditional',
			'additional',
			'conditional',
			'exceptional',
			'operational',
			'functional',
			'emotional',
			'rational',
			'national',
			'regional',
			'personal',
			'universal',
			'commercial',
			'financial',
			'technical',
			'practical',
			'magical',
			'logical',
			'physical',
			'chemical',
			'medical',
			'political',
			'critical',
			'typical',
		];

		const allWords = [
			...shortWords, 
			...mediumWords, 
			...longWords, 
			...challengingWords, 
		];

		if (count > allWords.length) {
			count = allWords.length;
		}
		const shuffled = [...allWords].sort(() => Math.random() - 0.5);

		const selectedWords = shuffled.slice(0, count);

		return selectedWords.sort(() => Math.random() - 0.5);
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
