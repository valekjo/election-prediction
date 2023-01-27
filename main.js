const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const readCsvToJsonLines = async (filename) => {
    const data = await readFile(filename, 'utf-8');
    const lines = data.split('\n').map(line => line.trim());
    const header = lines.shift().split(';');
    return lines.map(line => {
        const row = {};
        const cells = line.split(';');
        // For lines that don't match, return null
        if (cells.length !== header.length) {
            return null;
        }
        cells.forEach((cell, index) => {
            row[header[index]] = parseInt(cell);
        })
        return row;
    })
    // Skip not matching lines
    .filter(Boolean);
};


const transformUnit = (line, getVotes) => {
    const totalVoters = parseInt(line.VOL_SEZNAM);
    const totalVotes = parseInt(line.VYD_OBALKY);
    const votes = getVotes(line);
    const unit = {
        // _rawData: line,
        // Unique identifier of unit
        id: `${line.OKRES}-${line.OBEC}-${line.OKRSEK}`,
        // Level of area
        l1: line.OKRES,
        l2: line.OBEC,
        // Total number of voters
        totalVoters,
        sizeClass: Math.floor(totalVoters / 20),
        // Total number of votes
        totalVotes,
        // Array of votes for candidates
        votes,
        votesRatio: votes.map(x => totalVotes === 0 ? 0 : x / totalVotes),
    };

    return unit;
}

const getVotesRatioError = (unitA, unitB) => {
    // First try mean square error of votesRatio
    let error = 0;
    // Number of items is the same in both units
    const numItems = unitA.votesRatio.length;

    for(let i = 0; i < numItems; i++) {
        error += (unitA.votesRatio[i] - unitB.votesRatio[i]) ** 2
    }
    return error / numItems;
}

// Get most similar unit from reference units
const getBestMatchByErrorSize = (unit, referenceUnits) => {
   return referenceUnits.map((u => ({
            unit: u, 
            error: getVotesRatioError(unit, u)
        })))
        .sort((a, b) => a.error - b.error)
        [0].unit;
}

/**
 * Get the most similar unit from reference units.
 * 
 * The most important part of prediction, with most important assumptions, that people tend to vote the same
 * in places that are close to each other and of the same size.
 * 
 */
const getBestMatch = (unit, referenceUnits) => {
    const preferenceFilters = [
        // Stejna velikost, stejna obec
        ({sizeClass, l2}) => unit.l2 === l2 && sizeClass === unit.sizeClass,
        // Stejna velikost, stejny okres
        ({sizeClass, l1}) => unit.l1 === l1 && sizeClass === unit.sizeClass,
        // Stejna obec
        ({l2}) => unit.l2 === l2,
        // Stejny okres
        ({l1}) => unit.l1 === l1,
        // Stejna velikost
        ({sizeClass}) => unit.sizeClass === sizeClass
    ];
    for(const filter of preferenceFilters) {
        const matchedUnits = referenceUnits.filter(filter);
        if (matchedUnits.length > 0) {
            return getBestMatchByErrorSize(unit, matchedUnits);
        }
    }
    return getBestMatchByErrorSize(unit, referenceUnits);
}

// Project result of given unit
// Unit is historic, referenceUnit is current
const predictUnitFromReference = (unit, referenceUnit) => {
    // Project total votes based on attendance in reference unit - assume the same percentage
    const totalVotes = (referenceUnit.totalVotes * unit.totalVoters / referenceUnit.totalVoters);
    // The ratio of votes is projected to be the same as in the reference unit
    const votesRatio = referenceUnit.votesRatio.map(x => x);
    // Votes are respective portion of total votes
    const votes = votesRatio.map(x => x * totalVotes);
    return {
        id: unit.id,
        referenceUnitId: referenceUnit.id,
        totalVoters: unit.totalVoters,
        totalVotes,
        votes,
        votesRatio,
    }
}

const sumResults = (units) => {
    const emptyVotes = units[0].votes.map(x => 0);
    const results = {
        totalVoters: 0,
        totalVotes: 0,
        votes: emptyVotes,
    };
    units.forEach(unit => {
        results.totalVoters += unit.totalVoters;
        results.totalVotes += unit.totalVotes;
        results.votes = unit.votes.map((n, i) => n + results.votes[i]);
    });
    results.votesRatio = results.votes.map(x => results.totalVotes === 0 ? 0 : x / results.totalVotes);
    return results;
}

