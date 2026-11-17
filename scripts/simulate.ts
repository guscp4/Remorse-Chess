import { Game } from "../src/engine/game.ts";

const categoryCounts: Record<string, number> = {};
let maxMoves = 0;
let games = 0;
let checkmates = 0;
let stalemates = 0;
let eliminations = 0;
let cappedWithoutEnding = 0;

for (let g = 0; g < 300; g++) {
  const game = new Game();
  let moves = 0;
  while (game.status === "playing" && moves < 500) {
    const legal = game.getAllLegalMoves();
    if (legal.length === 0) break;
    const move = legal[Math.floor(Math.random() * legal.length)];
    const result = game.makeMove(move);
    eliminations += result.eliminated.length;
    if (result.pendingDiceRoll) {
      const rollResult = game.rollPendingDice();
      categoryCounts[rollResult.diceRoll.category] = (categoryCounts[rollResult.diceRoll.category] ?? 0) + 1;
      eliminations += rollResult.eliminated.length;
    }
    moves++;
  }
  games++;
  maxMoves = Math.max(maxMoves, moves);
  if (game.status === "checkmate") checkmates++;
  if (game.status === "stalemate") stalemates++;
  if (game.status === "playing") cappedWithoutEnding++;
  for (const color of ["w", "b"] as const) {
    for (const p of game.capturedBy[color]) {
      if (p.type === "K") throw new Error("A king ended up in a capturedBy list!");
    }
  }
}

console.log("games:", games);
console.log("maxMoves:", maxMoves);
console.log("checkmates:", checkmates);
console.log("stalemates:", stalemates);
console.log("eliminations (devastated timeout):", eliminations);
console.log("capped at 500 moves without ending:", cappedWithoutEnding);
console.log("dice categories:", categoryCounts);
