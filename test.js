import _ from 'lodash';
import {
    predictFromDatasets,
    sumResults,
    meanSquareError,
    humanizePrediction,
    loadHistoricDatasets,
    CANDIDATE_NAMES,
} from './utils.js';

const test = async (historicDatasets, currentData, sampleSize, { candidateNames }) => {
    // Take part of the data as observation
    const observedData = _.sampleSize(currentData, Math.floor(currentData.length * sampleSize));

    console.log(`Predicting from ${observedData.length} ( ${Math.floor(observedData.length * 10000 / currentData.length)/100}%) units sample:`);
    const prediction = predictFromDatasets(historicDatasets, observedData);
    const realResults = sumResults(currentData);

    // We calculate error as mean square error of percentages (so it looks something like percents)
    const error = meanSquareError(prediction.votesRatio.map(x => x * 100), realResults.votesRatio.map(x => x * 100));

    console.log('Prediction');
    console.log(humanizePrediction(prediction, candidateNames));
    console.log(`Error: ${Math.floor(error * 100) / 100}`);
};


const main = async() => {
    const datasets = await loadHistoricDatasets();
    const sampleSizes = [0.005, 0.015, 0.020, 0.050, 0.100];
    console.log('Elections 2023 from both rounds of 2018');
    sampleSizes.forEach((sampleSize) => {
        test(
            [ datasets.firstRound2018, datasets.secondRound2018 ],
            datasets.firstRound2023,
            sampleSize,
            { candidateNames: CANDIDATE_NAMES.FIRST_ROUND_2023 }
        );
    });

    console.log('-----------------------------------------------------------------');
    console.log('Second round 2018 from first round 2018');
    sampleSizes.forEach((sampleSize) => {
        test(
            [ datasets.firstRound2018 ],
            datasets.secondRound2018,
            sampleSize,
            { candidateNames: CANDIDATE_NAMES.SECOND_ROUND_2018 },
        );
    });
};

// TODO:
// - download and unzip fresh data from volby.cz/opendata/opendata
// - run the prediction
// - send the prediction results to dataset
// - chart of historic data
(async () => {
    await main();
})();