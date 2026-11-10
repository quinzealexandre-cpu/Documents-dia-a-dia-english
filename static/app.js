(function () {
  'use strict';

  const L = window.Logic;
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const PASS_SCORE = 80;
  const S = { setupNeeded: false, setupCode: false, ai: false, user: null, content: null, progress: {} };
  let activeRec = null;

  // ------------------------------------------------------------ helpers

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4000);
  }

  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, body === undefined ? { credentials: 'same-origin' } : {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('Sem conexão com o aplicativo. O computador está ligado?');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 401 && S.user) { S.user = null; render(); }
    if (!res.ok) throw new Error(data.error || 'Algo deu errado. Tente de novo.');
    return data;
  }

  function bar(fraction) {
    const fill = h('i');
    fill.style.width = Math.round(fraction * 100) + '%';
    return h('div', { class: 'bar' }, fill);
  }

  // ------------------------------------------------------------ voice out (listening)

  let voices = [];
  if ('speechSynthesis' in window) {
    const load = () => { voices = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
  }

  function pickVoice() {
    const us = voices.filter((v) => /^en[-_]US/i.test(v.lang));
    return us.find((v) => /natural|google|samantha|aria|jenny/i.test(v.name)) || us[0]
      || voices.find((v) => /^en/i.test(v.lang)) || null;
  }

  function say(text, slow) {
    if (!('speechSynthesis' in window)) { toast('Este navegador não consegue falar as frases.'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = 'en-US';
    u.rate = slow ? 0.6 : 0.95;
    window.speechSynthesis.speak(u);
  }

  function stopAudio() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (activeRec) { try { activeRec.abort(); } catch (e) { /* already stopped */ } activeRec = null; }
  }

  // ------------------------------------------------------------ boot and routing

  async function loadData() {
    const [content, prog] = await Promise.all([api('/api/content'), api('/api/progress')]);
    S.content = content;
    S.progress = prog.progress;
  }

  async function boot() {
    try {
      const st = await api('/api/state');
      S.setupNeeded = st.setup_needed;
      S.setupCode = st.setup_code_required;
      S.ai = st.ai_enabled;
      S.user = st.user;
      if (S.user) await loadData();
      render();
    } catch (e) {
      show(h('p', { class: 'loading' }, e.message));
    }
  }

  function show(...nodes) {
    app.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }

  function render() {
    stopAudio();
    if (S.setupNeeded) return show(viewAuth(true));
    if (!S.user) return show(viewAuth(false));
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const scenario = S.content.scenarios.find((s) => s.id === parts[1]);
    if (parts[0] === 'c' && scenario) return show(viewScenario(scenario));
    if (parts[0] === 'p' && scenario && scenario.phrases[Number(parts[2])]) {
      return show(viewPractice(scenario, Number(parts[2]), parts[3] === 'listen' ? 'listen' : 'speak'));
    }
    if (parts[0] === 'conta') return show(viewAccount());
    if (parts[0] === 'chat') return show(viewChat());
    return show(viewHome());
  }

  window.addEventListener('hashchange', render);

  // ------------------------------------------------------------ login / first-run setup

  function field(label, attrs) {
    return h('label', { class: 'field' }, h('span', {}, label), h('input', attrs));
  }

  function viewAuth(setup) {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, setup ? 'Criar conta' : 'Entrar');
    const form = h('form', { class: 'card auth' },
      h('img', { src: '/icon.svg', alt: '', class: 'logo' }),
      h('h1', {}, 'Dia a Dia English'),
      h('p', { class: 'muted' }, setup
        ? 'Primeiro acesso: crie a conta de administrador. Depois você cria as outras contas.'
        : 'Inglês para as situações do seu dia.'),
      field('Usuário', { name: 'username', autocomplete: 'username', autocapitalize: 'none', required: true }),
      field('Senha', { name: 'password', type: 'password', required: true,
        autocomplete: setup ? 'new-password' : 'current-password', minlength: setup ? 8 : null }),
      setup && field('Repita a senha', { name: 'password2', type: 'password', required: true, autocomplete: 'new-password' }),
      setup && S.setupCode && field('Código de configuração (APP_SETUP_CODE)', { name: 'code', type: 'password', required: true, autocomplete: 'off' }),
      err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const f = new FormData(form);
      if (setup && f.get('password') !== f.get('password2')) { err.textContent = 'As senhas não são iguais.'; return; }
      btn.disabled = true;
      try {
        await api(setup ? '/api/setup' : '/api/login', { username: f.get('username'), password: f.get('password'), code: f.get('code') || undefined });
        await boot();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    });
    return h('main', { class: 'page center' }, form);
  }

  // ------------------------------------------------------------ home

  function topbar(title, backHash) {
    return h('header', { class: 'topbar' },
      backHash != null
        ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Voltar', onclick: () => go(backHash) }, '‹')
        : h('img', { src: '/icon.svg', alt: '', class: 'topbar-logo' }),
      h('strong', {}, title),
      h('button', { class: 'icon-btn small', type: 'button', onclick: () => go('#/conta') }, 'Conta'));
  }

  const best = (p, mode) => ((S.progress[p.id] || {})[mode] || {}).best;
  const spoken = (p) => best(p, 'speak') >= PASS_SCORE;

  function viewHome() {
    const all = S.content.scenarios.flatMap((s) => s.phrases);
    const done = all.filter(spoken).length;
    return h('div', {},
      topbar('Dia a Dia English'),
      h('main', { class: 'page' },
        h('section', { class: 'hello' },
          h('h1', {}, 'Olá, ' + S.user.username + '!'),
          h('p', {}, 'Escolha uma situação e pratique em voz alta.'),
          h('div', { class: 'overall' }, bar(done / all.length),
            h('span', {}, done + ' de ' + all.length + ' frases faladas'))),
        h('button', { class: 'talk-card', type: 'button', onclick: () => go('#/chat') },
          h('span', { class: 'emoji', 'aria-hidden': 'true' }, '💬'),
          h('span', {}, h('b', {}, 'Conversar com a Amy'),
            h('span', {}, 'Escolha o assunto e converse em voz alta. Ela corrige você com carinho.'))),
        h('h2', { class: 'section-title' }, 'Frases prontas para treinar'),
        h('div', { class: 'grid' }, S.content.scenarios.map((s) => {
          const n = s.phrases.filter(spoken).length;
          return h('button', { class: 'scenario', type: 'button', onclick: () => go('#/c/' + s.id) },
            h('span', { class: 'emoji', 'aria-hidden': 'true' }, s.emoji),
            h('span', { class: 'scenario-title' }, s.title),
            bar(n / s.phrases.length),
            h('span', { class: 'muted small' }, n + ' de ' + s.phrases.length));
        }))));
  }

  // ------------------------------------------------------------ scenario (phrase list)

  function viewScenario(s) {
    return h('div', {},
      topbar(s.title, '#/'),
      h('main', { class: 'page' },
        h('p', { class: 'muted' }, 'Toque em uma frase para praticar.'),
        h('ol', { class: 'phrases' }, s.phrases.map((p, i) => {
          const sp = best(p, 'speak');
          const li = best(p, 'listen');
          return h('li', {}, h('button', { type: 'button', class: 'phrase-row', onclick: () => go('#/p/' + s.id + '/' + i + '/speak') },
            h('span', { class: 'phrase-text' }, h('b', {}, p.en), h('span', { class: 'muted' }, p.pt)),
            h('span', { class: 'badges' },
              sp != null && h('span', { class: 'badge ' + (sp >= PASS_SCORE ? 'good' : 'warn') }, '🎤 ' + sp + '%'),
              li != null && h('span', { class: 'badge good' }, '👂 ✓'))));
        }))));
  }

  // ------------------------------------------------------------ practice

  async function save(p, mode, score, heard) {
    try {
      const r = await api('/api/attempt', { phrase_id: p.id, mode, score, heard: heard || '' });
      S.progress = r.progress;
    } catch (e) {
      toast('Não foi possível salvar o progresso.');
    }
  }

  function viewPractice(s, idx, mode) {
    const p = s.phrases[idx];
    const link = (i, m) => '#/p/' + s.id + '/' + i + '/' + m;
    const tab = (m, label) => h('button', { type: 'button', class: 'tab' + (m === mode ? ' on' : ''),
      'aria-pressed': String(m === mode), onclick: () => go(link(idx, m)) }, label);
    return h('div', {},
      topbar(s.emoji + ' ' + (idx + 1) + ' de ' + s.phrases.length, '#/c/' + s.id),
      h('main', { class: 'page' },
        h('div', { class: 'tabs' }, tab('speak', '🎤 Falar'), tab('listen', '👂 Ouvir')),
        mode === 'speak' ? speakPanel(p) : listenPanel(p),
        h('nav', { class: 'pager' },
          h('button', { class: 'btn', type: 'button', disabled: idx === 0, onclick: () => go(link(idx - 1, mode)) }, '‹ Anterior'),
          idx < s.phrases.length - 1
            ? h('button', { class: 'btn primary', type: 'button', onclick: () => go(link(idx + 1, mode)) }, 'Próxima ›')
            : h('button', { class: 'btn primary', type: 'button', onclick: () => go('#/c/' + s.id) }, 'Concluir ✓'))));
  }

  function hearButtons(text) {
    return h('div', { class: 'hear' },
      h('button', { class: 'btn', type: 'button', onclick: () => say(text, false) }, '🔊 Ouvir'),
      h('button', { class: 'btn', type: 'button', onclick: () => say(text, true) }, '🐢 Devagar'));
  }

  const MIC_ERRORS = {
    'not-allowed': 'O microfone está bloqueado. Toque no cadeado ao lado do endereço e permita o microfone.',
    'service-not-allowed': 'O microfone está bloqueado. Toque no cadeado ao lado do endereço e permita o microfone.',
    'no-speech': 'Não ouvi nada. Toque no microfone e fale um pouco mais alto.',
    'audio-capture': 'Não encontrei um microfone neste aparelho.',
    'network': 'O reconhecimento de voz precisa de internet. Verifique a conexão.',
  };

  function speakPanel(p) {
    const result = h('div', { class: 'result', 'aria-live': 'polite' });
    const micLabel = h('span', {}, 'Toque e fale');
    const mic = h('button', { class: 'mic', type: 'button', onclick: toggle },
      h('span', { class: 'mic-icon', 'aria-hidden': 'true' }, '🎤'), micLabel);

    function idle() {
      activeRec = null;
      mic.classList.remove('on');
      micLabel.textContent = 'Toque e fale';
    }

    function toggle() {
      if (activeRec) { activeRec.stop(); return; }
      stopAudio();
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 5;
      let settled = false;
      rec.onresult = (e) => {
        settled = true;
        showResult(L.best(p.en, Array.from(e.results[0]).map((a) => a.transcript)));
      };
      rec.onerror = (e) => {
        settled = true;
        if (e.error !== 'aborted') showError(MIC_ERRORS[e.error] || 'Não consegui ouvir. Tente de novo.');
      };
      rec.onend = () => {
        if (activeRec === rec) idle();
        if (!settled) showError(MIC_ERRORS['no-speech']);
      };
      try { rec.start(); } catch (e) { showError('Não consegui ligar o microfone. Tente de novo.'); return; }
      activeRec = rec;
      mic.classList.add('on');
      micLabel.textContent = 'Ouvindo… fale agora';
      result.replaceChildren();
    }

    function showError(msg) {
      result.replaceChildren(h('p', { class: 'notice bad' }, msg));
    }

    function showResult(r) {
      const missed = r.words.filter((w) => !w.ok);
      const level = r.score >= 90 ? 'good' : r.score >= 60 ? 'warn' : 'bad';
      const title = { good: 'Excelente! Deu para entender tudo.', warn: 'Quase lá!', bad: 'Vamos tentar de novo.' }[level];
      result.replaceChildren(
        h('div', { class: 'score ' + level }, h('b', {}, r.score + '%'), h('span', {}, title)),
        h('p', { class: 'words' }, r.words.map((w) => h('button', {
          type: 'button', class: 'word ' + (w.ok ? 'ok' : 'miss'),
          title: 'Ouvir esta palavra', onclick: () => say(w.text.replace(/[.,!?]/g, ''), true),
        }, w.text))),
        missed.length > 0 && h('p', { class: 'muted' },
          'As palavras em vermelho não foram entendidas. Toque nelas para ouvir, e tente de novo.'),
        h('p', { class: 'heard' }, 'O aplicativo ouviu: ', h('q', {}, r.heard)));
      save(p, 'speak', r.score, r.heard);
    }

    let micArea;
    if (!SR) {
      micArea = h('p', { class: 'notice bad' },
        'Este navegador não tem reconhecimento de voz. Abra o aplicativo no Google Chrome ou no Microsoft Edge.');
    } else if (!window.isSecureContext) {
      micArea = h('p', { class: 'notice bad' },
        'Para usar o microfone, abra o endereço que começa com https:// (mostrado na janela do servidor).');
    } else {
      micArea = mic;
    }

    return h('section', { class: 'card practice' },
      h('p', { class: 'phrase-en', lang: 'en' }, p.en),
      h('p', { class: 'phrase-pt' }, p.pt),
      p.tip && h('p', { class: 'tip' }, '💡 ', p.tip),
      hearButtons(p.en),
      micArea,
      result);
  }

  function listenPanel(p) {
    const target = L.tiles(p.en);
    let bank = L.shuffled(target).map((w, i) => ({ w, key: i }));
    let answer = [];
    let errors = 0;
    let done = false;

    const answerEl = h('div', { class: 'answer' });
    const bankEl = h('div', { class: 'chips' });
    const feedback = h('div', { 'aria-live': 'polite' });
    const checkBtn = h('button', { class: 'btn primary', type: 'button', onclick: check }, 'Conferir');
    const clearBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
      bank = bank.concat(answer); answer = []; feedback.replaceChildren(); draw();
    } }, 'Limpar');

    function chip(t, from, to) {
      return h('button', { class: 'chip', type: 'button', lang: 'en', disabled: done, onclick: () => {
        from.splice(from.indexOf(t), 1);
        to.push(t);
        draw();
      } }, t.w);
    }

    function draw() {
      answerEl.replaceChildren(...(answer.length
        ? answer.map((t) => chip(t, answer, bank))
        : [h('span', { class: 'muted' }, 'Toque nas palavras na ordem em que você ouviu.')]));
      bankEl.replaceChildren(...bank.map((t) => chip(t, bank, answer)));
    }

    function check() {
      if (bank.length) {
        feedback.replaceChildren(h('p', { class: 'notice warn' }, 'Use todas as palavras antes de conferir.'));
        return;
      }
      const right = answer.map((t) => t.w.toLowerCase()).join(' ') === target.join(' ').toLowerCase();
      if (!right) {
        errors += 1;
        feedback.replaceChildren(h('p', { class: 'notice bad' }, 'Ainda não. Ouça de novo, devagar, e troque a ordem.'));
        return;
      }
      done = true;
      checkBtn.disabled = true;
      clearBtn.disabled = true;
      draw();
      feedback.replaceChildren(
        h('div', { class: 'score good' }, h('b', {}, '✓'), h('span', {}, 'Muito bem! Você entendeu a frase.')),
        h('p', { class: 'phrase-en', lang: 'en' }, p.en),
        p.tip && h('p', { class: 'tip' }, '💡 ', p.tip));
      save(p, 'listen', Math.max(40, 100 - errors * 20), '');
    }

    draw();
    return h('section', { class: 'card practice' },
      h('p', { class: 'phrase-pt strong' }, 'Ouça e monte a frase em inglês'),
      h('p', { class: 'phrase-pt' }, 'Significado: ' + p.pt),
      hearButtons(p.en),
      answerEl, bankEl,
      h('div', { class: 'hear' }, clearBtn, checkBtn),
      feedback);
  }

  // ------------------------------------------------------------ account and users

  function viewAccount() {
    const msg = h('p', { class: 'form-error', role: 'alert' });
    const pwForm = h('form', { class: 'card' },
      h('h2', {}, 'Trocar a senha'),
      field('Senha atual', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' }),
      field('Nova senha (mínimo 8 caracteres)', { name: 'new', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }),
      msg, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar nova senha'));
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(pwForm);
      try {
        await api('/api/password', { current: f.get('current'), new: f.get('new') });
        pwForm.reset();
        msg.textContent = '';
        toast('Senha alterada.');
      } catch (ex) { msg.textContent = ex.message; }
    });

    const usersBox = h('section', { class: 'card' });
    if (S.user.is_admin) drawUsers(usersBox);

    return h('div', {},
      topbar('Conta', '#/'),
      h('main', { class: 'page' },
        h('section', { class: 'card row' },
          h('span', {}, 'Você entrou como ', h('b', {}, S.user.username)),
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            try { await api('/api/logout', {}); } catch (e) { /* session is gone either way */ }
            S.user = null;
            location.hash = '';
            render();
          } }, 'Sair')),
        pwForm,
        S.user.is_admin && usersBox));
  }

  async function drawUsers(box) {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', {},
      h('h3', {}, 'Criar nova conta'),
      field('Usuário', { name: 'username', required: true, autocapitalize: 'none', autocomplete: 'off' }),
      field('Senha (mínimo 8 caracteres)', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }),
      err, h('button', { class: 'btn primary', type: 'submit' }, 'Criar conta'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api('/api/users', { username: f.get('username'), password: f.get('password') });
        toast('Conta criada.');
        drawUsers(box);
      } catch (ex) { err.textContent = ex.message; }
    });

    let users = [];
    try { users = (await api('/api/users')).users; } catch (ex) { err.textContent = ex.message; }
    box.replaceChildren(
      h('h2', {}, 'Pessoas com acesso'),
      h('ul', { class: 'users' }, users.map((u) => h('li', {},
        h('span', {}, h('b', {}, u.username), u.is_admin ? ' (administrador)' : ''),
        !u.is_admin && h('span', { class: 'user-actions' },
          h('button', { class: 'btn small', type: 'button', onclick: async () => {
            const pw = window.prompt('Nova senha para ' + u.username + ' (mínimo 8 caracteres):');
            if (!pw) return;
            try { await api('/api/users/reset', { id: u.id, password: pw }); toast('Senha redefinida.'); }
            catch (ex) { toast(ex.message); }
          } }, 'Nova senha'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
            if (!window.confirm('Apagar a conta ' + u.username + ' e todo o progresso dela?')) return;
            try { await api('/api/users/delete', { id: u.id }); drawUsers(box); }
            catch (ex) { toast(ex.message); }
          } }, 'Apagar'))))),
      form);
  }

  // ------------------------------------------------------------ free conversation with the AI tutor

  const chat = { topic: null, items: [], busy: false, error: '' };
  let chatRedraw = () => {};
  const TOPICS = ['Meu dia', 'Minha família', 'Compras', 'Comida e receitas', 'Médico e saúde',
    'Escola dos filhos', 'Vizinhos e amigos', 'Viagens'];

  function recognize(lang, onDone, onFail, onState) {
    stopAudio();
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    let settled = false;
    rec.onresult = (e) => {
      settled = true;
      const r = e.results[0];
      onDone(Array.from(r).map((a) => a.transcript), r[0].confidence);
    };
    rec.onerror = (e) => {
      settled = true;
      if (e.error !== 'aborted') onFail(MIC_ERRORS[e.error] || 'Não consegui ouvir. Tente de novo.');
    };
    rec.onend = () => {
      if (activeRec === rec) activeRec = null;
      onState(false);
      if (!settled) onFail(MIC_ERRORS['no-speech']);
    };
    try { rec.start(); } catch (e) { onFail('Não consegui ligar o microfone. Tente de novo.'); return; }
    activeRec = rec;
    onState(true);
  }

  async function chatSend(heard) {
    if (chat.busy) return;
    chat.busy = true;
    chat.error = '';
    const history = chat.items.map((it) => (it.role === 'tutor'
      ? { role: 'assistant', text: it.en } : { role: 'user', text: it.text }));
    let mine = null;
    if (heard) {
      mine = { role: 'user', text: heard.text, lang: heard.lang, fb: null };
      chat.items.push(mine);
    }
    chatRedraw();
    try {
      const r = await api('/api/chat', { topic: chat.topic, messages: history, heard: heard || undefined });
      if (mine) mine.fb = r.feedback;
      chat.items.push({ role: 'tutor', en: r.reply_en, pt: r.reply_pt });
      chat.busy = false;
      chatRedraw();
      say(r.reply_en, false);
    } catch (e) {
      if (mine) chat.items.pop();
      chat.busy = false;
      chat.error = e.message;
      chatRedraw();
    }
  }

  function feedbackCard(fb) {
    if (!fb) return null;
    const tips = (fb.pronunciation || []).length > 0 && h('ul', { class: 'tips' }, fb.pronunciation.map((t) => h('li', {},
      h('button', { class: 'word miss', type: 'button', lang: 'en', onclick: () => say(t.word, true) }, '🔊 ' + t.word),
      h('span', {}, t.hint_pt))));
    if (fb.ok || !fb.better_en) {
      return h('div', { class: 'fb good' }, h('b', {}, '✓ Muito bem! '), fb.explanation_pt, tips);
    }
    const drill = h('div', { 'aria-live': 'polite' });
    const again = h('button', { class: 'btn small', type: 'button' }, '🎤 Repetir');
    if (SR && window.isSecureContext) {
      again.addEventListener('click', () => recognize('en-US',
        (alts) => {
          const r = L.best(fb.better_en, alts);
          drill.replaceChildren(
            h('p', { class: 'words' }, r.words.map((w) => h('span', { class: 'word ' + (w.ok ? 'ok' : 'miss') }, w.text))),
            h('p', { class: 'muted small' }, r.score >= 90 ? 'Perfeito! ' + r.score + '%' : r.score + '%. Ouça e tente mais uma vez.'));
        },
        (msg) => drill.replaceChildren(h('p', { class: 'muted small' }, msg)),
        (on) => { again.textContent = on ? 'Ouvindo…' : '🎤 Repetir'; }));
    }
    return h('div', { class: 'fb fix' },
      h('span', { class: 'fb-label' }, 'Melhor assim:'),
      h('p', { class: 'better', lang: 'en' }, fb.better_en),
      h('div', { class: 'fb-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => say(fb.better_en, false) }, '🔊 Ouvir'),
        h('button', { class: 'btn small', type: 'button', onclick: () => say(fb.better_en, true) }, '🐢 Devagar'),
        SR && window.isSecureContext && again),
      fb.explanation_pt && h('p', { class: 'fb-why' }, fb.explanation_pt),
      tips, drill);
  }

  function bubble(it) {
    if (it.role === 'user') {
      return h('div', { class: 'turn mine' },
        h('p', { class: 'bubble' }, (it.lang === 'pt-BR' ? '🇧🇷 ' : '') + it.text),
        feedbackCard(it.fb));
    }
    const pt = h('p', { class: 'bubble-pt', hidden: true }, it.pt);
    return h('div', { class: 'turn tutor' },
      h('div', { class: 'bubble' }, h('p', { lang: 'en' }, it.en), pt,
        h('div', { class: 'fb-actions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => say(it.en, false) }, '🔊'),
          h('button', { class: 'btn small', type: 'button', onclick: () => say(it.en, true) }, '🐢'),
          it.pt && h('button', { class: 'btn small', type: 'button', onclick: () => { pt.hidden = !pt.hidden; } }, 'Tradução'))));
  }

  function viewChat() {
    if (!S.ai) {
      return h('div', {}, topbar('💬 Conversar', '#/'), h('main', { class: 'page' },
        h('p', { class: 'notice warn' }, 'A conversa com a Amy ainda não foi ativada. ',
          S.user.is_admin ? 'Configure a variável ANTHROPIC_API_KEY no servidor (veja o README) e reinicie o aplicativo.'
            : 'Peça ao administrador para ativar.')));
    }
    if (!chat.topic) {
      const start = (topic) => { chat.topic = topic; chat.items = []; chat.error = ''; render(); };
      const form = h('form', { class: 'row-form' },
        h('input', { name: 'topic', placeholder: 'Outro assunto…', maxlength: 80, 'aria-label': 'Outro assunto' }),
        h('button', { class: 'btn primary', type: 'submit' }, 'Começar'));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const t = new FormData(form).get('topic').trim();
        if (t) start(t);
      });
      return h('div', {}, topbar('💬 Conversar', '#/'), h('main', { class: 'page' },
        h('h1', {}, 'Sobre o que você quer conversar?'),
        h('p', { class: 'muted' }, 'A Amy fala inglês simples e devagar. Você pode pedir a tradução a qualquer momento.'),
        h('div', { class: 'topic-list' }, TOPICS.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => start(t) }, t))),
        form));
    }

    const list = h('div', { class: 'chat-list' });
    const status = h('p', { class: 'chat-status', 'aria-live': 'polite' });
    const canTalk = SR && window.isSecureContext;
    const send = (text, lang, extra) => chatSend(Object.assign({ text, lang }, extra));
    const mic = h('button', { class: 'chat-mic', type: 'button' }, '🎤 Falar');
    const micPt = h('button', { class: 'btn small', type: 'button' }, '🇧🇷 Não sei dizer em inglês');
    const listenWith = (btn, lang, idle) => () => {
      if (activeRec) { activeRec.stop(); return; }
      recognize(lang,
        (alts, confidence) => send(alts[0], lang, { alternatives: alts.slice(1), confidence }),
        (msg) => { chat.error = msg; chatRedraw(); },
        (on) => { btn.classList.toggle('on', on); btn.textContent = on ? 'Ouvindo… fale agora' : idle; });
    };
    mic.addEventListener('click', listenWith(mic, 'en-US', '🎤 Falar'));
    micPt.addEventListener('click', listenWith(micPt, 'pt-BR', '🇧🇷 Não sei dizer em inglês'));
    const typed = h('form', { class: 'row-form' },
      h('input', { name: 'text', placeholder: 'ou escreva aqui…', maxlength: 300, autocomplete: 'off', 'aria-label': 'Escreva sua frase' }),
      h('button', { class: 'btn', type: 'submit' }, 'Enviar'));
    typed.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = new FormData(typed).get('text').trim();
      if (!t || chat.busy) return;
      typed.reset();
      send(t, 'en-US', { typed: true });
    });

    chatRedraw = () => {
      list.replaceChildren(...chat.items.map(bubble));
      status.className = 'chat-status' + (chat.error ? ' notice bad' : ' muted');
      status.textContent = chat.error || (chat.busy ? 'A Amy está pensando…' : '');
      mic.disabled = micPt.disabled = chat.busy;
      status.scrollIntoView({ block: 'end' });
    };
    const view = h('div', {},
      topbar('💬 ' + chat.topic, '#/'),
      h('main', { class: 'page chat-page' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { chat.topic = null; chat.items = []; render(); } }, 'Trocar de assunto'),
        list, status),
      h('footer', { class: 'chat-bar' },
        canTalk ? [mic, micPt] : h('p', { class: 'muted small' }, 'Sem microfone neste navegador: escreva a sua frase.'),
        typed));
    chatRedraw();
    if (!chat.items.length && !chat.busy) chatSend(null);
    return view;
  }

  boot();
})();
