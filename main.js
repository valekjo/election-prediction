

// const _ = require('lodash');
import got from 'got';
import _ from 'lodash';
import * as cheerio from 'cheerio';
import { CANDIDATE_NAMES, loadHistoricDatasets, predictFromDatasets, readFile, writeFile, humanizePrediction, getSizeClass } from './utils.js';

const getObecToOkresMap = (dataset) => {
    const map = {};
    dataset.forEach((line) => {
        map[line.l2] = line.l1;
    });
    return map;
}

const loadUrlCached = async (kolo, davka) => {
    const filename = `./cache/kolo-${kolo}/davka-${davka}.xml`;
    const url = `https://www.volby.cz/pls/prez2023/vysledky_okrsky?kolo=${kolo}&davka=${davka}`;

    try {
        const data = await readFile(filename, {encoding: 'utf8'});
        return data;
    } catch(err) {

    }
    console.log('Downloading data', {kolo, davka});
    const { body } = await got.get(url, {retry: {limit: 5}});
    const $ = cheerio.load(body, { xmlMode: true});
    const chyba = $('CHYBA').attr('KOD_CHYBY');

    if (chyba) {
        console.log('Error loading', { chyba });
        return null;
    }

    await writeFile(filename, body);
    return body;
    
}

const loadXMLBatch = async (kolo, davka, { obecToOkresMap, numCandidates }) => {
    const body = await loadUrlCached(kolo, davka);

    // No more data
    if (body === null) {
        return null;
    }

    const $ = cheerio.load(body, {xmlMode: true});

    const $davka = $('DAVKA');
    const okrskyCelkem = parseInt($davka.attr("OKRSKY_CELKEM"));
    const okrzkyZprac = parseInt($davka.attr("OKRSKY_ZPRAC"));

    const data = [];
    $('OKRSEK').each((i, okrsek) => {
        const $okrsek = $(okrsek);

        if ($okrsek.attr('OPAKOVANE') === '1') return;

        const $ucast = $okrsek.find('UCAST_OKRSEK');
        const totalVoters = parseInt($ucast.attr('ZAPSANI_VOLICI'))
        const totalVotes = parseInt($ucast.attr('VYDANE_OBALKY'))

        const validVotes = parseInt($ucast.attr('PLATNE_HLASY'));

        const votesRaw = {};
        $okrsek.find('HLASY_OKRSEK').each((_, hlasy) => {
            const $hlasy = $(hlasy);
            const candidate = parseInt($hlasy.attr('PORADOVE_CISLO'));
            const count = parseInt($hlasy.attr('HLASY'));
            votesRaw[candidate] = count;
        });

        const votes = [];
        for(let candidate = 1; candidate <= numCandidates; candidate++) {
            votes.push(votesRaw[candidate] || 0);
        }
        // // Add invalid votes
        // votes.push(totalVotes - validVotes);

        const l3 = parseInt($okrsek.attr('CIS_OKRSEK'));
        const l2 = parseInt($okrsek.attr('CIS_OBEC'));
        const l1 = obecToOkresMap[l2];

        const id = `${l1}-${l2}-${l3}`;

        data.push({
            id,
            totalVoters,
            totalVotes,
            votes,
            l1,
            l2,
            sizeClass: getSizeClass(totalVoters),
            votesRatio: votes.map(x => totalVotes === 0 ? 0 : x / totalVotes),
        });
    });

    return { data, meta: {
        okrskyCelkem,
        okrzkyZprac,
        percentage: okrzkyZprac / okrskyCelkem,
    } };
}

const loadAllAvailableData = async (kolo, maxBatch, options) => {
    const data = [];
    let meta = null;
    for(let i = 1; i <= maxBatch; i++) {
        const batch = await loadXMLBatch(kolo, i, options);
        // We are done
        if (!batch) break;
        data.push(...batch.data);
        meta = batch.meta;
    }
    return {data, meta};
}

const main = async() => {

    // Load historic datasets
    const historicDatasets = await loadHistoricDatasets();

    // Get map of obec to okres
    const obecToOkresMap = getObecToOkresMap(historicDatasets.firstRound2018);
    const {data, meta} = await loadAllAvailableData(1, 5, { obecToOkresMap, numCandidates: 9 });

    const prediction = predictFromDatasets(
        [ historicDatasets.firstRound2018 ],
        data
    );

    console.log(meta);
    console.log(humanizePrediction(prediction, CANDIDATE_NAMES.FIRST_ROUND_2023));
};

// TODO:
// - download and unzip fresh data from volby.cz/opendata/opendata
// - run the prediction
// - send the prediction results to dataset
// - chart of historic data
(async () => {
    await main();
})();