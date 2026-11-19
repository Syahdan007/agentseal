// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockAgentIDRegistry — TEST-ONLY stand-in for the Agent ID registry
/// @notice Local test double for the BNB Chain Agent ID registry
///         (0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F). It implements the
///         same `balanceOf` / `handleOf` surface AgentSeal reads, with
///         settable state so tests can mint/revoke "Agent IDs" at will.
/// @dev NEVER deploy this to a live network. In tests its runtime code is
///      etched onto the real registry address inside the local EVM
///      (Hardhat `hardhat_setCode`), so AgentSeal talks to the exact
///      address it will use in production.
contract MockAgentIDRegistry {
    mapping(address => uint256) private _balances;
    mapping(address => string) private _handles;

    /// @notice Grant or revoke an Agent ID and set the handle.
    /// @param account The address to configure.
    /// @param holder True to make the address a holder (balance 1,
    ///        matching the real registry's one-per-address cap).
    /// @param handle Bare handle (e.g. "syahdan" for "syahdan.ai").
    function setHolder(
        address account,
        bool holder,
        string calldata handle
    ) external {
        _balances[account] = holder ? 1 : 0;
        _handles[account] = handle;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function handleOf(address account) external view returns (string memory) {
        return _handles[account];
    }
}
