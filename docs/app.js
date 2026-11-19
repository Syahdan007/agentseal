/*
 * AgentSeal front-end logic.
 *
 * CONFIG — fill these in after deployment:
 *   AGENTSEAL_ADDRESS: the deployed AgentSeal contract on BNB Chain.
 * While AGENTSEAL_ADDRESS is the zero address the site renders a graceful
 * "contract not yet deployed" state for all on-chain sections.
 */
const AGENTSEAL_ADDRESS = "0x0000000000000000000000000000000000000000"; // TODO: set after deployment
const BSC_RPC = "https://bsc-dataseed.binance.org";
const BSC_CHAIN_ID = 56;
const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEPLOYED = AGENTSEAL_ADDRESS.toLowerCase() !== ZERO_ADDRESS;

/* ---------- state ---------- */
let readProvider = null;      // public RPC provider (reads for everyone)
let walletProvider = null;    // ethers BrowserProvider from window.ethereum
let signer = null;
let userAddress = null;
let userIsHolder = false;
let selectedProjectId = null;

const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */
function shortAddr(a) {
  if (!a) return "—";
  return a.slice(0, 6) + "…" + a.slice(-4);
}
function utcDayIndexNow() {
  return Math.floor(Date.now() / 86400000);
}
function fmtDate(unixSeconds) {
  const n = Number(unixSeconds);
  if (!n) return "—";
  return new Date(n * 1000).toUTCString();
}
function showBanner(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideBanner(el) { el.classList.add("hidden"); }
function setTxStatus(msg) {
  if (!msg) { hideBanner($("tx-status")); return; }
  showBanner($("tx-status"), msg);
}
function friendlyError(err) {
  if (!err) return "Unknown error.";
  if (err.code === 4001 || (err.info && err.info.error && err.info.error.code === 4001)) {
    return "Transaction rejected in your wallet. Nothing was sent.";
  }
  const m = err.shortMessage || err.reason || err.message || String(err);
  return m.length > 220 ? m.slice(0, 220) + "…" : m;
}

function readSeal() {
  return new ethers.Contract(AGENTSEAL_ADDRESS, AGENTSEAL_ABI, readProvider);
}
function writeSeal() {
  return new ethers.Contract(AGENTSEAL_ADDRESS, AGENTSEAL_ABI, signer);
}
function readRegistry() {
  return new ethers.Contract(AGENT_ID_REGISTRY, AGENT_ID_REGISTRY_ABI, readProvider);
}

/* ---------- init ---------- */
window.addEventListener("DOMContentLoaded", init);

function init() {
  readProvider = new ethers.JsonRpcProvider(BSC_RPC);

  if (DEPLOYED) {
    $("footer-contract").textContent = AGENTSEAL_ADDRESS;
  } else {
    showBanner($("global-banner"),
      "The AgentSeal contract is not deployed yet. You can browse this page and connect a wallet, " +
      "but project data, check-ins and registration will activate once the contract is live on BNB Chain.");
  }

  $("btn-connect").addEventListener("click", connectWallet);
  $("btn-refresh-projects").addEventListener("click", loadProjects);
  $("btn-checkin").addEventListener("click", doCheckIn);
  $("btn-close-detail").addEventListener("click", () => {
    selectedProjectId = null;
    $("project-detail").classList.add("hidden");
  });
  $("btn-vouch").addEventListener("click", () => doAttest(true));
  $("btn-flag").addEventListener("click", () => doAttest(false));
  $("register-form").addEventListener("submit", doRegister);

  updateWriteControls();
  loadProjects();

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
  }
}

