
import * as THREE from 'three';

// ==================== SCENE ====================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030414);
scene.fog = new THREE.FogExp2(0x030414, 0.004);

const camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 4, 10);
camera.lookAt(0, 0, -5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '0';
renderer.domElement.style.display = 'block';
document.body.appendChild(renderer.domElement);

// ==================== LIGHTS ====================
scene.add(new THREE.AmbientLight(0x8299ff, 1.8));

const light = new THREE.PointLight(0x168bff, 100, 100);
light.position.set(0, 8, 5);
scene.add(light);

// ==================== GAME STATE ====================
let gameRunning = false;
let isPaused = false;
let gameOver = false;

let score = 0;
let lives = 3;
let elapsed = 0;
let spawnTimer = 0;
let invulnerableTimer = 0;
let highScore = 0;

const clock = new THREE.Clock();
const keys = {};

// ==================== BUILT-IN GAME AUDIO ====================
// Web Audio API creates sounds. No MP3 files are required.
let audioContext = null;
let audioMaster = null;
let musicGain = null;
let engineGain = null;
let engineOscillator = null;
let audioMuted = false;
let musicTimer = null;
let musicStep = 0;

function initializeAudio() {
    if (audioContext) {
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
        return;
    }

    const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    audioContext = new AudioContextClass();

    audioMaster = audioContext.createGain();
    audioMaster.gain.value = audioMuted ? 0 : 0.7;
    audioMaster.connect(audioContext.destination);

    // Background space ambience
    musicGain = audioContext.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(audioMaster);

    const drone1 = audioContext.createOscillator();
    const drone2 = audioContext.createOscillator();
    const droneFilter = audioContext.createBiquadFilter();

    drone1.type = 'sine';
    drone2.type = 'triangle';

    drone1.frequency.value = 55;
    drone2.frequency.value = 82.4;
    drone2.detune.value = -7;

    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 360;

    drone1.connect(droneFilter);
    drone2.connect(droneFilter);
    droneFilter.connect(musicGain);

    drone1.start();
    drone2.start();

    // Spaceship engine hum
    engineGain = audioContext.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(audioMaster);

    engineOscillator = audioContext.createOscillator();
    engineOscillator.type = 'sawtooth';
    engineOscillator.frequency.value = 48;

    const engineFilter = audioContext.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 150;

    engineOscillator.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineOscillator.start();
}

function playTone({
    frequency = 440,
    endFrequency = frequency,
    duration = 0.16,
    type = 'sine',
    volume = 0.25
} = {}) {
    if (!audioContext || audioMuted || !audioMaster) return;

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;

    oscillator.frequency.setValueAtTime(
        Math.max(1, frequency),
        now
    );

    oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, endFrequency),
        now + duration
    );

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
        volume,
        now + 0.015
    );
    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + duration
    );

    oscillator.connect(gain);
    gain.connect(audioMaster);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
}

// Crystal collection sound
function playCollectSound() {
    playTone({
        frequency: 660,
        endFrequency: 990,
        duration: 0.12,
        type: 'sine',
        volume: 0.22
    });

    if (audioContext && !audioMuted) {
        setTimeout(() => {
            playTone({
                frequency: 990,
                endFrequency: 1320,
                duration: 0.12,
                type: 'sine',
                volume: 0.16
            });
        }, 70);
    }
}

// Collision sound
function playCollisionSound() {
    playTone({
        frequency: 150,
        endFrequency: 48,
        duration: 0.32,
        type: 'sawtooth',
        volume: 0.32
    });
}

// Game over sound
function playGameOverSound() {
    playTone({
        frequency: 330,
        endFrequency: 220,
        duration: 0.24,
        type: 'triangle',
        volume: 0.22
    });

    if (audioContext && !audioMuted) {
        setTimeout(() => {
            playTone({
                frequency: 220,
                endFrequency: 110,
                duration: 0.42,
                type: 'triangle',
                volume: 0.2
            });
        }, 210);
    }
}

