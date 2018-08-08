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

var store = RedisStore(options);


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
  const browser = await puppeteer.launch();
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
        console.log(data, data.id)
        try {
          currentPage = await browser.newPage();
          // await store.client.hset(data.id, 'start', 'success')
          await store.client.hset(data.id, data.feId, 'success')
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, 'error')
        }
        console.log('finish start')
        break
      case 'openPage':
        try {
          await currentPage.goto(data.data.url)
          // await store.client.hset(data.id, 'openPage', 'success')
          await store.client.hset(data.id, data.feId, 'success')
          console.log(`finish openPage ${data.data.url}`)
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, 'error')
        }
        break
      case 'getData':
        try {
          console.log(data.data.xpath)
          let xpath = data.data.xpath
          let varible = data.data.varible
          let retData = await currentPage.evaluate((xpath) => {
            return document.querySelector(xpath).innerHTML
          }, xpath)
          // await store.client.hset(data.id, 'getData', JSON.stringify({ [varible]: retData }))
          await store.client.hset(data.id, data.feId, JSON.stringify({ [varible]: retData }))
          console.log(`finish getData ${varible} ${retData}`)
        }
        catch (err) {
          await store.client.hset(data.id, data.feId, 'error')
        }
        break
      case 'end':
        try {
          await currentPage.close()
          // await store.client.hset(data.id, 'end', 'success')
          await store.client.hset(data.id, data.feId, 'success')
          console.log(`finish end`)
        }
        catch(err){
          await store.client.hset(data.id, data.feId, 'error')
        }
        break
    }
  }
}
processer()