const mapById = (units) => {
    const result = {};
    units.forEach(unit => {
        result[unit.id] = unit;
    });
    return result;
}

const predictFromDataset = (historicData, partialCurrentData) => {
    const historicDataMap = mapById(historicData);
    const partialCurrentDataMap = mapById(partialCurrentData);

    // Historic data on the units we have in current data
    const partialHistoricData = historicData.filter((unit) => !!partialCurrentDataMap[unit.id]);

    // Ids of all units
    const unitIds = Object.keys(historicDataMap);
    const predictedData = unitIds.map((unitId) => {
        // If we already have data for the unit, just take it's value as prediction (it is what it is)
        if (partialCurrentDataMap[unitId]) return partialCurrentDataMap[unitId];

        // Otherwise we find the unit that best matched this unit historically
        const unitInHistory = historicDataMap[unitId];
        const referenceUnitInHistory = getBestMatch(unitInHistory, partialHistoricData);

        // And from this best matching unit's current state, we predict the current state of unit
        const referenceUnit = partialCurrentDataMap[referenceUnitInHistory.id];
        return predictUnitFromReference(unitInHistory, referenceUnit); 
    });

    // And then we just sum results of individual units
    return sumResults(predictedData);
}

const printNicely = (results) => {
    const formatter = new Intl.NumberFormat('en-US', {style: 'percent', minimumFractionDigits: 2, /* minimumIntegerDigits: 2 */} );
    const percentages = results.votesRatio.map(x => formatter.format(x)).join('\t');
    console.log(percentages);
}

const printSeparator = () => console.log('------------------------------------------------------------------------');

const pickItemsWithChance = (array, chance) => {
    return array.filter(() => Math.random() < chance);
}

const combinePredictions = (predictions) => {
    return sumResults(predictions);
}

const predictFromDatasets = (historicDatasets, observedData) => {
    const predictions = historicDatasets.map((dataset) => predictFromDataset(dataset, observedData));
    const prediction = combinePredictions(predictions);
    return prediction;
}

// TODO: Prepare the tests
const main = async() => {
    const rawData2018 = await readCsvToJsonLines('./data/train/prez-2018.csv');
    const rawData2023 = await readCsvToJsonLines('./data/test/prez-2023.csv');

    const firstRound2018 = rawData2018.filter(row => row.CHYBA === 0 && row.KOLO === 1).map((line) => transformUnit(line, (line) => [
        line.HLASY_01,
        line.HLASY_02,
        line.HLASY_03,
        line.HLASY_04,
        line.HLASY_05,
        line.HLASY_06,
        line.HLASY_07,
        line.HLASY_08,
        line.HLASY_09,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));
    const secondRound2018 = rawData2018.filter(row => row.CHYBA === 0 &&  row.KOLO === 2).map((line) => transformUnit(line, (line) => [
        line.HLASY_07,
        line.HLASY_09,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));

    const firstRound2023 = rawData2023.filter(row => row.CHYBA === 0 && row.KOLO === 1).map((line) => transformUnit(line, (line) => [
        line.HLASY_01,
        line.HLASY_02,
        // line.HLASY_03,
        line.HLASY_04,
        line.HLASY_05,
        line.HLASY_06,
        line.HLASY_07,
        line.HLASY_08,
        line.HLASY_09,
        line.VYD_OBALKY - line.PL_HL_CELK,
    ]));

    const fullNewData = firstRound2023;

    // We take same of the new data as observation (seemed to work well with random picking)
    const observedData = fullNewData.slice(100, 1000);

    console.log(`Predicting from ${observedData.length} ( ${Math.floor(observedData.length * 100 / fullNewData.length)}%) units:`);
    const prediction = predictFromDatasets([
        firstRound2018,
        secondRound2018,
    ], observedData);


    console.log('                    ↓ ↓ ↓ Prediction ↓ ↓ ↓');
    printNicely(prediction);
    printSeparator();
    printNicely(sumResults(fullNewData))
    console.log('                   ↑ ↑ ↑ Real results ↑ ↑ ↑');

};

(async () => {
    await main();
})();