function startGameAudio() {
    initializeAudio();
    if (!audioContext) return;

    audioContext.resume().catch(() => {});

    const now = audioContext.currentTime;

    if (musicGain) {
        musicGain.gain.setTargetAtTime(0.12, now, 0.7);
    }

    if (engineGain) {
        engineGain.gain.setTargetAtTime(0.035, now, 0.25);
    }

    if (engineOscillator) {
        engineOscillator.frequency.setTargetAtTime(
            keys['shift'] ? 65 : 48,
            now,
            0.15
        );
    }

    startMusicSequence();
}

function startMusicSequence() {
    if (musicTimer || !audioContext) return;

    // Synthesized futuristic music sequence
    const notes = [
        110, 164.81, 220, 164.81,
        130.81, 196, 261.63, 196
    ];

    musicTimer = setInterval(() => {
        if (
            !audioContext ||
            audioMuted ||
            isPaused ||
            !gameRunning ||
            gameOver
        ) {
            return;
        }

        const note = notes[musicStep % notes.length];

        playTone({
            frequency: note,
            endFrequency: note * 1.01,
            duration: 0.34,
            type: 'sine',
            volume: 0.035
        });

        musicStep++;
    }, 420);
}

function pauseGameAudio() {
    if (!audioContext) return;

    const now = audioContext.currentTime;

    if (musicGain) {
        musicGain.gain.setTargetAtTime(0, now, 0.15);
    }

    if (engineGain) {
        engineGain.gain.setTargetAtTime(0, now, 0.1);
    }
}

function resumeGameAudio() {
    if (!audioContext || audioMuted) return;

    audioContext.resume().catch(() => {});

    const now = audioContext.currentTime;

    if (musicGain) {
        musicGain.gain.setTargetAtTime(0.12, now, 0.4);
    }

    if (engineGain) {
        engineGain.gain.setTargetAtTime(0.035, now, 0.2);
    }

    startMusicSequence();
}

function stopGameAudio() {
    if (!audioContext) return;

    const now = audioContext.currentTime;

    if (musicGain) {
        musicGain.gain.setTargetAtTime(0, now, 0.15);
    }

    if (engineGain) {
        engineGain.gain.setTargetAtTime(0, now, 0.1);
    }
}

// Sound toggle button
const soundButton = document.createElement('button');

soundButton.id = 'sound-toggle';
soundButton.textContent = '🔊 Sound On';
soundButton.setAttribute('aria-label', 'Toggle sound');

soundButton.style.cssText = `
    position:fixed;
    top:114px;
    right:20px;
    z-index:26;
    display:block;
    padding:10px 16px;
    color:white;
    background:#15254add;
    border:1px solid #58aaff;
    border-radius:9px;
    font-size:14px;
    cursor:pointer;
`;

document.body.appendChild(soundButton);

soundButton.addEventListener('click', () => {
    audioMuted = !audioMuted;

    soundButton.textContent = audioMuted
        ? '🔇 Sound Off'
        : '🔊 Sound On';

    if (!audioContext && !audioMuted) {
        initializeAudio();
    }

    if (audioContext && audioMaster) {
        audioMaster.gain.setTargetAtTime(
            audioMuted ? 0 : 0.7,
            audioContext.currentTime,
            0.05
        );

        if (!audioMuted && gameRunning && !isPaused) {
            resumeGameAudio();
        }

        if (audioMuted) {
            pauseGameAudio();
        }
    }
});

// ==================== HIGH SCORE ====================
try {
    highScore = Number(
        localStorage.getItem('spaceDodgeHighScore')
    ) || 0;
} catch (error) {
    highScore = 0;
}

// ==================== MATERIALS ====================
const whiteMaterial = new THREE.MeshStandardMaterial({
    color: 0xeaf4ff,
    metalness: 0.6,
    roughness: 0.3
});

const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x202941,
    metalness: 0.7,
    roughness: 0.35
});

const redMaterial = new THREE.MeshStandardMaterial({
    color: 0xff334f,
    emissive: 0x99001c,
    emissiveIntensity: 0.8
});

const crystalMaterial = new THREE.MeshStandardMaterial({
    color: 0x4dffff,
    emissive: 0x00ccff,
    emissiveIntensity: 1.5
});

