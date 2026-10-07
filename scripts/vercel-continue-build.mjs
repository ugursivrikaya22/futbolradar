import { buildDecision } from "./lib/buildDecision.mjs";

const decision = buildDecision();
console.log("FutbolRadar: " + decision.reason);
// Vercel: 0 skips the build; 1 continues it.
process.exit(decision.build ? 1 : 0);
