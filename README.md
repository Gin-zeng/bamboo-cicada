# Bamboo Cicada · 3D Simulation Game 🎋

> A browser-based 3D interactive simulation of **「竹知了」(Bamboo Cicada)**, a traditional Chinese bamboo toy.

**English** | [中文文档](README.zh-CN.md)

A "Bamboo Cicada" is an old toy made of a bamboo stick with a thin bamboo blade threaded onto it. Rub the stick between your hands to spin the blade at high speed — the blade cuts through the air and vibrates, producing a *"wa-wu, wa-wu"* sound just like summer cicadas. The faster it spins, the higher the pitch; as it slows down, the sound gets deeper and duller until it stops.

This project recreates the whole experience in the browser using **Three.js + Web Audio API + MediaPipe Hands** — **no build step, no backend, purely static**, just open and play.

<p align="center">
  <img src="assets/screenshot-desktop.png" alt="Desktop" width="65%">
  <img src="assets/screenshot-mobile.png" alt="Mobile" width="24%">
</p>

---

## ✨ Features

- 🎋 **3D bamboo texture**: stick + blade + nodes modeled with a golden bamboo color, directional/rim lighting for depth, drag-to-rotate camera.
- 🌀 **Realistic spinning physics**: rubbing gives the blade angular velocity, which then decays naturally under air drag (linear + quadratic).
- 🔊 **Real-time cicada synthesis via Web Audio**: **no pre-recorded audio** — pitch and loudness follow the spin speed continuously and fade out naturally as it stops.
- 👻 **Motion trail**: 7 semi-transparent blade copies fan out / collapse with speed, making deceleration visually obvious.
- 🖐️ **Multi-input**: mouse drag / touch / shake (DeviceMotion) / camera gesture (MediaPipe Hands).
- 🏆 **Challenge scoring**: continuous chirp duration, live score, top speed and best records (persisted in `localStorage`).

## 🎮 How to play

1. Click **开始玩 (Start)**.
2. **Rub the stick**: on desktop, press and drag back and forth on the blade/stick; on mobile, rub with one finger or just **shake** the phone; or enable the camera and rub your palms in front of the lens.
3. Once the blade spins, listen to the pitch change with speed; release and it decays naturally until it stops.
4. Challenge: **keep it chirping longer and reach a higher speed** to beat your own records.

## 🛠 Tech stack

