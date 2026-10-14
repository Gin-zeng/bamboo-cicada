/* ============================================================
   竹知了 · 3D 仿真游戏  — 核心逻辑
   物理：搓动给角速度，空气阻力衰减
   声音：Web Audio 实时合成（音调/响度随转速连续变化）
   交互：鼠标 / 触摸 / 摇一摇 / 摄像头手势(MediaPipe)
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  const MAX_RPM = 2600;                    // 最大转速（转/分）
  const MAX_OMEGA = MAX_RPM * Math.PI * 2 / 60; // 最大角速度 rad/s
  const CHIRP_THRESHOLD = 140;             // 低于此 rpm 视为停止鸣叫
  const SCRUB_SCALE = 0.22;                // 搓动速度 -> 角速度 映射
  const DRAG_LINEAR = 0.02;                // 空气阻力（线性，很小）
  const DRAG_QUAD = 0.012;                 // 空气阻力（二次，高速更明显）
  const TRAIL_COUNT = 7;                   // 残影数量

  /* ---------- 状态 ---------- */
  let omega = 0;                           // 角速度 rad/s
  let theta = 0;                           // 角度
  let scrubbing = false;
  let lastPX = 0, lastPY = 0;
  let lastT = performance.now();

  // 计分
  let score = 0;
  let chirpTimer = 0;                      // 当前连续鸣叫计时
  let bestChirp = parseFloat(localStorage.getItem('zzl_bestChirp') || '0');
  let bestRpm = parseFloat(localStorage.getItem('zzl_bestRpm') || '0');
  let sessionMaxRpm = 0;
  const audioState = { n: 0, fCarrier: 150, fPulse: 2.5, gain: 0 };

  // 摇一摇
  let lastMag = 0;

  // 手势
  let handSpeed = 0;                       // 手势搓动速度
  let handActive = false;

  /* ---------- DOM ---------- */
  const canvas = document.getElementById('scene');
  const ui = {
    rpmVal: document.getElementById('rpmVal'),
    chirpVal: document.getElementById('chirpVal'),
    scoreVal: document.getElementById('scoreVal'),
    bestVal: document.getElementById('bestVal'),
    gaugeFill: document.getElementById('gauge-fill'),
    hint: document.getElementById('hint'),
    overlay: document.getElementById('overlay'),
    btnStart: document.getElementById('btnStart'),
    btnSound: document.getElementById('btnSound'),
    btnCam: document.getElementById('btnCam'),
    cam: document.getElementById('cam'),
    camBox: document.getElementById('cam-box'),
    camOverlay: document.getElementById('cam-overlay')
  };
  ui.bestVal.textContent = bestChirp.toFixed(1);

  /* ---------- Three.js 场景 ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1524);
  scene.fog = new THREE.Fog(0x0e1524, 6, 18);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 60);
  camera.position.set(2.4, 1.7, 3.2);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.6;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.update();

  /* ---------- 光照 ---------- */
  scene.add(new THREE.AmbientLight(0xdfe6ff, 0.75));
  const key = new THREE.DirectionalLight(0xfff2d8, 1.25);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -5; key.shadow.camera.right = 5;
  key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fa6ff, 0.7);
  rim.position.set(-3, 1, -2);
  scene.add(rim);

  /* ---------- 材质（竹制质感） ---------- */
  const matBamboo = new THREE.MeshStandardMaterial({ color: 0xd3a24e, roughness: 0.62, metalness: 0.04 });
  const matBambooDark = new THREE.MeshStandardMaterial({ color: 0xb9863a, roughness: 0.68, metalness: 0.05 });
  const matNode = new THREE.MeshStandardMaterial({ color: 0x9a6d2f, roughness: 0.7, metalness: 0.05 });

  /* ---------- 竹知了模型 ---------- */
  const cicada = new THREE.Group();

  // 竹签（沿 Y 轴）
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.5, 24), matBamboo);
  stick.castShadow = true;
  stick.receiveShadow = true;
  cicada.add(stick);

  // 竹签上的竹节（几个细环）
  for (const y of [-0.85, 0.0, 0.85]) {
    const node = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 10, 24), matNode);
    node.rotation.x = Math.PI / 2;
    node.position.y = y;
    node.castShadow = true;
    cicada.add(node);
  }

  // 竹片组（绕 Y 轴旋转）
  const bladeGroup = new THREE.Group();
  cicada.add(bladeGroup);

  const bladeGeo = new THREE.BoxGeometry(1.7, 0.035, 0.5);
  // 主竹片
  const blade = new THREE.Mesh(bladeGeo, matBambooDark);
  blade.castShadow = true;
  blade.receiveShadow = true;
  bladeGroup.add(blade);

  // 残影（运动模糊/残影效果）
  const ghosts = [];
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const gm = new THREE.MeshStandardMaterial({
      color: 0xd3a24e, roughness: 0.6, metalness: 0.04,
      transparent: true, opacity: 0, depthWrite: false
    });
    const g = new THREE.Mesh(bladeGeo, gm);
    g.castShadow = false;
    bladeGroup.add(g);
    ghosts.push(g);
  }

  // 竹片中心的小轴帽（竹签穿过竹片的视觉提示）
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 24), matNode);
  hub.castShadow = true;
  bladeGroup.add(hub);

  scene.add(cicada);

  /* ---------- 可交互对象（搓动命中检测） ---------- */
  const hitTargets = [stick, blade];

  /* ---------- Web Audio ---------- */
  let audioCtx = null;
  let masterGain = null;
  let osc1 = null, osc2 = null;
  let lfo = null, lfoGain = null;
  let soundOn = true;

  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0;

      // 载波（蝉鸣主体）：锯齿波，音调随转速
      osc1 = audioCtx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 150;
      const g1 = audioCtx.createGain();
      g1.gain.value = 0.7;

      osc2 = audioCtx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 150;
      osc2.detune.value = 6;
      const g2 = audioCtx.createGain();
      g2.gain.value = 0.3;

      // 带通滤波塑形（更像蝉鸣的共鸣腔）
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.9;

      // 低频 LFO 做「哇呜哇呜」脉冲节律
      lfo = audioCtx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 6;
      lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 0.5;

      // 接线
      osc1.connect(g1); osc2.connect(g2);
      g1.connect(filter); g2.connect(filter);
      filter.connect(masterGain);
      lfo.connect(lfoGain);
      lfoGain.connect(masterGain.gain); // 幅度调制
      masterGain.connect(audioCtx.destination);

      osc1.start(); osc2.start(); lfo.start();
      ui.btnSound.classList.add('on');
      ui.btnSound.textContent = '🔊 声音开';
    } catch (e) {
      console.warn('audio init failed', e);
      audioCtx = null;
    }
  }

  function setAudioParams(n) {
    const fCarrier = 150 + n * 1150;          // 150 ~ 1300 Hz
    const fPulse = 2.5 + n * 27;              // 2.5 ~ 29.5 Hz
    const gain = soundOn ? Math.pow(n, 1.6) * 0.34 : 0;
    audioState.n = n; audioState.fCarrier = fCarrier; audioState.fPulse = fPulse; audioState.gain = gain;
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    osc1.frequency.setTargetAtTime(fCarrier, t, 0.03);
    osc2.frequency.setTargetAtTime(fCarrier, t, 0.03);
    lfo.frequency.setTargetAtTime(fPulse, t, 0.03);
    // 用 lfoGain 控制「哇呜」深度：转速低时节律更明显
    lfoGain.gain.setTargetAtTime(0.35 + n * 0.35, t, 0.03);
    masterGain.gain.setTargetAtTime(gain, t, 0.05);
  }

  /* ---------- 声音开关 ---------- */
  ui.btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    ui.btnSound.textContent = soundOn ? '🔊 声音开' : '🔇 声音关';
    ui.btnSound.classList.toggle('on', soundOn);
    ui.btnSound.classList.toggle('off', !soundOn);
    if (!soundOn && masterGain) masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
  });

  /* ---------- 物理更新 ---------- */
  function stepPhysics(dt) {
    if (scrubbing || handActive) {
      // 搓动：目标转速 = 搓动速度（或手势速度）映射
      const v = scrubbing ? scrubSpeed : handSpeed;
      const target = Math.min(v * SCRUB_SCALE, MAX_OMEGA);
      omega += (target - omega) * 0.4;
    } else {
      // 自由衰减：空气阻力（线性 + 二次）
      omega *= Math.exp(-DRAG_LINEAR * dt);
      omega -= Math.sign(omega) * DRAG_QUAD * omega * omega * dt;
      if (Math.abs(omega) < 0.05) omega = 0;
    }
    // 摇一摇注入
    if (shakeBoost > 0) {
      omega += shakeBoost;
      shakeBoost = 0;
    }
    omega = Math.max(0, Math.min(omega, MAX_OMEGA));
    theta += omega * dt;
  }

  /* ---------- 残影更新 ---------- */
  function updateTrail(n) {
    const trail = 0.04 + n * 0.55; // 残影间距（弧度）
    for (let i = 0; i < ghosts.length; i++) {
      ghosts[i].rotation.y = -trail * (i + 1);
      const op = Math.max(0, 0.42 * n - i * 0.045);
      ghosts[i].material.opacity = op;
    }
    blade.material.opacity = 1;
  }

  /* ---------- 主循环 ---------- */
  function loop(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    stepPhysics(dt);

    const rpm = omega * 60 / (Math.PI * 2);
    const n = Math.max(0, Math.min(omega / MAX_OMEGA, 1));

    // 竹片旋转
    bladeGroup.rotation.y = theta;
    updateTrail(n);

    // 声音
    setAudioParams(n);

    // 计分
    if (rpm > CHIRP_THRESHOLD) {
      chirpTimer += dt;
      score += Math.floor(n * 120 * dt);
      if (chirpTimer > bestChirp) {
        bestChirp = chirpTimer;
        localStorage.setItem('zzl_bestChirp', bestChirp.toFixed(2));
      }
      sessionMaxRpm = Math.max(sessionMaxRpm, rpm);
      if (rpm > bestRpm) {
        bestRpm = rpm;
        localStorage.setItem('zzl_bestRpm', bestRpm.toFixed(0));
      }
    } else if (chirpTimer > 0) {
      chirpTimer = 0;
    }

    // UI
    ui.rpmVal.textContent = Math.round(rpm);
    ui.chirpVal.textContent = chirpTimer.toFixed(1);
    ui.scoreVal.textContent = score;
    ui.gaugeFill.style.height = (n * 100).toFixed(1) + '%';
    ui.bestVal.textContent = bestChirp.toFixed(1);

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  /* ---------- 搓动输入（鼠标 + 触摸，Pointer Events） ---------- */
  let scrubSpeed = 0;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  function hitCicada(ev) {
    pointerNdc.x = (ev.clientX / window.innerWidth) * 2 - 1;
    pointerNdc.y = -(ev.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(hitTargets, true);
    return hits.length > 0;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (hitCicada(ev)) {
      scrubbing = true;
      lastPX = ev.clientX; lastPY = ev.clientY;
      scrubSpeed = 0;
      controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!scrubbing) return;
    const now = performance.now();
    const dt = Math.max((now - lastT) / 1000, 0.001);
    const dx = ev.clientX - lastPX;
    const dy = ev.clientY - lastPY;
    scrubSpeed = Math.hypot(dx, dy) / dt;
    lastPX = ev.clientX; lastPY = ev.clientY;
  });

  function endScrub() {
    scrubbing = false;
    scrubSpeed = 0;
    controls.enabled = true;
  }
  canvas.addEventListener('pointerup', endScrub);
  canvas.addEventListener('pointercancel', endScrub);
  canvas.addEventListener('lostpointercapture', endScrub);

  /* ---------- 摇一摇 ---------- */
  let shakeBoost = 0;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    const delta = Math.abs(mag - lastMag);
    lastMag = mag;
    if (delta > 9) {
      shakeBoost += Math.min(delta * 1.6, 40);
      ui.hint.classList.add('flash');
      setTimeout(() => ui.hint.classList.remove('flash'), 300);
    }
  }
  function requestMotion() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then(s => {
        if (s === 'granted') window.addEventListener('devicemotion', onMotion);
      }).catch(() => {});
    } else {
      window.addEventListener('devicemotion', onMotion);
    }
  }

  /* ---------- 摄像头手势（MediaPipe Hands） ---------- */
  let mediaPipeStarted = false;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17]
  ];

  function drawHand(landmarks) {
    const cv = ui.camOverlay;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    if (!landmarks || !landmarks.length) return;
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const [a, b] of HAND_CONNECTIONS) {
      const p = landmarks[a], q = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(p.x * w, p.y * h);
      ctx.lineTo(q.x * w, q.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = '#22c55e';
    for (const p of landmarks) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  async function startGesture() {
    if (mediaPipeStarted) return;
    ui.btnCam.textContent = '📷 加载中…';    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js');

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      ui.cam.srcObject = stream;
      await ui.cam.play();

      const hands = new Hands({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`
      });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });

      let prevX = null, prevT = 0;
      hands.onResults((results) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          const lm = results.multiHandLandmarks[0];
          drawHand(lm);
          const cx = (lm[9].x + lm[0].x + lm[5].x + lm[17].x) / 4; // 手掌中心近似
          const now = performance.now();
          if (prevX !== null) {
            const dt = Math.max((now - prevT) / 1000, 0.016);
            const v = (cx - prevX) / dt; // 归一化坐标速度
            handSpeed = Math.min(Math.abs(v) * 2600, MAX_OMEGA * 1.2);
            handActive = handSpeed > 30;
          }
          prevX = cx; prevT = now;
        } else {
          drawHand(null);
          handActive = false; handSpeed = 0;
        }
      });

      const cameraUtil = new Camera(ui.cam, {
        onFrame: async () => { await hands.send({ image: ui.cam }); },
        width: 640, height: 480
      });
      await cameraUtil.start();
      mediaPipeStarted = true;
      const cv = ui.camOverlay;
      cv.width = 180; cv.height = 135;
      ui.camBox.classList.add('show');
      ui.btnCam.textContent = '📷 手势开';
      ui.btnCam.classList.add('on');
      ui.hint.textContent = '👋 对着摄像头来回搓动手掌，驱动竹片转动';
    } catch (e) {
      console.warn('gesture failed', e);
      ui.btnCam.textContent = '📷 手势不可用';
      ui.btnCam.classList.add('off');
      ui.hint.textContent = '手势需摄像头权限与网络加载模型；可用鼠标/触摸/摇一摇继续玩';
    }
  }
  ui.btnCam.addEventListener('click', startGesture);

  /* ---------- 开始 ---------- */
  ui.btnStart.addEventListener('click', () => {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    requestMotion();
    ui.overlay.classList.add('hide');
  });

  /* ---------- resize ---------- */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ---------- 暴露给验证脚本 ---------- */
  window.__cicada = {
    get rpm() { return omega * 60 / (Math.PI * 2); },
    get omega() { return omega; },
    get scrubbing() { return scrubbing; },
    get audioReady() { return !!audioCtx; },
    get score() { return score; },
    get bestChirp() { return bestChirp; },
    get triangles() { return renderer.info.render.triangles; },
    get audioState() { return { ...audioState }; },
    get trail() { return ghosts.map(g => g.material.opacity); },
    get theta() { return theta; },
    get chirpTimer() { return chirpTimer; },
    spin: (v) => { omega = Math.max(0, Math.min(v, MAX_OMEGA)); }
  };

  /* ---------- 启动 ---------- */
  requestAnimationFrame(loop);
})();
