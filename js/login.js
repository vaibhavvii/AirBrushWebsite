// ═══════════════════════════════════════════
//  AIRBRUSH — login.js
//  Login: verify gesture auth + face 2FA
// ═══════════════════════════════════════════

// ── STATE ────────────────────────────────
const state = {
  user: null,            // matched user object from localStorage
  isDrawing: false,
  drawPoints: [],
  overlayStrokes: [],
  currentOverlayStroke: null,
  handVisible: false,
  pinDigits: [],
  pinCurrentDigit: 0,
  pinCurrentCount: -1,
  pinTimer: null,
  pinCountdown: 3,
  modelsLoaded: false,
  faceResult: null,      // 'pass' | 'fail' | null
  faceDistance: Infinity,
  FACE_THRESHOLD: 0.52,  // lower = stricter (0.6 is face-api default)
  PATH_THRESHOLD: 0.28,  // normalized DTW threshold for sign/pattern
};

// ── DOM REFS ─────────────────────────────
const step1El   = document.getElementById('step1');
const step2El   = document.getElementById('step2');
const step3El   = document.getElementById('step3');
const stepFail  = document.getElementById('step-fail');
const inpEmail  = document.getElementById('inp-email');
const btnNext   = document.getElementById('btn-step1-next');
const btnBack   = document.getElementById('btn-back');
const btnVerify = document.getElementById('btn-verify');
const btnStart  = document.getElementById('btn-start');
const btnStop   = document.getElementById('btn-stop');
const btnClear  = document.getElementById('btn-clear-draw');
const btnRetry  = document.getElementById('btn-retry');
const err1      = document.getElementById('step1-error');
const err2      = document.getElementById('step2-error');
const statusDot = document.getElementById('status-dot');
const statusText= document.getElementById('status-text');
const step2Title= document.getElementById('step2-title');
const step2Sub  = document.getElementById('step2-sub');
const drawBox   = document.getElementById('draw-box');
const pinBox    = document.getElementById('pin-box');
const drawCtrlEl= document.getElementById('draw-controls');
const pinCtrlEl = document.getElementById('pin-controls');
const faceBadge = document.getElementById('face-badge');
const faceIcon  = document.getElementById('face-icon');
const faceStat  = document.getElementById('face-status');

// Canvases
const webcamEl      = document.getElementById('webcam');
const overlayCanvas = document.getElementById('overlay-canvas');
const drawCanvas    = document.getElementById('draw-canvas');
const overlayCtx    = overlayCanvas.getContext('2d');
const drawCtx       = drawCanvas.getContext('2d');

// Mirror webcam feed (selfie view)
webcamEl.style.transform      = 'scaleX(-1)';
overlayCanvas.style.transform = 'scaleX(-1)';

// ── STEP 1 — EMAIL LOOKUP ─────────────────
btnNext.addEventListener('click', () => {
  const email = inpEmail.value.trim().toLowerCase();
  if (!email || !email.includes('@'))
    return showError(err1, 'Please enter a valid email address.');

  const users = JSON.parse(localStorage.getItem('airbrush_users') || '[]');
  const match = users.find(u => u.email.toLowerCase() === email);

  if (!match)
    return showError(err1, 'No account found with that email. Please sign up first.');

  hideError(err1);
  state.user = match;
  goToStep2();
});

// ── STEP 2 SETUP ─────────────────────────
function goToStep2() {
  step1El.style.display = 'none';
  step2El.style.display = 'flex';

  const method = state.user.method;
  const labels = {
    sign:    ['Verify your Signature',   'Reproduce the air signature you drew at sign-up.'],
    pattern: ['Verify your Pattern',     'Reproduce the gesture pattern you drew at sign-up.'],
    pin:     ['Verify your Finger PIN',  'Enter the 4-digit finger PIN you set at sign-up.'],
  };
  step2Title.textContent = labels[method][0];
  step2Sub.textContent   = labels[method][1];

  if (method === 'pin') {
    drawBox.style.display    = 'none';
    pinBox.style.display     = 'block';
    drawCtrlEl.style.display = 'none';
    pinCtrlEl.style.display  = 'block';
  } else {
    drawBox.style.display    = 'block';
    pinBox.style.display     = 'none';
    drawCtrlEl.style.display = 'flex';
    pinCtrlEl.style.display  = 'none';
  }

  initDrawCanvas();
  startCamera();
}

// ── CANVAS INIT ───────────────────────────
function initDrawCanvas() {
  drawCanvas.width  = drawCanvas.offsetWidth  || 400;
  drawCanvas.height = drawCanvas.offsetHeight || 300;
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  state.drawPoints = [];
  state.overlayStrokes = [];
  state.currentOverlayStroke = null;
}

