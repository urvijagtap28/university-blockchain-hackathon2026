// QE round 2 TEST-ONLY agent: writes the raw lines of the file named by FAKE_LINES (verbatim, so keys like __proto__ survive) to the decision log,
// then continues as web/test/fake_agent.mjs (paid scenario, signed record). Usage via createApp agentCmd, env FAKE_LINES.
import { appendFileSync, readFileSync } from "node:fs";
appendFileSync(process.env.AGENT_LOG_PATH, readFileSync(process.env.FAKE_LINES, "utf8"));
await import("../fake_agent.mjs");
