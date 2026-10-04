#!/usr/bin/env node
import { main } from "./runner.ts";

process.exitCode = await main(process.argv.slice(2));
