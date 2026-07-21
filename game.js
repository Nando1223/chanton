/* ============================================================
   CHANTON N' CHANTON — Lógica Multijugador v3 (Firebase)
   ============================================================ */

// ---- CAMPOS DEL JUEGO ----
const FIELDS = [
  { key: 'apellido', label: 'Apellido', icon: '👤' },
  { key: 'nombre',   label: 'Nombre',   icon: '🧑' },
  { key: 'ciudad',   label: 'Ciudad',   icon: '🏙️' },
  { key: 'pais',     label: 'País',     icon: '🌎' },
  { key: 'color',    label: 'Color',    icon: '🎨' },
  { key: 'animal',   label: 'Animal',   icon: '🐾' },
  { key: 'cosa',     label: 'Cosa',     icon: '📦' },
  { key: 'fruta',    label: 'Fruta',    icon: '🍎' },
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ---- ESTADO LOCAL ----
let me = {
  name:   '',
  slot:   '',      // 'p1' o 'p2'
  roomCode: '',
};

let roomRef   = null;  // referencia Firebase al room
let listeners = [];    // para limpiar listeners al salir

// ---- INIT FIREBASE ----
let db;
try {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.database();
} catch(e) {
  console.error('Firebase no configurado:', e);
}

// ================================================================
//  PANTALLA DE INICIO
// ================================================================
function createRoom() {
  const name = document.getElementById('my-name').value.trim();
  const code = document.getElementById('room-code').value.trim().toUpperCase();
  if (!validateInputs(name, code)) return;

  const ref = db.ref(`rooms/${code}`);
  // Siempre sobreescribe — permite reusar el mismo código
  me = { name, slot: 'p1', roomCode: code };
  ref.set({
    status: 'waiting',
    round:  0,
    letter: '',
    p1: { name, score: 0, finished: false, answers: emptyAnswers(), scoredThisRound: false },
    p2: { name: '', score: 0, finished: false, answers: emptyAnswers(), scoredThisRound: false },
  }).then(() => {
    enterWaitingScreen(code, name);
    listenForOpponent(ref);
  });
}

function joinRoom() {
  const name = document.getElementById('my-name').value.trim();
  const code = document.getElementById('room-code').value.trim().toUpperCase();
  if (!validateInputs(name, code)) return;

  const ref = db.ref(`rooms/${code}`);
  ref.once('value').then(snap => {
    if (!snap.exists()) {
      showError('Sala no encontrada. Verifica el código.');
      return;
    }
    const data = snap.val();
    if (data.p2 && data.p2.name) {
      showError('La sala ya está completa.');
      return;
    }
    // Unirse como p2
    me = { name, slot: 'p2', roomCode: code };
    ref.child('p2').update({ name, score: data.p2?.score || 0, finished: false, answers: emptyAnswers(), scoredThisRound: false })
      .then(() => {
        // Marcar sala como lista
        ref.child('status').set('ready');
        enterWaitingScreen(code, name);
        listenForGameStart(ref);
      });
  });
}

function validateInputs(name, code) {
  hideError();
  if (!name) { showError('Escribe tu nombre.'); return false; }
  if (!code)  { showError('Escribe el código de sala.'); return false; }
  if (!db)    { showError('Firebase no está configurado. Revisa firebase-config.js'); return false; }
  return true;
}

function showError(msg) {
  document.getElementById('room-error-msg').textContent = msg;
  document.getElementById('room-error').classList.remove('hidden');
}
function hideError() {
  document.getElementById('room-error').classList.add('hidden');
}

// ================================================================
//  PANTALLA DE ESPERA
// ================================================================
function enterWaitingScreen(code, myName) {
  document.getElementById('waiting-code').textContent    = code;
  document.getElementById('waiting-my-name').textContent = myName;
  document.getElementById('waiting-msg').textContent     = 'Esperando al otro jugador...';
  showScreen('screen-waiting');
}

// p1 espera a que p2 entre → cuando status cambie a 'ready'
function listenForOpponent(ref) {
  roomRef = ref;
  const unsub = ref.child('status').on('value', snap => {
    if (snap.val() === 'ready') {
      ref.child('status').off('value', unsub);
      startGame();
    }
  });
  listeners.push(() => ref.child('status').off('value', unsub));
}

// p2 ya está en sala, espera que p1 inicie ronda
function listenForGameStart(ref) {
  roomRef = ref;
  const unsub = ref.child('round').on('value', snap => {
    if (snap.val() > 0) {
      ref.child('round').off('value', unsub);
      startGame();
    }
  });
  listeners.push(() => ref.child('round').off('value', unsub));
}

function leaveRoom() {
  cleanupListeners();
  // Si eres el host (p1), borra la sala para liberar el código
  if (me.slot === 'p1' && roomRef) {
    roomRef.remove();
  }
  me = { name: '', slot: '', roomCode: '' };
  showScreen('screen-start');
}

// ================================================================
//  INICIO DEL JUEGO
// ================================================================
function startGame() {
  showScreen('screen-game');

  // Nombre del jugador en el panel
  document.getElementById('my-panel-name').textContent = `✏️ ${me.name} — tus respuestas`;

  // Construir mis campos
  buildMyFields();

  // Sincronizar todo en tiempo real
  listenRoom();

  // Si es p1 y el round es 0, iniciar primera ronda
  if (me.slot === 'p1') {
    roomRef.child('round').once('value').then(snap => {
      if (snap.val() === 0) startRound();
    });
  }
}

// ================================================================
//  LISTENERS EN TIEMPO REAL
// ================================================================
function listenRoom() {
  // Nombres en header
  ['p1','p2'].forEach((slot, i) => {
    const unsub = roomRef.child(`${slot}/name`).on('value', snap => {
      document.getElementById(`score-name-${slot}`).textContent = snap.val() || '—';
    });
    listeners.push(() => roomRef.child(`${slot}/name`).off('value', unsub));
  });

  // Puntajes
  ['p1','p2'].forEach(slot => {
    const unsub = roomRef.child(`${slot}/score`).on('value', snap => {
      document.getElementById(`score-${slot}-total`).textContent = snap.val() || 0;
    });
    listeners.push(() => roomRef.child(`${slot}/score`).off('value', unsub));
  });

  // Letra
  const unsubLetter = roomRef.child('letter').on('value', snap => {
    const letter = snap.val() || '';
    document.getElementById('letter-badge').textContent = letter || '?';
    if (letter === '') {
      showLetterPicker();
    } else {
      document.getElementById('letter-overlay').classList.add('hidden');
    }
  });
  listeners.push(() => roomRef.child('letter').off('value', unsubLetter));

  // Ronda
  const unsubRound = roomRef.child('round').on('value', snap => {
    document.getElementById('round-label').textContent = `Ronda ${snap.val() || 1}`;
  });
  listeners.push(() => roomRef.child('round').off('value', unsubRound));

  // Status
  const unsubStatus = roomRef.child('status').on('value', snap => {
    const status = snap.val();

    if (status === 'new-round') {
      // Limpiar y preparar nueva ronda
      handleNewRoundSignal();
    }

    if (status === 'scoring') {
      // Abrir overlay de puntaje
      openScoringOverlay();
    }
  });
  listeners.push(() => roomRef.child('status').off('value', unsubStatus));

  // Finished del otro jugador → mostrar cuenta regresiva
  const otherSlot = me.slot === 'p1' ? 'p2' : 'p1';
  const unsubFinished = roomRef.child(`${otherSlot}/finished`).on('value', snap => {
    if (snap.val() === true) {
      // El otro terminó → cuenta regresiva para mí si yo no he terminado
      roomRef.child(`${me.slot}/finished`).once('value').then(mySnap => {
        if (!mySnap.val()) {
          showCountdown();
        }
      });
    }
  });
  listeners.push(() => roomRef.child(`${otherSlot}/finished`).off('value', unsubFinished));

  // Ambos terminaron → abrir scoring
  ['p1','p2'].forEach(slot => {
    roomRef.child(`${slot}/finished`).on('value', () => {
      checkBothFinished();
    });
  });

  // Ambos puntuaron por completo -> mostrar ganador
  ['p1','p2'].forEach(slot => {
    roomRef.child(`${slot}/pointsComplete`).on('value', () => {
      checkPointsComplete();
    });
  });
}

function checkBothFinished() {
  roomRef.once('value').then(snap => {
    const data = snap.val();
    if (data.p1.finished && data.p2.finished && data.status === 'playing') {
      roomRef.child('status').set('scoring');
    }
  });
}

function checkPointsComplete() {
  roomRef.once('value').then(snap => {
    const data = snap.val();
    if (data.status === 'scoring' && data.p1.pointsComplete && data.p2.pointsComplete && !data.winnerShown) {
      roomRef.child('winnerShown').set(true).then(() => {
        declareRoundWinner(data);
      });
    }
  });
}

// ================================================================
//  RONDA
// ================================================================
function startRound() {
  roomRef.once('value').then(snap => {
    const round = (snap.val().round || 0) + 1;
    roomRef.update({
      round:  round,
      letter: '',
      status: 'playing',
      winnerShown: false,
      p1: { ...snap.val().p1, finished: false, answers: emptyAnswers(), pointsComplete: false, points: emptyAnswers(), baseScore: snap.val().p1.score || 0 },
      p2: { ...snap.val().p2, finished: false, answers: emptyAnswers(), pointsComplete: false, points: emptyAnswers(), baseScore: snap.val().p2.score || 0 },
    }).then(() => {
      resetMyFields();
      enableFinishButton();
    });
  });
}

function handleNewRoundSignal() {
  resetMyFields();
  document.getElementById('btn-finish-me').style.display = 'inline-block';
  enableFinishButton();
  document.getElementById('btn-new-round').style.display = 'none';
  document.getElementById('letter-badge').textContent = '?';
}

// ================================================================
//  SELECTOR DE LETRA
// ================================================================
function showLetterPicker() {
  const overlay = document.getElementById('letter-overlay');
  const bigEl   = document.getElementById('letter-reveal-big');
  const goBtn   = document.getElementById('btn-letter-go');
  const preText = document.querySelector('.letter-reveal-pre');
  const picker  = document.getElementById('letter-picker');

  if (me.slot === 'p2') {
    preText.textContent = "⏳ Esperando al anfitrión...";
    bigEl.textContent   = "🤔";
    picker.innerHTML    = "<p style='color:var(--text-muted); margin-top:20px;'>El creador de la sala está eligiendo la letra.</p>";
    goBtn.style.display = 'none';
    overlay.classList.remove('hidden');
    return;
  }

  // Host (p1)
  preText.textContent = "⚡ ¿Con qué letra jugamos?";
  goBtn.style.display = 'inline-block';
  bigEl.textContent   = '?';
  goBtn.disabled      = true;

  buildLetterPicker();
  overlay.classList.remove('hidden');
}

function buildLetterPicker() {
  const container = document.getElementById('letter-picker');
  container.innerHTML = '';
  LETTERS.forEach(letter => {
    const btn       = document.createElement('button');
    btn.className   = 'letter-btn';
    btn.textContent = letter;
    btn.id          = `lbtn-${letter}`;
    btn.onclick     = () => selectLetter(letter);
    container.appendChild(btn);
  });
}

let chosenLetter = '';

function selectLetter(letter) {
  document.querySelectorAll('.letter-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById(`lbtn-${letter}`).classList.add('selected');
  const bigEl = document.getElementById('letter-reveal-big');
  bigEl.textContent = letter;
  bigEl.style.animation = 'none';
  requestAnimationFrame(() => { bigEl.style.animation = ''; });
  chosenLetter = letter;
  document.getElementById('btn-letter-go').disabled = false;
}

function confirmLetter() {
  if (!chosenLetter) return;
  // Guardar la letra en Firebase → se sincroniza a ambos
  roomRef.child('letter').set(chosenLetter);
  document.getElementById('letter-overlay').classList.add('hidden');
}

// ================================================================
//  CAMPOS DE JUEGO
// ================================================================
function buildMyFields() {
  const container = document.getElementById('my-fields');
  container.innerHTML = '';

  FIELDS.forEach(field => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.id        = `row-${field.key}`;

    row.innerHTML = `
      <div class="field-label">
        <span class="field-icon">${field.icon}</span>
        <span>${field.label}</span>
      </div>
      <div class="field-answers">
        <input
          class="field-input"
          id="inp-${field.key}"
          type="text"
          placeholder="${field.label}…"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="words"
          spellcheck="false"
          oninput="saveAnswerDebounced('${field.key}', this.value)"
        />
        <!-- Respuesta del oponente -->
        <div class="opp-answer hidden" id="opp-box-${field.key}">
          <span class="opp-name" id="opp-name-${field.key}"></span>
          <span class="opp-text" id="opp-text-${field.key}"></span>
        </div>
      </div>
      <div class="score-col hidden" id="scol-${field.key}">
        <input
          class="score-input"
          id="myscore-${field.key}"
          type="number"
          min="0" max="100"
          placeholder="0"
          oninput="updateLiveScore()"
        />
      </div>
    `;
    container.appendChild(row);
  });
}

function resetMyFields() {
  FIELDS.forEach(field => {
    const inp  = document.getElementById(`inp-${field.key}`);
    const scol = document.getElementById(`scol-${field.key}`);
    const oppBox = document.getElementById(`opp-box-${field.key}`);
    const myscore = document.getElementById(`myscore-${field.key}`);

    if (inp)  { inp.value = ''; inp.disabled = false; }
    if (scol) { scol.classList.add('hidden'); scol.style.display = 'none'; }
    if (oppBox) { oppBox.classList.add('hidden'); oppBox.style.display = 'none'; }
    if (myscore) myscore.value = '';
  });
  document.getElementById('inline-score-actions').classList.add('hidden');
}

// Guardar respuestas en Firebase con debounce
let saveTimers = {};
function saveAnswerDebounced(key, value) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => {
    roomRef.child(`${me.slot}/answers/${key}`).set(value);
  }, 400);
}