/* ---------- wallet ---------- */
async function connectWallet() {
  if (!window.ethereum) {
    showBanner($("global-banner"),
      "No wallet provider found in this browser. Open this page in a browser with a Web3 wallet " +
      "extension, or in your wallet app's built-in browser, then connect.");
    return;
  }
  try {
    setTxStatus("Connecting wallet…");
    walletProvider = new ethers.BrowserProvider(window.ethereum);
    await walletProvider.send("eth_requestAccounts", []);

    const network = await walletProvider.getNetwork();
    if (Number(network.chainId) !== BSC_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + BSC_CHAIN_ID.toString(16) }]
        });
        walletProvider = new ethers.BrowserProvider(window.ethereum);
      } catch (e) {
        showBanner($("global-banner"),
          "Your wallet is not on BNB Chain (chain ID 56). Please switch networks in your wallet — " +
          "writing to AgentSeal only works on BNB Chain.");
      }
    }

    signer = await walletProvider.getSigner();
    userAddress = await signer.getAddress();

    $("wallet-chip-text").textContent = shortAddr(userAddress);
    $("wallet-chip").classList.remove("hidden");
    $("btn-connect").textContent = "Connected";
    $("btn-connect").disabled = true;
    setTxStatus("");
    await refreshHolderStatus();
    updateWriteControls();
    if (selectedProjectId !== null) loadProjectDetail(selectedProjectId);
  } catch (err) {
    setTxStatus("");
    showBanner($("global-banner"), "Wallet connection failed: " + friendlyError(err));
  }
}

/* ---------- holder status ---------- */
async function refreshHolderStatus() {
  if (!userAddress) return;
  $("holder-not-connected").classList.add("hidden");
  $("holder-connected").classList.remove("hidden");
  $("stat-wallet").textContent = userAddress;

  // Agent ID ownership + own handle (only ever for the connected user).
  try {
    const registry = readRegistry();
    const balance = await registry.balanceOf(userAddress);
    userIsHolder = balance > 0n;
    if (userIsHolder) {
      let handle = "";
      try { handle = await registry.handleOf(userAddress); } catch (e) { /* handle display is best-effort */ }
      $("stat-handle").textContent = handle ? handle + ".ai" : "Agent ID held";
      $("holder-guidance").classList.add("hidden");
    } else {
      $("stat-handle").textContent = "No Agent ID";
      $("holder-guidance").classList.remove("hidden");
    }
  } catch (err) {
    userIsHolder = false;
    $("stat-handle").textContent = "Could not verify";
    showBanner($("global-banner"), "Could not read the Agent ID registry: " + friendlyError(err));
  }

  // Streak (AgentSeal contract).
  if (DEPLOYED) {
    try {
      const seal = readSeal();
      const s = await seal.streakOf(userAddress);
      $("stat-streak").textContent = String(s.currentStreak) + " day" + (String(s.currentStreak) === "1" ? "" : "s");
      $("stat-total-checkins").textContent = String(s.totalCheckIns);
      updateCheckInButton(Number(s.lastCheckInDay));
    } catch (err) {
      $("stat-streak").textContent = "—";
      $("stat-total-checkins").textContent = "—";
      $("checkin-note").textContent = "Could not load streak: " + friendlyError(err);
    }
  } else {
    $("stat-streak").textContent = "—";
    $("stat-total-checkins").textContent = "—";
    $("checkin-note").textContent = "Check-ins activate once the AgentSeal contract is deployed.";
  }
  updateWriteControls();
}

function updateCheckInButton(lastCheckInDay) {
  const btn = $("btn-checkin");
  if (!userAddress) { btn.disabled = true; return; }
  if (!DEPLOYED) { btn.disabled = true; return; }
  if (!userIsHolder) {
    btn.disabled = true;
    $("checkin-note").textContent = "Only Agent ID holders can check in.";
    return;
  }
  if (lastCheckInDay === utcDayIndexNow()) {
    btn.disabled = true;
    $("checkin-note").textContent = "Already checked in today (UTC). Come back tomorrow to keep your streak.";
    return;
  }
  btn.disabled = false;
  $("checkin-note").textContent = "One check-in per UTC day.";
}

