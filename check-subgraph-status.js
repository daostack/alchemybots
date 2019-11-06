const dotenv = require("dotenv");
dotenv.config();

function sendEmail(subject, text) {
  let sender = process.env.SENDER;
  let receiver = process.env.SUBGRAPH_RECEIVER;
  let password = process.env.PASSWORD;

  var nodemailer = require("nodemailer");

  var transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: sender,
      pass: password
    }
  });

  var mailOptions = {
    from: sender,
    to: receiver,
    subject,
    text
  };

  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
      throw Error();
    }
  });
}

function reportEmergency(data, url) {
  sendEmail(
    "Subgraph Failed! " + data, 
    url + " Subgraph Failed! " +
    data +
    ". Please restart the server and run this bot again. If the issue remains check the logs for relevant data."
  );
}

function reportIDChanged(oldID, newID) {
  sendEmail(
    "Subgraph ID changed.", 
    "Subgraph ID changed from: " + oldID + " to: " + newID
  );
}

function reportDataMismatch() {
  sendEmail(
    "Subgraph Data Mismatch.", 
    "The data from the self-hosted subgraph does not match the data from The Graph servers. Please check for possible issues."
  );
}

function sendSubgraphError(error) {
  sendEmail(
    "Subgraph Query Failed.", 
    "Subgraph query failed to call " + process.env.SUBGRAPH_URL + " with error: \n" + error
  );
}

  function checkStatus(isGraphNodeServer, { id, failed, synced, latestEthereumBlockNumber }) {
    if (isGraphNodeServer) {
      if (lastGraphNodeSubgraphId != undefined && id !== lastGraphNodeSubgraphId) {
        reportIDChanged(lastGraphNodeSubgraphId, id);
      }
      lastGraphNodeSubgraphId = id;
    } else {
      if (lastSubgraphId != undefined && id !== lastSubgraphId) {
        reportIDChanged(lastSubgraphId, id);
      }
      lastSubgraphId = id;
    }
    if (!failed) {
      if (synced) {
        console.log("No errors detected, Subgraph running normally");
      } else {
        console.log("Subgraph syncing, no failure detected.");
      }
    } else {
      reportEmergency("Last Synced Block: " + latestEthereumBlockNumber, isGraphNodeServer ? process.env.GRAPH_NODE_SUBGRAPH_URL : process.env.SUBGRAPH_URL);
    }
  }

  async function monitorSubgraph() {
    const axios = require('axios')

    const query = `{
      subgraphs {
        name
        currentVersion {
          deployment {
            id
            latestEthereumBlockNumber
            totalEthereumBlocksCount
            synced
            failed
          }
        }
      }
    }`

    try {
        let { data } = (await axios.post(process.env.GRAPH_NODE_URL, { query })).data
        for (let i in data.subgraphs) {
          if (data.subgraphs[i].name === process.env.SUBGRAPH_NAME) {
            let id = data.subgraphs[i].currentVersion.deployment.id
            let failed = data.subgraphs[i].currentVersion.deployment.failed
            let synced = data.subgraphs[i].currentVersion.deployment.synced
            let latestEthereumBlockNumber = data.subgraphs[i].currentVersion.deployment.latestEthereumBlockNumber
            return { id, failed, synced, latestEthereumBlockNumber }
          }
        }
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, process.env.SUBGRAPH_URL)
    }
  }

  async function monitorGraphNodeSubgraph() {
    const axios = require('axios')

    const query = `{
      indexingStatusesForSubgraphName(subgraphName: "daostack/` + process.env.SUBGRAPH_NAME_GRAPHNODE + `") { subgraph synced failed chains { network ... on EthereumIndexingStatus { latestBlock { number hash } chainHeadBlock { number hash } } } }
    }`

    try {
      let { data } = (await axios.post("https://api.thegraph.com/index-node/graphql", { query })).data
      if (data.indexingStatusesForSubgraphName !== []) {
        let id = data.indexingStatusesForSubgraphName[0].subgraph
        let failed = data.indexingStatusesForSubgraphName[0].failed
        let synced = data.indexingStatusesForSubgraphName[0].synced
        let latestEthereumBlockNumber = data.indexingStatusesForSubgraphName[0].chains[0].latestBlock.number
        return { id, failed, synced, latestEthereumBlockNumber }
      }
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, process.env.GRAPH_NODE_SUBGRAPH_URL)
    }
  }

  async function verifyDataMatch() {
    const axios = require('axios')

    const query = `{
      proposals(where: {stage: "Boosted"}, orderBy: createdAt) {
        id
        votes {
          reputation
          outcome
          createdAt
        }
        stakes {
          staker
          outcome
          createdAt
        }
        votesFor
        votesAgainst
        stakesFor
        stakesAgainst
        paramsHash
        title
      }
    }`
    let dataSubgraph
    try {
      dataSubgraph= (await axios.post(process.env.SUBGRAPH_URL, { query })).data.data
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, process.env.SUBGRAPH_URL)
      return
    }

    try {
      let { data: dataGraphNode } = (await axios.post(process.env.GRAPH_NODE_SUBGRAPH_URL, { query })).data
      if (dataSubgraph.toString() === dataGraphNode.toString()) {
        console.log("Data match correctly.");
      } else {
        reportDataMismatch();
      }
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, process.env.GRAPH_NODE_SUBGRAPH_URL)
    }
  }

  let lastSubgraphId, lastGraphNodeSubgraphId
  module.exports = {
    verifySubgraphs: async function verifySubgraphs() {
      try {
        checkStatus(true, await monitorGraphNodeSubgraph());
        checkStatus(false, await monitorSubgraph());
        verifyDataMatch();
      } catch (e) {
        console.log(e)
        sendSubgraphError(e)
      }
    },
  };
