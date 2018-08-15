const Koa = require('koa');
const Router = require('koa-router');
const puppeteer = require('puppeteer');
const koaBody = require('koa-body');
const session = require('koa-generic-session')
const RedisStore = require('koa-redis')
const redis = require('redis')
const convert = require('koa-convert');
const client = redis.createClient(6379, '127.0.0.1')
var options = { client: client };
const core = require('./core')
var store = RedisStore(options);
const uuidv4 = require("uuid/v4");
const cluster = require('cluster');

Date.prototype.Format = function (fmt) { // author: meizz
  var o = {
    "M+": this.getMonth() + 1, // 月份
    "d+": this.getDate(), // 日
    "h+": this.getHours(), // 小时
    "m+": this.getMinutes(), // 分
    "s+": this.getSeconds(), // 秒
    "q+": Math.floor((this.getMonth() + 3) / 3), // 季度
    "S": this.getMilliseconds() // 毫秒
  };
  if (/(y+)/.test(fmt))
    fmt = fmt.replace(RegExp.$1, (this.getFullYear() + "").substr(4 - RegExp.$1.length));
  for (var k in o)
    if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
  return fmt;
}
const app = new Koa();
// app.use(session({
//   store: store
// }));
app.use(convert(session({
  store: store
})));
let router = new Router();

router
  .post('/setKey', async (ctx, next) => {
    let data = ctx.request.body
    let id = uuidv4()
    data.id = id
    // for (let i = 0; i < configData.length; i++) {
    await store.client.rpush('willCompile', JSON.stringify(ctx.request.body))
    // }
    // await store.client.rpush()
    ctx.response.body = { id }
  })
  .post('/getData', async (ctx, next) => {
    const { id } = ctx.request.body
    let ret = await store.client.hgetall(id)
    if (ret) {
      for (let item of Object.keys(ret)) {
        //////console.log('getData', item)
        await store.client.hdel(id, item)
      }
      ctx.response.body = { data: ret }

    } else {
      ctx.response.body = { data: {} }
    }
  })
app.use(koaBody({ multipart: true }));
app.use(router.routes())


let sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}



