/* Banania-AI — drives the ORIGINAL game.js. Auto-generated; do not edit by hand. */
(function(){
"use strict";
// Constants ported verbatim from the original Banania (game/game.js).

const LEV_DIMENSION_X = 21; // rows
const LEV_DIMENSION_Y = 13; // cols

// Directions. UP/DOWN change y, LEFT/RIGHT change x (matches dir_to_coords).
const DIR_NONE = -1;
const DIR_UP = 0;
const DIR_LEFT = 1;
const DIR_DOWN = 2;
const DIR_RIGHT = 3;
const DIRS = [DIR_UP, DIR_LEFT, DIR_DOWN, DIR_RIGHT];
const DIR_NAME = { [DIR_UP]: 'UP', [DIR_LEFT]: 'LEFT', [DIR_DOWN]: 'DOWN', [DIR_RIGHT]: 'RIGHT', [DIR_NONE]: 'NOOP' };

// Entity codes (from the const ENT_* block in game.js).
const ENT_DUMMY = -1;
const ENT_EMPTY = 0;
const ENT_PLAYER_BERTI = 1;
const ENT_AUTO_BERTI = 2;
const ENT_PINNED_BLOCK = 3;
const ENT_BANANA_PEEL = 4;
const ENT_LIGHT_BLOCK = 5; // can push other blocks ahead of it
const ENT_HEAVY_BLOCK = 6; // cannot chain-push; only moves if cell behind is free
const ENT_PURPLE_MONSTER = 7; // can push blocks
const ENT_GREEN_MONSTER = 10; // cannot push blocks
const ENT_KEY_1 = 13, ENT_KEY_2 = 14, ENT_KEY_3 = 15, ENT_KEY_4 = 16, ENT_KEY_5 = 17, ENT_KEY_6 = 18;
const ENT_DOOR_1 = 19, ENT_DOOR_2 = 20, ENT_DOOR_3 = 21, ENT_DOOR_4 = 22, ENT_DOOR_5 = 23, ENT_DOOR_6 = 24;

const KEYS = [ENT_KEY_1, ENT_KEY_2, ENT_KEY_3, ENT_KEY_4, ENT_KEY_5, ENT_KEY_6];
const DOORS = [ENT_DOOR_1, ENT_DOOR_2, ENT_DOOR_3, ENT_DOOR_4, ENT_DOOR_5, ENT_DOOR_6];
const KEY_TO_DOOR = { 13: 19, 14: 20, 15: 21, 16: 22, 17: 23, 18: 24 };

const MONSTERS = [ENT_PURPLE_MONSTER, ENT_GREEN_MONSTER];

function dirToDelta(dir) {
  switch (dir) {
    case DIR_UP: return { dx: 0, dy: -1 };
    case DIR_DOWN: return { dx: 0, dy: 1 };
    case DIR_LEFT: return { dx: -1, dy: 0 };
    case DIR_RIGHT: return { dx: 1, dy: 0 };
    default: return { dx: 0, dy: 0 };
  }
}

function oppositeDir(dir) {
  switch (dir) {
    case DIR_UP: return DIR_DOWN;
    case DIR_DOWN: return DIR_UP;
    case DIR_LEFT: return DIR_RIGHT;
    case DIR_RIGHT: return DIR_LEFT;
    default: return DIR_NONE;
  }
}

const C = {
  LEV_DIMENSION_X, LEV_DIMENSION_Y,
  DIR_NONE, DIR_UP, DIR_LEFT, DIR_DOWN, DIR_RIGHT, DIRS, DIR_NAME,
  ENT_DUMMY, ENT_EMPTY, ENT_PLAYER_BERTI, ENT_AUTO_BERTI, ENT_PINNED_BLOCK,
  ENT_BANANA_PEEL, ENT_LIGHT_BLOCK, ENT_HEAVY_BLOCK, ENT_PURPLE_MONSTER, ENT_GREEN_MONSTER,
  ENT_KEY_1, ENT_KEY_2, ENT_KEY_3, ENT_KEY_4, ENT_KEY_5, ENT_KEY_6,
  ENT_DOOR_1, ENT_DOOR_2, ENT_DOOR_3, ENT_DOOR_4, ENT_DOOR_5, ENT_DOOR_6,
  KEYS, DOORS, KEY_TO_DOOR, MONSTERS,
  dirToDelta, oppositeDir,
};

let LEVELS = null;
// BananiaEnv: a headless, turn-based reimplementation of the Banania rules,
// ported from the original game.js (walkable / start_move / move / chase_berti /
// move_randomly / check_enemy_proximity). Designed to run millions of steps for
// search, planning and RL — no rendering, no animation tweening.
//
// One env "step" = Berti takes one action, then every monster takes one action,
// then enemy-proximity (death) is checked. This discretizes the original's
// frame-tweened continuous movement while preserving the decision logic.


// ---- Seedable RNG (mulberry32) so experiments are reproducible ----
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NX = C.LEV_DIMENSION_X, NY = C.LEV_DIMENSION_Y;
const idx = (x, y) => x * NY + y;

class BananiaEnv {
  constructor(levelNumber = 1, opts = {}) {
    this.levelNumber = levelNumber;
    this.maxSteps = opts.maxSteps || 600;
    this.freezeMonsters = !!opts.freezeMonsters; // for deterministic puzzle solving
    this.seed = opts.seed != null ? opts.seed : 12345;
    this.rng = makeRng(this.seed);
    this.reset();
  }

  reset() {
    this.rng = makeRng(this.seed);
    const lvl = LEVELS[this.levelNumber];
    this.grid = new Int8Array(NX * NY);
    this.faceDir = new Int8Array(NX * NY).fill(C.DIR_DOWN);
    this.bananas = 0;
    this.steps = 0;
    this.done = false;
    this.won = false;
    this.dead = false;
    this.berti = null;
    for (let x = 0; x < NX; x++) {
      for (let y = 0; y < NY; y++) {
        const v = lvl[x][y];
        this.grid[idx(x, y)] = v;
        if (v === C.ENT_BANANA_PEEL) this.bananas++;
        else if (v === C.ENT_PLAYER_BERTI) this.berti = { x, y };
      }
    }
    this.monsters = this._collectMonsters();
    return this.getObs();
  }

  _collectMonsters() {
    const out = [];
    for (let x = 0; x < NX; x++)
      for (let y = 0; y < NY; y++) {
        const v = this.grid[idx(x, y)];
        if (v === C.ENT_PURPLE_MONSTER || v === C.ENT_GREEN_MONSTER) {
          out.push({ x, y, id: v, seesBerti: false });
        }
      }
    return out;
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < NX && y < NY; }
  at(x, y) { return this.grid[idx(x, y)]; }
  set(x, y, v) { this.grid[idx(x, y)] = v; }

  static isPushable(id) { return id === C.ENT_LIGHT_BLOCK || id === C.ENT_HEAVY_BLOCK; }
  static canPush(id) {
    return id === C.ENT_PLAYER_BERTI || id === C.ENT_AUTO_BERTI ||
           id === C.ENT_LIGHT_BLOCK || id === C.ENT_PURPLE_MONSTER;
  }
  static isConsumable(id) {
    return id === C.ENT_BANANA_PEEL || (id >= C.ENT_KEY_1 && id <= C.ENT_KEY_6);
  }

  // Port of walkable(): can the entity at (x,y) move one tile in `dir`?
  walkable(x, y, dir) {
    const { dx, dy } = C.dirToDelta(dir);
    const nx = x + dx, ny = y + dy;
    if (!this.inBounds(nx, ny)) return false;
    const here = this.at(x, y);
    const there = this.at(nx, ny);
    if (there === C.ENT_EMPTY) return true;
    if ((here === C.ENT_PLAYER_BERTI || here === C.ENT_AUTO_BERTI) && BananiaEnv.isConsumable(there)) {
      return true; // Berti can pick items up
    }
    if (BananiaEnv.canPush(here) && BananiaEnv.isPushable(there)) {
      return this.walkable(nx, ny, dir); // push chain — recurse from the block
    }
    return false;
  }

  // Atomically apply a move of the entity at (x,y) in `dir`, resolving pushes
  // and consumption. Assumes walkable() already returned true.
  // Returns the new (x,y) of the moved entity.
  _applyMove(x, y, dir) {
    const { dx, dy } = C.dirToDelta(dir);
    const nx = x + dx, ny = y + dy;
    const here = this.at(x, y);
    const there = this.at(nx, ny);

    if ((here === C.ENT_PLAYER_BERTI || here === C.ENT_AUTO_BERTI) && BananiaEnv.isConsumable(there)) {
      if (there === C.ENT_BANANA_PEEL) {
        this.bananas--;
        if (this.bananas <= 0) { this.won = true; this.done = true; }
      } else if (there >= C.ENT_KEY_1 && there <= C.ENT_KEY_6) {
        this._removeDoor(C.KEY_TO_DOOR[there]);
      }
      // item consumed; tile will be overwritten by the swap below
    } else if (there !== C.ENT_EMPTY) {
      // push the block (chain) ahead first
      this._applyMove(nx, ny, dir);
    }
    // swap: move entity forward, vacate source
    this.set(nx, ny, here);
    this.faceDir[idx(nx, ny)] = dir;
    this.set(x, y, C.ENT_EMPTY);
    return { x: nx, y: ny };
  }

  _removeDoor(doorId) {
    for (let x = 0; x < NX; x++)
      for (let y = 0; y < NY; y++)
        if (this.at(x, y) === doorId) this.set(x, y, C.ENT_EMPTY);
  }

  // --- line of sight (port of can_see_tile, simplified to monster sight) ---
  canSeeTile(ex, ey, tx, ty) {
    let cx = ex, cy = ey;
    while (cx !== tx || cy !== ty) {
      const ddx = Math.sign(tx - cx), ddy = Math.sign(ty - cy);
      // step along the dominant axis (matches the original's bias well enough)
      if (Math.abs(tx - cx) >= Math.abs(ty - cy)) cx += ddx; else cy += ddy;
      if (cx === tx && cy === ty) break;
      const v = this.at(cx, cy);
      const transparent = v === C.ENT_EMPTY || v === C.ENT_BANANA_PEEL ||
        (v >= C.ENT_KEY_1 && v <= C.ENT_KEY_6) ||
        v === C.ENT_PLAYER_BERTI || v === C.ENT_PURPLE_MONSTER || v === C.ENT_GREEN_MONSTER;
      if (!transparent) return false;
    }
    return true;
  }

  _moveRandomly(m) {
    const back = C.oppositeDir(this.faceDir[idx(m.x, m.y)]);
    const face = this.faceDir[idx(m.x, m.y)];
    let pool = C.DIRS.filter(d => d !== face && d !== back);
    if (this.rng() < 0.8 && this.walkable(m.x, m.y, face)) return this._stepMonster(m, face);
    // shuffle pool
    while (pool.length) {
      const k = Math.floor(this.rng() * pool.length);
      const d = pool[k];
      if (this.walkable(m.x, m.y, d)) return this._stepMonster(m, d);
      pool.splice(k, 1);
    }
    if (this.walkable(m.x, m.y, face)) return this._stepMonster(m, face);
    if (this.walkable(m.x, m.y, back)) return this._stepMonster(m, back);
    // stuck: do nothing
  }

  _chaseBerti(m) {
    const face = this.faceDir[idx(m.x, m.y)];
    const b = this.berti;
    const faceRight =
      (face === C.DIR_DOWN && b.y >= m.y) || (face === C.DIR_UP && b.y <= m.y) ||
      (face === C.DIR_LEFT && b.x <= m.x) || (face === C.DIR_RIGHT && b.x >= m.x);
    const sees = faceRight && this.canSeeTile(m.x, m.y, b.x, b.y);

    if (!sees || this.rng() < 0.02) { m.seesBerti = false; return this._moveRandomly(m); }
    m.seesBerti = true;

    const diffX = b.x - m.x, diffY = b.y - m.y;
    let dir1, dir2;
    if (diffX === 0) { dir1 = dir2 = diffY > 0 ? C.DIR_DOWN : C.DIR_UP; }
    else if (diffX > 0) {
      if (diffY === 0) dir1 = dir2 = C.DIR_RIGHT;
      else if (diffY > 0) { dir1 = C.DIR_RIGHT; dir2 = C.DIR_DOWN; }
      else { dir1 = C.DIR_RIGHT; dir2 = C.DIR_UP; }
    } else {
      if (diffY === 0) dir1 = dir2 = C.DIR_LEFT;
      else if (diffY > 0) { dir1 = C.DIR_LEFT; dir2 = C.DIR_DOWN; }
      else { dir1 = C.DIR_LEFT; dir2 = C.DIR_UP; }
    }
    // pick primary axis probabilistically by how far each axis is
    let primary = dir1, secondary = dir2;
    if (dir1 !== dir2) {
      const total = Math.abs(diffX) + Math.abs(diffY);
      const pX = Math.abs(diffX) / total;
      if (this.rng() < pX) { primary = (Math.abs(diffX) >= 1) ? (diffX > 0 ? C.DIR_RIGHT : C.DIR_LEFT) : dir1; secondary = (diffY > 0 ? C.DIR_DOWN : C.DIR_UP); }
      else { primary = (diffY > 0 ? C.DIR_DOWN : C.DIR_UP); secondary = (diffX > 0 ? C.DIR_RIGHT : C.DIR_LEFT); }
    }
    if (this.walkable(m.x, m.y, primary)) return this._stepMonster(m, primary);
    if (this.walkable(m.x, m.y, secondary)) return this._stepMonster(m, secondary);
    return this._moveRandomly(m);
  }

  _stepMonster(m, dir) {
    const np = this._applyMove(m.x, m.y, dir);
    m.x = np.x; m.y = np.y;
  }

  // diagonal-aware adjacency death check (port of check_enemy_proximity)
  _bertiCaught() {
    const { x, y } = this.berti;
    for (let ix = -1; ix <= 1; ix++)
      for (let iy = -1; iy <= 1; iy++) {
        if (ix === 0 && iy === 0) continue;
        const ax = x + ix, ay = y + iy;
        if (!this.inBounds(ax, ay)) continue;
        const v = this.at(ax, ay);
        if (v !== C.ENT_PURPLE_MONSTER && v !== C.ENT_GREEN_MONSTER) continue;
        if (Math.abs(ix) === 1 && Math.abs(iy) === 1) {
          // diagonal: blocked if an obstacle sits on either orthogonal corner
          const a = this.at(ax, y), b = this.at(x, ay);
          const block = (id) => id !== C.ENT_DUMMY && id !== C.ENT_EMPTY;
          if (block(a) || block(b)) continue;
        }
        return true;
      }
    return false;
  }

  legalActions() {
    const acts = [];
    for (const d of C.DIRS) if (this.walkable(this.berti.x, this.berti.y, d)) acts.push(d);
    acts.push(C.DIR_NONE); // waiting is allowed
    return acts;
  }

  // Core transition. action ∈ {DIR_*, DIR_NONE}. Returns {obs,reward,done,info}.
  step(action) {
    if (this.done) return { obs: this.getObs(), reward: 0, done: true, info: { already: true } };
    const bananasBefore = this.bananas;
    const distBefore = this._nearestSubgoalDist();
    // count keys and doors before the step to detect collection / door removal
    let keysBefore = 0, doorsBefore = 0;
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NY; j++) {
        const v = this.at(i, j);
        if (v >= C.ENT_KEY_1 && v <= C.ENT_KEY_6) keysBefore++;
        if (v >= C.ENT_DOOR_1 && v <= C.ENT_DOOR_6) doorsBefore++;
      }

    let moved = false;
    if (action !== C.DIR_NONE && this.walkable(this.berti.x, this.berti.y, action)) {
      const np = this._applyMove(this.berti.x, this.berti.y, action);
      this.berti = { x: np.x, y: np.y };
      this.steps++;
      moved = true;
    }

    let reward = -0.05; // step penalty -> efficiency pressure
    const ate = bananasBefore - this.bananas;
    if (ate > 0) reward += 10 * ate;

    // reward key collection (each key collected = a door opened = progress)
    let keysAfter = 0, doorsAfter = 0;
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NY; j++) {
        const v = this.at(i, j);
        if (v >= C.ENT_KEY_1 && v <= C.ENT_KEY_6) keysAfter++;
        if (v >= C.ENT_DOOR_1 && v <= C.ENT_DOOR_6) doorsAfter++;
      }
    const keysCollected = keysBefore - keysAfter;
    const doorsOpened = doorsBefore - doorsAfter;
    if (keysCollected > 0) reward += 8 * keysCollected;   // key collected
    if (doorsOpened > keysCollected) reward += 5 * (doorsOpened - keysCollected); // extra doors removed

    if (this.won) {
      reward += 100;
      return { obs: this.getObs(), reward, done: true, info: { won: true, steps: this.steps } };
    }

    // monsters act
    if (!this.freezeMonsters) {
      for (const m of this.monsters) {
        if (this._bertiCaught()) break;
        this._chaseBerti(m);
      }
    }

    if (this._bertiCaught()) {
      this.dead = true; this.done = true;
      reward -= 100;
      return { obs: this.getObs(), reward, done: true, info: { dead: true, steps: this.steps } };
    }

    // optional shaping: reward getting closer to nearest subgoal (key-with-door > banana)
    const distAfter = this._nearestSubgoalDist();
    if (distBefore != null && distAfter != null) reward += 0.1 * (distBefore - distAfter);

    if (this.steps >= this.maxSteps) {
      this.done = true;
      return { obs: this.getObs(), reward, done: true, info: { timeout: true, steps: this.steps } };
    }
    return { obs: this.getObs(), reward, done: false, info: { moved } };
  }

  _nearestBananaDist() {
    let best = null;
    const { x, y } = this.berti;
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NY; j++)
        if (this.at(i, j) === C.ENT_BANANA_PEEL) {
          const d = Math.abs(i - x) + Math.abs(j - y);
          if (best == null || d < best) best = d;
        }
    return best;
  }

  // Like _nearestBananaDist but prefers keys whose door still exists —
  // those are mandatory detours, so shaping toward them reduces plan length.
  _nearestSubgoalDist() {
    const { x, y } = this.berti;
    let best = null;
    // Check keys with active doors first (mandatory sub-goals)
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NY; j++) {
        const v = this.at(i, j);
        if (v >= C.ENT_KEY_1 && v <= C.ENT_KEY_6) {
          const door = C.KEY_TO_DOOR[v];
          let doorExists = false;
          for (let di = 0; di < NX && !doorExists; di++)
            for (let dj = 0; dj < NY && !doorExists; dj++)
              if (this.at(di, dj) === door) doorExists = true;
          if (doorExists) {
            const d = Math.abs(i - x) + Math.abs(j - y);
            if (best == null || d < best) best = d;
          }
        }
      }
    // If no key sub-goals, fall back to nearest banana
    if (best == null) return this._nearestBananaDist();
    return best;
  }

  // Compact serialization for search / hashing (Berti + blocks + bananas + monsters).
  // Browser-safe: uses Uint8Array + String.fromCharCode instead of Node.js Buffer.
  hash() {
    // grid is Int8Array — reinterpret as Uint8Array for safe charCode conversion
    const bytes = new Uint8Array(this.grid.buffer, this.grid.byteOffset, this.grid.byteLength);
    // fromCharCode in chunks avoids stack overflow on large arrays
    let s = '';
    for (let i = 0; i < bytes.length; i += 4096)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    return s;
  }

  clone() {
    const e = Object.create(BananiaEnv.prototype);
    e.levelNumber = this.levelNumber;
    e.maxSteps = this.maxSteps;
    e.freezeMonsters = this.freezeMonsters;
    e.seed = this.seed;
    e.grid = this.grid.slice();
    e.faceDir = this.faceDir.slice();
    e.bananas = this.bananas;
    e.steps = this.steps;
    e.done = this.done; e.won = this.won; e.dead = this.dead;
    e.berti = { x: this.berti.x, y: this.berti.y };
    e.monsters = this.monsters.map(m => ({ ...m }));
    // independent RNG stream for branching rollouts
    e.rng = makeRng((Math.floor(this.rng() * 1e9)) ^ 0x9e3779b9);
    return e;
  }

  getObs() {
    return {
      grid: this.grid, berti: this.berti, bananas: this.bananas,
      steps: this.steps, done: this.done, won: this.won, dead: this.dead,
      monsters: this.monsters.map(m => ({ x: m.x, y: m.y, id: m.id })),
    };
  }

  render() {
    const ch = {
      [-1]: '·', 0: ' ', 1: '@', 3: '#', 4: 'b', 5: '+', 6: '=',
      7: 'P', 10: 'G', 13: 'k', 14: 'k', 15: 'k', 16: 'k', 17: 'k', 18: 'k',
      19: 'D', 20: 'D', 21: 'D', 22: 'D', 23: 'D', 24: 'D',
    };
    let s = '';
    for (let y = 0; y < NY; y++) {
      let row = '';
      for (let x = 0; x < NX; x++) row += (ch[this.at(x, y)] || '?');
      s += row + '\n';
    }
    return s;
  }
}

