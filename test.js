import { game } from './server.js';

let failures = 0;
const check = (label, ok) => {
  console.log(ok ? 'PASS' : 'FAIL', label);
  if (!ok) failures++;
};

const random = { Shuffle: (a) => [...a].sort(() => Math.random() - 0.5) };

function newGame(n = 3) {
  const ctx = { numPlayers: n, currentPlayer: '0' };
  const G = game.setup({ ctx });
  return {
    G,
    play: (name, playerID, ...args) =>
      game.moves[name].move({ G, ctx, playerID, random }, ...args),
    view: (playerID) => game.playerView({ G, ctx, playerID }),
    over: () => game.endIf({ G, ctx }),
  };
}
const write = (g, id) => g.play('submit', id, [`truth ${id}a`, `truth ${id}b`, `LIE-${id}`], 2);
const everyone = ['0', '1', '2'];

// ---- Writing ----
{
  const g = newGame();
  write(g, '0');
  write(g, '1');
  check('still writing until everyone has submitted', g.G.phase === 'writing');
  check('a player cannot submit twice', g.play('submit', '0', ['a', 'b', 'c'], 0) === 'INVALID_MOVE');
  check('empty statements are rejected', g.play('submit', '2', ['a', '', 'c'], 0) === 'INVALID_MOVE');
  check('over-long statements are rejected', g.play('submit', '2', ['a', 'b', 'x'.repeat(201)], 0) === 'INVALID_MOVE');
  check('a bad lie index is rejected', g.play('submit', '2', ['a', 'b', 'c'], 3) === 'INVALID_MOVE');
  const seen = JSON.stringify(g.view('2')) + JSON.stringify(g.view(null));
  check('nobody sees other players statements while writing', !seen.includes('truth 0a') && !seen.includes('LIE-'));
  write(g, '2');
  check('reveal starts once everyone has submitted', g.G.phase === 'reveal');
  check(
    'the lie is tracked correctly after shuffling',
    everyone.every((id) => {
      const s = g.G.submissions[id];
      return s.statements[s.lieIndex] === `LIE-${id}`;
    })
  );
}

// ---- Voting and reveal ----
{
  const g = newGame();
  everyone.forEach((id) => write(g, id));
  const subject = g.G.order[0];
  const others = everyone.filter((id) => id !== subject);
  const lie = g.G.submissions[subject].lieIndex;

  const tv = g.view(null);
  check('the lie is hidden before the reveal', tv.subs[subject].lieIndex === null);
  check('later players statements are not sent yet', !(g.G.order[2] in tv.subs));
  check('the subject cannot vote', g.play('vote', subject, 0) === 'INVALID_MOVE');
  check('a bad vote is rejected', g.play('vote', others[0], 7) === 'INVALID_MOVE');
  check('reveal-now needs at least one vote', g.play('revealNow', subject) === 'INVALID_MOVE');

  g.play('vote', others[0], lie);
  check('a player cannot vote twice', g.play('vote', others[0], 0) === 'INVALID_MOVE');
  check('only the subject can reveal early', g.play('revealNow', others[1]) === 'INVALID_MOVE');
  check('the TV sees how many voted, not the tally', g.view(null).votedCount === 1 && g.view(null).counts === null);

  g.play('vote', others[1], (lie + 1) % 3);
  check('the reveal happens by itself after the last vote', g.G.revealed === true);
  check(
    'scores: the right guesser and the fooled subject get a point',
    g.G.scores[others[0]] === 1 && g.G.scores[others[1]] === 0 && g.G.scores[subject] === 1
  );
  check('the lie is shown after the reveal', g.view(null).subs[subject].lieIndex === lie);
  check('only the subject can continue', g.play('next', others[0]) === 'INVALID_MOVE');
  g.play('next', subject);
  check('the next player is up', g.G.currentIndex === 1 && g.G.revealed === false);
}

// ---- Reveal-now fallback ----
{
  const g = newGame();
  everyone.forEach((id) => write(g, id));
  const subject = g.G.order[0];
  const voter = everyone.find((id) => id !== subject);
  g.play('vote', voter, g.G.submissions[subject].lieIndex);
  g.play('revealNow', subject);
  check('the subject can reveal early once someone has voted', g.G.revealed === true && g.G.scores[voter] === 1);
}

// ---- A whole game ----
{
  const g = newGame();
  everyone.forEach((id) => write(g, id));
  for (let round = 0; round < 3; round++) {
    const subject = g.G.order[g.G.currentIndex];
    const lie = g.G.submissions[subject].lieIndex;
    everyone.filter((id) => id !== subject).forEach((id) => g.play('vote', id, lie));
    g.play('next', subject);
  }
  check('the game ends after everyone has had a turn', g.G.phase === 'gameover');
  const result = g.over();
  check('everyone spotted every lie, so all three tie', !!result && result.winners.length === 3);
  const tv = g.view(null);
  check('all lies are shown at the end', everyone.every((id) => tv.subs[id] && tv.subs[id].lieIndex !== null));
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);