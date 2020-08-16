export interface RequestContext<Request = any> {
  req: Request;
  env: {
    epoch: number;
    variables: Record<string, any>;
  };
}
