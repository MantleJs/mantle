export interface RequestContext<Request = any> {
  /** This is the server  */
  req: Request;
  env: {
    epoch: number;
    variables: Record<string, any>;
  };
}