// ==================== STARS ====================
const starCount = 1800;
const starPositions = new Float32Array(starCount * 3);

for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 200;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 120;
    starPositions[i * 3 + 2] = -Math.random() * 200;
}

const starGeometry = new THREE.BufferGeometry();

starGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(starPositions, 3)
);

const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
        color: 0x9bbcff,
        size: 0.25
    })
);

scene.add(stars);

// ==================== PLANETS ====================
function createPlanet(x, y, z, radius, color) {
    const planet = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 24),
        new THREE.MeshStandardMaterial({
            color,
            roughness: 0.85
        })
    );

    planet.position.set(x, y, z);
    scene.add(planet);
}

createPlanet(-16, 7, -65, 7, 0x5835a8);
createPlanet(19, -5, -90, 9, 0x174e96);
createPlanet(12, 13, -120, 5, 0xa03f89);

// ==================== PORTAL ====================
const portal = new THREE.Group();

const portal1 = new THREE.Mesh(
    new THREE.TorusGeometry(4, 0.1, 12, 80),
    new THREE.MeshBasicMaterial({ color: 0x784dff })
);

const portal2 = new THREE.Mesh(
    new THREE.TorusGeometry(3.5, 0.06, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0x25dfff })
);

portal.add(portal1, portal2);
portal.position.set(0, 0, -70);
scene.add(portal);

// ==================== ROCKET ====================
const spaceship = new THREE.Group();
scene.add(spaceship);

const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.65, 2.4, 8),
    whiteMaterial
);

hull.rotation.x = -Math.PI / 2;
hull.position.z = -0.2;
spaceship.add(hull);

const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 20, 20),
    new THREE.MeshStandardMaterial({
        color: 0x20baff,
        emissive: 0x0066ff,
        emissiveIntensity: 1.2,
        metalness: 0.5
    })
);

cockpit.scale.set(0.8, 0.7, 1.2);
cockpit.position.set(0, 0.22, -0.25);
spaceship.add(cockpit);

function addWing(x) {
    const wing = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.12, 0.8),
        whiteMaterial
    );

    wing.position.set(x, -0.1, 0.35);
    spaceship.add(wing);

    const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.04, 0.12),
        redMaterial
    );

    stripe.position.set(x, -0.03, 0.35);
    spaceship.add(stripe);
}

addWing(-0.75);
addWing(0.75);

for (const x of [-0.3, 0.3]) {
    const engine = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.18, 0.45, 12),
        darkMaterial
    );

    engine.rotation.x = Math.PI / 2;
    engine.position.set(x, -0.18, 0.9);
    spaceship.add(engine);

    const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.7, 12),
        new THREE.MeshBasicMaterial({ color: 0x22aaff })
    );

    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, -0.18, 1.45);
    flame.name = 'engineFlame';
    spaceship.add(flame);
}

spaceship.position.set(0, 0, 3);

// ==================== OBSTACLES ====================
const obstacles = [];

function createObstacle(type) {
    const group = new THREE.Group();
    let object;

    if (type === 'rock') {
        object = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.8, 1),
            new THREE.MeshStandardMaterial({
                color: 0x69758d,
                flatShading: true,
                roughness: 0.9
            })
        );

        group.userData.hitRadius = 1.15;

    } else if (type === 'drone') {
        object = new THREE.Mesh(
            new THREE.BoxGeometry(1.3, 0.4, 0.7),
            darkMaterial
        );

        group.userData.hitRadius = 1.15;

        const eye = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 12, 12),
            redMaterial
        );

        eye.position.z = -0.4;
        group.add(eye);

    } else if (type === 'laser') {
        object = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.15, 0.15),
            new THREE.MeshBasicMaterial({ color: 0xff1744 })
        );

        group.userData.hitRadius = 1.4;

    } else if (type === 'crystal') {
        object = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.55),
            crystalMaterial
        );

        group.userData.hitRadius = 0.9;

    } else {
        object = new THREE.Mesh(
            new THREE.TorusGeometry(0.8, 0.16, 12, 28),
            new THREE.MeshStandardMaterial({
                color: 0xff7a22,
                emissive: 0x7a2000,
                emissiveIntensity: 0.8
            })
        );

        group.userData.hitRadius = 1.1;
    }

    group.add(object);
    group.userData.type = type;

    scene.add(group);
    obstacles.push(group);

    return group;
}

