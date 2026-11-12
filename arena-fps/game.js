// three provided as global THREE

const MAX_HP = 100;
const PLAYER_SPEED = 9;
const TURN_SPEED = 2.4;
const BULLET_SPEED = 42;
const FIRE_COOLDOWN = 0.32;
const AI_FIRE_COOLDOWN = 0.75;
const BULLET_DAMAGE = 12;
const PLAYER_RADIUS = 0.55;
const ARENA_HALF = 18;

const keys = new Set();
const startScreen = document.getElementById("start-screen");
const gameScreen = document.getElementById("game-screen");
const endScreen = document.getElementById("end-screen");
const canvas = document.getElementById("game-canvas");
const hpPlayerFill = document.getElementById("hp-player");
const hpEnemyFill = document.getElementById("hp-enemy");
const hpPlayerNum = document.getElementById("hp-player-num");
const hpEnemyNum = document.getElementById("hp-enemy-num");
const ammoLabel = document.getElementById("ammo-label");
const fireFlash = document.getElementById("fire-flash");
const hitVignette = document.getElementById("hit-vignette");
const endTitle = document.getElementById("end-title");
const endCopy = document.getElementById("end-copy");

let renderer, scene, camera, clock;
let player, enemy, walls = [], covers = [];
let bullets = [];
let state = "menu"; // menu | playing | ended
let playerHp = MAX_HP;
let enemyHp = MAX_HP;
let playerCooldown = 0;
let enemyCooldown = 0;
let muzzleTimer = 0;
let hitFlashTimer = 0;
let animId = 0;

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function setHud() {
  const p = clamp(playerHp / MAX_HP, 0, 1);
  const e = clamp(enemyHp / MAX_HP, 0, 1);
  hpPlayerFill.style.transform = `scaleX(${p})`;
  hpEnemyFill.style.transform = `scaleX(${e})`;
  hpPlayerNum.textContent = String(Math.max(0, Math.ceil(playerHp)));
  hpEnemyNum.textContent = String(Math.max(0, Math.ceil(enemyHp)));
  if (playerCooldown > 0.05) {
    ammoLabel.textContent = "COOLING";
  } else {
    ammoLabel.textContent = "READY";
  }
}