// ================================================================
//  FINALIZAR
// ================================================================
function handleFinish() {
  // Deshabilitar inputs
  FIELDS.forEach(field => {
    const inp = document.getElementById(`inp-${field.key}`);
    if (inp) inp.disabled = true;
  });

  // Marcar como finalizado en Firebase
  roomRef.child(`${me.slot}/finished`).set(true);

  const btn = document.getElementById('btn-finish-me');
  btn.disabled = true;
  btn.classList.add('done');
  btn.textContent = '✔ ¡Listo!';
}

function enableFinishButton() {
  const btn = document.getElementById('btn-finish-me');
  btn.disabled = false;
  btn.classList.remove('done');
  btn.textContent = '✅ Finalizar';
}

// ================================================================
//  SONIDOS (AudioContext)
// ================================================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration, vol) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playTick() {
  playTone(800, 'sine', 0.1, 0.3);
}

function playAlarm() {
  playTone(400, 'square', 0.3, 0.3);
  setTimeout(() => playTone(500, 'square', 0.3, 0.3), 150);
  setTimeout(() => playTone(600, 'square', 0.4, 0.3), 300);
}

// ================================================================
//  CUENTA REGRESIVA
// ================================================================
function showCountdown() {
  const overlay = document.getElementById('countdown-overlay');
  const numEl   = document.getElementById('countdown-number');
  overlay.classList.remove('hidden');

  let count = 10;
  numEl.textContent = count;
  
  // Alarma inicial
  playAlarm();

  const interval = setInterval(() => {
    count--;
    numEl.textContent = count;
    numEl.style.filter = 'brightness(1.6)';
    setTimeout(() => { numEl.style.filter = 'brightness(1)'; }, 180);

    if (count > 0) {
      playTick();
    }

    if (count <= 0) {
      clearInterval(interval);
      overlay.classList.add('hidden');
      
      // Solo bloqueamos los inputs, el usuario aún debe presionar "Finalizar"
      FIELDS.forEach(field => {
        const inp = document.getElementById(`inp-${field.key}`);
        if (inp) inp.disabled = true;
      });
    }
  }, 1000);
}

