import express, { Express, Router } from "express";
import { Application } from "@mantlejs/mantle";
import Debug from "debug";

const debug = Debug("@mantlejs/express");

export type MantleExpress = Express & Application & { basePath: string; resourceRouters: { [resource: string]: Router } };

export interface MantleExpressOptions {
  basePath?: string;
}

export function mantleExpress(mantleApp: Application, expressApp = express(), options: MantleExpressOptions = {}): MantleExpress {
  if (typeof mantleApp === "undefined") throw new Error("@mantle/express requires the mantle application");
  if (mantleApp instanceof Application === false) throw new Error("@mantlejs/express requires the mantle application to be an instance of Application");

  const { basePath = "/" } = options;

  const expressListen = expressApp.listen.bind(expressApp);
  const expressUse = expressApp.use.bind(expressApp);
  copyProps(mantleApp, expressApp);

  /** override listen method */
  expressApp.listen = function listen(...args: any[]) {
    const server = expressListen(...args);
    this.setup();
    debug(`mantlejs version ${this.version} listening`);
    return server;
  };

  /** overrid use method */
  expressApp.use = function use(arg0: any, ...args: any[]) {
    if (isService(arg0)) {
      debug("Registering mantle service");
      mantleApp.use.call(this, arg0, ...args);
    } else {
      debug("Registering express middleware");
      expressUse(arg0, ...args);
    }
    return expressApp;
  };

  const app = expressApp as MantleExpress;

  app.basePath = basePath;

  return app;
}

function isService(arg: any) {
  return typeof arg.fn === "function";
}

function copyProps(source: any, target: any) {
  /** copy instance properties */
  copyPropDescriptors(source, target);

  /** copy prototype properties */
  copyPropDescriptors(Application.prototype, target, ["constructor"]);
}

function copyPropDescriptors(source: any, target: any, exclude: any[] = []) {
  const sourceDesc = Object.getOwnPropertyDescriptors(source);
  Object.keys(sourceDesc).forEach((prop) => {
    if (!exclude.includes(prop) && typeof target[prop] === "undefined") {
      Object.defineProperty(target, prop, sourceDesc[prop]);
    }
  });
}
