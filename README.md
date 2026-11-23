# Hero AR Camera 🦾🕸️⚡

Browser mein chalne wala AR camera. Isme **hand tracking, face tracking aur eye (iris) tracking** ke saath
12 superhero-style effects real-time mein chalte hain. **HD / Full HD / 2K / 4K recording** aur photo ka option bhi hai.
Install karne ki zarurat nahi: phone (Android/iPhone) aur laptop dono pe browser mein chalta hai.

## Kaise chalayein

Camera sirf **HTTPS** ya **localhost** pe chalta hai.

```bash
# Local (laptop)
cd Ar-trackinh
python3 -m http.server 8000
# browser me kholo: http://localhost:8000
```

**Phone pe chalane ke liye:** repo ko **GitHub Pages** pe deploy karo
(Settings → Pages → Branch select karo). Phir `https://<username>.github.io/<repo>/` phone pe kholo.

## Android APK

`HeroAR.apk` phone pe install karo (Settings mein "Unknown apps / is source se install" allow karna padega).
- Internet ki zarurat nahi hai, AI models APK ke andar hi hain
- Recording aur photo apne aap **Gallery → Movies/HeroAR** aur **Pictures/HeroAR** mein save hote hain
- Android 8.0+ chahiye, aur updated "Android System WebView" / Chrome hona chahiye

Khud build karne ke liye (Android SDK + JDK 17+ chahiye):
```bash
cd android
./prepare-assets.sh          # web app + MediaPipe models ko assets mein copy karta hai
./gradlew assembleRelease    # APK: app/build/outputs/apk/release/app-release.apk
```

## Characters aur gestures

| # | Effect | Style | Kaise trigger karein |
|---|--------|-------|----------------------|
| 1 | Repulsor Armor | Iron Man | ✋ Haath khola rakho, charge hoke BLAST hoga · 👁 jidhar dekho, wahan target reticle jayega |
| 2 | Web Slinger | Spider-Man | 🤟 Index + pinky seedhi, beech ki do ungliyan band → web shoot · face pe mask |
| 3 | Mystic Arts | Doctor Strange | ✋ Magic shield · 🤏 Pinch karke hawa mein gol circle banao → portal |
| 4 | Thunder God | Thor | ✋ Ungliyon mein bijli · ✊ Mutthi → aasmaan se thunder strike · 😮 Muh kholo → mouth lightning |
| 5 | Infinity Gauntlet | Thanos | 🫰 Thumb + middle finger milao, phir chhodo → SNAP, sab dhool ban jayega |
| 6 | Optic Blast | Cyclops | 😮 Muh kholo ya eyebrow upar karo → eye laser · sir aur aankh ghuma ke aim karo |
| 7 | Gamma Rage | Hulk | Hara face · 😮 Zor se muh kholo → roar shockwave · ✊ Mutthi → smash |
| 8 | Kinetic Panther | Black Panther | Claws + energy veins · ✊ Mutthi band karke charge karo, ✋ khol do → kinetic blast |
| 9 | Chaos Magic | Scarlet Witch | Red magic aur crown · ✋✋ Dono haath paas lao → chaos sphere |
| 10 | Hellfire Rider | Ghost Rider | Jalta hua skull · ✊ Mutthi → jalti chain, haath ghuma ke whip karo |
| 11 | Star Shield | Captain America | ✋ Shield · ☝️ Sirf index ungli point karo → shield throw, deewar se bounce hoke wapas aata hai |
| 12 | Photon Binary | Captain Marvel | Golden eyes aur aura · ✋ Photon beam · 😮 Cosmic pulse |

**Combo mode** (⚙️ Settings): ek saath kai characters chala sakte ho, jaise Thor + Iron + Spider.

### Controls
- **✋ Hands / 🙂 Face / 👁 Eyes**: har tracking ko alag se on/off karo
- **◎ Mesh**: tracking points dikhata hai (478 face points, iris aur 21×2 hand points)
- **⚙️ Settings**: quality (720p/1080p/1440p/4K), 30/60 fps, effect intensity, combo mode, mic audio
- **🔴 Record**: canvas ke full resolution pe high-bitrate video (1080p60 ≈ 12 Mbps, 4K ≈ 40+ Mbps). Chrome/Safari mein MP4 banta hai, baaki browsers mein WebM
- **📸 Photo**: full-res PNG · **🔄**: front/back camera
- Keyboard: `1`–`9`, `0`, `-`, `=` se character · `R` record · `P` photo · `M` mesh

## Tech
- **MediaPipe Tasks Vision** (`HandLandmarker` 2 haath, `FaceLandmarker` 478 points + iris + 52 blendshapes), GPU delegate ke saath
- Gaze = iris ka eye-corners ke relative offset + head direction (3D nose vector). Isse beams aur reticle aim hote hain
- Blendshapes se muh khulna, palak jhapakna aur eyebrow upar hona detect hota hai
- Saare effects Canvas 2D pe procedurally bante hain (additive glow sprites, lightning, particle system, verlet chain). Koi image asset nahi hai
- Recording: `canvas.captureStream()` + `MediaRecorder` (+ mic audio)
- Saari processing device pe hoti hai, video kahin upload nahi hota

```
android/          # Android app (WebView wrapper, camera permission, Gallery save)
index.html
css/style.css
js/main.js        # camera, render loop, UI, recording
js/tracker.js     # MediaPipe setup
js/scene.js       # smoothing, gestures, gaze, events
js/fx.js          # glow, lightning, particles
js/characters.js  # 12 hero effects
```

> Ye ek non-commercial fan project hai aur Marvel/Disney se affiliated nahi hai. Character names sirf "style" batane ke liye likhe hain. Koi official logo, art ya asset use nahi hua hai, saare effects code se bane hain.