let compiler = async () => {
  while (true) {
    // await sleep(10000)
    let data = await store.client.lpop('willCompile')

    if (data === null) {
      await sleep(2000)
      continue
    }
    const { nodes, connections, id, startStepId, myData } = data =  JSON.parse(data)
    data.repeated = false
    let startId = "start"
    if (startStepId) {
      startId = startStepId
    }
    let nodeObj = nodes
    let connectionObj = connections
    let actualMyData = myData ? myData : {}

    await store.client.hset('origin' + id, 'nodes', JSON.stringify(nodeObj))
    await store.client.hset('origin' + id, 'connections', JSON.stringify(connectionObj))
    await store.client.hset('origin' + id, 'myData', JSON.stringify(actualMyData))
    let configData = []
    let currentConnection = connectionObj[startId]
    for (let currentNode = nodeObj[startId]; ;) {
      if (currentNode.config.actualType === "if") {
        if (currentNode.config.data.returnValue) {
          //执行了if的情况
          let returnValue = currentNode.config.data.returnValue
          //console.log(typeof returnValue)
          if (returnValue === 'true') {
            currentNode = nodeObj[currentConnection.true]
            currentConnection = connectionObj[currentConnection.true]
          } else {
            currentNode = nodeObj[currentConnection.false]
            currentConnection = connectionObj[currentConnection.false]
          }
          continue
        } else {
          //未执行if的情况
          currentNode.config.id = id
          currentNode.config.feId = currentNode.id
          configData.push(currentNode.config)
          await store.client.rpush('listtest', JSON.stringify(currentNode.config))
          break
        }
      }

      if (currentNode.config.actualType === "for") {
        if (currentNode.config.data.returnValue) {
          if (currentNode.config.data.returnValue === 'true') {
            //true的情况


            if(currentConnection.true === 'end'){
              currentNode = nodeObj[currentConnection.true]
              currentNode.config.id = id
              currentNode.config.feId = currentNode.id
              await store.client.rpush('listtest', JSON.stringify(currentNode.config))
              break
            }
            currentNode = nodeObj[currentConnection.true]
            currentConnection = connectionObj[currentConnection.true]
            //不再把for放执行队列了
            // continue
          } else {
            if(data.repeated){
              //第二次到这一步 把自己放进去 然后跳出
              currentNode.config.id = id
              currentNode.config.feId = currentNode.id
              configData.push(currentNode.config)
              await store.client.rpush('listtest', JSON.stringify(currentNode.config))
              break
            }
            currentNode = nodeObj[currentConnection.false]
            currentConnection = connectionObj[currentConnection.false]
            data.repeated = true
            //false的情况
          }
        } else {
          //第一次把for放进去
          currentNode.config.id = id
          currentNode.config.feId = currentNode.id
          configData.push(currentNode.config)
          await store.client.rpush('listtest', JSON.stringify(currentNode.config))
          break
        }
      }

      if (currentConnection.targetId === "end") {
        currentNode.config.id = id
        currentNode.config.feId = currentNode.id
        configData.push(currentNode.config)
        await store.client.rpush('listtest', JSON.stringify(currentNode.config))
        //把end带上
        currentNode = nodeObj[currentConnection.targetId]
        currentNode.config.id = id
        currentNode.config.feId = currentNode.id
        await store.client.rpush('listtest', JSON.stringify(currentNode.config))
        break
      }
      //处理没有end的情况
      if (!currentConnection) {
        break
      }
      //待优化 here
      //id是整个流程的id feId是每一个step的id
      currentNode.config.id = id
      currentNode.config.feId = currentNode.id
      // delete currentNode.config.style
      configData.push(currentNode.config)
      await store.client.rpush('listtest', JSON.stringify(currentNode.config))
      currentNode = nodeObj[currentConnection.targetId]
      currentConnection = connectionObj[currentConnection.targetId]
    }
  }
}