function respawnObstacle(object, z) {
    object.position.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 4,
        z ?? (-55 - Math.random() * 40)
    );

    object.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
}

const obstacleTypes = [
    'rock', 'rock', 'drone', 'laser', 'ring', 'crystal'
];

for (let i = 0; i < 12; i++) {
    const type = obstacleTypes[
        Math.floor(Math.random() * obstacleTypes.length)
    ];

    const obstacle = createObstacle(type);
    respawnObstacle(obstacle, -30 - i * 9);
}

// ==================== HEART PICKUPS ====================
const healthPickups = [];

const heartMaterial = new THREE.MeshStandardMaterial({
    color: 0xff1744,
    emissive: 0x99001c,
    emissiveIntensity: 1.2
});

function createHealthPickup() {
    const heart = new THREE.Group();

    const left = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 16, 16),
        heartMaterial
    );

    left.position.set(-0.18, 0.12, 0);
    heart.add(left);

    const right = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 16, 16),
        heartMaterial
    );

    right.position.set(0.18, 0.12, 0);
    heart.add(right);

    const bottom = new THREE.Mesh(
        new THREE.ConeGeometry(0.35, 0.55, 4),
        heartMaterial
    );

    bottom.position.y = -0.22;
    bottom.rotation.z = Math.PI;
    bottom.rotation.y = Math.PI / 4;
    heart.add(bottom);

    const glow = new THREE.Mesh(
        new THREE.TorusGeometry(0.58, 0.035, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xff1744 })
    );

    heart.add(glow);

    heart.userData.hitRadius = 1.1;
    scene.add(heart);
    healthPickups.push(heart);

    return heart;
}

function respawnHealth(heart, z) {
    heart.position.set(
        (Math.random() - 0.5) * 9,
        0,
        z ?? (-50 - Math.random() * 35)
    );
}

createHealthPickup();
createHealthPickup();

// ==================== HUD ====================
const hud = document.createElement('div');

hud.style.cssText = `
    position:fixed;
    top:18px;
    left:20px;
    z-index:10;
    color:white;
    font:bold 18px Arial,sans-serif;
    line-height:1.8;
    text-shadow:0 0 8px #168bff;
    pointer-events:none;
`;

hud.innerHTML = `
    <div>⭐ Score: <span id="score">0</span></div>
    <div>❤️ Lives: <span id="lives">3</span></div>
    <div>🏆 Best: <span id="best">${highScore}</span></div>
`;

document.body.appendChild(hud);

// ==================== GAME OVERLAY ====================
const overlay = document.createElement('div');

overlay.style.cssText = `
    position:fixed;
    inset:0;
    z-index:30;
    display:none;
    align-items:center;
    justify-content:center;
    flex-direction:column;
    gap:16px;
    background:rgba(2,5,25,0.9);
    color:white;
    font-family:Arial,sans-serif;
    text-align:center;
`;

overlay.innerHTML = `
    <h1 id="overlay-title" style="color:#55c9ff;font-size:44px">
        SPACE DODGE 3D
    </h1>

    <p id="overlay-message">Ready for your space mission?</p>

    <button id="overlay-button" style="
        padding:14px 32px;
        border:0;
        border-radius:10px;
        background:linear-gradient(90deg,#087bff,#8a45ff);
        color:white;
        font-size:18px;
        font-weight:bold;
        cursor:pointer;
    ">Start Game</button>
`;

document.body.appendChild(overlay);

const overlayTitle = document.getElementById('overlay-title');
const overlayMessage = document.getElementById('overlay-message');
const overlayButton = document.getElementById('overlay-button');

function showOverlay(title, message, buttonText) {
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    overlayButton.textContent = buttonText;
    overlay.style.display = 'flex';
}

