// ═══════════════════════════════════════════
//  AIRBRUSH — canvas.js
//  Main Air Canvas page logic
//
//  Features:
//   • Air mode: MediaPipe hand tracking
//     - Pinch (thumb+index) = draw
//     - Index + middle up (peace ✌) = eraser
//     - Fist + wrist shake = undo
//     - Open palm = stop stroke
//   • Mouse mode: standard mouse drawing
//   • Colour, size, opacity controls
//   • Undo stack (up to 50 states)
//   • Voice description (Web Speech API)
//   • AI image generation (Hugging Face free)
// ═══════════════════════════════════════════

// ── SESSION GUARD ─────────────────────────
const session = JSON.parse(sessionStorage.getItem('airbrush_session') || 'null');
// For dev: comment out the redirect to test without logging in
if (!session) window.location.href = 'login.html';

// ── CANVAS SETUP ──────────────────────────
const webcamEl      = document.getElementById('webcam');
const overlayCanvas = document.getElementById('overlay-canvas');
const drawCanvas    = document.getElementById('draw-canvas');
const overlayCtx    = overlayCanvas.getContext('2d');
const drawCtx       = drawCanvas.getContext('2d', { willReadFrequently: true });

// ── STATE ─────────────────────────────────
const S = {
  mode:           'air',      // 'air' | 'mouse'
  tool:           'brush',    // 'brush' | 'eraser'
  color:          '#6C63FF',
  brushSize:      4,
  opacity:        1.0,
  isActive:       false,      // camera is running + tracking
  isDrawing:      false,      // currently in a stroke
  latestLandmarks: null,
  latestResults:  null,

  // Gesture state
  wasPinching:    false,
  wasErasing:     false,
  openPalmFrames: 0,
  fistHistory:    [],         // wrist x-positions for shake detection
  lastFistX:      null,
  shakeCount:     0,
  shakeTimer:     null,

  // Mouse state
  mouseDown:      false,
  lastMouseX:     0,
  lastMouseY:     0,

  // Undo stack
  undoStack:      [],
  MAX_UNDO:       50,

  // AI
  lastGenerated:  null,       // blob URL of last AI image
  lastSketch:     null,       // data URL of sketch at generation time
  lastDesc:       '',         // description used for generation
};

// ── DOM ───────────────────────────────────
const navUser       = document.getElementById('nav-user');
const statusDot     = document.getElementById('status-dot');
const statusText    = document.getElementById('status-text');
const btnAirMode    = document.getElementById('btn-air-mode');
const btnMouseMode  = document.getElementById('btn-mouse-mode');
const btnBrush      = document.getElementById('btn-brush');
const btnEraser     = document.getElementById('btn-eraser');
const btnStart      = document.getElementById('btn-start');
const btnStop       = document.getElementById('btn-stop');
const btnUndo       = document.getElementById('btn-undo');
const btnClear      = document.getElementById('btn-clear');
const btnDownload   = document.getElementById('btn-download');
const btnGenerate   = document.getElementById('btn-generate');
const btnVoice      = document.getElementById('btn-voice');
const btnSaveToken  = document.getElementById('btn-save-token');
const btnSaveAI     = document.getElementById('btn-save-ai');
const btnAddGallery = document.getElementById('btn-add-gallery');
const btnRetryAI    = document.getElementById('btn-retry-ai');
const brushSizeEl   = document.getElementById('brush-size');
const brushOpEl     = document.getElementById('brush-opacity');
const sizeLabelEl   = document.getElementById('size-label');
const opLabelEl     = document.getElementById('opacity-label');
const colorCustomEl = document.getElementById('color-custom');
const aiDescEl      = document.getElementById('ai-description');
const hfTokenEl     = document.getElementById('hf-token');
const modelSelectEl = document.getElementById('ai-model-select');
const aiPlaceholder = document.getElementById('ai-placeholder');
const aiLoading     = document.getElementById('ai-loading');
const aiLoadingText = document.getElementById('ai-loading-text');
const aiResultImg   = document.getElementById('ai-result-img');
const aiActions     = document.getElementById('ai-actions');
const gestureInd    = document.getElementById('gesture-indicator');

