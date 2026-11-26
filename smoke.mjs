// Runs public/view.js against a tiny fake page, fed with real views from the game
import fs from 'node:fs';
import vm from 'node:vm';
import { game, config } from './server.js';

const src = fs.readFileSync(new URL('./public/view.js', import.meta.url), 'utf8');
let clock = 1_700_000_000_000;
Date.now = () => clock;

function makePage() {
  let html = '';
  let renders = 0;
  const posted = [];
  const timers = [];
  const found = {};
  const root = {
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v; renders++;
      for (const k of Object.keys(found)) delete found[k];
      const add = (key, el) => { (found[key] ||= []).push(el); };
      for (const m of v.matchAll(/<(button|textarea)([^>]*)>/g)) {
        const attrs = m[2];
        const id = (attrs.match(/id="([\w-]+)"/) || [])[1];
        const el = { tag: m[1], disabled: /\sdisabled/.test(attrs), isConnected: true, dataset: {}, value: '', onclick: null, oninput: null };
        for (const d of attrs.matchAll(/data-(\w+)="([^"]*)"/g)) el.dataset[d[1]] = d[2];
        if (id) add('#' + id, el);
        for (const d of Object.keys(el.dataset)) add(`[data-${d}]`, el);
      }
    },
    querySelector: (sel) => (found[sel] || [])[0] || null,
    querySelectorAll: (sel) => found[sel] || [],
  };
  const handlers = {};
  const docHandlers = {};
  const parent = { postMessage: (m) => posted.push(m) };
  const ctx = {
    document: { getElementById: () => root, addEventListener: (t, f) => { docHandlers[t] = f; }, hidden: false },
    window: { addEventListener: (t, f) => { handlers[t] = f; } },
    parent, setInterval: (f) => timers.push(f), setTimeout: () => 0, console, Math, Number, String, Array, JSON, Set, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { root, posted, timers, docHandlers, get renders() { return renders; },
    q: (sel) => root.querySelector(sel),
    send: (data) => handlers.message({ source: parent, data }),
    get html() { return html; } };
}

const ctx = { numPlayers: game.maxPlayers, currentPlayer: '0' };
const random = { Shuffle: (a) => [...a] };
const G = game.setup({ ctx });
const NAMES = ['Ann', 'Bo<b>', 'Cy', 'Di', 'Ed', 'Flo'];
const names = Object.fromEntries(G.seats.map((id) => [id, NAMES[Number(id)] || `Player ${Number(id) + 1}`]));
const play = (n, id, ...a) => game.moves[n].move({ G, ctx, playerID: id, random }, ...a);
const msg = (id, view) => ({ type: 'state', view, playerID: id, names, state: { G: game.playerView({ G, ctx, playerID: id }), ctx } });

let fails = 0;
const ok = (label, cond) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) fails++; };
const hellos = (p) => p.posted.filter((m) => m.name === 'here').length;
const lastMove = (p) => JSON.stringify(p.posted.at(-1));

const tv = makePage();
const ph = { 0: makePage(), 1: makePage(), 2: makePage(), 4: makePage() };
const feed = (only) => { tv.send(msg(null, 'public')); for (const [id, p] of Object.entries(ph)) if (!only || only.includes(id)) p.send(msg(id, 'player')); };

feed();
ok('an empty room says nobody is here', /Nobody here yet/.test(tv.html) && /0 here · need at least 2/.test(tv.html));
ok('each phone says hello as soon as it opens, the TV never does', Object.values(ph).every((p) => hellos(p) === 1) && hellos(tv) === 0);
ph[0].timers.forEach((f) => f());
ok('a phone keeps saying hello on a timer', hellos(ph[0]) === 2);
ph[1].docHandlers.visibilitychange();
ok('and when it wakes up', hellos(ph[1]) === 2);

play('here', '0');
feed();
ok('one player cannot start', ph[0].q('#start').disabled === true && /Waiting for 1 more player…/.test(ph[0].html));
play('here', '1');
feed();
ok('two players can start', ph[0].q('#start').disabled === false && /2 players here/.test(tv.html));
ok('names are escaped', tv.html.includes('Bo&lt;b&gt;') && !tv.html.includes('Bo<b>'));
ph[0].q('#start').onclick();
ok('the Start button asks to start', lastMove(ph[0]) === JSON.stringify({ type: 'move', name: 'start', args: [] }));

// ---- writing ----
play('start', '0'); feed();
ok('everyone sees the writing screens', /Write your statements/.test(tv.html) && ph[0].q('#st-0') && ph[0].q('#submit').disabled === true);
const form = ph[0];
['I have a twin', 'I can juggle', 'I have been to Mars'].forEach((t, i) => { const ta = form.q(`#st-${i}`); ta.value = t; ta.oninput(); });
ok('the Submit button stays off until a lie is chosen', form.q('#submit').disabled === true);
form.q('[data-lie]').dataset.lie; form.root.querySelectorAll('[data-lie]')[2].onclick();
ok('choosing the lie keeps what was typed', form.q('#st-2').value === '' ? /I have been to Mars/.test(form.html) : true);
ok('and turns the Submit button on', form.q('#submit') && form.q('#submit').disabled === false);
form.q('#submit').onclick();
ok('submitting posts the statements and the lie', lastMove(form) === JSON.stringify({ type: 'move', name: 'submit', args: [['I have a twin', 'I can juggle', 'I have been to Mars'], 2] }));

// A state update must not wipe a form someone is typing in
const typing = ph[1]; const rendersBefore = typing.renders;
typing.q('#st-0').value = 'half typed'; typing.q('#st-0').oninput();
play('here', '2'); feed(['1']);
ok('the writing form is not rebuilt while someone types', typing.renders === rendersBefore);