function hideOverlay() {
    overlay.style.display = 'none';
}

// ==================== PAUSE BUTTON ====================
const pauseButton = document.createElement('button');

pauseButton.textContent = 'Ⅱ Pause';

pauseButton.style.cssText = `
    position:fixed;
    top:18px;
    right:20px;
    z-index:20;
    display:none;
    padding:11px 18px;
    color:white;
    background:#15254add;
    border:1px solid #58aaff;
    border-radius:9px;
    font-size:16px;
    cursor:pointer;
`;

document.body.appendChild(pauseButton);

// ==================== EXIT BUTTON ====================
const exitButton = document.createElement('button');

exitButton.textContent = '✕ Exit Game';

exitButton.style.cssText = `
    position:fixed;
    top:66px;
    right:20px;
    z-index:20;
    display:none;
    padding:11px 18px;
    color:white;
    background:#5b1830dd;
    border:1px solid #ff5577;
    border-radius:9px;
    font-size:16px;
    cursor:pointer;
`;

document.body.appendChild(exitButton);

// ==================== MOBILE CONTROLS ====================
const mobileControls = document.createElement('div');
mobileControls.id = 'mobile-controls';

mobileControls.innerHTML = `
    <div class="move-controls">
        <button id="move-left" class="touch-btn"
            aria-label="Move left">◀</button>

        <button id="move-right" class="touch-btn"
            aria-label="Move right">▶</button>
    </div>

    <button id="boost-btn" class="touch-btn"
        aria-label="Boost">🚀 BOOST</button>
`;

document.body.appendChild(mobileControls);

const moveLeftButton = document.getElementById('move-left');
const moveRightButton = document.getElementById('move-right');
const boostButton = document.getElementById('boost-btn');

function updateMobileControls() {
    mobileControls.style.display =
        gameRunning && !isPaused && !gameOver ? 'flex' : 'none';
}

function bindHoldControl(button, keyName) {
    const press = (event) => {
        event.preventDefault();
        keys[keyName] = true;
        button.classList.add('pressed');

        try {
            button.setPointerCapture(event.pointerId);
        } catch (error) {
            // Pointer capture is optional.
        }
    };

    const release = (event) => {
        if (event) event.preventDefault();

        keys[keyName] = false;
        button.classList.remove('pressed');
    };

    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);

    button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
}

bindHoldControl(moveLeftButton, 'arrowleft');
bindHoldControl(moveRightButton, 'arrowright');
bindHoldControl(boostButton, 'shift');

// ==================== UPDATE HUD ====================
function updateUI() {
    document.getElementById('score').textContent = score;
    document.getElementById('lives').textContent = lives;
    document.getElementById('best').textContent = highScore;
}

// ==================== START GAME ====================
function startGame() {
    score = 0;
    lives = 3;
    elapsed = 0;
    spawnTimer = 0;
    invulnerableTimer = 0;

    gameRunning = true;
    isPaused = false;
    gameOver = false;

    startGameAudio();

    const startScreen = document.getElementById('start-screen');

    if (startScreen) {
        startScreen.style.display = 'none';
    }

    spaceship.position.set(0, 0, 3);
    spaceship.rotation.set(0, 0, 0);
    spaceship.visible = true;

    obstacles.forEach((obstacle, i) => {
        respawnObstacle(obstacle, -30 - i * 9);
    });

    healthPickups.forEach((heart, i) => {
        respawnHealth(heart, -45 - i * 35);
    });

    updateUI();
    hideOverlay();

    pauseButton.style.display = 'block';
    pauseButton.textContent = 'Ⅱ Pause';
    exitButton.style.display = 'block';
    soundButton.style.display = 'block';

    updateMobileControls();
    clock.getDelta();
}

// ==================== PAUSE / RESUME ====================
function pauseGame() {
    if (!gameRunning || gameOver) return;

    isPaused = !isPaused;

    if (isPaused) {
        pauseGameAudio();
        pauseButton.textContent = '▶ Resume';

        for (const key in keys) {
            keys[key] = false;
        }

        updateMobileControls();

        showOverlay(
            'GAME PAUSED',
            'Take a short break!',
            'Resume Game'
        );
    } else {
        resumeGameAudio();
        pauseButton.textContent = 'Ⅱ Pause';
        hideOverlay();

        updateMobileControls();
        clock.getDelta();
    }
}

