// Game data: items, traps, remedies and furniture kinds.
// The trap/remedy pairs follow the pattern of the original manual
// (each trap has one remedy found in one kind of fixture).

export const ITEMS = ['passport', 'money', 'key', 'plans'];

export const TRAPS = [
  { id: 'bomb', name: 'Bomb', on: 'furniture', remedy: 'water' },
  { id: 'spring', name: 'Spring', on: 'furniture', remedy: 'cutters' },
  { id: 'bucket', name: 'Bucket', on: 'door', remedy: 'umbrella' },
  { id: 'gun', name: 'Gun', on: 'door', remedy: 'scissors' },
  { id: 'timebomb', name: 'Time bomb', on: 'floor', remedy: null },
];
export const TRAP_BY_ID = Object.fromEntries(TRAPS.map((t) => [t.id, t]));

export const REMEDIES = {
  water: { name: 'Water bucket', fixture: 'firebox' },
  cutters: { name: 'Wire cutters', fixture: 'toolbox' },
  umbrella: { name: 'Umbrella', fixture: 'coatrack' },
  scissors: { name: 'Scissors', fixture: 'firstaid' },
};

// Fixtures always hand out their remedy and never hide required items [manual].
// wall: where the fixture hangs. 'back' fixtures use a back-wall slot.
export const FIXTURES = {
  firebox: { remedy: 'water', wall: 'left' },
  toolbox: { remedy: 'cutters', wall: 'right' },
  coatrack: { remedy: 'umbrella', wall: 'back' },
  firstaid: { remedy: 'scissors', wall: 'back' },
};

export const FURNITURE_KINDS = ['desk', 'cabinet', 'bookshelf', 'tv', 'dresser', 'plant'];

export const SIDES = ['n', 's', 'w', 'e'];
export const OPPOSITE = { n: 's', s: 'n', w: 'e', e: 'w' };
export const SIDE_DELTA = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

// Floor anchor points for doors, and where a spy appears after coming through one.
export const DOOR_ANCHOR = { n: [0.5, 0.05], s: [0.5, 0.96], w: [0.05, 0.45], e: [0.95, 0.45] };
export const DOOR_ARRIVE = { n: [0.5, 0.1], s: [0.5, 0.9], w: [0.1, 0.45], e: [0.9, 0.45] };
export const DOOR_APERTURE = { n: 0.08, s: 0.09, w: 0.13, e: 0.13 };

export const BACK_SLOTS = [0.13, 0.31, 0.69, 0.87];
export const SIDE_FIXTURE_Z = 0.82;