| Technology | Purpose |
| --- | --- |
| [Three.js r128](https://threejs.org/) | 3D rendering, lighting, shadows |
| Web Audio API | Real-time cicada synthesis (sawtooth carrier + LFO pulse modulation) |
| [MediaPipe Hands](https://developers.google.com/mediapipe) | Camera hand-gesture recognition (lazy-loaded) |
| Vanilla JavaScript | Physics, interaction, scoring (no build tool, no framework) |

## 📐 Technical details

### 1. Spinning physics

The blade rotates around the stick axis, with state `θ` (angle) and `ω` (angular velocity). Rubbing maps directly to a target speed; on release it decays freely:

```
dω/dt = -k1·ω - k2·ω·|ω|        (air drag: linear + quadratic)
θ += ω·dt
```

- Linear term `k1 = 0.02` (air viscosity, dominates at low speed)
- Quadratic term `k2 = 0.012` (pressure drag, stronger at high speed, bringing full speed to a stop in ~8–12 s)

Rubbing mapping: `ω_target = rubbing speed × 0.22` (clamped to `[0, MAX_OMEGA]`), approached with exponential smoothing for a responsive feel.

### 2. Cicada synthesis (Web Audio)

All sound is synthesized in real time. Node graph:

```
osc1(sawtooth, fCarrier) ─┐
osc2(sawtooth, detune+6)  ─┴→ bandpass filter → masterGain → destination
lfo(sine, fPulse) → lfoGain ─→ masterGain.gain  (amplitude modulation)
```

Let normalized speed `n = ω / ω_max ∈ [0,1]`. Three key parameters vary continuously with `n`:

| Parameter | Formula | Effect |
| --- | --- | --- |
| Carrier `fCarrier` | `150 + n × 1150` Hz | pitch rises with speed (150 → 1300 Hz) |
| Pulse `fPulse` | `2.5 + n × 27` Hz | the "wa-wu" rhythm densifies with speed |
| Master `gain` | `n^1.6 × 0.34` | loudness grows with speed, silent at 0 |

`fPulse` corresponds to the real toy's **blade passing frequency** — the blade cuts the air once per revolution, so faster spinning means denser "wa-wu" pulses, which is exactly where the cicada-like periodic rise-and-fall comes from. All parameters are smoothed with `setTargetAtTime` to avoid clicks.

### 3. Motion trail

Beyond the main blade, 7 semi-transparent copies share the same geometry, each lagging behind by an angle:

```
trailAngle = 0.04 + n × 0.55 rad
opacity_i  = max(0, 0.42·n - i·0.045)
```

At high speed the trail fans out into a sector/disk; as speed drops it collapses and fades, revealing the single blade — making deceleration immediately visible.

### 4. Camera gesture (MediaPipe Hands)

Clicking **📷 手势 (Gesture)** lazily loads MediaPipe (~10 MB model via CDN) and gets 21 hand landmarks. The palm center (average of palm/knuckle roots) is tracked; its horizontal velocity drives the spin:

```
handSpeed = |dx/dt| × 2600
rub detection: handSpeed > threshold  →  spin the blade
```

The result is drawn as a green skeleton overlaid on a bottom-right picture-in-picture, which is mirrored with `scaleX(-1)` for a selfie view, keeping the overlay aligned with the image.

### 5. Challenge scoring

- Speed > `140 rpm` counts as "chirping"; continuous chirp duration accumulates.
- Score integrates normalized speed during chirping.
- Best records (longest continuous chirp, top speed) are stored in `localStorage`.

## 🤖 Prompts used to generate this project

This project was generated entirely by an AI coding assistant from natural-language prompts. The original prompts (in Chinese) are reproduced below for reference:

**① Initial request**

> 帮我做一个 3D 版的「竹知了」传统玩具的仿真网页游戏，响应式多端兼容。

**② Detailed technical spec**

> 竹知了式中国传统的竹制玩具，一根竹签上串着一片薄竹片，用手搓动竹签让竹片高速旋转，竹片切割空气产生振动，发出类似夏天蝉鸣的「哇呜——哇呜——」声。转得越快、音调越高；转速慢下来，声音也跟着变闷变低，直到停下。请先联网搜索了解竹知了的构造，发声原理和真实的声音特征，确保仿真的物理和声音尽量接近真实。核心要求：
> 1. 用 Three.js 做 3D 渲染，竹知了要有立体竹制质感，支持旋转视角观察。
> 2. 声音必须用 Web Audio API 实时合成，不允许使用任何预录音频；音调和响度跟着实时转速连续变化，转速降下来声音自然衰减消失。
> 3. 竹片旋转要有真实物理模拟：搓动给初始角速度，之后受空气阻力逐渐衰减。
> 4. 支持摄像头识别手势控制竹知了旋转（MediaPipe Hands），手掌搓动驱动竹片转动。
> 5. 同时支持鼠标拖拽、手机触摸、摇一摇等传统操作。
> 6. 画面上要能明显看出竹片在高速旋转，用运动模糊或残影效果让人直观感受转速变化。
> 7. 加一个可玩挑战玩法（连续鸣叫时长 / 最高转速），实时计分并记录最好成绩。

**③ Iteration: show camera feed**

> 显示摄像头画面

**④ Open source & deploy**

> 帮我部署到我的 GitHub 仓库并开源，整理开源文件，制作 README 介绍项目提示词和技术细节。

## 🚀 Run locally

Pure static, no dependencies to install:

```bash
# Option 1: any static server
python -m http.server 8000        # then open http://localhost:8000

# Option 2: just double-click index.html
```

> Camera gestures require HTTPS or localhost (`getUserMedia` secure-context requirement); they won't work under `file://` or non-local HTTP. All other features are unaffected.

## 🌐 Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Set **Source** to `Deploy from a branch`, branch `main`, folder `/ (root)`.
4. Save and wait a moment, then visit `https://<your-username>.github.io/<repo>/`.

(You can also turn this into a GitHub Actions workflow — the site is purely static with no build step.)

## 📁 Project structure

```
.
├── index.html            # page structure + game UI
├── style.css             # responsive styles
├── app.js                # 3D / physics / audio / interaction core
├── vendor/
│   ├── three.min.js      # Three.js r128 (third-party, MIT)
│   ├── OrbitControls.js  # camera controls (third-party, MIT)
│   └── THREE-LICENSE.md  # third-party license notice
├── assets/               # README screenshots
├── LICENSE               # this project's MIT license
├── README.md             # English README (this file)
└── README.zh-CN.md       # Chinese README
```

## 📄 License

This project is licensed under the [MIT License](LICENSE).

The Three.js and OrbitControls files under `vendor/` are © [three.js authors](https://github.com/mrdoob/three.js), see [vendor/THREE-LICENSE.md](vendor/THREE-LICENSE.md).