// ================================================================
//  PUNTUACIÓN
// ================================================================
function openScoringOverlay() {
  document.getElementById('btn-finish-me').style.display = 'none';

  roomRef.once('value').then(snap => {
    const data = snap.val();
    const otherSlot = me.slot === 'p1' ? 'p2' : 'p1';
    const oppName = data[otherSlot].name || 'Oponente';

    FIELDS.forEach(field => {
      // 1. Mostrar input de puntos
      const scol = document.getElementById(`scol-${field.key}`);
      if (scol) {
        scol.classList.remove('hidden');
        scol.style.display = 'flex';
      }
      
      // 2. Llenar y mostrar respuesta del oponente
      const oppValue = data[otherSlot].answers?.[field.key] || '(vacío)';
      document.getElementById(`opp-name-${field.key}`).textContent = oppName + ':';
      document.getElementById(`opp-text-${field.key}`).textContent = oppValue;
      
      const oppBox = document.getElementById(`opp-box-${field.key}`);
      if (oppBox) {
        oppBox.classList.remove('hidden');
        oppBox.style.display = 'block';
      }
      
      // Colorear el oponente (p1 vs p2 colors)
      document.getElementById(`opp-name-${field.key}`).style.color = otherSlot === 'p1' ? 'var(--p1-color)' : 'var(--p2-color)';
    });

    // 3. Mostrar el botón de guardar puntaje abajo
    document.getElementById('inline-score-actions').classList.remove('hidden');
  });
}