// ── INIT ──────────────────────────────────
// ── WEBCAM PREVIEW — always on ────────────
async function startWebcamPreview() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    webcamEl.srcObject = stream;
    webcamEl.style.transform = 'scaleX(-1)';
  } catch(e) {
    console.warn('[preview] webcam not available:', e.message);
  }
}

function init() {
  // User name
  if (session) navUser.textContent = `👤 ${session.name}`;
  else navUser.textContent = '👤 Guest';

  // Load saved HF token
  const savedToken = localStorage.getItem('airbrush_hf_token');
  if (savedToken) hfTokenEl.value = savedToken;

  // Init canvas
  resizeDrawCanvas();
  window.addEventListener('resize', resizeDrawCanvas);

  // Bind controls
  bindControls();

  // Start webcam preview immediately (always on)
  startWebcamPreview();

  setStatus('ready', '✋ Click Start to begin Air Canvas');
}

function resizeDrawCanvas() {
  const box = document.querySelector('.draw-frame-box');
  if (!box) return;
  const rect = box.getBoundingClientRect();
  // Save existing drawing before resize
  const imgData = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  drawCanvas.width  = rect.width  || 600;
  drawCanvas.height = rect.height || 450;
  // Restore
  if (imgData.width > 0) drawCtx.putImageData(imgData, 0, 0);
  else fillWhite();
}

function fillWhite() {
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
}

// ── CONTROLS ──────────────────────────────
function bindControls() {
  // Mode toggle
  btnAirMode.addEventListener('click',   () => setMode('air'));
  btnMouseMode.addEventListener('click', () => setMode('mouse'));

  // Tool
  btnBrush.addEventListener('click',  () => setTool('brush'));
  btnEraser.addEventListener('click', () => setTool('eraser'));

  // Brush size
  brushSizeEl.addEventListener('input', () => {
    S.brushSize = parseInt(brushSizeEl.value);
    sizeLabelEl.textContent = S.brushSize;
  });

  // Opacity
  brushOpEl.addEventListener('input', () => {
    S.opacity = parseInt(brushOpEl.value) / 100;
    opLabelEl.textContent = brushOpEl.value;
  });

  // Colour swatches
  document.querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      S.color = sw.dataset.color;
      colorCustomEl.value = sw.dataset.color;
      if (S.tool === 'eraser') setTool('brush');
    });
  });
  colorCustomEl.addEventListener('input', () => {
    S.color = colorCustomEl.value;
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    if (S.tool === 'eraser') setTool('brush');
  });

  // Start / Stop
  btnStart.addEventListener('click', startAir);
  btnStop.addEventListener('click',  stopAir);

  // Undo / Clear
  btnUndo.addEventListener('click',     undo);
  btnClear.addEventListener('click',    clearCanvas);
  btnDownload.addEventListener('click', downloadCanvas);

  // AI
  btnGenerate.addEventListener('click', generateAI);
  btnVoice.addEventListener('click',    startVoice);
  btnSaveToken.addEventListener('click', () => {
    localStorage.setItem('airbrush_hf_token', hfTokenEl.value.trim());
    showToast('Token saved!');
  });
  btnSaveAI.addEventListener('click',   saveAIImage);
  btnAddGallery.addEventListener('click', addToGallery);
  btnRetryAI.addEventListener('click',  generateAI);

  // Gallery modal
  document.getElementById('btn-open-gallery').addEventListener('click', e => {
    e.preventDefault();
    openGalleryModal();
  });
  document.getElementById('gallery-close').addEventListener('click', () => {
    document.getElementById('gallery-modal').style.display = 'none';
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('airbrush_session');
    window.location.href = 'login.html';
  });

  // Mouse drawing
  drawCanvas.addEventListener('mousedown',  onMouseDown);
  drawCanvas.addEventListener('mousemove',  onMouseMove);
  drawCanvas.addEventListener('mouseup',    onMouseUp);
  drawCanvas.addEventListener('mouseleave', onMouseUp);

  // Touch drawing (mobile)
  drawCanvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    const rect = drawCanvas.getBoundingClientRect();
    onMouseDown({ offsetX: t.clientX - rect.left, offsetY: t.clientY - rect.top });
  }, { passive: false });
  drawCanvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    const rect = drawCanvas.getBoundingClientRect();
    onMouseMove({ offsetX: t.clientX - rect.left, offsetY: t.clientY - rect.top });
  }, { passive: false });
  drawCanvas.addEventListener('touchend', onMouseUp, { passive: false });
}

