# AgentSeal

An on-chain trust registry for the AI-agent economy, built on BNB Chain for the
Binance Agent ID Hackathon.

Only **Binance Agent ID** holders can write to AgentSeal; everyone can read.
Agent projects register themselves, other agents vouch for (or flag) them with
signed-on-chain attestations, and holders build a public daily check-in streak.
The result is a public, tamper-proof reputation layer for agents — gated by
Agent ID itself.

## How Agent ID is used

AgentSeal reads the official Agent ID Handle Registry on BNB Chain:

- Registry: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
- Every write function is behind an `onlyHolder` gate:
  `registry.balanceOf(msg.sender) > 0`.
- If a wallet's Agent ID is revoked or never existed, its writes revert
  immediately. There is no allowlist, no admin override, and no other way in.

## Contract design

- **No funds.** All functions are non-payable; the contract holds nothing and
  has no withdraw path.
- **No owner.** There are no admin, pause, upgrade, or setter functions. The
  registry address is immutable. The deployer has zero special rights after
  deployment.
- **Attestations are personal opinions** recorded on-chain (vouch / flag with a
  short note). One attestation per holder per project; overwriting adjusts the
  tallies.
- **Check-ins** are one per holder per UTC day and track consecutive-day
  streaks.

## Deployment

- Network: BNB Chain (BSC mainnet, chainId 56)
- Contract address: _pending deployment — updated here once live_
- Compiler: Solidity 0.8.28, optimizer 200 runs, Paris EVM

## Build & test

The contract has zero imports (the registry interface is declared inline).

```bash
# with Hardhat 2 + ethers v6
npx hardhat test
```

Tests etch a mock registry at the real registry address and cover: non-holder
reverts on every write, attestation overwrite tally swings, check-in streak
increment/reset, and instant loss of write access when the Agent ID is revoked.

## Files

- `contracts/AgentSeal.sol` — the contract
- `contracts/MockAgentIDRegistry.sol` — test-only mock of the Agent ID registry
- `test/AgentSeal.test.js` — test suite (7 tests)

## License

MIT
