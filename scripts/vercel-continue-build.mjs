import { buildDecision } from "./lib/buildDecision.mjs";
import { deployHookTrigger } from "./lib/deployHookTrigger.mjs";

const deployHook = await deployHookTrigger();
const decision = buildDecision(process.env, process.cwd(), { deployHook });
console.log("FutbolRadar: " + decision.reason);
// Vercel: 0 skips the build; 1 continues it.
process.exit(decision.build ? 1 : 0);