function updateLiveScore() {
  let roundTotal = 0;
  let allFilled = true;
  let myPoints = {};

  FIELDS.forEach(field => {
    const val = document.getElementById(`myscore-${field.key}`)?.value;
    if (val === '' || val === null || val === undefined) {
      allFilled = false;
    } else {
      roundTotal += parseInt(val) || 0;
    }
    myPoints[field.key] = val || '';
  });

  // Sumar al puntaje base y subir a Firebase en vivo
  roomRef.child(`${me.slot}/baseScore`).once('value').then(snap => {
    const base = snap.val() || 0;
    roomRef.child(`${me.slot}/score`).set(base + roundTotal);
  });
  
  roomRef.child(`${me.slot}/points`).set(myPoints);
  roomRef.child(`${me.slot}/pointsComplete`).set(allFilled);
}

function declareRoundWinner(data) {
  let p1Round = 0;
  let p2Round = 0;

  Object.values(data.p1.points || {}).forEach(v => p1Round += parseInt(v) || 0);
  Object.values(data.p2.points || {}).forEach(v => p2Round += parseInt(v) || 0);

  const overlay = document.getElementById('winner-overlay');
  const msgEl = document.getElementById('winner-msg');
  const ptsEl = document.getElementById('winner-pts');

  if (p1Round > p2Round) {
    msgEl.textContent = `¡${data.p1.name || 'J1'} ganó la ronda!`;
    ptsEl.textContent = `${p1Round} pts`;
  } else if (p2Round > p1Round) {
    msgEl.textContent = `¡${data.p2.name || 'J2'} ganó la ronda!`;
    ptsEl.textContent = `${p2Round} pts`;
  } else {
    msgEl.textContent = `¡Empate!`;
    ptsEl.textContent = `${p1Round} pts`;
  }

  overlay.classList.remove('hidden');

  // Mostrar botón para nueva ronda (SOLO el host puede iniciarlo)
  if (me.slot === 'p1') {
    document.getElementById('btn-new-round').style.display = 'inline-block';
  } else {
    document.getElementById('btn-new-round').style.display = 'none';
  }
}

