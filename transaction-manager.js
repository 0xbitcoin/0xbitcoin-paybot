
  var redisInterface = require('./redis-interface')


module.exports =  {

  //use redis to store the past payments

  async init(payments,accountConfig)
  {
      console.log('init transaction manager')

      await redisInterface.init();



      for(var key in payments)
      {

        var paymentStatus = {
          queued:false,
          pending:false,
          mined:false,
          success:false
        }

        var existingPayment = await redisInterface.findHashInRedis('paybot_payment',key)

        if(existingPayment== null)
        {
          console.log('\n')
          console.log(key,payments[key])

          redisInterface.storeRedisHashData('paybot_payment',key, JSON.stringify({address: key, tokenAmount: payments[key]}))
        }
      }


      var self = this;


      setTimeout(function(){self.sendTransfers()},0)


  },

     async sendTransfers()
     {

       var self = this;
       console.log('send transfers')


       setTimeout(function(){self.sendTransfers()},1000)
     }

}
