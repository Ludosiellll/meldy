/**
 * The arena of «Встань на ответ» as the room sends it (contracts/live/stand_arena.json; the room's welcome and hello
 * carry the same): a battle's projector draws it before the room's welcome, and without the room at all (the class
 * round the boss needs no positions). world.test.ts checks it against the contract.
 */
import { STAND_ARENA, type MapJson, type StandFloor } from '../../../lib/live/move';

export interface StandWorld {
  map: MapJson;
  stage: [number, number, number];
  floor: StandFloor;
}

export const STAND_WORLD: StandWorld = {
  map: STAND_ARENA,
  stage: [800, 520, 80],
  floor: { x: 20, y: 160, tile: 60, cols: 26, rows: 12 },
};