// ── MODE SWITCHING ────────────────────────
function setMode(mode) {
  S.mode = mode;
  btnAirMode.classList.toggle('active',   mode === 'air');
  btnMouseMode.classList.toggle('active', mode === 'mouse');

  const camPanel     = document.getElementById('cam-panel');
  const gestureGuide = document.getElementById('gesture-guide');

  if (mode === 'air') {
    camPanel.style.display     = '';
    gestureGuide.style.display = '';
    drawCanvas.style.cursor    = 'crosshair';
  } else {
    // Mouse mode — stop air, hide cam
    if (S.isActive) stopAir();
    camPanel.style.display     = 'none';
    gestureGuide.style.display = 'none';
    drawCanvas.style.cursor    = S.tool === 'eraser' ? 'cell' : 'crosshair';
    setStatus('ready', '🖱 Mouse mode — draw directly on the canvas');
  }
}

// ── TOOL ──────────────────────────────────
function setTool(tool) {
  S.tool = tool;
  btnBrush.classList.toggle('active',  tool === 'brush');
  btnEraser.classList.toggle('active', tool === 'eraser');
  document.querySelector('.right-panel').classList.toggle('eraser-mode', tool === 'eraser');
}

// ── AIR CANVAS — CAMERA ───────────────────
async function startAir() {
  if (S.isActive) return;
  btnStart.disabled = true;
  setStatus('loading', 'Loading MediaPipe Hands…');

  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({
    maxNumHands:            1,
    modelComplexity:        1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence:  0.6,
  });
  hands.onResults(onHandResults);

  S.handsInstance = hands;

  const camera = new Camera(webcamEl, {
    onFrame: async () => {
      // Size overlay to displayed box so landmarks align with mirrored video
      const box = document.querySelector('.cam-frame-box');
      if (box) {
        const bw = box.clientWidth  || 640;
        const bh = box.clientHeight || 480;
        if (overlayCanvas.width !== bw || overlayCanvas.height !== bh) {
          overlayCanvas.width  = bw;
          overlayCanvas.height = bh;
        }
      }
      await hands.send({ image: webcamEl });
    },
    width: 640, height: 480,
  });

  try {
    await camera.start();
    S.camera     = camera;
    S.isActive   = true;
    btnStop.disabled  = false;
    btnStart.disabled = true;
    setStatus('active', '✋ Air Canvas active — pinch to draw');
  } catch (e) {
    btnStart.disabled = false;
    setStatus('error', 'Camera denied — allow webcam and try again');
  }
}

function stopAir() {
  S.isActive = false;
  // Stop MediaPipe camera tracks
  if (S.camera) {
    try { S.camera.stop(); } catch(e) {}
    S.camera = null;
  }
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  btnStart.disabled = false;
  btnStop.disabled  = true;
  S.isDrawing   = false;
  S.wasPinching = false;
  setStatus('ready', 'Tracking stopped. Webcam preview continues.');
  // Resume plain preview so webcam never goes black
  startWebcamPreview();
}

// ── HAND RESULTS → state → rAF ────────────
function onHandResults(results) {
  S.latestLandmarks = (results.multiHandLandmarks && results.multiHandLandmarks.length > 0)
    ? results.multiHandLandmarks[0] : null;
  S.latestResults   = results;
  requestAnimationFrame(renderFrame);
}

// ── RENDER FRAME (called via rAF) ─────────
function renderFrame() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // ── Mirror the drawing canvas onto the overlay so strokes show on webcam ──
  // drawCanvas is not mirrored; overlay IS mirrored via CSS scaleX(-1).
  // So we flip horizontally when blitting so it looks correct on the webcam view.
  overlayCtx.save();
  overlayCtx.globalAlpha = 0.55;
  overlayCtx.translate(overlayCanvas.width, 0);
  overlayCtx.scale(-1, 1);
  overlayCtx.drawImage(drawCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.restore();

  if (!S.latestLandmarks) {
    if (S.isDrawing) endStroke();
    S.wasPinching    = false;
    S.wasErasing     = false;
    S.openPalmFrames = 0;
    hideGestureIndicator();
    return;
  }

  const lm = S.latestLandmarks;

  // Draw skeleton on top of the mirrored drawing
  drawConnectors(overlayCtx, lm, HAND_CONNECTIONS,
    { color: 'rgba(124,58,237,0.85)', lineWidth: 2 });
  drawLandmarks(overlayCtx, lm,
    { color: '#06B6D4', lineWidth: 1, radius: 3 });

  // Detect gestures and act
  processGestures(lm);
}

