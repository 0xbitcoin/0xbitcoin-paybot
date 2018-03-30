
  var redisInterface = require('./redis-interface')

  const Tx = require('ethereumjs-tx')

  var tokenContractJSON = require('./contracts/_0xBitcoinToken.json');
  var deployedContractInfo = require('./contracts/DeployedContractInfo.json');

  var web3utils = require('web3-utils')

const GAS_PRICE_GWEI = 4;
module.exports =  {

  //use redis to store the past payments

  async init(payments,accountConfig,web3)
  {
      console.log('init transaction manager')

      this.accountConfig = accountConfig;
      this.web3=web3;

      this.tokenContractAddress = deployedContractInfo.networks.mainnet.contracts._0xbitcointoken.blockchain_address;

      this.tokenContract =  new web3.eth.Contract(tokenContractJSON.abi,this.tokenContractAddress )

      await redisInterface.init();


      await redisInterface.dropList('paybot_queued_payments');

      for(var key in payments)
      {

        var paymentStatus = {
          queued:true,
          pending:false,
          mined:false,
          success:false
        }


        var existingPayment = await redisInterface.findHashInRedis('paybot_payment',key)

        var paymentData = {
          address: key,
          tokenAmount: payments[key],
          paymentStatus:paymentStatus,
          paymentUUID: web3utils.randomHex(32)
        }


        if(existingPayment == null)
        {
          console.log('\n')
          console.log('adding',key,payments[key])

          await redisInterface.storeRedisHashData('paybot_payment',key, JSON.stringify(paymentData))
          var existingPayment = await redisInterface.findHashInRedis('paybot_payment',key)
        }


        var existingPaymentData = JSON.parse(existingPayment);

        if(existingPaymentData.paymentStatus.mined==false)
        {
          console.log('push')
          await redisInterface.pushToRedisList('paybot_queued_payments',JSON.stringify(paymentData))
        }

      }


      var self = this;


      setTimeout(function(){self.sendTransfers()},0)


  },

     async sendTransfers()
     {
       var self = this;
       console.log('send transfers');

       var statistics = await this.getPaymentStatistics();

       var queuedCount = statistics.queuedCount;
       var pendingCount = statistics.pendingCount;

       var hasQueuedTransaction = (queuedCount > 0);
       var hasPendingTransaction = (pendingCount > 0);

       console.log('queuedCount',queuedCount)
        console.log('pendingCount',pendingCount)

        if( hasQueuedTransaction && !hasPendingTransaction ){

          var nextQueuedTransactionData = await redisInterface.popFromRedisList('paybot_queued_payments'  )
          var nextQueuedTransaction = JSON.parse(nextQueuedTransactionData)
          console.log('nextQueuedTransactionData',nextQueuedTransactionData)

            if(nextQueuedTransaction!=null && nextQueuedTransaction.tokenAmount >= 1 && nextQueuedTransaction.paymentStatus.mined == false)
            {
                  await this.handlePaymentTransaction( nextQueuedTransaction );
            }else{
              console.log('skipping transaction....')
            }



        }


       setTimeout(function(){self.sendTransfers()},1000)
     },

     async handlePaymentTransaction(payment)
     {
       console.log('handle',payment)


         var tx_hash = await this.transferTokens(payment.address,payment.tokenAmount,payment.paymentUUID)

         if(tx_hash == null){

           console.log('tx not broadcast successfully')
         }else{
             console.log('broadcasted transaction -> ',tx_hash);



             var existingPayment = await redisInterface.findHashInRedis('paybot_payment',payment.address)
             var existingPaymentData = JSON.parse(existingPayment);

             existingPaymentData.txHash = tx_hash;
             existingPaymentData.paymentStatus.pending = false;
             existingPaymentData.paymentStatus.mined = true;

            if(existingPayment)
            {
              console.log('storing new data for ', tx_hash)
              await redisInterface.storeRedisHashData('paybot_payment',payment.address,JSON.stringify(existingPaymentData) )

            }


         }
     },

     async transferTokens(recipientAddress,amount,paymentUUID)
     {
        console.log('transfer tokens ')


       var addressTo = this.tokenContract.options.address;
       var addressFrom = this.getPaymentAccount().address;

       var transferMethod = this.tokenContract.methods.transfer(addressTo,amount);


       var ethBlock = await this.getEthBlockNumber();


       try{
         var txCount = await this.web3.eth.getTransactionCount(addressFrom);
         console.log('txCount',txCount)
        } catch(error) {  //here goes if someAsyncPromise() rejected}
         console.log(error);

          return error;    //this will result in a resolved promise.
        }


        var txData = this.web3.eth.abi.encodeFunctionCall({
                name: 'transfer',
                type: 'function',
                inputs: [{
                    type: 'address',
                    name: 'to'
                },{
                    type: 'uint256',
                    name: 'tokens'
                }]
            }, [recipientAddress, amount]);


            var max_gas_cost = 1704624;

            var estimatedGasCost = await transferMethod.estimateGas({gas: max_gas_cost, from:addressFrom, to: addressTo });

            if( estimatedGasCost > max_gas_cost){
              console.log("Gas estimate too high!  Something went wrong ")
              return;
            }

            const txOptions = {
              nonce: web3utils.toHex(txCount),
              gas: web3utils.toHex(1704624),
              gasPrice: web3utils.toHex(web3utils.toWei(GAS_PRICE_GWEI.toString(), 'gwei') ),
              value: 0,
              to: addressTo,
              from: addressFrom,
              data: txData
            }

            var privateKey =  this.getPaymentAccount().privateKey;

            return new Promise(function (result,error) {

                 this.sendSignedRawTransaction(this.web3,txOptions,addressFrom,privateKey, function(err, res) {
                  if (err) error(err)
                    result(res)
                })

              }.bind(this));


     },


     async sendSignedRawTransaction(web3,txOptions,addressFrom,private_key,callback) {

       var privKey = this.truncate0xFromString( private_key )

       const privateKey = new Buffer( privKey, 'hex')
       const transaction = new Tx(txOptions)


       transaction.sign(privateKey)


       const serializedTx = transaction.serialize().toString('hex')

         try
         {
           var result =  web3.eth.sendSignedTransaction('0x' + serializedTx, callback)
         }catch(e)
         {
           console.log('error',e);
         }
     },

     truncate0xFromString(s)
    {
      if(s.startsWith('0x')){
        return s.substring(2);
      }
      return s;
    },



     async getEthBlockNumber()
     {
       return await this.web3.eth.getBlockNumber()
       },

      getPaymentAccount()
     {
        return this.accountConfig.payment;
     },

     async getPaymentStatistics()
     {
       var queuedCount = 0;
       var pendingCount = 0;

       var paymentHashes = await redisInterface.getResultsOfKeyInRedis('paybot_payment')
       var payments = [];

       for(i in paymentHashes){
         var hash = paymentHashes[i];
        var paymentData = ( await redisInterface.findHashInRedis('paybot_payment',hash) )
         payments.push( JSON.parse( paymentData ) )
       }


       payments.map(function(item){

      //   console.log(item.paymentStatus)


         if(item.paymentStatus.queued )
         {
           queuedCount++;
         }

         if(item.paymentStatus.pending )
         {
           pendingCount++;
         }

       });


       return {
         queuedCount:queuedCount,
          pendingCount:pendingCount
       }
     }

}
