require("dotenv").config();

let network = process.env.NETWORK;
let privateKey = process.env.PRIVATE_KEY;
let scanFromBlock = process.env.SCAN_FROM_BLOCK;
let web3WSProvider = process.env.WEB3_WS_PROVIDER;
let gasPrice = process.env.GAS_PRICE;
let nonce = -1;

// Setting up Web3 instance
const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.WebsocketProvider(web3WSProvider));
let account = web3.eth.accounts.privateKeyToAccount(privateKey);
web3.eth.accounts.wallet.add(account);
web3.eth.defaultAccount = account.address;

// Setup Genesis Protocol
const DAOstackMigration = require("@daostack/migration");
let migration = DAOstackMigration.migration(network);
const GenesisProtocol = require("@daostack/arc/build/contracts/GenesisProtocol.json");
let gpAddress = migration.base.GenesisProtocol;
let genesisProtocol = new web3.eth.Contract(GenesisProtocol.abi, gpAddress);

// List all active timers by proposalId
let activeTimers = {};

// List of all redeemed proposals
let redeemedProposals = {};

const retryLimit = 5;
// List of all retries of proposals executions
let retriedCount = {};

////////////// Functions //////////////

async function listenProposalsStateChanges() {
  // Start listening to events
  genesisProtocol.events
    .StateChange({ fromBlock: scanFromBlock }, async (error, events) => {
      if (nonce === -1) {
        nonce =
          (await web3.eth.getTransactionCount(web3.eth.defaultAccount)) - 1;
      }

      if (!error) {
        // Get the proposal and Genesis Protocol data
        let proposalId = events.returnValues._proposalId;
        let proposalState = events.returnValues._proposalState;
        let proposal = await genesisProtocol.methods
          .proposals(proposalId)
          .call();

        // Clear past timeouts if existed
        clearTimer(proposalId);

        // If entered into Boosted or Quiet Ending state
        if (
          (proposalState === 5 || proposalState === 6) &&
          (proposal.state === 5 || proposal.state === 6)
        ) {
          // Calculate the milliseconds until expiration
          let timerDelay = await calculateTimerDelay(proposalId, proposal);
          log(
            "Proposal: " +
              proposalId +
              " entered " +
              (proposalState === 5 ? "Boosted" : "Quiet Ending") +
              " Phase. Expiration timer has been set to: " +
              (timerDelay !== 0 ? convertMillisToTime(timerDelay) : "now")
          );
          // Setup timer for the expiration time
          await setExecutionTimer(proposalId, timerDelay);
        } else if (proposalState === 4 && proposal.state === 4) {
          let timerDelay = await calculatePreBoostedTimerDelay(
            proposalId,
            proposal
          );
          log(
            "Proposal: " +
              proposalId +
              " entered Pre-Boosted Phase. Boosting timer has been set to: " +
              (timerDelay !== 0 ? convertMillisToTime(timerDelay) : "now")
          );
          await setPreBoostingTimer(proposalId, timerDelay + 10000);
        }
      } else {
        log(" Failed to start event listener");
      }
    })
    .on("error", console.error);
}

async function setPreBoostingTimer(proposalId, timerDelay) {
  // Setup timer for the pre-boosting time
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;

    let proposal = await genesisProtocol.methods.proposals(proposalId).call();
    if (proposal.state === 4) {
      // Boost the proposal or return it to Queue
      await genesisProtocol.methods
        .execute(proposalId)
        .send(
          {
            from: web3.eth.defaultAccount,
            gas: 300000,
            gasPrice: web3.utils.toWei(gasPrice, "gwei"),
            nonce: ++nonce
          },
          function(error, transactionHash) {
            if (!error) {
              log(
                "Proposal: " +
                  proposalId +
                  " was successfully executed: " +
                  transactionHash
              );
            } else {
              log(
                Date.now() +
                  " | Could not execute Proposal: " +
                  proposalId +
                  ". error returned: " +
                  extractJSON(error.toString())[0].message
              );
            }
          }
        )
        .on("confirmation", function(_, receipt) {
          log(
            "Boosting transaction: " +
              receipt.transactionHash +
              " for proposal: " +
              proposalId +
              " was successfully confirmed."
          );
        })
        .on("error", console.error);
    }
  }, timerDelay);
}

