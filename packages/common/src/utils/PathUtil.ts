export function trimSlashes(name: string) {
  return name.replace(/^(\/+)|(\/+)$/g, "");
}

export const PathUtil = {
  trimSlashes,
};
