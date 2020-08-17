import { ServiceHook, ServicePipe, ServiceResponse, ServiceRequest } from "./index";
import { ServiceResponseType } from "./ServiceResponse";
import { ServiceFunction } from "./ServiceHook";

const Hook1 = ServiceHook({
  before: ({ request }) => {
    request.data += `hook1 (param=${request.getParam(["a", "b"])}) => `;
    return Promise.resolve(request);
  },
  after: ({ response }) => {
    return Promise.resolve(new ServiceResponse({ ...response, payload: response.payload + " => hook1" }));
  },
});
const Hook2 = ServiceHook({
  before: ({ request }) => {
    request.data += "hook2 => ";
    return Promise.resolve(request);
  },
  after: ({ response }) => {
    return Promise.resolve(new ServiceResponse({ ...response, payload: response.payload + " => hook2" }));
  },
});
const Hook3 = ServiceHook({
  before: ({ request }) => {
    request.data += "hook3 => ";
    return Promise.resolve(request);
  },
  after: ({ response }) => {
    return Promise.resolve(new ServiceResponse({ ...response, payload: response.payload + " => hook3" }));
  },
});

const hooks = [Hook1, Hook2, Hook3];

function service(request: ServiceRequest): Promise<ServiceResponse> {
  return Promise.resolve(new ServiceResponse({ type: ServiceResponseType.SUCCESS, payload: `${request.data}<<svc>>` }));
}

describe("ServicePipe", () => {
  let svcFn: ServiceFunction;
  beforeEach(() => {
    svcFn = ServicePipe(hooks)(service);
  });
  it("should execute hooks in the correct order with request initialized to ServiceRequest before first hook", async () => {
    expect((await svcFn(new ServiceRequest({ data: "data => ", params: { a: { b: "c" } } }))).payload).toBe("data => hook1 (param=c) => hook2 => hook3 => <<svc>> => hook3 => hook2 => hook1");
  });
});