// Search agent: A* (and BFS) over the deterministic game state.
// Best suited to the Sokoban-style puzzle aspect: pushing blocks, collecting all
// bananas, opening doors. Monsters are treated as static obstacles (freezeMonsters),
// and the death check still forbids stepping adjacent to them — so the plan is safe
// against stationary monsters but does NOT model their motion (that's MCTS's job).


class MinHeap {
  constructor() { this.a = []; }
  size() { return this.a.length; }
  push(item) { const a = this.a; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break;[a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; const n = a.length;
      while (true) { let l = 2 * i + 1, r = 2 * i + 2, s = i;
        if (l < n && a[l].f < a[s].f) s = l; if (r < n && a[r].f < a[s].f) s = r;
        if (s === i) break;[a[s], a[i]] = [a[i], a[s]]; i = s; } }
    return top; }
}

function nearestBananaLowerBound(env) {
  // Improved heuristic: account for keys that must be collected before doors open.
  // 1) For each uncollected key whose door blocks path to a banana, add key detour cost.
  // 2) dist to nearest banana + (remaining bananas - 1) as tour lower bound.
  const { x, y } = env.berti;
  let bananaCount = 0, bestBananaDist = Infinity;
  let keyBonus = 0;

  // Find all keys still on the grid — each key is a mandatory detour if its door exists
  for (let i = 0; i < C.LEV_DIMENSION_X; i++) {
    for (let j = 0; j < C.LEV_DIMENSION_Y; j++) {
      const v = env.at(i, j);
      if (v === C.ENT_BANANA_PEEL) {
        bananaCount++;
        const d = Math.abs(i - x) + Math.abs(j - y);
        if (d < bestBananaDist) bestBananaDist = d;
      }
      // If this is a key AND its corresponding door still exists on the map,
      // Berti MUST visit the key — add a small penalty to guide the search toward it
      if (v >= C.ENT_KEY_1 && v <= C.ENT_KEY_6) {
        const door = C.KEY_TO_DOOR[v];
        let doorExists = false;
        for (let di = 0; di < C.LEV_DIMENSION_X && !doorExists; di++)
          for (let dj = 0; dj < C.LEV_DIMENSION_Y && !doorExists; dj++)
            if (env.at(di, dj) === door) doorExists = true;
        if (doorExists) {
          // cost to detour: dist(berti→key) + 1 (but don't double-count if key is closer than banana)
          const kd = Math.abs(i - x) + Math.abs(j - y);
          keyBonus += Math.max(0, kd - bestBananaDist + 1);
        }
      }
    }
  }
  if (bananaCount === 0) return 0;
  return bestBananaDist + (bananaCount - 1) + keyBonus;
}

