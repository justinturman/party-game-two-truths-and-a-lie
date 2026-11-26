import { game, config } from './server.js';

let failures = 0;
const check = (label, ok) => {
  console.log(ok ? 'PASS' : 'FAIL', label);
  if (!ok) failures++;
};
const REJECT = 'INVALID_MOVE';

// A clock we control, so people can arrive, leave and come back without waiting
let clock = 1_700_000_000_000;
Date.now = () => clock;
const advance = (ms) => { clock += ms; };

const random = { Shuffle: (a) => [...a].sort(() => Math.random() - 0.5) };

function newGame() {
  const ctx = { numPlayers: game.maxPlayers, currentPlayer: '0' };
  const G = game.setup({ ctx });
  const g = {
    G,
    play: (name, id, ...args) => game.moves[name].move({ G, ctx, playerID: id, random }, ...args),
    view: (id) => game.playerView({ G, ctx, playerID: id }),
    join: (...ids) => ids.forEach((id) => g.play('here', id)),
    write: (id) => g.play('submit', id, [`truth ${id}a`, `truth ${id}b`, `LIE-${id}`], 2),
    subject: () => G.order[G.currentIndex],
    lie: () => G.submissions[G.order[G.currentIndex]].lieIndex,
    // Everyone here who can guess does so, all correctly
    voteAll: (ids, guess) => ids.forEach((id) => g.play('vote', id, guess ?? g.lie())),
  };
  return g;
}
// A game with these players, all writing and ready to reveal
function revealing(...ids) {
  const g = newGame();
  g.join(...ids);
  g.play('start', ids[0]);
  ids.forEach((id) => g.write(id));
  return g;
}

// ================= A room with no fixed size =================
{
  const g = newGame();
  check('the games never end', game.endIf === undefined);
  check('the room has seats for many but needs nobody in particular', game.maxPlayers === config.seats && g.G.seats.length === config.seats);
  check('a new room waits in the lobby with nobody here', g.G.phase === 'lobby' && g.view(null).here.length === 0 && g.view(null).known.length === 0);
  check('the minimum to play is 2', config.minPlayers === 2 && g.view(null).minPlayers === 2);
}

// ================= Joining and leaving =================
{
  const g = newGame();
  check('a spectator cannot check in', g.play('here', null) === REJECT && g.play('goodbye', null) === REJECT);
  check('a seat that does not exist cannot check in', g.play('here', '99') === REJECT);
  g.join('3');
  check('checking in makes someone present, with a score of 0', g.view(null).here.join() === '3' && g.view(null).scores['3'] === 0);
  g.play('goodbye', '3');
  check('saying goodbye makes someone gone at once, but remembered', g.view(null).here.length === 0 && g.view(null).known.join() === '3');
  g.join('3');
  g.G.scores['3'] = 7;
  advance(config.presenceMs + 1);
  check('someone who goes quiet for a while is gone too', g.view(null).here.length === 0);
  g.join('3');
  check('they keep their score when they come back', g.view(null).here.join() === '3' && g.view(null).scores['3'] === 7);
}

// ================= Starting =================
{
  const g = newGame();
  g.join('0');
  check('one player cannot start', g.view('0').canStart === false && g.play('start', '0') === REJECT);
  g.join('1');
  check('two players can start', g.view('0').canStart === true && g.view(null).canStart === true);
  check('a spectator cannot start', g.play('start', null) === REJECT);
  g.play('start', '1');
  check('a game starts with the players who are here', g.G.phase === 'writing' && g.G.game === 1 && g.G.roster.join() === '0,1');
  check('starting twice is rejected', g.play('start', '0') === REJECT);
}

