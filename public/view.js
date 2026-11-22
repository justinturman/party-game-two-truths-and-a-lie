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
  let draft = ['', '', '']; // what this player has typed so far
  let draftLie = null; // which statement they marked as the lie
  let voteSel = null; // the option they have tapped but not yet sent
  let voteSubject = null;

  const canSubmit = () => draft.every((s) => s.trim()) && draftLie !== null;

  function logLine(e, names) {
    switch (e.type) {
      case 'phase':
        return 'Reveal begins! 🎬';
      case 'reveal':
        return `${nm(names, e.subject)}: ${e.correct} spotted the lie, ${e.wrong} fooled`;
      case 'gameover':
        return 'Game over!';
      default:
        return '';
    }
  }
  const logHTML = (log, names, n) =>
    '<ul class="log">' +
    log.slice(-n).reverse().map((e) => `<li>${logLine(e, names)}</li>`).join('') +
    '</ul>';

  function scoreboard(S, names) {
    const ids = [...S.players].sort((a, b) => S.scores[b] - S.scores[a]);
    return (
      '<div class="players">' +
      ids.map((id) => `<div class="player"><h3>${nm(names, id)}</h3><p>${S.scores[id]} pts</p></div>`).join('') +
      '</div>'
    );
  }

  function winnersText(S, names) {
    const best = Math.max(...Object.values(S.scores));
    const w = S.players.filter((id) => S.scores[id] === best);
    return w.length === 1
      ? `${nm(names, w[0])} wins! 🎉`
      : `It's a tie: ${w.map((id) => nm(names, id)).join(', ')}`;
  }

  const bigList = (sub, lie) =>
    sub.statements
      .map((s, i) => `<div class="statement-big">${LETTERS[i]}. ${esc(s)}${i === lie ? ' 😈' : ''}</div>`)
      .join('');

  // ---------------- TV / spectators ----------------
  function tvHTML(S, names) {
    if (S.phase === 'writing') {
      const done = S.players.filter((id) => S.submittedBy[id]).length;
      const cards = S.players
        .map((id) => `<div class="player"><h3>${nm(names, id)}</h3><p>${S.submittedBy[id] ? '✅ ready' : '✍️ writing…'}</p></div>`)
        .join('');
      return `<h1>Two Truths & a Lie</h1>
        <h2>Write your statements on your phone</h2>
        <p class="waiting">${done} of ${S.players.length} ready</p>
        <div class="players">${cards}</div>`;
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
        : `<p class="waiting">Which one is the lie? Vote on your phone (${S.votedCount} of ${S.votersNeeded} voted)</p>`;
      return `<h1>Two Truths & a Lie</h1>
        <h2>${who}'s statements</h2>
        <div class="statements">${statements}</div>
        ${info}
        <p class="progress">${S.currentIndex + 1} / ${S.total}</p>
        ${scoreboard(S, names)}`;
    }

    return `<h1>${winnersText(S, names)}</h1>${scoreboard(S, names)}${logHTML(S.log, names, 6)}`;
  }

  // ---------------- A player's phone ----------------
  function phoneHTML(S, names, playerID) {
    if (S.phase === 'writing') {
      if (S.mySubmission) {
        const waiting = S.players.filter((id) => !S.submittedBy[id]).length;
        return `<h1>You're in! ✅</h1>
          <p class="waiting">Waiting for ${waiting} more…</p>
          <p class="progress">The order was shuffled, so nobody can guess from the position.</p>
          ${bigList(S.mySubmission, S.mySubmission.lieIndex)}`;
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

      if (S.subject === playerID) {
        if (S.revealed) {
          return `<h1>Revealed!</h1>
            <p>${S.counts[sub.lieIndex]} of ${S.votersNeeded} spotted your lie.</p>
            ${bigList(sub, sub.lieIndex)}
            <button id="next">Next player</button>`;
        }
        return `<h1>You're up on the TV!</h1>
          <p class="waiting">${S.votedCount} of ${S.votersNeeded} have voted. Sit tight 😈</p>
          ${bigList(sub, null)}
          <button id="revealNow" ${S.votedCount > 0 ? '' : 'disabled'}>Reveal now</button>`;
      }

      if (S.revealed) {
        const right = S.myVote === sub.lieIndex;
        return `<h1>${who}'s lie was ${LETTERS[sub.lieIndex]}</h1>
          ${bigList(sub, sub.lieIndex)}
          <p>${S.myVote === null ? 'You did not vote.' : `Your guess: ${LETTERS[S.myVote]} ${right ? '✅ correct!' : '❌'}`}</p>
          <p class="waiting">Waiting for ${who} to continue…</p>`;
      }

      if (S.myVote !== null) {
        return `<h1>${who}'s statements</h1>
          <p>You voted <strong>${LETTERS[S.myVote]}</strong>.</p>
          <p class="waiting">Waiting for the others (${S.votedCount} of ${S.votersNeeded} voted)…</p>
          ${bigList(sub, null)}`;
      }

      return `<h1>${who}'s statements</h1>
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

    return `<h1>${winnersText(S, names)}</h1>${scoreboard(S, names)}`;
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
    const sendVote = root.querySelector('#sendVote');
    if (sendVote) {
      sendVote.onclick = () => {
        if (voteSel === null) return;
        sendVote.disabled = true;
        send('vote', voteSel);
        voteSel = null;
      };
    }
    const revealNow = root.querySelector('#revealNow');
    if (revealNow) revealNow.onclick = () => { revealNow.disabled = true; send('revealNow'); };
    const next = root.querySelector('#next');
    if (next) next.onclick = () => { next.disabled = true; send('next'); };
  }

  // ---------------- Render ----------------
  function render(msg, force) {
    last = msg;
    const { view, playerID, names, state } = msg;
    const S = state.G;
    if (view === 'player') {
      // Don't rebuild the writing form while someone is typing in it
      if (!force && S.phase === 'writing' && !S.mySubmission && root.querySelector('#submit')) return;
      if (S.subject !== voteSubject) {
        voteSubject = S.subject;
        voteSel = null;
      }
      root.innerHTML = phoneHTML(S, names, playerID);
      bind();
    } else {
      root.innerHTML = tvHTML(S, names);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source === parent && e.data && e.data.type === 'state') render(e.data);
  });
  parent.postMessage({ type: 'ready' }, '*');
})();