// ── CAMERA & MEDIAPIPE ───────────────────
async function startCamera() {
  setStatus('loading', 'Loading AI models...');

  try {
    const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    ]);
    state.modelsLoaded = true;
    setStatus('loading', 'Starting webcam...');
  } catch (e) {
    setStatus('error', 'Could not load face models. Check your connection.');
    return;
  }

  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });
  hands.onResults(onHandResults);

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
    setStatus('ready', 'Camera ready — hand tracking active ✓');
    // Start continuous face verification loop
    runFaceVerification();
    if (state.user.method === 'pin') updatePinUI();
  }).catch(e => {
    setStatus('error', 'Camera access denied.');
    showError(err2, e.message);
  });
}

// ── HAND RESULTS ─────────────────────────
function onHandResults(results) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const handDetected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

  if (!handDetected) {
    if (state.currentOverlayStroke && state.currentOverlayStroke.length > 1)
      state.overlayStrokes.push([...state.currentOverlayStroke]);
    state.currentOverlayStroke = null;
    state.handVisible = false;
    redrawOverlayTrail();
    return;
  }

  state.handVisible = true;

  results.multiHandLandmarks.forEach(landmarks => {
    drawConnectors(overlayCtx, landmarks, HAND_CONNECTIONS,
      { color: 'rgba(124,58,237,0.75)', lineWidth: 2 });
    drawLandmarks(overlayCtx, landmarks,
      { color: '#06B6D4', lineWidth: 1, radius: 3 });
  });

  if (state.user.method === 'pin') {
    handlePIN(results);
  } else {
    handleDrawing(results);
  }

  redrawOverlayTrail();
}

// ── DRAWING ───────────────────────────────
function handleDrawing(results) {
  if (!state.isDrawing) return;
  const landmarks = results.multiHandLandmarks[0];
  if (!landmarks) return;

  const tip = landmarks[8];

  // Draw canvas (manually mirrored → left-to-right natural)
  const drawX = (1 - tip.x) * drawCanvas.width;
  const drawY = tip.y * drawCanvas.height;
  state.drawPoints.push({ x: drawX, y: drawY });

  drawCtx.strokeStyle = '#6C63FF';
  drawCtx.lineWidth   = 3;
  drawCtx.lineCap     = 'round';
  drawCtx.lineJoin    = 'round';
  if (state.drawPoints.length > 1) {
    const prev = state.drawPoints[state.drawPoints.length - 2];
    drawCtx.beginPath();
    drawCtx.moveTo(prev.x, prev.y);
    drawCtx.lineTo(drawX, drawY);
    drawCtx.stroke();
  }

  // Overlay (CSS mirrored → raw coords)
  const overlayX = tip.x * overlayCanvas.width;
  const overlayY = tip.y * overlayCanvas.height;
  if (!state.currentOverlayStroke) state.currentOverlayStroke = [];
  state.currentOverlayStroke.push({ x: overlayX, y: overlayY });
}

function redrawOverlayTrail() {
  const drawStroke = pts => {
    if (!pts || pts.length < 2) return;
    overlayCtx.save();
    overlayCtx.strokeStyle = 'rgba(99,255,200,0.95)';
    overlayCtx.lineWidth   = 3.5;
    overlayCtx.lineCap     = 'round';
    overlayCtx.lineJoin    = 'round';
    overlayCtx.shadowColor = 'rgba(6,182,212,0.6)';
    overlayCtx.shadowBlur  = 8;
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.stroke();
    overlayCtx.restore();
  };
  state.overlayStrokes.forEach(drawStroke);
  if (state.currentOverlayStroke) drawStroke(state.currentOverlayStroke);
}

// ── PIN HANDLER ──────────────────────────
function handlePIN(results) {
  if (state.pinCurrentDigit >= 4) return;

  let total = 0;
  results.multiHandLandmarks.forEach((lm, i) => {
    total += countFingers(lm, results.multiHandedness[i].label);
  });
  document.getElementById('finger-count').textContent = total;

  if (total === state.pinCurrentCount) return;
  state.pinCurrentCount = total;
  clearPinTimer();

  if (total > 0) {
    document.getElementById('pin-timer-wrap').style.display = 'block';
    state.pinCountdown = 3;
    document.getElementById('pin-timer').textContent = 3;
    state.pinTimer = setInterval(() => {
      state.pinCountdown--;
      document.getElementById('pin-timer').textContent = state.pinCountdown;
      if (state.pinCountdown <= 0) {
        clearPinTimer();
        confirmPinDigit(total);
      }
    }, 1000);
  } else {
    document.getElementById('pin-timer-wrap').style.display = 'none';
  }
}

