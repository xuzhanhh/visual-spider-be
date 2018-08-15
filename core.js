let sleep = async (duration) => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, duration);
    });
};

let coreFunction = {
    end: async (params) => {
        const { currentPage } = params
        let data = await currentPage.close()
        return data

    },
    openPage: async (params) => {
        const { currentPage, url } = params
        let data = await currentPage.goto(url)
        return data
    },
    getData: async (params) => {
        const { currentPage, xpath, key } = params
        let actualKey = key?key: 'innerHTML'

        let data = await currentPage.evaluate((xpath, actualKey) => {
            let data = document.querySelectorAll(xpath)
            let ret = [...data].map(item=>item[actualKey])
             return ret
        }, xpath, actualKey)
        return data
    },
    input: async (params) => {
        const { currentPage, xpath, value } = params
        let data = await currentPage.evaluate((xpath, value) => {
            return document.querySelector(xpath).value = value
        }, xpath, value)
        return data
    },
    if: async(params)=> {
        const { currentPage, value } = params
        console.log('if', value)
        let data = await currentPage.evaluate((value)=>{
            return eval(value)
        }, value)
        return data
    },
    click: async (params) => {
        const { currentPage, xpath } = params
        let data = await currentPage.evaluate((xpath) => {
            return document.querySelector(xpath).click()
        }, xpath)
        return data
    },
    sleep: async (params) => {
        const { time } = params
        await sleep(time)
    },
    evaluate: async(params)=> {
        const { currentPage, myData, value} = params
        let retMyData = await currentPage.evaluate((myData, value)=>{
            if (!myData){
                myData = myData
            }
            eval(value)
            return myData
        }, myData, value)
        return retMyData
    },
    for: async(params) => {
        const { currentPage, myData, validate, after} = params
        console.log(validate, after)
        let retMyData = await currentPage.evaluate((myData, validate, after)=>{
            if (!myData){
                myData = myData
            }
            let validateData = eval(validate)
            eval(after)
            return {status:validateData, myData}
        }, myData, validate, after)
        return retMyData
    }
}


module.exports = async (key, params) => {
    return await coreFunction[key](params)
}