// ══════════════════════════════════════════
//  GESTURE LOGIC
// ══════════════════════════════════════════

// Normalised distance helper
function normDist(a, b, lm) {
  const dx = lm[a].x - lm[b].x;
  const dy = lm[a].y - lm[b].y;
  const hx = lm[0].x - lm[9].x;
  const hy = lm[0].y - lm[9].y;
  return Math.hypot(dx, dy) / (Math.hypot(hx, hy) || 0.1);
}

function isPinching(lm)  { return normDist(4, 8, lm) < 0.35; }
function isOpenPalm(lm)  {
  return [[8,6],[12,10],[16,14],[20,18]].every(([t,p]) => lm[t].y < lm[p].y)
    && Math.abs(lm[4].x - lm[3].x) > 0.04;
}

// ✌ Peace sign = eraser (index + middle extended, ring + pinky down)
function isPeaceSign(lm) {
  const indexUp  = lm[8].y  < lm[6].y;
  const middleUp = lm[12].y < lm[10].y;
  const ringDown = lm[16].y > lm[14].y;
  const pinkyDown= lm[20].y > lm[18].y;
  const noThumb  = normDist(4, 8, lm) > 0.3;
  return indexUp && middleUp && ringDown && pinkyDown && noThumb;
}

// Fist = all fingers curled
function isFist(lm) {
  return [[8,6],[12,10],[16,14],[20,18]].every(([t,p]) => lm[t].y > lm[p].y)
    && normDist(4, 8, lm) > 0.3;
}

function processGestures(lm) {
  const pinching  = isPinching(lm);
  const peace     = isPeaceSign(lm);
  const openPalm  = isOpenPalm(lm);
  const fist      = isFist(lm);

  // ── PRIORITY ORDER ────────────────────
  // 1. Open palm → stop stroke
  if (openPalm) {
    S.openPalmFrames++;
    if (S.openPalmFrames >= 3 && S.isDrawing) {
      endStroke();
      showGestureIndicator('🖐 Stop');
    }
    S.wasPinching = false;
    S.wasErasing  = false;
    return;
  }
  S.openPalmFrames = 0;

  // 2. Fist → check for shake (undo)
  if (fist) {
    detectFistShake(lm);
    if (S.isDrawing) endStroke();
    S.wasPinching = false;
    S.wasErasing  = false;
    return;
  }
  // Reset shake tracking when fist released
  if (!fist) {
    S.fistHistory = [];
    S.lastFistX   = null;
    S.shakeCount  = 0;
  }

  // 3. Peace ✌ → eraser mode
  if (peace) {
    if (!S.wasErasing) {
      if (S.isDrawing) endStroke();
      setTool('eraser');
      S.wasErasing = true;
      showGestureIndicator('✌️ Eraser');
    }
    // Draw with eraser
    doAirDraw(lm, true);
    return;
  }
  if (S.wasErasing && !peace) {
    // Switch back to brush on leaving peace
    setTool('brush');
    S.wasErasing = false;
    if (S.isDrawing) endStroke();
  }

  // 4. Pinch → draw
  if (pinching) {
    if (!S.isDrawing) {
      pushUndoState();
      S.isDrawing   = true;
      S.wasPinching = true;
    }
    doAirDraw(lm, false);
    showGestureIndicator('👌 Drawing');
    return;
  }

  // 5. No gesture — end stroke if was drawing
  if (S.wasPinching && S.isDrawing) endStroke();
  S.wasPinching = false;
  hideGestureIndicator();
}