function countFingers(landmarks, handedness) {
  const pairs = [[8,6],[12,10],[16,14],[20,18]];
  let count = pairs.filter(([t,p]) => landmarks[t].y < landmarks[p].y).length;
  const tt = landmarks[4], ti = landmarks[3];
  if (handedness === 'Right') { if (tt.x < ti.x) count++; }
  else                        { if (tt.x > ti.x) count++; }
  return count;
}

function clearPinTimer() {
  if (state.pinTimer) { clearInterval(state.pinTimer); state.pinTimer = null; }
  document.getElementById('pin-timer-wrap').style.display = 'none';
}

function confirmPinDigit(value) {
  const clamped = Math.min(value, 9);
  state.pinDigits.push(clamped);
  const el = document.getElementById(`pd${state.pinCurrentDigit}`);
  el.textContent = clamped;
  el.classList.add('filled');
  el.classList.remove('active');
  state.pinCurrentDigit++;
  state.pinCurrentCount = -1;

  if (state.pinCurrentDigit >= 4) {
    setStatus('ready', 'PIN entered ✓  Click Verify to continue.');
    document.getElementById('pin-current').textContent = 'PIN complete! ✓';
    btnVerify.disabled = false;
  } else {
    updatePinUI();
  }
}

function updatePinUI() {
  document.getElementById('pin-current').textContent = `Entering digit ${state.pinCurrentDigit + 1} of 4`;
  const el = document.getElementById(`pd${state.pinCurrentDigit}`);
  if (el) el.classList.add('active');
}

// ── FACE VERIFICATION LOOP ────────────────
// Runs every 2 seconds in background while user does gesture auth
async function runFaceVerification() {
  if (!state.modelsLoaded) { setTimeout(runFaceVerification, 1500); return; }

  setFaceBadge('checking', '👁', 'Verifying face...');
  try {
    const detection = await faceapi
      .detectSingleFace(webcamEl, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection) {
      const stored = new Float32Array(state.user.faceDescriptor);
      const live   = detection.descriptor;
      const dist   = euclideanDist(stored, live);
      state.faceDistance = dist;

      if (dist < state.FACE_THRESHOLD) {
        state.faceResult = 'pass';
        setFaceBadge('pass', '✅', `Face matched (score ${(1 - dist).toFixed(2)})`);
      } else {
        state.faceResult = 'fail';
        setFaceBadge('fail', '❌', `Face mismatch (score ${(1 - dist).toFixed(2)})`);
        // Keep retrying — user might adjust position
        setTimeout(runFaceVerification, 2500);
      }
    } else {
      setFaceBadge('checking', '👤', 'No face detected — look at the camera');
      setTimeout(runFaceVerification, 2000);
    }
  } catch (e) {
    setTimeout(runFaceVerification, 3000);
  }
}