function closeWinnerOverlay() {
  document.getElementById('winner-overlay').classList.add('hidden');
}

// ================================================================
//  NUEVA RONDA
// ================================================================
function newRound() {
  document.getElementById('btn-new-round').style.display = 'none';

  roomRef.once('value').then(snap => {
    const d     = snap.val();
    const round = (d.round || 0) + 1;

    roomRef.update({
      round:  round,
      letter: '',
      status: 'new-round',
    }).then(() => {
      // Resetear finished y scoredThisRound
      roomRef.child('p1').update({ finished: false, answers: emptyAnswers(), scoredThisRound: false });
      roomRef.child('p2').update({ finished: false, answers: emptyAnswers(), scoredThisRound: false });
      // Cambiar a playing después de un momento
      setTimeout(() => roomRef.child('status').set('playing'), 500);
    });
  });
}

// ================================================================
//  UTILIDADES
// ================================================================
function emptyAnswers() {
  const obj = {};
  FIELDS.forEach(f => { obj[f.key] = ''; });
  return obj;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function cleanupListeners() {
  listeners.forEach(fn => fn());
  listeners = [];
  roomRef   = null;
}

// ---- ENTER avanza input ----
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const all = Array.from(document.querySelectorAll('.field-input:not(:disabled)'));
    const idx = all.indexOf(document.activeElement);
    if (idx !== -1 && idx < all.length - 1) all[idx + 1].focus();
  }
});