// ── FIST SHAKE DETECTION ──────────────────
function detectFistShake(lm) {
  const wristX = lm[0].x;

  if (S.lastFistX === null) {
    S.lastFistX = wristX;
    return;
  }

  const delta = Math.abs(wristX - S.lastFistX);
  if (delta > 0.04) { // threshold for significant wrist movement
    S.shakeCount++;
    if (S.shakeCount >= 3) {
      // 3 direction changes = shake detected
      undo();
      S.shakeCount  = 0;
      S.fistHistory = [];
      S.lastFistX   = null;
      showGestureIndicator('✊ Undo!');
      return;
    }
  }
  S.lastFistX = wristX;
}

// ── AIR DRAWING ───────────────────────────
function doAirDraw(lm, erasing) {
  const tip   = lm[8]; // index finger tip
  const drawX = (1 - tip.x) * drawCanvas.width;  // mirror X
  const drawY = tip.y * drawCanvas.height;

  // Draw on the main canvas
  applyBrush(drawX, drawY, erasing ? 'eraser' : S.tool);

  // Draw cursor dot on overlay
  const ox = tip.x * overlayCanvas.width;
  const oy = tip.y * overlayCanvas.height;
  overlayCtx.save();
  overlayCtx.beginPath();
  overlayCtx.arc(ox, oy, erasing ? 14 : 10, 0, Math.PI * 2);
  overlayCtx.fillStyle = erasing ? 'rgba(255,200,50,0.7)' : 'rgba(255,80,80,0.8)';
  overlayCtx.fill();
  overlayCtx.restore();
}

// ── APPLY BRUSH / ERASER ──────────────────
let _lastDrawX = null, _lastDrawY = null;

function applyBrush(x, y, tool) {
  drawCtx.save();
  drawCtx.globalAlpha   = tool === 'eraser' ? 1 : S.opacity;
  drawCtx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  drawCtx.strokeStyle   = tool === 'eraser' ? 'rgba(0,0,0,1)' : S.color;
  drawCtx.lineWidth     = tool === 'eraser' ? S.brushSize * 3 : S.brushSize;
  drawCtx.lineCap       = 'round';
  drawCtx.lineJoin      = 'round';

  if (_lastDrawX !== null) {
    drawCtx.beginPath();
    drawCtx.moveTo(_lastDrawX, _lastDrawY);
    drawCtx.lineTo(x, y);
    drawCtx.stroke();
  } else {
    // Single dot for start of stroke
    drawCtx.beginPath();
    const r = (tool === 'eraser' ? S.brushSize * 3 : S.brushSize) / 2;
    drawCtx.arc(x, y, r, 0, Math.PI * 2);
    drawCtx.fillStyle = drawCtx.strokeStyle;
    drawCtx.fill();
  }
  drawCtx.restore();
  _lastDrawX = x;
  _lastDrawY = y;
}

function endStroke() {
  S.isDrawing = false;
  S.wasPinching = false;
  _lastDrawX = null;
  _lastDrawY = null;
}

// ── GESTURE INDICATOR ─────────────────────
let _gIndicatorTimer = null;
function showGestureIndicator(text) {
  gestureInd.textContent = text;
  gestureInd.style.display = 'block';
  clearTimeout(_gIndicatorTimer);
  _gIndicatorTimer = setTimeout(hideGestureIndicator, 1500);
}
function hideGestureIndicator() {
  gestureInd.style.display = 'none';
}

// ══════════════════════════════════════════
//  MOUSE DRAWING
// ══════════════════════════════════════════
function onMouseDown(e) {
  if (S.mode !== 'mouse') return;
  pushUndoState();
  S.mouseDown = true;
  S.lastMouseX = e.offsetX;
  S.lastMouseY = e.offsetY;
  _lastDrawX   = null;
  _lastDrawY   = null;
  applyBrush(e.offsetX, e.offsetY, S.tool);
}

function onMouseMove(e) {
  if (!S.mouseDown || S.mode !== 'mouse') return;
  applyBrush(e.offsetX, e.offsetY, S.tool);
  S.lastMouseX = e.offsetX;
  S.lastMouseY = e.offsetY;
}

function onMouseUp() {
  if (S.mode !== 'mouse') return;
  S.mouseDown = false;
  _lastDrawX  = null;
  _lastDrawY  = null;
}

// ══════════════════════════════════════════
//  UNDO STACK
// ══════════════════════════════════════════
function pushUndoState() {
  const snapshot = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  S.undoStack.push(snapshot);
  if (S.undoStack.length > S.MAX_UNDO) S.undoStack.shift();
}

