const INVALID_MOVE = 'INVALID_MOVE';

export const config = {
  minPlayers: 2, // needed to start a game, and to keep one going
  seats: 20, // the most phones in one room at the same time
  maxLen: 200, // longest statement
  presenceMs: 45000, // someone not heard from for this long counts as gone
  cancelAfterMs: 90000, // a game with too few players left is paused, and only cancelled after this long
};

// Flow of the room (it never ends):
//   lobby    - waiting for enough players
//   writing  - everyone here writes 3 statements and marks the lie; latecomers can join in
//   reveal   - one player at a time: the others vote, then the lie is revealed
//   summary  - the results of this game; anyone can start the next one

// ---------------------------------------------------------------------------------
// WHO IS HERE?
// The platform lets people join and leave whenever, but the rules never hear about it.
// So every phone sends an "I'm here" move every few seconds, and says goodbye when the
// player taps Leave. Anyone not heard from recently counts as gone. Seats are fixed;
// people are not.
// ---------------------------------------------------------------------------------
const isSeat = (G, id) => typeof id === 'string' && G.seats.includes(id);
const isHere = (G, id, now = Date.now()) => G.seen[id] !== undefined && now - G.seen[id] <= config.presenceMs;
const hereNow = (G, now = Date.now()) => G.seats.filter((id) => isHere(G, id, now));

function touch(G, id) {
  G.seen[id] = Date.now();
  if (G.scores[id] === undefined) G.scores[id] = 0; // a newcomer starts on zero...
  if (G.gameScores[id] === undefined) G.gameScores[id] = 0; // ...and keeps their points if they come back
}

// ---------------------------------------------------------------------------------
// GAMES
// ---------------------------------------------------------------------------------
function toLobby(G, notice) {
  G.phase = 'lobby';
  G.roster = [];
  G.submissions = {};
  G.order = [];
  G.currentIndex = 0;
  G.revealed = false;
  G.votes = {};
  G.recap = [];
  G.winners = [];
  G.lowSince = null;
  G.notice = notice || null;
}

// Everyone who is here right now can write; anyone who arrives while writing is still going joins in
function startWriting(G) {
  G.game += 1;
  G.roster = hereNow(G);
  G.submissions = {};
  G.order = [];
  G.currentIndex = 0;
  G.revealed = false;
  G.votes = {};
  G.recap = [];
  G.winners = [];
  for (const id of Object.keys(G.scores)) G.gameScores[id] = 0;
  G.lowSince = null;
  G.notice = null;
  G.phase = 'writing';
}

function startReveal(G, random) {
  G.order = random.Shuffle(Object.keys(G.submissions));
  G.currentIndex = 0;
  G.revealed = false;
  G.votes = { [G.order[0]]: {} };
  G.recap = [];
  G.lowSince = null;
  G.phase = 'reveal';
}

// Scores the current subject: +1 for each player who spotted the lie,
// and the subject gets +1 for each player they fooled.
function revealSubject(G) {
  const subject = G.order[G.currentIndex];
  const sub = G.submissions[subject];
  const votes = G.votes[subject];
  const voters = Object.keys(votes);
  const right = voters.filter((v) => votes[v] === sub.lieIndex);
  const wrong = voters.length - right.length;
  for (const v of right) {
    G.scores[v] += 1;
    G.gameScores[v] += 1;
  }
  G.scores[subject] += wrong;
  G.gameScores[subject] += wrong;
  G.recap.push({ who: subject, lie: sub.statements[sub.lieIndex], spotted: right.length, fooled: wrong });
  G.revealed = true;
}

function advance(G) {
  G.currentIndex += 1;
  G.revealed = false;
  if (G.currentIndex >= G.order.length) {
    const ids = Object.keys(G.gameScores);
    const best = Math.max(0, ...ids.map((id) => G.gameScores[id]));
    G.winners = best > 0 ? ids.filter((id) => G.gameScores[id] === best) : [];
    G.phase = 'summary';
    return;
  }
  G.votes[G.order[G.currentIndex]] = {};
}

