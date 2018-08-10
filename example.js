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
  .get('/setTest', async (ctx, next) => {
    console.log(ctx.session)
    await store.client.set('test5', 'hello world2')
    ctx.response.body = await store.client.get('test5')
  })
  .post('/setKey', async (ctx, next) => {
    const { configData } = ctx.request.body
    // console.log(configData)
    for (let i = 0; i < configData.length; i++) {
      await store.client.rpush('listtest', JSON.stringify(configData[i]))
    }
    ctx.response.body = await store.client.lrange('listtest', 0, -1)
  })
  .post('/getData', async (ctx, next) => {
    const { id } = ctx.request.body
    let ret = await store.client.hgetall(id)
    if (ret) {
      for (let item of Object.keys(ret)) {
        await store.client.hdel(id, item)
      }
    }
    ctx.response.body = { data: ret }
  })
  .post('/test', async (ctx, next) => {
    const { configData } = ctx.request.body
    // console.log(ctx.request.body)
    // let testData = JSON.
    let ret = {}


    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    for (let i = 0; i < configData.length; i++) {
      switch (configData[i].actualType) {
        case 'openPage':
          await page.goto(configData[i].data.url)
          break
        case 'getData':
          console.log(configData[i].data.xpath)
          let xpath = configData[i].data.xpath
          let varible = configData[i].data.varible
          ret[varible] = await page.evaluate((xpath) => {
            return document.querySelector(xpath).innerHTML
          }, xpath)
          break
      }
    }
    await browser.close();
    ctx.response.type = 'json'
    ctx.response.body = { code: 0, message: 'success', configData, ret }
  })
app.use(koaBody({ multipart: true }));
app.use(router.routes())
app.listen(7000);

let sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}
let processer = async () => {
  const browser = await puppeteer.launch({ headless: false });
  let currentPage = null
  while (true) {
    let data = await store.client.lpop('listtest')
    data = JSON.parse(data)
    console.log(data)
    if (data === null) {
      console.log('data is null, so sleep 5s')
      await sleep(5000)
      continue
    }
    console.log(data.actualType)
    switch (data.actualType) {
      case 'start':
        console.log('instart')
        // console.log(data, data.id)
        try {
          currentPage = await browser.newPage();
          // await store.client.hset(data.id, 'start', 'success')
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'start'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj('error', 'start'))
        }
        console.log('finish start')
        break
      case 'openPage':
        try {
          let ret = await core('openPage', { currentPage, url: data.data.url })
          //todo:打开失败的判断
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'openPage'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj('error', 'openPage'))
        }
        break
      case 'input':

        try {
          let xpath = data.data.xpath
          let value = data.data.value
          let ret = await core('input', { currentPage, xpath, value })
          //todo:打开失败的判断
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'input'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj('error', 'input'))
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
          await store.client.hset(data.id, data.feId, generateReturnObj('error', 'sleep'))
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
          await store.client.hset(data.id, data.feId, generateReturnObj('error', 'click'))
        }
        break
      case 'getData':
        try {
          let xpath = data.data.xpath
          let varible = data.data.varible
          let retData = await core('getData', { currentPage, xpath })
          await store.client.hset(data.id, data.feId, generateReturnObj(JSON.stringify({ [varible]: retData }), 'getData'))
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj(err, 'getData'))
        }
        break
      case 'end':
        try {
          // await currentPage.close()
          await core('end', { currentPage })
          // await store.client.hset(data.id, 'end', 'success')
          await store.client.hset(data.id, data.feId, generateReturnObj('success', 'end'))
          console.log(`finish end`)
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, generateReturnObj('error', 'end'))
        }
        break
    }
  }
}

generateReturnObj = (message, method) => {
  let orginObj = {}
  orginObj.data = message
  orginObj.time = new Date().Format("yyyy-MM-dd hh:mm:ss.S")
  orginObj.method = method
  return JSON.stringify(orginObj)
}
processer()