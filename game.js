
(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const canvas = $("#game");
  const video = $("#video");
  const ctx = canvas?.getContext("2d");
  const startButton = $("#start");
  const overlay = $("#overlay");
  const statusText = $("#status");
  const placeholder = $("#placeholder");

  if (!canvas || !ctx || !video || !startButton || !overlay) {
    console.error("Gesture Pong: elemen HTML game tidak lengkap.");
    if (statusText) statusText.textContent = "Periksa elemen HTML.";
    return;
  }

  const W = 1100;
  const H = 620;

  canvas.width = W;
  canvas.height = H;

  const settings = {
    speed: $("#speedSetting"),
    theme: $("#themeSetting"),
    target: $("#targetSetting"),
    ballSize: $("#ballSizeSetting"),
    ballSizeValue: $("#ballSizeValue"),
    targetLabel: $("#targetLabel"),
    apply: $("#applySettings")
  };

  const scoreEls = [$("#s1"), $("#s2")];
  const stateLabel = $("#state");
  const cameraState = $("#camstate");

  const speedValues = {
    slow: 3,
    normal: 5,
    fast: 7,
    insane: 10
  };

  const colors = {
    purple: {
      ball: "#b38aff",
      glow: "#b38aff"
    },
    cyan: {
      ball: "#50f5ff",
      glow: "#50f5ff"
    },
    classic: {
      ball: "#f3f6ff",
      glow: "#f3f6ff"
    }
  };

  let ballSpeed = speedValues[settings.speed?.value] || 5;
  let ballRadius = Number(settings.ballSize?.value) || 10;
  let targetScore = Number(settings.target?.value) || 11;
  let theme = settings.theme?.value || "purple";

  let hands = null;
  let camera = null;
  let cameraReady = false;
  let cameraStarting = false;
  let handFrameBusy = false;

  let running = false;
  let paused = false;
  let gameOver = false;
  let animationId = null;
  let lastFrame = 0;

  // Posisi telunjuk dari tangan yang terdeteksi.
  let detectedHands = [];

  // Canvas khusus untuk menggambar skeleton neon di atas kamera.
  let handCanvas = null;
  let handCtx = null;

  const trails = [[], []];
  const trailLimit = 15;

  const paddles = [
    {
      x: 32,
      y: H / 2 - 65,
      w: 13,
      h: 130,
      score: 0,
      color: "#50f5ff"
    },
    {
      x: W - 45,
      y: H / 2 - 65,
      w: 13,
      h: 130,
      score: 0,
      color: "#b38aff"
    }
  ];

  const ball = {
    x: W / 2,
    y: H / 2,
    vx: 5,
    vy: 3,
    r: ballRadius
  };

  const keys = {
    w: false,
    s: false,
    up: false,
    down: false
  };

  // Koneksi antar-21 titik tangan MediaPipe.
  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
  ];

  function setStatus(message) {
    if (statusText) statusText.textContent = message;
  }

  function setCameraStatus(message) {
    if (cameraState) cameraState.textContent = message;
  }

  function showOverlay(title, description, buttonText = "START GAME") {
    const titleEl = $("#otitle");
    const descEl = $("#odesc");

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = description;

    startButton.textContent = buttonText;
    overlay.hidden = false;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlay.classList.add("hidden");
  }

  function updateScores() {
    scoreEls.forEach((element, index) => {
      if (element) element.textContent = paddles[index].score;
    });
  }

  // ==================================================
  // NEON HAND OVERLAY
  // ==================================================

  function setupHandCanvas() {
    const videoBox = video.closest(".videobox");

    if (!videoBox) {
      console.warn(
        'Elemen ".videobox" tidak ditemukan. Efek skeleton kamera tidak dapat dibuat.'
      );
      return;
    }

    if (getComputedStyle(videoBox).position === "static") {
      videoBox.style.position = "relative";
    }

    handCanvas = $("#hand-effects");

    if (!handCanvas) {
      handCanvas = document.createElement("canvas");
      handCanvas.id = "hand-effects";
      videoBox.appendChild(handCanvas);
    }

    Object.assign(handCanvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "10"
    });

    handCtx = handCanvas.getContext("2d");
    resizeHandCanvas();
  }

  function resizeHandCanvas() {
    if (!handCanvas || !handCtx) return;

    const rect = handCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (!rect.width || !rect.height) return;

    handCanvas.width = Math.round(rect.width * dpr);
    handCanvas.height = Math.round(rect.height * dpr);

    handCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resizeHandCanvas);

  function drawNeonHands(results) {
    if (!handCanvas || !handCtx) return;

    const width = handCanvas.clientWidth;
    const height = handCanvas.clientHeight;

    if (!width || !height) return;

    handCtx.clearRect(0, 0, width, height);

    const allHands = results.multiHandLandmarks || [];

    allHands.forEach((landmarks, handIndex) => {
      const points = landmarks.map((point) => ({
        // Membalik X agar efek sesuai dengan tampilan selfie.
        x: (1 - point.x) * width,
        y: point.y * height
      }));

      const color = handIndex === 0 ? "#00f7ff" : "#ff35f7";

      handCtx.save();
      handCtx.lineCap = "round";
      handCtx.lineJoin = "round";

      // Cahaya luar garis.
      handCtx.beginPath();

      HAND_CONNECTIONS.forEach(([a, b]) => {
        handCtx.moveTo(points[a].x, points[a].y);
        handCtx.lineTo(points[b].x, points[b].y);
      });

      handCtx.strokeStyle = color;
      handCtx.lineWidth = 5;
      handCtx.shadowColor = color;
      handCtx.shadowBlur = 18;
      handCtx.stroke();

      // Garis inti berwarna putih.
      handCtx.beginPath();

      HAND_CONNECTIONS.forEach(([a, b]) => {
        handCtx.moveTo(points[a].x, points[a].y);
        handCtx.lineTo(points[b].x, points[b].y);
      });

      handCtx.strokeStyle = "#ffffff";
      handCtx.lineWidth = 1.3;
      handCtx.shadowColor = color;
      handCtx.shadowBlur = 9;
      handCtx.stroke();

      // Titik-titik landmark.
      points.forEach((point, index) => {
        const fingertip = [4, 8, 12, 16, 20].includes(index);
        const radius = fingertip ? 5 : 3;

        handCtx.beginPath();
        handCtx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        handCtx.fillStyle = "#ffffff";
        handCtx.shadowColor = color;
        handCtx.shadowBlur = 20;
        handCtx.fill();

        handCtx.beginPath();
        handCtx.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
        handCtx.strokeStyle = color;
        handCtx.lineWidth = 1.5;
        handCtx.stroke();
      });

      handCtx.restore();
    });
  }

  // ==================================================
  // GAME LOGIC
  // ==================================================

  function resetBall(direction = Math.random() < 0.5 ? -1 : 1) {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.r = ballRadius;

    const angle = Math.random() * 0.8 - 0.4;

    ball.vx = direction * ballSpeed;
    ball.vy = Math.sin(angle) * ballSpeed;
  }

  function resetGame() {
    paddles.forEach((paddle) => {
      paddle.score = 0;
      paddle.y = H / 2 - paddle.h / 2;
    });

    trails.forEach((trail) => trail.splice(0));

    updateScores();

    paused = false;
    gameOver = false;
    resetBall();
    draw();

    if (stateLabel) stateLabel.textContent = "READY";
    setStatus(cameraReady ? "CAMERA READY" : "KEYBOARD MODE");
  }

  function applySettings(resetScores = false) {
    ballSpeed = speedValues[settings.speed?.value] || 5;
    ballRadius = Number(settings.ballSize?.value) || 10;
    targetScore = Number(settings.target?.value) || 11;
    theme = settings.theme?.value || "purple";

    ball.r = ballRadius;

    if (settings.ballSizeValue) {
      settings.ballSizeValue.textContent = `${ballRadius}px`;
    }

    if (settings.targetLabel) {
      settings.targetLabel.textContent = `FIRST TO ${targetScore}`;
    }

    document.documentElement.dataset.theme = theme;

    if (resetScores) {
      resetGame();
    } else {
      resetBall(Math.sign(ball.vx) || 1);
    }

    draw();
  }

  function drawTrailEffects() {
    trails.forEach((trail, index) => {
      const paddle = paddles[index];

      if (trail.length > 1) {
        ctx.save();
        ctx.beginPath();

        trail.forEach((point, pointIndex) => {
          if (pointIndex === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });

        ctx.strokeStyle = paddle.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5;
        ctx.shadowColor = paddle.color;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();
      }

      if (trail.length > 0) {
        const point = trail[trail.length - 1];

        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = paddle.color;
        ctx.fillStyle = paddle.color;
        ctx.shadowColor = paddle.color;
        ctx.shadowBlur = 22;
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    });
  }

  function draw() {
    const palette = colors[theme] || colors.purple;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0b0713";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.setLineDash([10, 13]);
    ctx.strokeStyle = "#ffffff25";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "#ffffff15";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 75, 0, Math.PI * 2);
    ctx.stroke();

    drawTrailEffects();

    paddles.forEach((paddle, index) => {
      ctx.save();
      ctx.shadowBlur = detectedHands.length > index ? 30 : 18;
      ctx.shadowColor = paddle.color;
      ctx.fillStyle = paddle.color;

      // roundRect tersedia di browser modern.
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(
          paddle.x,
          paddle.y,
          paddle.w,
          paddle.h,
          Math.min(7, paddle.w / 2)
        );
        ctx.fill();
      } else {
        ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
      }

      ctx.restore();
    });

    ctx.save();
    ctx.shadowBlur = 25;
    ctx.shadowColor = palette.glow;
    ctx.fillStyle = palette.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (cameraReady) {
      ctx.save();
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff99";
      ctx.fillText(
        detectedHands.length
          ? `${detectedHands.length} HAND(S) DETECTED`
          : "SHOW YOUR HANDS",
        W / 2,
        25
      );
      ctx.restore();
    }

    if (!running || paused || gameOver) {
      ctx.fillStyle = "#ffffff75";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";

      ctx.fillText(
        gameOver
          ? "MATCH FINISHED"
          : paused
            ? "PAUSED"
            : "READY TO PLAY",
        W / 2,
        H - 30
      );
    }
  }

  function movePaddles(delta) {
    const step = 7 * delta;

    // Kontrol keyboard tetap berfungsi.
    if (keys.w) paddles[0].y -= step;
    if (keys.s) paddles[0].y += step;
    if (keys.up) paddles[1].y -= step;
    if (keys.down) paddles[1].y += step;

    // Satu tangan mengontrol paddle kiri.
    // Dua tangan mengontrol paddle kiri dan kanan.
    detectedHands.forEach((hand, index) => {
      const paddle = paddles[index];
      if (!paddle) return;

      const desiredY = hand.y * H - paddle.h / 2;
      const smoothing = Math.min(1, 0.24 * delta);

      paddle.y += (desiredY - paddle.y) * smoothing;

      const effectX =
        index === 0
          ? paddle.x + paddle.w + 24
          : paddle.x - 24;

      trails[index].push({
        x: effectX,
        y: hand.y * H
      });

      while (trails[index].length > trailLimit) {
        trails[index].shift();
      }
    });

    for (let i = 0; i < 2; i++) {
      if (!detectedHands[i]) {
        trails[i].splice(0, Math.max(0, trails[i].length - 2));
      }
    }

    paddles.forEach((paddle) => {
      paddle.y = Math.max(0, Math.min(H - paddle.h, paddle.y));
    });
  }

  function scorePoint(playerIndex) {
    paddles[playerIndex].score++;
    updateScores();

    if (paddles[playerIndex].score >= targetScore) {
      gameOver = true;
      running = false;
      cancelAnimationFrame(animationId);

      const winner =
        playerIndex === 0 ? "PLAYER 1 WINS!" : "PLAYER 2 WINS!";

      setStatus(winner);
      if (stateLabel) stateLabel.textContent = "FINISHED";

      showOverlay(
        winner,
        "Pertandingan selesai. Tekan tombol untuk bermain lagi.",
        "PLAY AGAIN"
      );

      draw();
      return;
    }

    resetBall(playerIndex === 0 ? 1 : -1);
  }

  function update(delta) {
    movePaddles(delta);

    ball.x += ball.vx * delta;
    ball.y += ball.vy * delta;

    if (ball.y - ball.r <= 0) {
      ball.y = ball.r;
      ball.vy = Math.abs(ball.vy);
    }

    if (ball.y + ball.r >= H) {
      ball.y = H - ball.r;
      ball.vy = -Math.abs(ball.vy);
    }

    const left = paddles[0];

    if (
      ball.vx < 0 &&
      ball.x - ball.r <= left.x + left.w &&
      ball.x + ball.r >= left.x &&
      ball.y >= left.y &&
      ball.y <= left.y + left.h
    ) {
      ball.x = left.x + left.w + ball.r;
      ball.vx = Math.abs(ball.vx) * 1.04;

      const hit =
        (ball.y - (left.y + left.h / 2)) / (left.h / 2);

      ball.vy = hit * ballSpeed;
    }

    const right = paddles[1];

    if (
      ball.vx > 0 &&
      ball.x + ball.r >= right.x &&
      ball.x - ball.r <= right.x + right.w &&
      ball.y >= right.y &&
      ball.y <= right.y + right.h
    ) {
      ball.x = right.x - ball.r;
      ball.vx = -Math.abs(ball.vx) * 1.04;

      const hit =
        (ball.y - (right.y + right.h / 2)) / (right.h / 2);

      ball.vy = hit * ballSpeed;
    }

    const maxSpeed = ballSpeed * 2.3;
    ball.vx = Math.max(-maxSpeed, Math.min(maxSpeed, ball.vx));
    ball.vy = Math.max(-maxSpeed, Math.min(maxSpeed, ball.vy));

    if (ball.x + ball.r < 0) scorePoint(1);
    if (ball.x - ball.r > W) scorePoint(0);
  }

  function frame(timestamp) {
    if (!running || paused || gameOver) return;

    const delta = lastFrame
      ? Math.min((timestamp - lastFrame) / 16.67, 2)
      : 1;

    lastFrame = timestamp;

    update(delta);
    draw();

    animationId = requestAnimationFrame(frame);
  }

  // ==================================================
  // MEDIAPIPE CAMERA
  // ==================================================

  async function startCamera() {
    if (cameraReady) return true;
    if (cameraStarting) return false;

    cameraStarting = true;
    setCameraStatus("STARTING...");
    setStatus("MEMINTA AKSES KAMERA...");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Kamera membutuhkan localhost atau HTTPS.");
      }

      if (!window.Hands || !window.Camera) {
        throw new Error(
          "MediaPipe belum dimuat. Periksa script CDN di index.html."
        );
      }

      setupHandCanvas();

      hands = new window.Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        selfieMode: true,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5
      });

      hands.onResults((results) => {
        // Gambar garis dan titik neon di atas video kamera.
        drawNeonHands(results);

        const landmarksList = results.multiHandLandmarks || [];
        const found = [];

        landmarksList.forEach((landmarks) => {
          if (!landmarks || !landmarks[8]) return;

          found.push({
            x: Math.max(0, Math.min(1, landmarks[8].x)),
            y: Math.max(0, Math.min(1, landmarks[8].y))
          });
        });

        // Urutkan tangan berdasarkan posisi horizontal.
        found.sort((a, b) => a.x - b.x);
        detectedHands = found.slice(0, 2);

        if (placeholder) {
          placeholder.classList.toggle(
            "hidden",
            detectedHands.length > 0
          );
        }

        if (detectedHands.length === 2) {
          setCameraStatus("2 HANDS DETECTED");
          setStatus("DUAL HAND TRACKING ACTIVE");
        } else if (detectedHands.length === 1) {
          setCameraStatus("1 HAND DETECTED");
          setStatus("SINGLE HAND TRACKING");
        } else {
          setCameraStatus("NO HAND DETECTED");
          setStatus("TUNJUKKAN TANGAN KE KAMERA");
        }

        if (!running) draw();
      });

      video.muted = true;
      video.playsInline = true;

      camera = new window.Camera(video, {
        onFrame: async () => {
          if (
            hands &&
            !handFrameBusy &&
            video.readyState >= 2
          ) {
            handFrameBusy = true;

            try {
              await hands.send({ image: video });
            } catch (error) {
              console.error("Gagal memproses tangan:", error);
            } finally {
              handFrameBusy = false;
            }
          }
        },
        width: 640,
        height: 360
      });

      await camera.start();

      cameraReady = true;

      if (placeholder) placeholder.classList.add("hidden");

      setCameraStatus("CAMERA READY");
      setStatus("HAND TRACKING ACTIVE");

      return true;
    } catch (error) {
      console.error("Gagal mengaktifkan kamera:", error);

      cameraReady = false;
      detectedHands = [];

      try {
        camera?.stop();
      } catch (_) {}

      camera = null;

      if (hands) {
        try {
          await hands.close();
        } catch (_) {}
      }

      hands = null;

      setCameraStatus("CAMERA OFF");
      setStatus("KAMERA GAGAL — GUNAKAN KEYBOARD");

      if (placeholder) {
        placeholder.classList.remove("hidden");
        placeholder.textContent =
          "Kamera tidak aktif. Gunakan keyboard.";
      }

      return false;
    } finally {
      cameraStarting = false;
    }
  }

  // ==================================================
  // START / PAUSE / RESUME
  // ==================================================

  async function startGame() {
    if (running && !paused) return;

    if (gameOver) resetGame();

    // Kamera dicoba, tetapi kegagalan kamera tidak
    // menghalangi permainan dengan keyboard.
    if (!cameraReady && !cameraStarting) {
      await startCamera();
    }

    paused = false;
    gameOver = false;
    running = true;
    lastFrame = 0;

    hideOverlay();

    setStatus(
      cameraReady
        ? "GAME RUNNING · HAND TRACKING"
        : "GAME RUNNING · KEYBOARD"
    );

    if (stateLabel) stateLabel.textContent = "PLAYING";

    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(frame);
  }

  function togglePause() {
    if (gameOver) return;

    if (!running && !paused) {
      startGame();
      return;
    }

    if (paused) {
      startGame();
      return;
    }

    paused = true;
    running = false;

    cancelAnimationFrame(animationId);

    showOverlay(
      "GAME PAUSED",
      "Tekan RESUME untuk melanjutkan.",
      "RESUME"
    );

    setStatus("PAUSED");
    if (stateLabel) stateLabel.textContent = "PAUSED";

    draw();
  }

  // Pastikan tombol #start terhubung ke fungsi yang benar.
  startButton.addEventListener("click", (event) => {
    event.preventDefault();
    startGame();
  });

  settings.apply?.addEventListener("click", () => {
    applySettings(true);
  });

  settings.speed?.addEventListener("change", () => applySettings());
  settings.ballSize?.addEventListener("input", () => applySettings());
  settings.target?.addEventListener("change", () => applySettings());
  settings.theme?.addEventListener("change", () => applySettings());

  $("#reset")?.addEventListener("click", () => {
    resetGame();

    if (running) {
      cancelAnimationFrame(animationId);
      lastFrame = 0;
      animationId = requestAnimationFrame(frame);
    }
  });

  // ==================================================
  // KEYBOARD
  // ==================================================

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (["arrowup", "arrowdown", " "].includes(key)) {
      event.preventDefault();
    }

    if (key === "w") keys.w = true;
    if (key === "s") keys.s = true;
    if (key === "arrowup") keys.up = true;
    if (key === "arrowdown") keys.down = true;

    if (key === " " && !event.repeat) togglePause();

    if (key === "r" && !event.repeat) {
      resetGame();

      if (running) {
        cancelAnimationFrame(animationId);
        lastFrame = 0;
        animationId = requestAnimationFrame(frame);
      }
    }
  });

  document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();

    if (key === "w") keys.w = false;
    if (key === "s") keys.s = false;
    if (key === "arrowup") keys.up = false;
    if (key === "arrowdown") keys.down = false;
  });

  window.addEventListener("beforeunload", () => {
    try {
      camera?.stop();
    } catch (_) {}

    try {
      hands?.close();
    } catch (_) {}
  });

  // ==================================================
  // INITIALIZATION
  // ==================================================

  setupHandCanvas();
  applySettings();
  resetGame();

  showOverlay(
    "GESTURE PONG",
    "Gunakan satu tangan untuk Player 1 atau dua tangan untuk menggerakkan kedua paddle. Tekan START GAME untuk mulai.",
    "START GAME"
  );

  setStatus("READY");
})();