// ================= Writing =================
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.write('0'); g.write('1');
  check('still writing until everyone here has submitted', g.G.phase === 'writing');
  check('a player cannot submit twice', g.play('submit', '0', ['a', 'b', 'c'], 0) === REJECT);
  check('empty statements are rejected', g.play('submit', '2', ['a', '', 'c'], 0) === REJECT);
  check('over-long statements are rejected', g.play('submit', '2', ['a', 'b', 'x'.repeat(config.maxLen + 1)], 0) === REJECT);
  check('a bad lie index is rejected', g.play('submit', '2', ['a', 'b', 'c'], 3) === REJECT && g.play('submit', '2', ['a', 'b', 'c'], '1') === REJECT);
  check('statements must be a list of three', g.play('submit', '2', ['a', 'b'], 0) === REJECT && g.play('submit', '2', 'abc', 0) === REJECT);
  check('a spectator cannot submit', g.play('submit', null, ['a', 'b', 'c'], 0) === REJECT);
  const seen = ['2', null].map((id) => JSON.stringify(g.view(id))).join('');
  check('nobody sees other players statements while writing', !seen.includes('truth 0a') && !seen.includes('LIE-'));
  check('I can see my own submission', g.view('0').mySubmission.statements.includes('LIE-0') && g.view('2').mySubmission === null);
  check('the TV sees only who has submitted', g.view(null).submittedBy['0'] === true && g.view(null).submittedBy['2'] === false);
  g.write('2');
  check('the reveal starts once everyone has submitted', g.G.phase === 'reveal');
  check('the lie is tracked correctly after shuffling', ['0', '1', '2'].every((id) => {
    const s = g.G.submissions[id];
    return s.statements[s.lieIndex] === `LIE-${id}`;
  }));
}

// ================= People joining and leaving while writing =================
{
  const g = newGame();
  g.join('0', '1');
  g.play('start', '0');
  g.write('0');
  g.join('5'); // a newcomer arrives while writing is still going
  check('a newcomer during writing joins the game', g.G.roster.join() === '0,1,5' && g.view('5').inGame === true);
  g.write('1');
  check('writing waits for the newcomer', g.G.phase === 'writing');
  g.write('5');
  check('and then everyone is in the reveal', g.G.phase === 'reveal' && g.G.order.length === 3);
}
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.write('0'); g.write('1');
  g.play('goodbye', '2');
  check('someone who leaves before writing does not hold things up', g.G.phase === 'reveal' && g.G.order.length === 2 && !g.G.order.includes('2'));
}
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.write('0'); g.write('1');
  advance(config.presenceMs + 1);
  g.join('0', '1');
  check('someone who goes quiet does not hold things up either', g.G.phase === 'reveal');
}
{
  const g = newGame();
  g.join('0', '1', '2', '3');
  g.play('start', '0');
  g.write('0');
  check('no early start with one submission', g.view('0').canBegin === false && g.play('begin', '0') === REJECT);
  g.write('1');
  check('early start is offered to submitters once half have submitted', g.view('0').canBegin === true && g.view('2').canBegin === false);
  check('someone who has not submitted cannot start early', g.play('begin', '2') === REJECT);
  g.play('begin', '0');
  check('a submitter can start early, without the others', g.G.phase === 'reveal' && g.G.order.length === 2);
}

// ================= Voting and the reveal =================
{
  const g = revealing('0', '1', '2');
  const subject = g.subject();
  const others = ['0', '1', '2'].filter((id) => id !== subject);
  const lie = g.lie();
  const tv = g.view(null);
  check('the lie is hidden before the reveal', tv.subs[subject].lieIndex === null && tv.counts === null);
  check('only the current subject is sent', Object.keys(tv.subs).join() === subject);
  check('the subject cannot vote', g.play('vote', subject, 0) === REJECT);
  check('a bad vote is rejected', g.play('vote', others[0], 7) === REJECT && g.play('vote', others[0], '1') === REJECT);
  check('reveal-now needs at least one vote', g.play('revealNow', subject) === REJECT);
  g.play('vote', others[0], lie);
  check('a player cannot vote twice', g.play('vote', others[0], 0) === REJECT);
  check('only the subject can reveal early while they are here', g.play('revealNow', others[1]) === REJECT);
  check('the TV sees how many voted, not the tally', g.view(null).votedCount === 1 && g.view(null).counts === null && g.view(null).votersNeeded === 2);
  check('nobody sees who voted for what', !JSON.stringify(g.view(others[1])).includes('"votes"'));
  check('a vote is visible only to the voter', g.view(others[0]).myVote === lie && g.view(others[1]).myVote === null);
  g.play('vote', others[1], (lie + 1) % 3);
  check('the reveal happens by itself after the last vote', g.G.revealed === true);
  check('scores: the right guesser and the fooled subject get a point',
    g.G.scores[others[0]] === 1 && g.G.scores[others[1]] === 0 && g.G.scores[subject] === 1);
  check('the lie is shown after the reveal', g.view(null).subs[subject].lieIndex === lie && g.view(null).counts[lie] === 1);
  check('the TV and phones can see the tally', g.view(null).counts.reduce((a, b) => a + b) === 2);
  check('nobody can vote after the reveal', g.play('vote', others[0], 0) === REJECT);
  check('only the subject can continue while they are here', g.play('next', others[0], 0) === REJECT && g.view(others[0]).canNext === false && g.view(subject).canNext === true);
  check('the wrong index is rejected', g.play('next', subject, 5) === REJECT);
  g.play('next', subject, 0);
  check('the next player is up', g.G.currentIndex === 1 && g.G.revealed === false && g.subject() !== subject);
  check('a repeated "next" for the old player is ignored', g.play('next', subject, 0) === REJECT);
}