// algo: 'astar' | 'bfs'
function solve(levelNumber, opts = {}) {
  const { freezeMonsters = true, maxSteps = 10000 } = opts;
  const root = new BananiaEnv(levelNumber, { freezeMonsters, maxSteps });
  return solveFromEnv(root, opts);
}

// Plan from an arbitrary starting env (used by the hybrid agent for replanning).
function solveFromEnv(startEnv, { algo = 'astar', maxExpansions = 400000 } = {}) {
  const root = startEnv.clone();
  root.freezeMonsters = true;
  root.done = false; root.won = false; root.dead = false; // re-arm for planning
  const startHash = root.hash();
  const open = new MinHeap();
  const gScore = new Map();
  const cameFrom = new Map(); // hash -> { prev, action }
  gScore.set(startHash, 0);
  open.push({ f: nearestBananaLowerBound(root), g: 0, env: root, hash: startHash });

  let expansions = 0;
  const t0 = Date.now();

  while (open.size()) {
    const cur = open.pop();
    if (cur.g > (gScore.get(cur.hash) ?? Infinity)) continue; // stale
    const env = cur.env;
    if (env.won) {
      // reconstruct
      const actions = [];
      let h = cur.hash;
      while (cameFrom.has(h)) { const c = cameFrom.get(h); actions.push(c.action); h = c.prev; }
      actions.reverse();
      return {
        solved: true, actions, steps: actions.length, expansions,
        ms: Date.now() - t0, algo,
      };
    }
    if (++expansions > maxExpansions) break;

    for (const a of C.DIRS) {
      if (!env.walkable(env.berti.x, env.berti.y, a)) continue;
      const child = env.clone();
      child.freezeMonsters = true;
      const res = child.step(a);
      if (child.dead) continue; // stepping adjacent to a (frozen) monster = death, prune
      const ng = cur.g + 1;
      const hh = child.hash();
      if (ng < (gScore.get(hh) ?? Infinity)) {
        gScore.set(hh, ng);
        cameFrom.set(hh, { prev: cur.hash, action: a });
        const h = algo === 'bfs' ? 0 : nearestBananaLowerBound(child);
        open.push({ f: ng + h, g: ng, env: child, hash: hh });
      }
    }
  }
  return { solved: false, actions: [], steps: 0, expansions, ms: Date.now() - t0, algo };
}

