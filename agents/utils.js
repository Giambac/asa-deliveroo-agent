export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function key(x, y) {
  return `${Math.round(x)},${Math.round(y)}`;
}

export function edgeKey(from, to) {
  return `${key(from.x, from.y)}->${key(to.x, to.y)}`;
}

export function distance(a, b) {
  return Math.abs(Math.round(a.x) - Math.round(b.x)) + Math.abs(Math.round(a.y) - Math.round(b.y));
}