function euclideanDist(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function setFaceBadge(type, icon, text) {
  faceBadge.className = 'face-badge ' + type;
  faceIcon.textContent  = icon;
  faceStat.textContent  = text;
}

// ── DRAW CONTROLS ─────────────────────────
btnStart.addEventListener('click', () => {
  state.isDrawing = true;
  state.drawPoints = [];
  state.overlayStrokes = [];
  state.currentOverlayStroke = null;
  initDrawCanvas();
  btnStart.disabled = true;
  btnStop.disabled  = false;
  setStatus('ready', 'Drawing — move your index finger in the air');
});

btnStop.addEventListener('click', () => {
  state.isDrawing = false;
  if (state.currentOverlayStroke && state.currentOverlayStroke.length > 1)
    state.overlayStrokes.push([...state.currentOverlayStroke]);
  state.currentOverlayStroke = null;
  btnStart.disabled = false;
  btnStop.disabled  = true;

  if (state.drawPoints.length > 10) {
    btnVerify.disabled = false;
    setStatus('ready', 'Drawing captured ✓  Click Verify to continue.');
  } else {
    showError(err2, 'Drawing too short — please try again.');
  }
});

btnClear.addEventListener('click', () => {
  state.drawPoints = [];
  state.overlayStrokes = [];
  state.currentOverlayStroke = null;
  btnVerify.disabled = true;
  initDrawCanvas();
  setStatus('ready', 'Cleared — draw again');
});

// ── VERIFY & LOG IN ───────────────────────
btnVerify.addEventListener('click', () => {
  hideError(err2);
  const method = state.user.method;

  // ── 1. Gesture check ──
  let gesturePass = false;

  if (method === 'pin') {
    gesturePass = verifyPIN(state.pinDigits, state.user.authData);
  } else {
    gesturePass = verifyPath(state.drawPoints, state.user.authData);
  }

  // ── 2. Face check ──
  const facePass = state.faceResult === 'pass';

  // ── 3. Decision ──
  if (gesturePass && facePass) {
    goToSuccess();
  } else if (!gesturePass && !facePass) {
    goToFail('Both your gesture and face verification failed. Please try again.');
  } else if (!gesturePass) {
    goToFail('Gesture verification failed. Your drawing or PIN didn\'t match. Please try again.');
  } else {
    goToFail('Face verification failed. Make sure your face is clearly visible and try again.');
  }
});

// ── VERIFY PIN ────────────────────────────
function verifyPIN(entered, stored) {
  if (entered.length !== 4 || stored.length !== 4) return false;
  return entered.every((d, i) => d === stored[i]);
}

// ── VERIFY PATH (signature / pattern) ─────
function verifyPath(drawnPoints, storedPoints) {
  if (drawnPoints.length < 10 || storedPoints.length < 10) return false;

  const N = 64;
  const drawn  = resamplePath(drawnPoints, N);
  const stored = resamplePath(storedPoints, N);

  const normDrawn  = normalizePath(drawn);
  const normStored = normalizePath(stored);

  let total = 0;
  for (let i = 0; i < N; i++) {
    const dx = normDrawn[i].x - normStored[i].x;
    const dy = normDrawn[i].y - normStored[i].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  const avgDist = total / N;

  console.log(`Path similarity distance: ${avgDist.toFixed(3)} (threshold: ${state.PATH_THRESHOLD})`);
  return avgDist < state.PATH_THRESHOLD;
}

function resamplePath(points, N) {
  if (points.length === 0) return [];
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    totalLen += Math.sqrt(dx*dx + dy*dy);
  }

  if (totalLen === 0) return Array(N).fill({ ...points[0] });

  const interval = totalLen / (N - 1);
  const result = [{ ...points[0] }];
  let accumulated = 0;

  for (let i = 1; i < points.length && result.length < N; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    const segLen = Math.sqrt(dx*dx + dy*dy);

    while (accumulated + segLen >= interval * result.length && result.length < N) {
      const t = (interval * result.length - accumulated) / segLen;
      result.push({
        x: points[i-1].x + t * dx,
        y: points[i-1].y + t * dy,
      });
    }
    accumulated += segLen;
  }

  while (result.length < N) result.push({ ...points[points.length - 1] });
  return result;
}

function normalizePath(points) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  return points.map(p => ({
    x: (p.x - minX) / rangeX,
    y: (p.y - minY) / rangeY,
  }));
}

// ── SUCCESS ───────────────────────────────
function goToSuccess() {
  stopCamera();
  step2El.style.display = 'none';
  step3El.style.display = 'flex';
  document.getElementById('success-name').textContent =
    `Welcome back, ${state.user.name}! 👋`;

  // Save session
  sessionStorage.setItem('airbrush_session', JSON.stringify({
    email: state.user.email,
    name:  state.user.name,
  }));

  // Animate redirect bar then navigate
  requestAnimationFrame(() => {
    document.getElementById('redirect-fill').style.width = '100%';
  });
  setTimeout(() => { window.location.href = 'canvas.html'; }, 2400);
}

// ── FAIL ──────────────────────────────────
function goToFail(reason) {
  stopCamera();
  step2El.style.display = 'none';
  stepFail.style.display = 'flex';
  document.getElementById('fail-reason').textContent = reason;
}

btnRetry.addEventListener('click', () => {
  stepFail.style.display = 'none';
  // Reset state
  state.drawPoints = [];
  state.overlayStrokes = [];
  state.currentOverlayStroke = null;
  state.pinDigits = [];
  state.pinCurrentDigit = 0;
  state.pinCurrentCount = -1;
  state.faceResult = null;
  clearPinTimer();
  btnVerify.disabled = true;
  btnStart.disabled  = false;
  btnStop.disabled   = true;
  // Reset PIN display
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`pd${i}`);
    el.textContent = '_';
    el.className = 'pin-digit';
  }
  goToStep2();
});

btnBack.addEventListener('click', () => {
  stopCamera();
  step2El.style.display = 'none';
  step1El.style.display = 'flex';
});

// ── HELPERS ──────────────────────────────
function stopCamera() {
  if (webcamEl.srcObject)
    webcamEl.srcObject.getTracks().forEach(t => t.stop());
}

function setStatus(type, msg) {
  statusDot.className = 'status-dot ' + type;
  statusText.textContent = msg;
}
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }
function hideError(el) { el.style.display = 'none'; }
