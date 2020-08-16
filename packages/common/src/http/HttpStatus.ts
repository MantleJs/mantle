export enum HttpStatus {
  /** Success */
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,
  /** Client Errors */
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  AUTH_TIMEOUT = 419,
  /** Server Errors */
  INTERNAL_SERVER_ERROR = 500,
}
