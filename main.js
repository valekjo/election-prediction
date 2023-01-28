

// const _ = require('lodash');
import _ from 'lodash';
import got from 'got';
// const got = require('got');
// import {
//     predictFromDatasets,
//     sumResults,
//     meanSquareError,
//     humanizePrediction,
//     loadHistoricDatasets,
//     CANDIDATE_NAMES,
// } from './utils.js';

const main = async() => {
    const { data } = got.get('https://www.volby.cz/opendata/prez2018/PREZ2018data20180127_csv_kolo2.zip');
    console.log(data);
};

// TODO:
// - download and unzip fresh data from volby.cz/opendata/opendata
// - run the prediction
// - send the prediction results to dataset
// - chart of historic data
(async () => {
    await main();
})();