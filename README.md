# Expired Proposals Execution Bot
A simple script to execute expired Genesis Protocol proposals.

## Running the script:
1. Create a `.env` file and specify the following parameters:
```
NETWORK = "YOUR_ETHEREUM_NETWORK_NAME"
PRIVATE_KEY = "YOUR_PRIVATE_KEY"
WEB3_WS_PROVIDER = "ETHEREUM_WEB_SOCKET_URL"
GAS_PRICE = YOUR_DESIRED_GAS_PRICE
COMMON_URL = "SUBGRAPH_URL_COMMON_IS_USING"
COMMON_UPDATING_URL="https://us-central1-common-daostack.cloudfunctions.net/graphql/update-proposal-by-id"
COMMON=false/true #(activate Common functionality)
NOTIFICATIONS=false/true #(send error notifications)
SENDER=BOT_EMAIL_ACCOUNT
RECEIVER=EMAIL_RECEIVERS_ACCOUNTS # e.g. alice@gmail.com,bob@gmail.com
PASSWORD=BOT_EMAIL_ACCOUNT_PASSWORD
TG_BOT=TELEGRAM_BOT_API_SECRET
TG_CHAT_ID=TELEGRAM_CHAT_ID_NUMBER
```
2. Open a terminal window within the bot directory and type out the following:
```
npm install
node ./index.js
```

To run the bot in the background, make sure to install [forever](https://www.npmjs.com/package/forever) then instead of `node ./index.js` run:
```
npm run start
```
To stop, run:
```
npm run stop
```

Logs are saved to `out.log`, errors to `error.log`. You can run `npm run logs` to watch real time updates of the `out.log` file.

3. The bot will start scanning the blockchain for expired proposals which were not executed and will attempt to execute any expired proposals found.

*Note: Please make sure you have some ETH in the account you entered the private key for in the .env file in order to pay for the transaction gas costs.*
