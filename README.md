# Expired Proposals Execution Bot
A simple script to execute expired Genesis Protocol proposals.

## Running the script:
1. Create a `.env` file and specify the following parameters:
```
NETWORK = "YOUR_ETHEREUM_NETWORK_NAME"
PRIVATE_KEY = "YOUR_PRIVATE_KEY"
SCAN_FROM_BLOCK = BLOCK_NUMBER_TO_LISTEN_FROM
WEB3_WS_PROVIDER = "ETHEREUM_WEB_SOCKET_URL"
GAS_PRICE = YOUR_DESIRED_GAS_PRICE
```
2. Open a termminal window within the bot directory and type out the following:
```
npm install
node ./index.js
```
3. The bot will start scanning the blockchain for expired proposals which were not executed and will attempt to execute any expired proposals found.

*Note: Please make sure you have some ETH in the account you entered the private key for in the .env file in order to pay for the transaction gas costs.*