async function doCheckIn() {
  if (!signer || !userIsHolder || !DEPLOYED) return;
  try {
    setTxStatus("Check-in: confirm the transaction in your wallet…");
    const tx = await writeSeal().checkIn();
    setTxStatus("Check-in sent (" + tx.hash + "). Waiting for confirmation…");
    await tx.wait();
    setTxStatus("Checked in. Your streak is updated on-chain.");
    await refreshHolderStatus();
  } catch (err) {
    setTxStatus("");
    showBanner($("global-banner"), "Check-in failed: " + friendlyError(err));
  }
}

/* ---------- projects ---------- */
async function loadProjects() {
  const list = $("project-list");
  hideBanner($("projects-error"));
  if (!DEPLOYED) {
    $("projects-loading").classList.add("hidden");
    $("projects-not-deployed").classList.remove("hidden");
    list.innerHTML = "";
    return;
  }
  $("projects-not-deployed").classList.add("hidden");
  $("projects-loading").classList.remove("hidden");
  $("projects-empty").classList.add("hidden");
  try {
    const seal = readSeal();
    const count = Number(await seal.projectCount());
    const projects = [];
    for (let i = 0; i < count; i++) {
      const p = await seal.getProject(i);
      projects.push({ id: i, p });
    }
    $("projects-loading").classList.add("hidden");
    if (count === 0) {
      $("projects-empty").classList.remove("hidden");
      list.innerHTML = "";
      return;
    }
    list.innerHTML = "";
    for (const { id, p } of projects) {
      const trust = Number(p.vouches) - Number(p.flags);
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "project-item";
      btn.type = "button";
      const left = document.createElement("span");
      const nameEl = document.createElement("span");
      nameEl.className = "p-name";
      nameEl.textContent = p.name;
      const meta = document.createElement("span");
      meta.className = "p-meta";
      meta.textContent = " by " + shortAddr(p.registrant) + " · " + Number(p.vouches) + " vouches · " + Number(p.flags) + " flags";
      left.appendChild(nameEl);
      left.appendChild(document.createElement("br"));
      left.appendChild(meta);
      const badge = document.createElement("span");
      badge.className = "trust-badge " + (trust > 0 ? "trust-pos" : trust < 0 ? "trust-neg" : "trust-zero");
      badge.textContent = (trust > 0 ? "+" : "") + trust + " trust";
      btn.appendChild(left);
      btn.appendChild(badge);
      btn.addEventListener("click", () => loadProjectDetail(id));
      li.appendChild(btn);
      list.appendChild(li);
    }
  } catch (err) {
    $("projects-loading").classList.add("hidden");
    showBanner($("projects-error"), "Could not load projects from the contract: " + friendlyError(err));
  }
}

