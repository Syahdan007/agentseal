const { expect } = require("chai");
const { ethers, network } = require("hardhat");

// The exact registry address AgentSeal is hard-wired to (BNB Chain mainnet).
const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const DAY = 86400n;

async function setNextBlockTimestamp(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
}

describe("AgentSeal", function () {
  let seal, mockAtRegistry, deployer, holderA, holderB, stranger;

  beforeEach(async function () {
    [deployer, holderA, holderB, stranger] = await ethers.getSigners();

    // Deploy the mock, then etch its runtime code onto the REAL registry
    // address so AgentSeal's hard-wired gate talks to the mock.
    const Mock = await ethers.getContractFactory("MockAgentIDRegistry");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    const code = await ethers.provider.getCode(await mock.getAddress());
    await network.provider.send("hardhat_setCode", [REGISTRY, code]);

    mockAtRegistry = Mock.attach(REGISTRY);
    await mockAtRegistry.setHolder(holderA.address, true, "alpha");
    await mockAtRegistry.setHolder(holderB.address, true, "beta");
    // stranger and deployer hold no Agent ID.

    const Seal = await ethers.getContractFactory("AgentSeal");
    seal = await Seal.deploy();
    await seal.waitForDeployment();
  });

  it("points at the official Agent ID registry", async function () {
    expect(await seal.agentRegistry()).to.equal(REGISTRY);
    expect(await seal.isHolder(holderA.address)).to.equal(true);
    expect(await seal.isHolder(stranger.address)).to.equal(false);
  });

  it("reverts registerProject / attest / checkIn for non-holders", async function () {
    await expect(
      seal.connect(stranger).registerProject("X", "https://x", ethers.ZeroAddress, "d")
    ).to.be.revertedWith("AgentSeal: caller does not hold an Agent ID");

    // Even the deployer has no special power: no ID, no write.
    await expect(
      seal.connect(deployer).registerProject("X", "https://x", ethers.ZeroAddress, "d")
    ).to.be.revertedWith("AgentSeal: caller does not hold an Agent ID");

    await expect(seal.connect(stranger).checkIn()).to.be.revertedWith(
      "AgentSeal: caller does not hold an Agent ID"
    );

    // Register a real project as a holder, then a non-holder attest must fail.
    await seal.connect(holderA).registerProject("Proj", "https://p", ethers.ZeroAddress, "d");
    await expect(
      seal.connect(stranger).attest(1, true, "nice")
    ).to.be.revertedWith("AgentSeal: caller does not hold an Agent ID");
  });

  it("lets a holder register a project with incremental ids from 1", async function () {
    await expect(
      seal.connect(holderA).registerProject("Alpha App", "https://alpha.example", holderB.address, "first")
    )
      .to.emit(seal, "ProjectRegistered")
      .withArgs(1, holderA.address, "Alpha App");

    await seal
      .connect(holderB)
      .registerProject("Beta Bot", "https://beta.example", ethers.ZeroAddress, "second");

    expect(await seal.projectCount()).to.equal(2n);

    const p = await seal.getProject(1);
    expect(p.registrant).to.equal(holderA.address);
    expect(p.name).to.equal("Alpha App");
    expect(p.link).to.equal("https://alpha.example");
    expect(p.projectContract).to.equal(holderB.address);
    expect(p.description).to.equal("first");
    expect(p.vouches).to.equal(0n);
    expect(p.flags).to.equal(0n);
    expect(p.createdAt).to.be.greaterThan(0n);
  });

  it("rejects empty project names and unknown project ids on attest", async function () {
    await expect(
      seal.connect(holderA).registerProject("", "https://x", ethers.ZeroAddress, "d")
    ).to.be.revertedWith("AgentSeal: name must not be empty");

    await expect(seal.connect(holderA).attest(99, true, "ghost")).to.be.revertedWith(
      "AgentSeal: project does not exist"
    );
    await expect(seal.connect(holderA).attest(0, true, "zero")).to.be.revertedWith(
      "AgentSeal: project does not exist"
    );
  });

  it("moves vouch/flag counts correctly on attestation overwrite", async function () {
    await seal.connect(holderA).registerProject("Proj", "https://p", ethers.ZeroAddress, "d");

    // A vouches, B flags.
    await expect(seal.connect(holderA).attest(1, true, "great"))
      .to.emit(seal, "Attested")
      .withArgs(1, holderA.address, true);
    await seal.connect(holderB).attest(1, false, "suspicious");
    let p = await seal.getProject(1);
    expect(p.vouches).to.equal(1n);
    expect(p.flags).to.equal(1n);

    // A overwrites vouch -> flag: counts must swing, not stack.
    await seal.connect(holderA).attest(1, false, "changed my mind");
    p = await seal.getProject(1);
    expect(p.vouches).to.equal(0n);
    expect(p.flags).to.equal(2n);

    let a = await seal.attestationOf(1, holderA.address);
    expect(a.exists).to.equal(true);
    expect(a.vouch).to.equal(false);
    expect(a.note).to.equal("changed my mind");
    expect(a.updatedAt).to.be.greaterThan(0n);

    // B overwrites flag -> vouch.
    await seal.connect(holderB).attest(1, true, "actually legit");
    p = await seal.getProject(1);
    expect(p.vouches).to.equal(1n);
    expect(p.flags).to.equal(1n);

    // Same-stance overwrite keeps counts stable and updates the note.
    await seal.connect(holderB).attest(1, true, "still legit");
    p = await seal.getProject(1);
    expect(p.vouches).to.equal(1n);
    expect(p.flags).to.equal(1n);
    a = await seal.attestationOf(1, holderB.address);
    expect(a.note).to.equal("still legit");

    // A user who never attested reads as non-existent.
    const none = await seal.attestationOf(1, stranger.address);
    expect(none.exists).to.equal(false);
  });

  it("enforces one check-in per UTC day and tracks the streak", async function () {
    // Anchor to the chain's current UTC day, then work with whole days
    // strictly in the future (block timestamps cannot move backwards).
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const startDay = now / DAY + 1n; // first check-in happens on this day

    await setNextBlockTimestamp(startDay * DAY + 3600n);
    await expect(seal.connect(holderA).checkIn())
      .to.emit(seal, "CheckedIn")
      .withArgs(holderA.address, 1n, 1n);

    let s = await seal.streakOf(holderA.address);
    expect(s.currentStreak).to.equal(1n);
    expect(s.totalCheckIns).to.equal(1n);
    expect(s.lastCheckInDay).to.equal(startDay);

    // Second check-in on the same UTC day reverts.
    await expect(seal.connect(holderA).checkIn()).to.be.revertedWith(
      "AgentSeal: already checked in today"
    );

    // Next UTC day: streak grows to 2.
    await setNextBlockTimestamp((startDay + 1n) * DAY + 10n);
    await seal.connect(holderA).checkIn();
    s = await seal.streakOf(holderA.address);
    expect(s.currentStreak).to.equal(2n);
    expect(s.totalCheckIns).to.equal(2n);
    expect(s.lastCheckInDay).to.equal(startDay + 1n);

    // Skip a day (check in on startDay+3): streak resets to 1, total keeps counting.
    await setNextBlockTimestamp((startDay + 3n) * DAY + 10n);
    await seal.connect(holderA).checkIn();
    s = await seal.streakOf(holderA.address);
    expect(s.currentStreak).to.equal(1n);
    expect(s.totalCheckIns).to.equal(3n);
    expect(s.lastCheckInDay).to.equal(startDay + 3n);
  });

  it("loses write access when the Agent ID is revoked", async function () {
    await mockAtRegistry.setHolder(holderA.address, false, "");
    expect(await seal.isHolder(holderA.address)).to.equal(false);
    await expect(seal.connect(holderA).checkIn()).to.be.revertedWith(
      "AgentSeal: caller does not hold an Agent ID"
    );
  });
});