let processer = async () => {
  const browser = await puppeteer.launch({ headless: false });
  let currentPage = null
  while (true) {
    let data = await store.client.lpop('listtest')
    // //////console.log(data)
    data = JSON.parse(data)
    if (data === null) {
      //console.log('data is null, so sleep 2s')
      await sleep(2000)
      continue
    }
    //////console.log(data.actualType)
    switch ('actualType', data.actualType) {
      case 'start':
        try {
          currentPage = await browser.newPage();
          // await store.client.hset(data.id, 'start', 'success')
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'start'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'start'))
        }
        break
      case 'openPage':
        try {
          let ret = await core('openPage', { currentPage, url: data.data.url })
          //todo:打开失败的判断
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'openPage'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'openPage'))
        }
        break
      case 'input':

        try {
          let xpath = data.data.xpath
          let value = await (translateValue(data.id, data.data.value))
          //console.log('input', value)
          let ret = await core('input', { currentPage, xpath, value })
          //todo:打开失败的判断
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'input'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'input'))
        }
        break
      case 'sleep':

        try {
          let time = data.data.time
          let ret = await core('sleep', { currentPage, time })
          //todo:打开失败的判断
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'sleep'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'sleep'))
        }
        break
      case 'click':
        try {
          let xpath = data.data.xpath

          let ret = await core('click', { currentPage, xpath })
          //todo:打开失败的判断
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'click'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'click'))
        }
        break
      case 'getData':
        try {
          let xpath = data.data.xpath
          let varible = data.data.varible
          let key = data.data.key
          let retData = await core('getData', { currentPage, xpath, key })
          //console.log('getData', retData)
          await store.client.hset(data.id, data.feId, generateReturnObj(JSON.stringify({ [varible]: retData }), 'getData'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'getData'))
        }
        break
      case 'end':
        try {
          // await currentPage.close()
          await core('end', { currentPage })
          // await store.client.hset(data.id, 'end', 'success')
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'end'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'end'))
        }
        break
      case 'if':
        try {
          let value = data.data.value
          // let 
          let ret = await core('if', { currentPage, value })
          //console.log(typeof ret)
          await store.client.hset(data.id, data.feId, generateReturnObj(JSON.stringify(ret), 'if'))

          //重新推到waitCompile队列
          let orginNodes = JSON.parse(await store.client.hget('origin' + data.id, 'nodes'))
          let originConnections = JSON.parse(await store.client.hget('origin' + data.id, 'connections'))
          let originMydata = JSON.parse(await store.client.hget('origin' + data.id, 'myData'))
          // ////console.log('orginNodes', JSON.stringify(orginNodes, null,4), data.feId, ret, orginNodes[data.feId])
          orginNodes[data.feId]['config']['data']['returnValue'] = (!!ret).toString()
          await store.client.hset('origin' + data.id, 'nodes', JSON.stringify(orginNodes))
          await store.client.rpush('willCompile', JSON.stringify({ nodes: orginNodes, connections: originConnections, startStepId: data.feId, id: data.id, myData: originMydata }))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'if'))
        }
        break
      case 'for':
        try {
          let validate = data.data.value
          let after = data.data.after
          let myData = JSON.parse(await store.client.hget('origin' + data.id, 'myData'))

          let ret = await core('for', { currentPage, validate, after, myData })
          await store.client.hset(data.id, data.feId, generateReturnObj(JSON.stringify(ret), 'for'))
          // 重新推到waitCompile队列
          let orginNodes = JSON.parse(await store.client.hget('origin' + data.id, 'nodes'))
          let originConnections = JSON.parse(await store.client.hget('origin' + data.id, 'connections'))
          //修改originProps的数据
          orginNodes[data.feId]['config']['data']['returnValue'] = (!!ret.status).toString()
          await store.client.hset('origin' + data.id, 'nodes', JSON.stringify(orginNodes))
          //重新进入willCompile队列
          await store.client.rpush('willCompile', JSON.stringify({ nodes: orginNodes, connections: originConnections, startStepId: data.feId, id: data.id, myData: ret.myData }))

        } catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'for'))
        }
        break
      case 'evaluate':
        try {
          let value = data.data.value
          let myData = JSON.parse(await store.client.hget('origin' + data.id, 'myData'))
          let newMyData = await core('evaluate', { currentPage, myData, value })
          // await store.client.hset('origin' + data.id, 'myData', JSON.stringify(newMyData))
          await store.client.hset('origin' + data.id, 'myData', JSON.stringify(newMyData))

          await store.client.hset(data.id, data.feId, generateReturnObj(JSON.stringify(newMyData), 'evaluate'))

          //console.log('newMyData', newMyData)
        } catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err.toString(), 'evaluate'))
        }
        break
    }
    //减速测试
    // await sleep(1000)

  }
}

generateReturnObj = (message, method) => {
  let orginObj = {}
  orginObj.data = message
  orginObj.time = new Date().Format("yyyy-MM-dd hh:mm:ss.S")
  orginObj.method = method
  return JSON.stringify(orginObj)
}

translateValue = async (id, string) => {
  const originMydata = JSON.parse(await store.client.hget('origin' + id, 'myData'))
  console.log('originMydata', originMydata)
  // //console.log('originMydata', originMydata)
  const reg1 = /\$\{(.+?)\}/g
  const reg2 = /[^\{\}]+(?=\})/g
  let retString = string
  let translateArr = string.match(reg1)
  if (translateArr && Array.isArray(translateArr)) {
    translateArr.forEach(item => {
      let key = item.match(reg2)[0]
      if (typeof originMydata[key]!=='undefined') {
        // //console.log("@@@@@@@@@@@@@")
        retString = retString.replace(item, originMydata[key])
      }
    })
  }
  return retString
}


// if (cluster.isMaster) {
//   app.listen(7000);
//   compiler()
//   cluster.fork()
// } else {
//   processer()

// }



app.listen(7000);
processer()
compiler()