// ---- The subject can reveal early ----
{
  const g = revealing('0', '1', '2');
  const subject = g.subject();
  const voter = ['0', '1', '2'].find((id) => id !== subject);
  g.play('vote', voter, g.lie());
  g.play('revealNow', subject);
  check('the subject can reveal early once someone has voted', g.G.revealed === true && g.G.scores[voter] === 1);
}

// ---- People coming and going while guessing ----
{
  const g = revealing('0', '1');
  g.join('7'); // arrives during the reveals
  const subject = g.subject();
  const other = ['0', '1'].find((id) => id !== subject);
  check('a latecomer can guess along', g.view('7').inGame === false && g.view('7').votersNeeded === 2);
  g.play('vote', other, g.lie());
  check('the reveal waits for a latecomer who is here', g.G.revealed === false);
  g.play('vote', '7', g.lie());
  check('then they count', g.G.revealed === true && g.G.scores['7'] === 1 && g.G.scores[other] === 1);
}
{
  const g = revealing('0', '1', '2');
  const subject = g.subject();
  const [a, b] = ['0', '1', '2'].filter((id) => id !== subject);
  g.play('vote', a, g.lie());
  g.play('goodbye', b);
  check('a voter who leaves does not hold up the reveal', g.G.revealed === true && g.G.scores[a] === 1);
}
{
  const g = revealing('0', '1', '2');
  const subject = g.subject();
  const [a, b] = ['0', '1', '2'].filter((id) => id !== subject);
  g.play('vote', a, g.lie());
  g.play('vote', b, g.lie());
  g.play('goodbye', a);
  check('a vote from someone who then left still counts', g.G.revealed === true && g.G.scores[a] === 1 && g.G.scores[b] === 1);
}
{
  const g = revealing('0', '1', '2');
  const subject = g.subject();
  const [a, b] = ['0', '1', '2'].filter((id) => id !== subject);
  g.play('vote', a, g.lie());
  g.play('goodbye', subject);
  check('the subject leaving does not stop the voting', g.G.revealed === false && g.G.phase === 'reveal');
  check('a voter can reveal early when the subject has gone', g.view(a).canReveal === true && g.view(b).canReveal === false);
  check('someone who has not voted cannot', g.play('revealNow', b) === REJECT);
  g.play('revealNow', a);
  check('the reveal happens without the subject', g.G.revealed === true);
  check('anyone can move on when the subject has gone', g.view(b).canNext === true && g.play('next', b, 0) !== REJECT && g.G.currentIndex === 1);
}
{
  const g = revealing('0', '1', '2');
  const subject = g.subject();
  const others = ['0', '1', '2'].filter((id) => id !== subject);
  g.voteAll(others);
  check('the subject is still here right after the reveal', g.view(others[0]).canNext === false);
  advance(config.presenceMs + 1); // the subject's phone has gone to sleep while they waited
  g.join(...others);
  check('a subject whose phone fell asleep can be skipped past', g.view(others[0]).canNext === true && g.view(subject).canNext === true);
  g.play('next', others[0], 0);
  check('and the game carries on', g.G.currentIndex === 1);
}

