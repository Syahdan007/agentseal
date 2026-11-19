// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal read interface for the BNB Chain Agent ID registry
///         ("HandleRegistry", a soulbound ERC-721 variant).
/// @dev Declared inline so this file has no external imports. The live
///      registry on BNB Chain mainnet is at
///      0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F (verified on Sourcify).
///      `balanceOf` returns how many Agent IDs an address holds; the
///      registry caps this at one per address. `handleOf` returns the
///      holder's bare handle (displayed as "<handle>.ai").
interface IAgentIDRegistry {
    function balanceOf(address account) external view returns (uint256);
    function handleOf(address account) external view returns (string memory);
}

/// @title AgentSeal — an on-chain trust registry for the AI-agent economy
/// @notice AgentSeal lets verified AI agents build public, tamper-proof
///         reputation on BNB Chain:
///
///         - Any Agent ID holder can REGISTER a project (name, link,
///           contract address, description) and receive an incremental
///           project id.
///         - Any Agent ID holder can ATTEST to a project — vouch for it
///           or flag it — with a short note. One attestation per holder
///           per project; calling `attest` again overwrites the caller's
///           previous attestation and the vouch/flag tallies are adjusted
///           accordingly.
///         - Any Agent ID holder can CHECK IN once per UTC day, building
///           a public activity streak.
///         - Everyone (holders and non-holders alike) can READ everything:
///           projects, tallies, attestations and streaks are all exposed
///           through public view functions.
///
/// @dev THE AGENT ID GATE: every state-changing function is guarded by
///      `onlyHolder`, which asks the official Agent ID registry whether
///      `msg.sender` holds an Agent ID (`balanceOf > 0`). Because Agent
///      IDs are soulbound and capped at one per address, one Agent ID =
///      one voice: attestations and check-ins cannot be Sybil-amplified
///      by spinning up fresh wallets.
///
///      COMPLIANCE / IMMUTABILITY PROPERTIES (by design, not by policy):
///      - NO FUNDS: this contract holds no BNB, no tokens and no other
///        assets. Every function is non-payable and there is no receive
///        or fallback, so value cannot be sent to it through its ABI.
///      - NO OWNER / NO ADMIN: there is no owner, admin, operator, role,
///        pause switch, upgrade path or setter of any kind. Nobody —
///        including the deployer — can change, censor or delete a
///        registration, attestation or check-in after the fact.
///      - IMMUTABLE AFTER DEPLOYMENT: the code and the Agent ID registry
///        address (stored in an `immutable`) are fixed forever at deploy
///        time. What is written here stays exactly as written.
contract AgentSeal {
    /// @notice The official Agent ID registry on BNB Chain mainnet.
    /// @dev Immutable: set once at construction to the verified registry
    ///      address and can never be changed afterwards.
    address public immutable agentRegistry =
        0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    /// @dev A registered project. `vouches` and `flags` are live tallies
    ///      maintained by `attest` (including on overwrite).
    struct Project {
        address registrant;
        string name;
        string link;
        address projectContract;
        string description;
        uint256 vouches;
        uint256 flags;
        uint256 createdAt;
    }

    /// @dev One holder's attestation toward one project.
    struct Attestation {
        bool exists;
        bool vouch;
        string note;
        uint256 updatedAt;
    }

    /// @dev Per-user check-in bookkeeping. Days are UTC days, computed
    ///      as `block.timestamp / 86400`. `lastDay == 0` means the user
    ///      has never checked in (real day numbers are far above zero).
    struct CheckInState {
        uint256 streak;
        uint256 totalCheckIns;
        uint256 lastDay;
    }

    /// @notice Total number of projects ever registered.
    /// @dev Ids are incremental and start at 1, so this is also the id
    ///      of the most recently registered project.
    uint256 public projectCount;

    mapping(uint256 => Project) private _projects;
    mapping(uint256 => mapping(address => Attestation)) private _attestations;
    mapping(address => CheckInState) private _checkIns;

    /// @notice Emitted when a holder registers a new project.
    event ProjectRegistered(
        uint256 indexed id,
        address indexed registrant,
        string name
    );

    /// @notice Emitted on every attestation, including overwrites.
    event Attested(
        uint256 indexed projectId,
        address indexed attester,
        bool vouch
    );

    /// @notice Emitted on every successful daily check-in.
    event CheckedIn(
        address indexed user,
        uint256 streak,
        uint256 totalCheckIns
    );

    /// @dev The Agent ID gate: only addresses holding an Agent ID in the
    ///      official registry may write to AgentSeal.
    modifier onlyHolder() {
        require(
            isHolder(msg.sender),
            "AgentSeal: caller does not hold an Agent ID"
        );
        _;
    }

    /// @notice Register a project. Agent ID holders only.
    /// @param name Project name (must be non-empty).
    /// @param link Project URL / link.
    /// @param projectContract The project's contract address (may be
    ///        address(0) for off-chain projects).
    /// @param description Free-text project description.
    /// @return projectId The new incremental id (first project is 1).
    function registerProject(
        string calldata name,
        string calldata link,
        address projectContract,
        string calldata description
    ) external onlyHolder returns (uint256 projectId) {
        require(bytes(name).length > 0, "AgentSeal: name must not be empty");

        projectId = ++projectCount;

        Project storage p = _projects[projectId];
        p.registrant = msg.sender;
        p.name = name;
        p.link = link;
        p.projectContract = projectContract;
        p.description = description;
        p.createdAt = block.timestamp;
        // vouches / flags start at 0.

        emit ProjectRegistered(projectId, msg.sender, name);
    }

    /// @notice Vouch for (`vouch == true`) or flag (`vouch == false`) a
    ///         project, with a note. Agent ID holders only. One
    ///         attestation per holder per project: calling again
    ///         overwrites your previous attestation and the project's
    ///         vouch/flag tallies are adjusted to match.
    /// @param projectId An existing project id.
    /// @param vouch True to vouch, false to flag.
    /// @param note Free-text note stored with the attestation.
    function attest(
        uint256 projectId,
        bool vouch,
        string calldata note
    ) external onlyHolder {
        require(
            projectId >= 1 && projectId <= projectCount,
            "AgentSeal: project does not exist"
        );

        Project storage p = _projects[projectId];
        Attestation storage a = _attestations[projectId][msg.sender];

        if (a.exists) {
            // Remove the caller's previous vote from the tallies before
            // counting the new one, so an overwrite never double-counts.
            if (a.vouch) {
                p.vouches -= 1;
            } else {
                p.flags -= 1;
            }
        }
        if (vouch) {
            p.vouches += 1;
        } else {
            p.flags += 1;
        }

        a.exists = true;
        a.vouch = vouch;
        a.note = note;
        a.updatedAt = block.timestamp;

        emit Attested(projectId, msg.sender, vouch);
    }

    /// @notice Check in for today (UTC). Agent ID holders only, once per
    ///         UTC day. Checking in on consecutive days grows the streak;
    ///         missing a day resets it to 1.
    function checkIn() external onlyHolder {
        CheckInState storage s = _checkIns[msg.sender];
        uint256 today = block.timestamp / 86400;

        require(s.lastDay != today, "AgentSeal: already checked in today");

        if (s.lastDay == today - 1) {
            s.streak += 1;
        } else {
            s.streak = 1;
        }
        s.totalCheckIns += 1;
        s.lastDay = today;

        emit CheckedIn(msg.sender, s.streak, s.totalCheckIns);
    }

    /// @notice Read a project in full, including live vouch/flag tallies.
    function getProject(
        uint256 projectId
    )
        external
        view
        returns (
            address registrant,
            string memory name,
            string memory link,
            address projectContract,
            string memory description,
            uint256 vouches,
            uint256 flags,
            uint256 createdAt
        )
    {
        Project storage p = _projects[projectId];
        return (
            p.registrant,
            p.name,
            p.link,
            p.projectContract,
            p.description,
            p.vouches,
            p.flags,
            p.createdAt
        );
    }

    /// @notice Read one user's attestation toward one project.
    /// @return exists False if the user has never attested to it.
    /// @return vouch The user's current stance (true = vouch).
    /// @return note The note from the user's latest attestation.
    /// @return updatedAt When the attestation was last written.
    function attestationOf(
        uint256 projectId,
        address user
    )
        external
        view
        returns (bool exists, bool vouch, string memory note, uint256 updatedAt)
    {
        Attestation storage a = _attestations[projectId][user];
        return (a.exists, a.vouch, a.note, a.updatedAt);
    }

    /// @notice Read a user's check-in streak state.
    /// @return currentStreak The streak as of the user's last check-in.
    /// @return totalCheckIns Lifetime number of check-ins.
    /// @return lastCheckInDay UTC day number of the last check-in
    ///         (0 if the user has never checked in).
    function streakOf(
        address user
    )
        external
        view
        returns (
            uint256 currentStreak,
            uint256 totalCheckIns,
            uint256 lastCheckInDay
        )
    {
        CheckInState storage s = _checkIns[user];
        return (s.streak, s.totalCheckIns, s.lastDay);
    }

    /// @notice Whether an address currently holds an Agent ID in the
    ///         official registry.
    function isHolder(address user) public view returns (bool) {
        return IAgentIDRegistry(agentRegistry).balanceOf(user) > 0;
    }
}