const MCTSAgent = (function(){
// Monte Carlo Tree Search as an online (closed-loop) planner.
// At each real step we build a fresh search tree from the current state, run N
// iterations of select/expand/simulate/backprop using cloned environments (with
// independent RNG so monster stochasticity is sampled), then play the most-visited
// action and re-plan. This handles the stochastic monster dynamics that defeat
// frozen-monster A*, via sampled lookahead.


const ACTIONS = [C.DIR_UP, C.DIR_LEFT, C.DIR_DOWN, C.DIR_RIGHT];

function nearestBanana(env) {
  let best = Infinity, bx = 0, by = 0;
  const { x, y } = env.berti;
  for (let i = 0; i < C.LEV_DIMENSION_X; i++)
    for (let j = 0; j < C.LEV_DIMENSION_Y; j++)
      if (env.at(i, j) === C.ENT_BANANA_PEEL) {
        const d = Math.abs(i - x) + Math.abs(j - y);
        if (d < best) { best = d; bx = i; by = j; }
      }
  return best === Infinity ? null : { x: bx, y: by, d: best };
}

// Rollout policy: head toward nearest KEY (if door exists) or banana,
// flee monsters only when immediately adjacent.
function rolloutAction(env) {
  const b = env.berti;
  const legal = ACTIONS.filter(a => env.walkable(b.x, b.y, a));
  if (!legal.length) return C.DIR_NONE;
  // nearest monster
  let bestM = Infinity, mx = 0, my = 0;
  for (const m of env.monsters) {
    const d = Math.abs(m.x - b.x) + Math.abs(m.y - b.y);
    if (d < bestM) { bestM = d; mx = m.x; my = m.y; }
  }
  if (bestM <= 1) {
    let best = legal[0], bv = -Infinity;
    for (const a of legal) {
      const { dx, dy } = C.dirToDelta(a);
      const d = Math.abs((b.x + dx) - mx) + Math.abs((b.y + dy) - my);
      if (d > bv) { bv = d; best = a; }
    }
    return best;
  }
  // Priority target: nearest key whose door still exists, else nearest banana
  let tgt = null, tgtDist = Infinity;
  for (let i = 0; i < C.LEV_DIMENSION_X; i++)
    for (let j = 0; j < C.LEV_DIMENSION_Y; j++) {
      const v = env.at(i, j);
      if (v >= C.ENT_KEY_1 && v <= C.ENT_KEY_6) {
        const door = C.KEY_TO_DOOR[v];
        let doorExists = false;
        for (let di = 0; di < C.LEV_DIMENSION_X && !doorExists; di++)
          for (let dj = 0; dj < C.LEV_DIMENSION_Y && !doorExists; dj++)
            if (env.at(di, dj) === door) doorExists = true;
        if (doorExists) {
          const d = Math.abs(i - b.x) + Math.abs(j - b.y);
          if (d < tgtDist) { tgtDist = d; tgt = { x: i, y: j }; }
        }
      }
    }
  if (!tgt) tgt = nearestBanana(env);
  if (!tgt) return legal[Math.floor(Math.random() * legal.length)];
  // greedy toward target with some noise
  if (Math.random() < 0.2) return legal[Math.floor(Math.random() * legal.length)];
  let best = legal[0], bv = -Infinity;
  for (const a of legal) {
    const { dx, dy } = C.dirToDelta(a);
    const d = -(Math.abs((b.x + dx) - tgt.x) + Math.abs((b.y + dy) - tgt.y));
    if (d > bv) { bv = d; best = a; }
  }
  return best;
}

class MCTSNode {
  constructor(env, parentAction = null) {
    this.untried = env.legalActions().filter(a => a !== C.DIR_NONE);
    if (!this.untried.length) this.untried = [C.DIR_NONE];
    this.children = new Map(); // action -> { node, N, W }
    this.N = 0;
  }
}

class MCTSAgent {
  constructor({ iterations = 400, rolloutDepth = 40, gamma = 0.98, c = 1.4 } = {}) {
    this.iterations = iterations; this.rolloutDepth = rolloutDepth;
    this.gamma = gamma; this.c = c;
  }

  _rollout(env) {
    let total = 0, discount = 1;
    for (let d = 0; d < this.rolloutDepth && !env.done; d++) {
      const a = rolloutAction(env);
      const { reward } = env.step(a);
      total += discount * reward;
      discount *= this.gamma;
      if (env.won) { break; }
    }
    return total;
  }

  // one MCTS iteration from a cloned root state
  _iterate(rootEnv, root) {
    const path = [];
    let env = rootEnv.clone();
    let node = root;
    // ---- selection ----
    while (node.untried.length === 0 && !env.done) {
      let bestA = null, bestU = -Infinity;
      for (const [a, ch] of node.children) {
        const q = ch.W / ch.N;
        const u = q + this.c * Math.sqrt(Math.log(node.N + 1) / ch.N);
        if (u > bestU) { bestU = u; bestA = a; }
      }
      if (bestA === null) break;
      const { reward } = env.step(bestA);
      path.push({ node, a: bestA, reward });
      node = node.children.get(bestA).node;
    }
    // ---- expansion ----
    let rolloutReturn = 0;
    if (!env.done && node.untried.length) {
      const a = node.untried.splice(Math.floor(Math.random() * node.untried.length), 1)[0];
      const { reward } = env.step(a);
      const child = new MCTSNode(env, a);
      node.children.set(a, { node: child, N: 0, W: 0 });
      path.push({ node, a, reward });
      rolloutReturn = this._rollout(env);
      node = child;
    }
    // ---- backprop (discounted returns along the path) ----
    let G = rolloutReturn;
    for (let i = path.length - 1; i >= 0; i--) {
      G = path[i].reward + this.gamma * G;
      const edge = path[i].node.children.get(path[i].a);
      edge.N++; edge.W += G;
      path[i].node.N++;
    }
    root.N++;
  }

  act(env) {
    if (env.done) return C.DIR_NONE;
    const root = new MCTSNode(env);
    for (let i = 0; i < this.iterations; i++) this._iterate(env, root);
    // pick most-visited action
    let best = C.DIR_NONE, bestN = -1;
    for (const [a, ch] of root.children) if (ch.N > bestN) { bestN = ch.N; best = a; }
    return best;
  }

  // Play a full episode online (re-planning every step).
  play(levelNumber, { maxSteps = 400, seed = 12345 } = {}) {
    const env = new BananiaEnv(levelNumber, { maxSteps, seed });
    const t0 = Date.now();
    while (!env.done) env.step(this.act(env));
    return { won: env.won, dead: env.dead, steps: env.steps, ms: Date.now() - t0 };
  }

  evaluate(levelNumber, { trials = 30, maxSteps = 400 } = {}) {
    let wins = 0, deaths = 0, steps = 0, stepsWon = 0, ms = 0;
    for (let t = 0; t < trials; t++) {
      const r = this.play(levelNumber, { maxSteps, seed: 70000 + t });
      if (r.won) { wins++; stepsWon += r.steps; }
      if (r.dead) deaths++;
      steps += r.steps; ms += r.ms;
    }
    return {
      successRate: wins / trials, deathRate: deaths / trials,
      avgSteps: steps / trials, avgStepsWhenWon: wins ? stepsWon / wins : null,
      avgMsPerEpisode: ms / trials, trials,
    };
  }
}

return MCTSAgent;
})();
const HybridAgent = (function(){
// Hybrid agent = classical planning (A*) for the puzzle structure
// + reactive control for the stochastic monster threats.
//
// 1. PLAN: run A* on a monster-free clone of the current state to get an optimal
//    banana-collection / block-pushing route (the part A* is great at).
// 2. EXECUTE step by step on the LIVE env. Before each planned move, check threats.
// 3. EVADE: if a monster is within danger range (or the planned step would land
//    adjacent to a monster), abandon the plan for one move and take the legal move
//    that maximizes distance to the nearest monster while never stepping adjacent.
// 4. REPLAN: after any deviation (or if the plan is exhausted/invalid), re-run A*
//    from the new live position.
//
// This marries A*'s puzzle competence with reactive evasion of moving monsters —
// exactly the two faculties the pure methods each lack.



const ACTIONS = [C.DIR_UP, C.DIR_LEFT, C.DIR_DOWN, C.DIR_RIGHT];

function stripMonsters(env) {
  const e = env.clone();
  for (let x = 0; x < C.LEV_DIMENSION_X; x++)
    for (let y = 0; y < C.LEV_DIMENSION_Y; y++) {
      const v = e.at(x, y);
      if (v === C.ENT_PURPLE_MONSTER || v === C.ENT_GREEN_MONSTER) e.set(x, y, C.ENT_EMPTY);
    }
  e.monsters = [];
  return e;
}

function nearestMonsterDist(env, x, y) {
  let best = Infinity, mx = 0, my = 0;
  for (const m of env.monsters) {
    const d = Math.abs(m.x - x) + Math.abs(m.y - y);
    if (d < best) { best = d; mx = m.x; my = m.y; }
  }
  return { d: best, mx, my };
}

// adjacency (8-neighborhood) to any monster at a hypothetical position
function adjacentToMonster(env, x, y) {
  for (const m of env.monsters)
    if (Math.abs(m.x - x) <= 1 && Math.abs(m.y - y) <= 1) return true;
  return false;
}

class HybridAgent {
  constructor({ dangerDist = 3, replanBudget = 200000 } = {}) {
    this.dangerDist = dangerDist;
    this.replanBudget = replanBudget;
  }

  _plan(env) {
    const res = solveFromEnv(stripMonsters(env), { algo: 'astar', maxExpansions: this.replanBudget });
    return res.solved ? res.actions : [];
  }

  _evadeMove(env) {
    const b = env.berti;
    const legal = ACTIONS.filter(a => env.walkable(b.x, b.y, a));
    if (!legal.length) return C.DIR_NONE;
    // prefer moves that are NOT adjacent to any monster and maximize monster distance
    let best = null, bv = -Infinity;
    for (const a of legal) {
      const { dx, dy } = C.dirToDelta(a);
      const nx = b.x + dx, ny = b.y + dy;
      const adj = adjacentToMonster(env, nx, ny);
      const { d } = nearestMonsterDist(env, nx, ny);
      const score = (adj ? -1000 : 0) + d; // hard-avoid adjacency, else flee
      if (score > bv) { bv = score; best = a; }
    }
    return best == null ? C.DIR_NONE : best;
  }

  // Cheap reactive policy used when A* planning fails / is exhausted.
  // Greedy toward the nearest KEY (if its door still exists) or banana,
  // avoiding monster adjacency and immediate backtracking. Never calls A*.
  _reactiveMove(env, lastAction) {
    const b = env.berti;
    const legal = ACTIONS.filter(a => env.walkable(b.x, b.y, a));
    if (!legal.length) return C.DIR_NONE;

    // Priority 1: collect a key whose door still blocks the map
    let tgt = null, best = Infinity;
    for (let i = 0; i < C.LEV_DIMENSION_X; i++)
      for (let j = 0; j < C.LEV_DIMENSION_Y; j++) {
        const v = env.at(i, j);
        if (v >= C.ENT_KEY_1 && v <= C.ENT_KEY_6) {
          // check door still exists
          const door = C.KEY_TO_DOOR[v];
          let doorExists = false;
          for (let di = 0; di < C.LEV_DIMENSION_X && !doorExists; di++)
            for (let dj = 0; dj < C.LEV_DIMENSION_Y && !doorExists; dj++)
              if (env.at(di, dj) === door) doorExists = true;
          if (doorExists) {
            const d = Math.abs(i - b.x) + Math.abs(j - b.y);
            if (d < best) { best = d; tgt = { x: i, y: j }; }
          }
        }
      }
    // Priority 2: nearest banana
    if (!tgt) {
      for (let i = 0; i < C.LEV_DIMENSION_X; i++)
        for (let j = 0; j < C.LEV_DIMENSION_Y; j++)
          if (env.at(i, j) === C.ENT_BANANA_PEEL) {
            const d = Math.abs(i - b.x) + Math.abs(j - b.y);
            if (d < best) { best = d; tgt = { x: i, y: j }; }
          }
    }
    const back = C.oppositeDir(lastAction);
    let bestA = null, bv = -Infinity;
    for (const a of legal) {
      const { dx, dy } = C.dirToDelta(a);
      const nx = b.x + dx, ny = b.y + dy;
      let score = 0;
      if (adjacentToMonster(env, nx, ny)) score -= 1000;
      if (tgt) score -= (Math.abs(nx - tgt.x) + Math.abs(ny - tgt.y));
      if (a === back) score -= 2;          // discourage oscillation
      score += Math.random() * 0.5;        // break ties / escape local loops
      if (score > bv) { bv = score; bestA = a; }
    }
    return bestA == null ? C.DIR_NONE : bestA;
  }

  play(levelNumber, { maxSteps = 400, seed = 12345, verbose = false } = {}) {
    const env = new BananiaEnv(levelNumber, { maxSteps, seed });
    const t0 = Date.now();
    let plan = this._plan(env);
    let planFailed = plan.length === 0;
    let replans = 1, evades = 0, reactive = 0, needReplan = false;
    let lastAction = C.DIR_NONE;

    while (!env.done) {
      const b = env.berti;
      const { d } = nearestMonsterDist(env, b.x, b.y);
      let action;

      if (d <= this.dangerDist) {
        action = this._evadeMove(env);     // threat nearby -> reactive evasion
        evades++;
        if (!planFailed) needReplan = true; // route may be stale once safe
      } else if (planFailed) {
        action = this._reactiveMove(env, lastAction); // no A* anymore
        reactive++;
      } else {
        if (needReplan || plan.length === 0) {
          plan = this._plan(env); replans++; needReplan = false;
          if (plan.length === 0) planFailed = true; // give up planning for this episode
        }
        if (!planFailed && plan.length && env.walkable(b.x, b.y, plan[0])) {
          action = plan.shift();
        } else if (!planFailed) {
          // single bounded replan attempt, then fall back reactively
          plan = this._plan(env); replans++;
          if (plan.length && env.walkable(b.x, b.y, plan[0])) action = plan.shift();
          else { planFailed = true; action = this._reactiveMove(env, lastAction); reactive++; }
        } else {
          action = this._reactiveMove(env, lastAction); reactive++;
        }
      }

      lastAction = action;
      env.step(action);
    }
    return {
      won: env.won, dead: env.dead, steps: env.steps,
      replans, evades, reactive, planFailed, ms: Date.now() - t0,
    };
  }

  evaluate(levelNumber, { trials = 30, maxSteps = 400 } = {}) {
    let wins = 0, deaths = 0, steps = 0, stepsWon = 0, ms = 0, replans = 0;
    for (let t = 0; t < trials; t++) {
      const r = this.play(levelNumber, { maxSteps, seed: 90000 + t });
      if (r.won) { wins++; stepsWon += r.steps; }
      if (r.dead) deaths++;
      steps += r.steps; ms += r.ms; replans += r.replans;
    }
    return {
      successRate: wins / trials, deathRate: deaths / trials,
      avgSteps: steps / trials, avgStepsWhenWon: wins ? stepsWon / wins : null,
      avgMsPerEpisode: ms / trials, avgReplans: replans / trials, trials,
    };
  }
}

return HybridAgent;
})();
/* ===== LEVEL MEMORY — apprentissage inter-tentatives ===== */
/*
 * LevelMemory persiste entre les resets d'un même niveau :
 *   plan_cache     : le premier plan réussi est mémorisé → rejoué instantanément
 *   dead_hashes    : états où A* a échoué → blacklistés dans les replans suivants
 *   push_mistakes  : positions (x,y) de blocs poussés menant à un dead-end → pénalisés
 *   attempt        : numéro de la tentative courante (affiché dans le HUD)
 *
 * Architecture :
 *   - LevelMemory est un singleton global (levelMem)
 *   - makeController() reçoit la mémoire et l'utilise dans chaque décision
 *   - À chaque fin d'épisode (victoire ou mort), onEpisodeEnd() met à jour la mémoire
 */

