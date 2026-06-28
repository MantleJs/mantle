#!/usr/bin/env node
import { newProject } from "@mantlejs/cli";

const projectName = process.argv[2];

if (!projectName) {
  console.error("Usage: npm create mantle <project-name>");
  process.exit(1);
}

await newProject(projectName, {});
