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
        const { currentPage, xpath } = params
        let data = await currentPage.evaluate((xpath) => {
            return document.querySelector(xpath).innerText
        }, xpath)
        return data
    },
    input: async (params) => {
        const { currentPage, xpath, value } = params
        let data = await currentPage.evaluate((xpath, value) => {
            return document.querySelector(xpath).value = value
        }, xpath, value)
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
        const { currentPage, time } = params
        await sleep(time)
        // let data = await currentPage.evaluate((xpath) => {
        //     return document.querySelector(xpath).click()
        // }, xpath)

        // return data
    },
}


module.exports = async (key, params) => {
    return await coreFunction[key](params)
}