function makeMat(color, opts = {}) {
  // Lambert is friendlier on software WebGL than Standard + PBR.
  return new THREE.MeshLambertMaterial({
    color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

function addBox(w, h, d, x, y, z, mat, colliders) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  if (colliders) {
    colliders.push({
      mesh,
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      halfW: w / 2,
      halfD: d / 2,
      cx: x,
      cz: z,
    });
  }
  return mesh;
}

function buildArena() {
  walls = [];
  covers = [];

  const floorMat = makeMat(0x2a4038, { roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2.4, ARENA_HALF * 2.4), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.GridHelper(ARENA_HALF * 2.2, 22, 0x3d5a48, 0x243830);
  grid.position.y = 0.02;
  scene.add(grid);

  const wallMat = makeMat(0x3a5348, { roughness: 0.85 });
  const trimMat = makeMat(0xb8f24a, {
    roughness: 0.4,
    metalness: 0.35,
    emissive: 0xb8f24a,
    emissiveIntensity: 0.65,
  });
  const coverMat = makeMat(0x455e54, { roughness: 0.7 });
  const accentMat = makeMat(0xff6a3d, {
    roughness: 0.45,
    emissive: 0xff6a3d,
    emissiveIntensity: 0.7,
  });

  const t = 1.2;
  const h = 4.2;
  const L = ARENA_HALF * 2;
  addBox(L + t * 2, h, t, 0, h / 2, -ARENA_HALF, wallMat, walls);
  addBox(L + t * 2, h, t, 0, h / 2, ARENA_HALF, wallMat, walls);
  addBox(t, h, L, -ARENA_HALF, h / 2, 0, wallMat, walls);
  addBox(t, h, L, ARENA_HALF, h / 2, 0, wallMat, walls);

  // Corner pylons
  for (const [x, z] of [
    [-ARENA_HALF + 2.5, -ARENA_HALF + 2.5],
    [ARENA_HALF - 2.5, -ARENA_HALF + 2.5],
    [-ARENA_HALF + 2.5, ARENA_HALF - 2.5],
    [ARENA_HALF - 2.5, ARENA_HALF - 2.5],
  ]) {
    addBox(1.4, 5.2, 1.4, x, 2.6, z, trimMat, covers);
  }

  // Mid cover blocks — duel shape
  const mid = [
    [-6, 0, 3.2, 2.4, 2.6],
    [6, 0, 3.2, 2.4, 2.6],
    [0, -7, 4.5, 1.8, 2.2],
    [0, 7, 4.5, 1.8, 2.2],
    [-10, 5, 2.2, 2.2, 2.4],
    [10, -5, 2.2, 2.2, 2.4],
    [-4, 11, 2.8, 1.6, 2.0],
    [4, -11, 2.8, 1.6, 2.0],
  ];
  for (const [x, z, w, d, hh] of mid) {
    addBox(w, hh, d, x, hh / 2, z, coverMat, covers);
  }

  // Accent rails on long walls
  addBox(8, 0.25, 0.2, -8, 2.8, -ARENA_HALF + 0.55, accentMat, null);
  addBox(8, 0.25, 0.2, 8, 2.8, ARENA_HALF - 0.55, accentMat, null);

  // Ceiling light strips (visual only)
  const lightGeo = new THREE.BoxGeometry(10, 0.15, 0.4);
  for (const z of [-8, 0, 8]) {
    const strip = new THREE.Mesh(
      lightGeo,
      makeMat(0x7ee7d4, { emissive: 0x7ee7d4, emissiveIntensity: 0.9, roughness: 0.2 })
    );
    strip.position.set(0, 5.8, z);
    scene.add(strip);
  }
}

function createFighter(color, emissive) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.9, 6, 12),
    makeMat(color, { emissive, emissiveIntensity: 0.25, roughness: 0.55 })
  );
  body.position.y = 1.05;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    makeMat(0xe8f0ea, { roughness: 0.4 })
  );
  head.position.y = 1.85;
  group.add(head);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.12, 0.18),
    makeMat(emissive, { emissive, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.25 })
  );
  visor.position.set(0, 1.88, 0.22);
  group.add(visor);

  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.7),
    makeMat(0x1a1f1c, { metalness: 0.5, roughness: 0.35 })
  );
  gun.position.set(0.35, 1.15, 0.45);
  group.add(gun);

  group.userData.body = body;
  return group;
}

