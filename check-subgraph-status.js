const dotenv = require("dotenv");
dotenv.config();

function reportEmergency(data) {
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
      subject: "Subgraph Failed! " + data,
      text:
        "Subgraph Failed! " +
        data +
        ". Please restart the server and run this bot again. If the issue remains check the logs for relevant data."
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

  module.exports = {
    monitorSubgraph: async function monitorSubgraph() {
      const axios = require('axios')
  
      const query = `{
        subgraphs {
          name
          currentVersion {
            deployment {
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
              let failed = data.subgraphs[i].currentVersion.deployment.failed
              let synced = data.subgraphs[i].currentVersion.deployment.synced
              let latestEthereumBlockNumber = data.subgraphs[i].currentVersion.deployment.latestEthereumBlockNumber
              if (!failed) {
                if (synced) {
                  console.log("No errors detected, Subgraph running normally");
                } else {
                  console.log("Subgraph syncing, no failure detected.");
                }
              } else {
                reportEmergency("Last Synced Block: " + latestEthereumBlockNumber);
              }
              break
            }
          }
      } catch (e) {
          console.log(e)
      }
    },
    monitorGraphNodeSubgraph: async function monitorGraphNodeSubgraph() {
      const axios = require('axios')
  
      const query = `{
        indexingStatusesForSubgraphName(subgraphName: "daostack/` + process.env.SUBGRAPH_NAME_GRAPHNODE + `") { subgraph synced failed chains { network ... on EthereumIndexingStatus { latestBlock { number hash } chainHeadBlock { number hash } } } }
      }`
      
      try {
        let { data } = (await axios.post("https://api.thegraph.com/index-node/graphql", { query })).data
        if (data.indexingStatusesForSubgraphName !== []) {
          let failed = data.indexingStatusesForSubgraphName[0].failed
          let synced = data.indexingStatusesForSubgraphName[0].synced
          let latestEthereumBlockNumber = data.indexingStatusesForSubgraphName[0].chains[0].latestBlock.number
          if (!failed) {
            if (synced) {
              console.log("No errors detected, Subgraph running normally");
            } else {
              console.log("Subgraph syncing, no failure detected.");
            }
          } else {
            reportEmergency("Last Synced Block: " + latestEthereumBlockNumber);
          }
        }
      } catch (e) {
          console.log(e)
      }
    }
  };