function undo() {
  if (!S.undoStack.length) {
    showToast('Nothing to undo');
    return;
  }
  const snapshot = S.undoStack.pop();
  drawCtx.putImageData(snapshot, 0, 0);
  showToast('↩ Undo');
}

function clearCanvas() {
  pushUndoState();
  fillWhite();
  showToast('Canvas cleared');
}

function downloadCanvas() {
  const link  = document.createElement('a');
  link.download = 'airbrush-drawing.png';
  link.href     = drawCanvas.toDataURL('image/png');
  link.click();
}

// ══════════════════════════════════════════
//  VOICE INPUT
// ══════════════════════════════════════════
let recognition = null;

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice input not supported in this browser. Try Chrome.');
    return;
  }

  // If already listening, stop and return (don't erase existing text)
  if (recognition) {
    recognition.stop();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang           = 'en-US';
  recognition.continuous     = false;
  recognition.interimResults = true;

  btnVoice.classList.add('listening');
  btnVoice.textContent = '🔴';

  // Remember what was already typed so we append to it
  const existingText = aiDescEl.value;
  const prefix = existingText ? existingText.trimEnd() + ' ' : '';

  recognition.onresult = e => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    // Append new speech after existing text
    aiDescEl.value = prefix + transcript;
  };

  recognition.onend = () => {
    btnVoice.classList.remove('listening');
    btnVoice.textContent = '🎤';
    recognition = null;
  };

  recognition.onerror = e => {
    console.warn('[voice]', e.error);
    btnVoice.classList.remove('listening');
    btnVoice.textContent = '🎤';
    recognition = null;
    showToast('Voice error: ' + e.error);
  };

  recognition.start();
}

// ── AI GENERATION ─────────────────────────────────────────────────────────

// Save/load Anthropic key
const savedKey = localStorage.getItem('anthropic-key');
if (savedKey) document.getElementById('anthropic-key').value = savedKey;

document.getElementById('btn-save-token')?.addEventListener('click', () => {
  const key = document.getElementById('anthropic-key').value.trim();
  if (key) {
    localStorage.setItem('anthropic-key', key);
    document.getElementById('btn-save-token').textContent = '✓ Saved';
    setTimeout(() => document.getElementById('btn-save-token').textContent = 'Save', 2000);
  }
});

function isCanvasBlank(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return false;  // found non-transparent pixel
  }
  return true;
}

async function analyzeSketchWithClaude(base64Image, userDescription) {
  const apiKey = document.getElementById('anthropic-key').value.trim()
    || localStorage.getItem('anthropic-key') || '';

  if (!apiKey) {
    // No key — fall back to a generic prompt
    return userDescription || 'a creative colorful artwork, vibrant colors';
  }

  const textPrompt = userDescription
    ? `I drew this sketch. My description: "${userDescription}". Create a detailed, vivid image generation prompt that combines my sketch and description. Return ONLY the prompt, no explanation.`
    : `Analyze this hand-drawn sketch and create a detailed image generation prompt describing what you see. Include shapes, objects, colors, composition, and artistic style. Return ONLY the prompt text, no explanation.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64Image }
          },
          { type: 'text', text: textPrompt }
        ]
      }]
    })
  });

  if (!response.ok) {
    console.warn('Claude API error:', response.status);
    return userDescription || 'a creative colorful artwork';
  }

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || userDescription || 'a creative colorful artwork';
}

async function generateAI() {
  const drawCanvas = document.getElementById('draw-canvas');
  const description = (document.getElementById('ai-description')?.value || '').trim();
  const style = document.getElementById('ai-style-select')?.value || 'digital art, highly detailed';

  const blank = isCanvasBlank(drawCanvas);

  if (blank && !description) {
    alert('Please draw something on the canvas or write a description first!');
    return;
  }

  // Show loading
  document.getElementById('ai-placeholder').style.display = 'none';
  document.getElementById('ai-result-img').style.display = 'none';
  document.getElementById('ai-actions').style.display = 'none';
  document.getElementById('ai-loading').style.display = 'flex';
  document.getElementById('btn-generate').disabled = true;

  const updateLoadingText = (text) => {
    const el = document.getElementById('ai-loading-text');
    if (el) el.textContent = text;
  };

  try {
    let finalPrompt = '';

    if (!blank) {
      updateLoadingText('Reading your sketch…');
      const base64 = drawCanvas.toDataURL('image/png').split(',')[1];
      finalPrompt = await analyzeSketchWithClaude(base64, description);
    } else {
      finalPrompt = description;
    }

    // Append style
    finalPrompt = `${finalPrompt}, ${style}`;
    updateLoadingText('Generating image…');

    // Generate with Pollinations.ai — free, fast, no key needed
    const seed = Math.floor(Math.random() * 99999);
    const encoded = encodeURIComponent(finalPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&nologo=true&seed=${seed}&model=flux`;

    await new Promise((resolve, reject) => {
      const img = document.getElementById('ai-result-img');
      const timeout = setTimeout(() => reject(new Error('Timeout')), 60000);

      img.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Image load failed'));
      };
      img.src = imageUrl;
    });

    // Show result
    document.getElementById('ai-loading').style.display = 'none';
    document.getElementById('ai-result-img').style.display = 'block';
    document.getElementById('ai-actions').style.display = 'flex';

  } catch (err) {
    console.error('Generation error:', err);
    document.getElementById('ai-loading').style.display = 'none';
    document.getElementById('ai-placeholder').style.display = 'flex';
    document.getElementById('ai-placeholder').innerHTML =
      `<span style="color:#EF4444">❌ Failed: ${err.message}. Try again!</span>`;
  } finally {
    document.getElementById('btn-generate').disabled = false;
  }
}