function resolveCircleObstacles(pos, radius, obstacles) {
  for (const o of obstacles) {
    const nearestX = clamp(pos.x, o.minX, o.maxX);
    const nearestZ = clamp(pos.z, o.minZ, o.maxZ);
    const dx = pos.x - nearestX;
    const dz = pos.z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      if (distSq < 1e-8) {
        // Push out along shortest axis
        const left = pos.x - o.minX;
        const right = o.maxX - pos.x;
        const top = pos.z - o.minZ;
        const bottom = o.maxZ - pos.z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = o.minX - radius;
        else if (m === right) pos.x = o.maxX + radius;
        else if (m === top) pos.z = o.minZ - radius;
        else pos.z = o.maxZ + radius;
      } else {
        const dist = Math.sqrt(distSq);
        const push = (radius - dist) / dist;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
  }
  const bound = ARENA_HALF - 0.9;
  pos.x = clamp(pos.x, -bound, bound);
  pos.z = clamp(pos.z, -bound, bound);
}

function allObstacles() {
  return walls.concat(covers);
}

function losClear(from, to) {
  tmpVec.copy(from);
  tmpVec.y = 1.4;
  tmpVec2.copy(to).sub(from);
  const dist = tmpVec2.length();
  if (dist < 0.01) return true;
  tmpVec2.normalize();
  raycaster.set(tmpVec, tmpVec2);
  raycaster.far = dist;
  const meshes = allObstacles().map((o) => o.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length === 0;
}

function spawnBullet(origin, dir, fromPlayer) {
  const geo = new THREE.SphereGeometry(0.12, 8, 8);
  const mat = makeMat(fromPlayer ? 0xb8f24a : 0xff6a3d, {
    emissive: fromPlayer ? 0xb8f24a : 0xff3d1f,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin);
  scene.add(mesh);
  bullets.push({
    mesh,
    vel: dir.clone().normalize().multiplyScalar(BULLET_SPEED),
    fromPlayer,
    life: 2.2,
  });
}

function firePlayer() {
  if (playerCooldown > 0 || state !== "playing") return;
  playerCooldown = FIRE_COOLDOWN;
  const origin = camera.position.clone();
  origin.y -= 0.15;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  origin.addScaledVector(dir, 0.8);
  spawnBullet(origin, dir, true);
  muzzleTimer = 0.12;
  fireFlash.classList.remove("on");
  void fireFlash.offsetWidth;
  fireFlash.classList.add("on");
}

function fireEnemy() {
  if (enemyCooldown > 0 || state !== "playing") return;
  const origin = enemy.position.clone();
  origin.y = 1.4;
  const target = player.position.clone();
  target.y = 1.4;
  // Slight aim noise
  target.x += (Math.random() - 0.5) * 0.55;
  target.z += (Math.random() - 0.5) * 0.55;
  const dir = target.sub(origin).normalize();
  origin.addScaledVector(dir, 0.9);
  spawnBullet(origin, dir, false);
  enemyCooldown = AI_FIRE_COOLDOWN;
}

function damagePlayer(amount) {
  playerHp = Math.max(0, playerHp - amount);
  hitFlashTimer = 0.25;
  hitVignette.classList.add("on");
  setHud();
  if (playerHp <= 0) endMatch(false);
}

function damageEnemy(amount) {
  enemyHp = Math.max(0, enemyHp - amount);
  setHud();
  if (enemyHp <= 0) endMatch(true);
}

function endMatch(won) {
  state = "ended";
  endScreen.classList.remove("hidden", "win", "lose");
  endScreen.classList.add(won ? "win" : "lose");
  endTitle.textContent = won ? "Victory" : "Defeated";
  endCopy.textContent = won
    ? "Rival down. The arena is yours."
    : "You dropped. Claim the rematch.";
}

function updateAI(dt) {
  const toPlayer = tmpVec.copy(player.position).sub(enemy.position);
  toPlayer.y = 0;
  const dist = toPlayer.length();
  const desired = toPlayer.clone();
  if (dist > 0.001) desired.normalize();

  // Strafe / circle when close, close distance when far, seek cover if hurt & exposed
  let move = new THREE.Vector3();
  const canSee = losClear(enemy.position, player.position);

  if (dist > 11) {
    move.copy(desired);
  } else if (dist < 5.5) {
    // back off + orbit
    const side = new THREE.Vector3(-desired.z, 0, desired.x);
    move.copy(desired).multiplyScalar(-0.55).addScaledVector(side, Math.sin(clock.elapsedTime * 1.4) > 0 ? 1 : -1);
  } else {
    const side = new THREE.Vector3(-desired.z, 0, desired.x);
    move.copy(desired).multiplyScalar(0.35).addScaledVector(side, Math.sin(clock.elapsedTime * 0.9));
  }

  if (enemyHp < 40 && canSee && dist < 14) {
    // duck behind nearest cover briefly
    let best = null;
    let bestScore = Infinity;
    for (const c of covers) {
      const dx = c.cx - enemy.position.x;
      const dz = c.cz - enemy.position.z;
      const d = Math.hypot(dx, dz);
      const awayFromPlayer =
        (c.cx - player.position.x) * desired.x + (c.cz - player.position.z) * desired.z;
      const score = d - awayFromPlayer * 2;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      move.set(best.cx - enemy.position.x, 0, best.cz - enemy.position.z);
      if (move.lengthSq() > 0.01) move.normalize();
    }
  }

  if (move.lengthSq() > 0.01) {
    move.normalize();
    const speed = 6.2;
    enemy.position.x += move.x * speed * dt;
    enemy.position.z += move.z * speed * dt;
    resolveCircleObstacles(enemy.position, PLAYER_RADIUS, allObstacles());
  }

  // Face player
  enemy.lookAt(player.position.x, enemy.position.y, player.position.z);

  if (canSee && dist < 16 && dist > 2.2) {
    enemyCooldown -= dt;
    if (enemyCooldown <= 0) fireEnemy();
  } else {
    enemyCooldown = Math.max(0, enemyCooldown - dt);
  }
}

function updatePlayer(dt) {
  let forward = 0;
  let turn = 0;
  let strafe = 0;

  if (keys.has("ArrowUp") || keys.has("KeyW")) forward += 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) forward -= 1;
  if (keys.has("ArrowLeft")) turn += 1;
  if (keys.has("ArrowRight")) turn -= 1;
  // Optional WASD: A/D strafe
  if (keys.has("KeyA")) strafe -= 1;
  if (keys.has("KeyD")) strafe += 1;

  player.rotation.y += turn * TURN_SPEED * dt;

  // Three.js yaw: look dir is (-sin(y), 0, -cos(y))
  const sin = Math.sin(player.rotation.y);
  const cos = Math.cos(player.rotation.y);
  const mx = (-forward * sin + strafe * cos) * PLAYER_SPEED * dt;
  const mz = (-forward * cos - strafe * sin) * PLAYER_SPEED * dt;
  player.position.x += mx;
  player.position.z += mz;
  resolveCircleObstacles(player.position, PLAYER_RADIUS, allObstacles());

  camera.position.set(player.position.x, 1.65, player.position.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = player.rotation.y;
  camera.rotation.x = 0;

  playerCooldown = Math.max(0, playerCooldown - dt);
  if (keys.has("Space")) firePlayer();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.mesh.position.addScaledVector(b.vel, dt);

    let dead = b.life <= 0;

    // Wall / cover hit
    for (const o of allObstacles()) {
      const p = b.mesh.position;
      if (p.x > o.minX && p.x < o.maxX && p.z > o.minZ && p.z < o.maxZ && p.y < 4.5) {
        dead = true;
        break;
      }
    }

    if (!dead && b.fromPlayer) {
      const dx = b.mesh.position.x - enemy.position.x;
      const dz = b.mesh.position.z - enemy.position.z;
      const dy = b.mesh.position.y - 1.2;
      if (dx * dx + dz * dz < 0.55 * 0.55 && Math.abs(dy) < 1.2) {
        damageEnemy(BULLET_DAMAGE);
        dead = true;
      }
    } else if (!dead && !b.fromPlayer) {
      const dx = b.mesh.position.x - player.position.x;
      const dz = b.mesh.position.z - player.position.z;
      const dy = b.mesh.position.y - 1.4;
      if (dx * dx + dz * dz < 0.5 * 0.5 && Math.abs(dy) < 1.1) {
        damagePlayer(BULLET_DAMAGE);
        dead = true;
      }
    }

    // Out of bounds
    if (
      Math.abs(b.mesh.position.x) > ARENA_HALF + 2 ||
      Math.abs(b.mesh.position.z) > ARENA_HALF + 2
    ) {
      dead = true;
    }

    if (dead) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      bullets.splice(i, 1);
    }
  }
}

function loop() {
  animId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());

  if (state === "playing") {
    updatePlayer(dt);
    updateAI(dt);
    updateBullets(dt);
    setHud();
  } else if (state === "ended") {
    updateBullets(dt);
  }

  if (muzzleTimer > 0) {
    muzzleTimer -= dt;
    if (muzzleTimer <= 0) fireFlash.classList.remove("on");
  }
  if (hitFlashTimer > 0) {
    hitFlashTimer -= dt;
    if (hitFlashTimer <= 0) hitVignette.classList.remove("on");
  }

  // Subtle enemy idle bob
  if (enemy) {
    enemy.children[0].position.y = 1.05 + Math.sin(clock.elapsedTime * 3) * 0.03;
  }

  renderer.render(scene, camera);
}

