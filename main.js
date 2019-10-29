const Apify = require('apify');
const _ = require('underscore');
const safeEval = require('safe-eval');

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.log(input);

    if (!input || !Array.isArray(input.startUrls) || input.startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunction;
    if (typeof input.extendOutputFunction === 'string' && input.extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunction = safeEval(input.extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunction !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    const dataset = await Apify.openDataset();
    const { itemCount } = await dataset.getInfo();

    let pagesOutputted = itemCount;

    const requestQueue = await Apify.openRequestQueue();

    for (let index = 0; index < input.startUrls.length; index++) {
        await requestQueue.addRequest({ url: input.startUrls[index].url, userData: { label: 'start' } });
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        handlePageFunction: async ({ request, autoscaledPool, $ }) => {
            if (request.userData.label === 'start' || request.userData.label === 'list') {
                const paginationEle = $('.desc span');
                if (!paginationEle || paginationEle.text() === '') {
                    return;
                }

                const content = $('.desc span').text().match(/of\s+(\d+[.,]?\d*[.,]?\d*)/)[1];
                const pageCount = Math.floor(parseInt(content, 10) / 50); // Each page has 50 items

                if (request.userData.label === 'start') {
                    for (let index = 1; index < pageCount; index++) {
                        const startNumber = index * 50 + 1;
                        let startUrl = request.url;
                        startUrl += `${startUrl.split('?')[1] ? '&' : '?'}start=${startNumber}`;
                        await requestQueue.addRequest({ url: startUrl, userData: { label: 'list' } });
                    }
                }

                const itemLinks = $('.lister-list .lister-item a');
                for (let index = 0; index < itemLinks.length; index++) {
                    const href = $(itemLinks[index]).attr('href');
                    if (href.includes('/title/')) {
                        const itemId = href.match(/\/title\/(.{9})/)[1];
                        const itemUrl = `https://www.imdb.com/title/${itemId}/parentalguide`;

                        await requestQueue.addRequest({ url: `${itemUrl}`, userData: { label: 'parentalguide', id: itemId } });
                    }
                }
            } else if (request.userData.label === 'parentalguide') {
                const itemCertificates = $('#certificates').text().trim();
                const itemUrl = `https://www.imdb.com/title/${request.userData.id}`;

                await requestQueue.addRequest({ url: `${itemUrl}`, userData: { label: 'item', certificates: itemCertificates } });
            } else if (request.userData.label === 'item') {
                const itemTitle = $('.title_wrapper h1').text().trim();
                const itemOriginalTitle = '';
                const itemRuntime = $('#titleDetails div h4:contains(Runtime:)').parent().text()
                    .replace('Runtime:', '')
                    .trim();
                const yearMatch = itemTitle.match(/(\d+)/);
                const itemYear = yearMatch ? yearMatch[0] : '';
                const itemRating = $('.ratingValue').text().trim();
                const itemRatingCount = $('.ratingValue').text().trim();
                const desc = $('.summary_text').text().trim();
                const itemStars = $('.credit_summary_item h4:contains(Stars:)').parent().text()
                    .replace('Stars:', '')
                    .trim();
                const itemDirector = $('.credit_summary_item h4:contains(Director:)').parent().text()
                    .replace('Director:', '')
                    .trim();
                const itemGenres = $('#titleStoryLine div h4:contains(Genres:)').parent().text()
                    .replace('Genres:', '')
                    .trim();
                const itemCountry = $('#titleDetails div h4:contains(Country)').parent().text()
                    .replace('Country:', '')
                    .trim();
                const itemId = $('meta[property=pageId]').attr('content');

                const pageResult = {
                    url: request.url,
                    id: itemId,
                    title: itemTitle,
                    originalTitle: itemOriginalTitle,
                    description: desc,
                    genres: itemGenres,
                    country: itemCountry,
                    runtime: itemRuntime,
                    rating: itemRating,
                    ratingCount: itemRatingCount,
                    director: itemDirector,
                    stars: itemStars,
                    year: itemYear,
                    certificate: request.userData.certificates,
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                };

                if (extendOutputFunction) {
                    const userResult = await extendOutputFunction($);
                    _.extend(pageResult, userResult);
                }

                await Apify.pushData(pageResult);

                if (++pagesOutputted >= input.maxItems) {
                    const msg = `Outputted ${pagesOutputted} pages, limit is ${input.maxItems} pages`;
                    console.log(`Shutting down the crawler: ${msg}`);
                    autoscaledPool.abort();
                }
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            await Apify.pushData({
                '#isFailed': true,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },

        proxyConfiguration: input.proxyConfiguration,
    });

    await crawler.run();
});