class LevelMemory {
  constructor() {
    // Map<levelNumber, { planCache, deadHashes, pushMistakes, attempts, wins }>
    this._store = new Map();
  }

  _get(level) {
    if (!this._store.has(level))
      this._store.set(level, {
        planCache: null,       // actions[] réussi
        deadHashes: new Set(), // hashes de states où A* a échoué
        pushMistakes: new Set(), // "x,y" de blocs mal poussés menant à dead-end
        attempts: 0,
        wins: 0,
      });
    return this._store.get(level);
  }

  // Appelé au début de chaque tentative (avant le 1er decide())
  startAttempt(level) {
    const m = this._get(level);
    m.attempts++;
    return m;
  }

  // Victoire : mémorise le plan qui a fonctionné
  recordWin(level, actions) {
    const m = this._get(level);
    m.wins++;
    if (!m.planCache) {
      m.planCache = actions.slice(); // premier plan réussi → gardé intact
    }
  }

  // Échec A* : blackliste le hash de l'état courant
  recordDeadHash(level, hash) {
    this._get(level).deadHashes.add(hash);
  }

  // Dead-end : note les positions de blocs présents dans l'état courant
  recordPushMistake(level, env) {
    const m = this._get(level);
    for (let x = 0; x < NX; x++)
      for (let y = 0; y < NY; y++) {
        const v = env.at(x, y);
        if (v === C.ENT_LIGHT_BLOCK || v === C.ENT_HEAVY_BLOCK)
          m.pushMistakes.add(x + ',' + y);
      }
  }

