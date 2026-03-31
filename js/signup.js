// ═══════════════════════════════════════════
//  AIRBRUSH — signup.js
//  Sign Up: hand auth + face 2FA capture
// ═══════════════════════════════════════════

// ── STATE ────────────────────────────────
const state = {
  name: '',
  email: '',
  method: '',
  authData: null,
  faceDescriptor: null,
  isDrawing: false,
  drawPoints: [],
  pinDigits: [],
  pinCurrentDigit: 0,
  pinCurrentCount: -1,
  pinTimer: null,
  pinCountdown: 3,
  modelsLoaded: false,
  cameraReady: false,
};

// ── DOM REFS ─────────────────────────────
const step1El    = document.getElementById('step1');
const step2El    = document.getElementById('step2');
const step3El    = document.getElementById('step3');
const inpName    = document.getElementById('inp-name');
const inpEmail   = document.getElementById('inp-email');
const methodCards= document.querySelectorAll('.method-card');
const btnNext    = document.getElementById('btn-step1-next');
const btnBack    = document.getElementById('btn-back');
const btnDone    = document.getElementById('btn-done');
const btnStart   = document.getElementById('btn-start');
const btnStop    = document.getElementById('btn-stop');
const btnClear   = document.getElementById('btn-clear-draw');
const err1       = document.getElementById('step1-error');
const err2       = document.getElementById('step2-error');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const step2Title = document.getElementById('step2-title');
const step2Sub   = document.getElementById('step2-sub');
const drawBox    = document.getElementById('draw-box');
const pinBox     = document.getElementById('pin-box');
const drawCtrl   = document.getElementById('draw-controls');
const pinCtrl    = document.getElementById('pin-controls');

// Canvas & video elements
const webcamEl       = document.getElementById('webcam');
const overlayCanvas  = document.getElementById('overlay-canvas');
const drawCanvas     = document.getElementById('draw-canvas');
const faceCanvas     = document.getElementById('face-canvas');
const overlayCtx     = overlayCanvas.getContext('2d');
const drawCtx        = drawCanvas.getContext('2d');

// ── STEP 1 LOGIC ─────────────────────────
methodCards.forEach(card => {
  card.addEventListener('click', () => {
    methodCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.method = card.dataset.method;
  });
});

btnNext.addEventListener('click', () => {
  const name  = inpName.value.trim();
  const email = inpEmail.value.trim();

  if (!name) return showError(err1, 'Please enter your name.');
  if (!email || !email.includes('@')) return showError(err1, 'Please enter a valid email.');
  if (!state.method) return showError(err1, 'Please select an authentication method.');

  // Check if email already used
  const users = JSON.parse(localStorage.getItem('airbrush_users') || '[]');
  if (users.find(u => u.email === email)) {
    return showError(err1, 'This email is already registered. Please log in.');
  }

  hideError(err1);
  state.name  = name;
  state.email = email;
  goToStep2();
});

// ── STEP 2 — SETUP ───────────────────────
function goToStep2() {
  step1El.style.display = 'none';
  step2El.style.display = 'flex';

  // Configure UI based on method
  const titles = {
    sign:    ['Set up your Air Signature', 'Draw your unique signature in the air using your index finger.'],
    pattern: ['Set up your Air Pattern',   'Draw a secret pattern gesture in the air using your index finger.'],
    pin:     ['Set up your Finger PIN',    'Raise fingers to input each digit. Both hands are summed automatically.'],
  };
  step2Title.textContent = titles[state.method][0];
  step2Sub.textContent   = titles[state.method][1];

  if (state.method === 'pin') {
    drawBox.style.display  = 'none';
    pinBox.style.display   = 'block';
    drawCtrl.style.display = 'none';
    pinCtrl.style.display  = 'block';
  } else {
    drawBox.style.display  = 'block';
    pinBox.style.display   = 'none';
    drawCtrl.style.display = 'flex';
    pinCtrl.style.display  = 'none';
  }

  initDrawCanvas();
  startCamera();
}

// ── INIT DRAW CANVAS ─────────────────────
function initDrawCanvas() {
  drawCanvas.width  = drawCanvas.offsetWidth  || 400;
  drawCanvas.height = drawCanvas.offsetHeight || 300;
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  state.drawPoints = [];
}