// Runs after anything that could change who is here, who has written or who has voted
function settle(G, random) {
  const here = hereNow(G);

  if (G.phase === 'writing' || G.phase === 'reveal') {
    if (here.length < config.minPlayers) {
      // Nobody is dropped at the first sign of trouble: phones fall asleep and people pop out for
      // a minute. The game just waits, and is only cancelled if it stays that way.
      if (G.lowSince === null) G.lowSince = Date.now();
      else if (Date.now() - G.lowSince > config.cancelAfterMs) {
        toLobby(G, 'Too many players left, so that game was cancelled. Scores so far were kept.');
      }
      return;
    }
    G.lowSince = null;
  }

  if (G.phase === 'writing') {
    for (const id of here) if (!G.roster.includes(id)) G.roster.push(id); // anyone here can write
    const stillWriting = here.filter((id) => !G.submissions[id]);
    if (!stillWriting.length && Object.keys(G.submissions).length >= 2) startReveal(G, random);
    return;
  }

  if (G.phase === 'reveal' && !G.revealed) {
    const subject = G.order[G.currentIndex];
    const votes = G.votes[subject];
    // Votes are in from everyone who is here (people who left do not hold things up)
    if (Object.keys(votes).length >= 1 && here.filter((id) => id !== subject).every((id) => votes[id] !== undefined)) {
      revealSubject(G);
    }
  }
}