function clearBullets() {
  for (const b of bullets) {
    scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
  }
  bullets = [];
}

function resetMatch() {
  clearBullets();
  playerHp = MAX_HP;
  enemyHp = MAX_HP;
  playerCooldown = 0;
  enemyCooldown = 0.8;
  player.position.set(0, 0, 12);
  player.rotation.y = 0;
  enemy.position.set(2.5, 0, -8);
  enemy.rotation.y = 0;
  camera.position.set(player.position.x, 1.65, player.position.z);
  camera.rotation.order = "YXZ";
  camera.rotation.set(0, player.rotation.y, 0);
  setHud();
  hitVignette.classList.remove("on");
  fireFlash.classList.remove("on");
}

function initThree() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(gameScreen.clientWidth, gameScreen.clientHeight, false);
  // Shadows off: cloud VMs often use software WebGL where shadow maps stall.
  renderer.shadowMap.enabled = false;
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15241f);
  scene.fog = new THREE.FogExp2(0x1a2e28, 0.016);

  camera = new THREE.PerspectiveCamera(
    72,
    gameScreen.clientWidth / Math.max(1, gameScreen.clientHeight),
    0.1,
    120
  );

  clock = new THREE.Clock();

  scene.add(new THREE.AmbientLight(0x6a8a7a, 0.85));
  const hemi = new THREE.HemisphereLight(0xb8f0e0, 0x3a2818, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0dd, 1.6);
  key.position.set(8, 16, 6);
  scene.add(key);
  const fill = new THREE.PointLight(0xb8f24a, 1.2, 50);
  fill.position.set(-10, 5, -6);
  scene.add(fill);
  const fill2 = new THREE.PointLight(0xff6a3d, 1.0, 45);
  fill2.position.set(10, 4, 8);
  scene.add(fill2);
  const rim = new THREE.DirectionalLight(0x7ee7d4, 0.55);
  rim.position.set(-6, 8, -10);
  scene.add(rim);

  buildArena();

  player = new THREE.Object3D();
  // Face -Z toward the rival at the far end
  player.position.set(0, 0, 12);
  player.rotation.y = 0;
  scene.add(player);

  enemy = createFighter(0x4a5a54, 0xff6a3d);
  // Start closer so the rival is visible from spawn
  enemy.position.set(2.5, 0, -8);
  scene.add(enemy);

  camera.position.set(player.position.x, 1.65, player.position.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = player.rotation.y;
}

function resize() {
  if (!renderer || !camera) return;
  const w = gameScreen.clientWidth;
  const h = Math.max(1, gameScreen.clientHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function startGame() {
  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  if (!renderer) {
    initThree();
    window.addEventListener("resize", resize);
    loop();
  }
  resize();
  resetMatch();
  state = "playing";
  clock.getDelta();
}

function onKeyDown(e) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
    e.preventDefault();
  }
  keys.add(e.code);
  if (e.code === "Space" && state === "playing") firePlayer();
}

function onKeyUp(e) {
  keys.delete(e.code);
}

function restartMatch() {
  endScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  if (!renderer) {
    startGame();
    return;
  }
  resetMatch();
  state = "playing";
  clock.getDelta();
}

document.getElementById("btn-start").addEventListener("click", startGame);
document.getElementById("btn-restart").addEventListener("click", restartMatch);

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

// Expose for automated smoke checks + HTML bootstrap
window.__INSTANT_ARENA__ = {
  startGame,
  restart: restartMatch,
  getState: () => state,
  getHp: () => ({ player: playerHp, enemy: enemyHp }),
};

console.info("[INSTANT] arena module ready");