pauseButton.addEventListener('click', pauseGame);

// ==================== EXIT GAME ====================
function exitGame() {
    gameRunning = false;
    stopGameAudio();

    isPaused = false;
    gameOver = false;

    for (const key in keys) {
        keys[key] = false;
    }

    document.querySelectorAll('.touch-btn').forEach(button => {
        button.classList.remove('pressed');
    });

    pauseButton.style.display = 'none';
    exitButton.style.display = 'none';

    updateMobileControls();
    hideOverlay();

    const startScreen = document.getElementById('start-screen');

    if (startScreen) {
        startScreen.style.display = 'flex';
    } else {
        showOverlay(
            'SPACE DODGE 3D',
            'Collect crystals 💎 and hearts ❤️. Avoid obstacles!',
            'Start Game'
        );
    }

    clock.getDelta();
}

exitButton.addEventListener('click', exitGame);

// ==================== OVERLAY BUTTON ====================
overlayButton.addEventListener('click', () => {
    if (isPaused && !gameOver) {
        isPaused = false;
        resumeGameAudio();

        pauseButton.textContent = 'Ⅱ Pause';
        hideOverlay();

        updateMobileControls();
        clock.getDelta();
    } else {
        startGame();
    }
});

// ==================== KEYBOARD ====================
window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    keys[key] = true;

    if (key.startsWith('arrow') || key === ' ') {
        event.preventDefault();
    }

    if (key === 'p' && gameRunning) {
        pauseGame();
    }
});

window.addEventListener('keyup', (event) => {
    keys[event.key.toLowerCase()] = false;
});

window.addEventListener('blur', () => {
    for (const key in keys) {
        keys[key] = false;
    }

    document.querySelectorAll('.touch-btn').forEach(button => {
        button.classList.remove('pressed');
    });
});