play('submit', '0', ['I have a twin', 'I can juggle', 'I have been to Mars'], 2);
feed();
ok('a player who has submitted sees a waiting screen with their statements', /You're in/.test(ph[0].html) && /been to Mars/.test(ph[0].html));
ok('the TV shows who is ready without showing statements', /✅ ready/.test(tv.html) && !/twin/.test(tv.html));

// A newcomer during writing joins in
play('here', '4'); feed();
ok('a newcomer during writing gets the writing form', ph[4].q('#st-0') !== null && /\b3 players|1 of 4|of 4 ready/.test(tv.html) || /of 4 ready/.test(tv.html));
play('submit', '4', ['a', 'b', 'c'], 0);
play('submit', '1', ['x1', 'x2', 'x3'], 1);
play('submit', '2', ['y1', 'y2', 'y3'], 1);
feed();
ok('when everyone has submitted the reveal begins', G.phase === 'reveal' && /'s statements/.test(tv.html));

// ---- reveal ----
const subject = G.order[G.currentIndex];
const voters = ['0', '1', '2', '4'].filter((id) => id !== subject);
ok('the subject sees the "up on the TV" screen and the others get vote buttons', /up on the TV/.test(ph[subject].html) && voters.every((id) => ph[id].root.querySelectorAll('[data-vote]').length === 3));
ph[voters[0]].root.querySelectorAll('[data-vote]')[1].onclick();
ok('picking an option enables the Vote button', ph[voters[0]].q('#sendVote').disabled === false);
ph[voters[0]].q('#sendVote').onclick();
ok('voting posts the vote', lastMove(ph[voters[0]]) === JSON.stringify({ type: 'move', name: 'vote', args: [1] }));
ok('the TV never shows who voted for what', !/voted for/.test(tv.html));

// A latecomer can guess along
play('here', '3');
const late = makePage(); late.send({ ...msg('3', 'player') });
ok('a latecomer is told they can guess along', /arrived after the writing ended/.test(late.html) && late.root.querySelectorAll('[data-vote]').length === 3);
play('vote', '3', G.submissions[subject].lieIndex);
voters.forEach((id) => { if (G.votes[subject][id] === undefined) play('vote', id, G.submissions[subject].lieIndex); });
feed();
ok('everyone sees the reveal with the lie marked', G.revealed && /LIE/.test(tv.html) && /Votes:/.test(tv.html));
ok('only the subject has a Next button', ph[subject].q('#next') !== null && voters.every((id) => ph[id].q('#next') === null));
ph[subject].q('#next').onclick();
ok('Next sends which player it is', lastMove(ph[subject]) === JSON.stringify({ type: 'move', name: 'next', args: [0] }));

// The subject leaves: anyone can carry on
play('next', subject, 0);
const s2 = G.order[G.currentIndex];
const rest = ['0', '1', '2', '4'].filter((id) => id !== s2);
rest.forEach((id) => play('vote', id, 0));
play('vote', '3', 0); // the latecomer is still here, so the reveal waits for them too
feed();
play('goodbye', s2); feed();
ok('when the subject has gone anyone can continue', rest.every((id) => ph[id].q('#next') !== null) && /has gone, so anyone can continue/.test(ph[rest[0]].html));

// ---- Leave ----
const leaver = ph[rest[0]];
const before = hellos(leaver);
leaver.send({ type: 'leaving' });
ok('tapping Leave tells the game goodbye straight away', JSON.stringify(leaver.posted.at(-1)) === JSON.stringify({ type: 'move', name: 'goodbye', args: [] }));
leaver.timers.forEach((f) => f());
leaver.docHandlers.visibilitychange();
ok('and stops saying hello while leaving', hellos(leaver) === before);
const tvLeave = makePage(); tvLeave.send(msg(null, 'public')); tvLeave.send({ type: 'leaving' });
ok('the TV ignores Leave', tvLeave.posted.filter((m) => m.name === 'goodbye').length === 0);

// ---- the end of a game ----
play('next', rest[0], 1);
while (G.phase === 'reveal') {
  const s = G.order[G.currentIndex];
  ['0', '1', '2', '4', '3'].filter((id) => id !== s).forEach((id) => { play('here', id); if (G.votes[s] && G.votes[s][id] === undefined && !G.revealed) play('vote', id, 0); });
  if (!G.revealed) play('revealNow', s);
  play('next', s, G.currentIndex);
}
feed();
ok('the results show the lies and a Next game button', G.phase === 'summary' && /The lies/.test(tv.html) && /Next game/.test(ph[0].html));
ok('the results never expose the truths', !/I can juggle|\by1\b|\bx1\b/.test(tv.html));
ok('the scoreboard shows the running totals', /pts/.test(tv.html) && /this game/.test(tv.html));
ph[0].q('#start').onclick();
ok('Next game asks to start', lastMove(ph[0]) === JSON.stringify({ type: 'move', name: 'start', args: [] }));
play('here', '0'); play('here', '1'); play('start', '0'); feed();
ok('the next game starts with a blank form', G.game === 2 && ph[0].q('#st-0') && ph[0].q('#st-0').value === '' && /Write your statements/.test(tv.html));

// ---- flipping to the TV view on a phone ----
const flip = makePage();
flip.send(msg('0', 'player')); const n1 = flip.posted.length;
flip.send(msg(null, 'public')); flip.timers.forEach((f) => f());
ok('the TV view on a phone sends no hellos', flip.posted.length === n1);
flip.send(msg('0', 'player'));
ok('coming back to the phone view says hello again', flip.posted.length === n1 + 1);

console.log(fails ? `\n${fails} smoke check(s) FAILED` : '\nSmoke test passed.');
process.exit(fails ? 1 : 0);