  // Renvoie true si ce hash a déjà mené à un échec
  isDeadHash(level, hash) {
    const m = this._store.get(level);
    return m ? m.deadHashes.has(hash) : false;
  }

  // Pénalité de coût supplémentaire pour les positions de blocs connues mauvaises
  pushPenalty(level, env) {
    const m = this._store.get(level);
    if (!m || !m.pushMistakes.size) return 0;
    let hits = 0;
    for (let x = 0; x < NX; x++)
      for (let y = 0; y < NY; y++) {
        const v = env.at(x, y);
        if ((v === C.ENT_LIGHT_BLOCK || v === C.ENT_HEAVY_BLOCK) &&
            m.pushMistakes.has(x + ',' + y)) hits++;
      }
    return hits * 3; // +3 coût par bloc mal placé → A* dévie de ces configurations
  }

  getStats(level) {
    const m = this._store.get(level);
    if (!m) return { attempts: 0, wins: 0, deadHashes: 0, pushMistakes: 0, cached: false };
    return {
      attempts: m.attempts, wins: m.wins,
      deadHashes: m.deadHashes.size, pushMistakes: m.pushMistakes.size,
      cached: !!m.planCache,
    };
  }

  // Réinitialise la mémoire d'un niveau (bouton "Oublier")
  forgetLevel(level) { this._store.delete(level); }
  forgetAll() { this._store.clear(); }
}

const levelMem = new LevelMemory();

// Version de solveFromEnv consciente de la mémoire :
// - blackliste les dead hashes connus
// - ajoute une pénalité de coût sur les push-mistakes connus
function solveFromEnvWithMemory(startEnv, level, { maxExpansions = 400000 } = {}) {
  const root = startEnv.clone();
  root.freezeMonsters = true;
  root.done = false; root.won = false; root.dead = false;
  const startHash = root.hash();
  const open = new MinHeap();
  const gScore = new Map();
  const cameFrom = new Map();
  gScore.set(startHash, 0);
  open.push({ f: nearestBananaLowerBound(root), g: 0, env: root, hash: startHash });

  let expansions = 0;
  const t0 = Date.now();

  while (open.size()) {
    const cur = open.pop();
    if (cur.g > (gScore.get(cur.hash) ?? Infinity)) continue;
    // Never skip the start state — only skip non-start dead hashes
    if (cur.hash !== startHash && levelMem.isDeadHash(level, cur.hash)) continue;

    const env = cur.env;
    if (env.won) {
      const actions = [];
      let h = cur.hash;
      while (cameFrom.has(h)) { const c = cameFrom.get(h); actions.push(c.action); h = c.prev; }
      actions.reverse();
      return { solved: true, actions, steps: actions.length, expansions, ms: Date.now() - t0 };
    }
    if (++expansions > maxExpansions) break;

    let hasChildren = false;
    for (const a of C.DIRS) {
      if (!env.walkable(env.berti.x, env.berti.y, a)) continue;
      const child = env.clone();
      child.freezeMonsters = true;
      child.step(a);
      if (child.dead) continue;
      const hh = child.hash();
      if (hh !== startHash && levelMem.isDeadHash(level, hh)) continue;
      const penalty = levelMem.pushPenalty(level, child);
      const ng = cur.g + 1 + penalty;
      if (ng < (gScore.get(hh) ?? Infinity)) {
        gScore.set(hh, ng);
        cameFrom.set(hh, { prev: cur.hash, action: a });
        const h = nearestBananaLowerBound(child);
        open.push({ f: ng + h, g: ng, env: child, hash: hh });
        hasChildren = true;
      }
    }
    // Only blacklist true dead-ends (no valid children, not the start)
    if (!hasChildren && cur.hash !== startHash) {
      levelMem.recordDeadHash(level, cur.hash);
    }
  }
  return { solved: false, actions: [], steps: 0, expansions, ms: Date.now() - t0 };
}

/* ===== driver + menu ===== */
/* =========================================================================
   AI DRIVER + MENU for the ORIGINAL Banania game.js
   Drives Berti by setting input.keys_down[...] when he is idle (the game's own
   register_input/start_move then executes the move). Decoupled setInterval loop.
   ========================================================================= */

const KEY = { [C.DIR_LEFT]: 37, [C.DIR_UP]: 38, [C.DIR_RIGHT]: 39, [C.DIR_DOWN]: 40 };

function mirrorEnv() {
  const e = Object.create(BananiaEnv.prototype);
  e.levelNumber = game.level_number;
  e.maxSteps = 1e9; e.freezeMonsters = false; e.seed = aiSeed; e.rng = makeRng(aiSeed);
  e.grid = new Int8Array(NX * NY);
  e.faceDir = new Int8Array(NX * NY).fill(C.DIR_DOWN);
  e.bananas = 0; e.steps = 0; e.done = false; e.won = false; e.dead = false;
  for (let x = 0; x < NX; x++)
    for (let y = 0; y < NY; y++) {
      let id = game.level_array[x][y].id;
      if (id === C.ENT_DUMMY || id === C.ENT_AUTO_BERTI) id = C.ENT_EMPTY;
      e.grid[x * NY + y] = id;
      e.faceDir[x * NY + y] = game.level_array[x][y].face_dir || C.DIR_DOWN;
      if (id === C.ENT_BANANA_PEEL) e.bananas++;
    }
  const pb = playerBerti();
  e.berti = pb ? { x: pb.pos.x, y: pb.pos.y } : { x: 0, y: 0 };
  e.monsters = [];
  for (let x = 0; x < NX; x++)
    for (let y = 0; y < NY; y++) {
      const id = e.grid[x * NY + y];
      if (id === C.ENT_PURPLE_MONSTER || id === C.ENT_GREEN_MONSTER) e.monsters.push({ x, y, id });
    }
  return e;
}

function playerBerti() {
  if (!game.berti_positions) return null;
  for (const p of game.berti_positions) {
    const e = game.level_array[p.x] && game.level_array[p.x][p.y];
    if (e && e.id === C.ENT_PLAYER_BERTI) return { pos: p, ent: e };
  }
  return null;
}

