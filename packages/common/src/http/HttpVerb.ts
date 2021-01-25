export const HttpVerb = {
  get GET(): "get" {
    return "get";
  },
  get POST(): "post" {
    return "post";
  },
  get SEARCH(): "search" {
    return "search";
  },
  get PUT(): "put" {
    return "put";
  },
  get PATCH(): "patch" {
    return "patch";
  },
  get DELETE(): "delete" {
    return "delete";
  },
  includes(method: string) {
    if (typeof method !== "string") return false;
    return Object.keys(this)
      .filter((key) => !["includes"].includes(key))
      .includes(method.toUpperCase());
  },
};

const verbs = [HttpVerb.GET, HttpVerb.POST, HttpVerb.PUT, HttpVerb.PATCH, HttpVerb.DELETE, HttpVerb.SEARCH] as const;
export type HttpVerb = typeof verbs[number];
