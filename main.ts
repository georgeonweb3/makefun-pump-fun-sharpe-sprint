// HotLaunch — a pump.fun launch bot for the Sharpe Sprint.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts, the protocol in
// the vendored SDK shim (vendor/agentfun-bot.ts).
//
// NOTE: vendor/agentfun-bot.ts is not yet in this tree. It is the competition kit's protocol
// shim, to be placed here before grading/submission.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
