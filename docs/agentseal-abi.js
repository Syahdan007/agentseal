/*
 * AgentSeal + Agent ID registry ABIs (human-readable ethers v6 format).
 *
 * Synced by the parent agent with the compiled contract ABI
 * (~/workspace/hackathon-agentid/contract/AgentSeal.abi.json, solc 0.8.28)
 * on 2026-11-19: identical signatures, including the registerProject
 * return value, the agentRegistry() view, and the three events.
 */

// AgentSeal (trust registry) — write functions are holder-gated on-chain.
const AGENTSEAL_ABI = [
  "function registerProject(string name, string link, address projectContract, string description) returns (uint256 projectId)",
  "function attest(uint256 projectId, bool vouch, string note)",
  "function checkIn()",
  "function projectCount() view returns (uint256)",
  "function agentRegistry() view returns (address)",
  "function getProject(uint256 projectId) view returns (address registrant, string name, string link, address projectContract, string description, uint256 vouches, uint256 flags, uint256 createdAt)",
  "function attestationOf(uint256 projectId, address user) view returns (bool exists, bool vouch, string note, uint256 updatedAt)",
  "function streakOf(address user) view returns (uint256 currentStreak, uint256 totalCheckIns, uint256 lastCheckInDay)",
  "function isHolder(address user) view returns (bool)",
  "event ProjectRegistered(uint256 indexed id, address indexed registrant, string name)",
  "event Attested(uint256 indexed projectId, address indexed attester, bool vouch)",
  "event CheckedIn(address indexed user, uint256 streak, uint256 totalCheckIns)"
];

// Agent ID registry (BNB Chain). Only ever queried for the CONNECTED user's
// own address — never to look up other people's wallets.
const AGENT_ID_REGISTRY_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function handleOf(address owner) view returns (string)"
];