function makeController(modeName) {
  const level = game.level_number;
  const mem = levelMem.startAttempt(level); // enregistre la tentative

  // ── A* avec mémoire ────────────────────────────────────────────────────
  if (modeName === 'astar') {
    // Si on a déjà un plan réussi pour ce niveau → le rejouer directement
    let plan = mem.planCache ? mem.planCache.slice() : null;
    let actionsPlayed = []; // trace pour enregistrer en cas de victoire

    return {
      decide(env) {
        // Plan cache disponible et encore valide ?
        if (plan && plan.length && env.walkable(env.berti.x, env.berti.y, plan[0])) {
          const a = plan.shift(); actionsPlayed.push(a); return a;
        }
        // Sinon : A* avec mémoire (blacklist + pénalités)
        plan = null;
        const r = solveFromEnvWithMemory(env, level, { maxExpansions: 70000 });
        if (r.solved) { plan = r.actions.slice(); }
        if (plan && plan.length && env.walkable(env.berti.x, env.berti.y, plan[0])) {
          const a = plan.shift(); actionsPlayed.push(a); return a;
        }
        return C.DIR_NONE;
      },
      onWin()  { levelMem.recordWin(level, actionsPlayed); },
      onDeath(env) { levelMem.recordPushMistake(level, env); },
    };
  }

  // ── MCTS (pas de cache plan, mais reward shaping déjà amélioré) ────────
  if (modeName === 'mcts') {
    const m = new MCTSAgent({ iterations: 140, rolloutDepth: 35 });
    return {
      decide(env) { return m.act(env); },
      onWin()  {},
      onDeath(env) { levelMem.recordPushMistake(level, env); },
    };
  }

  // ── Hybride avec mémoire ───────────────────────────────────────────────
  const h = new HybridAgent({ replanBudget: 60000, dangerDist: 3 });
  let plan = mem.planCache ? mem.planCache.slice() : null;
  let pf = (plan === null || plan.length === 0); // planFailed = true only if no cache
  let nr = false, last = C.DIR_NONE;
  let firstDecide = (plan === null); // need initial plan if no cache
  let actionsPlayed = [];

  // Wrapper de _plan qui utilise solveFromEnvWithMemory
  function memPlan(env) {
    const stripped = stripMonsters(env);
    const r = solveFromEnvWithMemory(stripped, level, { maxExpansions: h.replanBudget });
    return r.solved ? r.actions : [];
  }

  return {
    decide(env) {
      const b = env.berti;
      let md = Infinity;
      for (const mm of env.monsters) md = Math.min(md, Math.abs(mm.x - b.x) + Math.abs(mm.y - b.y));

      // Premier appel sans cache : planifier
      if (firstDecide) { firstDecide = false; plan = memPlan(env); pf = plan.length === 0; }

      let a;
      if (md <= h.dangerDist) {
        a = h._evadeMove(env); if (!pf) nr = true;
      } else if (pf) {
        a = h._reactiveMove(env, last);
      } else {
        if (nr || plan.length === 0) { plan = memPlan(env); nr = false; if (!plan.length) pf = true; }
        if (!pf && plan.length && env.walkable(b.x, b.y, plan[0])) {
          a = plan.shift();
        } else {
          plan = memPlan(env);
          if (plan.length && env.walkable(b.x, b.y, plan[0])) a = plan.shift();
          else { pf = true; a = h._reactiveMove(env, last); }
        }
      }
      last = a;
      if (a !== C.DIR_NONE) actionsPlayed.push(a);
      return a;
    },
    onWin()  { levelMem.recordWin(level, actionsPlayed); },
    onDeath(env) { levelMem.recordPushMistake(level, env); },
  };
}

/* ---- state ---- */
let aiMode = 'hybrid', aiOn = false, speed = 2, controller = null;
let lastLevel = -999, lastAction = '-';
let campaign = false, camLevelStart = 0, camDeaths = 0;
const CAM_SKIP_MS = 22000, CAM_MAX_DEATHS = 4;
let lastSeenLevel = -1;
let aiSeed = 42;
let lastEpisodeEnded = 0;

function resetController() {
  controller = makeController(aiMode);
  clearKeys();
  pendingDir = C.DIR_NONE; pendingPos = null;
  lastEpisodeEnded = 0;
}
function clearKeys() { input.keys_down = []; game.last_dir_pressed = C.DIR_NONE; }
function setKeyDir(dir) {
  input.keys_down = [];
  if (KEY[dir] !== undefined) {
    input.keys_down[KEY[dir]] = true;
    game.last_dir_pressed = dir;
  }
}
function dirName(d) { return d === C.DIR_UP ? 'haut' : d === C.DIR_DOWN ? 'bas' : d === C.DIR_LEFT ? 'gauche' : d === C.DIR_RIGHT ? 'droite' : '-'; }

// Track the last decided direction so we can keep the key held until Berti moves
let pendingDir = C.DIR_NONE;
let pendingPos = null; // position at which we decided pendingDir

function aiTick() {
  try {
    if (!(typeof res !== 'undefined' && res.ready && res.ready())) return;
    if (game.level_number !== lastLevel) {
      lastLevel = game.level_number;
      resetController();
      camLevelStart = Date.now(); camDeaths = 0;
      pendingDir = C.DIR_NONE; pendingPos = null;
    }
    campaignStep();
    updateHud();

    if (!aiOn || aiMode === 'human' || game.mode !== 1) { clearKeys(); return; }
    if (game.level_ended === 0 && game.wait_timer > 0) game.wait_timer = 0;

    // ── memory: detect end of episode ──────────────────────────────────
    if (game.level_ended !== 0 && game.level_ended !== lastEpisodeEnded) {
      lastEpisodeEnded = game.level_ended;
      if (controller) {
        if (game.level_ended === 1 && controller.onWin)   controller.onWin();
        if (game.level_ended === 2 && controller.onDeath) controller.onDeath(mirrorEnv());
      }
    }

    if (game.level_ended !== 0 || game.paused) { clearKeys(); pendingDir = C.DIR_NONE; return; }

    const pb = playerBerti();
    if (!pb) return;

    const curPos = pb.pos.x + ',' + pb.pos.y;

    // While Berti is moving: keep the key held so the game sees it every tick
    if (pb.ent.moving) {
      if (pendingDir !== C.DIR_NONE) setKeyDir(pendingDir);
      return;
    }

    // Berti is idle. If we already fired a key from this tile and he hasn't
    // moved yet (pendingPos === curPos), re-fire it — the game loop may have
    // missed it on a non-synced frame.
    if (pendingPos === curPos && pendingDir !== C.DIR_NONE) {
      setKeyDir(pendingDir);
      return;
    }

    // New tile (or no pending action) → ask the controller
    const env = mirrorEnv();
    if (env.bananas === 0) { clearKeys(); return; }
    if (!controller) resetController();

    const dir = controller.decide(env);
    pendingDir = dir;
    pendingPos = curPos;
    lastAction = dirName(dir);

    clearKeys();
    if (dir !== C.DIR_NONE) setKeyDir(dir);

  } catch (e) { setStatus('Erreur IA : ' + e.message); console.error(e); }
}

// speed slider -> game.move_speed (must divide 12 and 24 for clean tweening)
const SPEED_MAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 12 };
function applySpeed(v) { speed = Number(v); if (typeof game !== 'undefined') game.move_speed = SPEED_MAP[speed] || 2; }

function campaignStep() {
  if (game.level_number !== lastSeenLevel) {
    if (campaign && lastSeenLevel >= 1 && game.level_number === lastSeenLevel + 1) log('niveau ' + lastSeenLevel + ' resolu', 'ok');
    lastSeenLevel = game.level_number;
  }
  if (!campaign) return;
  if (game.level_ended === 2) camDeaths++;
  const tooLong = Date.now() - camLevelStart > CAM_SKIP_MS;
  if ((camDeaths >= CAM_MAX_DEATHS || tooLong) && game.mode === 1 && game.level_ended === 0) {
    const n = Math.min(50, game.level_number + 1); log('niveau ' + game.level_number + ' ignore', 'sk'); loadLevel(n);
  }
  if (game.mode === 2) { campaign = false; log('niveau 51 atteint', 'ok'); }
}