// ── CAMERA & MEDIAPIPE ───────────────────
async function startCamera() {
  setStatus('loading', 'Loading AI models...');

  try {
    // Load face-api models from public CDN
    const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    ]);
    state.modelsLoaded = true;
    setStatus('loading', 'Starting webcam...');
  } catch (e) {
    setStatus('error', 'Could not load face models. Check your internet connection.');
    showError(err2, 'Face model load failed: ' + e.message);
    return;
  }

  // Setup MediaPipe Hands
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });

  hands.onResults(onHandResults);

  // Start camera via MediaPipe Camera utils
  const camera = new Camera(webcamEl, {
    onFrame: async () => {
      overlayCanvas.width  = webcamEl.videoWidth  || 640;
      overlayCanvas.height = webcamEl.videoHeight || 480;
      await hands.send({ image: webcamEl });
    },
    width: 640,
    height: 480,
  });

  camera.start().then(() => {
    state.cameraReady = true;
    setStatus('ready', 'Camera ready — hand tracking active ✓');

    // Capture face after 2 seconds of camera warmup
    setTimeout(captureFace, 2000);

    // For PIN mode — start immediately
    if (state.method === 'pin') {
      updatePinUI();
    }
  }).catch(e => {
    setStatus('error', 'Camera access denied. Please allow webcam access.');
    showError(err2, 'Camera error: ' + e.message);
  });
}

// ── HAND RESULTS CALLBACK ────────────────
function onHandResults(results) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

  results.multiHandLandmarks.forEach((landmarks, i) => {
    // Draw skeleton
    drawConnectors(overlayCtx, landmarks, HAND_CONNECTIONS, { color: 'rgba(124,58,237,0.7)', lineWidth: 2 });
    drawLandmarks(overlayCtx, landmarks, { color: '#06B6D4', lineWidth: 1, radius: 3 });
  });

  if (state.method === 'pin') {
    handlePIN(results);
  } else {
    handleDrawing(results);
  }
}

// ── DRAWING HANDLER (Sign / Pattern) ─────
function handleDrawing(results) {
  if (!state.isDrawing) return;

  const landmarks = results.multiHandLandmarks[0];
  if (!landmarks) return;

  // Index fingertip = landmark 8
  const tip = landmarks[8];

  // Convert normalised coords to draw canvas coords
  const x = (1 - tip.x) * drawCanvas.width;  // mirror
  const y = tip.y * drawCanvas.height;

  state.drawPoints.push({ x, y });

  // Draw on canvas
  drawCtx.strokeStyle = '#6C63FF';
  drawCtx.lineWidth   = 3;
  drawCtx.lineCap     = 'round';
  drawCtx.lineJoin    = 'round';

  if (state.drawPoints.length > 1) {
    const prev = state.drawPoints[state.drawPoints.length - 2];
    drawCtx.beginPath();
    drawCtx.moveTo(prev.x, prev.y);
    drawCtx.lineTo(x, y);
    drawCtx.stroke();
  }
}

// ── PIN HANDLER ──────────────────────────
function handlePIN(results) {
  if (state.pinCurrentDigit >= 4) return;

  let totalFingers = 0;

  results.multiHandLandmarks.forEach((landmarks, i) => {
    const handedness = results.multiHandedness[i].label; // 'Left' or 'Right'
    totalFingers += countFingers(landmarks, handedness);
  });

  document.getElementById('finger-count').textContent = totalFingers;

  if (totalFingers === state.pinCurrentCount) {
    // Same count — timer is already running, do nothing
  } else {
    // Count changed — reset timer
    state.pinCurrentCount = totalFingers;
    clearPinTimer();

    if (totalFingers > 0) {
      // Start 3-second countdown
      document.getElementById('pin-timer-wrap').style.display = 'block';
      state.pinCountdown = 3;
      document.getElementById('pin-timer').textContent = 3;

      state.pinTimer = setInterval(() => {
        state.pinCountdown--;
        document.getElementById('pin-timer').textContent = state.pinCountdown;

        if (state.pinCountdown <= 0) {
          clearPinTimer();
          confirmPinDigit(totalFingers);
        }
      }, 1000);
    } else {
      document.getElementById('pin-timer-wrap').style.display = 'none';
    }
  }
}

function countFingers(landmarks, handedness) {
  // Fingertip and pip indices: [tip, pip]
  const fingerPairs = [
    [8, 6],   // index
    [12, 10], // middle
    [16, 14], // ring
    [20, 18], // pinky
  ];

  let count = fingerPairs.filter(([tip, pip]) =>
    landmarks[tip].y < landmarks[pip].y
  ).length;

  // Thumb: compare x positions based on hand side
  const thumbTip = landmarks[4];
  const thumbIp  = landmarks[3];
  if (handedness === 'Right') {
    if (thumbTip.x < thumbIp.x) count++;
  } else {
    if (thumbTip.x > thumbIp.x) count++;
  }

  return count;
}