async function setExecutionTimer(proposalId, timerDelay) {
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;
    log(
      "Proposal: " + proposalId + " has expired. Attempting to redeem proposal."
    );

    // Check if can close the proposal as expired and claim the bounty
    let failed = false;
    let expirationCallBounty = await genesisProtocol.methods
      .executeBoosted(proposalId)
      .call()
      .catch(error => {
        log(
          "Could not call execute Proposal: " +
            proposalId +
            ". error returned: " +
            extractJSON(error.toString())[0].message
        );
        failed = true;
      });

    if (
      !failed &&
      Number(web3.utils.fromWei(expirationCallBounty.toString())) > 0
    ) {
      // Close the proposal as expired and claim the bounty
      await genesisProtocol.methods
        .executeBoosted(proposalId)
        .send(
          {
            from: web3.eth.defaultAccount,
            gas: 300000,
            gasPrice: web3.utils.toWei(gasPrice, "gwei"),
            nonce: ++nonce
          },
          async function(error) {
            if (error) {
              log(error);
            }
            activeTimers[proposalId] = setTimeout(async () => {
              retriedCount[proposalId] !== undefined
                ? retriedCount[proposalId]++
                : (retriedCount[proposalId] = 1);
              await retryExecuteProposal(proposalId, error);
            }, 10000);
          }
        )
        .on("confirmation", function(_, receipt) {
          log(
            "Execution transaction: " +
              receipt.transactionHash +
              " for proposal: " +
              proposalId +
              " was successfully confirmed."
          );
        })
        .on("error", console.error);
    } else {
      log(
        "Failed to execute proposal:" +
          proposalId +
          " for " +
          expirationCallBounty +
          " GEN"
      );
    }
  }, timerDelay);
}

async function retryExecuteProposal(proposalId, error) {
  let proposal = await genesisProtocol.methods.proposals(proposalId).call();
  if (proposal.state !== 2) {
    let errorMsg = extractJSON(error.toString());
    log(
      "Could not execute Proposal: " +
        proposalId +
        ". error returned: " +
        (errorMsg !== null ? errorMsg[0].message : error)
    );
    if (retriedCount[proposalId] <= retryLimit) {
      log("Retrying...");
      retriedCount[proposalId]++;
      let timerDelay = await calculateTimerDelay(proposalId, proposal);
      setExecutionTimer(proposalId, timerDelay + 5000);
    } else {
      log("Too many retries, proposal execution abandoned.");
    }
  } else {
    log("Proposal: " + proposalId + " was execute.");
  }
}

async function listenProposalBountyRedeemed() {
  let fromBlock = await web3.eth.getBlockNumber();
  genesisProtocol.events
    .ExpirationCallBounty(
      {
        fromBlock
      },
      async (error, events) => {
        if (!error) {
          let proposalId = events.returnValues._proposalId;
          let beneficiary = events.returnValues._beneficiary;
          let amount = events.returnValues._amount;
          clearTimer(proposalId);
          redeemedProposals[proposalId] = {
            beneficiary,
            amount
          };
          if (
            web3.eth.defaultAccount.toLowerCase() === beneficiary.toLowerCase()
          ) {
            log(
              "Proposal: " +
                proposalId +
                " has expired and was successfully executed: " +
                events.transactionHash +
                "\nReward received for execution: " +
                web3.utils.fromWei(amount.toString()) +
                " GEN"
            );
          } else {
            log(
              "Proposal: " +
                proposalId +
                " was redeemed by another account: " +
                beneficiary +
                "\nReward received for execution: " +
                web3.utils.fromWei(amount.toString()) +
                " GEN"
            );
          }
        }
      }
    )
    .on("error", console.error);
}