/* =========================== MENU (simple, white) =========================== */
function buildMenu() {
  const css = document.createElement('style');
  css.textContent =
    'body{background:#fff;color:#111;}' +
    '#aibar{position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;background:#fff;border-bottom:1px solid #ccc;font:14px system-ui,Arial,sans-serif;color:#111;}' +
    '#aibar label{color:#333;font-size:13px;}' +
    '#aibar select,#aibar input[type=number]{font-size:14px;padding:4px 6px;border:1px solid #aaa;border-radius:4px;background:#fff;color:#111;}' +
    '#aibar button{font-size:14px;padding:6px 12px;border:1px solid #888;border-radius:5px;background:#f3f3f3;color:#111;cursor:pointer;}' +
    '#aibar button:hover{background:#e8e8e8;}' +
    '#aibar button#aitoggle.off{background:#2e7d32;color:#fff;border-color:#2e7d32;font-weight:600;}' +
    '#aibar button#aitoggle.on{background:#c62828;color:#fff;border-color:#c62828;font-weight:600;}' +
    '#aibar button#aiforget{background:#fff3e0;border-color:#e65100;color:#e65100;}' +
    '#aibar button#aiforget:hover{background:#ffe0b2;}' +
    '#aibar .status{margin-left:auto;color:#444;font-size:13px;}' +
    '#aimem{position:fixed;right:248px;bottom:8px;z-index:99999;width:200px;max-height:150px;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:5px;padding:6px 8px;font:11px/1.5 monospace;color:#333;}' +
    '#aimem .hit{color:#2e7d32;font-weight:600;} #aimem .miss{color:#c62828;}' +
    '#ailog{position:fixed;right:8px;bottom:8px;z-index:99999;width:230px;max-height:150px;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:5px;padding:6px 8px;font:12px/1.5 monospace;color:#333;}' +
    '#ailog .ok{color:#2e7d32;} #ailog .sk{color:#888;}';
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.id = 'aibar';
  bar.innerHTML =
    'Banania AI &nbsp;'
    + '<label>Mode <select id="aimode">'
    + '<option value="hybrid">Hybride (IA)</option>'
    + '<option value="astar">A* (IA)</option>'
    + '<option value="mcts">MCTS (IA)</option>'
    + '<option value="human">Humain (fleches)</option>'
    + '</select></label>'
    + '<button id="aitoggle" class="off">&#9654; Lancer l\u2019IA</button>'
    + '<label>Niveau <input id="ailevel" type="number" min="1" max="50" value="1" style="width:58px"></label>'
    + '<button id="aiload">Charger</button><button id="aiprev">&#9664;</button><button id="ainext">&#9654;</button>'
    + '<label>Vitesse <input id="aispeed" type="range" min="1" max="6" value="2"></label>'
    + '<label>Seed <input id="aiseed" type="number" min="1" max="99999" value="42" style="width:64px" title="Seed pour A* et Hybride (relance l\'IA après changement)"></label>'
    + '<button id="aipause">Pause</button><button id="aireset">Reset</button>'
    + '<button id="aicamp">Campagne 1&#8594;51</button>'
    + '<button id="aiforget" title="Clear this level\'s memory">🧹 Clean Memory</button>'
    + '<span class="status" id="aistatus"></span>';
  document.body.appendChild(bar);
  const logBox = document.createElement('div'); logBox.id = 'ailog'; document.body.appendChild(logBox);
  const memBox = document.createElement('div'); memBox.id = 'aimem'; document.body.appendChild(memBox);

  const $ = id => document.getElementById(id);
  function refreshToggle() {
    const b = $('aitoggle'); if (!b) return;
    if (aiMode === 'human') { b.style.display = 'none'; }
    else { b.style.display = ''; b.className = aiOn ? 'on' : 'off'; b.innerHTML = aiOn ? '&#9208; Arreter l\u2019IA' : '&#9654; Lancer l\u2019IA'; }
  }
  $('aimode').onchange = e => { aiMode = e.target.value; if (aiMode === 'human') { aiOn = false; clearKeys(); } resetController(); refreshToggle(); };
  $('aitoggle').onclick = () => { aiOn = !aiOn; if (!aiOn) clearKeys(); refreshToggle(); };
  $('aispeed').oninput = e => { applySpeed(e.target.value); };
  $('aiseed').onchange = e => { const v = parseInt(e.target.value); if (v > 0) { aiSeed = v; resetController(); log('seed => ' + aiSeed); } };
  $('aiload').onclick = () => { campaign = false; loadLevel(Number($('ailevel').value)); };
  $('aiprev').onclick = () => { campaign = false; $('ailevel').value = Math.max(1, Number($('ailevel').value) - 1); loadLevel(Number($('ailevel').value)); };
  $('ainext').onclick = () => { campaign = false; $('ailevel').value = Math.min(50, Number($('ailevel').value) + 1); loadLevel(Number($('ailevel').value)); };
  $('aipause').onclick = () => { game.paused = !game.paused; $('aipause').textContent = game.paused ? 'Reprendre' : 'Pause'; };
  $('aireset').onclick = () => { campaign = false; game.reset_level(); if (game.single_steps) game.single_steps = false; resetController(); };
  $('aiforget').onclick = () => {
    levelMem.forgetLevel(game.level_number);
    resetController();
    log('mémoire niveau ' + game.level_number + ' effacée', 'sk');
    updateMemBox();
  };
  $('aicamp').onclick = () => {
    if (aiMode === 'human') { aiMode = 'hybrid'; $('aimode').value = 'hybrid'; }
    aiOn = true; campaign = true; $('ailog').innerHTML = ''; log('campagne lancee (' + aiMode + ')'); refreshToggle(); loadLevel(1);
  };
  refreshToggle();
}
function loadLevel(n) {
  n = Math.max(1, Math.min(50, n | 0));
  const el = document.getElementById('ailevel'); if (el) el.value = n;
  game.load_level(n);
  if (game.single_steps) game.single_steps = false; // keep AI auto-walk enabled
  resetController();
  lastLevel = n; lastSeenLevel = n;
}
function log(msg, cls) { const l = document.getElementById('ailog'); if (!l) return; l.innerHTML += '<span class="' + (cls || '') + '">' + msg + '</span><br>'; l.scrollTop = l.scrollHeight; }
function setStatus(s) { const el = document.getElementById('aistatus'); if (el) el.textContent = s; }
function updateMemBox() {
  const el = document.getElementById('aimem'); if (!el) return;
  const s = levelMem.getStats(game.level_number);
  if (s.attempts === 0) { el.innerHTML = '<b>Mémoire</b><br>aucune tentative'; return; }
  const cached = s.cached ? '<span class="hit">✔ plan en cache</span>' : '<span class="miss">✘ pas de cache</span>';
  el.innerHTML =
    '<b>Mémoire niv.' + game.level_number + '</b><br>' +
    cached + '<br>' +
    'tentatives : ' + s.attempts + ' (✔' + s.wins + ')<br>' +
    'états blacklistés : ' + s.deadHashes + '<br>' +
    'blocs à éviter : ' + s.pushMistakes;
}
function updateHud() {
  const st = game.level_ended === 1 ? 'gagné ✔' : game.level_ended === 2 ? 'mort ✘' : (game.paused ? 'pause' : (aiOn && aiMode !== 'human' ? 'IA active (' + lastAction + ')' : 'arrêté'));
  setStatus('niv.' + game.level_number + '  bananes:' + game.num_bananas + '  pas:' + (game.steps_taken || 0) + '  ' + st);
  updateMemBox();
}

/* ---- boot ---- */
function boot() {
  if (typeof game === 'undefined' || typeof res === 'undefined') { document.title = 'Banania AI - erreur de chargement'; return; }
  if (!(res.ready && res.ready())) { setTimeout(boot, 150); return; }
  if (!document.getElementById('aibar')) buildMenu();
  if (game.mode !== 1) loadLevel(1);
  // Disable single-step mode so last_dir_pressed keeps firing every synced frame
  if (game.single_steps) game.single_steps = false;
  // Auto-start the AI
  aiOn = true;
  const toggleBtn = document.getElementById('aitoggle');
  if (toggleBtn) { toggleBtn.className = 'on'; toggleBtn.innerHTML = '&#9208; Arreter l\u2019IA'; }
  applySpeed(2);
  setInterval(aiTick, 16); // ~60fps polling to match game UPS
}
boot();

})();