// ================= Pausing and cancelling =================
{
  const g = revealing('0', '1');
  advance(config.presenceMs + 1);
  g.join('0'); // 1 has gone quiet
  check('with too few players the game pauses instead of ending', g.G.phase === 'reveal' && g.view('0').paused === true && g.view(null).paused === true);
  g.join('1');
  check('it carries on when they return', g.G.phase === 'reveal' && g.view('0').paused === false);
  advance(config.presenceMs + 1);
  g.join('0');
  advance(config.cancelAfterMs + 1);
  g.join('0');
  check('if they stay away for long, the game is cancelled', g.G.phase === 'lobby' && /cancelled/.test(g.view(null).notice) && g.G.order.length === 0);
  check('scores are kept', g.view(null).known.join() === '0,1');
  g.join('1');
  g.play('start', '1');
  check('and a new game can start when enough are back', g.G.phase === 'writing' && g.G.game === 2 && g.G.submissions['0'] === undefined);
}

// ================= Results and the next game =================
{
  const g = revealing('0', '1', '2');
  for (let i = 0; i < 3; i++) {
    const subject = g.subject();
    const others = ['0', '1', '2'].filter((id) => id !== subject);
    g.voteAll(others, i === 0 ? g.lie() : (g.lie() + 1) % 3); // the first lie is spotted, the others fool everyone
    g.play('next', subject, i);
  }
  check('after everyone has had a turn, the results are shown', g.G.phase === 'summary');
  const v = g.view(null);
  check('the recap lists every lie, with how many spotted it', v.recap.length === 3 && v.recap.every((r) => r.lie.startsWith('LIE-')) && v.recap[0].spotted === 2 && v.recap[0].fooled === 0 && v.recap[1].fooled === 2);
  const total = Object.values(g.G.gameScores).reduce((a, b) => a + b, 0);
  check('the game winner has the most points this game', v.winners.length >= 1 && v.winners.every((id) => g.G.gameScores[id] === Math.max(...Object.values(g.G.gameScores))) && total === 6);
  check('statements are not sent after their turn', !JSON.stringify(v).includes('truth 0a'));
  check('a spectator cannot start the next game', g.play('start', null) === REJECT);
  const before = { ...g.G.scores };
  g.join('1'); g.join('0', '2');
  g.play('start', '2');
  check('anyone can start the next game', g.G.phase === 'writing' && g.G.game === 2);
  check('the next game starts fresh', Object.keys(g.G.submissions).length === 0 && g.G.recap.length === 0 && g.G.order.length === 0 && g.G.winners.length === 0);
  check('this-game points reset but the running totals carry on', Object.values(g.G.gameScores).every((n) => n === 0) && ['0', '1', '2'].every((id) => g.G.scores[id] === before[id]));
}
{
  // Nobody fooled and nobody fooled by anyone: nobody wins the game outright
  const g = revealing('0', '1');
  for (let i = 0; i < 2; i++) { const s = g.subject(); g.voteAll(['0', '1'].filter((id) => id !== s), (g.lie() + 1) % 3); g.play('next', s, i); }
  check('a game where everyone was fooled gives points to the liars', g.G.phase === 'summary' && g.view(null).winners.length === 2);
}

// ================= The games never run out =================
{
  const g = newGame();
  g.join('0', '1', '2');
  let still = true;
  for (let n = 1; n <= 40; n++) {
    g.play('start', '0');
    if (g.G.phase !== 'writing' || g.G.game !== n) still = false;
    ['0', '1', '2'].forEach((id) => g.write(id));
    for (let i = 0; i < 3; i++) {
      const s = g.subject();
      g.voteAll(['0', '1', '2'].filter((id) => id !== s));
      g.play('next', s, i);
    }
    if (g.G.phase !== 'summary') still = false;
  }
  check('40 games in a row, and the room is still going', still && g.G.game === 40);
  check('the running totals add up over all the games', Object.values(g.G.scores).reduce((a, b) => a + b, 0) === 40 * 6);
}

// ================= A full room =================
{
  const g = newGame();
  const everyone = Array.from({ length: config.seats }, (_, i) => String(i));
  g.join(...everyone);
  g.play('start', '0');
  everyone.forEach((id) => g.write(id));
  check('with every seat full, everyone is in the reveal', g.G.phase === 'reveal' && g.G.order.length === config.seats);
  const s = g.subject();
  g.voteAll(everyone.filter((id) => id !== s));
  check('a full room finishes a reveal', g.G.revealed === true && g.view(null).counts[g.lie()] === config.seats - 1);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);