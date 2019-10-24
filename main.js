const Apify = require('apify');
const rp = require('request-promise');
const cheerio = require('cheerio');
const _ = require('underscore');
const safeEval = require('safe-eval');

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.log(input);

    if (!input || !Array.isArray(input.startURLs) || input.startURLs.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startURLs'.");
    }

    const requestQueue = await Apify.openRequestQueue();

    for (let index = 0; index < input.startURLs.length; index++) {
        await requestQueue.addRequest({ url: input.startUrls[index], userData: { label: 'start' } });
    }

    const basicCrawler = new Apify.BasicCrawler({
        requestQueue,
        handleRequestFunction: async ({ request }) => {
            if (request.userData.label === 'start' || request.userData.label === 'list') {
                const body = await rp(request.url);
                const $ = cheerio.load(body);
                const content = $('.desc span').text().match(/of\s+(\d+[.,]?\d*[.,]?\d*)/)[1];
                const pageCount = Math.floor(parseInt(content, 10) / 50); // Each page has 50 items

                if (request.userData.label === 'start') {
                    for (let index = 1; index < pageCount; index++) {
                        const startNumber = index * 50 + 1;
                        await requestQueue.addRequest({ url: `${request.url}&start=${startNumber}`, userData: { label: 'list' } });
                    }
                }

                const itemLinks = $('.lister-list .lister-item a');
                for (let index = 1; index < itemLinks.length; index++) {
                    const itemUrl = window.location.origin + $(itemLinks[index]).attr('href');
                    await requestQueue.addRequest({ url: `${itemUrl}`, userData: { label: 'item' } });
                }
            } else if (request.userData.label === 'item') {
                const body = await rp(request.url);
                const $ = cheerio.load(body);
                const itemTitle = $('.title_wrapper h1').text().trim();
                const itemOriginalTitle = '';
                const runtime = '';
                const certificate = '';
                const year = '';
                const rating = '';
                const ratingCount = '';
                const desc = $('.summary_text').text().trim();
                const stars = '';
                const director = '';
                const itemGenres = $('#titleStoryLine div h4:contains(Genres:)').parent().text()
                    .replace('Genres:', '')
                    .trim();
                const itemCountry = $('#titleDetails div h4:contains(Country)').parent().text()
                    .replace('Country:', '')
                    .trim();
                const itemId = $('meta[property=pageId]').attr('content');

                const extendedResult = safeEval(input.extendOutputFunction)($);

                const result = {
                    url: request.url,
                    id: itemId,
                    title: itemTitle,
                    originalTitle: itemOriginalTitle,
                    description: desc,
                    genres: itemGenres,
                    country: itemCountry,
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                };

                _.extend(result, extendedResult);

                await Apify.pushData(result);
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            await Apify.pushData({
                '#isFailed': true,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },

        maxRequestsPerCrawl: input.maxItems,
    });

    await basicCrawler.run();
});