function clearPinTimer() {
  if (state.pinTimer) { clearInterval(state.pinTimer); state.pinTimer = null; }
  document.getElementById('pin-timer-wrap').style.display = 'none';
}

function confirmPinDigit(value) {
  const clamped = Math.min(value, 9); // max 9 per digit
  state.pinDigits.push(clamped);

  // Fill digit display
  const digitEl = document.getElementById(`pd${state.pinCurrentDigit}`);
  digitEl.textContent = clamped;
  digitEl.classList.add('filled');
  digitEl.classList.remove('active');

  state.pinCurrentDigit++;
  state.pinCurrentCount = -1;

  if (state.pinCurrentDigit >= 4) {
    // PIN complete
    state.authData = state.pinDigits.slice();
    setStatus('ready', 'PIN set successfully ✓');
    document.getElementById('pin-current').textContent = 'PIN complete! ✓';
    btnDone.disabled = false;
  } else {
    updatePinUI();
  }
}

function updatePinUI() {
  document.getElementById('pin-current').textContent =
    `Entering digit ${state.pinCurrentDigit + 1} of 4`;
  const nextDigit = document.getElementById(`pd${state.pinCurrentDigit}`);
  if (nextDigit) nextDigit.classList.add('active');
}

// ── FACE CAPTURE ─────────────────────────
async function captureFace() {
  if (!state.modelsLoaded) return;

  try {
    const detection = await faceapi
      .detectSingleFace(webcamEl, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection) {
      state.faceDescriptor = Array.from(detection.descriptor);
      setStatus('ready', 'Face captured + Hand tracking active ✓');
    } else {
      // Retry every 2 seconds
      setTimeout(captureFace, 2000);
      setStatus('loading', 'Looking for face... position yourself in front of the camera');
    }
  } catch (e) {
    setTimeout(captureFace, 3000);
  }
}

// ── DRAW CONTROLS ─────────────────────────
btnStart.addEventListener('click', () => {
  state.isDrawing = true;
  state.drawPoints = [];
  initDrawCanvas();
  btnStart.disabled = true;
  btnStop.disabled  = false;
  setStatus('ready', 'Drawing started — move your index finger');
});

btnStop.addEventListener('click', () => {
  state.isDrawing = false;
  btnStart.disabled = false;
  btnStop.disabled  = true;

  if (state.drawPoints.length > 10) {
    state.authData = state.drawPoints.map(p => ({ x: p.x, y: p.y }));
    btnDone.disabled = false;
    setStatus('ready', 'Drawing captured ✓ Click "Done" to save.');
  } else {
    showError(err2, 'Drawing too short — try again.');
  }
});

btnClear.addEventListener('click', () => {
  state.drawPoints = [];
  state.authData   = null;
  btnDone.disabled = true;
  initDrawCanvas();
  setStatus('ready', 'Canvas cleared — draw again');
});

// ── DONE BUTTON ──────────────────────────
btnDone.addEventListener('click', () => {
  if (!state.faceDescriptor) {
    return showError(err2, 'Face not captured yet. Make sure your face is visible in the webcam and wait a moment.');
  }
  if (!state.authData) {
    return showError(err2, 'Auth data missing. Please complete the drawing or PIN.');
  }

  // Save to localStorage
  const users = JSON.parse(localStorage.getItem('airbrush_users') || '[]');
  users.push({
    name:           state.name,
    email:          state.email,
    method:         state.method,
    authData:       state.authData,
    faceDescriptor: state.faceDescriptor,
  });
  localStorage.setItem('airbrush_users', JSON.stringify(users));

  // Go to success step
  step2El.style.display = 'none';
  step3El.style.display = 'flex';
});

// ── BACK BUTTON ──────────────────────────
btnBack.addEventListener('click', () => {
  // Stop camera streams
  if (webcamEl.srcObject) {
    webcamEl.srcObject.getTracks().forEach(t => t.stop());
  }
  step2El.style.display = 'none';
  step1El.style.display = 'flex';
  resetStep2();
});

function resetStep2() {
  state.authData       = null;
  state.faceDescriptor = null;
  state.isDrawing      = false;
  state.drawPoints     = [];
  state.pinDigits      = [];
  state.pinCurrentDigit= 0;
  state.pinCurrentCount= -1;
  clearPinTimer();
  btnDone.disabled  = true;
  btnStart.disabled = false;
  btnStop.disabled  = true;
}

// ── HELPERS ──────────────────────────────
function setStatus(type, msg) {
  statusDot.className = 'status-dot ' + type;
  statusText.textContent = msg;
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}
function hideError(el) { el.style.display = 'none'; }
