require('dotenv').config();
let network = process.env.NETWORK
let privateKey = process.env.PRIVATE_KEY
let scanFromBlock = process.env.SCAN_FROM_BLOCK
let web3WSProvider = process.env.WEB3_WS_PROVIDER
let gasPrice = process.env.GAS_PRICE

// Setting up Web3 instance
const Web3 = require('web3')
const web3 = new Web3(new Web3.providers.WebsocketProvider(web3WSProvider))
let account = web3.eth.accounts.privateKeyToAccount(privateKey)
web3.eth.accounts.wallet.add(account)
web3.eth.defaultAccount = account.address

// Setup Genesis Protocol
const DAOstackMigration = require('@daostack/migration')
let migration = DAOstackMigration.migration(network)
const GenesisProtocol = require('@daostack/arc/build/contracts/GenesisProtocol.json')
let gpAddress = migration.base.GenesisProtocol
let genesisProtocol = new web3.eth.Contract(GenesisProtocol.abi, gpAddress)

// List all active timers by proposalId
let activeTimers = {}

// Subscrice to StateChange events of the Genesis Protocol
genesisProtocol.events.StateChange({ fromBlock: scanFromBlock }, async (error, events) => {
  if (!error) {
    // Get the proposal and Genesis Protocol data
    let proposalId = events.returnValues._proposalId
    let proposalState = events.returnValues._proposalState
    let proposal = await genesisProtocol.methods.proposals(proposalId).call()
    let boostedTime = (await genesisProtocol.methods.getProposalTimes(proposalId).call())[1].toNumber()
    let boostingPeriod = proposal.currentBoostedVotePeriodLimit.toNumber()

    // Clear past timeouts if existed
    if (activeTimers[proposalId] !== undefined) {
      clearTimeout(activeTimers[proposalId])
      activeTimers[proposalId] = undefined
      console.log('Proposal: ' + proposalId + ' state changed. Stopping timer.')
    }

    // If entered into Boosted or Quiet Ending state
    if ((proposalState === 5 || proposalState === 6) && (proposal.state == 5 || proposal.state === 6)) {
      let timerDelay = (boostingPeriod + boostedTime) * 1000 - Date.now()
      if (timerDelay < 0) {
        timerDelay = 0
      }

      console.log('Proposal: ' + proposalId + ' entered ' +
        (proposalState === 5 ? 'Boosted' : 'Quiet Ending') + ' Phase. Expiration timer has been set to: ' + (timerDelay !== 0 ? convertMillisToTime(timerDelay) : "now"))

      // Setup timer for the expiration time
      
      activeTimers[proposalId] = setTimeout(async () => {
        activeTimers[proposalId] = undefined
        console.log('Proposal: ' + proposalId + ' has expired. Attempting to redeem proposal.')

        // Check if can close the proposal as expired and claim the bounty
        let failed = false
        let expirationCallBounty = await genesisProtocol.methods.executeBoosted(proposalId).call().catch((error) => {
          console.log('Could not call execute Proposal: ' + proposalId + '. error returned: ' + extractJSON(error.toString())[0].message)
          failed = true
        })

        if (!failed && Number(web3.utils.fromWei(expirationCallBounty.toString())) > 0) {
          // Close the proposal as expired and claim the bounty
          await genesisProtocol.methods.executeBoosted(proposalId).send({
            from: web3.eth.defaultAccount,
            gas: 200000,
            gasPrice: gasPrice
          }, function (error, transactionHash) {
            if (!error) {
              console.log('Proposal: ' + proposalId + ' has expired and was successfully executed: ' + transactionHash + '\nReward received for execution: ' + web3.utils.fromWei(expirationCallBounty.toString()))
            } else {
              console.log('Could not execute Proposal: ' + proposalId + '. error returned: ' + extractJSON(error.toString())[0].message)
            }
          })
        }
      }, timerDelay)
    }
  }
}
)

// Helpers

// Extract error JSON object from the error string
function extractJSON (str) {
  var firstOpen, firstClose, candidate
  firstOpen = str.indexOf('{', firstOpen + 1)
  do {
    firstClose = str.lastIndexOf('}')
    if (firstClose <= firstOpen) {
      return null
    }
    do {
      candidate = str.substring(firstOpen, firstClose + 1)
      try {
        var res = JSON.parse(candidate)
        return [res, firstOpen, firstClose + 1]
      } catch (e) {
        console.log('JSON error parsing failed')
      }
      firstClose = str.substr(0, firstClose).lastIndexOf('}')
    } while (firstClose > firstOpen)
    firstOpen = str.indexOf('{', firstOpen + 1)
  } while (firstOpen !== -1)
}

// Get timer delay as readable time
function convertMillisToTime(millis){
  let delim = " ";
  let hours = Math.floor(millis / (1000 * 60 * 60));
  millis -= hours * (1000 * 60 * 60)
  let minutes = Math.floor(millis / (1000 * 60));
  millis -= minutes * (1000 * 60)
  let seconds = Math.floor(millis / 1000);
  hours = hours < 10 ? '0' + hours : hours;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  seconds = seconds < 10 ? '0' + seconds : seconds;
  return hours + 'h'+ delim + minutes + 'm' + delim + seconds + 's';
}