// Timer Delay calculator
async function calculateTimerDelay(proposalId, proposal) {
  // Calculate the milliseconds until boosting ends
  let boostedTime = (await genesisProtocol.methods
    .getProposalTimes(proposalId)
    .call())[1].toNumber();
  let boostingPeriod = proposal.currentBoostedVotePeriodLimit.toNumber();
  let timerDelay = (boostingPeriod + boostedTime) * 1000 - Date.now();
  if (timerDelay < 0) {
    timerDelay = 0;
  }
  return timerDelay;
}

async function calculatePreBoostedTimerDelay(proposalId, proposal) {
  // Calculate the milliseconds until pre-boosting ends
  let preBoostedTime = (await genesisProtocol.methods
    .getProposalTimes(proposalId)
    .call())[2].toNumber();
  let preBoostingPeriod = (await genesisProtocol.methods
    .parameters(proposal.paramsHash)
    .call()).preBoostedVotePeriodLimit.toNumber();
  let timerDelay = (preBoostingPeriod + preBoostedTime) * 1000 - Date.now();
  if (timerDelay < 0) {
    timerDelay = 0;
  }
  return timerDelay;
}

// Helpers

// Extract error JSON object from the error string
function extractJSON(str) {
  var firstOpen, firstClose, candidate;
  firstOpen = str.indexOf("{", firstOpen + 1);
  do {
    firstClose = str.lastIndexOf("}");
    if (firstClose <= firstOpen) {
      return null;
    }
    do {
      candidate = str.substring(firstOpen, firstClose + 1);
      try {
        var res = JSON.parse(candidate);
        return [res, firstOpen, firstClose + 1];
      } catch (e) {
        log("JSON error parsing failed.");
      }
      firstClose = str.substr(0, firstClose).lastIndexOf("}");
    } while (firstClose > firstOpen);
    firstOpen = str.indexOf("{", firstOpen + 1);
  } while (firstOpen !== -1);
}

// Get timer delay as readable time
function convertMillisToTime(millis) {
  let delim = " ";
  let hours = Math.floor(millis / (1000 * 60 * 60));
  millis -= hours * (1000 * 60 * 60);
  let minutes = Math.floor(millis / (1000 * 60));
  millis -= minutes * (1000 * 60);
  let seconds = Math.floor(millis / 1000);
  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  seconds = seconds < 10 ? "0" + seconds : seconds;
  return hours + "h" + delim + minutes + "m" + delim + seconds + "s";
}

function clearTimer(proposalId) {
  if (activeTimers[proposalId] !== undefined) {
    clearTimeout(activeTimers[proposalId]);
    activeTimers[proposalId] = undefined;
    log("Proposal: " + proposalId + " state changed. Stopping timer.");
  }
}

function log(message) {
  let logMsg =
    new Date().toLocaleString("en-US", { hour12: false }) +
    " | " +
    message +
    "\n";
  console.log(logMsg);
  // Requiring fs module in which
  // writeFile function is defined.
  const fs = require("fs");

  fs.readFile("logs.txt", "utf-8", (err, data) => {
    if (err) {
      data = "";
    }
    // Write data in 'logs.txt' .
    fs.writeFile("logs.txt", data + "\n" + logMsg, err => {
      if (err) {
        console.log("Error writing into logs.txt: " + logMsg);
      }
    });
  });
}

module.exports = {
  startBot: async function() {
    // Subscrice to StateChange events of the Genesis Protocol
    log(
      "Started listening to StateChange events of Genesis Protocol: " +
        gpAddress +
        " on " +
        network +
        " network"
    );

    await listenProposalsStateChanges();
    await listenProposalBountyRedeemed();
  }
};
