(function () {
  const root = document.getElementById('root');
  const LETTERS = ['A', 'B', 'C'];
  const MAX_LEN = 200;

  // Anything players typed is escaped before it goes into the page
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  const send = (name, ...args) => parent.postMessage({ type: 'move', name, args }, '*');
  const nm = (names, id) => esc(names[id] || `Player ${Number(id) + 1}`);

  let last = null; // most recent message from the platform
  let lastView = null;
  let draft = ['', '', '']; // what this player has typed so far
  let draftLie = null; // which statement they marked as the lie
  let draftGame = null;
  let voteSel = null; // the option they have tapped but not yet sent
  let voteKey = null;
  let leaving = false;

  const canSubmit = () => draft.every((s) => s.trim()) && draftLie !== null;

  // ---------------- "I'm here" ----------------
  // The platform lets people come and go, but the game only knows who is here because every
  // phone says so every few seconds, and says goodbye when the player taps Leave.
  const isPlayerView = () => last && last.view === 'player' && last.state.G.role === 'player';
  const beat = () => {
    if (!leaving && isPlayerView()) send('here');
  };
  setInterval(beat, 10000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) beat();
  });

  const hereSet = (S) => new Set(S.here);
  const away = (S, id) => (hereSet(S).has(id) ? '' : ' away');
  const chips = (names, ids) => ids.map((id) => `<span class="chip">${nm(names, id)}</span>`).join('');

  // Everyone who has ever joined, best first. People who have gone are shown dimmed.
  function scoreboard(S, names) {
    if (!S.known.length) return '';
    const ids = [...S.known].sort((a, b) => S.scores[b] - S.scores[a]);
    return (
      '<div class="players">' +
      ids
        .map((id) => {
          const plus = S.gameScores[id] > 0 ? `<span class="plus">+${S.gameScores[id]} this game</span>` : '';
          return `<div class="player${away(S, id)}"><h3>${nm(names, id)}${hereSet(S).has(id) ? '' : ' 💤'}</h3><p>${S.scores[id]} pts</p>${plus}</div>`;
        })
        .join('') +
      '</div>'
    );
  }

  const bigList = (sub, lie) =>
    sub.statements
      .map((s, i) => `<div class="statement-big">${LETTERS[i]}. ${esc(s)}${i === lie ? ' 😈' : ''}</div>`)
      .join('');

  const countLine = (S) =>
    S.here.length >= S.minPlayers
      ? `${S.here.length} players here`
      : `${S.here.length} here · need at least ${S.minPlayers} to play`;

  const lobbyHeader = (S, names) => `<h1>Two Truths & a Lie</h1>
    <div class="bigcount">${countLine(S)}</div>
    ${S.notice ? `<p class="notice">${esc(S.notice)}</p>` : ''}
    <div>${S.here.length ? chips(names, S.here) : '<p class="waiting">Nobody here yet.</p>'}</div>`;

  function summaryHTML(S, names) {
    const who = S.winners.map((id) => nm(names, id)).join(' & ');
    const head = !S.winners.length ? 'Nobody scored that game!' : S.winners.length === 1 ? `${who} won game ${S.game}! 🎉` : `Game ${S.game} is a tie: ${who} 🎉`;
    const recap = S.recap
      .map(
        (r) => `<li>${nm(names, r.who)}'s lie: <span class="lie">“${esc(r.lie)}”</span><br>
          <span class="progress">${r.spotted} spotted it · ${r.fooled} fooled</span></li>`
      )
      .join('');
    return `<h1>${head}</h1><h3>The lies</h3><ul class="recap">${recap}</ul>${scoreboard(S, names)}`;
  }

  // ---------------- TV / spectators ----------------
  function tvHTML(S, names) {
    if (S.phase === 'lobby') {
      return `${lobbyHeader(S, names)}
        <p class="waiting">${
          S.canStart ? 'Anyone can tap “Start game” on their phone.' : 'Use the ➕ Join button to show the code, and join on your phone.'
        } Friends can join or leave at any time.</p>${scoreboard(S, names)}`;
    }

    if (S.phase === 'writing') {
      const writers = S.roster;
      const done = writers.filter((id) => S.submittedBy[id]).length;
      const cards = writers
        .map((id) => {
          const state = S.submittedBy[id] ? '✅ ready' : hereSet(S).has(id) ? '✍️ writing…' : '💤 away';
          return `<div class="player${away(S, id)}"><h3>${nm(names, id)}</h3><p>${state}</p></div>`;
        })
        .join('');
      return `<h1>Two Truths & a Lie</h1>
        <h2>Write your statements on your phone</h2>
        <p class="waiting">${done} of ${writers.length} ready</p>
        ${S.paused ? '<p class="paused">Waiting for players to come back…</p>' : ''}
        <div class="players">${cards}</div>
        <p class="progress">Just arrived? You can still join in.</p>`;
    }

    if (S.phase === 'reveal') {
      const sub = S.subs[S.subject];
      const who = nm(names, S.subject);
      const statements = sub.statements
        .map((s, i) => {
          let cls = 'statement';
          let tag = '';
          if (S.revealed) {
            const isLie = i === sub.lieIndex;
            cls += isLie ? ' lie' : ' truth';
            tag = `<span class="tag">${isLie ? 'LIE' : 'Truth'}</span>`;
          }
          return `<div class="${cls}"><span class="letter">${LETTERS[i]}</span><span>${esc(s)}</span>${tag}</div>`;
        })
        .join('');
      const info = S.revealed
        ? `<p>😈 The lie was <strong>${LETTERS[sub.lieIndex]}</strong>. Votes: ${S.counts
            .map((n, i) => `${LETTERS[i]}: ${n}`)
            .join(' &nbsp; ')}</p><p class="waiting">Waiting for ${who} to continue…</p>`
        : `<p class="waiting">Which one is the lie? Vote on your phone (${S.votedCount} of ${S.votersNeeded} voted)</p>
           ${S.paused ? '<p class="paused">Waiting for players to come back…</p>' : ''}`;
      return `<h1>Two Truths & a Lie</h1>
        <h2>${who}'s statements${hereSet(S).has(S.subject) ? '' : ' 💤'}</h2>
        <div class="statements">${statements}</div>
        ${info}
        <p class="progress">${S.currentIndex + 1} / ${S.total}</p>
        ${scoreboard(S, names)}`;
    }

    return `${summaryHTML(S, names)}
      <p class="waiting">Anyone can tap “Next game” on their phone.</p>`;
  }

  // ---------------- A player's phone ----------------
  function phoneHTML(S, names, playerID) {
    if (S.phase === 'lobby') {
      const need = S.minPlayers - S.here.length;
      return `${lobbyHeader(S, names)}
        <p><button id="start" ${S.canStart ? '' : 'disabled'}>Start game</button></p>
        <p class="progress">${S.canStart ? 'Anyone can start. Others can still join while you write.' : `Waiting for ${need} more player${need === 1 ? '' : 's'}…`}</p>
        ${scoreboard(S, names)}`;
    }

    if (S.phase === 'writing') {
      if (S.mySubmission) {
        const waiting = S.roster.filter((id) => !S.submittedBy[id] && hereSet(S).has(id)).length;
        return `<h1>You're in! ✅</h1>
          <p class="waiting">Waiting for ${waiting} more…</p>
          ${S.paused ? '<p class="paused">Some players have gone quiet. Waiting for them to come back…</p>' : ''}
          <p class="progress">The order was shuffled, so nobody can guess from the position.</p>
          ${bigList(S.mySubmission, S.mySubmission.lieIndex)}
          ${S.canBegin ? '<p><button id="begin" class="secondary">Start the reveal now</button></p><p class="progress">(leaves out anyone who has not finished)</p>' : ''}`;
      }
      return `<h1>Two Truths & a Lie</h1>
        <p>Write <strong>two truths</strong> and <strong>one lie</strong> about yourself.</p>
        ${[0, 1, 2]
          .map(
            (i) => `<div class="form-row"><label>Statement ${LETTERS[i]}</label>
              <textarea id="st-${i}" maxlength="${MAX_LEN}">${esc(draft[i])}</textarea></div>`
          )
          .join('')}
        <p>Which one is the lie?</p>
        <div class="choices">${[0, 1, 2]
          .map((i) => `<button data-lie="${i}" class="${draftLie === i ? 'sel' : ''}">${LETTERS[i]}</button>`)
          .join('')}</div>
        <p><button id="submit" ${canSubmit() ? '' : 'disabled'}>Submit</button></p>`;
    }

    if (S.phase === 'reveal') {
      const sub = S.subs[S.subject];
      const who = nm(names, S.subject);
      const late = S.inGame ? '' : '<p class="progress">You arrived after the writing ended. Guess along, and you will write in the next game!</p>';

      if (S.subject === playerID) {
        if (S.revealed) {
          return `<h1>Revealed!</h1>
            <p>${S.counts[sub.lieIndex]} of ${S.votedCount} spotted your lie.</p>
            ${bigList(sub, sub.lieIndex)}
            <button id="next">${S.currentIndex + 1 >= S.total ? 'See the results' : 'Next player'}</button>`;
        }
        return `<h1>You're up on the TV!</h1>
          <p class="waiting">${S.votedCount} of ${S.votersNeeded} have voted. Sit tight 😈</p>
          ${bigList(sub, null)}
          <button id="revealNow" ${S.canReveal ? '' : 'disabled'}>Reveal now</button>`;
      }

      if (S.revealed) {
        const right = S.myVote === sub.lieIndex;
        return `<h1>${who}'s lie was ${LETTERS[sub.lieIndex]}</h1>
          ${bigList(sub, sub.lieIndex)}
          <p>${S.myVote === null ? 'You did not vote.' : `Your guess: ${LETTERS[S.myVote]} ${right ? '✅ correct!' : '❌'}`}</p>
          ${S.canNext ? `<p class="waiting">${who} has gone, so anyone can continue.</p><button id="next">Next</button>` : `<p class="waiting">Waiting for ${who} to continue…</p>`}`;
      }

      if (S.myVote !== null) {
        return `<h1>${who}'s statements</h1>
          <p>You voted <strong>${LETTERS[S.myVote]}</strong>.</p>
          <p class="waiting">Waiting for the others (${S.votedCount} of ${S.votersNeeded} voted)…</p>
          ${S.paused ? '<p class="paused">Some players have gone quiet. Waiting for them to come back…</p>' : ''}
          ${bigList(sub, null)}
          ${S.canReveal ? `<button id="revealNow" class="secondary">Reveal now</button><p class="progress">(${who} has gone)</p>` : ''}`;
      }

      return `<h1>${who}'s statements</h1>
        ${late}
        <p>Which one is the lie?</p>
        ${sub.statements
          .map(
            (s, i) => `<div class="statement-big">
              <button data-vote="${i}" class="${voteSel === i ? 'sel' : ''}">${LETTERS[i]}</button> ${esc(s)}
            </div>`
          )
          .join('')}
        <button id="sendVote" ${voteSel === null ? 'disabled' : ''}>Vote</button>`;
    }

    // summary
    return `${summaryHTML(S, names)}
      <p><button id="start" ${S.canStart ? '' : 'disabled'}>Next game</button></p>
      <p class="progress">${S.canStart ? 'Anyone can start. Friends can still join.' : `Waiting for ${S.minPlayers - S.here.length} more player(s)…`}</p>`;
  }

  // ---------------- Buttons ----------------
  function bind() {
    [0, 1, 2].forEach((i) => {
      const ta = root.querySelector(`#st-${i}`);
      if (ta) {
        ta.oninput = () => {
          draft[i] = ta.value;
          const b = root.querySelector('#submit');
          if (b) b.disabled = !canSubmit();
        };
      }
    });
    root.querySelectorAll('[data-lie]').forEach((b) => {
      b.onclick = () => {
        draftLie = Number(b.dataset.lie);
        render(last, true);
      };
    });
    const submit = root.querySelector('#submit');
    if (submit) {
      submit.onclick = () => {
        if (!canSubmit()) return;
        submit.disabled = true;
        send('submit', draft.map((s) => s.trim()), draftLie);
        // If the server refuses it, let the player try again
        setTimeout(() => {
          if (submit.isConnected) submit.disabled = !canSubmit();
        }, 3000);
      };
    }
    root.querySelectorAll('[data-vote]').forEach((b) => {
      b.onclick = () => {
        voteSel = Number(b.dataset.vote);
        render(last, true);
      };
    });
    const once = (id, name, ...args) => {
      const el = root.querySelector(id);
      if (!el) return;
      el.onclick = () => {
        el.disabled = true;
        send(name, ...(typeof args[0] === 'function' ? args[0]() : args));
        // If the server refuses it, let the player try again
        setTimeout(() => el.isConnected && render(last, true), 3000);
      };
    };
    const sendVote = root.querySelector('#sendVote');
    if (sendVote) {
      sendVote.onclick = () => {
        if (voteSel === null) return;
        sendVote.disabled = true;
        send('vote', voteSel);
        voteSel = null;
        setTimeout(() => sendVote.isConnected && render(last, true), 3000);
      };
    }
    once('#start', 'start');
    once('#begin', 'begin');
    once('#revealNow', 'revealNow');
    once('#next', 'next', () => [last.state.G.currentIndex]);
  }

  // ---------------- Render ----------------
  function render(msg, force) {
    const firstOfKind = !last || lastView !== msg.view;
    last = msg;
    lastView = msg.view;
    const { view, playerID, names, state } = msg;
    const S = state.G;
    if (view === 'player') {
      if (S.game !== draftGame) {
        draftGame = S.game;
        draft = ['', '', ''];
        draftLie = null;
      }
      const key = `${S.game}:${S.currentIndex}`;
      if (key !== voteKey) {
        voteKey = key;
        voteSel = null;
      }
      if (S.myVote !== null) voteSel = null;
      // Don't rebuild the writing form while someone is typing in it
      if (!force && S.phase === 'writing' && !S.mySubmission && root.querySelector('#submit')) {
        if (firstOfKind) beat();
        return;
      }
      root.innerHTML = phoneHTML(S, names, playerID);
      bind();
      if (firstOfKind) beat(); // say hello straight away, and again when coming back from the TV view
    } else {
      root.innerHTML = tvHTML(S, names);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === 'state') {
      render(e.data);
    } else if (e.data.type === 'leaving') {
      // The player tapped Leave. Tell the game right away so nobody waits for them;
      // the platform takes them back to the catalog a moment later.
      if (isPlayerView()) send('goodbye');
      leaving = true;
      setTimeout(() => { leaving = false; }, 4000);
    }
  });
  parent.postMessage({ type: 'ready' }, '*');
})();