const INVALID_MOVE = 'INVALID_MOVE';

const MAX_LEN = 200;

// Flow of a game:
//   writing  - every player submits 3 statements and marks the lie, in one move
//   reveal   - one player at a time: the others vote, then the lie is revealed
//   gameover - final scores

function startReveal(G, random) {
  G.phase = 'reveal';
  G.order = random.Shuffle([...G.players]);
  G.currentIndex = 0;
  G.revealed = false;
  for (const id of G.order) G.votes[id] = {};
  G.log.push({ type: 'phase', phase: 'reveal' });
}

// Scores the current subject: +1 for each player who spotted the lie,
// and the subject gets +1 for each player they fooled.
function reveal(G) {
  const subject = G.order[G.currentIndex];
  const lie = G.submissions[subject].lieIndex;
  const votes = G.votes[subject];
  const voters = Object.keys(votes);
  const right = voters.filter((v) => votes[v] === lie);
  const wrong = voters.length - right.length;
  for (const v of right) G.scores[v] += 1;
  G.scores[subject] += wrong;
  G.log.push({ type: 'reveal', subject, correct: right.length, wrong });
  G.revealed = true;
}

export const game = {
  name: 'two-truths',
  minPlayers: 3,
  maxPlayers: 10,

  // Everyone acts at the same time (writing, voting).
  // Without this, boardgame.io only lets player 0 make moves.
  turn: { activePlayers: { all: null } },

  setup: ({ ctx }) => {
    const players = Array.from({ length: ctx.numPlayers }, (_, i) => String(i));
    const scores = {};
    for (const id of players) scores[id] = 0;
    return {
      phase: 'writing',
      players, // who is playing (a future "remove player" feature would edit this)
      submissions: {}, // id -> { statements: [3, shuffled], lieIndex }
      order: [], // reveal order, set when writing ends
      currentIndex: 0,
      revealed: false,
      votes: {}, // subject id -> { voter id: guessed index }
      scores,
      log: [],
    };
  },

  moves: {
    // Statements and the lie are private until it is that player's turn to be revealed
    submit: {
      client: false,
      move: ({ G, playerID, random }, statements, lieIndex) => {
        if (G.phase !== 'writing') return INVALID_MOVE;
        if (G.submissions[playerID]) return INVALID_MOVE;
        if (!Array.isArray(statements) || statements.length !== 3) return INVALID_MOVE;
        if (!Number.isInteger(lieIndex) || lieIndex < 0 || lieIndex > 2) return INVALID_MOVE;
        const clean = statements.map((s) => (typeof s === 'string' ? s.trim() : ''));
        if (clean.some((s) => !s || s.length > MAX_LEN)) return INVALID_MOVE;

        // Shuffle so the position of the lie gives nothing away
        const shuffled = random.Shuffle(clean.map((text, i) => ({ text, lie: i === lieIndex })));
        G.submissions[playerID] = {
          statements: shuffled.map((x) => x.text),
          lieIndex: shuffled.findIndex((x) => x.lie),
        };
        if (G.players.every((id) => G.submissions[id])) startReveal(G, random);
      },
    },

    vote: {
      client: false,
      move: ({ G, playerID }, guess) => {
        if (G.phase !== 'reveal' || G.revealed) return INVALID_MOVE;
        const subject = G.order[G.currentIndex];
        if (playerID === subject) return INVALID_MOVE; // no voting on yourself
        if (!Number.isInteger(guess) || guess < 0 || guess > 2) return INVALID_MOVE;
        const votes = G.votes[subject];
        if (votes[playerID] !== undefined) return INVALID_MOVE; // one vote each
        votes[playerID] = guess;
        // When everyone who can vote has voted, reveal straight away
        if (G.players.filter((id) => id !== subject).every((id) => votes[id] !== undefined)) {
          reveal(G);
        }
      },
    },

    // Fallback if someone is slow or gone: the subject can reveal early (needs one vote)
    revealNow: {
      client: false,
      move: ({ G, playerID }) => {
        if (G.phase !== 'reveal' || G.revealed) return INVALID_MOVE;
        const subject = G.order[G.currentIndex];
        if (playerID !== subject) return INVALID_MOVE;
        if (Object.keys(G.votes[subject]).length === 0) return INVALID_MOVE;
        reveal(G);
      },
    },

    // After the reveal, the subject moves things along
    next: {
      client: false,
      move: ({ G, playerID }) => {
        if (G.phase !== 'reveal' || !G.revealed) return INVALID_MOVE;
        if (playerID !== G.order[G.currentIndex]) return INVALID_MOVE;
        G.currentIndex += 1;
        G.revealed = false;
        if (G.currentIndex >= G.order.length) {
          G.phase = 'gameover';
          G.log.push({ type: 'gameover' });
        }
      },
    },
  },

  // THE PRIVACY RULES:
  //  - a player's statements are sent only once it is their turn (or later)
  //  - the lie is sent only once it has been revealed
  //  - votes are never sent, only how many people have voted (the tally comes after the reveal)
  playerView: ({ G, playerID }) => {
    const isPlayer = playerID !== null && playerID !== undefined;
    const subject = G.phase === 'reveal' ? G.order[G.currentIndex] : null;

    const subs = {};
    G.order.forEach((id, i) => {
      if (i > G.currentIndex) return; // their turn hasn't come yet
      const sub = G.submissions[id];
      const lieKnown = i < G.currentIndex || (i === G.currentIndex && G.revealed);
      subs[id] = { statements: sub.statements, lieIndex: lieKnown ? sub.lieIndex : null };
    });

    let votedCount = 0;
    let counts = null;
    let myVote = null;
    if (subject) {
      const votes = G.votes[subject];
      votedCount = Object.keys(votes).length;
      if (G.revealed) {
        counts = [0, 0, 0];
        for (const v of Object.values(votes)) counts[v] += 1;
      }
      if (isPlayer && votes[playerID] !== undefined) myVote = votes[playerID];
    }

    const submittedBy = {};
    for (const id of G.players) submittedBy[id] = !!G.submissions[id];

    return {
      phase: G.phase,
      players: G.players,
      submittedBy, // true/false only, never the text
      subject,
      subs,
      revealed: G.revealed,
      votedCount,
      votersNeeded: G.players.length - 1,
      counts,
      myVote,
      mySubmission: isPlayer ? G.submissions[playerID] || null : null,
      currentIndex: G.currentIndex,
      total: G.order.length,
      scores: G.scores,
      log: G.log,
    };
  },

  endIf: ({ G }) => {
    if (G.phase !== 'gameover') return;
    const best = Math.max(...Object.values(G.scores));
    return { winners: G.players.filter((id) => G.scores[id] === best) };
  },
};