
  var redisInterface = require('./redis-interface')


module.exports =  {

  //use redis to store the past payments

  async init(payments,accountConfig)
  {
      console.log('init transaction manager')

      await redisInterface.init();



      for(var key in payments)
      {
        console.log('\n')
        console.log(key,payments[key])

        redisInterface.storeRedisHashData('paybot_payment',key, JSON.stringify({address: key, tokenAmount: payments[key]}))

      }



  }

}
