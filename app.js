// Finance, on its own: the same records Nerve keeps (Supabase table fin_docs), signed in with the Nerve account.
// finance.js draws every page; this file is the frame around it: sign-in, the section tabs, taps and the toast.
(function () {
  // The page's height (--appH). On the Home Screen with the see-through status bar, iOS starts the page at the very top of
  // the glass but reports the screen shorter by the top inset (62pt on an iPhone 17 Pro), which left a bare strip at the
  // bottom. When the reported height plus that inset still fits the screen, that's the shortfall, and it's added back.
  // (window.FIN_TEST lets the local test page stand in for the phone: standalone, screen height.)
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;height:var(--envT)';
  document.documentElement.appendChild(probe);
  function fitScreen() {
    const T = window.FIN_TEST || {};
    const standalone = T.standalone != null ? T.standalone : navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    const screenH = T.screenH || screen.height, top = probe.offsetHeight;
    const short = standalone && innerHeight >= innerWidth && top > 0 && innerHeight + top <= screenH;
    document.documentElement.style.setProperty('--appH', (short ? innerHeight + top : innerHeight) + 'px');
    document.documentElement.style.setProperty('--gapB', (short ? top : 0) + 'px'); // how far the window stops short of the screen's bottom
  }
  fitScreen();
  addEventListener('resize', fitScreen);
  addEventListener('orientationchange', () => setTimeout(fitScreen, 250));

  // GitHub Pages lets a phone keep the page cached for up to 10 minutes, so a home-screen app could keep running an
  // older build. On open (and coming back to it), ask for version.json fresh; when it's newer, load that build.
  async function checkVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const { v } = await r.json();
      // one try per version, so a slow cache can never send it round in a loop
      let tried = null; try { tried = sessionStorage.getItem('fin.tried'); } catch (e) {}
      if (v && v !== window.APP_V && tried !== v) {
        try { sessionStorage.setItem('fin.tried', v); } catch (e) {}
        location.replace(location.pathname + '?v=' + encodeURIComponent(v));
      }
    } catch (e) {}
  }
  checkVersion();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

  const SB_URL = 'https://dejcovbqwlrvniitbdqv.supabase.co';
  const SB_KEY = 'sb_publishable_VB-KHKnNz_J5EKWvHKW9Ew_7B2sI6Zg';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const S = { user: null, ready: false };
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'finance.auth' } });

  let toastT = null;
  function toast(text, undo, label = 'Undo') {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button">${esc(label)}</button>` : ''}`;
    el.hidden = false;
    if (undo) el.querySelector('button').onclick = () => { el.hidden = true; undo(); };
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, undo ? 5000 : 3000);
  }

  // A redraw waits while you're typing in a field on the page, so a save from another device can't wipe it.
  let pending = false;
  const editing = () => { const a = document.activeElement; return !!(a && a.closest('#view') && a.matches('input, textarea')); };
  document.addEventListener('focusout', () => { if (pending) setTimeout(() => { if (!editing()) render(); }, 0); });

  let FIN = null;
  function render() {
    if (editing()) { pending = true; return; }
    pending = false;
    const view = $('#view'), signedIn = !!S.user;
    $('#bar').hidden = !signedIn; $('#addBtn').hidden = !signedIn;
    if (!signedIn) setMenu(false);
    if (!S.ready) { view.innerHTML = ''; return; }
    if (!signedIn) { view.innerHTML = vLogin(); return; }
    const side = FIN.side(), cur = side.items.find(i => i.key === side.current) || {};
    $('#nav').innerHTML = side.items.map(i => `<button type="button" data-act="fin-sub" data-sub="${esc(i.key)}"${i.key === side.current ? ' aria-current="page"' : ''}>${i.icon}<span>${esc(i.label)}</span>${i.badge ? `<em>${i.badge}</em>` : ''}</button>`).join('');
    $('#where').textContent = cur.label || '';
    $('#addBtn').hidden = side.current === 'home'; // Accounts has no +: balances are set by tapping a card
    // the menu button carries a dot when another section has something waiting
    const waiting = side.items.filter(i => i.key !== side.current).reduce((t, i) => t + (i.badge || 0), 0);
    $('#menuBadge').hidden = !waiting; $('#menuBadge').textContent = waiting;
    const sc = $('#finScroll'), top = sc ? sc.scrollTop : 0;
    view.innerHTML = FIN.view();
    const sc2 = $('#finScroll'); if (sc2) sc2.scrollTop = top;
    document.title = 'Finance · ' + (cur.label || '');
    renderRail(side);
  }

  /* ---------- the edge notch ----------
     Every section has a slot down the edge of the screen, in order (Accounts, Activity, Bills, Spending, Savings, Loans,
     Lists). The slots are invisible; only the one you're in shows, as a black notch grown out of the bezel with its
     icon and number. Press and slide the notch up or down: it follows your thumb from slot to slot, a label says where
     you are, and letting go there moves the page: going down, this page slides up off the screen and the next rises in
     from the bottom (going up, the other way). A tap opens the menu. */
  const SLOT = 64;
  const ring = (frac, color) => {
    const C = 2 * Math.PI * 17, f = Math.max(0, Math.min(1, frac || 0));
    return `<svg class="rl-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" class="rl-track"/>${f ? `<circle cx="20" cy="20" r="17" class="rl-fill" style="stroke:${color}" stroke-dasharray="${(f * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/>` : ''}</svg>`;
  };
  let RAIL = { keys: [], labels: [], cur: 0 };
  // what the notch shows for a section: its icon, inside a ring or with a count where it has a number to watch
  function dial(key, side, R) {
    const icon = `<span class="rl-ic">${(side.items.find(i => i.key === key) || {}).icon || ''}</span>`;
    if (key === 'bills') return { html: ring(R.billsDue ? R.billsPaid / R.billsDue : 0, '#7fdcff') + icon, lab: `${R.billsPaid}/${R.billsDue}`, say: `${R.billsPaid} of ${R.billsDue} bills paid this month` };
    if (key === 'spending') { const u = R.spendUsed; return { html: ring(Math.min(1, u), u > 1 ? '#ff6b4f' : u >= 0.85 ? '#ffd34d' : '#4ee08a') + icon, lab: `${Math.round(u * 100)}%`, say: `${Math.round(u * 100)}% of this month's limits used` }; }
    if (key === 'activity') return { html: ring(R.toConfirm ? 1 : 0, '#ff6b4f') + icon + (R.toConfirm ? `<em>${R.toConfirm}</em>` : ''), lab: R.toConfirm ? `${R.toConfirm} new` : 'All set', say: R.toConfirm ? `${R.toConfirm} to confirm` : 'everything confirmed' };
    return { html: ring(0) + icon, lab: '', say: '' };
  }
  function renderRail(side) {
    const rail = $('#edge'), R = FIN.railStats ? FIN.railStats() : null;
    rail.hidden = !S.user || !R;
    if (rail.hidden) return;
    RAIL = { keys: side.items.map(i => i.key), labels: side.items.map(i => i.label), cur: Math.max(0, side.items.findIndex(i => i.key === side.current)), side, R };
    rail.style.setProperty('--slots', RAIL.keys.length);
    const dd = dial(side.current, side, R), name = RAIL.labels[RAIL.cur];
    if (!rail.firstChild) rail.innerHTML = '<button type="button" class="rl-notch" id="notch"></button><span class="rl-tip" id="railTip" aria-hidden="true"></span>';
    const notch = $('#notch');
    notch.style.setProperty('--i', RAIL.cur);
    notch.setAttribute('aria-label', `${name}${dd.say ? ': ' + dd.say : ''}. Slide up or down for another section, or tap for the menu`);
    notch.innerHTML = `<span class="rl-dial">${dd.html}</span>${dd.lab ? `<span class="rl-lab">${esc(dd.lab)}</span>` : ''}`;
  }

  // sliding the notch
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const notch = e.target.closest && e.target.closest('#notch');
    if (!notch || !S.user) return;
    drag = { id: e.pointerId, y0: e.clientY, i0: RAIL.cur, moved: false, at: RAIL.cur };
    try { notch.setPointerCapture(e.pointerId); } catch (err) {} // keeps the slide going when the thumb leaves the notch
  });
  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 6) return;
    if (!drag.moved) { drag.moved = true; document.body.classList.add('rail-drag'); }
    e.preventDefault();
    const max = (RAIL.keys.length - 1) * SLOT, pos = Math.max(0, Math.min(max, drag.i0 * SLOT + dy));
    const at = Math.round(pos / SLOT), notch = $('#notch');
    // passing over a slot, the notch takes that section's icon and number
    if (at !== drag.at) { const dd = dial(RAIL.keys[at], RAIL.side, RAIL.R); notch.innerHTML = `<span class="rl-dial">${dd.html}</span>${dd.lab ? `<span class="rl-lab">${esc(dd.lab)}</span>` : ''}`; }
    drag.at = at;
    notch.style.transform = `translateY(${pos}px)`;
    const tip = $('#railTip');
    tip.textContent = RAIL.labels[drag.at];
    tip.style.transform = `translateY(${drag.at * SLOT}px)`;
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    document.body.classList.remove('rail-drag');
    const notch = $('#notch');
    notch.style.transform = '';
    if (!d.moved) { if (e.type === 'pointerup') setMenu(true); return; }
    notch.style.setProperty('--i', d.at);
    if (d.at !== RAIL.cur && e.type === 'pointerup') goTo(RAIL.keys[d.at], d.at > RAIL.cur ? 1 : -1);
    else renderRail(RAIL.side); // back where it started (or the slide was cancelled): its own icon again
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // moving to a section from the notch: this page leaves the way you slid, the next comes in behind it
  function goTo(sub, dir) {
    const view = $('#view'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ghost = null;
    if (!still) {
      const r = view.getBoundingClientRect(), sc = $('#finScroll'), top = sc ? sc.scrollTop : 0;
      ghost = view.cloneNode(true);
      ghost.removeAttribute('id');
      for (const x of ghost.querySelectorAll('[id]')) x.removeAttribute('id');
      ghost.className = 'fa-ghost';
      Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      document.body.appendChild(ghost);
      const gs = ghost.querySelector('.fin-scroll'); if (gs) gs.scrollTop = top;
    }
    FIN.act('fin-sub', { dataset: { sub } });
    if (ghost) {
      ghost.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-dir * 105}%)`, opacity: 0.35 }], { duration: 420, easing: 'cubic-bezier(.55,0,.75,.2)', fill: 'forwards' }).onfinish = () => ghost.remove();
      setTimeout(() => ghost.remove(), 700); // and gone for certain, even if the animation never reports finishing
      view.animate([{ transform: `translateY(${dir * 100}%)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2,.85,.25,1)' });
    }
  }
  window.FIN_GOTO = goTo; // for the test kit

  /* ---------- which hand: the tilt picks the side ----------
     Walking with the phone in your right hand, it leans left (screen turned toward you): the tab goes right, under your
     thumb. In your left hand it leans right: the tab goes left. The lean has to hold about a second before it moves,
     and a phone lying flat changes nothing. Auto, Left or Right is set in the sidebar (localStorage fin.hand). */
  const HAND = { mode: 'auto', side: 'right', motion: 'off' };
  try { HAND.mode = localStorage.getItem('fin.hand') || 'auto'; HAND.side = localStorage.getItem('fin.side') || 'right'; } catch (e) {}
  function applyHand() {
    const side = HAND.mode === 'auto' ? HAND.side : HAND.mode;
    document.body.dataset.hand = side;
    for (const b of document.querySelectorAll('.fa-hand-seg button')) b.setAttribute('aria-checked', String(b.dataset.hand === HAND.mode));
    const note = $('#handNote');
    note.textContent = HAND.mode !== 'auto' ? `Always on the ${HAND.mode}.`
      : HAND.motion === 'on' ? `Follows your hand: now on the ${side}.`
      : HAND.motion === 'ask' ? 'Tap anywhere once to let it follow your hand.'
      : HAND.motion === 'denied' ? 'Motion access is off in Settings, so it stays on the ' + side + '.'
      : 'This device has no tilt sensor, so it stays on the ' + side + '.';
  }
  let ema = 0, leanSince = 0, leanTo = null;
  function onTilt(e) {
    if (e.gamma == null) return;
    if (HAND.motion !== 'on') { HAND.motion = 'on'; applyHand(); }
    if (Math.abs(e.beta == null ? 90 : e.beta) < 15) { leanTo = null; return; } // lying flat: no hand to read
    ema = ema * 0.85 + e.gamma * 0.15;
    const now = Date.now(), want = ema <= -12 ? 'right' : ema >= 12 ? 'left' : null; // leaning left = right hand
    if (want !== leanTo) { leanTo = want; leanSince = now; return; }
    if (want && want !== HAND.side && now - leanSince >= 900) {
      HAND.side = want;
      try { localStorage.setItem('fin.side', want); } catch (e2) {}
      if (HAND.mode === 'auto') applyHand();
    }
  }
  let listening = false;
  const listen = () => { if (!listening) { listening = true; addEventListener('deviceorientation', onTilt); } };
  function startMotion() {
    if (typeof DeviceOrientationEvent === 'undefined') { HAND.motion = 'none'; return applyHand(); }
    // Listen right away: where access was already given, readings simply start arriving. iOS asks only from a tap, so
    // while no reading has come, the first tap anywhere asks.
    listen();
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      HAND.motion = 'ask'; applyHand();
      const ask = () => {
        if (HAND.motion !== 'ask') return;
        DeviceOrientationEvent.requestPermission().then(r => { if (r !== 'granted') HAND.motion = 'denied'; applyHand(); }).catch(() => {});
      };
      addEventListener('pointerup', ask, { once: true });
    } else applyHand();
  }
  for (const b of document.querySelectorAll('.fa-hand-seg button')) b.onclick = () => {
    HAND.mode = b.dataset.hand;
    try { localStorage.setItem('fin.hand', HAND.mode); } catch (e) {}
    applyHand();
  };
  applyHand();
  startMotion();

  // the sidebar: every section, and Sign out at the bottom. It slides in over the page from the left.
  function setMenu(open) {
    document.body.classList.toggle('menu-on', open);
    $('#scrim').hidden = !open;
    $('#side').setAttribute('aria-hidden', String(!open));
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  }
  $('#menuBtn').onclick = () => setMenu(!document.body.classList.contains('menu-on'));
  $('#scrim').onclick = () => setMenu(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-on')) setMenu(false); });

  function vLogin() {
    return `<div class="login"><form id="loginForm" class="float login-card" novalidate>
      <h1 class="login-title">Finance</h1>
      <p class="meta">Sign in with your Nerve account.</p>
      <label class="f"><span class="f-h">Email</span><input id="l_email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required></label>
      <label class="f"><span class="f-h">Password</span><input id="l_pass" type="password" autocomplete="current-password" required></label>
      <p class="err" id="l_err" hidden></p>
      <button type="submit" class="btn solid" id="l_go">Sign in</button>
    </form></div>`;
  }
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'loginForm') return;
    e.preventDefault();
    const err = $('#l_err'), go = $('#l_go');
    go.disabled = true; err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#l_email').value.trim(), password: $('#l_pass').value });
    go.disabled = false;
    if (error) { err.textContent = 'That email and password did not work.'; err.hidden = false; }
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !FIN) return;
    const act = b.dataset.act;
    if (act.startsWith('fin-')) { e.preventDefault(); if (act === 'fin-sub') setMenu(false); FIN.act(act, b, e); }
  });
  $('#addBtn').onclick = () => { if (FIN && S.user) FIN.add(); };
  $('#signOut').onclick = () => { setMenu(false); sb.auth.signOut(); };

  FIN = window.POSFinance({ sb, toast, esc, clamp, rerender: render, canSave: () => !!S.user });

  sb.auth.onAuthStateChange((_ev, session) => {
    const u = session ? session.user : null, was = S.user && S.user.id;
    S.user = u; S.ready = true;
    if (u && was !== u.id) FIN.start();
    if (!u && was) FIN.stop();
    render();
  });
  // coming back to the app (the phone woke, the tab was hidden): fetch what changed meanwhile
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) FIN.start(); });
})();
