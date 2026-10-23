// Small seeded random number generator (mulberry32). The state is a plain
// number so it can be stored in the game state and replayed exactly.

export function rngNext(holder) {
  let t = (holder.seed = (holder.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngInt(holder, n) {
  return Math.floor(rngNext(holder) * n);
}

export function rngPick(holder, arr) {
  return arr[rngInt(holder, arr.length)];
}

export function rngShuffle(holder, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(holder, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