export const game = {
  name: 'two-truths',
  // The platform makes one room with this many seats. Nobody has to fill them: the real
  // player count is whoever is here, and it can change at any time.
  minPlayers: config.seats,
  maxPlayers: config.seats,

  // Everyone acts at the same time (writing, voting).
  // Without this, boardgame.io only lets player 0 make moves.
  turn: { activePlayers: { all: null } },

  setup: ({ ctx }) => ({
    phase: 'lobby',
    seats: Array.from({ length: ctx.numPlayers }, (_, i) => String(i)),
    seen: {}, // seat id -> when we last heard from that phone (never sent to anyone)
    scores: {}, // running totals over every game, only for players who have joined
    gameScores: {}, // points in the game being played now
    game: 0,
    roster: [], // who is writing this game
    submissions: {}, // id -> { statements: [3, shuffled], lieIndex }
    order: [], // reveal order, set when writing ends
    currentIndex: 0,
    revealed: false,
    votes: {}, // subject id -> { voter id: guessed index }
    recap: [], // one entry per revealed subject this game
    winners: [],
    lowSince: null,
    notice: null,
  }),

  moves: {
    // "I'm here": sent by every phone every few seconds
    here: {
      client: false,
      move: ({ G, playerID, random }) => {
        if (!isSeat(G, playerID)) return INVALID_MOVE;
        touch(G, playerID);
        settle(G, random);
      },
    },

    // Sent when a player taps Leave, so nobody waits for them
    goodbye: {
      client: false,
      move: ({ G, playerID, random }) => {
        if (!isSeat(G, playerID)) return INVALID_MOVE;
        G.seen[playerID] = 0;
        settle(G, random);
      },
    },

    // Start a game (from the lobby) or the next game (after the results)
    start: {
      client: false,
      move: ({ G, playerID }) => {
        if ((G.phase !== 'lobby' && G.phase !== 'summary') || !isSeat(G, playerID)) return INVALID_MOVE;
        touch(G, playerID);
        if (hereNow(G).length < config.minPlayers) return INVALID_MOVE;
        startWriting(G);
      },
    },

    // Statements and the lie are private until it is that player's turn to be revealed
    submit: {
      client: false,
      move: ({ G, playerID, random }, statements, lieIndex) => {
        if (G.phase !== 'writing' || !isSeat(G, playerID)) return INVALID_MOVE;
        if (G.submissions[playerID]) return INVALID_MOVE;
        if (!Array.isArray(statements) || statements.length !== 3) return INVALID_MOVE;
        if (!Number.isInteger(lieIndex) || lieIndex < 0 || lieIndex > 2) return INVALID_MOVE;
        const clean = statements.map((s) => (typeof s === 'string' ? s.trim() : ''));
        if (clean.some((s) => !s || s.length > config.maxLen)) return INVALID_MOVE;

        touch(G, playerID);
        // Shuffle so the position of the lie gives nothing away
        const shuffled = random.Shuffle(clean.map((text, i) => ({ text, lie: i === lieIndex })));
        G.submissions[playerID] = {
          statements: shuffled.map((x) => x.text),
          lieIndex: shuffled.findIndex((x) => x.lie),
        };
        if (!G.roster.includes(playerID)) G.roster.push(playerID);
        settle(G, random);
      },
    },

    // Fallback for someone who is here but not finishing: once at least half of the players here
    // have submitted (and at least two), someone who has submitted can start the reveal.
    begin: {
      client: false,
      move: ({ G, playerID, random }) => {
        if (G.phase !== 'writing' || !G.submissions[playerID]) return INVALID_MOVE;
        const n = Object.keys(G.submissions).length;
        if (n < 2 || n * 2 < hereNow(G).length) return INVALID_MOVE;
        touch(G, playerID);
        startReveal(G, random);
      },
    },

    // Anyone here can guess, even someone who arrived after the writing ended
    vote: {
      client: false,
      move: ({ G, playerID, random }, guess) => {
        if (G.phase !== 'reveal' || G.revealed || !isSeat(G, playerID)) return INVALID_MOVE;
        const subject = G.order[G.currentIndex];
        if (playerID === subject) return INVALID_MOVE; // no voting on yourself
        if (!Number.isInteger(guess) || guess < 0 || guess > 2) return INVALID_MOVE;
        const votes = G.votes[subject];
        if (votes[playerID] !== undefined) return INVALID_MOVE; // one vote each
        touch(G, playerID);
        votes[playerID] = guess;
        settle(G, random);
      },
    },

    // The subject can reveal early (needs one vote). If the subject has gone, a voter can.
    revealNow: {
      client: false,
      move: ({ G, playerID }) => {
        if (G.phase !== 'reveal' || G.revealed || !isSeat(G, playerID)) return INVALID_MOVE;
        const subject = G.order[G.currentIndex];
        const votes = G.votes[subject];
        if (Object.keys(votes).length === 0) return INVALID_MOVE;
        if (playerID !== subject && (isHere(G, subject) || votes[playerID] === undefined)) return INVALID_MOVE;
        touch(G, playerID);
        revealSubject(G);
      },
    },

    // After the reveal, the subject moves things along (or anyone, if they have gone).
    // The index stops a late second tap skipping a player.
    next: {
      client: false,
      move: ({ G, playerID }, index) => {
        if (G.phase !== 'reveal' || !G.revealed || !isSeat(G, playerID)) return INVALID_MOVE;
        if (index !== G.currentIndex) return INVALID_MOVE;
        const subject = G.order[G.currentIndex];
        if (playerID !== subject && isHere(G, subject)) return INVALID_MOVE;
        touch(G, playerID);
        advance(G);
      },
    },
  },

  // THE PRIVACY RULES:
  //  - a player's statements are sent only once it is their turn
  //  - the lie is sent only once it has been revealed
  //  - votes are never sent, only how many people have voted (the tally comes after the reveal)
  //  - a player's own statements go only to them until then
  playerView: ({ G, playerID }) => {
    const seat = isSeat(G, playerID);
    const here = hereNow(G);
    const subject = G.phase === 'reveal' ? G.order[G.currentIndex] : null;

    let subs = {};
    let votedCount = 0;
    let counts = null;
    let myVote = null;
    if (subject) {
      const sub = G.submissions[subject];
      subs[subject] = { statements: sub.statements, lieIndex: G.revealed ? sub.lieIndex : null };
      const votes = G.votes[subject];
      votedCount = Object.keys(votes).length;
      if (G.revealed) {
        counts = [0, 0, 0];
        for (const v of Object.values(votes)) counts[v] += 1;
      }
      if (seat && votes[playerID] !== undefined) myVote = votes[playerID];
    }

    const submittedBy = {};
    for (const id of G.roster) submittedBy[id] = !!G.submissions[id];
    const submittedCount = Object.keys(G.submissions).length;
    const subjectHere = subject !== null && here.includes(subject);
    const mine = seat ? G.submissions[playerID] || null : null;

    return {
      phase: G.phase,
      game: G.game,
      minPlayers: config.minPlayers,
      role: seat ? 'player' : 'spectator',
      known: Object.keys(G.scores), // everyone who has joined at some point
      here, // everyone who is here right now
      roster: G.roster, // who is writing this game
      submittedBy, // true/false only, never the text
      mySubmission: mine,
      inGame: seat && G.roster.includes(playerID),
      subject,
      subs,
      revealed: G.revealed,
      votedCount,
      votersNeeded: subject ? here.filter((id) => id !== subject).length : 0,
      counts,
      myVote,
      currentIndex: G.currentIndex,
      total: G.order.length,
      scores: G.scores,
      gameScores: G.gameScores,
      recap: G.recap,
      winners: G.winners,
      notice: G.notice,
      paused: (G.phase === 'writing' || G.phase === 'reveal') && G.lowSince !== null,
      canStart: (G.phase === 'lobby' || G.phase === 'summary') && here.length >= config.minPlayers,
      canBegin: seat && G.phase === 'writing' && !!mine && submittedCount >= 2 && submittedCount * 2 >= here.length,
      canReveal:
        seat && G.phase === 'reveal' && !G.revealed && votedCount >= 1 &&
        (playerID === subject || (!subjectHere && myVote !== null)),
      canNext: seat && G.phase === 'reveal' && G.revealed && (playerID === subject || !subjectHere),
    };
  },
};