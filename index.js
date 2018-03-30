console.log('starting paybot')


var INFURA_MAINNET_URL = 'https://mainnet.infura.io/gmXEVo5luMPUGPqg6mhy';


var Web3 = require('web3')

var web3 = new Web3()

web3.setProvider(INFURA_MAINNET_URL)

var fs = require("fs");

var transactionManager = require('./transaction-manager');

var accountConfig = require('./account.config').accounts;

var owedPaymentContent = fs.readFileSync("./owed_payment.json");
var owedPayments = JSON.parse(owedPaymentContent).owedPayments;



async function init()
{
  //console.log(owedPayments)

  transactionManager.init(owedPayments,accountConfig,web3);



}

init();
