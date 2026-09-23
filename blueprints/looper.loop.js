// A broken script on purpose: it never returns. The sandbox stops it after its budget for the tick and turns
// it off with an error, and the game keeps running.
function tick() {
  while (true) {}
}