// Wire up the generate button
document.getElementById('btn-generate').addEventListener('click', generateAI);

// Retry button
document.getElementById('btn-retry-ai')?.addEventListener('click', generateAI);
// ══════════════════════════════════════════
//  GALLERY
// ══════════════════════════════════════════
function getGallery() {
  try { return JSON.parse(localStorage.getItem('airbrush_gallery') || '[]'); }
  catch(e) { return []; }
}
function saveGallery(items) {
  localStorage.setItem('airbrush_gallery', JSON.stringify(items));
}

function addToGallery() {
  if (!S.lastGenerated) return;
  const items = getGallery();
  items.unshift({
    id:          Date.now(),
    aiUrl:       S.lastGenerated,
    sketch:      S.lastSketch || null,
    description: S.lastDesc   || '',
    createdAt:   new Date().toLocaleDateString(),
  });
  // Keep max 100 items
  if (items.length > 100) items.splice(100);
  saveGallery(items);
  showToast('✅ Saved to gallery!');
}

function openGalleryModal() {
  const modal = document.getElementById('gallery-modal');
  const grid  = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  const items = getGallery();

  // Clear old content (except empty placeholder)
  Array.from(grid.children).forEach(c => { if (c !== empty) c.remove(); });

  if (!items.length) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        <div class="gallery-card-imgs">
          ${item.sketch ? `<img class="gallery-thumb sketch-thumb" src="${item.sketch}" title="Your sketch" alt="sketch"/>` : ''}
          <img class="gallery-thumb ai-thumb" src="${item.aiUrl}" title="AI generated" alt="AI art"/>
        </div>
        <div class="gallery-card-info">
          <div class="gallery-desc">${item.description || '—'}</div>
          <div class="gallery-date">${item.createdAt}</div>
          <div class="gallery-card-actions">
            <a href="${item.aiUrl}" download="airbrush-${item.id}.png" class="gallery-dl-btn">⬇ Save</a>
            <button class="gallery-del-btn" data-id="${item.id}">🗑</button>
          </div>
        </div>`;
      card.querySelector('.gallery-del-btn').addEventListener('click', () => {
        const updated = getGallery().filter(i => i.id !== item.id);
        saveGallery(updated);
        card.remove();
        if (!grid.querySelectorAll('.gallery-card').length) empty.style.display = 'block';
      });
      grid.appendChild(card);
    });
  }
  modal.style.display = 'flex';
}

// ── STATUS ────────────────────────────────
function setStatus(type, msg) {
  statusDot.className    = 'status-dot ' + type;
  statusText.textContent = msg;
}

// ── TOAST ─────────────────────────────────
let _toastTimer = null;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── START ─────────────────────────────────
init();
fillWhite();