// ==================== COLLISION ====================
function distanceBetween(a, b) {
    const dx = a.position.x - b.position.x;
    const dy = a.position.y - b.position.y;
    const dz = a.position.z - b.position.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function hitObstacle(obstacle) {
    if (invulnerableTimer > 0) return;

    if (obstacle.userData.type === 'crystal') {
        playCollectSound();

        score += 10;
        respawnObstacle(obstacle);
        updateUI();

        return;
    }

    playCollisionSound();

    lives--;
    invulnerableTimer = 1.4;

    respawnObstacle(obstacle);

    if (lives <= 0) {
        lives = 0;
        endGame();
    }

    updateUI();
}

// ==================== GAME OVER ====================
function endGame() {
    playGameOverSound();
    stopGameAudio();

    gameRunning = false;
    gameOver = true;
    isPaused = false;

    pauseButton.style.display = 'none';
    exitButton.style.display = 'none';

    updateMobileControls();

    if (score > highScore) {
        highScore = score;

        try {
            localStorage.setItem(
                'spaceDodgeHighScore',
                String(highScore)
            );
        } catch (error) {
            // Storage is optional.
        }
    }

    updateUI();

    showOverlay(
        'GAME OVER',
        `Final Score: ${score} | Best Score: ${highScore}`,
        'Play Again'
    );
}

// ==================== ANIMATION ====================
function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.04);

    if (gameRunning && !isPaused && !gameOver) {
        elapsed += delta;

        if (invulnerableTimer > 0) {
            invulnerableTimer -= delta;
        }

        // Rocket movement and boost
        const speed = (keys['shift'] ? 12 : 8) * delta;

        if (engineOscillator && audioContext && !audioMuted) {
            engineOscillator.frequency.setTargetAtTime(
                keys['shift'] ? 68 : 48,
                audioContext.currentTime,
                0.12
            );
        }

        if (keys['arrowleft'] || keys['a']) {
            spaceship.position.x -= speed;
        }

        if (keys['arrowright'] || keys['d']) {
            spaceship.position.x += speed;
        }

        if (keys['arrowup'] || keys['w']) {
            spaceship.position.y += speed;
        }

        if (keys['arrowdown'] || keys['s']) {
            spaceship.position.y -= speed;
        }

        spaceship.position.x = THREE.MathUtils.clamp(
            spaceship.position.x,
            -5.5,
            5.5
        );

        spaceship.position.y = THREE.MathUtils.clamp(
            spaceship.position.y,
            -2.5,
            3.5
        );

        // Rocket banking
        spaceship.rotation.z = THREE.MathUtils.lerp(
            spaceship.rotation.z,
            -spaceship.position.x * 0.07,
            0.12
        );

        // Engine flames
        spaceship.children.forEach((child) => {
            if (child.name === 'engineFlame') {
                child.scale.y = 0.7 + Math.random() * 0.6;
            }
        });

        // Space background movement
        stars.position.z += 8 * delta;

        if (stars.position.z > 30) {
            stars.position.z = 0;
        }

        portal.rotation.z += delta * 0.25;

        const obstacleSpeed = 8 + Math.min(score * 0.02, 7);

        // Obstacles and collision
        for (const obstacle of obstacles) {
            obstacle.position.z += obstacleSpeed * delta;
            obstacle.rotation.x += delta * 0.4;
            obstacle.rotation.y += delta * 0.6;

            if (obstacle.position.z > 7) {
                if (obstacle.userData.type !== 'crystal') {
                    score += 1;
                    updateUI();
                }

                respawnObstacle(obstacle);
            }

            if (
                obstacle.position.z > 0 &&
                obstacle.position.z < 6 &&
                distanceBetween(obstacle, spaceship) <
                    obstacle.userData.hitRadius
            ) {
                hitObstacle(obstacle);
            }

            if (gameOver) break;
        }

        // Hearts restore lives (maximum 3)
        for (const heart of healthPickups) {
            heart.position.z += obstacleSpeed * delta;
            heart.rotation.y += delta * 2;

            heart.position.y =
                Math.sin(elapsed * 3 + heart.position.x) * 0.25;

            if (
                heart.position.z > 0 &&
                heart.position.z < 6 &&
                distanceBetween(heart, spaceship) <
                    heart.userData.hitRadius &&
                lives < 3
            ) {
                lives++;
                respawnHealth(heart);
                updateUI();
            }

            if (heart.position.z > 7) {
                respawnHealth(heart);
            }
        }

        // Rocket flashes after damage
        spaceship.visible =
            invulnerableTimer <= 0 ||
            Math.floor(elapsed * 12) % 2 === 0;

        // Spawn new obstacles
        spawnTimer += delta;

        if (spawnTimer > 2.5) {
            spawnTimer = 0;

            const type = obstacleTypes[
                Math.floor(Math.random() * obstacleTypes.length)
            ];

            const obstacle = createObstacle(type);
            respawnObstacle(obstacle);
        }

        // Camera follows rocket
        camera.position.x = THREE.MathUtils.lerp(
            camera.position.x,
            spaceship.position.x * 0.2,
            0.05
        );

        camera.position.y = THREE.MathUtils.lerp(
            camera.position.y,
            4 + spaceship.position.y * 0.1,
            0.05
        );

        camera.lookAt(0, 0, -5);

        if (score > highScore) {
            highScore = score;
            document.getElementById('best').textContent = highScore;
        }
    }

    renderer.render(scene, camera);
}

// ==================== RESIZE ====================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, 2)
    );
});

// ==================== INITIAL HOME SCREEN ====================
const existingStartScreen = document.getElementById('start-screen');
const existingStartButton = document.getElementById('start-button');

if (existingStartScreen && existingStartButton) {
    overlay.style.display = 'none';

    existingStartButton.addEventListener('click', (event) => {
        event.preventDefault();
        startGame();
    });
} else {
    showOverlay(
        'SPACE DODGE 3D',
        'Collect crystals 💎 and hearts ❤️. Avoid obstacles!',
        'Start Game'
    );
}

updateMobileControls();
animate();