async function loadProjectDetail(id) {
  if (!DEPLOYED) return;
  selectedProjectId = id;
  try {
    const seal = readSeal();
    const p = await seal.getProject(id);
    $("detail-name").textContent = p.name;
    $("detail-registrant").textContent = p.registrant;
    const linkEl = $("detail-link");
    linkEl.innerHTML = "";
    if (p.link) {
      const a = document.createElement("a");
      a.href = p.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.textContent = p.link;
      linkEl.appendChild(a);
    } else {
      linkEl.textContent = "—";
    }
    $("detail-contract").textContent =
      p.projectContract && p.projectContract.toLowerCase() !== ZERO_ADDRESS ? p.projectContract : "None provided";
    $("detail-created").textContent = fmtDate(p.createdAt);
    $("detail-vouches").textContent = String(p.vouches);
    $("detail-flags").textContent = String(p.flags);
    const trust = Number(p.vouches) - Number(p.flags);
    $("detail-trust").textContent = (trust > 0 ? "+" : "") + trust;
    $("detail-description").textContent = p.description || "(no description)";

    // The connected user's own attestation, if any.
    const mine = $("my-attestation");
    if (userAddress) {
      try {
        const att = await seal.attestationOf(id, userAddress);
        if (att.exists) {
          mine.textContent = "You currently " + (att.vouch ? "VOUCH for" : "FLAG") + " this project" +
            (att.note ? " — note: “" + att.note + "”" : "") + " (updated " + fmtDate(att.updatedAt) + "). Attesting again overwrites this.";
          if (!$("attest-note").value) $("attest-note").value = att.note || "";
        } else {
          mine.textContent = "You have not attested to this project yet.";
        }
      } catch (e) {
        mine.textContent = "Could not load your attestation.";
      }
    } else {
      mine.textContent = "Connect your wallet to see and set your attestation.";
    }

    $("project-detail").classList.remove("hidden");
    $("project-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    updateWriteControls();
  } catch (err) {
    showBanner($("projects-error"), "Could not load project details: " + friendlyError(err));
  }
}

async function doAttest(vouch) {
  if (selectedProjectId === null || !signer || !userIsHolder || !DEPLOYED) return;
  const note = $("attest-note").value.trim();
  try {
    setTxStatus((vouch ? "Vouch" : "Flag") + ": confirm the transaction in your wallet…");
    const tx = await writeSeal().attest(selectedProjectId, vouch, note);
    setTxStatus("Attestation sent (" + tx.hash + "). Waiting for confirmation…");
    await tx.wait();
    setTxStatus("Attestation recorded on-chain.");
    await loadProjectDetail(selectedProjectId);
    await loadProjects();
  } catch (err) {
    setTxStatus("");
    showBanner($("global-banner"), "Attestation failed: " + friendlyError(err));
  }
}

/* ---------- register ---------- */
async function doRegister(ev) {
  ev.preventDefault();
  if (!signer || !userIsHolder || !DEPLOYED) return;
  const name = $("reg-name").value.trim();
  const link = $("reg-link").value.trim();
  const contractRaw = $("reg-contract").value.trim();
  const description = $("reg-description").value.trim();
  if (!name || !link) {
    $("register-note").textContent = "Name and link are required.";
    return;
  }
  let contractAddr = ZERO_ADDRESS;
  if (contractRaw) {
    if (!ethers.isAddress(contractRaw)) {
      $("register-note").textContent = "That contract address is not a valid address.";
      return;
    }
    contractAddr = contractRaw;
  }
  try {
    setTxStatus("Registering project: confirm the transaction in your wallet…");
    const tx = await writeSeal().registerProject(name, link, contractAddr, description);
    setTxStatus("Registration sent (" + tx.hash + "). Waiting for confirmation…");
    await tx.wait();
    setTxStatus("Project registered on-chain.");
    $("register-form").reset();
    await loadProjects();
  } catch (err) {
    setTxStatus("");
    showBanner($("global-banner"), "Registration failed: " + friendlyError(err));
  }
}

/* ---------- enable/disable write controls ---------- */
function updateWriteControls() {
  const canWrite = !!signer && userIsHolder && DEPLOYED;
  $("btn-vouch").disabled = !canWrite;
  $("btn-flag").disabled = !canWrite;
  $("attest-note").disabled = !canWrite;
  $("btn-register").disabled = !canWrite;

  let attestHelp = "Attesting again overwrites your previous attestation for this project. Only Agent ID holders can attest; your attestation is your personal opinion, recorded under your own Agent ID.";
  let registerNote = "";
  if (!DEPLOYED) {
    attestHelp = "Attestations activate once the AgentSeal contract is deployed.";
    registerNote = "Registration activates once the AgentSeal contract is deployed.";
  } else if (!userAddress) {
    attestHelp = "Connect an Agent ID holder wallet to attest.";
    registerNote = "Connect an Agent ID holder wallet to register a project.";
  } else if (!userIsHolder) {
    attestHelp = "This wallet holds no Agent ID, so it cannot attest.";
    registerNote = "This wallet holds no Agent ID, so it cannot register projects.";
  }
  $("attest-note-help").textContent = attestHelp;
  $("register-note").textContent = registerNote;
  if (!userAddress || !DEPLOYED) {
    // Check-in button state is handled in refreshHolderStatus / defaults;
    // keep it disabled until a holder is connected.
    if (!userIsHolder) $("btn-checkin").disabled = true;
  }
}
