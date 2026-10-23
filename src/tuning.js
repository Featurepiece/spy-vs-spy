// TUNING: every feel, timing and scoring number lives here.
//
// Each value is tagged with where it comes from:
//   [manual]  stated in the original First Star Software manual text
//   [seen]    read off C64 gameplay footage
//   [ours]    our own choice, picked for playability; tune freely
//
// Floor positions use room units: x runs 0 (left wall) to 1 (right wall),
// z runs 0 (back wall) to 1 (front edge of the floor).

export const TUNING = {
  // Simulation runs at a fixed step so it can later run identically on a server.
  tickRate: 60, // [ours]

  levels: [
    // rooms and minutes for levels 1-3 are the C64 options-screen values [seen].
    // trapsEach is how many of each trap type each spy carries [ours]: the C64
    // screen gives a total (twice the room count) but not how it splits.
    { name: 'Level 1', rooms: 6, minutes: 7, trapsEach: 2, grid: [3, 3] },
    { name: 'Level 2', rooms: 13, minutes: 12, trapsEach: 3, grid: [4, 4] },
    { name: 'Level 3', rooms: 20, minutes: 15, trapsEach: 4, grid: [5, 5] },
  ],

  move: {
    speedX: 0.36, // room widths per second [ours]
    speedZ: 0.8, // room depths per second [ours]
    accel: 18, // how fast velocity reaches target, per second; high = snappy [ours]
    decel: 22, // [ours]
    doorCooldown: 0.3, // seconds after walking through a door before another door works [ours]
  },

  reach: { x: 0.09, z: 0.17 }, // how close you must stand to use furniture [ours]
  searchTime: 0.45, // seconds spent rummaging in furniture [ours]

  time: {
    trapSetCost: 3, // seconds of clock to set a trap [ours]; the original's cost is unknown
    deathDown: 7, // seconds lying dead, clock still running [manual: 7 s real time]
    deathPenalty: 20, // extra seconds taken off the clock [manual: 20 s game time]
    mapDrain: 4, // clock runs this many times faster while the map is open [ours; footage shows "several times"]
    lowTimeWarn: 30, // seconds left when the warning light starts [ours]
    timeBombFuse: 15, // [manual]
  },

  combat: {
    maxHp: 7, // [manual: about 7 solid blows knock a spy out]
    jab: { startup: 0.07, active: 0.08, recovery: 0.16, range: 0.11, dmg: 1, knock: 0.05, hitstop: 0.05 }, // [ours]
    heavy: { startup: 0.32, active: 0.1, recovery: 0.32, range: 0.13, dmg: 2, knock: 0.12, hitstop: 0.1 }, // [ours]
    reachZ: 0.09, // how far apart in depth a blow still lands [ours]
    hitstun: 0.25, // [ours]
    regenEvery: 3, // seconds per health point regained when not hit for a while [ours; manual says strength recovers]
    respawnInvuln: 1.2, // [ours]
  },

  // When your trap catches the rival, your spy stops and laughs, wherever they are [Steven's memory of the original].
  // How long it lasts is [ours]; the clock keeps running meanwhile.
  laughTime: 2.2,

  // Arrows under the room pointing the way back, up to 9 rooms [manual]. The manual says they're off on
  // higher levels without saying which; we switch them off from this level index on [ours].
  crumbs: { max: 9, offFromLevel: 2 },

  guard: { stun: 0.7, knock: 0.25 }, // airport guard's boot [ours]

  // Points [manual], except the escape bonus which is ours (the manual's end formula isn't given).
  score: {
    winFight: 80,
    stealItem: 60,
    defuse: 40,
    setTrap: 30,
    loseFight: -20,
    openMap: -70,
    trapped: -80,
    trapSprung: 50, // to the trap's owner when the rival sets it off [manual says points are awarded; the amount is ours]
    escapeBonus: 500, // [ours]
    perSecondLeft: 5, // [ours]
  },

  juice: {
    shakeBomb: 9, // pixels [ours]
    shakeHit: 3,
    shakeDecay: 10, // per second
    fade: 0.18, // room change fade, seconds
  },

  cpu: [
    // [ours] The original's CPU logic isn't documented anywhere we found.
    { name: 'Rookie', trapChance: 0.12, doorTrapChance: 0.06, aggression: 0.35, reaction: 0.45, dawdle: 0.5, remedyChance: 0.3 },
    { name: 'Agent', trapChance: 0.3, doorTrapChance: 0.15, aggression: 0.6, reaction: 0.28, dawdle: 0.2, remedyChance: 0.6 },
    { name: 'Mastermind', trapChance: 0.5, doorTrapChance: 0.3, aggression: 0.85, reaction: 0.16, dawdle: 0.05, remedyChance: 0.9 },
  ],
};
